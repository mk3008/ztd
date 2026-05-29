import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagesRoot = path.join(repoRoot, 'packages');
const workRoot = process.env.ASHIBA_CUSTOMER_TUTORIAL_DIR
  ? path.resolve(process.env.ASHIBA_CUSTOMER_TUTORIAL_DIR)
  : path.join(process.platform === 'win32' ? 'C:\\tmp' : '/tmp', 'ashiba-customer-tutorial-smoke');
const tarballRoot = path.join(workRoot, 'tarballs');
const starterRoot = path.join(workRoot, 'starter');
const corepack = process.platform === 'win32' ? 'corepack.cmd' : 'corepack';
const docker = process.platform === 'win32' ? 'docker.exe' : 'docker';
const withDocker = process.argv.includes('--with-docker');
const dockerPort = withDocker ? await findFreePort() : null;

resetDirectory(workRoot);
mkdirSync(tarballRoot, { recursive: true });
mkdirSync(starterRoot, { recursive: true });

const packageDirs = readdirSync(packagesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(packagesRoot, entry.name))
  .filter((dir) => existsSync(path.join(dir, 'package.json')))
  .filter((dir) => readPackageJson(dir).name.startsWith('@ashiba/'));

const tarballs = new Map();

for (const packageDir of packageDirs) {
  const packageJson = readPackageJson(packageDir);
  run(corepack, ['pnpm', '--filter', packageJson.name, 'pack', '--pack-destination', tarballRoot], repoRoot);
  const tarballName = `${packageJson.name.replace('@', '').replace('/', '-')}-${packageJson.version}.tgz`;
  tarballs.set(packageJson.name, `file:${normalizePath(path.join(tarballRoot, tarballName))}`);
}

if (!tarballs.has('@ashiba/cli')) {
  throw new Error('Missing @ashiba/cli tarball.');
}

if (!tarballs.has('@ashiba/driver-adapter-pg')) {
  throw new Error('Missing @ashiba/driver-adapter-pg tarball.');
}
writePackageJson(starterRoot, {
  name: 'ashiba-starter',
  private: true,
  type: 'module',
  packageManager: 'pnpm@10.19.0',
  scripts: {
    typecheck: 'tsc --noEmit -p tsconfig.json',
    test: 'vitest run',
    'test:mapper': 'vitest run src/features -t ZTD',
  },
  dependencies: {
    '@ashiba/driver-adapter-pg': '^0.0.0',
    pg: '^8.16.3',
  },
  devDependencies: {
    '@ashiba/cli': '^0.0.0',
    '@ashiba/testkit-adapter-pg': '^0.0.0',
    '@types/pg': '^8.15.5',
    dotenv: '^16.6.1',
    typescript: '^5.9.3',
    vitest: '^4.1.7',
  },
  pnpm: {
    overrides: sortedObject(pickTarballs([
      '@ashiba/cli',
      '@ashiba/driver-adapter-core',
      '@ashiba/driver-adapter-pg',
      '@ashiba/testkit-adapter-pg',
    ])),
  },
});

run(corepack, ['pnpm', 'install'], starterRoot);
run(corepack, [
  'pnpm',
  'exec',
  'ashiba',
  'init',
  '--db',
  'postgres',
  '--driver',
  'pg',
  '--with-demo-ddl',
  '--with-migration-demo-ddl',
], starterRoot);
run(corepack, ['pnpm', 'exec', 'ashiba', 'gate', 'scaffold'], starterRoot);

