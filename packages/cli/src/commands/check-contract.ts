import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Command } from 'commander';
import { compileNamedParameters } from '../parameter-metadata.js';
import { runFeatureGeneratedMapperCheck, type FeatureGeneratedMapperCheckResult } from './feature.js';
import {
  analyzeQueryModel,
  buildPostgresOptionalConditionCompressionBindingMetadata,
  buildQueryResultColumnContracts,
} from './model-gen.js';
import {
  discoverProjectSqlCatalogSpecFiles,
  loadSqlCatalogSpecsFromFile,
  type LoadedSqlCatalogSpec,
} from '../sqlgrep/utils/sqlCatalogDiscovery.js';
import { invalidCliInputError } from '../errors.js';

export interface CheckContractOptions {
  rootDir?: string;
  feature?: string;
  query?: string;
  scopeDir?: string;
  sqlRoot?: string;
  format?: 'text' | 'json';
}

export interface CheckContractResult {
  rootDir: string;
  mapperCheck: FeatureGeneratedMapperCheckResult;
  catalogCheck: CatalogContractCheckResult;
  attainment: CheckContractAttainment;
  ok: boolean;
}

export interface CheckContractAttainment {
  overall: 'done' | 'partial' | 'not done';
  mapper: 'done' | 'partial' | 'not done' | 'skipped';
  catalog: 'done' | 'partial' | 'not done' | 'skipped';
  issueCount: number;
  nextActions: string[];
}

export interface CatalogContractCheckResult {
  checked: Array<{
    catalogId: string;
    specFile: string;
    sqlFile: string | null;
    declaredParameters: string[];
    sqlParameters: string[];
    declaredResultColumns: string[];
    sqlResultColumns: string[];
    declaredResultColumnTypes: Record<string, string>;
    sqlResultColumnTypes: Record<string, string>;
    queryModelSourceHash?: string;
    bindingSourceHash?: string;
    missingInSpec: string[];
    unusedInSpec: string[];
    missingResultInSpec: string[];
    unusedResultInSpec: string[];
    missingResultTypeInSpec: string[];
    unusedResultTypeInSpec: string[];
    mismatchedResultTypeInSpec: string[];
    issues: string[];
  }>;
  warnings: string[];
  ok: boolean;
}

/**
 * Registers the contract drift check command for feature query boundaries.
 */
export function registerCheckContractCommand(program: Command): void {
  program
    .command('check-contract')
    .description('Check visible SQL contracts against editable generated mapper boundaries')
    .option('--root-dir <path>', 'Project root directory', '.')
    .option('--feature <name>', 'Limit check to one feature')
    .option('--query <name>', 'Limit check to one query boundary')
    .option('--scope-dir <path>', 'Limit QuerySpec-like catalog checks to one subtree')
    .option('--sql-root <path>', 'Fallback root for shared sqlFile layouts')
    .option('--format <format>', 'Output format: text or json', 'text')
    .action((options: CheckContractOptions) => {
      const result = runCheckContract(options);
      if (options.format === 'json') {
        process.stdout.write(`${JSON.stringify({ kind: 'check-contract', ...result }, null, 2)}\n`);
      } else {
        process.stdout.write(formatCheckContractResult(result));
      }
      if (!result.ok) process.exitCode = 1;
    });
}

/**
 * Checks visible SQL, generated query metadata, and query boundary contracts for drift.
 */
export function runCheckContract(options: CheckContractOptions = {}): CheckContractResult {
  const rootDir = path.resolve(options.rootDir ?? '.');
  const mapperCheck = runOptionalFeatureGeneratedMapperCheck({
    rootDir: options.rootDir,
    feature: options.feature,
    query: options.query,
  });
  const catalogCheck = runCatalogContractCheck({
    rootDir,
    scopeDir: options.scopeDir,
    sqlRoot: options.sqlRoot,
  });
  return {
    rootDir,
    mapperCheck,
    catalogCheck,
    attainment: buildCheckContractAttainment(mapperCheck, catalogCheck),
    ok: mapperCheck.ok && catalogCheck.ok,
  };
}

/**
 * Formats contract drift check results for human-readable CLI output.
 */
