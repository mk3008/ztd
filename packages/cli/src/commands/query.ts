import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Command } from 'commander';
import {
  buildObservedSqlMatchReport,
  buildQueryLintReport,
  buildQueryPipelinePlan,
  buildQuerySliceReport,
  buildQueryStructureReport,
  applyQueryPatch,
  addSssql,
  listSssqlBranches,
  normalizeSssqlBranchKind,
  refreshSssql,
  removeSssql,
  buildQueryUsageReport,
  formatObservedSqlMatchReport,
  formatQueryLintReport,
  formatQueryPipelinePlan,
  formatQueryStructureReport,
  formatQueryUsageReport,
} from '../sqlgrep/index.js';
import { invalidCliInputError, requiredCliValueError } from '../errors.js';
import type { SssqlRemoveSpec, SssqlScaffoldSpec } from 'rawsql-ts';
import { compileNamedParameters } from '../parameter-metadata.js';
import {
  analyzeQueryModel,
  buildPostgresOptionalConditionCompressionBindingMetadata,
  buildPostgresSafeSortBindingMetadata,
  buildQueryResultColumnContracts,
} from './model-gen.js';

export interface QueryUsesOptions {
  format?: 'text' | 'json';
  view?: 'impact' | 'detail';
  rootDir?: string;
  scopeDir?: string;
  sqlRoot?: string;
  excludeGenerated?: boolean;
  anySchema?: boolean;
  anyTable?: boolean;
  allowParserFallback?: boolean;
}

export interface QueryMatchObservedOptions {
  format?: 'text' | 'json';
  rootDir?: string;
  sql?: string;
  sqlFile?: string;
}

export interface QueryStructureOptions {
  format?: 'text' | 'json' | 'dot';
}

export interface QuerySliceOptions {
  cte?: string;
  final?: boolean;
  limit?: string;
}

export interface QueryPlanOptions {
  format?: 'text' | 'json';
  material?: string;
  scalarFilterColumn?: string;
}

export interface QueryLintOptions {
  format?: 'text' | 'json';
  rootDir?: string;
  rules?: string;
}

export interface QueryPatchApplyOptions {
  cte?: string;
  from?: string;
  out?: string;
  preview?: boolean;
  format?: 'text' | 'json';
}

export interface QuerySssqlOptions {
  format?: 'text' | 'json';
  out?: string;
  preview?: boolean;
  filter?: string;
  parameter?: string;
  operator?: string;
  kind?: string;
  query?: string;
  queryFile?: string;
  anchorColumn?: string;
  all?: boolean;
  target?: string;
  rootDir?: string;
  ddlDir?: string;
}

/**
 * Registers SQL inspection, patching, SSSQL, and usage-analysis commands.
 */
