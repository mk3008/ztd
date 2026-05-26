import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Command } from 'commander';
import { compileNamedParameters } from '../parameter-metadata.js';
import { requiredCliValueError } from '../errors.js';

export interface PerfInitOptions {
  rootDir?: string;
  dryRun?: boolean;
  force?: boolean;
  format?: 'text' | 'json';
}

export interface PerfRunOptions {
  rootDir?: string;
  query?: string;
  params?: string;
  dryRun?: boolean;
  format?: 'text' | 'json';
}

export interface PerfReportDiffOptions {
  format?: 'text' | 'json';
}

export interface PerfScenarioInitOptions {
  rootDir?: string;
  scenario?: string;
  query?: string;
  targetRows?: string[];
  maxDurationMs?: string;
  timeoutMs?: string;
  dryRun?: boolean;
  force?: boolean;
  format?: 'text' | 'json';
}

export interface PerfScenarioMeasureOptions {
  rootDir?: string;
  scenario?: string;
  durationMs?: string;
  timedOut?: boolean;
  explain?: string;
  evidenceName?: string;
  dryRun?: boolean;
  format?: 'text' | 'json';
}

export interface PerfInitResult {
  rootDir: string;
  dryRun: boolean;
  files: Array<{ path: string; written: boolean }>;
}

export interface PerfRunResult {
  rootDir: string;
  query: string;
  attainment: PerfAttainment;
  parameterNames: string[];
  providedParams: string[];
  missingParams: string[];
  unusedParams: string[];
  dryRun: boolean;
  mode: 'traditional';
  ok: boolean;
}

export interface PerfAttainment {
  overall: 'done' | 'partial' | 'not done';
  nextActions: string[];
}

export interface PerfReportDiffResult {
  baseline: string;
  candidate: string;
  attainment: PerfAttainment;
  baselineDurationMs: number | null;
  candidateDurationMs: number | null;
  deltaMs: number | null;
  ratio: number | null;
  classification: 'faster' | 'slower' | 'same' | 'unknown';
}

export interface PerfScenarioRequirements {
  targetRows: Record<string, number>;
  maxDurationMs: number | null;
  timeoutMs: number;
}

export interface PerfScenarioInitResult {
  rootDir: string;
  scenario: string;
  dryRun: boolean;
  files: Array<{ path: string; written: boolean }>;
  requirements: PerfScenarioRequirements;
  indexPolicy: PerfIndexPolicy;
  nextActions: string[];
}

export interface PerfScenarioMeasureResult {
  rootDir: string;
  scenario: string;
  query: string | null;
  requirements: PerfScenarioRequirements;
  result: {
    durationMs: number | null;
    timedOut: boolean;
    meetsRequirement: boolean | null;
  };
  evidence: {
    measurementPath: string;
    explainPath: string | null;
    dryRun: boolean;
  };
  indexPolicy: PerfIndexPolicy;
  nextActions: string[];
  ok: boolean;
}

export interface PerfIndexPolicy {
  candidateIndexScope: 'sandbox-only';
  adoptedIndexTarget: 'db/ddl';
  rule: string;
}

