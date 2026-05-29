import { createHash } from 'node:crypto';
import {
  type AshibaMaskPolicy,
  type AshibaQueryModelAnalysis,
  type AshibaSortInput,
  type AshibaSortProfile,
  type AshibaSqlExecutionMetadata,
  type AshibaSqlExecutionObserver,
  AshibaSortError,
  maskParams,
  normalizeError,
  renderSafeOrderBy,
} from '@ashiba/driver-adapter-core';

/**
 * Minimal pg-compatible query result consumed by the adapter.
 */
export type NodePostgresQueryResult<Row = unknown> = {
  rows: Row[];
  rowCount?: number | null;
};

/**
 * Minimal pg-compatible client or pool contract.
 */
export type NodePostgresQueryable<Row = unknown> = {
  query(sql: string, values: readonly unknown[]): Promise<NodePostgresQueryResult<Row>>;
};

/**
 * Adapter-level options for execution observation and parameter masking.
 */
export type AshibaPostgresAdapterOptions = {
  observer?: AshibaSqlExecutionObserver;
  maskPolicy?: AshibaMaskPolicy;
  includeUnmaskedParamsInEvents?: boolean;
};

/**
 * CLI-generated query model required by the PostgreSQL adapter.
 */
export type AshibaPostgresQueryModel = {
  analysis: AshibaQueryModelAnalysis;
  bindings?: {
    postgres?: {
      sourceHash?: string;
      sql: string;
      orderedNames: readonly string[];
      safeSortInsertion?: {
        index: number;
      };
      optionalConditionCompression?: {
        branches: readonly {
          parameterName: string;
          removalRange: {
            start: number;
            end: number;
            text?: string;
          };
        }[];
      };
    };
  };
};

/**
 * File-backed SQL query source generated or loaded from a reviewed SQL file.
 */
export type AshibaPostgresQuerySource = {
  sql: string;
  sqlPath?: string;
  queryModel: AshibaPostgresQueryModel;
  metadata?: AshibaSqlExecutionMetadata;
};

/**
 * Per-execution metadata and safe sort options for PostgreSQL execution.
 */
export type AshibaPostgresExecuteOptions = {
  metadata?: AshibaSqlExecutionMetadata;
  optionalConditionCompression?: boolean;
  sortProfile?: AshibaSortProfile;
  sort?: readonly AshibaSortInput[];
};

/**
 * Thin PostgreSQL adapter interface exposed to application code.
 */
export type AshibaPostgresAdapter = {
  execute<Row = unknown>(
    query: AshibaPostgresQuerySource,
    params?: Readonly<Record<string, unknown>>,
    options?: AshibaPostgresExecuteOptions,
  ): Promise<NodePostgresQueryResult<Row>>;
};

/**
 * Error raised when provided named parameters do not match query model metadata.
 */
export class AshibaParameterError extends Error {
  readonly code: 'ASHIBA_MISSING_PARAMETER' | 'ASHIBA_UNUSED_PARAMETER';
  readonly parameterNames: string[];
  readonly causeText: string;
  readonly nextAction: string;
  readonly details: { parameterNames: string[] };

  constructor(code: AshibaParameterError['code'], parameterNames: string[]) {
    const label = code === 'ASHIBA_MISSING_PARAMETER' ? 'Missing' : 'Unused';
    super(`${label} SQL parameter${parameterNames.length === 1 ? '' : 's'}: ${parameterNames.join(', ')}`);
    this.name = 'AshibaParameterError';
    this.code = code;
    this.parameterNames = parameterNames;
    this.causeText = code === 'ASHIBA_MISSING_PARAMETER'
      ? 'The provided parameter object does not include every named SQL parameter required by the query model.'
      : 'The provided parameter object includes keys that are not referenced by the query model.';
    this.nextAction = code === 'ASHIBA_MISSING_PARAMETER'
      ? 'Pass values for the listed parameters or regenerate the query contract if the SQL changed.'
      : 'Remove the listed parameters from the call or update the SQL/query contract if they are intended.';
    this.details = { parameterNames };
  }
}

/**
 * Error raised when required query model metadata is missing or stale.
 */
