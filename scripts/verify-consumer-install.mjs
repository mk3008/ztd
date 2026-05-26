import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagesRoot = path.join(repoRoot, 'packages');
const workRoot = process.env.ASHIBA_CONSUMER_SMOKE_DIR
  ? path.resolve(process.env.ASHIBA_CONSUMER_SMOKE_DIR)
  : path.join(process.platform === 'win32' ? 'C:\\tmp' : '/tmp', 'ashiba-consumer-install-smoke');
const tarballRoot = path.join(workRoot, 'tarballs');
const consumerRoot = path.join(workRoot, 'consumer');
const driverConsumerRoot = path.join(workRoot, 'driver-adapter-consumers');
const corepack = process.platform === 'win32' ? 'corepack.cmd' : 'corepack';

rmSync(workRoot, { recursive: true, force: true });
mkdirSync(tarballRoot, { recursive: true });
mkdirSync(consumerRoot, { recursive: true });
mkdirSync(driverConsumerRoot, { recursive: true });

const packageDirs = readdirSync(packagesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(packagesRoot, entry.name))
  .filter((dir) => existsSync(path.join(dir, 'package.json')))
  .filter((dir) => JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).name.startsWith('@ashiba/'));

const tarballs = new Map();

for (const packageDir of packageDirs) {
  const packageJson = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
  execFileSync(corepack, ['pnpm', '--filter', packageJson.name, 'pack', '--pack-destination', tarballRoot], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  const tarballName = `${packageJson.name.replace('@', '').replace('/', '-')}-${packageJson.version}.tgz`;
  tarballs.set(packageJson.name, `file:${normalizePath(path.join(tarballRoot, tarballName))}`);
}

writeFileSync(path.join(consumerRoot, 'package.json'), `${JSON.stringify({
  name: 'ashiba-consumer-install-smoke',
  private: true,
  type: 'module',
  packageManager: 'pnpm@10.19.0',
  dependencies: Object.fromEntries([...tarballs.entries()].sort(([left], [right]) => left.localeCompare(right))),
  pnpm: {
    overrides: Object.fromEntries([...tarballs.entries()].sort(([left], [right]) => left.localeCompare(right))),
  },
}, null, 2)}\n`, 'utf8');

execFileSync(corepack, ['pnpm', 'install'], {
  cwd: consumerRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

execFileSync(corepack, ['pnpm', 'exec', 'ashiba', '--version'], {
  cwd: consumerRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
execFileSync(corepack, ['pnpm', 'exec', 'ashiba', '--help'], {
  cwd: consumerRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
execFileSync(corepack, ['pnpm', 'exec', 'ashiba-config', '--compact'], {
  cwd: consumerRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

const importPackages = [...tarballs.keys()].filter((packageName) => packageName !== '@ashiba/cli');
execFileSync(process.execPath, ['-e', `await Promise.all(${JSON.stringify(importPackages)}.map((name) => import(name)));`], {
  cwd: consumerRoot,
  stdio: 'inherit',
});

const driverConsumerRoots = verifyDriverAdapterConsumers();

console.log(`consumer install smoke passed: ${consumerRoot}`);
for (const root of driverConsumerRoots) {
  console.log(`driver adapter consumer smoke passed: ${root}`);
}

function verifyDriverAdapterConsumers() {
  const matrix = [
    {
      id: 'pg',
      adapterPackage: '@ashiba/driver-adapter-pg',
      rawDriverPackage: 'pg',
      rawDriverVersion: '^8.16.3',
      typePackages: { '@types/pg': '^8.15.5' },
      source: driverAdapterTypeSmokeSource('pg'),
      runtime: driverAdapterRuntimeSmokeScript('pg'),
      expectedBinding: '"postgres"',
    },
    {
      id: 'mysql2',
      adapterPackage: '@ashiba/driver-adapter-mysql2',
      rawDriverPackage: 'mysql2',
      rawDriverVersion: '^3.15.3',
      typePackages: {},
      source: driverAdapterTypeSmokeSource('mysql2'),
      runtime: driverAdapterRuntimeSmokeScript('mysql2'),
      expectedBinding: '"mysql2"',
    },
    {
      id: 'mssql',
      adapterPackage: '@ashiba/driver-adapter-mssql',
      rawDriverPackage: 'mssql',
      rawDriverVersion: '^11.0.1',
      typePackages: { '@types/mssql': '^9.1.8' },
      source: driverAdapterTypeSmokeSource('mssql'),
      runtime: driverAdapterRuntimeSmokeScript('mssql'),
      expectedBinding: '"mssql"',
    },
  ];

  const roots = [];
  for (const entry of matrix) {
    const root = path.join(driverConsumerRoot, entry.id);
    roots.push(root);
    mkdirSync(root, { recursive: true });
    verifySingleDriverAdapterConsumer(root, entry);
  }
  return roots;
}

function verifySingleDriverAdapterConsumer(root, entry) {
  writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({
    name: `ashiba-driver-adapter-${entry.id}-consumer-smoke`,
    private: true,
    type: 'module',
    packageManager: 'pnpm@10.19.0',
    scripts: {
      typecheck: 'tsc --noEmit -p tsconfig.json',
    },
    dependencies: {
      [entry.adapterPackage]: '^0.0.0',
      [entry.rawDriverPackage]: entry.rawDriverVersion,
    },
    devDependencies: {
      '@ashiba/cli': '^0.0.0',
      ...entry.typePackages,
      typescript: '^5.9.3',
    },
    pnpm: {
      overrides: sortedObject(tarballs),
    },
  }, null, 2)}\n`, 'utf8');

  writeFileSync(path.join(root, 'tsconfig.json'), `${JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      skipLibCheck: true,
      noEmit: true,
    },
    include: ['src/**/*.ts'],
  }, null, 2)}\n`, 'utf8');

  const srcDir = path.join(root, 'src');
  mkdirSync(srcDir, { recursive: true });
  writeFileSync(path.join(srcDir, 'users.sql'), 'select * from users where id = :id', 'utf8');
  writeFileSync(path.join(srcDir, 'driver-adapter-type-smoke.ts'), entry.source, 'utf8');

  execFileSync(corepack, ['pnpm', 'install'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  execFileSync(corepack, ['pnpm', 'exec', 'ashiba', 'model-gen', 'src/users.sql', '--out', 'src/users.query.ts'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  const generatedMetadata = readFileSync(path.join(srcDir, 'generated', 'users.meta.ts'), 'utf8');
  if (!generatedMetadata.includes(entry.expectedBinding)) {
    throw new Error(`Generated model-gen metadata is missing ${entry.expectedBinding}.`);
  }
  execFileSync(process.execPath, ['--input-type=module', '-e', entry.runtime], {
    cwd: root,
    stdio: 'inherit',
    shell: false,
  });
  execFileSync(corepack, ['pnpm', 'typecheck'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

function driverAdapterTypeSmokeSource(id) {
  if (id === 'pg') {
    return `import { createPostgresAdapter } from '@ashiba/driver-adapter-pg';
import { queryModel } from './generated/users.meta.js';

const sourceSql = 'select * from users where id = :id';

createPostgresAdapter({
  async query() {
    return { rows: [{ id: 1 }], rowCount: 1 };
  },
}).execute({
  sql: sourceSql,
  sqlPath: 'users.sql',
  queryModel,
}, { id: 1 });
`;
  }

  if (id === 'mysql2') {
    return `import { createMysql2Adapter } from '@ashiba/driver-adapter-mysql2';
import { queryModel } from './generated/users.meta.js';

const sourceSql = 'select * from users where id = :id';

createMysql2Adapter({
  async execute() {
    return [[{ id: 1 }], []];
  },
}).execute({
  sql: sourceSql,
  sqlPath: 'users.sql',
  queryModel,
}, { id: 1 });
`;
  }

  return `import { createMssqlAdapter } from '@ashiba/driver-adapter-mssql';
import { queryModel } from './generated/users.meta.js';

const sourceSql = 'select * from users where id = :id';

createMssqlAdapter({
  request<Row = unknown>() {
    return {
      input() {
        return this;
      },
      async query() {
        return { recordset: [{ id: 1 }] as Row[], rowsAffected: [1] };
      },
    };
  },
}).execute({
  sql: sourceSql,
  sqlPath: 'users.sql',
  queryModel,
}, { id: 1 });
`;
}

function driverAdapterRuntimeSmokeScript(id) {
  if (id === 'pg') {
    return `
    const { readFileSync } = await import('node:fs');
    const { createPostgresAdapter } = await import('@ashiba/driver-adapter-pg');
    const metadataSource = readFileSync('./src/generated/users.meta.ts', 'utf8');
    const queryModel = JSON.parse(metadataSource.match(/export const queryModel = ([\\s\\S]*) as const;/)?.[1] ?? 'null');
    if (!queryModel) throw new Error('generated query metadata was not readable');

    const sourceSql = 'select * from users where id = :id';

    const pgCalls = [];
    await createPostgresAdapter({
      async query(sql, values) {
        pgCalls.push({ sql, values });
        return { rows: [{ id: 1 }], rowCount: 1 };
      },
    }).execute({ sql: sourceSql, sqlPath: 'users.sql', queryModel: {
      analysis: queryModel.analysis,
      bindings: { postgres: queryModel.bindings.postgres },
    } }, { id: 1 });

    if (pgCalls[0]?.sql !== 'select * from users where id = $1') throw new Error('pg adapter smoke failed');
  `;
  }

  if (id === 'mysql2') {
    return `
    const { readFileSync } = await import('node:fs');
    const { createMysql2Adapter } = await import('@ashiba/driver-adapter-mysql2');
    const metadataSource = readFileSync('./src/generated/users.meta.ts', 'utf8');
    const queryModel = JSON.parse(metadataSource.match(/export const queryModel = ([\\s\\S]*) as const;/)?.[1] ?? 'null');
    if (!queryModel) throw new Error('generated query metadata was not readable');

    const sourceSql = 'select * from users where id = :id';

    const mysqlCalls = [];
    await createMysql2Adapter({
      async execute(sql, values) {
        mysqlCalls.push({ sql, values });
        return [[{ id: 1 }], []];
      },
    }).execute({ sql: sourceSql, sqlPath: 'users.sql', queryModel: {
      analysis: queryModel.analysis,
      bindings: { mysql2: queryModel.bindings.mysql2 },
    } }, { id: 1 });

    if (mysqlCalls[0]?.sql !== 'select * from users where id = ?') throw new Error('mysql2 adapter smoke failed');
  `;
  }

  return `
    const { readFileSync } = await import('node:fs');
    const { createMssqlAdapter } = await import('@ashiba/driver-adapter-mssql');
    const metadataSource = readFileSync('./src/generated/users.meta.ts', 'utf8');
    const queryModel = JSON.parse(metadataSource.match(/export const queryModel = ([\\s\\S]*) as const;/)?.[1] ?? 'null');
    if (!queryModel) throw new Error('generated query metadata was not readable');

    const sourceSql = 'select * from users where id = :id';

    const mssqlInputs = [];
    const mssqlQueries = [];
    await createMssqlAdapter({
      request() {
        return {
          input(name, value) {
            mssqlInputs.push({ name, value });
            return this;
          },
          async query(sql) {
            mssqlQueries.push(sql);
            return { recordset: [{ id: 1 }], rowsAffected: [1] };
          },
        };
      },
    }).execute({ sql: sourceSql, sqlPath: 'users.sql', queryModel: {
      analysis: queryModel.analysis,
      bindings: { mssql: queryModel.bindings.mssql },
    } }, { id: 1 });

    if (mssqlQueries[0] !== 'select * from users where id = @id') throw new Error('mssql adapter smoke failed');
    if (mssqlInputs[0]?.name !== 'id') throw new Error('mssql input smoke failed');
  `;
}

function normalizePath(value) {
  return value.replace(/\\/g, '/');
}

function sortedObject(entries) {
  return Object.fromEntries([...entries.entries()].sort(([left], [right]) => left.localeCompare(right)));
}
