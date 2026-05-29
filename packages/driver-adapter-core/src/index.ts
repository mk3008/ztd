/**
 * Controls whether parameter values are exposed in driver observer events.
 */
export type AshibaMaskPolicy = 'always' | 'development' | 'never';

/**
 * Stable identity fields that make SQL execution events traceable by applications.
 */
export type AshibaSqlExecutionMetadata = {
  sqlId?: string;
  queryId?: string;
  sqlFile?: string;
  sqlPath?: string;
  dialect?: string;
};

/**
 * Structured event emitted by thin driver adapters around SQL execution.
 */
export type AshibaSqlExecutionEvent = {
  phase: 'start' | 'end' | 'error';
  metadata?: AshibaSqlExecutionMetadata;
  warnings?: readonly {
    code: string;
    message: string;
    nextAction?: string;
  }[];
  sourceSql?: string;
  compiledSql?: string;
  orderedNames?: readonly string[];
  maskedParams?: readonly unknown[];
  params?: readonly unknown[];
  elapsedMs?: number;
  rowCount?: number;
  error?: {
    name: string;
    message: string;
    code?: string;
    cause?: string;
    nextAction?: string;
  };
};

/**
 * Application-provided observer hook for integrating Ashiba driver events with a logger.
 */
export type AshibaSqlExecutionObserver = {
  emit(event: AshibaSqlExecutionEvent): void;
};

/**
 * Allowed direction values for safe sort rendering.
 */
export type AshibaSortDirection = 'asc' | 'desc';

/**
 * One reviewed SQL expression exposed as a safe sort key.
 */
export type AshibaSortProfileEntry = {
  sql: string;
  defaultDirection?: AshibaSortDirection;
};

/**
 * Runtime-visible safe sort dictionary keyed by public sort names.
 */
export type AshibaSortProfile = Readonly<Record<string, AshibaSortProfileEntry>>;

/**
 * Sort request supplied by application code after user input has been mapped to a sort key.
 */
export type AshibaSortInput = {
  key: string;
  direction?: AshibaSortDirection;
};

/**
 * CLI-generated query metadata used by runtime adapters without parsing SQL at runtime.
 */
export type AshibaQueryModelAnalysis = {
  astParse: 'ok' | 'failed';
  statementKind: 'select' | 'insert' | 'update' | 'delete' | 'unknown';
  rootQueryShape?: 'simple-select' | 'compound-select' | 'values' | 'non-select' | 'unknown';
  hasTopLevelOrderBy: boolean;
  sourceHash?: string;
  safeSort?: {
    insertion:
      | {
        status: 'ready';
        index: number;
        mode: 'order-by' | 'comma';
      }
      | {
        status: 'unresolved';
        reason?: string;
      };
    sortable?: Readonly<Record<string, AshibaSortProfileEntry>>;
  };
  optionalConditionCompression?: {
    enabled: true;
    branches: readonly {
      parameterName: string;
      kind: 'expression';
      sourceRange: {
        start: number;
        end: number;
        text?: string;
      };
      removalRange: {
        start: number;
        end: number;
        text?: string;
      };
    }[];
  };
};

/**
 * Error raised when a safe sort request violates the reviewed query model or sort profile.
 */
export class AshibaSortError extends Error {
  readonly code:
    | 'ASHIBA_UNKNOWN_SORT_KEY'
    | 'ASHIBA_INVALID_SORT_DIRECTION'
    | 'ASHIBA_EMPTY_SORT_PROFILE'
    | 'ASHIBA_SORT_QUERY_MODEL_REQUIRED'
    | 'ASHIBA_SORT_UNSUPPORTED_QUERY_MODEL'
    | 'ASHIBA_SORT_QUERY_MODEL_STALE'
    | 'ASHIBA_SORT_INSERTION_UNRESOLVED'
    | 'ASHIBA_SORT_PROFILE_OUTSIDE_QUERY_MODEL';
  readonly causeText: string;
  readonly nextAction: string;

  constructor(code: AshibaSortError['code'], message: string) {
    super(message);
    this.name = 'AshibaSortError';
    this.code = code;
    this.causeText = describeSortErrorCause(code);
    this.nextAction = describeSortErrorNextAction(code);
  }
}

/**
 * Return parameter values according to the requested event masking policy.
 */
export function maskParams(values: readonly unknown[], policy: AshibaMaskPolicy = 'always'): readonly unknown[] | undefined {
  if (policy === 'never') return values;
  return values.map(maskValue);
}

/**
 * Render an ORDER BY clause from a reviewed safe sort profile and validated sort input.
 */