export class AshibaPostgresQueryModelError extends Error {
  readonly code:
    | 'ASHIBA_QUERY_MODEL_STALE'
    | 'ASHIBA_BINDING_METADATA_REQUIRED'
    | 'ASHIBA_OPTIONAL_CONDITION_COMPRESSION_METADATA_REQUIRED'
    | 'ASHIBA_OPTIONAL_CONDITION_COMPRESSION_UNSUPPORTED_QUERY_MODEL'
    | 'ASHIBA_OPTIONAL_CONDITION_COMPRESSION_METADATA_STALE';
  readonly causeText: string;
  readonly nextAction: string;

  constructor(code: AshibaPostgresQueryModelError['code'], message: string) {
    super(message);
    this.name = 'AshibaPostgresQueryModelError';
    this.code = code;
    this.causeText = describeQueryModelErrorCause(code);
    this.nextAction = describeQueryModelErrorNextAction(code);
  }
}

type TextRange = {
  start: number;
  end: number;
};

/**
 * Create a thin adapter around a pg-compatible client or pool.
 */
export function createPostgresAdapter(
  client: NodePostgresQueryable,
  options: AshibaPostgresAdapterOptions = {},
): AshibaPostgresAdapter {
  return {
    async execute<Row = unknown>(
      query: AshibaPostgresQuerySource,
      params: Readonly<Record<string, unknown>> = {},
      executeOptions: AshibaPostgresExecuteOptions = {},
    ): Promise<NodePostgresQueryResult<Row>> {
      const sql = query.sql;
      const queryModel = query.queryModel;
      const metadata = {
        ...query.metadata,
        ...executeOptions.metadata,
        sqlPath: executeOptions.metadata?.sqlPath ?? query.metadata?.sqlPath ?? query.sqlPath,
        dialect: executeOptions.metadata?.dialect ?? query.metadata?.dialect ?? 'postgres',
      };
      const warnings = buildSqlSourceWarnings(query, metadata);
      const startedAt = Date.now();
      let sourceSql = sql;
      let compiledSql = sql;
      let bound: { sql: string; orderedNames: readonly string[]; values: readonly unknown[] } | undefined;

      try {
        const sortInsertion = getSortInsertion({ ...query, queryModel }, executeOptions);
        const prepared = preparePostgresExecution({ ...query, queryModel }, params, executeOptions);
        sourceSql = prepared.sourceSql;
        compiledSql = prepared.sql;
        bound = prepared;
        if (sortInsertion) {
          sourceSql = spliceOrderBy(
            prepared.sourceSql,
            adjustInsertionForRemovedRanges(sortInsertion.insertion, prepared.sourceRemovalRanges),
            sortInsertion.orderBy,
          );
          compiledSql = spliceOrderBy(
            prepared.sql,
            adjustInsertionForRemovedRanges(sortInsertion.compiledInsertion, prepared.compiledRemovalRanges),
            sortInsertion.orderBy,
          );
          bound = { ...bound, sql: compiledSql };
        }

        options.observer?.emit({
          phase: 'start',
          metadata,
          ...(warnings.length > 0 ? { warnings } : {}),
          sourceSql,
          compiledSql,
          orderedNames: bound.orderedNames,
          maskedParams: maskParams(bound.values, options.maskPolicy),
          ...(options.includeUnmaskedParamsInEvents ? { params: bound.values } : {}),
        });

        const result = await client.query(bound.sql, bound.values);
        options.observer?.emit({
          phase: 'end',
          metadata,
          ...(warnings.length > 0 ? { warnings } : {}),
          sourceSql,
          compiledSql: bound.sql,
          orderedNames: bound.orderedNames,
          maskedParams: maskParams(bound.values, options.maskPolicy),
          ...(options.includeUnmaskedParamsInEvents ? { params: bound.values } : {}),
          elapsedMs: Date.now() - startedAt,
          rowCount: result.rowCount ?? result.rows.length,
        });
        return result as NodePostgresQueryResult<Row>;
      } catch (error) {
        options.observer?.emit({
          phase: 'error',
          metadata,
          ...(warnings.length > 0 ? { warnings } : {}),
          sourceSql,
          ...(bound
            ? {
              compiledSql: bound.sql,
              orderedNames: bound.orderedNames,
              maskedParams: maskParams(bound.values, options.maskPolicy),
              ...(options.includeUnmaskedParamsInEvents ? { params: bound.values } : {}),
            }
            : {}),
          elapsedMs: Date.now() - startedAt,
          error: normalizeError(error),
        });
        throw error;
      }
    },
  };
}

