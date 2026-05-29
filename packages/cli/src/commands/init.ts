import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Command } from 'commander';
import { invalidCliInputError } from '../errors.js';

type InitOptions = {
  dir?: string;
  db?: string;
  driver?: string;
  force?: boolean;
  dryRun?: boolean;
  withDemoDdl?: boolean;
  withMigrationDemoDdl?: boolean;
};

type InitFile = {
  relativePath: string;
  contents: string;
};

export type InitResult = {
  rootDir: string;
  dryRun: boolean;
  files: Array<{
    relativePath: string;
    action: InitFileAction;
  }>;
};

type InitFileAction = 'create' | 'overwrite' | 'skip';
type InitDatabase = 'postgres' | 'mysql' | 'sqlserver';
type InitDriver = 'pg' | 'mysql2' | 'mssql';
type InitTarget = {
  db: InitDatabase;
  driver: InitDriver;
};

const postgresStarterRequiredDependencies = ['@ashiba/driver-adapter-pg', 'pg'] as const;
const postgresStarterRequiredDevDependencies = [
  '@ashiba/cli',
  '@ashiba/testkit-adapter-pg',
  '@types/pg',
  'dotenv',
  'typescript',
  'vitest',
] as const;

const forbiddenInitFileNames = new Set([
  'AGENTS.md',
  'AGENT.md',
  'SKILL.md',
]);