export function renderSafeOrderBy(profile: AshibaSortProfile, input: readonly AshibaSortInput[]): string {
  if (input.length === 0) return '';
  if (Object.keys(profile).length === 0) {
    throw new AshibaSortError('ASHIBA_EMPTY_SORT_PROFILE', 'Sort profile is empty.');
  }

  const fragments = input.map((item) => {
    const entry = profile[item.key];
    if (!entry) {
      throw new AshibaSortError('ASHIBA_UNKNOWN_SORT_KEY', `Unknown sort key: ${item.key}`);
    }

    const direction = item.direction ?? entry.defaultDirection ?? 'asc';
    if (direction !== 'asc' && direction !== 'desc') {
      throw new AshibaSortError('ASHIBA_INVALID_SORT_DIRECTION', `Invalid sort direction for ${item.key}.`);
    }

    return `${entry.sql} ${direction}`;
  });

  return `order by ${fragments.join(', ')}`;
}

/**
 * Convert unknown thrown values into the structured error shape used by driver events.
 */
export function normalizeError(error: unknown): { name: string; message: string; code?: string; cause?: string; nextAction?: string } {
  if (error instanceof Error) {
    const maybeCode = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
    const cause = 'causeText' in error && typeof error.causeText === 'string' ? error.causeText : undefined;
    const nextAction = 'nextAction' in error && typeof error.nextAction === 'string' ? error.nextAction : undefined;
    return {
      name: error.name,
      message: error.message,
      ...(maybeCode ? { code: maybeCode } : {}),
      ...(cause ? { cause } : {}),
      ...(nextAction ? { nextAction } : {}),
    };
  }

  return {
    name: 'Error',
    message: String(error),
  };
}

function describeSortErrorCause(code: AshibaSortError['code']): string {
  switch (code) {
    case 'ASHIBA_EMPTY_SORT_PROFILE':
      return 'Safe sort was requested, but no reviewed sortable keys are available.';
    case 'ASHIBA_UNKNOWN_SORT_KEY':
      return 'The requested sort key is not present in the reviewed safe sort profile.';
    case 'ASHIBA_INVALID_SORT_DIRECTION':
      return 'The requested sort direction is outside the allowed asc/desc values.';
    case 'ASHIBA_SORT_QUERY_MODEL_REQUIRED':
      return 'Safe sort requires CLI-generated query model metadata so the driver does not parse SQL at runtime.';
    case 'ASHIBA_SORT_UNSUPPORTED_QUERY_MODEL':
      return 'The query model shape is not supported for driver-side safe sort rendering.';
    case 'ASHIBA_SORT_QUERY_MODEL_STALE':
      return 'The query model metadata does not match the SQL being executed or is missing required dialect metadata.';
    case 'ASHIBA_SORT_INSERTION_UNRESOLVED':
      return 'The query model does not contain a resolved ORDER BY insertion position.';
    case 'ASHIBA_SORT_PROFILE_OUTSIDE_QUERY_MODEL':
      return 'The runtime sort profile attempted to use SQL outside the CLI-generated sortable metadata.';
  }
}

function describeSortErrorNextAction(code: AshibaSortError['code']): string {
  switch (code) {
    case 'ASHIBA_EMPTY_SORT_PROFILE':
      return 'Regenerate query model metadata with safe-sort analysis or disable safe sort for this query.';
    case 'ASHIBA_UNKNOWN_SORT_KEY':
      return 'Use one of the sortable keys recorded in the query model, or update the SQL and regenerate metadata.';
    case 'ASHIBA_INVALID_SORT_DIRECTION':
      return 'Use asc or desc for the requested sort direction.';
    case 'ASHIBA_SORT_QUERY_MODEL_REQUIRED':
      return 'Run model generation for the visible SQL and pass the resulting query model to the driver adapter.';
    case 'ASHIBA_SORT_UNSUPPORTED_QUERY_MODEL':
      return 'Rewrite the SQL into a supported shape, such as wrapping a compound query in an explicit subquery, then regenerate metadata.';
    case 'ASHIBA_SORT_QUERY_MODEL_STALE':
      return 'Regenerate query model metadata from the current visible SQL and pass the matching dialect binding metadata.';
    case 'ASHIBA_SORT_INSERTION_UNRESOLVED':
      return 'Review the unsupported SQL shape, adjust it if needed, and regenerate query model metadata before enabling safe sort.';
    case 'ASHIBA_SORT_PROFILE_OUTSIDE_QUERY_MODEL':
      return 'Use the SQL expressions recorded in the query model sortable dictionary, or regenerate metadata after changing the visible SQL.';
  }
}

function maskValue(value: unknown): string {
  if (value === null || value === undefined) return '<nullish>';
  return '<masked>';
}