function buildSqlSourceWarnings(
  query: AshibaPostgresQuerySource,
  metadata: AshibaSqlExecutionMetadata,
): readonly { code: string; message: string; nextAction?: string }[] {
  if (query.sqlPath || metadata.sqlPath || metadata.sqlFile) {
    return [];
  }

  return [{
    code: 'ASHIBA_STRING_SQL_SOURCE',
    message: 'SQL execution did not include a file-backed sqlPath or sqlFile.',
    nextAction: 'Prefer generated or file-backed query sources so logs can point reviewers to the SQL owner.',
  }];
}

function preparePostgresExecution(
  query: AshibaPostgresQuerySource,
  params: Readonly<Record<string, unknown>>,
  options: AshibaPostgresExecuteOptions,
): {
  sourceSql: string;
  sql: string;
  orderedNames: readonly string[];
  values: readonly unknown[];
  sourceRemovalRanges: readonly TextRange[];
  compiledRemovalRanges: readonly TextRange[];
} {
  const sourceSql = query.sql;
  const precomputed = validatePostgresBindingMetadata(query);
  const compression = options.optionalConditionCompression === true
    ? applyOptionalConditionCompression(query, precomputed, params)
    : undefined;
  const compiled = compression
    ? {
      sql: compression.compiledSql,
      orderedNames: compression.orderedNames,
    }
    : {
      sql: precomputed.sql,
      orderedNames: [...precomputed.orderedNames],
    };
  const bound = bindCompiledNamedParameters(compiled, params, compression?.compressedParameterNames);
  return {
    sourceSql: compression?.sourceSql ?? sourceSql,
    ...bound,
    sourceRemovalRanges: compression?.sourceRemovalRanges ?? [],
    compiledRemovalRanges: compression?.compiledRemovalRanges ?? [],
  };
}

function validatePostgresBindingMetadata(
  query: AshibaPostgresQuerySource,
): NonNullable<NonNullable<AshibaPostgresQueryModel['bindings']>['postgres']> {
  const precomputed = query.queryModel?.bindings?.postgres;
  if (!precomputed) {
    throw new AshibaPostgresQueryModelError(
      'ASHIBA_BINDING_METADATA_REQUIRED',
      'PostgreSQL adapter parameter binding requires CLI-generated query model binding metadata.',
    );
  }
  const currentHash = hashSql(query.sql);
  if (query.queryModel?.analysis.sourceHash !== currentHash || precomputed.sourceHash !== currentHash) {
    throw new AshibaPostgresQueryModelError(
      'ASHIBA_QUERY_MODEL_STALE',
      'Query model binding metadata was generated from different source SQL.',
    );
  }
  return precomputed;
}

function bindCompiledNamedParameters(
  compiled: { sql: string; orderedNames: readonly string[] },
  params: Readonly<Record<string, unknown>>,
  allowedUnusedNames: ReadonlySet<string> = new Set(),
): { sql: string; orderedNames: readonly string[]; values: readonly unknown[] } {
  const uniqueNames = new Set(compiled.orderedNames);
  const missingNames = [...uniqueNames].filter((name) => !Object.prototype.hasOwnProperty.call(params, name));

  if (missingNames.length > 0) {
    throw new AshibaParameterError('ASHIBA_MISSING_PARAMETER', missingNames);
  }

  const unusedNames = Object.keys(params).filter((name) => !uniqueNames.has(name) && !allowedUnusedNames.has(name));
  if (unusedNames.length > 0) {
    throw new AshibaParameterError('ASHIBA_UNUSED_PARAMETER', unusedNames);
  }

  return {
    ...compiled,
    values: compiled.orderedNames.map((name) => params[name]),
  };
}

