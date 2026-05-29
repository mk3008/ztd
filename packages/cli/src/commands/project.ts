import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type { Command } from 'commander';
import { InsertQuery, MultiQuerySplitter, SqlParser, TableSource, type SourceExpression } from 'rawsql-ts';
import { runCheckContract, type CheckContractResult } from './check-contract.js';
import { loadProjectPathConfig, type ProjectPathConfig } from './config.js';
import { loadDdlSchemaModelWithDiagnostics, type DdlSchemaColumn, type DdlSchemaDiagnosticsResult, type DdlSchemaTable } from './ddl-schema-model.js';
import {
  runFeatureTestsCheck,
  type FeatureGeneratedMapperCheckResult,
  type FeatureTestsCheckResult,
} from './feature.js';
import { runLint, type LintResult } from './lint.js';

export interface ProjectCheckIssue {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  file?: string;
  table?: string;
  column?: string;
  nextAction?: string;
}

export interface ProjectCheckResult {
  kind: 'project-check';
  ok: boolean;
  rootDir: string;
  durationMs: number;
  timings: Array<{
    phase: string;
    durationMs: number;
  }>;
  coverage: {
    ddlFiles: number;
    sqlFiles: number;
    mapperQueries: number;
    catalogSpecs: number;
    featureTestQueries: number;
    lintFiles: number;
  };
  errors: ProjectCheckIssue[];
  warnings: ProjectCheckIssue[];
  checks: {
    config: ProjectPathConfig;
    contract?: CheckContractResult;
    featureTests?: FeatureTestsCheckResult;
    generatedMapper?: FeatureGeneratedMapperCheckResult;
    ddlDiagnostics?: {
      ddlDir: string;
      files: string[];
      diagnostics: ProjectCheckIssue[];
    };
    lint?: LintResult;
  };
}

export interface ProjectCheckOptions {
  rootDir?: string;
  format?: 'text' | 'json';
  warningsAsErrors?: boolean;
}

interface ProjectCheckContext {
  rootDir: string;
  config: ProjectPathConfig;
  ddlSchema: DdlSchemaDiagnosticsResult;
  sqlRoots: Array<{
    configured: string;
    absolute: string;
    files: string[];
  }>;
  sqlFiles: string[];
}

export function registerProjectCommand(program: Command): void {
  const project = program.command('project').description('Run project-level passive safety checks');

  project
    .command('check')
    .description('Aggregate contract, feature, SQL lint, and DDL diagnostics')
    .option('--root-dir <path>', 'Project root directory', '.')
    .option('--format <format>', 'Output format: text or json', 'text')
    .option('--warnings-as-errors', 'Treat warnings as check failures', false)
    .action((options: ProjectCheckOptions) => {
      const result = runProjectCheck(options);
      if (options.format === 'json') {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        process.stdout.write(formatProjectCheckResult(result, options));
      }
      if (!result.ok) process.exitCode = 1;
    });
}