const postgresStarterFiles: InitFile[] = [
  {
    relativePath: 'README.md',
    contents: `# Show me the SQL.

Ashiba handles the boring parts.

This starter keeps SQL visible and puts DTO definitions, mappers, query IDs, and generated code where humans and AI agents can read, edit, test, and keep them.
Generated code is not hidden behind generate; keep it visible and drift-check it as the project grows.

Install the \`pg\` driver, \`@ashiba/driver-adapter-pg\`, Ashiba CLI, TypeScript, Vitest, dotenv, @types/pg, and @ashiba/testkit-adapter-pg before running \`ashiba init --db postgres --driver pg\`.
Ashiba init does not create or manage package.json because package ownership and database driver choice belong to the application. This starter uses the \`pg\` wrapper path; another PostgreSQL driver should get its own wrapper-specific starter seam.

Install Docker with PostgreSQL support before running the starter tests. Ashiba treats DB-backed unit tests as the normal path, not an optional afterthought.
Copy \`.env.example\` to \`.env\`, adjust \`ASHIBA_TEST_DB_PORT\` if 5432 is already in use, then run \`docker compose up -d\`.
The generated Vitest setup derives \`ASHIBA_TEST_DATABASE_URL\` from the starter-owned DB settings in \`.env\` and fails fast if an explicit URL conflicts with those values.

SQL should stay SQL and be directly runnable in a SQL client for debugging.
Do not dynamically rewrite SQL at runtime; the DB driver wrapper may use whitelisted sort profiles for sort conditions only.
Use mapper tests and DB-backed integration tests for type safety; do not add Ashiba runtime row validation overhead.
Use named parameters such as :name or @name in SQL; the DB driver wrapper owns conversion to driver placeholders.
Use Zero Table Dependency for mapper tests by default, and traditional DB-backed tests for performance tests.
Generated-folder unit-test schema files are library-owned; other generated code is editable by humans and AI agents.
Errors should be selectable for human-oriented or AI-oriented output with cause and next action when possible.

## Project Shape

- \`db/ddl\` keeps schema source files.
- \`src/features\` keeps feature-local SQL and boundaries.
- \`src/features/<feature>/queries/<query>\` keeps one query boundary.
- Feature boundaries may be subgrouped under \`src/features\`; cross-root/shared-seam imports use root aliases such as \`#features/*\` and \`#tests/*\` instead of depth-sensitive relative paths.
- Migration query generation compares two DDL inputs and emits migration DDL plus risk info; DB connection and apply are application/operator responsibilities.
- Application code owns business SQL intent, connection lifecycle, and transaction policy. The starter provides a small \`pg\` wrapper seam, but applications may replace it.

## Runtime Policy

Ashiba Runtime Zero in CLI-generated application code. Thin driver adapter only where needed.

Ashiba Runtime Zero does not mean there is no database driver, driver adapter, or extension runtime. It means the CLI generates native TypeScript code and Ashiba CLI/runtime libraries are not required by CLI-generated application code.
That avoids forced security updates for an unused Ashiba runtime dependency. If generated code needs a fix, patch the local application code directly.
`,
  },
  {
    relativePath: '.gitignore',
    contents: `node_modules/
dist/
coverage/
*.log

.env
.env.*
!.env.example
`,
  },
  {
    relativePath: '.env.example',
    contents: `# Copy this file to .env and adjust these values for the starter-owned test database.
# The generated Vitest setup derives ASHIBA_TEST_DATABASE_URL from these values.
# Do not rely on DATABASE_URL for Ashiba-owned test workflows.
ASHIBA_TEST_DB_HOST=localhost
ASHIBA_TEST_DB_PORT=5432
ASHIBA_TEST_DB_NAME=ashiba
ASHIBA_TEST_DB_USER=ashiba
ASHIBA_TEST_DB_PASSWORD=ashiba
`,
  },
  {
    relativePath: 'compose.yaml',
    contents: `# Starter Postgres environment for Ashiba tests.
# Start it with: docker compose up -d
# Copy .env.example to .env and update ASHIBA_TEST_DB_PORT if 5432 is already in use.
# docker compose reads .env from the project root for variable substitution.

services:
  postgres:
    image: postgres:16
    network_mode: bridge
    environment:
      POSTGRES_DB: \${ASHIBA_TEST_DB_NAME:-ashiba}
      POSTGRES_PASSWORD: \${ASHIBA_TEST_DB_PASSWORD:-ashiba}
      POSTGRES_USER: \${ASHIBA_TEST_DB_USER:-ashiba}
    ports:
      - "\${ASHIBA_TEST_DB_PORT:-5432}:5432"
`,
  },
  {
    relativePath: 'ashiba.config.json',
    contents: `${JSON.stringify({
      $schema: 'https://ashiba.dev/schema/ashiba-config.json',
      featureRoot: 'src/features',
      sqlRoots: ['src/features'],
      ddl: {
        sourceDir: 'db/ddl',
      },
      sql: {
        parameterStyle: 'both',
      },
      tests: {
        mapperLane: 'ztd',
        performanceLane: 'traditional',
      },
    }, null, 2)}
`,
  },
  {
    relativePath: 'vitest.config.ts',
    contents: `import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '#features': fileURLToPath(new URL('./src/features', import.meta.url)),
      '#libraries': fileURLToPath(new URL('./src/libraries', import.meta.url)),
      '#adapters': fileURLToPath(new URL('./src/adapters', import.meta.url)),
      '#tests': fileURLToPath(new URL('./tests', import.meta.url)),
    },
  },
  test: {
    include: ['src/features/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/support/setup-env.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
`,
  },
  {
    relativePath: 'tests/support/setup-env.ts',
    contents: `import { config } from 'dotenv';

config();

const host = readDbEnv('ASHIBA_TEST_DB_HOST', 'localhost');
const port = readDbEnv('ASHIBA_TEST_DB_PORT', '5432');
const database = readDbEnv('ASHIBA_TEST_DB_NAME', 'ashiba');
const user = readDbEnv('ASHIBA_TEST_DB_USER', 'ashiba');
const password = readDbEnv('ASHIBA_TEST_DB_PASSWORD', 'ashiba');
const derivedUrl = \`postgres://\${encodeURIComponent(user)}:\${encodeURIComponent(password)}@\${host}:\${port}/\${encodeURIComponent(database)}\`;

if (process.env.ASHIBA_TEST_DATABASE_URL?.trim()) {
  const explicitUrl = process.env.ASHIBA_TEST_DATABASE_URL.trim();
  if (explicitUrl !== derivedUrl) {
    throw new Error([
      'ASHIBA_TEST_DATABASE_URL conflicts with the starter-owned DB settings.',
      'Use .env as the single source of truth for Ashiba test DB settings, or set ASHIBA_TEST_DATABASE_URL to the exact derived value.',
      \`derived: \${derivedUrl}\`,
      \`explicit: \${explicitUrl}\`,
    ].join('\\n'));
  }
} else {
  process.env.ASHIBA_TEST_DATABASE_URL = derivedUrl;
}

function readDbEnv(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  if (value) return value;
  return fallback;
}
`,
  },
  {
    relativePath: 'src/features/_shared/featureQueryExecutor.ts',
    contents: `export type FeatureQueryModel = {
  analysis: {
    astParse: 'ok';
    statementKind: 'select' | 'insert' | 'update' | 'delete' | 'unknown';
    rootQueryShape?: 'simple-select' | 'compound-select' | 'values' | 'non-select' | 'unknown';
    hasTopLevelOrderBy: boolean;
    sourceHash?: string;
    resultColumnTypes?: Record<string, string>;
    parameterTypes?: Record<string, string>;
  };
  bindings?: {
    postgres?: { sourceHash?: string; sql: string; orderedNames: readonly string[] };
  };
};

export interface FeatureQuerySource {
  id: string;
  path: string;
  sqlPath: string;
  sql: string;
  queryModel: FeatureQueryModel;
  optionalConditionCompression?: boolean;
  metadata?: {
    sqlId?: string;
    queryId?: string;
    sqlFile?: string;
    sqlPath?: string;
    dialect?: string;
  };
}

export interface FeatureQueryExecutor {
  query<T = unknown>(query: FeatureQuerySource, params: Record<string, unknown>): Promise<T[]>;
}
`,
  },
  {
    relativePath: 'src/adapters/pg/pool.ts',
    contents: `import { Pool, type PoolConfig } from 'pg';
import { createPostgresAdapter, type AshibaPostgresAdapterOptions, type AshibaPostgresExecuteOptions } from '@ashiba/driver-adapter-pg';

import { logSqlExecution } from '#adapters/logger/sqlLogger.js';
import type { FeatureQueryExecutor, FeatureQuerySource } from '#features/_shared/featureQueryExecutor.js';

export type PgConnectionSettings = {
  connectionString?: string;
  pool?: PoolConfig;
};

export type PgFeatureQueryExecutorOptions = AshibaPostgresAdapterOptions & {
  executeOptions?: AshibaPostgresExecuteOptions;
};

/**
 * Create an application-owned pg Pool for production or traditional tests.
 *
 * Ashiba does not own connection lifecycle or transaction policy. Keep the Pool
 * at your application boundary and pass FeatureQueryExecutor into workflows.
 */
export function createPgPool(settings: PgConnectionSettings = {}): Pool {
  const connectionString = settings.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Set DATABASE_URL or pass connectionString to createPgPool.');
  }

  return new Pool({
    ...settings.pool,
    connectionString,
  });
}

/**
 * Create the SQL client that feature code should receive.
 *
 * Natural wiring:
 *   query -> feature -> sqlClient -> logger
 *
 * SQL logging is intentionally delegated to ../logger/sqlLogger.ts. Fill that
 * file with your application logger (pino, winston, console, etc.). Feature code
 * should receive only FeatureQueryExecutor; it should not import pg, pino,
 * the Ashiba driver adapter, or logger code directly.
 */
export function createPgSqlClient(
  queryable: { query(sql: string, values: readonly unknown[]): Promise<{ rows: unknown[]; rowCount?: number | null }> },
  options: PgFeatureQueryExecutorOptions = {},
): FeatureQueryExecutor {
  const { executeOptions, observer, ...adapterOptions } = options;
  const adapter = createPostgresAdapter(queryable, {
    ...adapterOptions,
    observer: observer ?? { emit: logSqlExecution },
  });
  return {
    async query<T = unknown>(query: FeatureQuerySource, params: Record<string, unknown>): Promise<T[]> {
      const result = await adapter.execute<T>(
        {
          sql: query.sql,
          sqlPath: query.sqlPath,
          queryModel: query.queryModel,
          metadata: {
            ...query.metadata,
            sqlId: query.metadata?.sqlId ?? query.id,
            queryId: query.metadata?.queryId ?? query.id,
            sqlPath: query.metadata?.sqlPath ?? query.sqlPath,
          },
        },
        params,
        {
          ...executeOptions,
          optionalConditionCompression: query.optionalConditionCompression ?? executeOptions?.optionalConditionCompression,
        },
      );
      return result.rows;
    },
  };
}

/**
 * Low-level compatibility alias. Prefer createPgSqlClient in new application code
 * so logger wiring stays visibly attached to the SQL client boundary.
 */
export function createPgFeatureQueryExecutor(
  queryable: { query(sql: string, values: readonly unknown[]): Promise<{ rows: unknown[]; rowCount?: number | null }> },
  options: PgFeatureQueryExecutorOptions = {},
): FeatureQueryExecutor {
  return createPgSqlClient(queryable, options);
}

/**
 * Borrow a pg client, expose only the guarded FeatureQueryExecutor, and release
 * the client after the callback settles.
 */
export async function withPgFeatureQueryExecutor<T>(
  pool: Pool,
  callback: (executor: FeatureQueryExecutor) => Promise<T>,
  options: PgFeatureQueryExecutorOptions = {},
): Promise<T> {
  const client = await pool.connect();
  try {
    return await callback(createPgSqlClient(client, options));
  } finally {
    client.release();
  }
}

/**
 * Run application-owned work inside a pg transaction.
 *
 * This helper is starter code, not an Ashiba runtime requirement. Edit or
 * replace it when your application needs a different transaction policy.
 */
export async function withPgTransaction<T>(
  pool: Pool,
  callback: (executor: FeatureQueryExecutor) => Promise<T>,
  options: PgFeatureQueryExecutorOptions = {},
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    try {
      const result = await callback(createPgSqlClient(client, options));
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  } finally {
    client.release();
  }
}
`,
  },
  {
    relativePath: 'src/adapters/logger/sqlLogger.ts',
    contents: `export type SqlExecutionLogEvent = {
  phase: 'start' | 'end' | 'error';
  warnings?: readonly { code: string; message: string; nextAction?: string }[];
  [key: string]: unknown;
};

/**
 * SQL execution log hook called by src/adapters/pg/pool.ts.
 *
 * This is the intended hole for your application logger.
 * Wire pino, winston, console, OpenTelemetry, or your logger here.
 *
 * Keep feature code on this path:
 *   query -> feature -> sqlClient -> logger
 *
 * Feature code should not import logger packages directly.
 */
export function logSqlExecution(event: SqlExecutionLogEvent): void {
  // TODO: Replace this no-op with your application logger.
  // Suggested behavior:
  // - info for normal SQL execution
  // - warn when event.warnings is not empty, such as string SQL without sqlPath
  // - error when event.phase === 'error'
  void event;
}
`,
  },
  {
    relativePath: 'tsconfig.json',
    contents: `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "baseUrl": ".",
    "paths": {
      "#features/*": ["src/features/*"],
      "#libraries/*": ["src/libraries/*"],
      "#adapters/*": ["src/adapters/*"],
      "#tests/*": ["tests/*"]
    },
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "tsBuildInfoFile": "dist/.tsbuildinfo"
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
`,
  },
  {
    relativePath: 'tests/support/ztd/case-types.ts',
    contents: `export interface QuerySpecZtdCase<
  BeforeDb extends Record<string, unknown> = Record<string, unknown>,
  Input = unknown,
  Output = unknown,
> {
  name: string;
  beforeDb: BeforeDb;
  input: Input;
  output: Output;
}
`,
  },
  {
    relativePath: 'tests/support/ztd/harness.ts',
    contents: `import type { QuerySpecZtdCase } from './case-types.js';
import { createQuerySpecZtdVerifier, type QuerySpecExecutionEvidence } from './verifier.js';

export type QuerySpecExecutorClient = {
  query<T = unknown>(query: QuerySpecSqlSource, params: Record<string, unknown>): Promise<T[]>;
};

export type QuerySpecSqlSource = {
  id: string;
  path: string;
  sql: string;
};

type QuerySpecExecutor<Input, Output> = (
  client: QuerySpecExecutorClient,
  input: Input,
) => Promise<Output>;

export async function runQuerySpecZtdCases<
  BeforeDb extends Record<string, unknown>,
  Input,
  Output,
>(
  cases: readonly QuerySpecZtdCase<BeforeDb, Input, Output>[],
  execute: QuerySpecExecutor<Input, Output>,
): Promise<QuerySpecExecutionEvidence[]> {
  const verifier = await createQuerySpecZtdVerifier();
  const evidence: QuerySpecExecutionEvidence[] = [];

  try {
    for (const querySpecCase of cases) {
      evidence.push(await verifier.verify(querySpecCase, execute));
    }
  } finally {
    await verifier.close();
  }

  return evidence;
}
`,
  },
  {
    relativePath: 'tests/support/ztd/verifier.ts',
    contents: `import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect } from 'vitest';
import { Pool } from 'pg';
import type { PostgresTestkitClient } from '@ashiba/testkit-adapter-pg';

import type { QuerySpecZtdCase } from './case-types.js';
import type { QuerySpecExecutorClient, QuerySpecSqlSource } from './harness.js';

type FixtureTree = Record<string, unknown>;
type FixtureRow = Record<string, unknown>;
type FixtureTableRows = Array<{ tableName: string; rows: FixtureRow[] }>;

type QuerySpecExecutor<Input, Output> = (
  client: QuerySpecExecutorClient,
  input: Input,
) => Promise<Output>;

export interface QuerySpecExecutionEvidence {
  mode: 'ztd';
  rewriteApplied: boolean;
  physicalSetupUsed: boolean;
  executedQueryCount: number;
}

type QueryExecutionTrace = {
  originalSql: string;
  boundSql: string;
  boundParams: unknown[];
  rewriteApplied: boolean;
};

export interface QuerySpecZtdVerifier {
  verify<BeforeDb extends FixtureTree, Input, Output>(
    querySpecCase: QuerySpecZtdCase<BeforeDb, Input, Output>,
    execute: QuerySpecExecutor<Input, Output>,
  ): Promise<QuerySpecExecutionEvidence>;
  close(): Promise<void>;
}

export async function createQuerySpecZtdVerifier(): Promise<QuerySpecZtdVerifier> {
  const connectionString = process.env.ASHIBA_TEST_DATABASE_URL;
  if (!connectionString) {
    throw new Error('Set ASHIBA_TEST_DATABASE_URL before running Ashiba ZTD cases.');
  }

  const defaults = loadStarterDefaults(process.cwd());
  const pool = new Pool({ connectionString });
  const { createPostgresTestkitClient } = await import('@ashiba/testkit-adapter-pg');

  return {
    async verify<BeforeDb extends FixtureTree, Input, Output>(
      querySpecCase: QuerySpecZtdCase<BeforeDb, Input, Output>,
      execute: QuerySpecExecutor<Input, Output>,
    ): Promise<QuerySpecExecutionEvidence> {
      const tableRows = flattenFixtureTableRows(querySpecCase.beforeDb);
      const trace: QueryExecutionTrace[] = [];
      let testkitClient: PostgresTestkitClient | undefined;

      try {
        testkitClient = createPostgresTestkitClient({
          queryExecutor: async (sql, params) => {
            const result = await pool.query(sql, params as unknown[]);
            return {
              rows: result.rows,
              rowCount: result.rowCount ?? undefined,
            };
          },
          defaultSchema: defaults.defaultSchema,
          searchPath: defaults.searchPath,
          tableRows,
          ddl: defaults.ddlDirectories.length > 0 ? { directories: defaults.ddlDirectories } : undefined,
          onExecute: (sql, _params, fixtures) => {
            const latestTrace = trace[trace.length - 1];
            if (!latestTrace) return;
            latestTrace.rewriteApplied =
              normalizeSql(latestTrace.boundSql) !== normalizeSql(sql) || (fixtures?.length ?? 0) > 0;
          },
        });

        const actual = await execute(createQuerySpecExecutor(testkitClient, trace), querySpecCase.input);
        expect(normalizeActualByExpected(actual, querySpecCase.output)).toEqual(querySpecCase.output);
        if (trace.length === 0) {
          throw new Error(\`ZTD verifier did not execute any SQL for case "\${querySpecCase.name}".\`);
        }
      } finally {
        if (testkitClient) await testkitClient.close();
      }

      return {
        mode: 'ztd',
        rewriteApplied: trace.some((entry) => entry.rewriteApplied),
        physicalSetupUsed: false,
        executedQueryCount: trace.length,
      };
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}

export async function verifyQuerySpecZtdCase<BeforeDb extends FixtureTree, Input, Output>(
  querySpecCase: QuerySpecZtdCase<BeforeDb, Input, Output>,
  execute: QuerySpecExecutor<Input, Output>,
): Promise<QuerySpecExecutionEvidence> {
  const verifier = await createQuerySpecZtdVerifier();
  try {
    return await verifier.verify(querySpecCase, execute);
  } finally {
    await verifier.close();
  }
}

function createQuerySpecExecutor(
  testkitClient: PostgresTestkitClient,
  trace: QueryExecutionTrace[],
): QuerySpecExecutorClient {
  return {
    async query<T = unknown>(query: QuerySpecSqlSource, params: Record<string, unknown>): Promise<T[]> {
      const bound = bindNamedParams(query.sql, params);
      trace.push({
        originalSql: query.sql,
        boundSql: bound.boundSql,
        boundParams: bound.boundValues,
        rewriteApplied: false,
      });
      const result = await testkitClient.query(bound.boundSql, bound.boundValues);
      return result.rows as T[];
    },
  };
}

function normalizeActualByExpected(actual: unknown, expected: unknown): unknown {
  if (Array.isArray(actual) && Array.isArray(expected)) {
    return actual.map((entry, index) => normalizeActualByExpected(entry, expected[index]));
  }
  if (isPlainRecord(actual) && isPlainRecord(expected)) {
    return Object.fromEntries(Object.entries(actual).map(([key, value]) => [
      key,
      normalizeActualByExpected(value, expected[key]),
    ]));
  }
  if (typeof expected === 'number' && typeof actual === 'string' && actual.trim() !== '') {
    const next = Number(actual);
    return Number.isFinite(next) ? next : actual;
  }
  if (typeof expected === 'string' && typeof actual === 'number') {
    return String(actual);
  }
  if (typeof expected === 'boolean' && typeof actual === 'string') {
    const normalized = actual.toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  if (typeof expected === 'string' && typeof actual === 'boolean') {
    return String(actual);
  }
  return actual;
}

function loadStarterDefaults(rootDir: string): {
  defaultSchema: string;
  searchPath: string[];
  ddlDirectories: string[];
} {
  const configPath = path.join(rootDir, 'ashiba.config.json');
  const config = existsSync(configPath)
    ? JSON.parse(readFileSync(configPath, 'utf8')) as {
        ddl?: { sourceDir?: unknown };
        defaultSchema?: unknown;
        searchPath?: unknown;
      }
    : {};
  const defaultSchema = typeof config.defaultSchema === 'string' && config.defaultSchema
    ? config.defaultSchema
    : 'public';
  const searchPath = Array.isArray(config.searchPath)
    ? config.searchPath.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : [defaultSchema];
  const sourceDir = typeof config.ddl?.sourceDir === 'string' && config.ddl.sourceDir
    ? config.ddl.sourceDir
    : 'db/ddl';
  const ddlDirectory = path.resolve(rootDir, sourceDir);

  return {
    defaultSchema,
    searchPath,
    ddlDirectories: existsSync(ddlDirectory) ? [ddlDirectory] : [],
  };
}

function flattenFixtureTableRows(
  fixture: FixtureTree,
  pathSegments: string[] = [],
): FixtureTableRows {
  const tableRows: FixtureTableRows = [];

  for (const [key, value] of Object.entries(fixture)) {
    const nextPathSegments = [...pathSegments, key];
    if (Array.isArray(value)) {
      tableRows.push({
        tableName: nextPathSegments.join('.'),
        rows: value.map((row) => assertRecordRow(row, nextPathSegments.join('.'))),
      });
      continue;
    }

    if (isPlainRecord(value)) {
      tableRows.push(...flattenFixtureTableRows(value, nextPathSegments));
      continue;
    }

    throw new Error(\`ZTD fixture entry \${nextPathSegments.join('.')} must be an object or an array of rows.\`);
  }

  return tableRows;
}

function assertRecordRow(value: unknown, tableName: string): Record<string, unknown> {
  if (isPlainRecord(value)) return value;
  throw new Error(\`ZTD fixture rows for \${tableName} must be objects.\`);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeSql(sql: string): string {
  return sql.replace(/\\s+/g, ' ').trim();
}

type BoundNamedSql = {
  boundSql: string;
  boundValues: unknown[];
};

function bindNamedParams(sql: string, params: Record<string, unknown>): BoundNamedSql {
  const tokens = scanNamedParams(sql);
  const boundValues: unknown[] = [];
  const slotByName = new Map<string, number>();
  let cursor = 0;
  let boundSql = '';

  for (const token of tokens) {
    boundSql += sql.slice(cursor, token.start);
    let slot = slotByName.get(token.name);
    if (!slot) {
      if (!(token.name in params)) {
        throw new Error(\`Missing named query param: \${token.name}\`);
      }
      boundValues.push(params[token.name]);
      slot = boundValues.length;
      slotByName.set(token.name, slot);
    }
    boundSql += \`$\${slot}\`;
    cursor = token.end;
  }

  boundSql += sql.slice(cursor);
  return { boundSql, boundValues };
}

type NamedToken = {
  start: number;
  end: number;
  name: string;
};

function scanNamedParams(sql: string): NamedToken[] {
  const tokens: NamedToken[] = [];
  let index = 0;

  while (index < sql.length) {
    const current = sql[index];
    const next = sql[index + 1] ?? '';
    if (current === '\\'' || current === '"') {
      index = skipQuoted(sql, index, current);
      continue;
    }
    if (current === '-' && next === '-') {
      index = sql.indexOf('\\n', index + 2);
      if (index < 0) return tokens;
      continue;
    }
    if (current === '/' && next === '*') {
      const end = sql.indexOf('*/', index + 2);
      index = end >= 0 ? end + 2 : sql.length;
      continue;
    }
    if (current === ':' && next !== ':' && /[A-Za-z_]/.test(next)) {
      const end = consumeIdentifier(sql, index + 1);
      tokens.push({ start: index, end, name: sql.slice(index + 1, end) });
      index = end;
      continue;
    }
    index += 1;
  }

  return tokens;
}

function skipQuoted(sql: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] === quote && sql[index + 1] === quote) {
      index += 2;
      continue;
    }
    if (sql[index] === quote) return index + 1;
    index += 1;
  }
  return sql.length;
}

function consumeIdentifier(sql: string, start: number): number {
  let index = start;
  while (index < sql.length && /[A-Za-z0-9_]/.test(sql[index] ?? '')) {
    index += 1;
  }
  return index;
}
`,
  },
  {
    relativePath: 'docs/migration/status.md',
    contents: `# Migration Status

This starter was created by \`ashiba init\`.

## Current State

- Visible SQL starter exists.
- Demo DDL is optional. Re-run \`ashiba init --db postgres --driver pg --with-demo-ddl --force\` if you want the tutorial DDL files.
- Feature/query boundaries are created by explicit \`ashiba feature scaffold\` commands.
- Mapper and traditional test lanes are available for scaffolded features.
- Query-local generated test plan files are created with scaffolded query boundaries and are library-owned.
- ZTD mapper cases share one pg Pool per query test file; traditional/performance tests should keep their own physical-state lifecycle.
- A small application-owned \`pg\` Pool/transaction seam exists under \`src/adapters/pg\`.

## Next Steps

- Wire \`src/adapters/pg/pool.ts\` from your application entry point and replace it if your connection policy differs.
- Replace starter sample cases with project-specific mapper and feature cases when the query contract is ready.
- Run \`ashiba feature tests check\` to inspect generated mapper coverage and drift.
- Keep SQL visible and reviewable.
`,
  },
];