function applyOptionalConditionCompression(
  query: AshibaPostgresQuerySource,
  precomputed: NonNullable<NonNullable<AshibaPostgresQueryModel['bindings']>['postgres']>,
  params: Readonly<Record<string, unknown>>,
): {
  sourceSql: string;
  compiledSql: string;
  orderedNames: readonly string[];
  compressedParameterNames: ReadonlySet<string>;
  sourceRemovalRanges: readonly TextRange[];
  compiledRemovalRanges: readonly TextRange[];
} {
  const analysis = query.queryModel?.analysis.optionalConditionCompression;
  const binding = precomputed.optionalConditionCompression;
  if (!analysis || !binding) {
    throw new AshibaPostgresQueryModelError(
      'ASHIBA_OPTIONAL_CONDITION_COMPRESSION_METADATA_REQUIRED',
      'Optional condition compression requires CLI-generated query model metadata.',
    );
  }
  if (query.queryModel?.analysis.astParse !== 'ok') {
    throw new AshibaPostgresQueryModelError(
      'ASHIBA_OPTIONAL_CONDITION_COMPRESSION_UNSUPPORTED_QUERY_MODEL',
      'Optional condition compression requires successfully parsed query model metadata.',
    );
  }
  if (analysis.branches.length !== binding.branches.length) {
    throw new AshibaPostgresQueryModelError(
      'ASHIBA_OPTIONAL_CONDITION_COMPRESSION_METADATA_STALE',
      'Optional condition compression metadata does not match Postgres binding metadata.',
    );
  }

  const activeBranches = analysis.branches
    .map((branch, index) => ({ source: branch, compiled: binding.branches[index] }))
    .filter((branch): branch is {
      source: NonNullable<typeof analysis>['branches'][number];
      compiled: NonNullable<typeof binding>['branches'][number];
    } => {
      if (!branch.compiled || branch.source.parameterName !== branch.compiled.parameterName) {
        throw new AshibaPostgresQueryModelError(
          'ASHIBA_OPTIONAL_CONDITION_COMPRESSION_METADATA_STALE',
          'Optional condition compression metadata has mismatched branch order.',
        );
      }
      return Object.prototype.hasOwnProperty.call(params, branch.source.parameterName)
        && params[branch.source.parameterName] == null;
    });

  if (activeBranches.length === 0) {
    return {
      sourceSql: query.sql,
      compiledSql: precomputed.sql,
      orderedNames: [...precomputed.orderedNames],
      compressedParameterNames: new Set(),
      sourceRemovalRanges: [],
      compiledRemovalRanges: [],
    };
  }

  const sourceRemovalRanges = activeBranches.map((branch) => branch.source.removalRange);
  const compiledRemovalRanges = activeBranches.map((branch) => branch.compiled.removalRange);
  assertNonOverlappingRanges(sourceRemovalRanges, 'source SQL');
  assertNonOverlappingRanges(compiledRemovalRanges, 'compiled SQL');
  for (const branch of activeBranches) {
    assertRangeTextMatches(query.sql, branch.source.sourceRange, 'source SQL source range');
    assertRangeTextMatches(query.sql, branch.source.removalRange, 'source SQL removal range');
    assertRangeTextMatches(precomputed.sql, branch.compiled.removalRange, 'compiled SQL removal range');
  }

  const compressedCompiledSql = removeTextRanges(precomputed.sql, compiledRemovalRanges);
  const renumbered = renumberPostgresPlaceholders(compressedCompiledSql, precomputed.orderedNames);

  return {
    sourceSql: removeTextRanges(query.sql, sourceRemovalRanges),
    compiledSql: renumbered.sql,
    orderedNames: renumbered.orderedNames,
    compressedParameterNames: new Set(activeBranches.map((branch) => branch.source.parameterName)),
    sourceRemovalRanges: normalizeRanges(sourceRemovalRanges),
    compiledRemovalRanges: normalizeRanges(compiledRemovalRanges),
  };
}