export function registerPerfCommand(program: Command): void {
  const perf = program.command('perf').description('Traditional DB-backed performance test helpers');
  const report = perf.command('report').description('Compare saved performance evidence');
  const scenario = perf
    .command('scenario')
    .description('Create and measure manual DB-backed tuning scenarios')
    .addHelpText('after', `
Use case:
  Use scenario commands for opt-in tuning sessions. Ashiba records requirements,
  timings, timeout status, execution-plan evidence paths, and next actions. AI
  or humans decide indexes and SQL changes; candidate indexes remain sandbox-only
  until promoted into db/ddl.
`);

  perf
    .command('init')
    .description('Scaffold the opt-in performance sandbox files')
    .option('--root-dir <path>', 'Project root directory', '.')
    .option('--dry-run', 'Print the files that would be created without writing them', false)
    .option('--force', 'Overwrite perf scaffold files when they already exist', false)
    .option('--format <format>', 'Output format: text or json', 'text')
    .action((options: PerfInitOptions) => {
      const result = runPerfInit(options);
      writeResult('perf-init', result, options.format, formatPerfInitResult);
    });

  perf
    .command('run')
    .description('Inspect a SQL performance run plan without owning DB execution')
    .requiredOption('--query <path>', 'SQL file to benchmark in the application-owned performance lane')
    .option('--params <path>', 'JSON parameter file for the benchmark query')
    .option('--root-dir <path>', 'Project root directory', '.')
    .option('--dry-run', 'Inspect the run plan without executing a DB query', false)
    .option('--format <format>', 'Output format: text or json', 'text')
    .action((options: PerfRunOptions) => {
      const result = runPerfRun(options);
      writeResult('perf-run', result, options.format, formatPerfRunResult);
      if (!result.ok) process.exitCode = 1;
    });

  report
    .command('diff <baseline> <candidate>')
    .description('Compare two saved performance report JSON files')
    .option('--format <format>', 'Output format: text or json', 'text')
    .action((baseline: string, candidate: string, options: PerfReportDiffOptions) => {
      const result = runPerfReportDiff(baseline, candidate);
      writeResult('perf-report-diff', result, options.format, formatPerfReportDiffResult);
    });

  scenario
    .command('init')
    .description('Scaffold a manual performance tuning scenario')
    .requiredOption('--scenario <name>', 'Scenario name')
    .option('--query <path>', 'Visible SQL file measured by this scenario')
    .option('--target-rows <table=count>', 'Expected table row count, repeatable', collectOption, [])
    .option('--max-duration-ms <number>', 'Target response time in milliseconds')
    .option('--timeout-ms <number>', 'Measurement timeout in milliseconds', '30000')
    .option('--root-dir <path>', 'Project root directory', '.')
    .option('--dry-run', 'Print the files that would be created without writing them', false)
    .option('--force', 'Overwrite scenario files when they already exist', false)
    .option('--format <format>', 'Output format: text or json', 'text')
    .action((options: PerfScenarioInitOptions) => {
      const result = runPerfScenarioInit(options);
      writeResult('perf-scenario-init', result, options.format, formatPerfScenarioInitResult);
    });

  scenario
    .command('measure')
    .description('Record one performance measurement and tuning guidance')
    .requiredOption('--scenario <name>', 'Scenario name')
    .option('--duration-ms <number>', 'Observed query duration in milliseconds')
    .option('--timed-out', 'Mark the measurement as timed out', false)
    .option('--explain <path>', 'Execution plan evidence file produced by the tuning session')
    .option('--evidence-name <name>', 'Stable evidence file name, without extension')
    .option('--root-dir <path>', 'Project root directory', '.')
    .option('--dry-run', 'Return evidence without writing the measurement file', false)
    .option('--format <format>', 'Output format: text or json', 'text')
    .action((options: PerfScenarioMeasureOptions) => {
      const result = runPerfScenarioMeasure(options);
      writeResult('perf-scenario-measure', result, options.format, formatPerfScenarioMeasureResult);
      if (!result.ok) process.exitCode = 1;
    });
}

export function runPerfInit(options: PerfInitOptions = {}): PerfInitResult {
  const rootDir = path.resolve(options.rootDir ?? '.');
  const files = [
    {
      path: 'perf/README.md',
      contents: [
        '# Performance Lane',
        '',
        'Ashiba recommends traditional DB-backed tests for performance evidence.',
        'Ashiba can scaffold and inspect the plan, but DB lifecycle and execution remain application-owned.',
        '',
      ].join('\n'),
    },
    {
      path: 'perf/params.json',
      contents: `${JSON.stringify({}, null, 2)}\n`,
    },
    {
      path: 'perf/evidence/.gitkeep',
      contents: '',
    },
  ];
  const written = files.map((file) => {
    const destination = path.join(rootDir, file.path);
    const exists = existsSync(destination);
    if (!options.dryRun && (!exists || options.force)) {
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, file.contents, 'utf8');
    }
    return { path: file.path, written: options.dryRun !== true && (!exists || options.force === true) };
  });
  return { rootDir, dryRun: options.dryRun === true, files: written };
}