export function formatCheckContractResult(result: CheckContractResult): string {
  const lines = [`Ashiba contract check: ${result.ok ? 'ok' : 'failed'}`];
  lines.push(`Attainment: ${result.attainment.overall}`);
  if (result.attainment.nextActions.length > 0) {
    for (const action of result.attainment.nextActions) {
      lines.push(`Next: ${action}`);
    }
  }
  if (result.mapperCheck.checked.length === 0) {
    lines.push('', 'Feature query boundary contracts: skipped');
  }
  for (const entry of result.mapperCheck.checked) {
    lines.push('', `- ${entry.feature}/${entry.query}`);
    if (entry.missingInMapper.length === 0 && entry.unusedInMapper.length === 0) {
      lines.push('  named parameters: ok');
    } else {
      if (entry.missingInMapper.length > 0) {
        lines.push(`  missing in mapper: ${entry.missingInMapper.join(', ')}`);
      }
      if (entry.unusedInMapper.length > 0) {
        lines.push(`  unused in mapper: ${entry.unusedInMapper.join(', ')}`);
      }
    }

    if (entry.missingResultInMapper.length === 0 && entry.unusedResultInMapper.length === 0) {
      lines.push('  result columns: ok');
    } else {
      if (entry.missingResultInMapper.length > 0) {
        lines.push(`  missing result in mapper: ${entry.missingResultInMapper.join(', ')}`);
      }
      if (entry.unusedResultInMapper.length > 0) {
        lines.push(`  unused result in mapper: ${entry.unusedResultInMapper.join(', ')}`);
      }
    }
  }
  lines.push('', `QuerySpec-like catalog contracts: ${result.catalogCheck.ok ? 'ok' : 'failed'}`);
  if (result.catalogCheck.checked.length === 0) {
    lines.push('- checked: 0');
  }
  for (const entry of result.catalogCheck.checked) {
    lines.push('', `- ${entry.catalogId}`);
    lines.push(`  spec: ${entry.specFile}`);
    lines.push(`  sql: ${entry.sqlFile ?? '(unresolved)'}`);
    if (entry.issues.length > 0) {
      for (const issue of entry.issues) {
        lines.push(`  issue: ${issue}`);
      }
    } else {
      lines.push('  sql file: ok');
    }
    if (entry.missingInSpec.length === 0 && entry.unusedInSpec.length === 0) {
      lines.push('  catalog parameters: ok');
    } else {
      if (entry.missingInSpec.length > 0) {
        lines.push(`  missing in catalog: ${entry.missingInSpec.join(', ')}`);
      }
      if (entry.unusedInSpec.length > 0) {
        lines.push(`  unused in catalog: ${entry.unusedInSpec.join(', ')}`);
      }
    }
    if (entry.declaredResultColumns.length > 0) {
      if (entry.missingResultInSpec.length === 0 && entry.unusedResultInSpec.length === 0) {
        lines.push('  catalog result columns: ok');
      } else {
        if (entry.missingResultInSpec.length > 0) {
          lines.push(`  missing result in catalog: ${entry.missingResultInSpec.join(', ')}`);
        }
        if (entry.unusedResultInSpec.length > 0) {
          lines.push(`  unused result in catalog: ${entry.unusedResultInSpec.join(', ')}`);
        }
      }
    }
    if (Object.keys(entry.declaredResultColumnTypes).length > 0) {
      if (
        entry.missingResultTypeInSpec.length === 0 &&
        entry.unusedResultTypeInSpec.length === 0 &&
        entry.mismatchedResultTypeInSpec.length === 0
      ) {
        lines.push('  catalog result types: ok');
      } else {
        if (entry.missingResultTypeInSpec.length > 0) {
          lines.push(`  missing result type in catalog: ${entry.missingResultTypeInSpec.join(', ')}`);
        }
        if (entry.unusedResultTypeInSpec.length > 0) {
          lines.push(`  unused result type in catalog: ${entry.unusedResultTypeInSpec.join(', ')}`);
        }
        if (entry.mismatchedResultTypeInSpec.length > 0) {
          lines.push(`  mismatched result type in catalog: ${entry.mismatchedResultTypeInSpec.join(', ')}`);
        }
      }
    }
    if (entry.queryModelSourceHash || entry.bindingSourceHash) {
      lines.push('  query model metadata: checked');
    }
  }
  for (const warning of result.catalogCheck.warnings) {
    lines.push(`- warning: ${warning}`);
  }
  return `${lines.join('\n')}\n`;
}