const demoDdlFiles: InitFile[] = [
  {
    relativePath: 'db/ddl/public.sql',
    contents: `create table public.users (
  user_id bigserial primary key,
  email text not null,
  display_name text,
  login_count integer not null default 0,
  external_account_id bigint not null
);
`,
  },
];

const migrationDemoDdlFiles: InitFile[] = [
  {
    relativePath: 'tmp/ddl/production.sql',
    contents: `create table public.users (
  user_id bigserial primary key
);
`,
  },
];

for (const file of [...postgresStarterFiles, ...demoDdlFiles, ...migrationDemoDdlFiles]) {
  const fileName = path.basename(file.relativePath);
  const normalizedRelativePath = file.relativePath.replace(/\\/g, '/');
  if (
    forbiddenInitFileNames.has(fileName) ||
    normalizedRelativePath.startsWith('.agent/') ||
    normalizedRelativePath.startsWith('.agents/') ||
    normalizedRelativePath.startsWith('.codex/') ||
    normalizedRelativePath.includes('/skills/') ||
    normalizedRelativePath.includes('/prompts/') ||
    normalizedRelativePath.includes('/hooks/')
  ) {
    throw invalidCliInputError(
      'ASHIBA_INIT_FORBIDDEN_AI_BEHAVIOR_FILE',
      `Ashiba must not distribute AI behavior files: ${file.relativePath}`,
      'Remove the forbidden AI behavior file from the starter file list; Ashiba init may distribute ordinary README/docs, but not agent instruction files.',
      { file: file.relativePath },
    );
  }
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Create a small Ashiba SQL-first starter')
    .option('--dir <path>', 'Target directory for the starter', '.')
    .option('--db <dbms>', 'Database starter to scaffold. Currently supported: postgres')
    .option('--driver <driver>', 'Wrapped driver starter to scaffold. Currently supported: pg for postgres')
    .option('--with-demo-ddl', 'Create demo DDL under db/ddl for the starter feature flow', false)
    .option('--with-migration-demo-ddl', 'Create a temporary old DDL snapshot under tmp/ddl for migration tutorial flow', false)
    .option('--force', 'Overwrite starter-owned files when they already exist', false)
    .option('--dry-run', 'Print the files that would be created without writing them', false)
    .action((options: InitOptions) => {
      const result = runInit(options);
      const title = result.dryRun ? 'Ashiba init plan' : 'Ashiba starter created';
      const lines = [
        `${title}: ${result.rootDir}`,
        '',
        ...result.files.map((file) => `- ${file.action}: ${file.relativePath}`),
      ];
      process.stdout.write(`${lines.join('\n')}\n`);
    });
}

