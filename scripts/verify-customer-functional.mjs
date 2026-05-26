import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagesRoot = path.join(repoRoot, 'packages');
const workRoot = process.env.ASHIBA_CUSTOMER_FUNCTIONAL_DIR
  ? path.resolve(process.env.ASHIBA_CUSTOMER_FUNCTIONAL_DIR)
  : path.join(process.platform === 'win32' ? 'C:\\tmp' : '/tmp', 'ashiba-customer-functional');
const tarballRoot = path.join(workRoot, 'tarballs');
const customerRoot = path.join(workRoot, 'customers');
const corepack = process.platform === 'win32' ? 'corepack.cmd' : 'corepack';
const docker = process.platform === 'win32' ? 'docker.exe' : 'docker';
const withoutDocker = process.argv.includes('--no-docker');

resetDirectory(workRoot);
mkdirSync(tarballRoot, { recursive: true });
mkdirSync(customerRoot, { recursive: true });

const tarballs = packAshibaPackages();

if (withoutDocker) {
  throw new Error('customer functional tests require Docker because they must execute real DB-backed CRUD and mapping checks.');
}

const containerNames = {
  mysql2: `ashiba-mysql2-functional-${process.pid}`,
  mssql: `ashiba-mssql-functional-${process.pid}`,
};

try {
  const mysqlPort = startMysqlContainer(containerNames.mysql2);
  const mssqlPort = startMssqlContainer(containerNames.mssql);

  verifyMysql2Customer(mysqlPort);
  verifyMssqlCustomer(mssqlPort);
} finally {
  cleanupContainer(containerNames.mysql2);
  cleanupContainer(containerNames.mssql);
}

console.log(`customer functional tests passed: ${customerRoot}`);

function verifyMysql2Customer(port) {
  const root = path.join(customerRoot, 'mysql2');
  mkdirSync(root, { recursive: true });
  writeCustomerPackageJson(root, {
    dependencies: {
      '@ashiba/driver-adapter-mysql2': '^0.0.0',
      mysql2: '^3.15.3',
    },
    devDependencies: {
      '@ashiba/cli': '^0.0.0',
    },
    overrides: pickTarballs([
      '@ashiba/cli',
      '@ashiba/driver-adapter-core',
      '@ashiba/driver-adapter-mysql2',
    ]),
  });
  writeFunctionalSqlFiles(root);
  writeFileSync(path.join(root, 'run-functional.mjs'), renderMysql2FunctionalRunner(port), 'utf8');

  run(corepack, ['pnpm', 'install'], root);
  generateQueryModels(root);
  waitForMysql(root, port);
  run(process.execPath, ['run-functional.mjs'], root);
}

function verifyMssqlCustomer(port) {
  const root = path.join(customerRoot, 'mssql');
  mkdirSync(root, { recursive: true });
  writeCustomerPackageJson(root, {
    dependencies: {
      '@ashiba/driver-adapter-mssql': '^0.0.0',
      mssql: '^11.0.1',
    },
    devDependencies: {
      '@ashiba/cli': '^0.0.0',
    },
    overrides: pickTarballs([
      '@ashiba/cli',
      '@ashiba/driver-adapter-core',
      '@ashiba/driver-adapter-mssql',
    ]),
  });
  writeFunctionalSqlFiles(root);
  writeFileSync(path.join(root, 'run-functional.mjs'), renderMssqlFunctionalRunner(port), 'utf8');

  run(corepack, ['pnpm', 'install'], root);
  generateQueryModels(root);
  waitForMssql(root, port);
  run(process.execPath, ['run-functional.mjs'], root);
}