function buildCheckContractAttainment(
  mapperCheck: FeatureGeneratedMapperCheckResult,
  catalogCheck: CatalogContractCheckResult,
): CheckContractAttainment {
  const mapper = mapperCheck.checked.length === 0 ? 'skipped' : mapperCheck.ok ? 'done' : 'partial';
  const catalog = catalogCheck.checked.length === 0 && catalogCheck.warnings.length === 0
    ? 'skipped'
    : catalogCheck.ok
      ? 'done'
      : 'partial';
  const issueCount = countMapperIssues(mapperCheck) + countCatalogIssues(catalogCheck);
  const checkedAny = mapperCheck.checked.length > 0 || catalogCheck.checked.length > 0 || catalogCheck.warnings.length > 0;
  const overall = !checkedAny
    ? 'not done'
    : issueCount === 0
      ? 'done'
      : 'partial';
  return {
    overall,
    mapper,
    catalog,
    issueCount,
    nextActions: buildCheckContractNextActions(mapperCheck, catalogCheck),
  };
}

function countMapperIssues(mapperCheck: FeatureGeneratedMapperCheckResult): number {
  return mapperCheck.checked.reduce((sum, entry) =>
    sum +
    entry.missingInMapper.length +
    entry.unusedInMapper.length +
    entry.missingResultInMapper.length +
    entry.unusedResultInMapper.length,
  0);
}

function countCatalogIssues(catalogCheck: CatalogContractCheckResult): number {
  return catalogCheck.warnings.length + catalogCheck.checked.reduce((sum, entry) =>
    sum +
    entry.issues.length +
    entry.missingInSpec.length +
    entry.unusedInSpec.length +
    entry.missingResultInSpec.length +
    entry.unusedResultInSpec.length +
    entry.missingResultTypeInSpec.length +
    entry.unusedResultTypeInSpec.length +
    entry.mismatchedResultTypeInSpec.length,
  0);
}

function buildCheckContractNextActions(
  mapperCheck: FeatureGeneratedMapperCheckResult,
  catalogCheck: CatalogContractCheckResult,
): string[] {
  const actions = new Set<string>();
  for (const entry of mapperCheck.checked) {
    if (entry.missingInMapper.length > 0 || entry.unusedInMapper.length > 0) {
      actions.add('Update editable query boundary parameter contracts to match visible SQL named parameters.');
    }
    if (entry.missingResultInMapper.length > 0 || entry.unusedResultInMapper.length > 0) {
      actions.add('Update editable query boundary row contracts to match visible SQL result columns.');
    }
  }
  if (catalogCheck.warnings.length > 0) {
    actions.add('Fix QuerySpec discovery warnings before relying on catalog contract coverage.');
  }
  for (const entry of catalogCheck.checked) {
    if (entry.issues.some((issue) => issue.includes('sourceHash') || issue.includes('is stale'))) {
      actions.add('Regenerate query model metadata from the current visible SQL.');
    }
    if (entry.issues.some((issue) => issue.includes('sqlFile') || issue.includes('SQL file'))) {
      actions.add('Fix QuerySpec sqlFile paths so every catalog entry points at visible SQL.');
    }
    if (entry.missingInSpec.length > 0 || entry.unusedInSpec.length > 0) {
      actions.add('Update QuerySpec parameter contracts to match visible SQL named parameters.');
    }
    if (entry.missingResultInSpec.length > 0 || entry.unusedResultInSpec.length > 0) {
      actions.add('Update QuerySpec result column contracts to match visible SQL result columns.');
    }
    if (
      entry.missingResultTypeInSpec.length > 0 ||
      entry.unusedResultTypeInSpec.length > 0 ||
      entry.mismatchedResultTypeInSpec.length > 0
    ) {
      actions.add('Update QuerySpec result column type contracts or regenerate model-gen output.');
    }
  }
  return [...actions];
}