export function runPerfRun(options: PerfRunOptions): PerfRunResult {
  const rootDir = path.resolve(options.rootDir ?? '.');
  const query = requireValue(options.query, '--query');
  const queryPath = path.resolve(rootDir, query);
  const sql = readFileSync(queryPath, 'utf8');
  const parameterNames = [...new Set(compileNamedParameters(sql).orderedNames)].sort();
  const providedParams = options.params ? Object.keys(JSON.parse(readFileSync(path.resolve(rootDir, options.params), 'utf8')) as Record<string, unknown>).sort() : [];
  const missingParams = parameterNames.filter((name) => !providedParams.includes(name));
  const unusedParams = providedParams.filter((name) => !parameterNames.includes(name));

  return {
    rootDir,
    query: normalizePath(path.relative(rootDir, queryPath)),
    attainment: buildPerfRunAttainment(missingParams, unusedParams),
    parameterNames,
    providedParams,
    missingParams,
    unusedParams,
    dryRun: options.dryRun === true,
    mode: 'traditional',
    ok: missingParams.length === 0 && unusedParams.length === 0,
  };
}

export function runPerfReportDiff(baseline: string, candidate: string): PerfReportDiffResult {
  const baselinePath = path.resolve(baseline);
  const candidatePath = path.resolve(candidate);
  const baselineDurationMs = readDurationMs(JSON.parse(readFileSync(baselinePath, 'utf8')) as unknown);
  const candidateDurationMs = readDurationMs(JSON.parse(readFileSync(candidatePath, 'utf8')) as unknown);
  const deltaMs = baselineDurationMs == null || candidateDurationMs == null ? null : candidateDurationMs - baselineDurationMs;
  const ratio = baselineDurationMs == null || candidateDurationMs == null || baselineDurationMs === 0 ? null : candidateDurationMs / baselineDurationMs;
  return {
    baseline: baselinePath,
    candidate: candidatePath,
    attainment: buildPerfReportAttainment(baselineDurationMs, candidateDurationMs),
    baselineDurationMs,
    candidateDurationMs,
    deltaMs,
    ratio,
    classification: classifyPerfDelta(deltaMs),
  };
}

/**
 * Scaffold a manual traditional DB-backed performance tuning scenario.
 */
export function runPerfScenarioInit(options: PerfScenarioInitOptions): PerfScenarioInitResult {
  const rootDir = path.resolve(options.rootDir ?? '.');
  const scenario = requireValue(options.scenario, '--scenario');
  const scenarioDir = path.join('perf', 'scenarios', scenario);
  const requirements = buildScenarioRequirements(options);
  const scenarioConfig = {
    scenario,
    query: options.query ? normalizePath(options.query) : null,
    requirements,
    indexPolicy: createPerfIndexPolicy(),
  };
  const files = [
    {
      path: path.join(scenarioDir, 'README.md'),
      contents: [
        `# Performance Scenario: ${scenario}`,
        '',
        'This is a manual traditional DB-backed tuning scenario.',
        'Ashiba records requirements, measurement evidence, timeout status, and next actions.',
        'Ashiba does not decide which index or SQL change to adopt.',
        '',
        'Candidate indexes may be tested in the sandbox database.',
        'Accepted indexes must be promoted into db/ddl before they become product schema.',
        '',
      ].join('\n'),
    },
    {
      path: path.join(scenarioDir, 'scenario.json'),
      contents: `${JSON.stringify(scenarioConfig, null, 2)}\n`,
    },
    {
      path: path.join(scenarioDir, 'params.json'),
      contents: `${JSON.stringify({}, null, 2)}\n`,
    },
    {
      path: path.join(scenarioDir, 'candidates', '.gitkeep'),
      contents: '',
    },
    {
      path: path.join(scenarioDir, 'evidence', '.gitkeep'),
      contents: '',
    },
  ];
  const written = writePerfFiles(rootDir, files, options);
  return {
    rootDir,
    scenario,
    dryRun: options.dryRun === true,
    files: written,
    requirements,
    indexPolicy: createPerfIndexPolicy(),
    nextActions: [
      'Initialize the sandbox database with the configured representative row counts before measuring.',
      'Run ANALYZE and collect an execution plan in the tuning session before recording a measurement.',
      'Apply candidate indexes only to the sandbox until the accepted index is promoted into db/ddl.',
    ],
  };
}

