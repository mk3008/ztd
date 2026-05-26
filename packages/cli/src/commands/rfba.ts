import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Command } from 'commander';

export interface RfbaInspectOptions {
  rootDir?: string;
  format?: 'text' | 'json';
}

export interface RfbaInspectResult {
  rootDir: string;
  attainment: {
    overall: 'done' | 'partial' | 'not done';
    issueCount: number;
    nextActions: string[];
  };
  features: Array<{
    name: string;
    boundary: RfbaFileStatus;
    queries: Array<{
      name: string;
      query: RfbaFileStatus;
      sql: RfbaFileStatus;
      tests: RfbaFileStatus[];
      issues: string[];
    }>;
    issues: string[];
  }>;
}

export interface RfbaFileStatus {
  path: string;
  exists: boolean;
}

export function registerRfbaCommand(program: Command): void {
  program
    .command('rfba')
    .description('Review-first boundary inspection for Ashiba feature layouts')
    .command('inspect')
    .description('Inspect feature and query boundaries without writing files')
    .option('--root-dir <path>', 'Project root directory', '.')
    .option('--format <format>', 'Output format: text or json', 'text')
    .action((options: RfbaInspectOptions) => {
      const result = runRfbaInspect(options);
      if (options.format === 'json') {
        process.stdout.write(`${JSON.stringify({ kind: 'rfba-inspect', ...result }, null, 2)}\n`);
      } else {
        process.stdout.write(formatRfbaInspect(result));
      }
    });
}

export function runRfbaInspect(options: RfbaInspectOptions = {}): RfbaInspectResult {
  const rootDir = path.resolve(options.rootDir ?? '.');
  const featuresDir = path.join(rootDir, 'src', 'features');
  const features = existsSync(featuresDir)
    ? readdirSync(featuresDir)
      .filter((entry) => !entry.startsWith('_'))
      .filter((entry) => statSync(path.join(featuresDir, entry)).isDirectory())
      .map((featureName) => inspectFeature(rootDir, featuresDir, featureName))
    : [];
  return { rootDir, features, attainment: buildRfbaAttainment(features) };
}

function inspectFeature(rootDir: string, featuresDir: string, featureName: string): RfbaInspectResult['features'][number] {
  const featureDir = path.join(featuresDir, featureName);
  const queriesDir = path.join(featureDir, 'queries');
  const boundary = fileStatus(rootDir, path.join(featureDir, 'boundary.ts'));
  const queries = existsSync(queriesDir)
    ? readdirSync(queriesDir)
      .filter((entry) => statSync(path.join(queriesDir, entry)).isDirectory())
      .map((queryName) => inspectQuery(rootDir, queriesDir, queryName))
    : [];
  const issues = [
    ...(!boundary.exists ? [`Feature boundary file is missing: ${boundary.path}.`] : []),
    ...(queries.length === 0 ? [`Feature has no query review boundaries: ${featureName}.`] : []),
  ];
  return {
    name: featureName,
    boundary,
    queries,
    issues,
  };
}

function inspectQuery(rootDir: string, queriesDir: string, queryName: string): RfbaInspectResult['features'][number]['queries'][number] {
  const queryDir = path.join(queriesDir, queryName);
  const query = fileStatus(rootDir, path.join(queryDir, 'query.ts'));
  const sql = fileStatus(rootDir, path.join(queryDir, `${queryName}.sql`));
  const testsDir = path.join(queryDir, 'tests');
  const tests = existsSync(testsDir)
    ? readdirSync(testsDir)
      .filter((entry) => statSync(path.join(testsDir, entry)).isFile())
      .filter((entry) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry))
      .map((entry) => fileStatus(rootDir, path.join(testsDir, entry)))
    : [];
  const issues = [
    ...(!query.exists ? [`Query file is missing: ${query.path}.`] : []),
    ...(!sql.exists ? [`Visible SQL file is missing: ${sql.path}.`] : []),
  ];
  return { name: queryName, query, sql, tests, issues };
}

function buildRfbaAttainment(features: RfbaInspectResult['features']): RfbaInspectResult['attainment'] {
  const issueCount = features.reduce((featureSum, feature) =>
    featureSum + feature.issues.length + feature.queries.reduce((querySum, query) => querySum + query.issues.length, 0),
  0);
  const nextActions = new Set<string>();
  if (features.length === 0) {
    nextActions.add('Scaffold feature/query review boundaries under src/features.');
  }
  for (const feature of features) {
    if (feature.issues.some((issue) => issue.includes('Feature boundary file'))) {
      nextActions.add('Add feature boundary.ts files so reviewers can enter through feature behavior.');
    }
    if (feature.issues.some((issue) => issue.includes('no query'))) {
      nextActions.add('Add query-local review boundaries under each feature queries directory.');
    }
    for (const query of feature.queries) {
      if (query.issues.some((issue) => issue.includes('Query file'))) {
        nextActions.add('Add query.ts files that expose editable mapper/query contracts.');
      }
      if (query.issues.some((issue) => issue.includes('Visible SQL file'))) {
        nextActions.add('Add visible query SQL files next to query boundaries.');
      }
    }
  }
  return {
    overall: features.length === 0 ? 'not done' : issueCount === 0 ? 'done' : 'partial',
    issueCount,
    nextActions: [...nextActions],
  };
}

function fileStatus(rootDir: string, filePath: string): RfbaFileStatus {
  return {
    path: normalizePath(path.relative(rootDir, filePath)),
    exists: existsSync(filePath),
  };
}

function formatRfbaInspect(result: RfbaInspectResult): string {
  const lines = ['RFBA boundary inspection'];
  lines.push(`- attainment: ${result.attainment.overall}`);
  if (result.attainment.nextActions.length > 0) {
    for (const action of result.attainment.nextActions) {
      lines.push(`- next: ${action}`);
    }
  }
  for (const feature of result.features) {
    lines.push('', `- feature: ${feature.name}`, `  boundary: ${formatFileStatus(feature.boundary)}`);
    for (const issue of feature.issues) {
      lines.push(`  issue: ${issue}`);
    }
    for (const query of feature.queries) {
      lines.push(
        `  query: ${query.name}`,
        `    query: ${formatFileStatus(query.query)}`,
        `    sql: ${formatFileStatus(query.sql)}`,
      );
      for (const test of query.tests) {
        lines.push(`    test: ${formatFileStatus(test)}`);
      }
      for (const issue of query.issues) {
        lines.push(`    issue: ${issue}`);
      }
    }
  }
  if (result.features.length === 0) {
    lines.push('- no feature boundaries discovered');
  }
  return `${lines.join('\n')}\n`;
}

function formatFileStatus(file: RfbaFileStatus): string {
  return `${file.path} (${file.exists ? 'exists' : 'missing'})`;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}
