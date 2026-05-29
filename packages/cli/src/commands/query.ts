import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Command } from 'commander';
import {
  buildQueryLintReport,
  buildQuerySliceReport,
  buildQueryStructureReport,
  addOptionalCondition,
  normalizeOptionalConditionBranchKind,
  refreshOptionalConditions,
  removeOptionalCondition,
  buildQueryUsageReport,
  formatQueryLintReport,
  formatQueryStructureReport,
  formatQueryUsageReport,
} from '../sqlgrep/index.js';
import { invalidCliInputError, requiredCliValueError } from '../errors.js';
import type {
  SssqlRemoveSpec as OptionalConditionRemoveSpec,
  SssqlScaffoldSpec as OptionalConditionScaffoldSpec,
} from 'rawsql-ts';
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

export interface QueryStructureOptions {
  format?: 'text' | 'json' | 'dot';
}

export interface QuerySliceOptions {
  cte?: string;
  final?: boolean;
  limit?: string;
}

export interface QueryLintOptions {
  format?: 'text' | 'json';
  rootDir?: string;
  rules?: string;
}

export interface QueryOptionalOptions {
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
 * Registers SQL inspection, optional-condition, and usage-analysis commands.
 */
export function registerQueryCommand(program: Command): void {
  const query = program
    .command('query')
    .description('Impact investigation for SQL assets and QuerySpec-like catalogs')
    .addHelpText('after', `
Use cases:
  uses table/column  Estimate impact before changing schema objects.
  outline/graph      Understand CTE-heavy SQL before editing it.
  slice              Run a smaller CTE debug query in a SQL client.
  optional add       Add an SSSQL optional search condition and refresh metadata.
  lint               Catch hard-to-review query shapes before review.
`);

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
    .description('Extract a runnable CTE debug slice to find where a complex WITH query breaks')
    .option('--cte <name>', 'Slice a specific CTE into a standalone debug query')
    .option('--final', 'Slice the final query while removing unused CTEs')
    .option('--limit <count>', 'Add LIMIT to the emitted debug query when supported')
    .action((sqlFile: string, options: QuerySliceOptions) => {
      process.stdout.write(runQuerySlice(sqlFile, options));
    });

  const optional = query
    .command('optional')
    .description('Generate and refresh SSSQL optional search condition scaffolds')
    .addHelpText('after', `
SSSQL notation:
  Ashiba's name for optional-search SQL that stays valid SQL, such as
  (:email is null or users.email = :email).

Guide:
  https://mk3008.github.io/ashiba/guide/sssql

Use cases:
  add      Add an explicit optional search condition to a SQL file and refresh metadata.
  refresh  Rebuild metadata after SQL-only edits.
  remove   Remove a supported optional search condition and refresh metadata.
`);

  optional
    .command('add <sqlFile>')
    .description('Add optional search condition branches near the closest source query')
    .option('--format <format>', 'Output format: text or json', 'text')
    .option('--filter <name>', 'Target column for scalar scaffold, or primary anchor column for EXISTS/NOT EXISTS')
    .option('--parameter <name>', 'Explicit parameter name for structured optional-condition scaffold')
    .option('--operator <operator>', 'Scalar operator')
    .option('--kind <kind>', 'Structured branch kind: scalar, exists, or not-exists')
    .option('--query <sql>', 'Subquery SQL for EXISTS/NOT EXISTS scaffold')
    .option('--query-file <path>', 'Read subquery SQL for EXISTS/NOT EXISTS scaffold from a file')
    .option('--anchor-column <names>', 'Comma-separated anchor columns used by $c0, $c1 placeholders')
    .option('--root-dir <path>', 'Project root for query metadata refresh', process.cwd())
    .option('--ddl-dir <path>', 'Optional DDL directory for static row type hints')
    .option('--preview', 'Emit a unified diff without writing files')
    .option('--out <path>', 'Write output to file')
    .action((sqlFile: string, options: QueryOptionalOptions) => {
      process.stdout.write(runQueryOptionalAdd(sqlFile, options));
    });

  optional
    .command('refresh <sqlFile>')
    .description('Refresh existing optional search condition scaffolds without changing predicate meaning')
    .option('--format <format>', 'Output format: text or json', 'text')
    .option('--preview', 'Emit a unified diff without writing files')
    .option('--out <path>', 'Write output to file')
    .action((sqlFile: string, options: QueryOptionalOptions) => {
      process.stdout.write(runQueryOptionalRefresh(sqlFile, options));
    });

  optional
    .command('remove <sqlFile>')
    .description('Remove one supported optional search condition branch safely')
    .option('--format <format>', 'Output format: text or json', 'text')
    .option('--all', 'Remove all recognized optional condition branches in the query')
    .option('--parameter <name>', 'Parameter name that identifies the target branch')
    .option('--kind <kind>', 'Optional branch kind filter')
    .option('--operator <operator>', 'Optional scalar operator filter')
    .option('--target <target>', 'Optional target column filter')
    .option('--preview', 'Emit a unified diff without writing files')
    .option('--out <path>', 'Write output to file')
    .action((sqlFile: string, options: QueryOptionalOptions) => {
      process.stdout.write(runQueryOptionalRemove(sqlFile, options));
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
 * Adds optional-condition branches and formats the CLI report.
 */
export function runQueryOptionalAdd(sqlFile: string, options: QueryOptionalOptions = {}): string {
  const report = addOptionalCondition(sqlFile, {
    out: options.out,
    preview: Boolean(options.preview),
    spec: buildOptionalConditionScaffoldSpec(options),
    filters: buildOptionalConditionFilters(options),
  });
  refreshOptionalConditionQueryMetadata(report, options);
  return formatOptionalConditionRewriteReport(report, options.format ?? 'text');
}

/**
 * Refreshes existing optional-condition branches and generated query metadata.
 */
export function runQueryOptionalRefresh(sqlFile: string, options: QueryOptionalOptions = {}): string {
  const report = refreshOptionalConditions(sqlFile, {
    out: options.out,
    preview: Boolean(options.preview),
  });
  refreshOptionalConditionQueryMetadata(report, options);
  return formatOptionalConditionRewriteReport(report, options.format ?? 'text');
}

/**
 * Removes optional-condition branches and refreshes generated query metadata.
 */
export function runQueryOptionalRemove(sqlFile: string, options: QueryOptionalOptions = {}): string {
  const report = removeOptionalCondition(sqlFile, {
    out: options.out,
    preview: Boolean(options.preview),
    all: Boolean(options.all),
    spec: Boolean(options.all) ? undefined : buildOptionalConditionRemoveSpec(options),
  });
  refreshOptionalConditionQueryMetadata(report, options);
  return formatOptionalConditionRewriteReport(report, options.format ?? 'text');
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

function buildOptionalConditionFilters(options: QueryOptionalOptions): Record<string, null> | undefined {
  if (buildOptionalConditionScaffoldSpec(options)) {
    return undefined;
  }
  return options.filter ? { [options.filter]: null } : {};
}

function buildOptionalConditionScaffoldSpec(options: QueryOptionalOptions): OptionalConditionScaffoldSpec | undefined {
  const kind = options.kind?.trim().toLowerCase();
  if (kind && kind !== 'scalar' && kind !== 'exists' && kind !== 'not-exists') {
    throw invalidCliInputError(
      'ASHIBA_QUERY_OPTIONAL_BRANCH_KIND_UNSUPPORTED',
      `Unsupported optional-condition branch kind: ${options.kind}.`,
      'Use scalar, exists, or not-exists as the optional-condition branch kind.',
      { value: options.kind, supported: ['scalar', 'exists', 'not-exists'] },
    );
  }
  const query = resolveOptionalConditionSubqueryInput(options.query, options.queryFile);
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
  } as OptionalConditionScaffoldSpec;
}

function buildOptionalConditionRemoveSpec(options: QueryOptionalOptions): OptionalConditionRemoveSpec {
  return {
    parameterName: requireOption(options.parameter, '--parameter'),
    kind: options.kind ? normalizeOptionalConditionBranchKind(options.kind.trim().toLowerCase()) : undefined,
    operator: options.operator as OptionalConditionRemoveSpec['operator'],
    target: options.target,
  };
}

function refreshOptionalConditionQueryMetadata(
  report: { output_file: string; preview: boolean },
  options: QueryOptionalOptions,
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
  const analysis = analyzeQueryModel(sql, parameters, resultColumnContracts, { optionalConditionCompression: true });
  const queryModel = {
    analysis,
    bindings: {
      postgres: {
        sourceHash: analysis.sourceHash,
        ...postgres,
        ...buildPostgresSafeSortBindingMetadata(sql, analysis.safeSort),
        ...buildPostgresOptionalConditionCompressionBindingMetadata(sql, analysis.optionalConditionCompression),
      },
    },
  };
  const metadataPath = path.join(path.dirname(sqlPath), 'generated', 'query.meta.ts');
  mkdirSync(path.dirname(metadataPath), { recursive: true });
  writeFileSync(metadataPath, [
    '// Generated by Ashiba. Do not edit by hand.',
    '// Refresh with `ashiba query optional add|refresh|remove` or `ashiba feature query refresh` after SQL-only edits.',
    `export const queryModel = ${JSON.stringify(queryModel, null, 2)} as const;`,
    '',
  ].join('\n'), 'utf8');
}

function resolveOptionalConditionSubqueryInput(sqlText: string | undefined, sqlFile: string | undefined): string | undefined {
  if (sqlText && sqlFile) {
    throw invalidCliInputError(
      'ASHIBA_QUERY_OPTIONAL_INPUT_CONFLICT',
      'Use either --query or --query-file, not both.',
      'Choose one optional-condition subquery input source and rerun the command.',
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

function formatOptionalConditionRewriteReport(report: { commandName: string; file: string; output_file: string; preview: boolean; changed: boolean; written: boolean; sql: string; diff: string }, formatValue: string): string {
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