export function runInit(options: InitOptions = {}): InitResult {
  const rootDir = path.resolve(options.dir ?? '.');
  const force = options.force === true;
  const dryRun = options.dryRun === true;
  const target = resolveInitTarget(options.db, options.driver);
  validateStarterDependencies(rootDir, target);
  const filesToWrite = [
    ...(target.db === 'postgres' && target.driver === 'pg' ? postgresStarterFiles : []),
    ...(options.withDemoDdl === true ? demoDdlFiles : []),
    ...(options.withMigrationDemoDdl === true ? migrationDemoDdlFiles : []),
  ];

  const files = filesToWrite.map((file) => {
    const destination = path.join(rootDir, file.relativePath);
    const exists = existsSync(destination);
    const action: InitFileAction = exists ? (force ? 'overwrite' : 'skip') : 'create';

    if (!dryRun && action !== 'skip') {
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, file.contents, 'utf8');
    }

    return {
      relativePath: file.relativePath,
      action,
    };
  });

  return {
    rootDir,
    dryRun,
    files,
  };
}

function validateStarterDependencies(rootDir: string, target: InitTarget): void {
  if (target.db !== 'postgres' || target.driver !== 'pg') return;
  const packageJsonPath = path.join(rootDir, 'package.json');
  if (!existsSync(packageJsonPath)) {
    throw invalidCliInputError(
      'ASHIBA_INIT_PACKAGE_JSON_REQUIRED',
      'ashiba init --db postgres --driver pg requires package.json in the target directory.',
      [
        'Create the application package first, then install the pg-wrapper starter dependencies:',
        'npm install @ashiba/driver-adapter-pg pg',
        'npm install -D @ashiba/cli @ashiba/testkit-adapter-pg @types/pg dotenv typescript vitest',
      ].join('\n'),
    );
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    dependencies?: Record<string, unknown>;
    devDependencies?: Record<string, unknown>;
  };
  const dependencies = packageJson.dependencies ?? {};
  const devDependencies = packageJson.devDependencies ?? {};
  const missingDependencies = postgresStarterRequiredDependencies.filter(
    (name) => !(name in dependencies) && !(name in devDependencies),
  );
  const missingDevDependencies = postgresStarterRequiredDevDependencies.filter(
    (name) => !(name in dependencies) && !(name in devDependencies),
  );
  const missing = [...missingDependencies, ...missingDevDependencies];
  if (missing.length === 0) return;

  throw invalidCliInputError(
    'ASHIBA_INIT_POSTGRES_DEPENDENCIES_REQUIRED',
    `ashiba init --db postgres --driver pg requires missing package dependencies: ${missing.join(', ')}`,
    [
      'Install the matching pg-wrapper starter dependencies before generating pg-specific starter code:',
      'npm install @ashiba/driver-adapter-pg pg',
      'npm install -D @ashiba/cli @ashiba/testkit-adapter-pg @types/pg dotenv typescript vitest',
    ].join('\n'),
    { missing },
  );
}

