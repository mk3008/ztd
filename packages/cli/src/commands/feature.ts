import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Command } from 'commander';
import { compileNamedParameters } from '../parameter-metadata.js';
import {
  CreateTableQuery,
  DeleteQuery,
  InsertQuery,
  MultiQuerySplitter,
  RawString,
  SimpleSelectQuery,
  SqlFormatter,
  SqlParser,
  TableSource,
  TypeValue,
  UpdateQuery,
  type ValueComponent,
} from 'rawsql-ts';
import { extractSqlResultColumns } from './sql-result-columns.js';
import {
  analyzeQueryModel,
  buildPostgresOptionalConditionCompressionBindingMetadata,
  buildPostgresSafeSortBindingMetadata,
  buildQueryResultColumnContracts,
  type QueryModelBindings,
} from './model-gen.js';
import { astParseUserError, invalidCliInputError, requiredCliValueError } from '../errors.js';

const FEATURE_SHARED_EXECUTOR_IMPORT_PATH = '#features/_shared/featureQueryExecutor.js';
const FEATURE_SHARED_LOAD_SQL_RESOURCE_IMPORT_PATH = '#features/_shared/loadSqlResource.js';
const TEST_ZTD_CASE_TYPES_IMPORT_PATH = '#tests/support/ztd/case-types.js';
const TEST_ZTD_HARNESS_IMPORT_PATH = '#tests/support/ztd/harness.js';

const FEATURE_ACTIONS = ['insert', 'update', 'delete', 'get-by-id', 'list'] as const;
type FeatureAction = (typeof FEATURE_ACTIONS)[number];
const sqlFormatter = new SqlFormatter({ keywordCase: 'lower' });

export interface FeatureScaffoldOptions {
  table?: string;
  action?: string;
  featureName?: string;
  rootDir?: string;
  dryRun?: boolean;
  force?: boolean;
}

export interface FeatureQueryScaffoldOptions {
  table?: string;
  action?: string;
  queryName?: string;
  feature?: string;
  boundaryDir?: string;
  rootDir?: string;
  workingDir?: string;
  dryRun?: boolean;
  force?: boolean;
}

export interface FeatureQueryMetadataRefreshOptions {
  query?: string;
  feature?: string;
  boundaryDir?: string;
  rootDir?: string;
  dryRun?: boolean;
  format?: 'text' | 'json';
}

export interface FeatureTestsScaffoldOptions {
  feature?: string;
  boundaryDir?: string;
  query?: string;
  rootDir?: string;
  dryRun?: boolean;
  force?: boolean;
}

export interface FeatureTestsCheckOptions {
  feature?: string;
  boundaryDir?: string;
  query?: string;
  rootDir?: string;
  fix?: boolean;
  format?: 'text' | 'json';
}

export interface FeatureGeneratedMapperCheckOptions {
  feature?: string;
  boundaryDir?: string;
  query?: string;
  rootDir?: string;
  format?: 'text' | 'json';
}

export interface FeatureScaffoldResult {
  featureName: string;
  queryName: string;
  action: FeatureAction;
  table: string;
  primaryKeyColumn: string;
  dryRun: boolean;
  outputs: Array<{ path: string; written: boolean; kind: 'directory' | 'file' }>;
}

export interface FeatureQueryMetadataRefreshResult {
  rootDir: string;
  featureName: string;
  queryName: string;
  sqlFile: string;
  queryFile: string;
  metadataFile: string;
  dryRun: boolean;
  changed: boolean;
}

export interface FeatureGeneratedMapperCheckResult {
  rootDir: string;
  checked: Array<{
    feature: string;
    query: string;
    sqlFile: string;
    queryFile: string;
    sqlParameters: string[];
    mapperParameters: string[];
    sqlResultColumns: string[];
    mapperResultColumns: string[];
    missingInMapper: string[];
    unusedInMapper: string[];
    missingResultInMapper: string[];
    unusedResultInMapper: string[];
  }>;
  ok: boolean;
}

export interface FeatureTestsCheckResult {
  rootDir: string;
  fixed: boolean;
  checked: Array<{
    feature: string;
    query: string;
    ok: boolean;
    issues: string[];
    fixed: string[];
  }>;
  ok: boolean;
}

interface DdlColumn {
  name: string;
  typeName: string;
  nullable: boolean;
  defaultValue?: string;
  generated: boolean;
  primaryKey: boolean;
}

interface DdlTable {
  schema: string;
  name: string;
  canonicalName: string;
  columns: DdlColumn[];
  primaryKeyColumns: string[];
}

interface RenderField {
  name: string;
  sourceName: string;
  typeScriptType: string;
  parserKind: 'string' | 'number' | 'boolean';
  nullable: boolean;
}

interface GeneratedFile {
  relativePath: string;
  contents?: string;
  kind: 'directory' | 'file';
  overwrite?: boolean;
}

interface QueryTestMetadata {
  feature: string;
  query: string;
  action: FeatureAction;
  table: string;
  primaryKeyColumn: string;
}

interface ResolvedQueryTestMetadata {
  metadata: QueryTestMetadata;
  inferred: boolean;
}

/**
 * Registers feature, query, metadata-refresh, and generated test scaffold commands.
 */
export function registerFeatureCommand(program: Command): void {
  const feature = program.command('feature').description('Scaffold editable feature-local SQL boundaries');
  const query = feature.command('query').description('Add query boundaries to an existing feature');
  const tests = feature.command('tests').description('Scaffold feature-local mapper test files');
  const generatedMapper = feature.command('generated-mapper').description('Check editable generated mapper drift');

  feature
    .command('scaffold')
    .description('Scaffold a feature-local CRUD or SELECT boundary from DDL metadata')
    .requiredOption('--table <table>', 'Target table name')
    .requiredOption('--action <action>', 'Action: insert, update, delete, get-by-id, or list')
    .option('--feature-name <name>', 'Override the derived feature name')
    .option('--root-dir <path>', 'Project root directory', '.')
    .option('--dry-run', 'Print the files that would be created without writing them', false)
    .option('--force', 'Overwrite scaffold-owned files when they already exist', false)
    .action((options: FeatureScaffoldOptions) => {
      process.stdout.write(formatFeatureScaffoldResult('Feature scaffold', runFeatureScaffold(options)));
    });

  query
    .command('scaffold')
    .description('Scaffold one additive query boundary without rewriting parent orchestration')
    .requiredOption('--table <table>', 'Target table name')
    .requiredOption('--action <action>', 'Action: insert, update, delete, get-by-id, or list')
    .requiredOption('--query-name <name>', 'Query boundary name')
    .option('--feature <name>', 'Resolve target as src/features/<feature>')
    .option('--boundary-dir <path>', 'Explicit boundary directory')
    .option('--root-dir <path>', 'Project root directory', '.')
    .option('--dry-run', 'Print the files that would be created without writing them', false)
    .option('--force', 'Overwrite scaffold-owned query files when they already exist', false)
    .action((options: FeatureQueryScaffoldOptions) => {
      process.stdout.write(formatFeatureScaffoldResult('Feature query scaffold', runFeatureQueryScaffold(options)));
    });

  query
    .command('refresh')
    .description('Refresh query model metadata after editing visible SQL')
    .requiredOption('--query <name>', 'Query boundary name under the feature queries directory')
    .option('--feature <name>', 'Resolve target as src/features/<feature>')
    .option('--boundary-dir <path>', 'Explicit boundary directory')
    .option('--root-dir <path>', 'Project root directory', '.')
    .option('--dry-run', 'Print the refresh result without writing generated query metadata', false)
    .option('--format <format>', 'Output format: text or json', 'text')
    .action((options: FeatureQueryMetadataRefreshOptions) => {
      const result = runFeatureQueryMetadataRefresh(options);
      if (options.format === 'json') {
        process.stdout.write(`${JSON.stringify({ kind: 'feature-query-refresh', ...result }, null, 2)}\n`);
        return;
      }
      process.stdout.write(formatFeatureQueryMetadataRefresh(result));
    });

  tests
    .command('scaffold')
    .description('Scaffold editable mapper test files and library-owned generated test schema files')
    .option('--feature <name>', 'Feature name under src/features')
    .option('--boundary-dir <path>', 'Explicit feature boundary directory, including subgrouped boundaries')
    .option('--query <name>', 'Limit scaffolding to one query boundary')
    .option('--root-dir <path>', 'Project root directory', '.')
    .option('--dry-run', 'Print the files that would be created without writing them', false)
    .option('--force', 'Overwrite scaffold-owned test files when they already exist', false)
    .action((options: FeatureTestsScaffoldOptions) => {
      const result = runFeatureTestsScaffold(options);
      process.stdout.write(formatFilePlan('Feature tests scaffold', result.rootDir, result.dryRun, result.outputs));
    });

  tests
    .command('check')
    .description('Detect missing or drifted generated mapping test assets')
    .option('--feature <name>', 'Feature name under src/features')
    .option('--boundary-dir <path>', 'Explicit feature boundary directory, including subgrouped boundaries')
    .option('--query <name>', 'Limit check to one query boundary')
    .option('--root-dir <path>', 'Project root directory', '.')
    .option('--fix', 'Rewrite generated mapping test assets and create missing logic-case stubs', false)
    .option('--format <format>', 'Output format: text or json', 'text')
    .action((options: FeatureTestsCheckOptions) => {
      const result = runFeatureTestsCheck(options);
      if (options.format === 'json') {
        process.stdout.write(`${JSON.stringify({ kind: 'feature-tests-check', ...result }, null, 2)}\n`);
        if (!result.ok) process.exitCode = 1;
        return;
      }
      process.stdout.write(formatFeatureTestsCheck(result));
      if (!result.ok) process.exitCode = 1;
    });

  generatedMapper
    .command('check')
    .description('Check SQL named parameters against editable generated query mapper contracts')
    .option('--feature <name>', 'Limit drift check to one feature under src/features')
    .option('--boundary-dir <path>', 'Limit drift check to one explicit feature boundary directory, including subgrouped boundaries')
    .option('--query <name>', 'Limit drift check to one query boundary')
    .option('--root-dir <path>', 'Project root directory', '.')
    .option('--format <format>', 'Output format: text or json', 'text')
    .action((options: FeatureGeneratedMapperCheckOptions) => {
      const result = runFeatureGeneratedMapperCheck(options);
      if (options.format === 'json') {
        process.stdout.write(`${JSON.stringify({ kind: 'feature-generated-mapper-check', ...result }, null, 2)}\n`);
        if (!result.ok) process.exitCode = 1;
        return;
      }
      process.stdout.write(formatGeneratedMapperCheck(result));
      if (!result.ok) process.exitCode = 1;
    });
}

/**
 * Scaffolds an editable RFBA-style feature boundary from DDL and query metadata.
 */
export function runFeatureScaffold(options: FeatureScaffoldOptions): FeatureScaffoldResult {
  const rootDir = path.resolve(options.rootDir ?? '.');
  const action = normalizeFeatureAction(options.action);
  const table = loadDdlTable(rootDir, requireValue(options.table, '--table'));
  const primaryKeyColumn = resolvePrimaryKeyColumn(table);
  const featureName = normalizeFeatureName(options.featureName ?? `${toKebab(table.name)}-${action}`);
  const queryName = deriveQueryName(table.name, action);
  const files = buildFeatureFiles(rootDir, featureName, queryName, action, table, primaryKeyColumn);
  const outputs = writeGeneratedFiles(rootDir, files, options.dryRun === true, options.force === true);

  return {
    featureName,
    queryName,
    action,
    table: table.canonicalName,
    primaryKeyColumn,
    dryRun: options.dryRun === true,
    outputs,
  };
}

/**
 * Adds a query boundary to an existing feature and generates its metadata.
 */