function runOptionalFeatureGeneratedMapperCheck(options: {
  rootDir?: string;
  feature?: string;
  query?: string;
}): FeatureGeneratedMapperCheckResult {
  try {
    return runFeatureGeneratedMapperCheck(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('No feature query boundaries were discovered') || message.includes('No src/features directory was discovered')) {
      return {
        rootDir: path.resolve(options.rootDir ?? '.'),
        checked: [],
        ok: true,
      };
    }
    throw error;
  }
}

function runCatalogContractCheck(options: {
  rootDir: string;
  scopeDir?: string;
  sqlRoot?: string;
}): CatalogContractCheckResult {
  const scopeRoot = options.scopeDir ? path.resolve(options.rootDir, options.scopeDir) : options.rootDir;
  if (!existsSync(scopeRoot)) {
    return {
      checked: [],
      warnings: [`QuerySpec scope does not exist: ${normalizePath(path.relative(options.rootDir, scopeRoot))}.`],
      ok: false,
    };
  }
  const specFiles = discoverProjectSqlCatalogSpecFiles(scopeRoot, { excludeGenerated: false, excludeTestFiles: true });
  const checked: CatalogContractCheckResult['checked'] = [];
  const warnings: string[] = [];

  for (const specFile of specFiles) {
    let loadedSpecs: LoadedSqlCatalogSpec[];
    try {
      loadedSpecs = loadSqlCatalogSpecsFromFile(specFile, (message) => invalidCliInputError(
        'ASHIBA_QUERY_SPEC_LOAD_FAILED',
        message,
        'Fix the QuerySpec/catalog file so Ashiba can load it, or remove the broken file from the query scope.',
        { specFile: normalizePath(path.relative(options.rootDir, specFile)) },
      ));
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
      continue;
    }

    for (const loaded of loadedSpecs) {
      const catalogId = typeof loaded.spec.id === 'string' && loaded.spec.id.trim().length > 0
        ? loaded.spec.id.trim()
        : normalizePath(path.relative(options.rootDir, loaded.filePath));
      const declaredParameters = readDeclaredParameters(loaded);
      const declaredResultColumns = readDeclaredResultColumns(loaded);
      const declaredResultColumnTypes = readDeclaredResultColumnTypes(loaded);
      const sqlFileValue = typeof loaded.spec.sqlFile === 'string' ? loaded.spec.sqlFile.trim() : '';
      const resolvedSql = sqlFileValue.length > 0
        ? resolveSqlFile({
          rootDir: options.rootDir,
          specFilePath: loaded.filePath,
          sqlFile: sqlFileValue,
          sqlRoot: options.sqlRoot,
        })
        : undefined;
      const issues: string[] = [];
      let sqlParameters: string[] = [];
      let sqlResultColumns: string[] = [];
      let sqlResultColumnTypes: Record<string, string> = {};
      let queryModelSourceHash: string | undefined;
      let bindingSourceHash: string | undefined;
      if (!sqlFileValue) {
        issues.push('spec.sqlFile must be a non-empty string.');
      } else if (!resolvedSql) {
        issues.push(`SQL file does not exist: ${sqlFileValue}.`);
      } else {
        const sql = readFileSync(resolvedSql, 'utf8');
        const compiled = compileNamedParameters(sql, { placeholderStyle: 'postgres' });
        const orderedUniqueSqlParameters = [...new Set(compiled.orderedNames)];
        sqlParameters = [...orderedUniqueSqlParameters].sort();
        const resultColumnContracts = buildQueryResultColumnContracts(sql, options.rootDir);
        sqlResultColumns = resultColumnContracts.map((column) => column.name).sort();
        sqlResultColumnTypes = Object.fromEntries(
          resultColumnContracts.map((column) => [column.name, column.type]).sort(([left], [right]) => left.localeCompare(right))
        );
        const metadata = extractQueryModelMetadata(loaded.filePath);
        if (metadata.hasInlineQueryModel) {
          issues.push('queryModel metadata must be stored in generated/query.meta.ts, not mixed into the editable contract file.');
        }
        if (metadata.requiresMetadataFile && !metadata.hasQueryModel) {
          issues.push(`${metadata.expectedMetadataFile ?? 'generated/query.meta.ts'} is required for queryModel metadata but was not found.`);
        }
        const checksSssqlCompression = metadata.analysisSssqlCompressionJson !== undefined
          || metadata.bindingSssqlCompressionJson !== undefined;
        const currentAnalysis = analyzeQueryModel(sql, orderedUniqueSqlParameters, resultColumnContracts, {
          sssqlCompression: checksSssqlCompression,
        });
        queryModelSourceHash = metadata.queryModelSourceHash;
        bindingSourceHash = metadata.bindingSourceHash;
        if (metadata.hasQueryModel) {
          const currentHash = hashSql(sql);
          if (!metadata.queryModelSourceHash) {
            issues.push('queryModel.analysis.sourceHash is missing.');
          } else if (metadata.queryModelSourceHash !== currentHash) {
            issues.push('queryModel.analysis.sourceHash is stale.');
          }
          if (!metadata.rootQueryShape) {
            issues.push('queryModel.analysis.rootQueryShape is missing.');
          } else if (metadata.rootQueryShape !== currentAnalysis.rootQueryShape) {
            issues.push('queryModel.analysis.rootQueryShape is stale.');
          }
          if (!metadata.astParse) {
            issues.push('queryModel.analysis.astParse is missing.');
          } else if (metadata.astParse !== currentAnalysis.astParse) {
            issues.push('queryModel.analysis.astParse is stale.');
          }
          if (!metadata.statementKind) {
            issues.push('queryModel.analysis.statementKind is missing.');
          } else if (metadata.statementKind !== currentAnalysis.statementKind) {
            issues.push('queryModel.analysis.statementKind is stale.');
          }
          if (metadata.hasTopLevelOrderBy === undefined) {
            issues.push('queryModel.analysis.hasTopLevelOrderBy is missing.');
          } else if (metadata.hasTopLevelOrderBy !== currentAnalysis.hasTopLevelOrderBy) {
            issues.push('queryModel.analysis.hasTopLevelOrderBy is stale.');
          }
          if (
            metadata.analysisNamedParameters.length > 0 &&
            JSON.stringify(metadata.analysisNamedParameters) !== JSON.stringify(currentAnalysis.namedParameters)
          ) {
            issues.push('queryModel.analysis.namedParameters is stale.');
          }
          if (
            metadata.analysisResultColumns.length > 0 &&
            JSON.stringify(metadata.analysisResultColumns) !== JSON.stringify(currentAnalysis.resultColumns)
          ) {
            issues.push('queryModel.analysis.resultColumns is stale.');
          }
          if (!metadata.analysisResultColumnTypesJson) {
            issues.push('queryModel.analysis.resultColumnTypes is missing.');
          } else if (metadata.analysisResultColumnTypesJson !== JSON.stringify(currentAnalysis.resultColumnTypes)) {
            issues.push('queryModel.analysis.resultColumnTypes is stale.');
          }
          if (!metadata.analysisSafeSortJson) {
            issues.push('queryModel.analysis.safeSort is missing.');
          } else if (metadata.analysisSafeSortJson !== JSON.stringify(currentAnalysis.safeSort)) {
            issues.push('queryModel.analysis.safeSort is stale.');
          }
          if (checksSssqlCompression) {
            if (!metadata.analysisSssqlCompressionJson) {
              issues.push('queryModel.analysis.sssqlCompression is missing.');
            } else if (metadata.analysisSssqlCompressionJson !== JSON.stringify(currentAnalysis.sssqlCompression)) {
              issues.push('queryModel.analysis.sssqlCompression is stale.');
            }
          }
          if (!metadata.bindingSourceHash) {
            issues.push('queryModel.bindings.postgres.sourceHash is missing.');
          } else if (metadata.bindingSourceHash !== currentHash) {
            issues.push('queryModel.bindings.postgres.sourceHash is stale.');
          }
          if (metadata.bindingSql && metadata.bindingSql !== compiled.sql) {
            issues.push('queryModel.bindings.postgres.sql is stale.');
          }
          if (
            metadata.bindingOrderedNames.length > 0 &&
            JSON.stringify(metadata.bindingOrderedNames) !== JSON.stringify(compiled.orderedNames)
          ) {
            issues.push('queryModel.bindings.postgres.orderedNames is stale.');
          }
          if (checksSssqlCompression) {
            const currentBindingSssqlCompression = buildPostgresOptionalConditionCompressionBindingMetadata(
              sql,
              currentAnalysis.sssqlCompression,
            ).sssqlCompression;
            if (!metadata.bindingSssqlCompressionJson) {
              issues.push('queryModel.bindings.postgres.sssqlCompression is missing.');
            } else if (metadata.bindingSssqlCompressionJson !== JSON.stringify(currentBindingSssqlCompression)) {
              issues.push('queryModel.bindings.postgres.sssqlCompression is stale.');
            }
          }
        }
      }
      const missingInSpec = declaredParameters.length > 0
        ? sqlParameters.filter((parameter) => !declaredParameters.includes(parameter))
        : [];
      const unusedInSpec = declaredParameters.filter((parameter) => !sqlParameters.includes(parameter));
      const missingResultInSpec = declaredResultColumns.length > 0
        ? sqlResultColumns.filter((column) => !declaredResultColumns.includes(column))
        : [];
      const unusedResultInSpec = declaredResultColumns.filter((column) => !sqlResultColumns.includes(column));
      const declaredResultTypeNames = Object.keys(declaredResultColumnTypes).sort();
      const sqlResultTypeNames = Object.keys(sqlResultColumnTypes).sort();
      const missingResultTypeInSpec = declaredResultTypeNames.length > 0
        ? sqlResultTypeNames.filter((column) => !declaredResultTypeNames.includes(column))
        : [];
      const unusedResultTypeInSpec = declaredResultTypeNames.filter((column) => !sqlResultTypeNames.includes(column));
      const mismatchedResultTypeInSpec = declaredResultTypeNames
        .filter((column) => sqlResultColumnTypes[column] && declaredResultColumnTypes[column] !== sqlResultColumnTypes[column])
        .map((column) => `${column}: expected ${declaredResultColumnTypes[column]}, actual ${sqlResultColumnTypes[column]}`);
      checked.push({
        catalogId,
        specFile: normalizePath(path.relative(options.rootDir, loaded.filePath)),
        sqlFile: resolvedSql ? normalizePath(path.relative(options.rootDir, resolvedSql)) : null,
        declaredParameters,
        sqlParameters,
        declaredResultColumns,
        sqlResultColumns,
        declaredResultColumnTypes,
        sqlResultColumnTypes,
        queryModelSourceHash,
        bindingSourceHash,
        missingInSpec,
        unusedInSpec,
        missingResultInSpec,
        unusedResultInSpec,
        missingResultTypeInSpec,
        unusedResultTypeInSpec,
        mismatchedResultTypeInSpec,
        issues,
      });
    }
  }

  return {
    checked,
    warnings,
    ok: warnings.length === 0 && checked.every((entry) =>
      entry.issues.length === 0
      && entry.missingInSpec.length === 0
      && entry.unusedInSpec.length === 0
      && entry.missingResultInSpec.length === 0
      && entry.unusedResultInSpec.length === 0
      && entry.missingResultTypeInSpec.length === 0
      && entry.unusedResultTypeInSpec.length === 0
      && entry.mismatchedResultTypeInSpec.length === 0
    ),
  };
}