export function registerQueryCommand(program: Command): void {
  const query = program
    .command('query')
    .description('Impact investigation for SQL assets and QuerySpec-like catalogs');

  const uses = query.command('uses').description('Find where SQL assets use a table or column target');

  uses
    .command('table <target>')
    .description('Find statements that use a table target')
    .option('--format <format>', 'Output format: text or json', 'text')
    .option('--view <view>', 'Investigation view: impact or detail', 'impact')
    .option('--root-dir <path>', 'Project root to scan', process.cwd())
    .option('--scope-dir <path>', 'Limit discovery to one QuerySpec subtree')
    .option('--sql-root <path>', 'Fallback root for shared sqlFile layouts')
    .option('--exclude-generated', 'Exclude QuerySpec files under generated directories')
    .option('--any-schema', 'Allow <table> lookup across schemas')
    .option('--allow-parser-fallback', 'Allow explicit regex fallback when AST parsing fails for table usage')
    .action((target: string, options: QueryUsesOptions) => {
      process.stdout.write(runQueryUses('table', target, options));
    });

  uses
    .command('column <target>')
    .description('Find statements that use a column target')
    .option('--format <format>', 'Output format: text or json', 'text')
    .option('--view <view>', 'Investigation view: impact or detail', 'impact')
    .option('--root-dir <path>', 'Project root to scan', process.cwd())
    .option('--scope-dir <path>', 'Limit discovery to one QuerySpec subtree')
    .option('--sql-root <path>', 'Fallback root for shared sqlFile layouts')
    .option('--exclude-generated', 'Exclude QuerySpec files under generated directories')
    .option('--any-schema', 'Allow <table.column> or <column> lookup across schemas')
    .option('--any-table', 'Allow <column> lookup across tables; requires --any-schema')
    .option('--allow-parser-fallback', 'Allow explicit parser-failure diagnostics instead of failing the command')
    .action((target: string, options: QueryUsesOptions) => {
      process.stdout.write(runQueryUses('column', target, options));
    });

  query
    .command('outline <sqlFile>')
    .description('Summarize query structure, CTE dependencies, and base table usage')
    .option('--format <format>', 'Output format: text or json', 'text')
    .action((sqlFile: string, options: QueryStructureOptions) => {
      process.stdout.write(runQueryStructure(sqlFile, { ...options, format: normalizeStructureFormat(options.format ?? 'text', false) }));
    });

  query
    .command('graph <sqlFile>')
    .description('Emit the query dependency graph in text, JSON, or DOT form')
    .option('--format <format>', 'Output format: text, json, or dot', 'text')
    .action((sqlFile: string, options: QueryStructureOptions) => {
      process.stdout.write(runQueryStructure(sqlFile, { ...options, format: normalizeStructureFormat(options.format ?? 'text', true) }));
    });

  query
    .command('slice <sqlFile>')
    .description('Generate a minimal executable SQL slice for a target CTE or the final query')
    .option('--cte <name>', 'Slice a specific CTE into a standalone debug query')
    .option('--final', 'Slice the final query while removing unused CTEs')
    .option('--limit <count>', 'Add LIMIT to the emitted debug query when supported')
    .action((sqlFile: string, options: QuerySliceOptions) => {
      process.stdout.write(runQuerySlice(sqlFile, options));
    });

  query
    .command('plan <sqlFile>')
    .description('Emit deterministic execution steps from CTE metadata')
    .option('--format <format>', 'Output format: text or json', 'text')
    .option('--material <names>', 'Comma-separated CTE names to materialize')
    .option('--scalar-filter-column <names>', 'Comma-separated column names to bind from WHERE scalar filters')
    .action((sqlFile: string, options: QueryPlanOptions) => {
      process.stdout.write(runQueryPlan(sqlFile, options));
    });

  const sssql = query
    .command('sssql')
    .description('Generate and refresh SQL-first optional filter scaffolds');

  sssql
    .command('list <sqlFile>')
    .description('List supported SSSQL optional branches discovered in the query')
    .option('--format <format>', 'Output format: text or json', 'text')
    .action((sqlFile: string, options: QuerySssqlOptions) => {
      process.stdout.write(runQuerySssqlList(sqlFile, options));
    });

  sssql
    .command('add <sqlFile>')
    .description('Add SSSQL optional filter branches near the closest source query')
    .option('--format <format>', 'Output format: text or json', 'text')
    .option('--filter <name>', 'Target column for scalar scaffold, or primary anchor column for EXISTS/NOT EXISTS')
    .option('--parameter <name>', 'Explicit parameter name for structured SSSQL scaffold')
    .option('--operator <operator>', 'Scalar operator')
    .option('--kind <kind>', 'Structured branch kind: scalar, exists, or not-exists')
    .option('--query <sql>', 'Subquery SQL for EXISTS/NOT EXISTS scaffold')
    .option('--query-file <path>', 'Read subquery SQL for EXISTS/NOT EXISTS scaffold from a file')
    .option('--anchor-column <names>', 'Comma-separated anchor columns used by $c0, $c1 placeholders')
    .option('--root-dir <path>', 'Project root for query metadata refresh', process.cwd())
    .option('--ddl-dir <path>', 'Optional DDL directory for static row type hints')
    .option('--preview', 'Emit a unified diff without writing files')
    .option('--out <path>', 'Write output to file')
    .action((sqlFile: string, options: QuerySssqlOptions) => {
      process.stdout.write(runQuerySssqlAdd(sqlFile, options));
    });

  sssql
    .command('refresh <sqlFile>')
    .description('Refresh existing SSSQL optional filter scaffolds without changing predicate meaning')
    .option('--format <format>', 'Output format: text or json', 'text')
    .option('--preview', 'Emit a unified diff without writing files')
    .option('--out <path>', 'Write output to file')
    .action((sqlFile: string, options: QuerySssqlOptions) => {
      process.stdout.write(runQuerySssqlRefresh(sqlFile, options));
    });

  sssql
    .command('remove <sqlFile>')
    .description('Remove one supported SSSQL optional filter branch safely')
    .option('--format <format>', 'Output format: text or json', 'text')
    .option('--all', 'Remove all recognized SSSQL branches in the query')
    .option('--parameter <name>', 'Parameter name that identifies the target branch')
    .option('--kind <kind>', 'Optional branch kind filter')
    .option('--operator <operator>', 'Optional scalar operator filter')
    .option('--target <target>', 'Optional target column filter')
    .option('--preview', 'Emit a unified diff without writing files')
    .option('--out <path>', 'Write output to file')
    .action((sqlFile: string, options: QuerySssqlOptions) => {
      process.stdout.write(runQuerySssqlRemove(sqlFile, options));
    });

  query
    .command('patch')
    .description('Apply AI-edited SQL fragments back onto the original query safely')
    .command('apply <sqlFile>')
    .description('Replace one CTE in the original SQL with the matching definition from an edited SQL file')
    .requiredOption('--cte <name>', 'Target CTE name to replace in the original query')
    .requiredOption('--from <path>', 'Edited SQL file that contains the replacement CTE definition')
    .option('--out <path>', 'Write the patched SQL to a new file instead of overwriting the original')
    .option('--preview', 'Emit a unified diff without writing files')
    .option('--format <format>', 'Output format: text or json', 'text')
    .action((sqlFile: string, options: QueryPatchApplyOptions) => {
      process.stdout.write(runQueryPatchApply(sqlFile, options));
    });

  query
    .command('lint <sqlFile>')
    .description('Report structural maintainability and analysis-safety issues in a SQL query')
    .option('--format <format>', 'Output format: text or json', 'text')
    .option('--root-dir <path>', 'Project root for config and DDL-aware rules', process.cwd())
    .option('--rules <list>', 'Comma-separated lint rules to enable, for example: join-direction')
    .action((sqlFile: string, options: QueryLintOptions) => {
      process.stdout.write(runQueryLint(sqlFile, options));
    });

  query
    .command('match-observed')
    .description('Rank candidate SQL assets for an observed SELECT statement')
    .option('--sql <sql>', 'Observed SQL text to rank')
    .option('--sql-file <path>', 'Read observed SQL text from a file')
    .option('--root-dir <path>', 'Project root to scan', process.cwd())
    .option('--format <format>', 'Output format: text or json', 'text')
    .action((options: QueryMatchObservedOptions) => {
      process.stdout.write(runQueryMatchObserved(options));
    });
}