/**
 * Record timing evidence, timeout status, and index-adoption guidance for one tuning run.
 */
export function runPerfScenarioMeasure(options: PerfScenarioMeasureOptions): PerfScenarioMeasureResult {
  const rootDir = path.resolve(options.rootDir ?? '.');
  const scenario = requireValue(options.scenario, '--scenario');
  const scenarioPath = path.join(rootDir, 'perf', 'scenarios', scenario, 'scenario.json');
  const scenarioConfig = readScenarioConfig(scenarioPath);
  const requirements = normalizeScenarioRequirements(scenarioConfig.requirements);
  const timedOut = options.timedOut === true;
  const durationMs = timedOut ? null : parseOptionalNonNegativeNumber(options.durationMs, '--duration-ms');
  if (!timedOut && durationMs == null) {
    throw requiredCliValueError('--duration-ms or --timed-out');
  }
  const meetsRequirement = timedOut || durationMs == null || requirements.maxDurationMs == null
    ? (timedOut ? false : null)
    : durationMs <= requirements.maxDurationMs;
  const evidenceName = normalizeEvidenceName(options.evidenceName);
  const measurementPath = normalizePath(path.join('perf', 'scenarios', scenario, 'evidence', `${evidenceName}.json`));
  const explainPath = options.explain ? normalizePath(options.explain) : null;
  const result: PerfScenarioMeasureResult = {
    rootDir,
    scenario,
    query: typeof scenarioConfig.query === 'string' ? scenarioConfig.query : null,
    requirements,
    result: {
      durationMs,
      timedOut,
      meetsRequirement,
    },
    evidence: {
      measurementPath,
      explainPath,
      dryRun: options.dryRun === true,
    },
    indexPolicy: createPerfIndexPolicy(),
    nextActions: buildScenarioMeasureNextActions({ timedOut, meetsRequirement }),
    ok: timedOut !== true && meetsRequirement !== false,
  };
  if (options.dryRun !== true) {
    const destination = path.join(rootDir, measurementPath);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }
  return result;
}

function formatPerfInitResult(result: PerfInitResult): string {
  return `${['Perf sandbox scaffold', ...result.files.map((file) => `- ${file.written ? 'write' : 'skip'}: ${file.path}`)].join('\n')}\n`;
}

function formatPerfRunResult(result: PerfRunResult): string {
  return `${[
    `Perf run plan: ${result.ok ? 'ok' : 'failed'}`,
    `- attainment: ${result.attainment.overall}`,
    `- mode: ${result.mode}`,
    `- query: ${result.query}`,
    `- parameters: ${result.parameterNames.length > 0 ? result.parameterNames.join(', ') : '(none)'}`,
    `- provided: ${result.providedParams.length > 0 ? result.providedParams.join(', ') : '(none)'}`,
    ...(result.missingParams.length > 0 ? [`- missing params: ${result.missingParams.join(', ')}`] : []),
    ...(result.unusedParams.length > 0 ? [`- unused params: ${result.unusedParams.join(', ')}`] : []),
    ...result.attainment.nextActions.map((action) => `- next: ${action}`),
  ].join('\n')}\n`;
}

function formatPerfReportDiffResult(result: PerfReportDiffResult): string {
  return `${[
    `Perf report diff: ${result.classification}`,
    `- attainment: ${result.attainment.overall}`,
    `- baseline duration ms: ${result.baselineDurationMs ?? 'unknown'}`,
    `- candidate duration ms: ${result.candidateDurationMs ?? 'unknown'}`,
    `- delta ms: ${result.deltaMs ?? 'unknown'}`,
    `- ratio: ${result.ratio ?? 'unknown'}`,
    ...result.attainment.nextActions.map((action) => `- next: ${action}`),
  ].join('\n')}\n`;
}