function assertNonOverlappingRanges(ranges: readonly TextRange[], label: string): void {
  const sorted = normalizeRanges(ranges);
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (current.start < previous.end) {
      throw new AshibaPostgresQueryModelError(
        'ASHIBA_OPTIONAL_CONDITION_COMPRESSION_METADATA_STALE',
        `Optional condition compression metadata has overlapping ${label} ranges.`,
      );
    }
  }
}

function assertRangeTextMatches(sql: string, range: TextRange & { text?: string }, label: string): void {
  if (range.text === undefined) {
    return;
  }
  if (range.start < 0 || range.end < range.start || range.end > sql.length || sql.slice(range.start, range.end) !== range.text) {
    throw new AshibaPostgresQueryModelError(
      'ASHIBA_OPTIONAL_CONDITION_COMPRESSION_METADATA_STALE',
      `Optional condition compression metadata has stale ${label} text.`,
    );
  }
}

function removeTextRanges(sql: string, ranges: readonly TextRange[]): string {
  let output = sql;
  for (const range of normalizeRanges(ranges).sort((left, right) => right.start - left.start)) {
    if (range.start < 0 || range.end < range.start || range.end > sql.length) {
      throw new AshibaPostgresQueryModelError(
        'ASHIBA_OPTIONAL_CONDITION_COMPRESSION_METADATA_STALE',
        'Optional condition compression metadata contains an invalid removal range.',
      );
    }
    output = `${output.slice(0, range.start)}${output.slice(range.end)}`;
  }
  return output;
}

function normalizeRanges(ranges: readonly TextRange[]): TextRange[] {
  return ranges
    .map((range) => ({ start: range.start, end: range.end }))
    .sort((left, right) => left.start - right.start);
}

function adjustInsertionForRemovedRanges<T extends { index: number; mode: 'order-by' | 'comma' }>(
  insertion: T,
  ranges: readonly TextRange[],
): T {
  let adjustedIndex = insertion.index;
  for (const range of normalizeRanges(ranges)) {
    if (insertion.index > range.start && insertion.index < range.end) {
      throw new AshibaPostgresQueryModelError(
        'ASHIBA_OPTIONAL_CONDITION_COMPRESSION_METADATA_STALE',
        'Optional condition compression removed the safe-sort insertion point.',
      );
    }
    if (insertion.index >= range.end) {
      adjustedIndex -= range.end - range.start;
    }
  }
  return { ...insertion, index: adjustedIndex };
}

function renumberPostgresPlaceholders(
  sql: string,
  originalOrderedNames: readonly string[],
): { sql: string; orderedNames: readonly string[] } {
  let output = '';
  const orderedNames: string[] = [];
  let cursor = 0;
  let quote: '"' | "'" | undefined;
  let quoteBackslashEscapes = false;
  let dollarTag: string | undefined;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index] ?? '';
    const next = sql[index + 1] ?? '';
    if (dollarTag) {
      if (sql.startsWith(dollarTag, index)) {
        index += dollarTag.length - 1;
        dollarTag = undefined;
      }
      continue;
    }
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (quoteBackslashEscapes && char === '\\' && next) {
        index += 1;
      } else if (char === quote) {
        if (next === quote) {
          index += 1;
        } else {
          quoteBackslashEscapes = false;
          quote = undefined;
        }
      }
      continue;
    }
    if (char === '-' && next === '-') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    const dollarQuote = sql.slice(index).match(/^(\$\$|\$[A-Za-z_][A-Za-z0-9_]*\$)/);
    if (dollarQuote) {
      dollarTag = dollarQuote[0];
      index += dollarTag.length - 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      quoteBackslashEscapes = char === "'" && isPostgresEscapeStringStart(sql, index);
      continue;
    }
    if (char === '$' && isDigit(next)) {
      let end = index + 2;
      while (isDigit(sql[end] ?? '')) end += 1;
      const originalIndex = Number(sql.slice(index + 1, end));
      const name = originalOrderedNames[originalIndex - 1];
      if (!name) {
        throw new AshibaPostgresQueryModelError(
          'ASHIBA_OPTIONAL_CONDITION_COMPRESSION_METADATA_STALE',
          `Optional condition compression found unknown compiled placeholder $${originalIndex}.`,
        );
      }
      output += sql.slice(cursor, index);
      orderedNames.push(name);
      output += `$${orderedNames.length}`;
      cursor = end;
      index = end - 1;
    }
  }

  output += sql.slice(cursor);
  return { sql: output, orderedNames };
}