function writeCustomerPackageJson(root, options) {
  writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({
    name: `ashiba-customer-functional-${path.basename(root)}`,
    private: true,
    type: 'module',
    packageManager: 'pnpm@10.19.0',
    dependencies: options.dependencies,
    devDependencies: options.devDependencies,
    pnpm: {
      overrides: sortedObject(options.overrides),
    },
  }, null, 2)}\n`, 'utf8');
}

function writeFunctionalSqlFiles(root) {
  for (const query of ['insert-user', 'select-user', 'update-user', 'delete-user', 'insert-type-sample', 'select-type-sample']) {
    mkdirSync(path.join(root, 'tmp', 'query-contracts', query), { recursive: true });
  }
  writeFileSync(path.join(root, 'tmp', 'query-contracts', 'insert-user', 'insert-user.sql'), [
    'insert into users (email, display_name, external_account_id)',
    'values (:email, :display_name, :external_account_id)',
    '',
  ].join('\n'), 'utf8');
  writeFileSync(path.join(root, 'tmp', 'query-contracts', 'select-user', 'select-user.sql'), [
    'select user_id, email, display_name, login_count, external_account_id',
    'from users',
    'where email = :email',
    '',
  ].join('\n'), 'utf8');
  writeFileSync(path.join(root, 'tmp', 'query-contracts', 'update-user', 'update-user.sql'), [
    'update users',
    'set display_name = :display_name, login_count = :login_count',
    'where email = :email',
    '',
  ].join('\n'), 'utf8');
  writeFileSync(path.join(root, 'tmp', 'query-contracts', 'delete-user', 'delete-user.sql'), [
    'delete from users',
    'where email = :email',
    '',
  ].join('\n'), 'utf8');
  writeFileSync(path.join(root, 'tmp', 'query-contracts', 'insert-type-sample', 'insert-type-sample.sql'), [
    'insert into type_samples (',
    '  sample_key, int_value, smallint_value, bigint_value, decimal_value, float_value,',
    '  bool_value, varchar_value, text_value, date_value, datetime_value',
    ') values (',
    '  :sample_key, :int_value, :smallint_value, :bigint_value, :decimal_value, :float_value,',
    '  :bool_value, :varchar_value, :text_value, :date_value, :datetime_value',
    ')',
    '',
  ].join('\n'), 'utf8');
  writeFileSync(path.join(root, 'tmp', 'query-contracts', 'select-type-sample', 'select-type-sample.sql'), [
    'select',
    '  sample_key, int_value, smallint_value, bigint_value, decimal_value, float_value,',
    '  bool_value, varchar_value, text_value, date_value, datetime_value',
    'from type_samples',
    'where sample_key = :sample_key',
    '',
  ].join('\n'), 'utf8');
}

function generateQueryModels(root) {
  for (const query of ['insert-user', 'select-user', 'update-user', 'delete-user', 'insert-type-sample', 'select-type-sample']) {
    const queryDir = `tmp/query-contracts/${query}`;
    run(corepack, [
      'pnpm',
      'exec',
      'ashiba',
      'model-gen',
      `${queryDir}/${query}.sql`,
      '--out',
      `${queryDir}/${query}.query.ts`,
    ], root);
    assertFileContains(path.join(root, 'tmp', 'query-contracts', query, 'generated', `${query}.meta.ts`), 'queryModel');
    assertFileContains(path.join(root, 'tmp', 'query-contracts', query, `${query}.query.ts`), `from "./generated/${query}.meta.js"`);
  }
}

function renderMysql2FunctionalRunner(port) {
  return `
import { readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
import { createMysql2Adapter } from '@ashiba/driver-adapter-mysql2';

const connection = await mysql.createConnection({
  host: '127.0.0.1',
  port: ${port},
  user: 'root',
  password: 'ashiba',
  database: 'ashiba',
  supportBigNumbers: true,
  bigNumberStrings: true,
  dateStrings: true,
});

try {
  await connection.execute('drop table if exists users');
  await connection.execute('drop table if exists type_samples');
  await connection.execute(\`
    create table users (
      user_id bigint primary key auto_increment,
      email varchar(255) not null unique,
      display_name varchar(255) null,
      login_count integer not null default 0,
      external_account_id bigint not null
    )
  \`);
  await connection.execute(\`
    create table type_samples (
      sample_key varchar(64) primary key,
      int_value integer not null,
      smallint_value smallint not null,
      bigint_value bigint not null,
      decimal_value decimal(12, 2) not null,
      float_value double not null,
      bool_value boolean not null,
      varchar_value varchar(255) not null,
      text_value text not null,
      date_value date not null,
      datetime_value datetime(3) not null
    )
  \`);
  const adapter = createMysql2Adapter(connection);

  await execute(adapter, 'insert-user', {
    email: 'mysql-default@example.test',
    display_name: null,
    external_account_id: '9223372036854775807',
  });
  const defaultRows = await execute(adapter, 'select-user', { email: 'mysql-default@example.test' });
  assertEqual(defaultRows.rows[0]?.display_name, null, 'mysql nullable output mapping');
  assertEqual(defaultRows.rows[0]?.login_count, 0, 'mysql default value mapping');
  assertEqual(String(defaultRows.rows[0]?.external_account_id), '9223372036854775807', 'mysql bigint boundary mapping');

  await execute(adapter, 'insert-user', {
    email: 'mysql-negative@example.test',
    display_name: 'negative',
    external_account_id: '-9223372036854775808',
  });
  const negativeRows = await execute(adapter, 'select-user', { email: 'mysql-negative@example.test' });
  assertEqual(String(negativeRows.rows[0]?.external_account_id), '-9223372036854775808', 'mysql negative bigint boundary mapping');

  await execute(adapter, 'update-user', {
    email: 'mysql-default@example.test',
    display_name: 'updated',
    login_count: 7,
  });
  const updatedRows = await execute(adapter, 'select-user', { email: 'mysql-default@example.test' });
  assertEqual(updatedRows.rows[0]?.display_name, 'updated', 'mysql update mapping');
  assertEqual(updatedRows.rows[0]?.login_count, 7, 'mysql integer mapping');

  await execute(adapter, 'delete-user', { email: 'mysql-negative@example.test' });
  const deletedRows = await execute(adapter, 'select-user', { email: 'mysql-negative@example.test' });
  assertEqual(deletedRows.rows.length, 0, 'mysql delete mapping');

  await execute(adapter, 'insert-type-sample', {
    sample_key: 'mysql-types',
    int_value: 2147483647,
    smallint_value: 32767,
    bigint_value: '9223372036854775807',
    decimal_value: '1234567890.12',
    float_value: 12345.5,
    bool_value: true,
    varchar_value: 'varchar text',
    text_value: 'long text value',
    date_value: '2026-05-26',
    datetime_value: '2026-05-26 12:34:56.789',
  });
  const typeRows = await execute(adapter, 'select-type-sample', { sample_key: 'mysql-types' });
  const typeRow = typeRows.rows[0];
  assertEqual(typeRow?.int_value, 2147483647, 'mysql integer type mapping');
  assertEqual(typeRow?.smallint_value, 32767, 'mysql smallint type mapping');
  assertEqual(String(typeRow?.bigint_value), '9223372036854775807', 'mysql bigint type mapping');
  assertEqual(String(typeRow?.decimal_value), '1234567890.12', 'mysql decimal type mapping');
  assertEqual(Number(typeRow?.float_value), 12345.5, 'mysql double type mapping');
  assertEqual(Boolean(typeRow?.bool_value), true, 'mysql boolean type mapping');
  assertEqual(typeRow?.varchar_value, 'varchar text', 'mysql varchar type mapping');
  assertEqual(typeRow?.text_value, 'long text value', 'mysql text type mapping');
  assertDateLike(typeRow?.date_value, '2026-05-26', 'mysql date type mapping');
  assertDateTimeLike(typeRow?.datetime_value, '2026-05-26T12:34:56.789', 'mysql datetime type mapping');
} finally {
  await connection.end();
}

async function execute(adapter, name, params) {
  const sql = readFileSync(new URL(\`./tmp/query-contracts/\${name}/\${name}.sql\`, import.meta.url), 'utf8');
  const queryModel = loadQueryModel(name);
  return adapter.execute({ sql, sqlPath: \`tmp/query-contracts/\${name}/\${name}.sql\`, queryModel }, params);
}

function loadQueryModel(name) {
  const source = readFileSync(new URL(\`./tmp/query-contracts/\${name}/generated/\${name}.meta.ts\`, import.meta.url), 'utf8');
  const json = source.match(/export const queryModel = ([\\s\\S]*) as const;/)?.[1];
  if (!json) throw new Error(\`query metadata not found for \${name}\`);
  return JSON.parse(json);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(\`\${label}: expected \${JSON.stringify(expected)}, got \${JSON.stringify(actual)}\`);
  }
}

function assertDateLike(actual, expectedDate, label) {
  const actualDate = actual instanceof Date ? actual.toISOString().slice(0, 10) : String(actual).slice(0, 10);
  assertEqual(actualDate, expectedDate, label);
}

function assertDateTimeLike(actual, expectedPrefix, label) {
  const value = actual instanceof Date ? actual.toISOString() : String(actual).replace(' ', 'T');
  if (!value.startsWith(expectedPrefix)) {
    throw new Error(\`\${label}: expected prefix \${expectedPrefix}, got \${value}\`);
  }
}
`;
}

function renderMssqlFunctionalRunner(port) {
  return `
import { readFileSync } from 'node:fs';
import sql from 'mssql';
import { createMssqlAdapter } from '@ashiba/driver-adapter-mssql';

const pool = await sql.connect({
  server: '127.0.0.1',
  port: ${port},
  user: 'sa',
  password: 'Ashiba_12345',
  database: 'master',
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
});

try {
  await pool.request().query('if object_id(N\\'dbo.users\\', N\\'U\\') is not null drop table dbo.users');
  await pool.request().query('if object_id(N\\'dbo.type_samples\\', N\\'U\\') is not null drop table dbo.type_samples');
  await pool.request().query(\`
    create table dbo.users (
      user_id bigint identity(1,1) primary key,
      email nvarchar(255) not null unique,
      display_name nvarchar(255) null,
      login_count integer not null default 0,
      external_account_id bigint not null
    )
  \`);
  await pool.request().query(\`
    create table dbo.type_samples (
      sample_key nvarchar(64) primary key,
      int_value integer not null,
      smallint_value smallint not null,
      bigint_value bigint not null,
      decimal_value decimal(12, 2) not null,
      float_value float not null,
      bool_value bit not null,
      varchar_value nvarchar(255) not null,
      text_value nvarchar(max) not null,
      date_value date not null,
      datetime_value datetime2(3) not null
    )
  \`);
  const adapter = createMssqlAdapter(pool);

  await execute(adapter, 'insert-user', {
    email: 'mssql-default@example.test',
    display_name: null,
    external_account_id: '9223372036854775807',
  });
  const defaultRows = await execute(adapter, 'select-user', { email: 'mssql-default@example.test' });
  assertEqual(defaultRows.recordset?.[0]?.display_name, null, 'mssql nullable output mapping');
  assertEqual(defaultRows.recordset?.[0]?.login_count, 0, 'mssql default value mapping');
  assertEqual(String(defaultRows.recordset?.[0]?.external_account_id), '9223372036854775807', 'mssql bigint boundary mapping');

  await execute(adapter, 'insert-user', {
    email: 'mssql-negative@example.test',
    display_name: 'negative',
    external_account_id: '-9223372036854775808',
  });
  const negativeRows = await execute(adapter, 'select-user', { email: 'mssql-negative@example.test' });
  assertEqual(String(negativeRows.recordset?.[0]?.external_account_id), '-9223372036854775808', 'mssql negative bigint boundary mapping');

  await execute(adapter, 'update-user', {
    email: 'mssql-default@example.test',
    display_name: 'updated',
    login_count: 7,
  });
  const updatedRows = await execute(adapter, 'select-user', { email: 'mssql-default@example.test' });
  assertEqual(updatedRows.recordset?.[0]?.display_name, 'updated', 'mssql update mapping');
  assertEqual(updatedRows.recordset?.[0]?.login_count, 7, 'mssql integer mapping');

  await execute(adapter, 'delete-user', { email: 'mssql-negative@example.test' });
  const deletedRows = await execute(adapter, 'select-user', { email: 'mssql-negative@example.test' });
  assertEqual(deletedRows.recordset?.length, 0, 'mssql delete mapping');

  await execute(adapter, 'insert-type-sample', {
    sample_key: 'mssql-types',
    int_value: 2147483647,
    smallint_value: 32767,
    bigint_value: '9223372036854775807',
    decimal_value: '1234567890.12',
    float_value: 12345.5,
    bool_value: true,
    varchar_value: 'varchar text',
    text_value: 'long text value',
    date_value: '2026-05-26',
    datetime_value: '2026-05-26T12:34:56.789',
  });
  const typeRows = await execute(adapter, 'select-type-sample', { sample_key: 'mssql-types' });
  const typeRow = typeRows.recordset?.[0];
  assertEqual(typeRow?.int_value, 2147483647, 'mssql integer type mapping');
  assertEqual(typeRow?.smallint_value, 32767, 'mssql smallint type mapping');
  assertEqual(String(typeRow?.bigint_value), '9223372036854775807', 'mssql bigint type mapping');
  assertEqual(Number(typeRow?.decimal_value), 1234567890.12, 'mssql decimal type mapping');
  assertEqual(Number(typeRow?.float_value), 12345.5, 'mssql float type mapping');
  assertEqual(Boolean(typeRow?.bool_value), true, 'mssql bit type mapping');
  assertEqual(typeRow?.varchar_value, 'varchar text', 'mssql nvarchar type mapping');
  assertEqual(typeRow?.text_value, 'long text value', 'mssql nvarchar(max) type mapping');
  assertDateLike(typeRow?.date_value, '2026-05-26', 'mssql date type mapping');
  assertDateTimeLike(typeRow?.datetime_value, '2026-05-26T12:34:56.789', 'mssql datetime2 type mapping');
} finally {
  await pool.close();
}

async function execute(adapter, name, params) {
  const sqlText = readFileSync(new URL(\`./tmp/query-contracts/\${name}/\${name}.sql\`, import.meta.url), 'utf8');
  const queryModel = loadQueryModel(name);
  return adapter.execute({ sql: sqlText, sqlPath: \`tmp/query-contracts/\${name}/\${name}.sql\`, queryModel }, params);
}

function loadQueryModel(name) {
  const source = readFileSync(new URL(\`./tmp/query-contracts/\${name}/generated/\${name}.meta.ts\`, import.meta.url), 'utf8');
  const json = source.match(/export const queryModel = ([\\s\\S]*) as const;/)?.[1];
  if (!json) throw new Error(\`query metadata not found for \${name}\`);
  return JSON.parse(json);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(\`\${label}: expected \${JSON.stringify(expected)}, got \${JSON.stringify(actual)}\`);
  }
}

function assertDateLike(actual, expectedDate, label) {
  const actualDate = actual instanceof Date ? actual.toISOString().slice(0, 10) : String(actual).slice(0, 10);
  assertEqual(actualDate, expectedDate, label);
}

function assertDateTimeLike(actual, expectedPrefix, label) {
  const value = actual instanceof Date ? actual.toISOString() : String(actual).replace(' ', 'T');
  if (!value.startsWith(expectedPrefix)) {
    throw new Error(\`\${label}: expected prefix \${expectedPrefix}, got \${value}\`);
  }
}
`;
}

function startMysqlContainer(name) {
  cleanupContainer(name);
  run(docker, [
    'run',
    '--name',
    name,
    '-e',
    'MYSQL_ROOT_PASSWORD=ashiba',
    '-e',
    'MYSQL_DATABASE=ashiba',
    '-p',
    '127.0.0.1::3306',
    '-d',
    'mysql:8.0',
  ], repoRoot);
  return inspectPublishedPort(name, '3306/tcp');
}

function startMssqlContainer(name) {
  cleanupContainer(name);
  run(docker, [
    'run',
    '--name',
    name,
    '-e',
    'ACCEPT_EULA=Y',
    '-e',
    'MSSQL_SA_PASSWORD=Ashiba_12345',
    '-p',
    '127.0.0.1::1433',
    '-d',
    'mcr.microsoft.com/mssql/server:2022-latest',
  ], repoRoot);
  return inspectPublishedPort(name, '1433/tcp');
}

function waitForMysql(root, port) {
  run(process.execPath, ['--input-type=module', '-e', `
    import mysql from 'mysql2/promise';
    for (let attempt = 0; attempt < 90; attempt += 1) {
      try {
        const connection = await mysql.createConnection({
          host: '127.0.0.1',
          port: ${port},
          user: 'root',
          password: 'ashiba',
          database: 'ashiba',
        });
        await connection.end();
        process.exit(0);
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    throw new Error('mysql container did not become ready');
  `], root);
}

function waitForMssql(root, port) {
  run(process.execPath, ['--input-type=module', '-e', `
    import sql from 'mssql';
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        const pool = await sql.connect({
          server: '127.0.0.1',
          port: ${port},
          user: 'sa',
          password: 'Ashiba_12345',
          database: 'master',
          options: { encrypt: false, trustServerCertificate: true },
        });
        await pool.close();
        process.exit(0);
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    throw new Error('mssql container did not become ready');
  `], root);
}

function packAshibaPackages() {
  const packageDirs = readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(packagesRoot, entry.name))
    .filter((dir) => existsSync(path.join(dir, 'package.json')))
    .filter((dir) => readPackageJson(dir).name.startsWith('@ashiba/'));

  const packed = new Map();
  for (const packageDir of packageDirs) {
    const packageJson = readPackageJson(packageDir);
    run(corepack, ['pnpm', '--filter', packageJson.name, 'pack', '--pack-destination', tarballRoot], repoRoot);
    const tarballName = `${packageJson.name.replace('@', '').replace('/', '-')}-${packageJson.version}.tgz`;
    packed.set(packageJson.name, `file:${normalizePath(path.join(tarballRoot, tarballName))}`);
  }
  return packed;
}

function pickTarballs(names) {
  const result = new Map();
  for (const name of names) {
    const tarball = tarballs.get(name);
    if (!tarball) throw new Error(`Missing tarball for ${name}.`);
    result.set(name, tarball);
  }
  return result;
}

function cleanupContainer(name) {
  spawnSync(docker, ['rm', '-f', name], { stdio: 'ignore' });
}

function run(command, args, cwd, env = {}) {
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32' && /\.cmd$/i.test(command),
    env: { ...process.env, ...env },
  });
}

function assertFileContains(filePath, expected) {
  const source = readFileSync(filePath, 'utf8');
  if (!source.includes(expected)) {
    throw new Error(`${filePath} did not contain expected text: ${expected}`);
  }
}

function readPackageJson(packageDir) {
  return JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
}

function resetDirectory(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

function normalizePath(value) {
  return value.replace(/\\/g, '/');
}

function sortedObject(entries) {
  return Object.fromEntries([...entries.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function inspectPublishedPort(containerName, containerPort) {
  const output = execFileSync(docker, [
    'inspect',
    '--format',
    `{{(index (index .NetworkSettings.Ports "${containerPort}") 0).HostPort}}`,
    containerName,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
  const port = Number(output);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Could not inspect Docker published port for ${containerName}:${containerPort}.`);
  }
  return port;
}