function formatPerfScenarioInitResult(result: PerfScenarioInitResult): string {
  return `${[
    `Perf scenario scaffold: ${result.scenario}`,
    `- dry-run: ${result.dryRun}`,
    `- target rows: ${formatTargetRows(result.requirements.targetRows)}`,
    `- max duration ms: ${result.requirements.maxDurationMs ?? 'unspecified'}`,
    `- timeout ms: ${result.requirements.timeoutMs}`,
    ...result.files.map((file) => `- ${file.written ? 'write' : 'skip'}: ${file.path}`),
    ...result.nextActions.map((action) => `- next: ${action}`),
  ].join('\n')}\n`;
}

function formatPerfScenarioMeasureResult(result: PerfScenarioMeasureResult): string {
  return `${[
    `Perf scenario measurement: ${result.ok ? 'ok' : 'needs tuning'}`,
    `- scenario: ${result.scenario}`,
    `- query: ${result.query ?? '(unspecified)'}`,
    `- duration ms: ${result.result.durationMs ?? 'unknown'}`,
    `- timed out: ${result.result.timedOut}`,
    `- meets requirement: ${result.result.meetsRequirement ?? 'unknown'}`,
    `- measurement: ${result.evidence.measurementPath}${result.evidence.dryRun ? ' (dry-run, not written)' : ''}`,
    `- explain: ${result.evidence.explainPath ?? '(not provided)'}`,
    `- index policy: ${result.indexPolicy.rule}`,
    ...result.nextActions.map((action) => `- next: ${action}`),
  ].join('\n')}\n`;
}

function buildPerfRunAttainment(missingParams: string[], unusedParams: string[]): PerfAttainment {
  const nextActions: string[] = [];
  if (missingParams.length > 0) {
    nextActions.push('Add missing benchmark parameters before running the application-owned performance test.');
  }
  if (unusedParams.length > 0) {
    nextActions.push('Remove unused benchmark parameters so the performance evidence matches visible SQL.');
  }
  return {
    overall: nextActions.length === 0 ? 'done' : 'partial',
    nextActions,
  };
}

function buildPerfReportAttainment(baselineDurationMs: number | null, candidateDurationMs: number | null): PerfAttainment {
  const nextActions: string[] = [];
  if (baselineDurationMs == null) {
    nextActions.push('Add a numeric durationMs or duration_ms to the baseline performance report.');
  }
  if (candidateDurationMs == null) {
    nextActions.push('Add a numeric durationMs or duration_ms to the candidate performance report.');
  }
  return {
    overall: nextActions.length === 0 ? 'done' : 'partial',
    nextActions,
  };
}

function readDurationMs(value: unknown): number | null {
  if (!isRecord(value)) {
    return null;
  }
  const direct = value.durationMs ?? value.duration_ms;
  if (typeof direct === 'number') {
    return direct;
  }
  if (isRecord(value.summary)) {
    const summary = value.summary.durationMs ?? value.summary.duration_ms;
    if (typeof summary === 'number') {
      return summary;
    }
  }
  if (isRecord(value.metrics)) {
    const metric = value.metrics.durationMs ?? value.metrics.duration_ms;
    if (typeof metric === 'number') {
      return metric;
    }
  }
  return null;
}

function classifyPerfDelta(deltaMs: number | null): PerfReportDiffResult['classification'] {
  if (deltaMs == null) return 'unknown';
  if (Math.abs(deltaMs) < 1) return 'same';
  return deltaMs > 0 ? 'slower' : 'faster';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function writeResult<T>(kind: string, result: T, format: string | undefined, render: (result: T) => string): void {
  if (format === 'json') {
    process.stdout.write(`${JSON.stringify({ kind, ...result }, null, 2)}\n`);
  } else {
    process.stdout.write(render(result));
  }
}

function writePerfFiles(
  rootDir: string,
  files: Array<{ path: string; contents: string }>,
  options: { dryRun?: boolean; force?: boolean },
): Array<{ path: string; written: boolean }> {
  return files.map((file) => {
    const destination = path.join(rootDir, file.path);
    const exists = existsSync(destination);
    if (!options.dryRun && (!exists || options.force)) {
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, file.contents, 'utf8');
    }
    return { path: normalizePath(file.path), written: options.dryRun !== true && (!exists || options.force === true) };
  });
}