function getSortInsertion(
  query: AshibaPostgresQuerySource,
  options: AshibaPostgresExecuteOptions,
): {
  insertion: { index: number; mode: 'order-by' | 'comma' };
  compiledInsertion: { index: number; mode: 'order-by' | 'comma' };
  orderBy: string;
} | undefined {
  if (!options.sort || options.sort.length === 0) return undefined;
  const sql = query.sql;
  const queryModel = query.queryModel;
  if (!queryModel?.analysis) {
    throw new AshibaSortError(
      'ASHIBA_SORT_QUERY_MODEL_REQUIRED',
      'Safe sort requires a CLI-generated query model analysis.',
    );
  }
  if (
    queryModel.analysis.astParse !== 'ok' ||
    queryModel.analysis.statementKind !== 'select'
  ) {
    throw new AshibaSortError(
      'ASHIBA_SORT_UNSUPPORTED_QUERY_MODEL',
      'Safe sort requires a parsed SELECT query model.',
    );
  }
  if (queryModel.analysis.rootQueryShape === 'compound-select') {
    throw new AshibaSortError(
      'ASHIBA_SORT_UNSUPPORTED_QUERY_MODEL',
      'Root compound SELECT safe sort is not supported. Wrap the compound query in a subquery and expose stable sortable columns.',
    );
  }
  if (!queryModel.analysis.sourceHash || queryModel.analysis.sourceHash !== hashSql(sql)) {
    throw new AshibaSortError(
      'ASHIBA_SORT_QUERY_MODEL_STALE',
      'Safe sort requires query model metadata generated from the same source SQL.',
    );
  }
  if (!queryModel.analysis.safeSort || queryModel.analysis.safeSort.insertion.status !== 'ready') {
    const reason = queryModel.analysis.safeSort?.insertion.status === 'unresolved'
      ? queryModel.analysis.safeSort.insertion.reason
      : undefined;
    throw new AshibaSortError(
      'ASHIBA_SORT_INSERTION_UNRESOLVED',
      [
        'Safe sort insertion position is unresolved.',
        reason ?? 'Regenerate query model metadata before enabling driver-side ORDER BY rendering.',
      ].join(' '),
    );
  }
  const sortProfile = resolveSortProfile(queryModel.analysis, options.sortProfile);
  if (!sortProfile) {
    throw new AshibaSortError(
      'ASHIBA_EMPTY_SORT_PROFILE',
      'Safe sort requires query model sortable metadata.',
    );
  }

  const orderBy = renderSafeOrderBy(sortProfile, options.sort);
  const compiledIndex = queryModel.bindings?.postgres?.safeSortInsertion?.index;
  if (compiledIndex === undefined) {
    throw new AshibaSortError(
      'ASHIBA_SORT_QUERY_MODEL_STALE',
      'Safe sort with metadata-based parameter binding requires Postgres compiled insertion metadata. Regenerate query model metadata.',
    );
  }
  return {
    insertion: queryModel.analysis.safeSort.insertion,
    compiledInsertion: {
      index: compiledIndex,
      mode: queryModel.analysis.safeSort.insertion.mode,
    },
    orderBy,
  };
}

function resolveSortProfile(
  analysis: AshibaQueryModelAnalysis,
  explicitProfile: AshibaSortProfile | undefined,
): AshibaSortProfile | undefined {
  const queryModelProfile = analysis.safeSort?.sortable;
  if (!queryModelProfile) {
    return undefined;
  }
  if (!explicitProfile) {
    return queryModelProfile;
  }

  const resolved: Record<string, { sql: string; defaultDirection?: 'asc' | 'desc' }> = {};
  for (const [key, queryModelEntry] of Object.entries(queryModelProfile)) {
    const explicitEntry = explicitProfile[key];
    if (explicitEntry && explicitEntry.sql !== queryModelEntry.sql) {
      throw new AshibaSortError(
        'ASHIBA_SORT_PROFILE_OUTSIDE_QUERY_MODEL',
        `Sort profile key ${key} does not match CLI-generated query model sortable metadata.`,
      );
    }
    resolved[key] = {
      sql: queryModelEntry.sql,
      defaultDirection: explicitEntry?.defaultDirection ?? queryModelEntry.defaultDirection,
    };
  }

  return resolved;
}