export function runFeatureQueryScaffold(options: FeatureQueryScaffoldOptions): FeatureScaffoldResult {
  const rootDir = path.resolve(options.rootDir ?? '.');
  const action = normalizeFeatureAction(options.action);
  const table = loadDdlTable(rootDir, requireValue(options.table, '--table'));
  const primaryKeyColumn = resolvePrimaryKeyColumn(table);
  const queryName = normalizeQueryName(options.queryName);
  const boundaryDir = resolveBoundaryDir(rootDir, options);
  const relativeBoundary = toProjectPath(rootDir, boundaryDir);

  if (!existsSync(path.join(boundaryDir, 'boundary.ts'))) {
    throw invalidCliInputError(
      'ASHIBA_FEATURE_BOUNDARY_FILE_MISSING',
      `Boundary directory must contain boundary.ts: ${relativeBoundary}.`,
      'Run feature scaffold first, or pass --boundary-dir/--feature for an existing feature boundary.',
      { boundaryDir: relativeBoundary },
    );
  }

  const files = buildQueryFiles(rootDir, relativeBoundary, queryName, action, table, primaryKeyColumn);
  const outputs = writeGeneratedFiles(rootDir, files, options.dryRun === true, options.force === true);
  const featureName = path.basename(boundaryDir);

  return {
    featureName,
    queryName,
    action,
    table: table.canonicalName,
    primaryKeyColumn,
    dryRun: options.dryRun === true,
    outputs,
  };
}

/**
 * Refreshes the generated query metadata file after a SQL-only edit.
 */
export function runFeatureQueryMetadataRefresh(options: FeatureQueryMetadataRefreshOptions): FeatureQueryMetadataRefreshResult {
  const rootDir = path.resolve(options.rootDir ?? '.');
  const boundaryDir = resolveExplicitFeatureBoundaryDir(rootDir, options.feature, options.boundaryDir, 'feature query refresh');
  const featureName = path.basename(boundaryDir);
  const queryName = normalizeQueryName(requireValue(options.query, '--query'));
  const queryDir = path.join(boundaryDir, 'queries', queryName);
  const sqlPath = path.join(queryDir, `${queryName}.sql`);
  const queryPath = path.join(queryDir, 'query.ts');
  const metadataPath = path.join(queryDir, 'generated', 'query.meta.ts');
  if (!existsSync(sqlPath)) {
    throw invalidCliInputError(
      'ASHIBA_FEATURE_QUERY_SQL_NOT_FOUND',
      `SQL file was not found for query metadata refresh: ${toProjectPath(rootDir, sqlPath)}.`,
      'Run feature query scaffold first, or pass the correct --feature/--boundary-dir and --query values.',
      { sqlFile: toProjectPath(rootDir, sqlPath) },
    );
  }
  if (!existsSync(queryPath)) {
    throw invalidCliInputError(
      'ASHIBA_FEATURE_QUERY_BOUNDARY_NOT_FOUND',
      `Query file was not found for query metadata refresh: ${toProjectPath(rootDir, queryPath)}.`,
      'Run feature query scaffold first, or recreate the query file before refreshing metadata.',
      { queryFile: toProjectPath(rootDir, queryPath) },
    );
  }

  const sql = readFileSync(sqlPath, 'utf8');
  const queryModel = buildFeatureQueryModel(sql, rootDir);
  const refreshedSource = renderQueryMetadata(queryModel);
  const existingSource = existsSync(metadataPath) ? readFileSync(metadataPath, 'utf8') : '';
  const changed = refreshedSource !== existingSource;
  if (!options.dryRun && changed) {
    mkdirSync(path.dirname(metadataPath), { recursive: true });
    writeFileSync(metadataPath, refreshedSource, 'utf8');
  }

  return {
    rootDir,
    featureName,
    queryName,
    sqlFile: toProjectPath(rootDir, sqlPath),
    queryFile: toProjectPath(rootDir, queryPath),
    metadataFile: toProjectPath(rootDir, metadataPath),
    dryRun: options.dryRun === true,
    changed,
  };
}

/**
 * Scaffolds mapping and logic test files for existing feature queries.
 */
export function runFeatureTestsScaffold(options: FeatureTestsScaffoldOptions): {
  rootDir: string;
  dryRun: boolean;
  outputs: Array<{ path: string; written: boolean; kind: 'directory' | 'file' }>;
} {
  const rootDir = path.resolve(options.rootDir ?? '.');
  const featureDir = resolveExplicitFeatureBoundaryDir(rootDir, options.feature, options.boundaryDir, 'feature tests scaffold');
  const featureName = path.basename(featureDir);
  const relativeFeatureDir = toProjectPath(rootDir, featureDir);
  const queriesDir = path.join(featureDir, 'queries');
  if (!existsSync(queriesDir) || !statSync(queriesDir).isDirectory()) {
    throw invalidCliInputError(
      'ASHIBA_FEATURE_QUERIES_DIR_MISSING',
      `No queries directory was discovered under ${relativeFeatureDir}. Run feature scaffold first.`,
      'Run feature scaffold or feature query scaffold before creating query tests.',
      { featureName, boundaryDir: relativeFeatureDir },
    );
  }

  const queryNames = options.query ? [normalizeQueryName(options.query)] : readdirSync(queriesDir).filter((entry) => {
    const fullPath = path.join(queriesDir, entry);
    return statSync(fullPath).isDirectory();
  });

  const files: GeneratedFile[] = [
    {
      relativePath: `${relativeFeatureDir}/tests/${featureName}.boundary.test.ts`,
      kind: 'file',
      contents: renderFeatureBoundaryTest(featureName),
      overwrite: false,
    },
  ];

  for (const queryName of queryNames) {
    const queryDir = path.join(queriesDir, queryName);
    if (!existsSync(queryDir)) {
      throw invalidCliInputError(
        'ASHIBA_FEATURE_QUERY_DIR_MISSING',
        `Query directory not found for tests scaffold: ${queryName}.`,
        'Check --query or run feature query scaffold for this query before creating tests.',
        { featureName, queryName },
      );
    }
    const resolvedMetadata = resolveQueryTestMetadata(rootDir, featureName, queryName, queryDir);
    if (resolvedMetadata) {
      const table = loadDdlTable(rootDir, resolvedMetadata.metadata.table);
      const actionPlan = buildActionPlan(resolvedMetadata.metadata.action, table, resolvedMetadata.metadata.primaryKeyColumn);
      files.push(
        { relativePath: `${relativeFeatureDir}/queries/${queryName}/tests`, kind: 'directory' },
        { relativePath: `${relativeFeatureDir}/queries/${queryName}/tests/cases`, kind: 'directory' },
        { relativePath: `${relativeFeatureDir}/queries/${queryName}/tests/generated`, kind: 'directory' },
        ...buildGeneratedMappingTestFiles(relativeFeatureDir, resolvedMetadata.metadata, table, actionPlan),
        {
          relativePath: `${relativeFeatureDir}/queries/${queryName}/tests/cases/logic.case.ts`,
          kind: 'file',
          contents: renderEmptyLogicZtdCases(queryName),
          overwrite: false,
        },
        { relativePath: `${relativeFeatureDir}/queries/${queryName}/tests/cases/.gitkeep`, kind: 'file', contents: '', overwrite: false },
      );
      continue;
    }
    files.push(
      { relativePath: `${relativeFeatureDir}/queries/${queryName}/tests`, kind: 'directory' },
      { relativePath: `${relativeFeatureDir}/queries/${queryName}/tests/cases`, kind: 'directory' },
      { relativePath: `${relativeFeatureDir}/queries/${queryName}/tests/generated`, kind: 'directory' },
      {
        relativePath: `${relativeFeatureDir}/queries/${queryName}/tests/${queryName}.boundary.ztd.test.ts`,
        kind: 'file',
        contents: renderQueryZtdTest(featureName, queryName),
        overwrite: false,
      },
      {
        relativePath: `${relativeFeatureDir}/queries/${queryName}/tests/cases/logic.case.ts`,
        kind: 'file',
        contents: renderEmptyLogicZtdCases(queryName),
        overwrite: false,
      },
      { relativePath: `${relativeFeatureDir}/queries/${queryName}/tests/cases/.gitkeep`, kind: 'file', contents: '', overwrite: false },
      {
        relativePath: `${relativeFeatureDir}/queries/${queryName}/tests/generated/TEST_PLAN.md`,
        kind: 'file',
        contents: renderGeneratedTestPlan(featureName, queryName),
        overwrite: true,
      },
      {
        relativePath: `${relativeFeatureDir}/queries/${queryName}/tests/generated/analysis.json`,
        kind: 'file',
        contents: `${JSON.stringify({ feature: featureName, query: queryName, status: 'generated-empty-cases' }, null, 2)}\n`,
        overwrite: true,
      }
    );
  }

  const outputs = writeGeneratedFiles(rootDir, files, options.dryRun === true, options.force === true);
  return { rootDir, dryRun: options.dryRun === true, outputs };
}

/**
 * Checks generated feature test coverage against discovered query metadata.
 */
export function runFeatureTestsCheck(options: FeatureTestsCheckOptions = {}): FeatureTestsCheckResult {
  const rootDir = path.resolve(options.rootDir ?? '.');
  const featureBoundaries = discoverFeatureBoundaries(rootDir, options.feature, options.boundaryDir);
  const checked: FeatureTestsCheckResult['checked'] = [];

  for (const { name: featureName, dir: featureDir } of featureBoundaries) {
    const queriesDir = path.join(featureDir, 'queries');
    if (!existsSync(queriesDir) || !statSync(queriesDir).isDirectory()) continue;
    for (const queryName of discoverQueryNames(queriesDir, options.query)) {
      const queryDir = path.join(queriesDir, queryName);
      const relativeQueryDir = toProjectPath(rootDir, queryDir);
      const resolvedMetadata = resolveQueryTestMetadata(rootDir, featureName, queryName, queryDir);
      const issues: string[] = [];
      const fixed: string[] = [];
      if (!resolvedMetadata) {
        checked.push({
          feature: featureName,
          query: queryName,
          ok: false,
          issues: [`Generated test analysis is missing or unreadable and could not be inferred from SQL: ${relativeQueryDir}/tests/generated/analysis.json.`],
          fixed,
        });
        continue;
      }

      const { metadata, inferred } = resolvedMetadata;
      if (inferred) {
        const analysisPath = `${relativeQueryDir}/tests/generated/analysis.json`;
        issues.push(`Missing or unreadable generated mapping test analysis: ${analysisPath}.`);
        if (options.fix) fixed.push(analysisPath);
      }

      const table = loadDdlTable(rootDir, metadata.table);
      const actionPlan = buildActionPlan(metadata.action, table, metadata.primaryKeyColumn);
      const expectedFiles = buildGeneratedMappingTestFiles(toProjectPath(rootDir, featureDir), metadata, table, actionPlan);
      for (const file of expectedFiles) {
        const fullPath = path.join(rootDir, file.relativePath);
        const expected = file.contents ?? '';
        if (!existsSync(fullPath)) {
          issues.push(`Missing generated mapping test asset: ${file.relativePath}.`);
          if (options.fix) fixed.push(file.relativePath);
          continue;
        }
        if (readFileSync(fullPath, 'utf8') !== expected) {
          issues.push(`Drifted generated mapping test asset: ${file.relativePath}.`);
          if (options.fix) fixed.push(file.relativePath);
        }
      }

      const logicCasePath = `${toProjectPath(rootDir, featureDir)}/queries/${queryName}/tests/cases/logic.case.ts`;
      if (!existsSync(path.join(rootDir, logicCasePath))) {
        issues.push(`Missing human-owned logic case stub: ${logicCasePath}.`);
        if (options.fix) fixed.push(logicCasePath);
      }

      if (options.fix && fixed.length > 0) {
        writeGeneratedFiles(rootDir, expectedFiles, false, true);
        if (!existsSync(path.join(rootDir, logicCasePath))) {
          writeGeneratedFiles(rootDir, [{
            relativePath: logicCasePath,
            kind: 'file',
            contents: renderEmptyLogicZtdCases(queryName),
            overwrite: false,
          }], false, false);
        }
      }

      checked.push({
        feature: featureName,
        query: queryName,
        ok: issues.length === 0 || (options.fix === true && fixed.length > 0),
        issues,
        fixed,
      });
    }
  }

  if (checked.length === 0) {
    throw invalidCliInputError(
      'ASHIBA_FEATURE_QUERY_TESTS_NOT_FOUND',
      'No feature query test boundaries were discovered for tests check.',
      'Run feature scaffold/query scaffold first, or pass --feature/--boundary-dir/--query for an existing feature query boundary.',
      { rootDir },
    );
  }

  return {
    rootDir,
    fixed: options.fix === true,
    checked,
    ok: checked.every((entry) => entry.ok),
  };
}

/**
 * Checks generated mapper tests for drift against DDL-derived mapping expectations.
 */