function requireValue(value: string | undefined, label: string): string {
  if (!value || value.trim().length === 0) throw requiredCliValueError(label);
  return value;
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}

function buildScenarioRequirements(options: PerfScenarioInitOptions): PerfScenarioRequirements {
  return {
    targetRows: parseTargetRows(options.targetRows),
    maxDurationMs: parseOptionalNonNegativeNumber(options.maxDurationMs, '--max-duration-ms'),
    timeoutMs: parsePositiveNumber(options.timeoutMs ?? '30000', '--timeout-ms'),
  };
}

function normalizeScenarioRequirements(value: unknown): PerfScenarioRequirements {
  const record = isRecord(value) ? value : {};
  return {
    targetRows: isRecord(record.targetRows)
      ? Object.fromEntries(Object.entries(record.targetRows).filter((entry): entry is [string, number] => typeof entry[1] === 'number'))
      : {},
    maxDurationMs: typeof record.maxDurationMs === 'number' ? record.maxDurationMs : null,
    timeoutMs: typeof record.timeoutMs === 'number' ? record.timeoutMs : 30000,
  };
}

function parseTargetRows(values: string[] | undefined): Record<string, number> {
  const targetRows: Record<string, number> = {};
  for (const value of values ?? []) {
    const [table, countText, extra] = value.split('=');
    if (!table || !countText || extra !== undefined) {
      throw requiredCliValueError('--target-rows <table=count>');
    }
    targetRows[table] = parsePositiveNumber(countText, '--target-rows');
  }
  return targetRows;
}

function parsePositiveNumber(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw requiredCliValueError(label);
  }
  return parsed;
}

function parseOptionalNonNegativeNumber(value: string | undefined, label: string): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw requiredCliValueError(label);
  }
  return parsed;
}

function readScenarioConfig(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) {
    throw requiredCliValueError(`scenario file ${normalizePath(filePath)}`);
  }
  const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  return isRecord(parsed) ? parsed : {};
}

function normalizeEvidenceName(value: string | undefined): string {
  if (value && value.trim().length > 0) {
    return value.trim().replace(/[^a-zA-Z0-9_.-]/g, '-');
  }
  return `measurement-${new Date().toISOString().replace(/[:.]/g, '-')}`;
}

function createPerfIndexPolicy(): PerfIndexPolicy {
  return {
    candidateIndexScope: 'sandbox-only',
    adoptedIndexTarget: 'db/ddl',
    rule: 'Candidate indexes may be tested in the sandbox database, but accepted indexes must be promoted into db/ddl. Do not treat sandbox-created indexes as adopted schema.',
  };
}

function buildScenarioMeasureNextActions(input: { timedOut: boolean; meetsRequirement: boolean | null }): string[] {
  const actions = [
    'Use the execution plan and timing evidence to decide the next SQL or index experiment.',
    'Candidate indexes may be applied to the sandbox database for measurement only.',
    'Accepted indexes must be written to db/ddl before they become product schema.',
    'After applying a candidate index, run ANALYZE and record another measurement.',
  ];
  if (input.timedOut) {
    actions.unshift('Treat the timeout as performance evidence and inspect the plan before retrying with a candidate change.');
  } else if (input.meetsRequirement === false) {
    actions.unshift('The measurement missed the response-time requirement; inspect the plan and try a candidate index or SQL change in the sandbox.');
  }
  return actions;
}

function formatTargetRows(targetRows: Record<string, number>): string {
  const entries = Object.entries(targetRows);
  if (entries.length === 0) return '(unspecified)';
  return entries.map(([table, count]) => `${table}=${count}`).join(', ');
}