function hashSql(sql: string): string {
  return `sha256:${createHash('sha256').update(sql).digest('hex')}`;
}

function describeQueryModelErrorCause(code: AshibaPostgresQueryModelError['code']): string {
  switch (code) {
    case 'ASHIBA_BINDING_METADATA_REQUIRED':
      return 'The PostgreSQL adapter is running in metadata-based binding mode, but the query model did not include Postgres binding metadata.';
    case 'ASHIBA_QUERY_MODEL_STALE':
      return 'The query model metadata was generated from different SQL than the SQL passed to the adapter.';
    case 'ASHIBA_OPTIONAL_CONDITION_COMPRESSION_METADATA_REQUIRED':
      return 'Optional condition compression was requested, but the query model does not include compression metadata generated by the CLI.';
    case 'ASHIBA_OPTIONAL_CONDITION_COMPRESSION_UNSUPPORTED_QUERY_MODEL':
      return 'Optional condition compression was requested, but the query model does not contain successful development-time SQL analysis.';
    case 'ASHIBA_OPTIONAL_CONDITION_COMPRESSION_METADATA_STALE':
      return 'Optional condition compression metadata does not match the SQL or dialect binding metadata being executed.';
  }
}

function describeQueryModelErrorNextAction(code: AshibaPostgresQueryModelError['code']): string {
  switch (code) {
    case 'ASHIBA_BINDING_METADATA_REQUIRED':
      return 'Run Ashiba model generation for the visible SQL and pass queryModel.bindings.postgres to the adapter.';
    case 'ASHIBA_QUERY_MODEL_STALE':
      return 'Regenerate the query model from the current visible SQL and ensure the source SQL passed to the adapter is unchanged.';
    case 'ASHIBA_OPTIONAL_CONDITION_COMPRESSION_METADATA_REQUIRED':
      return 'Regenerate the query model with optional condition compression metadata, or disable optionalConditionCompression for this execution.';
    case 'ASHIBA_OPTIONAL_CONDITION_COMPRESSION_UNSUPPORTED_QUERY_MODEL':
      return 'Fix the SQL shape or parser support, then regenerate the query model before enabling optionalConditionCompression.';
    case 'ASHIBA_OPTIONAL_CONDITION_COMPRESSION_METADATA_STALE':
      return 'Regenerate the query model from the current visible SQL and keep source SQL, binding metadata, and compression metadata together.';
  }
}

function spliceOrderBy(
  sql: string,
  insertion: { index: number; mode: 'order-by' | 'comma' },
  orderBy: string,
): string {
  const prefix = sql.slice(0, insertion.index).trimEnd();
  const suffix = sql.slice(insertion.index);
  const fragment = insertion.mode === 'comma'
    ? `, ${stripOrderByPrefix(orderBy)}`
    : ` ${orderBy}`;
  const separator = suffix.length > 0 && !isWhitespace(suffix[0] ?? '') ? ' ' : '';
  return `${prefix}${fragment}${separator}${suffix}`;
}

function stripOrderByPrefix(value: string): string {
  const prefix = 'order by ';
  return value.toLowerCase().startsWith(prefix) ? value.slice(prefix.length) : value;
}

function isWhitespace(value: string): boolean {
  return value === ' ' || value === '\n' || value === '\r' || value === '\t' || value === '\f';
}

function isDigit(value: string): boolean {
  return value >= '0' && value <= '9';
}

function isPostgresEscapeStringStart(sql: string, quoteIndex: number): boolean {
  const marker = sql[quoteIndex - 1] ?? '';
  if (marker !== 'E' && marker !== 'e') {
    return false;
  }
  const beforeMarker = sql[quoteIndex - 2] ?? '';
  return !/[A-Za-z0-9_$]/.test(beforeMarker);
}