export function runFeatureGeneratedMapperCheck(options: FeatureGeneratedMapperCheckOptions = {}): FeatureGeneratedMapperCheckResult {
  const rootDir = path.resolve(options.rootDir ?? '.');
  const featureBoundaries = discoverFeatureBoundaries(rootDir, options.feature, options.boundaryDir);
  const checked: FeatureGeneratedMapperCheckResult['checked'] = [];

  for (const { name: featureName, dir: featureDir } of featureBoundaries) {
    const queriesDir = path.join(featureDir, 'queries');
    if (!existsSync(queriesDir)) {
      continue;
    }
    const queryNames = discoverQueryNames(queriesDir, options.query);
    for (const queryName of queryNames) {
      const queryDir = path.join(queriesDir, queryName);
      const sqlFile = path.join(queryDir, `${queryName}.sql`);
      const queryFile = path.join(queryDir, 'query.ts');
      if (!existsSync(sqlFile) || !existsSync(queryFile)) {
        continue;
      }
      const sqlParameters = [...new Set(compileNamedParameters(readFileSync(sqlFile, 'utf8')).orderedNames)].sort();
      const sql = readFileSync(sqlFile, 'utf8');
      const querySource = readFileSync(queryFile, 'utf8');
      const mapperParameters = extractMapperParameters(querySource, queryName).sort();
      const sqlResultColumns = extractSqlResultColumns(sql).sort();
      const mapperResultColumns = extractMapperResultColumns(querySource, queryName).sort();
      const missingInMapper = sqlParameters.filter((parameter) => !mapperParameters.includes(parameter));
      const unusedInMapper = mapperParameters.filter((parameter) => !sqlParameters.includes(parameter));
      const missingResultInMapper = sqlResultColumns.filter((column) => !mapperResultColumns.includes(column));
      const unusedResultInMapper = mapperResultColumns.filter((column) => !sqlResultColumns.includes(column));
      checked.push({
        feature: featureName,
        query: queryName,
        sqlFile: toProjectPath(rootDir, sqlFile),
        queryFile: toProjectPath(rootDir, queryFile),
        sqlParameters,
        mapperParameters,
        sqlResultColumns,
        mapperResultColumns,
        missingInMapper,
        unusedInMapper,
        missingResultInMapper,
        unusedResultInMapper,
      });
    }
  }

  if (checked.length === 0) {
    throw invalidCliInputError(
      'ASHIBA_FEATURE_QUERY_BOUNDARIES_NOT_FOUND',
      'No feature query boundaries were discovered for generated mapper drift check.',
      'Run feature scaffold/query scaffold first, or pass --feature/--query for an existing feature query boundary.',
      { rootDir },
    );
  }

  return {
    rootDir,
    checked,
    ok: checked.every((entry) =>
      entry.missingInMapper.length === 0
      && entry.unusedInMapper.length === 0
      && entry.missingResultInMapper.length === 0
      && entry.unusedResultInMapper.length === 0
    ),
  };
}

function buildFeatureFiles(
  rootDir: string,
  featureName: string,
  queryName: string,
  action: FeatureAction,
  table: DdlTable,
  primaryKeyColumn: string
): GeneratedFile[] {
  const boundary = `src/features/${featureName}`;
  const actionPlan = buildActionPlan(action, table, primaryKeyColumn);
  return [
    ...buildSharedFiles(),
    { relativePath: boundary, kind: 'directory' },
    { relativePath: `${boundary}/queries/${queryName}`, kind: 'directory' },
    { relativePath: `${boundary}/tests`, kind: 'directory' },
    {
      relativePath: `${boundary}/README.md`,
      kind: 'file',
      contents: renderFeatureReadme(featureName, queryName, action, table, primaryKeyColumn),
    },
    {
      relativePath: `${boundary}/boundary.ts`,
      kind: 'file',
      contents: renderFeatureBoundary(featureName),
    },
    {
      relativePath: `${boundary}/input.ts`,
      kind: 'file',
      contents: renderFeatureInput(featureName, actionPlan),
    },
    {
      relativePath: `${boundary}/workflow.ts`,
      kind: 'file',
      contents: renderFeatureWorkflow(featureName, queryName, actionPlan),
    },
    {
      relativePath: `${boundary}/output.ts`,
      kind: 'file',
      contents: renderFeatureOutput(featureName, queryName, actionPlan),
    },
    {
      relativePath: `${boundary}/tests/${featureName}.boundary.test.ts`,
      kind: 'file',
      contents: renderFeatureBoundaryTest(featureName, queryName, actionPlan),
    },
    ...buildQueryFiles(rootDir, boundary, queryName, action, table, primaryKeyColumn),
  ];
}

function discoverFeatureBoundaries(rootDir: string, featureName?: string, boundaryDir?: string): Array<{ name: string; dir: string }> {
  const featuresDir = path.join(rootDir, 'src', 'features');
  if (featureName && boundaryDir) {
    throw invalidCliInputError(
      'ASHIBA_FEATURE_BOUNDARY_INPUT_CONFLICT',
      'Use either --feature or --boundary-dir, not both.',
      'Choose one boundary selector and rerun the command.',
      { options: ['--feature', '--boundary-dir'] },
    );
  }
  if (boundaryDir) {
    const dir = path.resolve(rootDir, boundaryDir);
    return [{ name: path.basename(dir), dir }];
  }
  if (featureName) {
    const name = normalizeFeatureName(featureName);
    return [{ name, dir: path.join(featuresDir, name) }];
  }
  if (!existsSync(featuresDir)) {
    throw invalidCliInputError(
      'ASHIBA_FEATURES_DIR_MISSING',
      'No src/features directory was discovered.',
      'Run ashiba feature scaffold first, or pass --feature for an existing feature directory.',
      { featuresDir: toProjectPath(rootDir, featuresDir) },
    );
  }
  return readdirSync(featuresDir)
    .filter((entry) => !entry.startsWith('_'))
    .filter((entry) => statSync(path.join(featuresDir, entry)).isDirectory())
    .sort()
    .map((name) => ({ name, dir: path.join(featuresDir, name) }));
}

function discoverQueryNames(queriesDir: string, queryName?: string): string[] {
  if (queryName) {
    return [normalizeQueryName(queryName)];
  }
  return readdirSync(queriesDir)
    .filter((entry) => statSync(path.join(queriesDir, entry)).isDirectory())
    .sort();
}