export function runProjectCheck(options: ProjectCheckOptions = {}): ProjectCheckResult {
  const startedAt = performance.now();
  const rootDir = path.resolve(options.rootDir ?? '.');
  const errors: ProjectCheckIssue[] = [];
  const warnings: ProjectCheckIssue[] = [];
  const timings: ProjectCheckResult['timings'] = [];
  const coverage: ProjectCheckResult['coverage'] = {
    ddlFiles: 0,
    sqlFiles: 0,
    mapperQueries: 0,
    catalogSpecs: 0,
    featureTestQueries: 0,
    lintFiles: 0,
  };
  const pathConfig = measurePhase(timings, 'config', () => loadProjectPathConfig(rootDir));
  const checks: ProjectCheckResult['checks'] = { config: pathConfig };

  const ddlSchema = measurePhase(timings, 'ddl-model', () => loadDdlSchemaModelWithDiagnostics(rootDir));
  const context = buildProjectCheckContext(rootDir, pathConfig, ddlSchema);
  coverage.ddlFiles = ddlSchema.files.length;
  coverage.sqlFiles = context.sqlFiles.length;

  measurePhase(timings, 'ddl-diagnostics', () => {
    const ddlIssueDiagnostics = [
      ...ddlSchema.diagnostics.map((issue) => ({ ...issue })),
      ...insertColumnOwnershipIssues(context),
    ];
    const ddlDiagnostics = formatDdlDiagnostics(rootDir, ddlSchema, ddlIssueDiagnostics);
    checks.ddlDiagnostics = ddlDiagnostics;
    appendIssues(errors, warnings, ddlDiagnostics.diagnostics);
  });

  measurePhase(timings, 'contract', () => {
    try {
      checks.contract = runOptionalContractCheck(rootDir, pathConfig);
      coverage.mapperQueries = checks.contract.mapperCheck.checked.length;
      coverage.catalogSpecs = checks.contract.catalogCheck.checked.length;
      if (checks.contract.mapperCheck.checked.length > 0) {
        checks.generatedMapper = checks.contract.mapperCheck;
      }
      appendIssues(errors, warnings, contractIssues(checks.contract));
      appendIssues(errors, warnings, generatedMapperIssues(checks.contract.mapperCheck));
    } catch (error) {
      errors.push(checkExecutionIssue('ASHIBA_PROJECT_CONTRACT_CHECK_ERROR', 'Contract check could not complete.', error));
    }
  });

  measurePhase(timings, 'feature-tests', () => {
    try {
      const featureTests = runOptionalFeatureTestsCheck(rootDir, pathConfig);
      if (featureTests) {
        checks.featureTests = featureTests;
        coverage.featureTestQueries = featureTests.checked.length;
        appendIssues(errors, warnings, featureTestsIssues(featureTests));
      }
    } catch (error) {
      errors.push(checkExecutionIssue('ASHIBA_PROJECT_FEATURE_TESTS_CHECK_ERROR', 'Feature tests check could not complete.', error));
    }
  });

  measurePhase(timings, 'sql-lint', () => {
    try {
      const lint = runOptionalSqlLint(context);
      if (lint) {
        checks.lint = lint;
        coverage.lintFiles = lint.files.length;
        appendIssues(errors, warnings, lintIssues(lint));
      }
    } catch (error) {
      errors.push(checkExecutionIssue('ASHIBA_PROJECT_SQL_LINT_ERROR', 'SQL lint could not complete.', error));
    }
  });

  return {
    kind: 'project-check',
    ok: errors.length === 0 && (options.warningsAsErrors !== true || warnings.length === 0),
    rootDir,
    durationMs: roundDuration(performance.now() - startedAt),
    timings,
    coverage,
    errors,
    warnings,
    checks,
  };
}

export function formatProjectCheckResult(result: ProjectCheckResult, options: ProjectCheckOptions = {}): string {
  const lines = [
    `Ashiba project check: ${result.ok ? 'ok' : 'failed'}`,
    `- root: ${result.rootDir}`,
    `- duration ms: ${result.durationMs}`,
    `- feature root: ${result.checks.config.featureRoot}`,
    `- SQL roots: ${result.checks.config.sqlRoots.join(', ')}`,
    `- coverage: ddlFiles=${result.coverage.ddlFiles}, sqlFiles=${result.coverage.sqlFiles}, mapperQueries=${result.coverage.mapperQueries}, catalogSpecs=${result.coverage.catalogSpecs}, featureTestQueries=${result.coverage.featureTestQueries}, lintFiles=${result.coverage.lintFiles}`,
    `- errors: ${result.errors.length}`,
    `- warnings: ${result.warnings.length}${options.warningsAsErrors ? ' (treated as errors)' : ''}`,
    `- contract: ${result.checks.contract ? (result.checks.contract.ok ? 'ok' : 'failed') : 'skipped'}`,
    `- feature tests: ${result.checks.featureTests ? (result.checks.featureTests.ok ? 'ok' : 'failed') : 'skipped'}`,
    `- generated mapper: ${result.checks.generatedMapper ? (result.checks.generatedMapper.ok ? 'ok' : 'failed') : 'skipped'}`,
    `- DDL diagnostics: ${result.checks.ddlDiagnostics ? (result.checks.ddlDiagnostics.diagnostics.length === 0 ? 'ok' : 'issues') : 'skipped'}`,
    `- SQL lint: ${result.checks.lint ? (result.checks.lint.ok ? 'ok' : 'failed') : 'skipped'}`,
  ];
  if (result.timings.length > 0) {
    lines.push(`- timings: ${result.timings.map((timing) => `${timing.phase}=${timing.durationMs}ms`).join(', ')}`);
  }
  if (result.errors.length > 0) {
    lines.push('', 'Errors:');
    for (const issue of result.errors) lines.push(formatIssue(issue));
  }
  if (result.warnings.length > 0) {
    lines.push('', 'Warnings:');
    for (const issue of result.warnings) lines.push(formatIssue(issue));
  }
  return `${lines.join('\n')}\n`;
}