function resolveInitTarget(dbValue: string | undefined, driverValue: string | undefined): InitTarget {
  const db = dbValue?.trim().toLowerCase();
  const driver = driverValue?.trim().toLowerCase();
  if (!db) {
    throw invalidCliInputError(
      'ASHIBA_INIT_DB_REQUIRED',
      'ashiba init requires an explicit database starter.',
      'Install the matching wrapper dependencies, then rerun with --db postgres --driver pg. MySQL and SQL Server wrapper packages exist, but full starters are not implemented yet.',
    );
  }
  if (db !== 'postgres' && db !== 'mysql' && db !== 'sqlserver') {
    throw invalidCliInputError(
      'ASHIBA_INIT_DB_UNSUPPORTED',
      `Unsupported Ashiba init database: ${dbValue}`,
      'Use one of: postgres, mysql, sqlserver.',
      { db: dbValue },
    );
  }
  if (!driver) {
    throw invalidCliInputError(
      'ASHIBA_INIT_DRIVER_REQUIRED',
      'ashiba init requires an explicit wrapped driver.',
      'Use --driver pg with --db postgres. Future starters can add other drivers for the same DBMS without changing the DBMS name.',
      { db },
    );
  }
  if (db === 'postgres' && driver === 'pg') return { db, driver };
  if (db === 'mysql' && driver === 'mysql2') {
    throw invalidCliInputError(
      'ASHIBA_INIT_STARTER_UNSUPPORTED',
      'ashiba init does not yet provide a mysql + mysql2 starter.',
      'The @ashiba/driver-adapter-mysql2 package exists for wrapper validation; add a starter template before using init for this pair.',
      { db, driver },
    );
  }
  if (db === 'sqlserver' && driver === 'mssql') {
    throw invalidCliInputError(
      'ASHIBA_INIT_STARTER_UNSUPPORTED',
      'ashiba init does not yet provide a sqlserver + mssql starter.',
      'The @ashiba/driver-adapter-mssql package exists for wrapper validation; add a starter template before using init for this pair.',
      { db, driver },
    );
  }
  throw invalidCliInputError(
    'ASHIBA_INIT_DRIVER_UNSUPPORTED',
    `Unsupported Ashiba init database/driver pair: ${db}/${driver}`,
    'Choose an implemented wrapper-specific starter. Currently implemented: --db postgres --driver pg.',
    { db, driver },
  );
}