function readQueryTestMetadata(queryDir: string): QueryTestMetadata | undefined {
  const analysisPath = path.join(queryDir, 'tests', 'generated', 'analysis.json');
  if (!existsSync(analysisPath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(analysisPath, 'utf8')) as Partial<QueryTestMetadata>;
    if (
      typeof parsed.feature === 'string' &&
      typeof parsed.query === 'string' &&
      typeof parsed.action === 'string' &&
      FEATURE_ACTIONS.includes(parsed.action as FeatureAction) &&
      typeof parsed.table === 'string' &&
      typeof parsed.primaryKeyColumn === 'string'
    ) {
      return {
        feature: parsed.feature,
        query: parsed.query,
        action: parsed.action as FeatureAction,
        table: parsed.table,
        primaryKeyColumn: parsed.primaryKeyColumn,
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function resolveQueryTestMetadata(
  rootDir: string,
  featureName: string,
  queryName: string,
  queryDir: string,
): ResolvedQueryTestMetadata | undefined {
  const metadata = readQueryTestMetadata(queryDir);
  if (metadata) return { metadata, inferred: false };
  const inferred = inferQueryTestMetadataFromSql(rootDir, featureName, queryName, queryDir);
  return inferred ? { metadata: inferred, inferred: true } : undefined;
}

function inferQueryTestMetadataFromSql(
  rootDir: string,
  featureName: string,
  queryName: string,
  queryDir: string,
): QueryTestMetadata | undefined {
  const sqlPath = path.join(queryDir, `${queryName}.sql`);
  if (!existsSync(sqlPath)) return undefined;
  const sql = readFileSync(sqlPath, 'utf8');
  const statement = parseFeatureQuerySql(sql);
  const tableName = extractRootTableName(statement);
  if (!tableName) return undefined;
  const table = loadDdlTable(rootDir, tableName);
  const primaryKeyColumn = resolvePrimaryKeyColumn(table);
  const action = inferFeatureAction(statement, queryName);
  return {
    feature: featureName,
    query: queryName,
    action,
    table: table.canonicalName,
    primaryKeyColumn,
  };
}

function parseFeatureQuerySql(sql: string): ReturnType<typeof SqlParser.parse> {
  try {
    return SqlParser.parse(sql);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw astParseUserError({
      code: 'ASHIBA_FEATURE_QUERY_AST_PARSE_FAILED',
      message: 'Query AST parse failed while reading generated mapping test metadata.',
      reason,
      sqlKind: 'SQL',
      operation: 'inferring feature generated mapping test metadata',
    });
  }
}

function extractRootTableName(statement: ReturnType<typeof SqlParser.parse>): string | undefined {
  const source = statement instanceof SimpleSelectQuery
    ? statement.fromClause?.source
    : statement instanceof InsertQuery
      ? statement.insertClause.source
      : statement instanceof UpdateQuery
        ? statement.updateClause.source
        : statement instanceof DeleteQuery
          ? statement.deleteClause.source
          : undefined;
  if (!(source?.datasource instanceof TableSource)) return undefined;
  const qualifiedName = source.datasource.qualifiedName;
  if (!qualifiedName) return undefined;
  const schema = normalizeIdentifier(readIdentifierText(qualifiedName.namespaces?.at(-1)) ?? 'public');
  const table = normalizeIdentifier(readIdentifierText(qualifiedName.name) ?? '');
  return `${schema}.${table}`;
}

function readIdentifierText(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  if ('name' in value && typeof value.name === 'string') return value.name;
  if ('value' in value && typeof value.value === 'string') return value.value;
  return undefined;
}

function inferFeatureAction(statement: ReturnType<typeof SqlParser.parse>, queryName: string): FeatureAction {
  if (statement instanceof InsertQuery) return 'insert';
  if (statement instanceof UpdateQuery) return 'update';
  if (statement instanceof DeleteQuery) return 'delete';
  if (statement instanceof SimpleSelectQuery) {
    if (queryName === 'get-by-id' || queryName.startsWith('get-')) return 'get-by-id';
    return 'list';
  }
  throw invalidCliInputError(
    'ASHIBA_FEATURE_QUERY_ACTION_UNSUPPORTED',
    'Generated mapping test metadata inference supports SELECT/INSERT/UPDATE/DELETE query boundaries only.',
    'Keep generated mapping tests tied to a single scaffolded query boundary, or regenerate the query metadata explicitly.',
    { queryName, statementType: statement.constructor.name },
  );
}

function buildGeneratedMappingTestFiles(
  relativeFeatureDir: string,
  metadata: QueryTestMetadata,
  table: DdlTable,
  actionPlan: ReturnType<typeof buildActionPlan>,
): GeneratedFile[] {
  const queryDir = `${relativeFeatureDir}/queries/${metadata.query}`;
  return [
    {
      relativePath: `${queryDir}/tests/${metadata.query}.boundary.ztd.test.ts`,
      kind: 'file',
      contents: renderQueryZtdTest(metadata.feature, metadata.query),
      overwrite: false,
    },
    {
      relativePath: `${queryDir}/tests/boundary-ztd-types.ts`,
      kind: 'file',
      contents: renderQueryZtdTypes(metadata.query, table, actionPlan),
      overwrite: true,
    },
    {
      relativePath: `${queryDir}/tests/generated/TEST_PLAN.md`,
      kind: 'file',
      contents: renderGeneratedTestPlan(metadata.feature, metadata.query),
      overwrite: true,
    },
    {
      relativePath: `${queryDir}/tests/generated/mapping.cases.ts`,
      kind: 'file',
      contents: renderGeneratedMappingZtdCases(metadata.query, actionPlan, table, metadata.primaryKeyColumn),
      overwrite: true,
    },
    {
      relativePath: `${queryDir}/tests/generated/analysis.json`,
      kind: 'file',
      contents: renderGeneratedTestAnalysis(metadata.feature, metadata.query, metadata.action, table, metadata.primaryKeyColumn, actionPlan),
      overwrite: true,
    },
  ];
}

function extractMapperParameters(source: string, queryName: string): string[] {
  const pascal = toPascal(queryName);
  const preferred = extractInterfaceFields(source, `${pascal}QueryParams`);
  if (preferred.length > 0 || source.includes(`interface ${pascal}QueryParams`)) {
    return preferred;
  }

  const matches = [...source.matchAll(/export\s+interface\s+([A-Za-z0-9_]+QueryParams)\s*\{([\s\S]*?)\}/g)];
  if (matches.length === 1) {
    return extractFieldNames(matches[0][2] ?? '');
  }
  return [];
}

function extractMapperResultColumns(source: string, queryName: string): string[] {
  const pascal = toPascal(queryName);
  const preferred = extractInterfaceFields(source, `${pascal}QueryResult`);
  if (preferred.length > 0 || source.includes(`interface ${pascal}QueryResult`)) {
    return preferred;
  }

  const matches = [...source.matchAll(/export\s+interface\s+([A-Za-z0-9_]+QueryResult)\s*\{([\s\S]*?)\}/g)];
  if (matches.length === 1) {
    return extractFieldNames(matches[0][2] ?? '');
  }
  return [];
}

function extractInterfaceFields(source: string, interfaceName: string): string[] {
  const escapedName = interfaceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`export\\s+interface\\s+${escapedName}\\s*\\{([\\s\\S]*?)\\}`));
  return match ? extractFieldNames(match[1] ?? '') : [];
}

function extractFieldNames(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .map((line) => line.match(/^([A-Za-z_][A-Za-z0-9_]*)\??\s*:/)?.[1])
    .filter((field): field is string => Boolean(field))
    .sort();
}

function formatGeneratedMapperCheck(result: FeatureGeneratedMapperCheckResult): string {
  const lines = [`Feature generated mapper check: ${result.ok ? 'ok' : 'failed'}`];
  for (const entry of result.checked) {
    lines.push('', `- ${entry.feature}/${entry.query}`);
    lines.push(`  sql: ${entry.sqlFile}`);
    lines.push(`  mapper: ${entry.queryFile}`);
    lines.push(`  sql parameters: ${entry.sqlParameters.length > 0 ? entry.sqlParameters.join(', ') : '(none)'}`);
    lines.push(`  mapper parameters: ${entry.mapperParameters.length > 0 ? entry.mapperParameters.join(', ') : '(none)'}`);
    lines.push(`  sql result columns: ${entry.sqlResultColumns.length > 0 ? entry.sqlResultColumns.join(', ') : '(none)'}`);
    lines.push(`  mapper result columns: ${entry.mapperResultColumns.length > 0 ? entry.mapperResultColumns.join(', ') : '(none)'}`);
    if (entry.missingInMapper.length > 0) {
      lines.push(`  missing in mapper: ${entry.missingInMapper.join(', ')}`);
    }
    if (entry.unusedInMapper.length > 0) {
      lines.push(`  unused in mapper: ${entry.unusedInMapper.join(', ')}`);
    }
    if (entry.missingResultInMapper.length > 0) {
      lines.push(`  missing result in mapper: ${entry.missingResultInMapper.join(', ')}`);
    }
    if (entry.unusedResultInMapper.length > 0) {
      lines.push(`  unused result in mapper: ${entry.unusedResultInMapper.join(', ')}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function formatFeatureTestsCheck(result: FeatureTestsCheckResult): string {
  const lines = [
    `Feature tests check ${result.ok ? 'passed' : 'failed'}`,
    `- root: ${result.rootDir}`,
    `- fix: ${result.fixed ? 'applied' : 'off'}`,
  ];
  for (const entry of result.checked) {
    lines.push('', `- ${entry.ok ? 'ok' : 'issue'}: ${entry.feature}/${entry.query}`);
    for (const issue of entry.issues) lines.push(`  issue: ${issue}`);
    for (const fixed of entry.fixed) lines.push(`  fixed: ${fixed}`);
  }
  return `${lines.join('\n')}\n`;
}

function buildQueryFiles(
  rootDir: string,
  boundary: string,
  queryName: string,
  action: FeatureAction,
  table: DdlTable,
  primaryKeyColumn: string
): GeneratedFile[] {
  const queryDir = `${boundary}/queries/${queryName}`;
  const actionPlan = buildActionPlan(action, table, primaryKeyColumn);
  const sql = renderActionSql(actionPlan, table, primaryKeyColumn);
  return [
    ...buildSharedFiles(),
    { relativePath: queryDir, kind: 'directory' },
    {
      relativePath: `${queryDir}/${queryName}.sql`,
      kind: 'file',
      contents: sql,
    },
    {
      relativePath: `${queryDir}/query.ts`,
      kind: 'file',
      contents: renderQueryBoundary(rootDir, queryName, actionPlan, table, primaryKeyColumn),
    },
    { relativePath: `${queryDir}/generated`, kind: 'directory' },
    {
      relativePath: `${queryDir}/generated/query.meta.ts`,
      kind: 'file',
      contents: renderQueryMetadata(buildFeatureQueryModel(sql, rootDir)),
      overwrite: true,
    },
    { relativePath: `${queryDir}/tests`, kind: 'directory' },
    { relativePath: `${queryDir}/tests/cases`, kind: 'directory' },
    { relativePath: `${queryDir}/tests/generated`, kind: 'directory' },
    {
      relativePath: `${queryDir}/tests/${queryName}.boundary.ztd.test.ts`,
      kind: 'file',
      contents: renderQueryZtdTest(featureNameFromBoundary(boundary), queryName),
      overwrite: false,
    },
    {
      relativePath: `${queryDir}/tests/boundary-ztd-types.ts`,
      kind: 'file',
      contents: renderQueryZtdTypes(queryName, table, actionPlan),
      overwrite: false,
    },
    {
      relativePath: `${queryDir}/tests/generated/mapping.cases.ts`,
      kind: 'file',
      contents: renderGeneratedMappingZtdCases(queryName, actionPlan, table, primaryKeyColumn),
      overwrite: true,
    },
    {
      relativePath: `${queryDir}/tests/cases/logic.case.ts`,
      kind: 'file',
      contents: renderEmptyLogicZtdCases(queryName),
      overwrite: false,
    },
    { relativePath: `${queryDir}/tests/cases/.gitkeep`, kind: 'file', contents: '', overwrite: false },
    {
      relativePath: `${queryDir}/tests/generated/TEST_PLAN.md`,
      kind: 'file',
      contents: renderGeneratedTestPlan(featureNameFromBoundary(boundary), queryName),
      overwrite: true,
    },
      {
        relativePath: `${queryDir}/tests/generated/analysis.json`,
        kind: 'file',
      contents: renderGeneratedTestAnalysis(featureNameFromBoundary(boundary), queryName, action, table, primaryKeyColumn, actionPlan),
      overwrite: true,
    },
  ];
}

function buildSharedFiles(): GeneratedFile[] {
  return [
    { relativePath: 'src/features/_shared', kind: 'directory' },
    {
      relativePath: 'src/features/_shared/featureQueryExecutor.ts',
      kind: 'file',
      overwrite: false,
      contents: [
        'export type FeatureQueryModel = {',
        '  analysis: {',
        "    astParse: 'ok';",
        "    statementKind: 'select' | 'insert' | 'update' | 'delete' | 'unknown';",
        "    rootQueryShape?: 'simple-select' | 'compound-select' | 'values' | 'non-select' | 'unknown';",
        '    hasTopLevelOrderBy: boolean;',
        '    sourceHash?: string;',
        '  };',
        '  bindings?: {',
        '    postgres?: { sourceHash?: string; sql: string; orderedNames: readonly string[] };',
        '  };',
        '};',
        '',
        'export interface FeatureQuerySource {',
        '  id: string;',
        '  path: string;',
        '  sqlPath: string;',
        '  sql: string;',
        '  queryModel: FeatureQueryModel;',
        '  sssqlCompression?: boolean;',
        '  metadata?: {',
        '    sqlId?: string;',
        '    queryId?: string;',
        '    sqlFile?: string;',
        '    sqlPath?: string;',
        '    dialect?: string;',
        '  };',
        '}',
        '',
        'export interface FeatureQueryExecutor {',
        '  query<T = unknown>(query: FeatureQuerySource, params: Record<string, unknown>): Promise<T[]>;',
        '}',
        '',
      ].join('\n'),
    },
    {
      relativePath: 'src/features/_shared/loadSqlResource.ts',
      kind: 'file',
      overwrite: false,
      contents: [
        "import { readFileSync } from 'node:fs';",
        "import path from 'node:path';",
        '',
        'export function loadSqlResource(currentDir: string, relativePath: string): string {',
        "  return readFileSync(path.join(currentDir, relativePath), 'utf8');",
        '}',
        '',
      ].join('\n'),
    },
  ];
}

function writeGeneratedFiles(
  rootDir: string,
  files: GeneratedFile[],
  dryRun: boolean,
  force: boolean
): FeatureScaffoldResult['outputs'] {
  const outputs: FeatureScaffoldResult['outputs'] = [];
  const seen = new Set<string>();

  for (const file of files) {
    if (seen.has(file.relativePath)) {
      continue;
    }
    seen.add(file.relativePath);
    const destination = path.join(rootDir, file.relativePath);
    const exists = existsSync(destination);
    const mayOverwrite = force || file.overwrite === true;
    if (file.kind === 'file' && exists && !mayOverwrite && file.overwrite !== false) {
      throw invalidCliInputError(
        'ASHIBA_SCAFFOLD_OVERWRITE_REQUIRES_FORCE',
        `Refusing to overwrite scaffold-owned file without --force: ${file.relativePath}`,
        'Review the existing file and rerun with --force only when overwriting scaffold-owned output is intentional.',
        { file: file.relativePath },
      );
    }
    if (!dryRun) {
      if (file.kind === 'directory') {
        mkdirSync(destination, { recursive: true });
      } else if (!exists || mayOverwrite || file.overwrite !== false) {
        mkdirSync(path.dirname(destination), { recursive: true });
        writeFileSync(destination, file.contents ?? '', 'utf8');
      }
    }
    outputs.push({ path: file.relativePath, written: !dryRun, kind: file.kind });
  }

  return outputs;
}

function loadDdlTable(rootDir: string, rawTableName: string): DdlTable {
  const ddlDir = resolveDdlDir(rootDir);
  const files = collectSqlFiles(ddlDir);
  const tables = files.flatMap((file) => parseDdlTables(readFileSync(file, 'utf8')));
  const requested = rawTableName.trim().toLowerCase();
  const matches = tables.filter((table) =>
    table.canonicalName.toLowerCase() === requested || table.name.toLowerCase() === requested
  );
  if (matches.length === 0) {
    throw invalidCliInputError(
      'ASHIBA_FEATURE_TABLE_NOT_FOUND',
      `Table not found for scaffold: ${rawTableName}.`,
      'Check --table and the configured DDL directory, then rerun the scaffold command.',
      { table: rawTableName },
    );
  }
  if (matches.length > 1 && !requested.includes('.')) {
    throw invalidCliInputError(
      'ASHIBA_FEATURE_TABLE_AMBIGUOUS',
      `Table name is ambiguous: ${rawTableName}. Use a schema-qualified table name.`,
      'Pass --table as schema.table so Ashiba can choose the intended DDL table.',
      { table: rawTableName, matches: matches.map((table) => table.canonicalName) },
    );
  }
  return matches[0];
}

function resolveDdlDir(rootDir: string): string {
  const configPath = path.join(rootDir, 'ashiba.config.json');
  if (existsSync(configPath)) {
    try {
      const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as { ddl?: { sourceDir?: unknown }; ddlDir?: unknown };
      if (typeof parsed.ddl?.sourceDir === 'string') {
        return path.resolve(rootDir, parsed.ddl.sourceDir);
      }
      if (typeof parsed.ddlDir === 'string') {
        return path.resolve(rootDir, parsed.ddlDir);
      }
    } catch (error) {
      throw invalidCliInputError(
        'ASHIBA_CONFIG_JSON_PARSE_FAILED',
        'Failed to parse ashiba.config.json.',
        'Fix ashiba.config.json so it is valid JSON, or remove it to use the default db/ddl directory.',
        { configPath, reason: error instanceof Error ? error.message : String(error) },
      );
    }
  }
  return path.join(rootDir, 'db', 'ddl');
}

function collectSqlFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    throw invalidCliInputError(
      'ASHIBA_DDL_DIRECTORY_NOT_FOUND',
      `DDL directory does not exist: ${dir}.`,
      'Create the configured DDL directory, pass the correct root/config, or update ashiba.config.json ddl.sourceDir.',
      { dir },
    );
  }
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      found.push(...collectSqlFiles(fullPath));
    } else if (stat.isFile() && entry.toLowerCase().endsWith('.sql')) {
      found.push(fullPath);
    }
  }
  return found.sort();
}

function parseDdlTables(sql: string): DdlTable[] {
  return MultiQuerySplitter.split(sql).getNonEmpty().flatMap((statement) => {
    try {
      const parsed = SqlParser.parse(statement.sql);
      return parsed instanceof CreateTableQuery ? [createDdlTable(parsed)] : [];
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw astParseUserError({
        code: 'ASHIBA_FEATURE_DDL_AST_PARSE_FAILED',
        message: 'DDL AST parse failed while reading feature scaffold table metadata.',
        reason,
        sqlKind: 'DDL',
        operation: 'reading feature scaffold table metadata',
      });
    }
  });
}

function createDdlTable(parsed: CreateTableQuery): DdlTable {
  const schema = normalizeIdentifier(parsed.namespaces?.[0] ?? 'public');
  const name = normalizeIdentifier(parsed.tableName.name);
  const tablePrimaryKeys = parsed.tableConstraints
    .filter((constraint) => constraint.kind === 'primary-key')
    .flatMap((constraint) => constraint.columns ?? [])
    .map((value) => normalizeIdentifier(value.name));
  const tablePrimaryKeySet = new Set(tablePrimaryKeys.map((value) => value.toLowerCase()));
  const columns: DdlColumn[] = [];
  for (const column of parsed.columns) {
    const columnName = normalizeIdentifier(column.name.name);
    const primaryKey = tablePrimaryKeySet.has(columnName.toLowerCase())
      || column.constraints.some((constraint) => constraint.kind === 'primary-key');
    const generated = column.constraints.some((constraint) =>
      constraint.kind === 'generated-always-identity' || constraint.kind === 'generated-by-default-identity'
    );
    const defaultValue = column.constraints.find((constraint) => constraint.kind === 'default')?.defaultValue;
    columns.push({
      name: columnName,
      typeName: getColumnTypeName(column.dataType),
      nullable: !primaryKey && !column.constraints.some((constraint) => constraint.kind === 'not-null'),
      defaultValue: defaultValue ? formatValue(defaultValue) : undefined,
      generated,
      primaryKey,
    });
  }
  const primaryKeyColumns = [...new Set([...columns.filter((column) => column.primaryKey).map((column) => column.name), ...tablePrimaryKeys])];
  return { schema, name, canonicalName: `${schema}.${name}`, columns, primaryKeyColumns };
}

function getColumnTypeName(dataType: CreateTableQuery['columns'][number]['dataType']): string {
  if (dataType instanceof TypeValue) return dataType.getTypeName();
  if (dataType instanceof RawString) return dataType.value.trim();
  return 'unknown';
}

function formatValue(value: ValueComponent): string {
  return sqlFormatter.format(value).formattedSql.replace(/"([A-Za-z_][A-Za-z0-9_$]*)"/g, '$1');
}

function buildActionPlan(action: FeatureAction, table: DdlTable, primaryKeyColumn: string): {
  action: FeatureAction;
  params: DdlColumn[];
  rows: DdlColumn[];
  writeColumns: DdlColumn[];
} {
  const primaryKey = requireColumn(table, primaryKeyColumn);
  if (action === 'insert') {
    const writeColumns = table.columns.filter((column) => !isGeneratedInsertColumn(column, primaryKeyColumn) && column.defaultValue == null);
    return { action, params: writeColumns, rows: table.columns, writeColumns };
  }
  if (action === 'update') {
    const writeColumns = table.columns.filter((column) => column.name !== primaryKeyColumn && !isGeneratedInsertColumn(column, primaryKeyColumn));
    if (writeColumns.length === 0) {
      throw invalidCliInputError(
        'ASHIBA_FEATURE_UPDATE_REQUIRES_MUTABLE_COLUMN',
        `Update scaffold requires at least one mutable non-primary-key column: ${table.canonicalName}.`,
        'Add a mutable non-primary-key column to the DDL table or choose a different scaffold action.',
        { table: table.canonicalName },
      );
    }
    return { action, params: [primaryKey, ...writeColumns], rows: [primaryKey], writeColumns };
  }
  if (action === 'delete') {
    return { action, params: [primaryKey], rows: [primaryKey], writeColumns: [] };
  }
  if (action === 'get-by-id') {
    return { action, params: [primaryKey], rows: table.columns, writeColumns: [] };
  }
  const limitColumn: DdlColumn = {
    name: 'limit',
    typeName: 'integer',
    nullable: false,
    generated: false,
    primaryKey: false,
  };
  return { action, params: [limitColumn], rows: table.columns, writeColumns: [] };
}

function renderActionSql(plan: ReturnType<typeof buildActionPlan>, table: DdlTable, primaryKeyColumn: string): string {
  const tableName = quoteQualifiedName(table.canonicalName);
  const pk = quoteIdentifier(primaryKeyColumn);
  if (plan.action === 'insert') {
    const returningColumns = plan.rows.map((column) => quoteIdentifier(column.name)).join(', ');
    if (plan.writeColumns.length === 0) {
      return `insert into ${tableName}\ndefault values\nreturning ${returningColumns};\n`;
    }
    return [
      `insert into ${tableName} (`,
      plan.writeColumns.map((column) => `  ${quoteIdentifier(column.name)}`).join(',\n'),
      ') values (',
      plan.writeColumns.map((column) => `  :${column.name}`).join(',\n'),
      `) returning ${returningColumns};`,
      '',
    ].join('\n');
  }
  if (plan.action === 'update') {
    return [
      `update ${tableName}`,
      'set',
      plan.writeColumns.map((column) => `  ${quoteIdentifier(column.name)} = :${column.name}`).join(',\n'),
      'where',
      `  ${pk} = :${primaryKeyColumn}`,
      `returning ${pk};`,
      '',
    ].join('\n');
  }
  if (plan.action === 'delete') {
    return [`delete from ${tableName}`, 'where', `  ${pk} = :${primaryKeyColumn}`, `returning ${pk};`, ''].join('\n');
  }
  if (plan.action === 'get-by-id') {
    return [
      'select',
      table.columns.map((column) => `  ${quoteIdentifier(column.name)}`).join(',\n'),
      `from ${tableName}`,
      'where',
      `  ${pk} = :${primaryKeyColumn};`,
      '',
    ].join('\n');
  }
  return [
    'select',
    table.columns.map((column) => `  ${quoteIdentifier(column.name)}`).join(',\n'),
    `from ${tableName}`,
    'order by',
    `  ${pk} asc`,
    'limit :limit;',
    '',
  ].join('\n');
}

function renderFeatureBoundary(featureName: string): string {
  const pascal = toPascal(featureName);
  return [
    `import type { FeatureQueryExecutor } from '${FEATURE_SHARED_EXECUTOR_IMPORT_PATH}';`,
    "import { parseRequest, type " + pascal + "Request } from './input.js';",
    "import { buildResult, type " + pascal + "Response } from './output.js';",
    "import { executeWorkflow } from './workflow.js';",
    '',
    `export type { ${pascal}Request } from './input.js';`,
    `export type { ${pascal}Response } from './output.js';`,
    '',
    '/**',
    ` * Executes the ${featureName} feature boundary.`,
    ' *',
    ' * Review order:',
    ' * 1. parse and normalize caller input',
    ' * 2. run feature workflow with query-boundary dependencies',
    ' * 3. shape the response for the caller boundary',
    ' */',
    'export async function execute(',
    '  executor: FeatureQueryExecutor,',
    '  rawRequest: unknown,',
    `): Promise<${pascal}Response> {`,
    '  const request = parseRequest(rawRequest);',
    '  const result = await executeWorkflow(executor, request);',
    '  return buildResult(result);',
    '}',
    '',
  ].join('\n');
}

function renderFeatureInput(featureName: string, plan: ReturnType<typeof buildActionPlan>): string {
  const pascal = toPascal(featureName);
  const fields = toFeatureFields(plan.params);
  return [
    `export interface ${pascal}Request ${renderRenderFieldInterfaceBody(fields)}`,
    '',
    '/** Parses, normalizes, and rejects invalid caller input at the feature boundary. */',
    `export function parseRequest(raw: unknown): ${pascal}Request {`,
    `  const request = parseRawRequest(raw);`,
    '  const normalized = normalizeRequest(request);',
    '  rejectRequest(normalized);',
    '  return normalized;',
    '}',
    '',
    `function parseRawRequest(raw: unknown): ${pascal}Request {`,
    '  const record = readRecord(raw);',
    ...(fields.length > 0
      ? [
          '  return {',
          ...fields.map((field) => `    ${field.name}: ${renderReadFieldExpression(field)},`),
          '  };',
        ]
      : ['  return {};']),
    '}',
    '',
    `function normalizeRequest(request: ${pascal}Request): ${pascal}Request {`,
    ...(fields.length > 0
      ? [
          '  return {',
          ...fields.map((field) => field.parserKind === 'string'
            ? `    ${field.name}: ${field.nullable ? `request.${field.name} === null ? null : request.${field.name}.trim()` : `request.${field.name}.trim()`},`
            : `    ${field.name}: request.${field.name},`),
          '  };',
        ]
      : ['  return request;']),
    '}',
    '',
    `function rejectRequest(request: ${pascal}Request): void {`,
    ...renderRejectRequestLines(pascal, fields),
    '}',
    '',
    ...renderFeatureParserSupport(),
    '',
  ].join('\n');
}

function renderFeatureWorkflow(featureName: string, queryName: string, plan: ReturnType<typeof buildActionPlan>): string {
  const pascal = toPascal(featureName);
  const queryPascal = toPascal(queryName);
  const fields = toFeatureFields(plan.params);
  const requestName = fields.length > 0 ? 'request' : '_request';
  return [
    `import type { FeatureQueryExecutor } from '${FEATURE_SHARED_EXECUTOR_IMPORT_PATH}';`,
    `import type { ${pascal}Request } from './input.js';`,
    `import { execute${queryPascal}Query, type ${queryPascal}QueryParams, type ${queryPascal}QueryResult } from './queries/${queryName}/query.js';`,
    '',
    `export type ${pascal}WorkflowResult = ${plan.action === 'list' ? `${queryPascal}QueryResult[]` : `${queryPascal}QueryResult`};`,
    '',
    `export interface ${pascal}Queries {`,
    `  execute${queryPascal}: (`,
    '    executor: FeatureQueryExecutor,',
    `    params: ${queryPascal}QueryParams,`,
    `  ) => Promise<${plan.action === 'list' ? `${queryPascal}QueryResult[]` : `${queryPascal}QueryResult`}>;`,
    '}',
    '',
    `const defaultQueries: ${pascal}Queries = {`,
    `  execute${queryPascal}: execute${queryPascal}Query,`,
    '};',
    '',
    '/** Runs feature orchestration after input parsing. Query functions are injectable for DB-free feature tests. */',
    'export async function executeWorkflow(',
    '  executor: FeatureQueryExecutor,',
    `  request: ${pascal}Request,`,
    `  queries: ${pascal}Queries = defaultQueries,`,
    `): Promise<${pascal}WorkflowResult> {`,
    `  return queries.execute${queryPascal}(executor, toQueryParams(request));`,
    '}',
    '',
    `function toQueryParams(${requestName}: ${pascal}Request): ${queryPascal}QueryParams {`,
    ...(fields.length > 0
      ? [
          '  return {',
          ...fields.map((field) => `    ${field.sourceName}: ${requestName}.${field.name},`),
          '  };',
        ]
      : ['  return {};']),
    '}',
    '',
  ].join('\n');
}

function renderFeatureOutput(featureName: string, queryName: string, plan: ReturnType<typeof buildActionPlan>): string {
  const pascal = toPascal(featureName);
  const queryPascal = toPascal(queryName);
  const fields = toFeatureFields(plan.rows);
  return [
    `import type { ${queryPascal}QueryResult } from './queries/${queryName}/query.js';`,
    '',
    ...renderFeatureResponseType(pascal, plan.action, fields),
    '',
    `export function buildResult(result: ${plan.action === 'list' ? `${queryPascal}QueryResult[]` : `${queryPascal}QueryResult`}): ${pascal}Response {`,
    ...renderFeatureBuildResultLines(plan.action, fields),
    '}',
    '',
  ].join('\n');
}

function toFeatureFields(columns: DdlColumn[]): RenderField[] {
  return columns.map((column) => {
    const typeScriptType = toTsType(column);
    const baseType = typeScriptType.replace(' | null', '');
    return {
      name: toCamel(column.name),
      sourceName: column.name,
      typeScriptType,
      parserKind: baseType === 'number' ? 'number' : baseType === 'boolean' ? 'boolean' : 'string',
      nullable: column.nullable,
    };
  });
}

function renderRenderFieldInterfaceBody(fields: RenderField[]): string {
  if (fields.length === 0) return '{ [key: string]: never; }';
  return `{\n${fields.map((field) => `  ${field.name}: ${field.typeScriptType};`).join('\n')}\n}`;
}

function renderReadFieldExpression(field: RenderField): string {
  const functionName = field.parserKind === 'number'
    ? 'readNumber'
    : field.parserKind === 'boolean'
      ? 'readBoolean'
      : 'readString';
  return `${functionName}(record[${JSON.stringify(field.name)}], ${JSON.stringify(`${field.name}`)}, ${field.nullable})`;
}

function renderRejectRequestLines(pascal: string, fields: RenderField[]): string[] {
  const lines = fields
    .filter((field) => field.parserKind === 'string')
    .flatMap((field) => {
      if (field.nullable) {
        return [
          `  if (request.${field.name} !== null && request.${field.name}.length === 0) {`,
          `    throw new Error('${pascal}Request.${field.name} must not be empty after trim().');`,
          '  }',
        ];
      }
      return [
        `  if (request.${field.name}.length === 0) {`,
        `    throw new Error('${pascal}Request.${field.name} must not be empty after trim().');`,
        '  }',
      ];
    });
  return lines.length > 0 ? lines : ['  // Add feature-level reject rules here when follow-up requirements appear.'];
}

function renderFeatureParserSupport(): string[] {
  return [
    'function readRecord(raw: unknown): Record<string, unknown> {',
    "  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {",
    "    throw new Error('Feature request must be an object.');",
    '  }',
    '  return raw as Record<string, unknown>;',
    '}',
    '',
    'function readString(value: unknown, label: string, nullable: true): string | null;',
    'function readString(value: unknown, label: string, nullable?: false): string;',
    'function readString(value: unknown, label: string, nullable = false): string | null {',
    '  if (value === null && nullable) return null;',
    "  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);",
    '  return value;',
    '}',
    '',
    'function readNumber(value: unknown, label: string, nullable: true): number | null;',
    'function readNumber(value: unknown, label: string, nullable?: false): number;',
    'function readNumber(value: unknown, label: string, nullable = false): number | null {',
    '  if (value === null && nullable) return null;',
    "  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);",
    '  return value;',
    '}',
    '',
    'function readBoolean(value: unknown, label: string, nullable: true): boolean | null;',
    'function readBoolean(value: unknown, label: string, nullable?: false): boolean;',
    'function readBoolean(value: unknown, label: string, nullable = false): boolean | null {',
    '  if (value === null && nullable) return null;',
    "  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`);",
    '  return value;',
    '}',
  ];
}

function renderFeatureResponseType(pascal: string, action: FeatureAction, fields: RenderField[]): string[] {
  if (action === 'list') {
    return [
      `export interface ${pascal}Response {`,
      '  items: Array<{',
      ...fields.map((field) => `    ${field.name}: ${field.typeScriptType};`),
      '  }>;',
      '}',
    ];
  }
  return [
    `export interface ${pascal}Response ${renderRenderFieldInterfaceBody(fields)}`,
  ];
}

function renderFeatureBuildResultLines(action: FeatureAction, fields: RenderField[]): string[] {
  if (action === 'list') {
    return [
      '  return {',
      '    items: result.map((item) => ({',
      ...fields.map((field) => `      ${field.name}: item.${field.sourceName},`),
      '    })),',
      '  };',
    ];
  }
  if (fields.length === 0) return ['  return {};'];
  return [
    '  return {',
    ...fields.map((field) => `    ${field.name}: result.${field.sourceName},`),
    '  };',
  ];
}

function sampleFieldValue(field: RenderField): unknown {
  if (field.nullable) return field.parserKind === 'string' ? `${field.name}-value` : field.parserKind === 'number' ? 1 : true;
  if (field.parserKind === 'number') return 1;
  if (field.parserKind === 'boolean') return true;
  return `${field.name}-value`;
}

function renderQueryBoundary(
  _rootDir: string,
  queryName: string,
  plan: ReturnType<typeof buildActionPlan>,
  table: DdlTable,
  primaryKeyColumn: string,
): string {
  const pascal = toPascal(queryName);
  const camel = toCamel(queryName);
  const result = plan.action === 'list' ? `${pascal}QueryResult[]` : `${pascal}QueryResult`;
  const rowExpr = plan.action === 'list' ? 'rows as QueryRow[]' : '(rows[0] ?? null) as QueryRow | null';
  const returnExpr = plan.action === 'list'
    ? 'return row;'
    : [
        'if (row === null) {',
        `    throw new Error('${queryName} query expected one row, but got 0.');`,
        '  }',
        '  return row;',
      ].join('\n  ');
  return [
    "import { dirname } from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
    '',
    `import type { FeatureQueryExecutor } from '${FEATURE_SHARED_EXECUTOR_IMPORT_PATH}';`,
    `import { loadSqlResource } from '${FEATURE_SHARED_LOAD_SQL_RESOURCE_IMPORT_PATH}';`,
    "import { queryModel } from './generated/query.meta.js';",
    '',
    'const currentDir = dirname(fileURLToPath(import.meta.url));',
    `export const ${camel}Sql = loadSqlResource(currentDir, '${queryName}.sql');`,
    `export const ${camel}Query = {`,
    `  id: '${queryName}',`,
    `  path: '${queryName}.sql',`,
    `  sqlPath: '${queryName}.sql',`,
    `  sql: ${camel}Sql,`,
    '  queryModel,',
    '  sssqlCompression: true,',
    '  metadata: {',
    `    sqlId: '${queryName}',`,
    `    queryId: '${queryName}',`,
    `    sqlFile: '${queryName}.sql',`,
    `    sqlPath: '${queryName}.sql',`,
    '  },',
    '} as const;',
    '',
    `export interface ${pascal}QueryParams ${renderInterfaceBody(plan.params)}`,
    '',
    `export interface ${pascal}QueryResult ${renderInterfaceBody(plan.rows)}`,
    '',
    `type QueryRow = ${pascal}QueryResult;`,
    '',
    `export async function execute${pascal}Query(`,
    '  executor: FeatureQueryExecutor,',
    `  params: ${pascal}QueryParams`,
    `): Promise<${result}> {`,
    `  const rows = await executor.query<QueryRow>(${camel}Query, params as unknown as Record<string, unknown>);`,
    `  const row = ${rowExpr};`,
    `  ${returnExpr}`,
    '}',
    '',
  ].join('\n');
}

function renderQueryMetadata(queryModel: ReturnType<typeof buildFeatureQueryModel>): string {
  return [
    '// Generated by Ashiba. Do not edit by hand.',
    '// Refresh with `ashiba feature query refresh` after SQL-only edits.',
    `export const queryModel = ${JSON.stringify(queryModel, null, 2)} as const;`,
    '',
  ].join('\n');
}

function buildFeatureQueryModel(sql: string, rootDir: string): {
  analysis: ReturnType<typeof analyzeQueryModel>;
  bindings: {
    postgres: QueryModelBindings['postgres'];
  };
} {
  const sourceHash = hashSql(sql);
  const postgres = compileNamedParameters(sql, { placeholderStyle: 'postgres' });
  const resultColumnContracts = buildQueryResultColumnContracts(sql, rootDir);
  const parameters = [...new Set(postgres.orderedNames)];
  const analysis = analyzeQueryModel(sql, parameters, resultColumnContracts, { sssqlCompression: true });
  return {
    analysis,
    bindings: {
      postgres: {
        sourceHash,
        ...postgres,
        ...buildPostgresSafeSortBindingMetadata(sql, analysis.safeSort),
        ...buildPostgresOptionalConditionCompressionBindingMetadata(sql, analysis.sssqlCompression),
      },
    },
  };
}

function renderInterfaceBody(columns: DdlColumn[]): string {
  if (columns.length === 0) {
    return '{ [key: string]: never; }';
  }
  return `{\n${columns.map((column) => `  ${column.name}: ${toTsType(column)};`).join('\n')}\n}`;
}

function hashSql(sql: string): string {
  return `sha256:${createHash('sha256').update(sql).digest('hex')}`;
}

function renderFeatureBoundaryTest(
  featureName: string,
  queryName?: string,
  plan?: ReturnType<typeof buildActionPlan>,
): string {
  if (!queryName || !plan) {
    return [
      "import { expect, test } from 'vitest';",
      '',
      "import * as boundary from '../boundary.js';",
      '',
      `test('${featureName} boundary exports executable feature entry points', () => {`,
      '  expect(Object.keys(boundary).length).toBeGreaterThan(0);',
      '});',
      '',
      `test.todo('cover ${featureName} feature input, workflow, and output behavior');`,
      '',
    ].join('\n');
  }
  const pascal = toPascal(featureName);
  const queryPascal = toPascal(queryName);
  const request = renderTsValue(Object.fromEntries(toFeatureFields(plan.params).map((field) => [field.name, sampleFieldValue(field)])));
  const queryResult = plan.action === 'list'
    ? `[${renderTsValue(Object.fromEntries(toFeatureFields(plan.rows).map((field) => [field.sourceName, sampleFieldValue(field)])))}]`
    : `[${renderTsValue(Object.fromEntries(toFeatureFields(plan.rows).map((field) => [field.sourceName, sampleFieldValue(field)])))}]`;
  const queryResultRows = `${queryResult} as unknown[]`;
  const response = plan.action === 'list'
    ? renderTsValue({ items: [Object.fromEntries(toFeatureFields(plan.rows).map((field) => [field.name, sampleFieldValue(field)]))] })
    : renderTsValue(Object.fromEntries(toFeatureFields(plan.rows).map((field) => [field.name, sampleFieldValue(field)])));
  return [
    "import { expect, test } from 'vitest';",
    '',
    "import { execute } from '../boundary.js';",
    `import type { FeatureQueryExecutor, FeatureQuerySource } from '${FEATURE_SHARED_EXECUTOR_IMPORT_PATH}';`,
    '',
    `test('${featureName} rejects invalid feature input before query execution', async () => {`,
    '  const guardedExecutor: FeatureQueryExecutor = {',
    '    async query() {',
    `      throw new Error('Feature boundary tests stay mock-based for ${featureName}; keep DB-backed SQL checks in the query boundary.');`,
    '    },',
    '  };',
    '',
    '  await expect(execute(guardedExecutor, {})).rejects.toThrow();',
    '});',
    '',
    `test('${featureName} maps request through workflow and output boundary', async () => {`,
    '  const executor: FeatureQueryExecutor = {',
    '    async query<T = unknown>(query: FeatureQuerySource, params: Record<string, unknown>): Promise<T[]> {',
    `      expect(query.id).toBe('${queryName}');`,
    `      expect(params).toEqual(${renderTsValue(Object.fromEntries(toFeatureFields(plan.params).map((field) => [field.sourceName, sampleFieldValue(field)])))});`,
    `      return ${queryResultRows} as T[];`,
    '    },',
    '  };',
    '',
    `  await expect(execute(executor, ${request})).resolves.toEqual(${response});`,
    '});',
    '',
    `// ${pascal} uses ${queryPascal} as the first query boundary. Add workflow cases here as requirements grow.`,
    '',
  ].join('\n');
}

function renderQueryZtdTest(featureName: string, queryName: string): string {
  const pascal = toPascal(queryName);
  return [
    "import { existsSync } from 'node:fs';",
    "import { resolve } from 'node:path';",
    "import { expect, test } from 'vitest';",
    '',
    `import { runQuerySpecZtdCases } from '${TEST_ZTD_HARNESS_IMPORT_PATH}';`,
    `import { execute${pascal}Query } from '../query.js';`,
    "import logicCases from './cases/logic.case.js';",
    "import mappingCases from './generated/mapping.cases.js';",
    '',
    'const cases = [...mappingCases, ...logicCases];',
    '',
    'const shouldSkipZtd =',
    "  process.env.ASHIBA_SKIP_DB_BACKED_TESTS === '1' ||",
    "  !existsSync(resolve('db/ddl/public.sql')) ||",
    '  cases.length === 0;',
    '',
    'const testZtd = shouldSkipZtd ? test.skip : test;',
    '',
    `testZtd('${featureName}/${queryName} boundary ZTD cases run through the fixed app-level harness', async () => {`,
    '  expect(cases.length).toBeGreaterThan(0);',
    `  const evidence = await runQuerySpecZtdCases(cases, execute${pascal}Query);`,
    "  expect(evidence.every((entry) => entry.mode === 'ztd')).toBe(true);",
    '  expect(evidence.every((entry) => entry.physicalSetupUsed === false)).toBe(true);',
    '  expect(evidence.every((entry) => entry.executedQueryCount > 0)).toBe(true);',
    '});',
    '',
  ].join('\n');
}

function renderQueryZtdTypes(
  queryName: string,
  table: DdlTable,
  actionPlan: ReturnType<typeof buildActionPlan>
): string {
  const pascal = toPascal(queryName);
  const outputType = actionPlan.action === 'list' ? `${pascal}QueryResult[]` : `${pascal}QueryResult`;
  return [
    `import type { QuerySpecZtdCase } from '${TEST_ZTD_CASE_TYPES_IMPORT_PATH}';`,
    `import type { ${pascal}QueryParams, ${pascal}QueryResult } from '../query.js';`,
    '',
    `export type ${pascal}BeforeDb = {`,
    `  ${renderPropertyKey(table.schema)}: {`,
    `    ${renderPropertyKey(table.name)}: readonly {`,
    ...table.columns.map((column) => `      ${renderPropertyKey(column.name)}?: unknown;`),
    '    }[];',
    '  };',
    '};',
    '',
    `export type ${pascal}QueryBoundaryZtdCase = QuerySpecZtdCase<`,
    `  ${pascal}BeforeDb,`,
    `  ${pascal}QueryParams,`,
    `  ${outputType}`,
    '>;',
    '',
  ].join('\n');
}

function renderGeneratedMappingZtdCases(
  queryName: string,
  actionPlan: ReturnType<typeof buildActionPlan>,
  table: DdlTable,
  primaryKeyColumn: string
): string {
  const pascal = toPascal(queryName);
  const caseType = `${pascal}QueryBoundaryZtdCase`;
  const cases = buildGeneratedMappingZtdCases(queryName, actionPlan, table, primaryKeyColumn);
  return [
    `import type { ${caseType} } from '../boundary-ztd-types.js';`,
    '',
    '// Library-owned mechanical mapping cases. Refresh with `ashiba feature tests scaffold` or `ashiba feature tests check --fix`.',
    `const cases: readonly ${caseType}[] = ${renderTsValue(cases)};`,
    '',
    'export default cases;',
    '',
  ].join('\n');
}

function renderEmptyLogicZtdCases(queryName: string): string {
  const caseType = `${toPascal(queryName)}QueryBoundaryZtdCase`;
  return [
    `import type { ${caseType} } from '../boundary-ztd-types.js';`,
    '',
    '// Human/AI-owned SQL logic cases. Add business expectations here; Ashiba will not overwrite this file.',
    `const cases: readonly ${caseType}[] = [];`,
    '',
    'export default cases;',
    '',
  ].join('\n');
}

function renderGeneratedTestPlan(featureName: string, queryName: string): string {
  return [
    `# ${featureName}/${queryName} Test Plan`,
    '',
    'This generated file is library-owned and may be refreshed by Ashiba.',
    '',
    '- Mapper tests: prefer Zero Table Dependency.',
    '- Performance tests: prefer traditional DB-backed tests.',
    '- Keep human-authored cases under `cases/`.',
    '',
  ].join('\n');
}

function renderGeneratedTestAnalysis(
  featureName: string,
  queryName: string,
  action: FeatureAction,
  table: DdlTable,
  primaryKeyColumn: string,
  actionPlan: ReturnType<typeof buildActionPlan>,
): string {
  return `${JSON.stringify({
    feature: featureName,
    query: queryName,
    action,
    table: table.canonicalName,
    primaryKeyColumn,
    mappingCaseSignature: buildMappingCaseSignature(queryName, actionPlan, table, primaryKeyColumn),
    status: 'generated',
  }, null, 2)}\n`;
}

function buildGeneratedMappingZtdCases(
  queryName: string,
  actionPlan: ReturnType<typeof buildActionPlan>,
  table: DdlTable,
  primaryKeyColumn: string
): unknown[] {
  const firstRow = buildFixtureRow(table, 1);
  const secondRow = buildFixtureRow(table, 2);
  const beforeDb = {
    [table.schema]: {
      [table.name]: [firstRow, secondRow],
    },
  };

  if (actionPlan.action === 'get-by-id' || actionPlan.action === 'list') {
    const cases = [
      buildReadMappingCase('db-type-mapping', queryName, actionPlan, beforeDb, [firstRow, secondRow], primaryKeyColumn),
      buildReadMappingCase('boundary-value-mapping', queryName, actionPlan, {
        [table.schema]: { [table.name]: [buildBoundaryFixtureRow(table)] },
      }, buildBoundaryFixtureRow(table), primaryKeyColumn),
    ];
    if (actionPlan.rows.some((column) => column.nullable)) {
      const nullableRow = { ...firstRow, ...Object.fromEntries(actionPlan.rows.filter((column) => column.nullable).map((column) => [column.name, null])) };
      cases.push(buildReadMappingCase('nullable-output-mapping', queryName, actionPlan, {
        [table.schema]: { [table.name]: [nullableRow] },
      }, nullableRow, primaryKeyColumn));
    }
    return cases;
  }

  if (actionPlan.action === 'insert') {
    const insertedRow = buildFixtureRow(table, 3);
    const input = pickColumns(insertedRow, actionPlan.writeColumns);
    const outputRow = buildInsertOutputRow(table, input, primaryKeyColumn);
    const cases = [{
      name: `default-generated-value-mapping: inserts ${queryName} row and maps returned columns`,
      beforeDb: { [table.schema]: { [table.name]: [] } },
      input,
      output: pickColumns(outputRow, actionPlan.rows),
    }];
    if (actionPlan.writeColumns.some((column) => column.nullable)) {
      const nullableInput = {
        ...pickColumns(insertedRow, actionPlan.writeColumns),
        ...Object.fromEntries(actionPlan.writeColumns.filter((column) => column.nullable).map((column) => [column.name, null])),
      };
      cases.push({
        name: `nullable-input-output-mapping: inserts ${queryName} nullable columns as null`,
        beforeDb: { [table.schema]: { [table.name]: [] } },
        input: nullableInput,
        output: pickColumns(buildInsertOutputRow(table, nullableInput, primaryKeyColumn), actionPlan.rows),
      });
    }
    if (actionPlan.writeColumns.some((column) => isBoundaryValueColumn(column))) {
      const boundaryRow = buildBoundaryFixtureRow(table);
      cases.push({
        name: `boundary-value-mapping: inserts ${queryName} boundary values and maps returned columns`,
        beforeDb: { [table.schema]: { [table.name]: [] } },
        input: pickColumns(boundaryRow, actionPlan.writeColumns),
        output: pickColumns(buildInsertOutputRow(table, pickColumns(boundaryRow, actionPlan.writeColumns), primaryKeyColumn), actionPlan.rows),
      });
      const negativeBoundaryRow = buildNegativeBoundaryFixtureRow(table);
      cases.push({
        name: `negative-boundary-value-mapping: inserts ${queryName} signed numeric boundary values and maps returned columns`,
        beforeDb: { [table.schema]: { [table.name]: [] } },
        input: pickColumns(negativeBoundaryRow, actionPlan.writeColumns),
        output: pickColumns(buildInsertOutputRow(table, pickColumns(negativeBoundaryRow, actionPlan.writeColumns), primaryKeyColumn), actionPlan.rows),
      });
    }
    return cases;
  }

  if (actionPlan.action === 'update') {
    const updatedValues = Object.fromEntries(actionPlan.writeColumns.map((column) => [column.name, sampleColumnValue(column, 3)]));
    return [{
      name: `db-type-mapping: updates ${queryName} row and maps returned columns`,
      beforeDb,
      input: { [primaryKeyColumn]: firstRow[primaryKeyColumn], ...updatedValues },
      output: pickColumns({ ...firstRow, ...updatedValues }, actionPlan.rows),
    }];
  }

  if (actionPlan.action === 'delete') {
    return [{
      name: `db-type-mapping: deletes ${queryName} row and maps returned columns`,
      beforeDb,
      input: { [primaryKeyColumn]: firstRow[primaryKeyColumn] },
      output: pickColumns(firstRow, actionPlan.rows),
    }];
  }

  return [];
}

function buildReadMappingCase(
  kind: string,
  queryName: string,
  actionPlan: ReturnType<typeof buildActionPlan>,
  beforeDb: Record<string, unknown>,
  row: Record<string, unknown> | Record<string, unknown>[],
  primaryKeyColumn: string,
): unknown {
  const rows = Array.isArray(row) ? row : [row];
  const output = pickColumns(rows[0] ?? {}, actionPlan.rows);
  if (actionPlan.action === 'list') {
    return {
      name: `${kind}: lists ${queryName} rows and maps returned columns`,
      beforeDb,
      input: Object.fromEntries(actionPlan.params.map((column) => [column.name, sampleParameterValue(column)])),
      output: rows.map((entry) => pickColumns(entry, actionPlan.rows)),
    };
  }
  const singleRow = rows[0] ?? {};
  return {
    name: `${kind}: selects ${queryName} row and maps returned columns`,
    beforeDb,
    input: { [primaryKeyColumn]: singleRow[primaryKeyColumn] },
    output,
  };
}

function buildFixtureRow(table: DdlTable, rowNumber: number): Record<string, unknown> {
  return Object.fromEntries(table.columns.map((column) => [column.name, sampleColumnValue(column, rowNumber)]));
}

function buildBoundaryFixtureRow(table: DdlTable): Record<string, unknown> {
  return Object.fromEntries(table.columns.map((column) => [column.name, sampleBoundaryColumnValue(column)]));
}

function buildNegativeBoundaryFixtureRow(table: DdlTable): Record<string, unknown> {
  return Object.fromEntries(table.columns.map((column) => [column.name, sampleNegativeBoundaryColumnValue(column)]));
}

function pickColumns(row: Record<string, unknown>, columns: DdlColumn[]): Record<string, unknown> {
  return Object.fromEntries(columns.map((column) => [column.name, row[column.name]]));
}

function buildInsertOutputRow(table: DdlTable, inputRow: Record<string, unknown>, primaryKeyColumn: string): Record<string, unknown> {
  const outputRow = { ...inputRow };
  for (const column of table.columns) {
    if (isGeneratedInsertColumn(column, primaryKeyColumn)) {
      outputRow[column.name] = sampleGeneratedPrimaryKeyValue(column);
    } else if (column.defaultValue != null && !(column.name in outputRow)) {
      outputRow[column.name] = sampleDefaultColumnValue(column);
    }
  }
  return outputRow;
}

function sampleParameterValue(column: DdlColumn): unknown {
  if (column.name === 'limit') return 100;
  return sampleColumnValue(column, 1);
}

function sampleColumnValue(column: DdlColumn, rowNumber: number): unknown {
  const type = column.typeName.toLowerCase();
  const name = column.name.toLowerCase();
  if (/^(smallint|integer|int|int2|int4|real|float|float4|float8|double precision|serial|serial2|serial4)$/.test(type)) {
    return rowNumber;
  }
  if (/^(bigint|int8|bigserial|serial8|numeric|decimal)$/.test(type)) {
    return String(rowNumber);
  }
  if (/^(boolean|bool)$/.test(type)) {
    return rowNumber % 2 === 1;
  }
  if (name.includes('email')) {
    return rowNumber === 1 ? 'alice@example.com' : 'bob@example.com';
  }
  if (name.includes('name')) {
    return rowNumber === 1 ? 'Alice' : 'Bob';
  }
  if (name.includes('status')) {
    return rowNumber === 1 ? 'active' : 'inactive';
  }
  return `${column.name}-${rowNumber}`;
}

function sampleBoundaryColumnValue(column: DdlColumn): unknown {
  const type = column.typeName.toLowerCase();
  const name = column.name.toLowerCase();
  if (/^(smallint|int2)$/.test(type)) return 32767;
  if (/^(integer|int|int4|serial|serial4)$/.test(type)) return 2147483647;
  if (/^(bigint|int8|bigserial|serial8)$/.test(type)) return '9223372036854775807';
  if (/^(real|float|float4|float8|double precision)$/.test(type)) return 123456.5;
  if (/^(numeric|decimal)$/.test(type)) return '1234567890.12345';
  if (/^(boolean|bool)$/.test(type)) return true;
  if (name.includes('email')) return 'boundary@example.com';
  return `${column.name}-boundary-value`;
}

function sampleNegativeBoundaryColumnValue(column: DdlColumn): unknown {
  const type = column.typeName.toLowerCase();
  const name = column.name.toLowerCase();
  if (/^(smallint|int2)$/.test(type)) return -32768;
  if (/^(integer|int|int4|serial|serial4)$/.test(type)) return -2147483648;
  if (/^(bigint|int8|bigserial|serial8)$/.test(type)) return '-9223372036854775808';
  if (/^(real|float|float4|float8|double precision)$/.test(type)) return -123456.5;
  if (/^(numeric|decimal)$/.test(type)) return '-1234567890.12345';
  if (/^(boolean|bool)$/.test(type)) return false;
  if (name.includes('email')) return 'negative-boundary@example.com';
  return `${column.name}-negative-boundary-value`;
}

function sampleDefaultColumnValue(column: DdlColumn): unknown {
  const defaultValue = column.defaultValue?.trim();
  if (!defaultValue) return sampleColumnValue(column, 1);
  const quoted = defaultValue.match(/^'(.*)'$/);
  if (quoted) return quoted[1]?.replace(/''/g, "'") ?? '';
  if (/^-?\d+$/.test(defaultValue)) {
    return /^(bigint|int8|bigserial|serial8)$/.test(column.typeName.toLowerCase())
      ? defaultValue
      : Number(defaultValue);
  }
  if (/^(true|false)$/i.test(defaultValue)) return defaultValue.toLowerCase() === 'true';
  return defaultValue;
}

function sampleGeneratedPrimaryKeyValue(column: DdlColumn): unknown {
  const type = column.typeName.toLowerCase();
  if (/^(bigint|int8|bigserial|serial8)$/.test(type)) return '1';
  return 1;
}

function isBoundaryValueColumn(column: DdlColumn): boolean {
  return /^(smallint|integer|int|int2|int4|bigint|int8|bigserial|serial8|real|float|float4|float8|double precision|numeric|decimal)$/
    .test(column.typeName.toLowerCase());
}

function buildMappingCaseSignature(
  queryName: string,
  actionPlan: ReturnType<typeof buildActionPlan>,
  table: DdlTable,
  primaryKeyColumn: string,
): Record<string, unknown> {
  return {
    query: queryName,
    action: actionPlan.action,
    table: table.canonicalName,
    primaryKeyColumn,
    params: actionPlan.params.map((column) => columnSignature(column)),
    rows: actionPlan.rows.map((column) => columnSignature(column)),
    writeColumns: actionPlan.writeColumns.map((column) => columnSignature(column)),
    generatedCaseNames: buildGeneratedMappingZtdCases(queryName, actionPlan, table, primaryKeyColumn)
      .map((entry) => hasStringName(entry) ? entry.name : 'unknown'),
  };
}

function hasStringName(value: unknown): value is { name: string } {
  return typeof value === 'object' && value !== null && 'name' in value && typeof value.name === 'string';
}

function columnSignature(column: DdlColumn): Record<string, unknown> {
  return {
    name: column.name,
    typeName: column.typeName,
    nullable: column.nullable,
    defaultValue: column.defaultValue ?? null,
    generated: column.generated,
    primaryKey: column.primaryKey,
  };
}

function renderTsValue(value: unknown): string {
  return JSON.stringify(value, null, 2)
    .replace(/\n/g, '\n')
    .replace(/"([^"]+)":/g, (_match, key: string) => `${renderPropertyKey(key)}:`);
}

function renderPropertyKey(value: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) ? value : JSON.stringify(value);
}

function renderFeatureReadme(featureName: string, queryName: string, action: FeatureAction, table: DdlTable, primaryKeyColumn: string): string {
  return [
    `# ${featureName}`,
    '',
    `Action: ${action}`,
    `Table: ${table.canonicalName}`,
    `Primary key: ${primaryKeyColumn}`,
    `Initial query: ${queryName}`,
    '',
    'Generated code is editable after scaffolding. Keep SQL visible, named, and directly runnable in a SQL client.',
    'A feature may contain multiple query boundaries; use feature query scaffold when the behavior needs another SQL access point.',
    'Transaction policy and feature orchestration belong to application code, not Ashiba.',
    '',
  ].join('\n');
}

function formatFeatureScaffoldResult(label: string, result: FeatureScaffoldResult): string {
  return formatFilePlan(`${label} ${result.dryRun ? 'plan' : 'completed'}: ${result.featureName}`, process.cwd(), result.dryRun, result.outputs);
}

function formatFeatureQueryMetadataRefresh(result: FeatureQueryMetadataRefreshResult): string {
  return [
    `Feature query refresh ${result.dryRun ? 'plan' : 'completed'}: ${result.featureName}/${result.queryName}`,
    '',
    `- sql: ${result.sqlFile}`,
    `- query: ${result.queryFile}`,
    `- metadata: ${result.metadataFile}`,
    `- changed: ${result.changed ? 'yes' : 'no'}`,
    `- dry-run: ${result.dryRun ? 'true' : 'false'}`,
    '',
  ].join('\n');
}

function formatFilePlan(
  title: string,
  _rootDir: string,
  _dryRun: boolean,
  outputs: Array<{ path: string; written: boolean; kind: 'directory' | 'file' }>
): string {
  return `${[title, '', ...outputs.map((output) => `- ${output.written ? 'write' : 'plan'} ${output.kind}: ${output.path}`)].join('\n')}\n`;
}

function normalizeFeatureAction(action: string | undefined): FeatureAction {
  const normalized = (action ?? '').trim().toLowerCase();
  if (FEATURE_ACTIONS.includes(normalized as FeatureAction)) return normalized as FeatureAction;
  throw invalidCliInputError(
    'ASHIBA_FEATURE_ACTION_UNSUPPORTED',
    `Unsupported --action value: ${action}. v1 supports insert, update, delete, get-by-id, and list.`,
    'Use --action insert, update, delete, get-by-id, or list.',
    { action, supported: FEATURE_ACTIONS },
  );
}

function normalizeFeatureName(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(normalized)) {
    throw invalidCliInputError(
      'ASHIBA_FEATURE_NAME_INVALID',
      'Feature name must use resource-action kebab-case, start with a letter, and look like users-insert.',
      'Rename the feature to resource-action kebab-case, for example users-insert.',
      { value },
    );
  }
  return normalized;
}

function normalizeQueryName(value: string | undefined): string {
  const normalized = (value ?? '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(normalized)) {
    throw invalidCliInputError(
      'ASHIBA_QUERY_NAME_INVALID',
      'Query name must use kebab-case, start with a letter, and look like insert-sales-detail.',
      'Pass a kebab-case query name that starts with a letter, for example insert-sales-detail.',
      { value },
    );
  }
  return normalized;
}

function deriveQueryName(tableName: string, action: FeatureAction): string {
  return action === 'get-by-id' || action === 'list' ? action : `${action}-${toKebab(tableName)}`;
}

function resolveBoundaryDir(rootDir: string, options: FeatureQueryScaffoldOptions): string {
  if (options.feature && options.boundaryDir) {
    throw invalidCliInputError(
      'ASHIBA_FEATURE_BOUNDARY_INPUT_CONFLICT',
      'Use either --feature or --boundary-dir, not both.',
      'Choose one boundary selector and rerun the command.',
      { options: ['--feature', '--boundary-dir'] },
    );
  }
  if (options.feature) return path.join(rootDir, 'src', 'features', normalizeFeatureName(options.feature));
  if (options.boundaryDir) return path.resolve(rootDir, options.boundaryDir);
  return options.workingDir ? path.resolve(options.workingDir) : process.cwd();
}

function resolveExplicitFeatureBoundaryDir(rootDir: string, feature: string | undefined, boundaryDir: string | undefined, commandLabel: string): string {
  if (feature && boundaryDir) {
    throw invalidCliInputError(
      'ASHIBA_FEATURE_BOUNDARY_INPUT_CONFLICT',
      'Use either --feature or --boundary-dir, not both.',
      'Choose one boundary selector and rerun the command.',
      { options: ['--feature', '--boundary-dir'] },
    );
  }
  if (boundaryDir) return path.resolve(rootDir, boundaryDir);
  if (feature) return path.join(rootDir, 'src', 'features', normalizeFeatureName(feature));
  throw invalidCliInputError(
    'ASHIBA_FEATURE_BOUNDARY_REQUIRED',
    `${commandLabel} requires --feature or --boundary-dir.`,
    'Pass --feature for a top-level feature, or --boundary-dir for a subgrouped feature boundary.',
    { options: ['--feature', '--boundary-dir'] },
  );
}

function resolvePrimaryKeyColumn(table: DdlTable): string {
  if (table.primaryKeyColumns.length === 0) {
    throw invalidCliInputError(
      'ASHIBA_FEATURE_PRIMARY_KEY_REQUIRED',
      `Table ${table.canonicalName} must declare exactly one primary key column in v1.`,
      'Add a single-column primary key to the DDL table or scaffold the query manually.',
      { table: table.canonicalName },
    );
  }
  if (table.primaryKeyColumns.length > 1) {
    throw invalidCliInputError(
      'ASHIBA_FEATURE_COMPOSITE_PRIMARY_KEY_UNSUPPORTED',
      `Composite primary keys are not supported in v1: ${table.canonicalName}.`,
      'Scaffold this query manually or adjust the v1 scaffold input to a table with one primary key column.',
      { table: table.canonicalName, primaryKeyColumns: table.primaryKeyColumns },
    );
  }
  return table.primaryKeyColumns[0];
}

function requireColumn(table: DdlTable, name: string): DdlColumn {
  const column = table.columns.find((candidate) => candidate.name === name);
  if (!column) {
    throw invalidCliInputError(
      'ASHIBA_FEATURE_COLUMN_NOT_FOUND',
      `Column ${name} was not found in ${table.canonicalName}.`,
      'Check the DDL table metadata and regenerate or adjust the scaffold input.',
      { table: table.canonicalName, column: name },
    );
  }
  return column;
}

function isGeneratedInsertColumn(column: DdlColumn, primaryKeyColumn: string): boolean {
  if (column.generated) return true;
  if (column.name !== primaryKeyColumn) return false;
  return /^(smallserial|serial|serial2|serial4|bigserial|serial8)$/i.test(column.typeName) || /^nextval\s*\(/i.test(column.defaultValue ?? '');
}

function toTsType(column: DdlColumn): string {
  const type = column.typeName.toLowerCase();
  const base = /^(smallint|integer|int|int2|int4|real|float|float4|float8|double precision|serial|serial2|serial4)$/.test(type)
    ? 'number'
    : /^(bigint|int8|bigserial|serial8|numeric|decimal)$/.test(type)
      ? 'string'
      : /^(boolean|bool)$/.test(type)
        ? 'boolean'
        : 'string';
  return column.nullable ? `${base} | null` : base;
}

function splitQualifiedName(value: string): [string, string] {
  const segments = value.split('.');
  if (segments.length === 1) return ['public', normalizeIdentifier(segments[0])];
  return [normalizeIdentifier(segments[0]), normalizeIdentifier(segments[1])];
}

function normalizeIdentifier(value: string): string {
  return value.trim().replace(/^"/, '').replace(/"$/, '');
}

function quoteQualifiedName(value: string): string {
  return value.split('.').map(quoteIdentifier).join('.');
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function toKebab(value: string): string {
  return normalizeIdentifier(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase();
}

function toPascal(value: string): string {
  return toKebab(value).split('-').map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join('');
}

function toCamel(value: string): string {
  const pascal = toPascal(value);
  return `${pascal.charAt(0).toLowerCase()}${pascal.slice(1)}`;
}

function featureNameFromBoundary(boundary: string): string {
  return boundary.split('/').filter(Boolean).at(-1) ?? 'feature';
}

function toProjectPath(rootDir: string, fullPath: string): string {
  return path.relative(rootDir, fullPath).replace(/\\/g, '/');
}

function requireValue(value: string | undefined, label: string): string {
  if (!value || value.trim().length === 0) throw requiredCliValueError(label);
  return value;
}