assertFileContains(path.join(starterRoot, 'compose.yaml'), '${ASHIBA_TEST_DB_PORT:-5432}:5432');
assertFileContains(path.join(starterRoot, 'compose.yaml'), 'network_mode: bridge');
assertFileContains(path.join(starterRoot, 'compose.yaml'), 'POSTGRES_DB: ${ASHIBA_TEST_DB_NAME:-ashiba}');
assertFileContains(path.join(starterRoot, '.env.example'), 'ASHIBA_TEST_DB_PORT=5432');
assertFileContains(path.join(starterRoot, '.env.example'), 'ASHIBA_TEST_DB_USER=ashiba');
assertFileContains(path.join(starterRoot, '.env.example'), 'ASHIBA_TEST_DB_PASSWORD=ashiba');
assertFileContains(path.join(starterRoot, 'tests', 'support', 'setup-env.ts'), 'ASHIBA_TEST_DATABASE_URL');
assertFileContains(path.join(starterRoot, 'tests', 'support', 'setup-env.ts'), 'ASHIBA_TEST_DATABASE_URL conflicts');
assertFileContains(path.join(starterRoot, 'tests', 'support', 'ztd', 'harness.ts'), 'runQuerySpecZtdCases');
assertFileContains(path.join(starterRoot, 'tests', 'support', 'ztd', 'harness.ts'), 'createQuerySpecZtdVerifier');
assertFileContains(path.join(starterRoot, 'tests', 'support', 'ztd', 'verifier.ts'), '@ashiba/testkit-adapter-pg');
assertFileContains(path.join(starterRoot, 'tests', 'support', 'ztd', 'verifier.ts'), 'await pool.end()');
assertFileContains(path.join(starterRoot, 'src', 'features', '_shared', 'featureQueryExecutor.ts'), 'FeatureQueryExecutor');
assertFileContains(path.join(starterRoot, 'src', 'adapters', 'pg', 'pool.ts'), 'createPgPool');
assertFileContains(path.join(starterRoot, 'src', 'adapters', 'pg', 'pool.ts'), 'createPgSqlClient');
assertFileContains(path.join(starterRoot, 'src', 'adapters', 'pg', 'pool.ts'), 'createPgFeatureQueryExecutor');
assertFileContains(path.join(starterRoot, 'src', 'adapters', 'pg', 'pool.ts'), 'query -> feature -> sqlClient -> logger');
assertFileContains(path.join(starterRoot, 'src', 'adapters', 'pg', 'pool.ts'), '../logger/sqlLogger.ts');
assertFileContains(path.join(starterRoot, 'src', 'adapters', 'logger', 'sqlLogger.ts'), 'This is the intended hole for your application logger.');
assertFileContains(path.join(starterRoot, 'src', 'adapters', 'logger', 'sqlLogger.ts'), 'TODO: Replace this no-op with your application logger.');
assertFileContains(path.join(starterRoot, 'src', 'adapters', 'pg', 'pool.ts'), 'withPgFeatureQueryExecutor');
assertFileContains(path.join(starterRoot, 'src', 'adapters', 'pg', 'pool.ts'), 'withPgTransaction');
assertFileContains(path.join(starterRoot, 'vitest.config.ts'), "'#features'");
assertFileContains(path.join(starterRoot, 'vitest.config.ts'), "'#tests'");
assertFileContains(path.join(starterRoot, 'tsconfig.json'), '"#features/*"');
assertFileContains(path.join(starterRoot, 'tsconfig.json'), '"#tests/*"');
assertFileContains(path.join(starterRoot, 'db', 'ddl', 'public.sql'), 'user_id bigserial primary key');
assertFileContains(path.join(starterRoot, 'db', 'ddl', 'public.sql'), 'email text not null');
assertFileContains(path.join(starterRoot, 'db', 'ddl', 'public.sql'), 'display_name text');
assertFileContains(path.join(starterRoot, 'db', 'ddl', 'public.sql'), 'login_count integer not null default 0');
assertFileContains(path.join(starterRoot, 'db', 'ddl', 'public.sql'), 'external_account_id bigint not null');
assertFileContains(path.join(starterRoot, 'tmp', 'ddl', 'production.sql'), 'create table public.users');
assertFileContains(path.join(starterRoot, 'tmp', 'ddl', 'production.sql'), 'user_id bigserial primary key');
assertPathMissing(path.join(starterRoot, 'src', 'features', 'smoke'));
assertFileContains(path.join(starterRoot, 'package.json'), '@ashiba/driver-adapter-pg');
assertFileContains(path.join(starterRoot, 'package.json'), '@ashiba/testkit-adapter-pg');
assertFileContains(path.join(starterRoot, 'package.json'), '@ashiba/cli');
assertFileContains(path.join(starterRoot, 'package.json'), '"ashiba:check": "node node_modules/@ashiba/cli/dist/index.js check"');
assertFileContains(path.join(starterRoot, 'package.json'), '"ashiba:verify": "node node_modules/@ashiba/cli/dist/index.js check --full --mapper-test-command \\"vitest run\\""');
assertFileContains(path.join(starterRoot, '.github', 'workflows', 'ashiba-contract.yml'), 'pnpm ashiba:verify');
assertFileContains(path.join(starterRoot, 'README.md'), 'docker compose up -d');