function extractQueryModelMetadata(specFilePath: string): {
  hasQueryModel: boolean;
  queryModelSourceHash?: string;
  bindingSourceHash?: string;
  rootQueryShape?: string;
  astParse?: string;
  statementKind?: string;
  hasTopLevelOrderBy?: boolean;
  analysisNamedParameters: string[];
  analysisResultColumns: string[];
  analysisResultColumnTypesJson?: string;
  analysisSafeSortJson?: string;
  analysisSssqlCompressionJson?: string;
  bindingSql?: string;
  bindingOrderedNames: string[];
  bindingSssqlCompressionJson?: string;
  hasInlineQueryModel?: boolean;
  requiresMetadataFile?: boolean;
  expectedMetadataFile?: string;
} {
  const specSource = readFileSync(specFilePath, 'utf8');
  const metadataImport = extractGeneratedMetadataImport(specSource);
  const metadataRelativePath = metadataImport
    ? metadataImport.replace(/^\.\//, '').replace(/\.js$/, '.ts')
    : path.join('generated', 'query.meta.ts');
  const metadataPath = path.join(path.dirname(specFilePath), metadataRelativePath);
  const hasMetadataFile = existsSync(metadataPath);
  const source = hasMetadataFile ? readFileSync(metadataPath, 'utf8') : '';
  const hasInlineQueryModel = /export\s+const\s+queryModel\s*=/.test(specSource);
  const requiresMetadataFile = Boolean(metadataImport) || /\bqueryModel\.analysis\b/.test(specSource);
  const hasQueryModel = /\bqueryModel\b/.test(source);
  if (!hasQueryModel) {
    return {
      hasQueryModel: false,
      hasInlineQueryModel,
      requiresMetadataFile,
      expectedMetadataFile: normalizePath(metadataRelativePath),
      analysisNamedParameters: [],
      analysisResultColumns: [],
      bindingOrderedNames: [],
    };
  }

  const analysisObject = parseObjectLiteralAfter(source, 'analysis:')
    ?? parseObjectLiteralAfter(source, '"analysis":');
  const analysisBlock = stringifyRecord(analysisObject);
  const queryModelSourceHash = readStringProperty(analysisObject, 'sourceHash')
    ?? source.match(/"sourceHash"\s*:\s*"([^"]+)"/)?.[1];
  const rootQueryShape = readStringProperty(analysisObject, 'rootQueryShape')
    ?? source.match(/"rootQueryShape"\s*:\s*"([^"]+)"/)?.[1];
  const astParse = readStringProperty(analysisObject, 'astParse')
    ?? source.match(/"astParse"\s*:\s*"([^"]+)"/)?.[1];
  const statementKind = readStringProperty(analysisObject, 'statementKind')
    ?? source.match(/"statementKind"\s*:\s*"([^"]+)"/)?.[1];
  const hasTopLevelOrderBy = readBooleanProperty(analysisObject, 'hasTopLevelOrderBy')
    ?? readBooleanLiteral(source, 'hasTopLevelOrderBy');
  const analysisNamedParameters = readStringArrayProperty(analysisObject, 'namedParameters')
    ?? extractStringArray(analysisBlock, 'namedParameters');
  const analysisResultColumns = readStringArrayProperty(analysisObject, 'resultColumns')
    ?? extractStringArray(analysisBlock, 'resultColumns');
  const analysisResultColumnTypesJson = analysisObject && Object.prototype.hasOwnProperty.call(analysisObject, 'resultColumnTypes')
    ? JSON.stringify(analysisObject.resultColumnTypes)
    : undefined;
  const analysisSafeSortJson = analysisObject && Object.prototype.hasOwnProperty.call(analysisObject, 'safeSort')
    ? JSON.stringify(analysisObject.safeSort)
    : undefined;
  const analysisSssqlCompressionJson = analysisObject && Object.prototype.hasOwnProperty.call(analysisObject, 'sssqlCompression')
    ? JSON.stringify(analysisObject.sssqlCompression)
    : undefined;
  const bindingsObject = parseObjectLiteralAfter(source, 'bindings:')
    ?? parseObjectLiteralAfter(source, '"bindings":');
  const postgresObject = isRecord(bindingsObject?.postgres) ? bindingsObject.postgres : undefined;
  const postgresBlock = stringifyRecord(postgresObject);
  const bindingSourceHash = readStringProperty(postgresObject, 'sourceHash')
    ?? postgresBlock.match(/"sourceHash"\s*:\s*"([^"]+)"/)?.[1];
  const rawBindingSql = postgresBlock.match(/"sql"\s*:\s*"((?:\\.|[^"\\])*)"/)?.[1];
  const bindingSql = rawBindingSql ? JSON.parse(`"${rawBindingSql}"`) as string : undefined;
  const bindingOrderedNames = readStringArrayProperty(postgresObject, 'orderedNames')
    ?? extractStringArray(postgresBlock, 'orderedNames');
  const bindingSssqlCompressionJson = postgresObject && Object.prototype.hasOwnProperty.call(postgresObject, 'sssqlCompression')
    ? JSON.stringify(postgresObject.sssqlCompression)
    : undefined;

  return {
    hasQueryModel,
    queryModelSourceHash,
    bindingSourceHash,
    rootQueryShape,
    astParse,
    statementKind,
    hasTopLevelOrderBy,
    analysisNamedParameters,
    analysisResultColumns,
    analysisResultColumnTypesJson,
    analysisSafeSortJson,
    analysisSssqlCompressionJson,
    bindingSql,
    bindingOrderedNames,
    bindingSssqlCompressionJson,
    hasInlineQueryModel,
    requiresMetadataFile,
    expectedMetadataFile: normalizePath(metadataRelativePath),
  };
}