/**
 * Builds a formatted structural outline for a visible SQL file.
 */
export function runQueryStructure(sqlFile: string, options: QueryStructureOptions = {}): string {
  const format = normalizeStructureFormat(options.format ?? 'text', true);
  return formatQueryStructureReport(buildQueryStructureReport(sqlFile, 'ashiba query outline'), format);
}

/**
 * Builds a formatted query slice report for a selected CTE or dependency path.
 */
export function runQuerySlice(sqlFile: string, options: QuerySliceOptions): string {
  return buildQuerySliceReport(sqlFile, {
    cte: options.cte,
    final: Boolean(options.final),
    limit: normalizePositiveInteger(options.limit, '--limit'),
  }).sql;
}

/**
 * Builds a formatted query pipeline plan from a visible SQL file.
 */
export function runQueryPlan(sqlFile: string, options: QueryPlanOptions = {}): string {
  const format = normalizeFormat(options.format ?? 'text');
  const plan = buildQueryPipelinePlan(sqlFile, {
    material: normalizeCommaList(options.material),
    scalarFilterColumns: normalizeCommaList(options.scalarFilterColumn),
  });
  return formatQueryPipelinePlan(plan, format);
}

/**
 * Runs query lint rules and formats the resulting report.
 */
export function runQueryLint(sqlFile: string, options: QueryLintOptions = {}): string {
  const format = normalizeFormat(options.format ?? 'text');
  const report = buildQueryLintReport(sqlFile, {
    projectRoot: options.rootDir ?? process.cwd(),
    rules: normalizeLintRules(options.rules),
  });
  return formatQueryLintReport(report, format);
}