run(corepack, ['pnpm', 'ashiba:check'], starterRoot);
run(corepack, ['pnpm', 'typecheck'], starterRoot);

copyFileSync(path.join(starterRoot, '.env.example'), path.join(starterRoot, '.env'));
if (dockerPort) {
  writeFileSync(
    path.join(starterRoot, '.env'),
    [
      'ASHIBA_TEST_DB_HOST=localhost',
      `ASHIBA_TEST_DB_PORT=${dockerPort}`,
      'ASHIBA_TEST_DB_NAME=ashiba',
      'ASHIBA_TEST_DB_USER=ashiba',
      'ASHIBA_TEST_DB_PASSWORD=ashiba',
      '',
    ].join('\n'),
    'utf8',
  );
}

try {
  if (withDocker) {
    run(docker, ['compose', 'up', '-d'], starterRoot);
    waitForPostgres(starterRoot, dockerPort);
  }
  scaffoldFeature('users-list', 'list');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-list', 'queries', 'list', 'list.sql'), 'from "public"."users"');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-list', 'queries', 'list', 'query.ts'), "from '#features/_shared/featureQueryExecutor.js'");
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-list', 'queries', 'list', 'query.ts'), 'sqlPath');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-list', 'queries', 'list', 'query.ts'), 'metadata');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-list', 'queries', 'list', 'query.ts'), 'queryModel');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-list', 'queries', 'list', 'query.ts'), "from './generated/query.meta.js'");
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-list', 'queries', 'list', 'query.ts'), 'optionalConditionCompression: true');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-list', 'queries', 'list', 'generated', 'query.meta.ts'), 'Generated by Ashiba. Do not edit by hand.');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-list', 'queries', 'list', 'generated', 'query.meta.ts'), '"optionalConditionCompression"');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-list', 'queries', 'list', 'generated', 'query.meta.ts'), '"postgres"');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-list', 'queries', 'list', 'tests', 'list.boundary.ztd.test.ts'), "from '#tests/support/ztd/harness.js'");
  run(corepack, ['pnpm', 'exec', 'ashiba', 'feature', 'query', 'refresh', 'users-list', 'list', '--dry-run'], starterRoot);
  run(corepack, ['pnpm', 'ashiba:check'], starterRoot);
  run(corepack, ['pnpm', 'ashiba:verify'], starterRoot, withDocker ? {} : { ASHIBA_SKIP_DB_BACKED_TESTS: '1' });
  run(corepack, ['pnpm', 'test:mapper'], starterRoot, withDocker ? {} : { ASHIBA_SKIP_DB_BACKED_TESTS: '1' });
  run(corepack, ['pnpm', 'typecheck'], starterRoot);
  scaffoldFeature('users-insert', 'insert');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-insert', 'queries', 'insert-users', 'insert-users.sql'), ':email');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-insert', 'queries', 'insert-users', 'insert-users.sql'), ':display_name');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-insert', 'queries', 'insert-users', 'insert-users.sql'), ':external_account_id');
  assertFileDoesNotContain(path.join(starterRoot, 'src', 'features', 'users-insert', 'queries', 'insert-users', 'insert-users.sql'), ':user_id');
  assertFileDoesNotContain(path.join(starterRoot, 'src', 'features', 'users-insert', 'queries', 'insert-users', 'insert-users.sql'), ':login_count');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-insert', 'queries', 'insert-users', 'tests', 'generated', 'mapping.cases.ts'), 'default-generated-value-mapping');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-insert', 'queries', 'insert-users', 'tests', 'generated', 'mapping.cases.ts'), 'nullable-input-output-mapping');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-insert', 'queries', 'insert-users', 'tests', 'generated', 'mapping.cases.ts'), 'boundary-value-mapping');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-insert', 'queries', 'insert-users', 'tests', 'generated', 'mapping.cases.ts'), 'negative-boundary-value-mapping');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-insert', 'queries', 'insert-users', 'tests', 'generated', 'mapping.cases.ts'), 'login_count: 0');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-insert', 'queries', 'insert-users', 'tests', 'generated', 'mapping.cases.ts'), 'display_name: null');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-insert', 'queries', 'insert-users', 'tests', 'generated', 'mapping.cases.ts'), 'external_account_id: "9223372036854775807"');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-insert', 'queries', 'insert-users', 'tests', 'generated', 'mapping.cases.ts'), 'external_account_id: "-9223372036854775808"');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-insert', 'queries', 'insert-users', 'tests', 'cases', 'logic.case.ts'), 'Human/AI-owned SQL logic cases');
  run(corepack, ['pnpm', 'ashiba:check'], starterRoot);
  run(corepack, ['pnpm', 'ashiba:verify'], starterRoot, withDocker ? {} : { ASHIBA_SKIP_DB_BACKED_TESTS: '1' });
  run(corepack, ['pnpm', 'test:mapper'], starterRoot, withDocker ? {} : { ASHIBA_SKIP_DB_BACKED_TESTS: '1' });
  run(corepack, ['pnpm', 'typecheck'], starterRoot);

  const ddlPath = path.join(starterRoot, 'db', 'ddl', 'public.sql');
  const originalDdl = readFileSync(ddlPath, 'utf8');
  writeFileSync(
    ddlPath,
    originalDdl.replace('external_account_id bigint not null', 'external_account_id bigint not null,\n  risk_score integer not null'),
    'utf8',
  );
  const failedCheck = runExpectFailure(process.execPath, ['node_modules/@ashiba/cli/dist/index.js', 'check'], starterRoot);
  if (!failedCheck.includes('ASHIBA_PROJECT_INSERT_REQUIRED_COLUMN_OMITTED')) {
    throw new Error(`Expected passive gate to catch omitted required INSERT column. Output:\n${failedCheck}`);
  }
  writeFileSync(ddlPath, originalDdl, 'utf8');

  scaffoldFeature('users-get-by-id', 'get-by-id');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-get-by-id', 'queries', 'get-by-id', 'get-by-id.sql'), 'from "public"."users"');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-get-by-id', 'queries', 'get-by-id', 'get-by-id.sql'), 'where');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-get-by-id', 'queries', 'get-by-id', 'get-by-id.sql'), ':user_id');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-get-by-id', 'queries', 'get-by-id', 'tests', 'get-by-id.boundary.ztd.test.ts'), "from '#tests/support/ztd/harness.js'");
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-get-by-id', 'queries', 'get-by-id', 'tests', 'generated', 'mapping.cases.ts'), 'db-type-mapping');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-get-by-id', 'queries', 'get-by-id', 'tests', 'generated', 'mapping.cases.ts'), 'boundary-value-mapping');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-get-by-id', 'queries', 'get-by-id', 'tests', 'generated', 'mapping.cases.ts'), 'nullable-output-mapping');
  scaffoldFeature('users-update', 'update');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-update', 'queries', 'update-users', 'update-users.sql'), 'update "public"."users"');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-update', 'queries', 'update-users', 'update-users.sql'), ':user_id');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-update', 'queries', 'update-users', 'update-users.sql'), ':email');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-update', 'queries', 'update-users', 'update-users.sql'), ':display_name');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-update', 'queries', 'update-users', 'update-users.sql'), ':external_account_id');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-update', 'queries', 'update-users', 'update-users.sql'), 'returning "user_id"');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-update', 'queries', 'update-users', 'update-users.sql'), '"email"');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-update', 'queries', 'update-users', 'tests', 'update-users.boundary.ztd.test.ts'), "from '#tests/support/ztd/harness.js'");
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-update', 'queries', 'update-users', 'tests', 'generated', 'mapping.cases.ts'), 'binds update-users update params and maps returned columns');
  scaffoldFeature('users-delete', 'delete');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-delete', 'queries', 'delete-users', 'delete-users.sql'), 'delete from "public"."users"');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-delete', 'queries', 'delete-users', 'delete-users.sql'), ':user_id');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-delete', 'queries', 'delete-users', 'delete-users.sql'), 'returning "user_id"');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-delete', 'queries', 'delete-users', 'delete-users.sql'), '"email"');
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-delete', 'queries', 'delete-users', 'tests', 'delete-users.boundary.ztd.test.ts'), "from '#tests/support/ztd/harness.js'");
  assertFileContains(path.join(starterRoot, 'src', 'features', 'users-delete', 'queries', 'delete-users', 'tests', 'generated', 'mapping.cases.ts'), 'binds delete-users delete params and maps returned columns');
  run(corepack, ['pnpm', 'test'], starterRoot, withDocker ? {} : { ASHIBA_SKIP_DB_BACKED_TESTS: '1' });
  run(corepack, ['pnpm', 'test:mapper'], starterRoot, withDocker ? {} : { ASHIBA_SKIP_DB_BACKED_TESTS: '1' });
  run(corepack, ['pnpm', 'typecheck'], starterRoot);
  run(corepack, [
    'pnpm',
    'exec',
    'ashiba',
    'ddl',
    'migration',
    'generate',
    '--from',
    'tmp/ddl/production.sql',
    '--to',
    'db/ddl/public.sql',
    '--out',
    'tmp/ddl/migration.sql',
    '--dry-run',
  ], starterRoot);
  if (existsSync(path.join(starterRoot, 'tmp', 'ddl', 'migration.sql'))) {
    throw new Error('Dry-run migration unexpectedly wrote tmp/ddl/migration.sql.');
  }
  run(corepack, [
    'pnpm',
    'exec',
    'ashiba',
    'ddl',
    'migration',
    'generate',
    '--from',
    'tmp/ddl/production.sql',
    '--to',
    'db/ddl/public.sql',
    '--out',
    'tmp/ddl/migration.sql',
  ], starterRoot);
  assertFileContains(path.join(starterRoot, 'tmp', 'ddl', 'migration.sql'), 'email');
  run(corepack, [
    'pnpm',
    'exec',
    'ashiba',
    'perf',
    'scenario',
    'init',
    '--scenario',
    'users-list',
    '--query',
    'src/features/users-list/queries/list/list.sql',
    '--target-rows',
    'public.users=100000',
    '--max-duration-ms',
    '100',
    '--timeout-ms',
    '30000',
  ], starterRoot);
  assertFileContains(path.join(starterRoot, 'perf', 'scenarios', 'users-list', 'scenario.json'), '"public.users": 100000');
  assertFileContains(path.join(starterRoot, 'perf', 'scenarios', 'users-list', 'README.md'), 'Accepted indexes must be promoted into db/ddl');
  mkdirSync(path.join(starterRoot, 'tmp', 'perf'), { recursive: true });
  writeFileSync(
    path.join(starterRoot, 'tmp', 'perf', 'users-list-explain.json'),
    `${JSON.stringify([{ Plan: { 'Node Type': 'Seq Scan', 'Relation Name': 'users' } }], null, 2)}\n`,
    'utf8',
  );
  run(corepack, [
    'pnpm',
    'exec',
    'ashiba',
    'perf',
    'scenario',
    'measure',
    '--scenario',
    'users-list',
    '--duration-ms',
    '42',
    '--explain',
    'tmp/perf/users-list-explain.json',
    '--evidence-name',
    'baseline',
  ], starterRoot);
  assertFileContains(path.join(starterRoot, 'perf', 'scenarios', 'users-list', 'evidence', 'baseline.json'), '"durationMs": 42');
  assertFileContains(path.join(starterRoot, 'perf', 'scenarios', 'users-list', 'evidence', 'baseline.json'), '"explainCollected": true');
  assertFileContains(path.join(starterRoot, 'perf', 'scenarios', 'users-list', 'evidence', 'baseline.json'), '"candidateIndexScope": "sandbox-only"');
  assertFileContains(path.join(starterRoot, 'perf', 'scenarios', 'users-list', 'evidence', 'baseline.json'), 'Accepted indexes must be written to db/ddl');
  run(corepack, ['pnpm', 'exec', 'ashiba', '--help'], starterRoot);
  run(corepack, ['pnpm', 'exec', 'ashiba', 'config', '--compact'], starterRoot);
} finally {
  if (withDocker) {
    try {
      run(docker, ['compose', 'down', '--volumes'], starterRoot);
    } catch (error) {
      console.warn(`docker compose cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

console.log(`customer tutorial smoke passed: ${starterRoot}`);

function scaffoldFeature(featureName, action) {
  run(corepack, ['pnpm', 'exec', 'ashiba', 'feature', 'scaffold', featureName, '--table', 'users', '--action', action, '--dry-run'], starterRoot);
  run(corepack, ['pnpm', 'exec', 'ashiba', 'feature', 'scaffold', featureName, '--table', 'users', '--action', action], starterRoot);
}

function run(command, args, cwd, extraEnv = {}) {
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...extraEnv },
  });
}

function runDirect(command, args, cwd, extraEnv = {}) {
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, ...extraEnv },
  });
}

function runExpectFailure(command, args, cwd, extraEnv = {}) {
  try {
    execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      shell: false,
      env: { ...process.env, ...extraEnv },
    });
  } catch (error) {
    const stdout = error?.stdout ? String(error.stdout) : '';
    const stderr = error?.stderr ? String(error.stderr) : '';
    return `${stdout}${stderr}`;
  }
  throw new Error(`Expected command to fail: ${command} ${args.join(' ')}`);
}

function readPackageJson(directory) {
  return JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'));
}

function writePackageJson(directory, value) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'package.json'), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function resetDirectory(directory) {
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
    return;
  }

  try {
    rmSync(directory, { recursive: true, force: true });
    mkdirSync(directory, { recursive: true });
    return;
  } catch (error) {
    if (!isBusyFsError(error)) throw error;
  }

  for (const entry of readdirSync(directory)) {
    const entryPath = path.join(directory, entry);
    try {
      rmSync(entryPath, { recursive: true, force: true });
    } catch (error) {
      if (!isBusyFsError(error)) throw error;
      resetDirectory(entryPath);
      try {
        rmSync(entryPath, { recursive: true, force: true });
      } catch (innerError) {
        if (!isBusyFsError(innerError)) throw innerError;
      }
    }
  }
}

function isBusyFsError(error) {
  return error instanceof Error && 'code' in error && (error.code === 'EBUSY' || error.code === 'EPERM');
}

function sortedObject(entries) {
  return Object.fromEntries([...entries.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function pickTarballs(packageNames) {
  return new Map(packageNames.map((packageName) => {
    const tarball = tarballs.get(packageName);
    if (!tarball) {
      throw new Error(`Missing ${packageName} tarball.`);
    }
    return [packageName, tarball];
  }));
}

function assertFileContains(filePath, expected) {
  if (!existsSync(filePath)) {
    throw new Error(`Expected file does not exist: ${filePath}`);
  }
  const contents = readFileSync(filePath, 'utf8');
  if (!contents.includes(expected)) {
    throw new Error(`Expected ${filePath} to contain: ${expected}`);
  }
}

function assertFileDoesNotContain(filePath, unexpected) {
  if (!existsSync(filePath)) {
    throw new Error(`Expected file does not exist: ${filePath}`);
  }
  const contents = readFileSync(filePath, 'utf8');
  if (contents.includes(unexpected)) {
    throw new Error(`Expected ${filePath} not to contain: ${unexpected}`);
  }
}

function assertPathMissing(filePath) {
  if (existsSync(filePath)) {
    throw new Error(`Expected path not to exist: ${filePath}`);
  }
}

function normalizePath(value) {
  return value.replace(/\\/g, '/');
}

function waitForPostgres(cwd, port) {
  const script = `
    const pg = await import('pg');
    const url = process.env.ASHIBA_TEST_DATABASE_URL;
    let lastError;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const client = new pg.default.Client({ connectionString: url });
      try {
        await client.connect();
        await client.query('select 1');
        await client.end();
        process.exit(0);
      } catch (error) {
        lastError = error;
        try { await client.end(); } catch {}
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    console.error(lastError);
    process.exit(1);
  `;
  runDirect(process.execPath, ['-e', script], cwd, {
    ASHIBA_TEST_DATABASE_URL: `postgres://ashiba:ashiba@localhost:${port}/ashiba`,
  });
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === 'object' && address !== null) {
          resolve(address.port);
          return;
        }
        reject(new Error('Failed to reserve a free local port for Docker Compose.'));
      });
    });
  });
}