function extractGeneratedMetadataImport(source: string): string | undefined {
  return source.match(/import\s+\{\s*queryModel\s*\}\s+from\s+['"](\.\/generated\/[^'"]+\.meta\.js)['"]/)?.[1];
}

function parseObjectLiteralAfter(source: string, marker: string): Record<string, unknown> | undefined {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return undefined;
  const objectStart = source.indexOf('{', markerIndex + marker.length);
  if (objectStart < 0) return undefined;
  const objectEnd = findMatchingBrace(source, objectStart);
  if (objectEnd < 0) return undefined;
  try {
    const parsed = JSON.parse(source.slice(objectStart, objectEnd + 1)) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function findMatchingBrace(source: string, start: number): number {
  let depth = 0;
  let quote: '"' | undefined;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === '"') {
      quote = '"';
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringifyRecord(value: Record<string, unknown> | undefined): string {
  return value ? JSON.stringify(value) : '';
}

function readStringProperty(value: Record<string, unknown> | undefined, propertyName: string): string | undefined {
  const raw = value?.[propertyName];
  return typeof raw === 'string' ? raw : undefined;
}

function readStringArrayProperty(value: Record<string, unknown> | undefined, propertyName: string): string[] | undefined {
  const raw = value?.[propertyName];
  return Array.isArray(raw) && raw.every((entry) => typeof entry === 'string')
    ? raw
    : undefined;
}

function readBooleanProperty(value: Record<string, unknown> | undefined, propertyName: string): boolean | undefined {
  const raw = value?.[propertyName];
  return typeof raw === 'boolean' ? raw : undefined;
}

function readBooleanLiteral(source: string, propertyName: string): boolean | undefined {
  const match = source.match(new RegExp(`"${propertyName}"\\s*:\\s*(true|false)`));
  return match ? match[1] === 'true' : undefined;
}

function extractStringArray(block: string, propertyName: string): string[] {
  const match = block.match(new RegExp(`"${propertyName}"\\s*:\\s*\\[([\\s\\S]*?)\\]`));
  if (!match) {
    return [];
  }
  return [...(match[1] ?? '').matchAll(/"([^"]+)"/g)].map((entry) => entry[1]).filter(Boolean);
}

function hashSql(sql: string): string {
  return `sha256:${createHash('sha256').update(sql).digest('hex')}`;
}

function readDeclaredParameters(loaded: LoadedSqlCatalogSpec): string[] {
  if (Array.isArray(loaded.spec.parameters)) {
    return loaded.spec.parameters.filter((value): value is string => typeof value === 'string').sort();
  }
  const example = loaded.spec.params?.example;
  if (example && typeof example === 'object' && !Array.isArray(example)) {
    return Object.keys(example).sort();
  }
  return [];
}

function readDeclaredResultColumns(loaded: LoadedSqlCatalogSpec): string[] {
  if (Array.isArray(loaded.spec.resultColumns)) {
    return loaded.spec.resultColumns.filter((value): value is string => typeof value === 'string').sort();
  }
  return [];
}

function readDeclaredResultColumnTypes(loaded: LoadedSqlCatalogSpec): Record<string, string> {
  if (!loaded.spec.resultColumnTypes || typeof loaded.spec.resultColumnTypes !== 'object' || Array.isArray(loaded.spec.resultColumnTypes)) {
    return {};
  }
  return Object.fromEntries(Object.entries(loaded.spec.resultColumnTypes)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .sort(([left], [right]) => left.localeCompare(right)));
}

function resolveSqlFile(params: {
  rootDir: string;
  specFilePath: string;
  sqlFile: string;
  sqlRoot?: string;
}): string | undefined {
  const candidates = [
    path.resolve(path.dirname(params.specFilePath), params.sqlFile),
    path.resolve(params.rootDir, params.sqlFile),
    ...(params.sqlRoot ? [path.resolve(params.rootDir, params.sqlRoot, params.sqlFile)] : []),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}