function formatDdlDiagnostics(
  rootDir: string,
  result: DdlSchemaDiagnosticsResult,
  diagnostics: ProjectCheckIssue[],
): NonNullable<ProjectCheckResult['checks']['ddlDiagnostics']> {
  return {
    ddlDir: normalizePath(path.relative(rootDir, result.ddlDir)),
    files: result.files,
    diagnostics,
  };
}

function runOptionalContractCheck(rootDir: string, config: ProjectPathConfig): CheckContractResult {
  const featureRoot = path.join(rootDir, config.featureRoot);
  if (!existsSync(featureRoot)) {
    return {
      rootDir,
      mapperCheck: { rootDir, checked: [], ok: true },
      catalogCheck: { checked: [], warnings: [], ok: true },
      attainment: {
        overall: 'not done',
        mapper: 'skipped',
        catalog: 'skipped',
        issueCount: 0,
        nextActions: [],
      },
      ok: true,
    };
  }
  return runCheckContract({ rootDir, scopeDir: config.featureRoot });
}

function runOptionalFeatureTestsCheck(rootDir: string, config: ProjectPathConfig): FeatureTestsCheckResult | undefined {
  try {
    return runFeatureTestsCheck({ rootDir, featureRoot: config.featureRoot });
  } catch (error) {
    if (isFeatureSurfaceMissing(error, config.featureRoot)) return undefined;
    throw error;
  }
}

function runOptionalSqlLint(context: ProjectCheckContext): LintResult | undefined {
  const roots = context.sqlRoots.filter((root) => root.files.length > 0);
  if (roots.length === 0) {
    return undefined;
  }
  const filesByPath = new Map<string, LintResult['files'][number]>();
  for (const root of roots) {
    for (const file of runLint(root.configured, { rootDir: context.rootDir }).files) {
      filesByPath.set(file.file, file);
    }
  }
  const files = [...filesByPath.values()].sort((left, right) => left.file.localeCompare(right.file));
  return {
    rootDir: context.rootDir,
    target: context.config.sqlRoots.join(','),
    files,
    ok: files.every((file) => file.ok),
  };
}

