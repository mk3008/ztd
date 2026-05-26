import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createTwoFilesPatch } from 'diff';
import {
  collectSupportedOptionalConditionBranches,
  SelectQueryParser,
  SSSQLFilterBuilder,
  SqlFormatter,
  type SssqlBranchInfo,
  type SssqlBranchKind,
  type SssqlRemoveSpec,
  type SssqlScaffoldFilters,
  type SssqlScaffoldSpec,
} from 'rawsql-ts';
import { invalidCliInputError } from '../../errors.js';

export interface SssqlRewriteOptions {
  out?: string;
  preview?: boolean;
}

export interface SssqlScaffoldOptions extends SssqlRewriteOptions {
  filters?: SssqlScaffoldFilters;
  spec?: SssqlScaffoldSpec;
}

export interface SssqlRemoveOptions extends SssqlRewriteOptions {
  all?: boolean;
  spec?: SssqlRemoveSpec;
}

export interface SssqlRewriteReport {
  commandName: string;
  file: string;
  output_file: string;
  preview: boolean;
  changed: boolean;
  written: boolean;
  sql: string;
  diff: string;
}

export function listSssqlBranches(sqlFile: string): SssqlBranchInfo[] {
  return new SSSQLFilterBuilder().list(readFileSync(path.resolve(sqlFile), 'utf8'));
}

/**
 * Adds SQL-first optional-condition SSSQL branches to a query file.
 */
export function addSssql(sqlFile: string, options: SssqlScaffoldOptions = {}): SssqlRewriteReport {
  return applySssqlScaffoldRewrite(sqlFile, 'query sssql add', options);
}

function applySssqlScaffoldRewrite(
  sqlFile: string,
  commandName: string,
  options: SssqlScaffoldOptions
): SssqlRewriteReport {
  return applySssqlRewrite(sqlFile, commandName, options, (sql) => {
    const builder = new SSSQLFilterBuilder();
    if (options.spec) {
      return builder.scaffoldBranch(sql, options.spec);
    }
    return builder.scaffold(sql, options.filters ?? {});
  });
}

export function refreshSssql(sqlFile: string, options: SssqlRewriteOptions = {}): SssqlRewriteReport {
  return applySssqlRewrite(sqlFile, 'query sssql refresh', options, (sql) => {
    const parsed = SelectQueryParser.parse(sql);
    const existingBranches = collectSupportedOptionalConditionBranches(parsed);
    const filters = Object.fromEntries(existingBranches.map((branch) => [branch.parameterName, null]));
    return new SSSQLFilterBuilder().refresh(parsed, filters);
  });
}

export function removeSssql(sqlFile: string, options: SssqlRemoveOptions): SssqlRewriteReport {
  return applySssqlRewrite(sqlFile, 'query sssql remove', options, (sql) => {
    const builder = new SSSQLFilterBuilder();
    if (options.all) {
      return builder.removeAll(sql);
    }
    if (!options.spec) {
      throw invalidCliInputError(
        'ASHIBA_QUERY_SSSQL_REMOVE_TARGET_REQUIRED',
        'query sssql remove requires either --all or --parameter.',
        'Pass --all to remove all supported branches, or pass --parameter for the branch to remove.',
      );
    }
    return builder.remove(sql, options.spec);
  });
}

export function normalizeSssqlBranchKind(value: string): SssqlBranchKind {
  if (value === 'scalar' || value === 'exists' || value === 'not-exists' || value === 'expression') {
    return value;
  }
  throw invalidCliInputError(
    'ASHIBA_QUERY_SSSQL_BRANCH_KIND_UNSUPPORTED',
    `Unsupported SSSQL branch kind: ${value}.`,
    'Use scalar, exists, not-exists, or expression as the SSSQL branch kind.',
    { value, supported: ['scalar', 'exists', 'not-exists', 'expression'] },
  );
}

function applySssqlRewrite(
  sqlFile: string,
  commandName: string,
  options: SssqlRewriteOptions,
  transform: (sql: string) => unknown
): SssqlRewriteReport {
  const absoluteInputPath = path.resolve(sqlFile);
  const originalSql = readFileSync(absoluteInputPath, 'utf8');
  const transformed = transform(originalSql);
  const formatted = new SqlFormatter().format(transformed as never).formattedSql;
  const updatedSql = `${formatted}\n`;
  assertNoCommentLoss(originalSql, updatedSql, commandName);

  SelectQueryParser.parse(updatedSql);

  const preview = Boolean(options.preview);
  const outputFile = path.resolve(options.out ?? absoluteInputPath);
  const changed = normalizeLineEndings(originalSql) !== normalizeLineEndings(updatedSql);
  const diff = createTwoFilesPatch(
    normalizePath(absoluteInputPath),
    normalizePath(outputFile),
    normalizeLineEndings(originalSql),
    normalizeLineEndings(updatedSql),
    '',
    '',
    { context: 3 }
  );

  if (!preview) {
    mkdirSync(path.dirname(outputFile), { recursive: true });
    writeFileSync(outputFile, updatedSql, 'utf8');
  }

  return {
    commandName,
    file: absoluteInputPath,
    output_file: outputFile,
    preview,
    changed,
    written: !preview,
    sql: formatted,
    diff,
  };
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

function normalizePath(value: string): string {
  return value.split(path.sep).join('/');
}

function assertNoCommentLoss(before: string, after: string, commandName: string): void {
  const beforeComments = extractSqlCommentFragments(before);
  if (beforeComments.length === 0) {
    return;
  }

  const normalizedAfter = normalizeLineEndings(after);
  const missing = beforeComments.filter((comment) => !normalizedAfter.includes(comment));
  if (missing.length > 0) {
    throw invalidCliInputError(
      'ASHIBA_QUERY_SSSQL_COMMENT_LOSS',
      `${commandName} would drop SQL comments during rewrite. Remove or relocate the comments before applying this command.`,
      'Move or remove the listed SQL comments, then rerun the rewrite command so Ashiba does not silently discard review context.',
      { commandName, missingComments: missing },
    );
  }
}

function extractSqlCommentFragments(sql: string): string[] {
  const normalized = normalizeLineEndings(sql);
  const lineMatches = normalized.match(/--.*$/gm) ?? [];
  const blockMatches = normalized.match(/\/\*[\s\S]*?\*\//g) ?? [];
  return [...lineMatches, ...blockMatches].map((comment) => comment.trim()).filter(Boolean);
}