/**
 * Applies a supported development-time query patch and formats the patch report.
 */
export function runQueryPatchApply(sqlFile: string, options: QueryPatchApplyOptions): string {
  if (!options.cte) {
    throw requiredCliValueError('--cte');
  }
  if (!options.from) {
    throw requiredCliValueError('--from');
  }

  const report = applyQueryPatch(sqlFile, {
    cte: options.cte,
    from: options.from,
    out: options.out,
    preview: Boolean(options.preview),
  });

  if (normalizeFormat(options.format ?? 'text') === 'json') {
    return `${JSON.stringify({
      command: 'query patch apply',
      file: report.file,
      edited_file: report.edited_file,
      target_cte: report.target_cte,
      preview: report.preview,
      changed: report.changed,
      written: report.written,
      output_file: report.output_file,
      diff: report.diff,
      updated_sql: report.updated_sql,
    }, null, 2)}\n`;
  }

  if (report.preview) {
    return report.diff.endsWith('\n') ? report.diff : `${report.diff}\n`;
  }

  return [
    `Patched CTE: ${report.target_cte}`,
    `Edited SQL: ${report.edited_file}`,
    `Output file: ${report.output_file}`,
    `Changed: ${report.changed ? 'yes' : 'no'}`,
    '',
  ].join('\n');
}

/**
 * Lists supported SSSQL optional-condition branches in a visible SQL file.
 */
export function runQuerySssqlList(sqlFile: string, options: QuerySssqlOptions = {}): string {
  const format = normalizeFormat(options.format ?? 'text');
  const branches = listSssqlBranches(sqlFile);
  if (format === 'json') {
    return `${JSON.stringify({ command: 'query sssql list', file: sqlFile, branch_count: branches.length, branches }, null, 2)}\n`;
  }
  if (branches.length === 0) {
    return 'No supported SSSQL branches found.\n';
  }
  return `${branches.map((branch, index) => `${index + 1}. parameter: ${branch.parameterName}\n   kind: ${branch.kind}\n   target: ${branch.target ?? '(none)'}`).join('\n')}\n`;
}

/**
 * Adds SSSQL optional-condition branches and formats the CLI report.
 */
export function runQuerySssqlAdd(sqlFile: string, options: QuerySssqlOptions = {}): string {
  const report = addSssql(sqlFile, {
    out: options.out,
    preview: Boolean(options.preview),
    spec: buildSssqlScaffoldSpec(options),
    filters: buildSssqlFilters(options),
  });
  refreshSssqlQueryMetadata(report, options);
  return formatSssqlRewriteReport(report, options.format ?? 'text');
}

/**
 * Refreshes existing SSSQL optional-condition branches and generated query metadata.
 */
export function runQuerySssqlRefresh(sqlFile: string, options: QuerySssqlOptions = {}): string {
  const report = refreshSssql(sqlFile, {
    out: options.out,
    preview: Boolean(options.preview),
  });
  refreshSssqlQueryMetadata(report, options);
  return formatSssqlRewriteReport(report, options.format ?? 'text');
}

/**
 * Removes SSSQL optional-condition branches and refreshes generated query metadata.
 */
export function runQuerySssqlRemove(sqlFile: string, options: QuerySssqlOptions = {}): string {
  const report = removeSssql(sqlFile, {
    out: options.out,
    preview: Boolean(options.preview),
    all: Boolean(options.all),
    spec: Boolean(options.all) ? undefined : buildSssqlRemoveSpec(options),
  });
  refreshSssqlQueryMetadata(report, options);
  return formatSssqlRewriteReport(report, options.format ?? 'text');
}

/**
 * Finds query usages for a table or column target and formats the report.
 */
export function runQueryUses(kind: 'table' | 'column', target: string, options: QueryUsesOptions): string {
  const format = normalizeFormat(options.format ?? 'text');
  const view = normalizeView(options.view ?? 'impact');
  const report = buildQueryUsageReport({
    kind,
    rawTarget: target,
    rootDir: options.rootDir ?? process.cwd(),
    specsDir: options.scopeDir,
    sqlRoot: options.sqlRoot,
    excludeGenerated: Boolean(options.excludeGenerated),
    anySchema: Boolean(options.anySchema),
    anyTable: Boolean(options.anyTable),
    view,
    allowParserFallback: Boolean(options.allowParserFallback),
  });

  return formatQueryUsageReport(report, format);
}