function insertColumnOwnershipIssues(context: ProjectCheckContext): ProjectCheckIssue[] {
  if (context.sqlFiles.length === 0 || context.ddlSchema.tables.size === 0) {
    return [];
  }

  const issues: ProjectCheckIssue[] = [];
  for (const file of context.sqlFiles) {
    const relativeFile = normalizePath(path.relative(context.rootDir, file));
    let statements: string[];
    try {
      statements = MultiQuerySplitter.split(readFileSync(file, 'utf8')).getNonEmpty().map((query) => query.sql);
    } catch (error) {
      issues.push({
        code: 'ASHIBA_PROJECT_SQL_SPLIT_FAILED',
        severity: 'error',
        message: `SQL file could not be split while checking INSERT ownership: ${relativeFile}.`,
        file: relativeFile,
        nextAction: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    for (const statement of statements) {
      let parsed: ReturnType<typeof SqlParser.parse>;
      try {
        parsed = SqlParser.parse(statement);
      } catch {
        continue;
      }
      if (!(parsed instanceof InsertQuery)) {
        continue;
      }
      const target = tableTargetFromSource(parsed.insertClause.source);
      if (!target) {
        continue;
      }
      const table = resolveTable(context.ddlSchema, target.schema, target.table);
      const insertColumns = parsed.insertClause.columns?.map((column) => normalizeIdentifier(column.name));
      if (!table || !insertColumns) {
        continue;
      }
      const written = new Set(insertColumns.map((column) => column.toLowerCase()));
      for (const column of table.columns.values()) {
        if (written.has(column.name.toLowerCase()) || isGeneratedInsertColumn(column)) {
          continue;
        }
        if (!column.nullable && column.defaultValue == null) {
          issues.push({
            code: 'ASHIBA_PROJECT_INSERT_REQUIRED_COLUMN_OMITTED',
            severity: 'error',
            message: `INSERT omits required DDL column ${table.canonicalName}.${column.name}.`,
            file: relativeFile,
            table: table.canonicalName,
            column: column.name,
            nextAction: 'Add the column to the INSERT, add an explicit DDL default if the database owns it, or make the column nullable intentionally.',
          });
        } else if (column.defaultValue != null) {
          issues.push({
            code: 'ASHIBA_PROJECT_INSERT_DEFAULT_COLUMN_OMITTED',
            severity: 'warning',
            message: `INSERT omits defaulted DDL column ${table.canonicalName}.${column.name}; the database default will be used implicitly.`,
            file: relativeFile,
            table: table.canonicalName,
            column: column.name,
            nextAction: 'Keep the omission if the database default is intentional, or add the column to the INSERT so ownership is explicit.',
          });
        } else if (column.nullable) {
          issues.push({
            code: 'ASHIBA_PROJECT_INSERT_NULLABLE_COLUMN_OMITTED',
            severity: 'warning',
            message: `INSERT omits nullable DDL column ${table.canonicalName}.${column.name}; NULL ownership is implicit.`,
            file: relativeFile,
            table: table.canonicalName,
            column: column.name,
            nextAction: 'Keep the omission if NULL is intentional, or add the column to the INSERT to make the feature-owned value explicit.',
          });
        }
      }
    }
  }
  return dedupeIssues(issues);
}

function buildProjectCheckContext(
  rootDir: string,
  config: ProjectPathConfig,
  ddlSchema: DdlSchemaDiagnosticsResult,
): ProjectCheckContext {
  const sqlRoots = config.sqlRoots
    .map((root) => {
      const absolute = path.join(rootDir, root);
      return {
        configured: root,
        absolute,
        files: existsSync(absolute) ? collectSqlFiles(absolute) : [],
      };
    });
  return {
    rootDir,
    config,
    ddlSchema,
    sqlRoots,
    sqlFiles: uniqueSorted(sqlRoots.flatMap((root) => root.files)),
  };
}

function measurePhase<T>(timings: ProjectCheckResult['timings'], phase: string, run: () => T): T {
  const startedAt = performance.now();
  try {
    return run();
  } finally {
    timings.push({ phase, durationMs: roundDuration(performance.now() - startedAt) });
  }
}

function roundDuration(value: number): number {
  return Math.round(value * 10) / 10;
}

function contractIssues(result: CheckContractResult): ProjectCheckIssue[] {
  if (result.ok) return [];
  const issues: ProjectCheckIssue[] = [];
  if (!result.mapperCheck.ok) {
    issues.push({
      code: 'ASHIBA_PROJECT_CONTRACT_MAPPER_FAILED',
      severity: 'error',
      message: 'Visible SQL and editable query mapper contracts are out of sync.',
      nextAction: 'Update query.ts contracts or refresh generated metadata, then rerun ashiba project check.',
    });
  }
  if (!result.catalogCheck.ok) {
    issues.push({
      code: 'ASHIBA_PROJECT_CONTRACT_CATALOG_FAILED',
      severity: 'error',
      message: 'QuerySpec-like catalog contracts are out of sync with visible SQL.',
      nextAction: 'Fix QuerySpec/catalog entries or regenerate model metadata, then rerun ashiba project check.',
    });
  }
  return issues;
}

function featureTestsIssues(result: FeatureTestsCheckResult): ProjectCheckIssue[] {
  const issues: ProjectCheckIssue[] = [];
  for (const entry of result.checked) {
    for (const issue of entry.issues) {
      issues.push({
        code: 'ASHIBA_PROJECT_FEATURE_TESTS_FAILED',
        severity: 'error',
        message: issue,
        file: `src/features/${entry.feature}/queries/${entry.query}`,
        nextAction: 'Run ashiba feature tests check --fix or update generated mapping tests intentionally.',
      });
    }
  }
  return issues;
}

function generatedMapperIssues(result: FeatureGeneratedMapperCheckResult): ProjectCheckIssue[] {
  const issues: ProjectCheckIssue[] = [];
  for (const entry of result.checked) {
    if (entry.warningParameterTypeMismatches.length > 0 || entry.warningParameterTypeConflicts.length > 0) {
      issues.push({
        code: 'ASHIBA_PROJECT_GENERATED_MAPPER_TYPE_INFERENCE_WARNING',
        severity: 'warning',
        message: `DDL-backed parameter type inference is not certain in ${entry.feature}/${entry.query}.`,
        file: entry.queryFile,
        nextAction: [
          ...entry.warningParameterTypeMismatches,
          ...entry.warningParameterTypeConflicts,
        ].join('; '),
      });
    }
    if (
      entry.missingInMapper.length === 0 &&
      entry.unusedInMapper.length === 0 &&
      entry.mismatchedParameterTypes.length === 0 &&
      entry.parameterTypeConflicts.length === 0 &&
      entry.missingResultInMapper.length === 0 &&
      entry.unusedResultInMapper.length === 0
    ) {
      continue;
    }
    issues.push({
      code: 'ASHIBA_PROJECT_GENERATED_MAPPER_DRIFT',
      severity: 'error',
      message: `Generated mapper contract drift found in ${entry.feature}/${entry.query}.`,
      file: entry.queryFile,
      nextAction: 'Update editable mapper parameters, parameter types, or result columns to match visible SQL and DDL ownership.',
    });
  }
  return issues;
}

function lintIssues(result: LintResult): ProjectCheckIssue[] {
  const issues: ProjectCheckIssue[] = [];
  for (const file of result.files) {
    if (file.ok) continue;
    issues.push({
      code: 'ASHIBA_PROJECT_SQL_LINT_FAILED',
      severity: 'error',
      message: `SQL lint failed for ${file.file}.`,
      file: file.file,
      nextAction: file.output.trim(),
    });
  }
  return issues;
}

function appendIssues(errors: ProjectCheckIssue[], warnings: ProjectCheckIssue[], issues: ProjectCheckIssue[]): void {
  for (const issue of issues) {
    if (issue.severity === 'warning') warnings.push(issue);
    else errors.push(issue);
  }
}

function checkExecutionIssue(code: string, message: string, error: unknown): ProjectCheckIssue {
  return {
    code,
    severity: 'error',
    message,
    nextAction: error instanceof Error ? error.message : String(error),
  };
}

function resolveTable(model: DdlSchemaDiagnosticsResult, schema: string | undefined, table: string): DdlSchemaTable | undefined {
  const normalizedTable = normalizeIdentifier(table).toLowerCase();
  if (schema) {
    return model.tables.get(`${normalizeIdentifier(schema).toLowerCase()}.${normalizedTable}`);
  }
  return model.tables.get(`public.${normalizedTable}`)
    ?? [...model.tables.values()].find((candidate) => candidate.name.toLowerCase() === normalizedTable);
}

function tableTargetFromSource(source: SourceExpression | null | undefined): { schema?: string; table: string } | undefined {
  if (!source || !(source.datasource instanceof TableSource)) return undefined;
  const [schema, table] = splitQualifiedName(source.datasource.qualifiedName.toString());
  return { schema, table };
}

function splitQualifiedName(value: string): [string | undefined, string] {
  const segments = splitUnquotedQualifiedSegments(value).map((segment) => normalizeIdentifier(segment));
  if (segments.length <= 1) {
    return [undefined, segments[0] ?? ''];
  }
  return [segments[segments.length - 2], segments[segments.length - 1] ?? ''];
}

function isGeneratedInsertColumn(column: DdlSchemaColumn): boolean {
  if (column.generated) return true;
  if (!column.primaryKey) return false;
  return /^(smallserial|serial|serial2|serial4|bigserial|serial8)$/i.test(column.typeName)
    || /^nextval\s*\(/i.test(column.defaultValue ?? '');
}

function dedupeIssues(issues: ProjectCheckIssue[]): ProjectCheckIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = [issue.code, issue.file, issue.table, issue.column, issue.message].join(':');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectSqlFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...collectSqlFiles(fullPath));
    } else if (stat.isFile() && entry.toLowerCase().endsWith('.sql')) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function isFeatureSurfaceMissing(error: unknown, featureRoot: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('No feature query boundaries were discovered')
    || message.includes('No feature query test boundaries were discovered')
    || message.includes(`No ${featureRoot} directory was discovered`)
    || message.includes('No feature boundary directory was discovered');
}

function formatIssue(issue: ProjectCheckIssue): string {
  const parts = [`- [${issue.severity}] ${issue.code}: ${issue.message}`];
  if (issue.file) parts.push(`  file: ${issue.file}`);
  if (issue.table) parts.push(`  table: ${issue.table}`);
  if (issue.column) parts.push(`  column: ${issue.column}`);
  if (issue.nextAction) parts.push(`  next: ${issue.nextAction}`);
  return parts.join('\n');
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}

function normalizeIdentifier(value: string): string {
  return value.trim().replace(/^"/, '').replace(/"$/, '');
}

function splitUnquotedQualifiedSegments(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  for (const char of value) {
    if (char === '"') {
      quoted = !quoted;
    }
    if (char === '.' && !quoted) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}