/**
 * Matches observed runtime SQL against known SQL catalog assets.
 */
export function runQueryMatchObserved(options: QueryMatchObservedOptions): string {
  const format = normalizeFormat(options.format ?? 'text');
  const report = buildObservedSqlMatchReport({
    observedSql: resolveObservedSqlInput(options),
    rootDir: options.rootDir ?? process.cwd(),
  });

  return formatObservedSqlMatchReport(report, format);
}

function resolveObservedSqlInput(options: QueryMatchObservedOptions): string {
  if (options.sql && options.sqlFile) {
    throw invalidCliInputError(
      'ASHIBA_QUERY_OBSERVED_INPUT_CONFLICT',
      'Use either --sql or --sql-file, not both.',
      'Choose one observed SQL input source and rerun the command.',
      { options: ['--sql', '--sql-file'] },
    );
  }
  if (options.sql) {
    return options.sql;
  }
  if (options.sqlFile) {
    return readFileSync(options.sqlFile, 'utf8');
  }
  throw invalidCliInputError(
    'ASHIBA_QUERY_OBSERVED_INPUT_REQUIRED',
    'Provide observed SQL with --sql or --sql-file.',
    'Pass the observed SQL text with --sql, or pass a file path with --sql-file.',
    { options: ['--sql', '--sql-file'] },
  );
}

function normalizeFormat(value: string): 'text' | 'json' {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'text' || normalized === 'json') {
    return normalized;
  }
  throw invalidCliInputError(
    'ASHIBA_UNSUPPORTED_OUTPUT_FORMAT',
    `Unsupported format: ${value}`,
    'Use --format text or --format json.',
    { value, supported: ['text', 'json'] },
  );
}

function normalizeStructureFormat(value: string, allowDot: boolean): 'text' | 'json' | 'dot' {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'text' || normalized === 'json') {
    return normalized;
  }
  if (allowDot && normalized === 'dot') {
    return normalized;
  }
  throw invalidCliInputError(
    'ASHIBA_UNSUPPORTED_OUTPUT_FORMAT',
    `Unsupported format: ${value}`,
    allowDot ? 'Use --format text, --format json, or --format dot.' : 'Use --format text or --format json.',
    { value, supported: allowDot ? ['text', 'json', 'dot'] : ['text', 'json'] },
  );
}

function normalizePositiveInteger(value: string | undefined, label: string): number | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw invalidCliInputError(
      'ASHIBA_POSITIVE_INTEGER_REQUIRED',
      `${label} must be a positive integer.`,
      `Pass ${label} as an integer greater than zero, or omit it to use the default behavior.`,
      { label, value },
    );
  }
  return parsed;
}

function normalizeCommaList(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }
  const result = value.split(',').map((item) => item.trim()).filter(Boolean);
  return result.length > 0 ? result : undefined;
}

function normalizeLintRules(value: string | undefined): Array<'join-direction'> | undefined {
  const values = normalizeCommaList(value);
  if (!values) {
    return undefined;
  }
  for (const rule of values) {
    if (rule !== 'join-direction') {
      throw invalidCliInputError(
        'ASHIBA_UNSUPPORTED_QUERY_LINT_RULE',
        `Unsupported lint rule: ${rule}. Supported rules: join-direction`,
        'Use --rules join-direction or omit --rules.',
        { rule, supported: ['join-direction'] },
      );
    }
  }
  return values as Array<'join-direction'>;
}

function buildSssqlFilters(options: QuerySssqlOptions): Record<string, null> | undefined {
  if (buildSssqlScaffoldSpec(options)) {
    return undefined;
  }
  return options.filter ? { [options.filter]: null } : {};
}

function buildSssqlScaffoldSpec(options: QuerySssqlOptions): SssqlScaffoldSpec | undefined {
  const kind = options.kind?.trim().toLowerCase();
  const query = resolveSssqlSubqueryInput(options.query, options.queryFile);
  if (kind === 'exists' || kind === 'not-exists' || query) {
    return {
      kind: kind === 'not-exists' ? 'not-exists' : 'exists',
      parameterName: requireOption(options.parameter, '--parameter'),
      query: requireOption(query, '--query or --query-file'),
      anchorColumns: normalizeCommaList(options.anchorColumn) ?? [requireOption(options.filter, '--filter')],
    };
  }
  if (!options.filter && !options.parameter && !options.operator && !kind) {
    return undefined;
  }
  return {
    target: requireOption(options.filter, '--filter'),
    parameterName: options.parameter,
    operator: options.operator,
  } as SssqlScaffoldSpec;
}

function buildSssqlRemoveSpec(options: QuerySssqlOptions): SssqlRemoveSpec {
  return {
    parameterName: requireOption(options.parameter, '--parameter'),
    kind: options.kind ? normalizeSssqlBranchKind(options.kind.trim().toLowerCase()) : undefined,
    operator: options.operator as SssqlRemoveSpec['operator'],
    target: options.target,
  };
}

function refreshSssqlQueryMetadata(
  report: { output_file: string; preview: boolean },
  options: QuerySssqlOptions,
): void {
  if (report.preview) {
    return;
  }
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const sqlPath = path.resolve(report.output_file);
  const sql = readFileSync(sqlPath, 'utf8');
  const postgres = compileNamedParameters(sql, { placeholderStyle: 'postgres' });
  const resultColumnContracts = buildQueryResultColumnContracts(sql, rootDir, options.ddlDir);
  const parameters = [...new Set(postgres.orderedNames)];
  const analysis = analyzeQueryModel(sql, parameters, resultColumnContracts, { sssqlCompression: true });
  const queryModel = {
    analysis,
    bindings: {
      postgres: {
        sourceHash: analysis.sourceHash,
        ...postgres,
        ...buildPostgresSafeSortBindingMetadata(sql, analysis.safeSort),
        ...buildPostgresOptionalConditionCompressionBindingMetadata(sql, analysis.sssqlCompression),
      },
    },
  };
  const metadataPath = path.join(path.dirname(sqlPath), 'generated', 'query.meta.ts');
  mkdirSync(path.dirname(metadataPath), { recursive: true });
  writeFileSync(metadataPath, [
    '// Generated by Ashiba. Do not edit by hand.',
    '// Refresh with `ashiba query sssql add|refresh|remove` or `ashiba feature query refresh` after SQL-only edits.',
    `export const queryModel = ${JSON.stringify(queryModel, null, 2)} as const;`,
    '',
  ].join('\n'), 'utf8');
}

function resolveSssqlSubqueryInput(sqlText: string | undefined, sqlFile: string | undefined): string | undefined {
  if (sqlText && sqlFile) {
    throw invalidCliInputError(
      'ASHIBA_QUERY_SSSQL_INPUT_CONFLICT',
      'Use either --query or --query-file, not both.',
      'Choose one SSSQL subquery input source and rerun the command.',
      { options: ['--query', '--query-file'] },
    );
  }
  return sqlText ?? (sqlFile ? readFileSync(sqlFile, 'utf8') : undefined);
}

function requireOption(value: string | undefined, label: string): string {
  if (!value || value.trim().length === 0) {
    throw requiredCliValueError(label);
  }
  return value;
}

function formatSssqlRewriteReport(report: { commandName: string; file: string; output_file: string; preview: boolean; changed: boolean; written: boolean; sql: string; diff: string }, formatValue: string): string {
  const format = normalizeFormat(formatValue);
  if (format === 'json') {
    return `${JSON.stringify(report, null, 2)}\n`;
  }
  if (report.preview) {
    return report.diff.endsWith('\n') ? report.diff : `${report.diff}\n`;
  }
  return [
    `Command: ${report.commandName}`,
    `File: ${report.file}`,
    `Output file: ${report.output_file}`,
    `Changed: ${report.changed ? 'yes' : 'no'}`,
    '',
  ].join('\n');
}

function normalizeView(value: string): 'impact' | 'detail' {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'impact' || normalized === 'detail') {
    return normalized;
  }
  throw invalidCliInputError(
    'ASHIBA_UNSUPPORTED_QUERY_VIEW',
    `Unsupported view: ${value}`,
    'Use --view impact or --view detail.',
    { value, supported: ['impact', 'detail'] },
  );
}
