import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Command } from 'commander';
import { invalidCliInputError } from '../errors.js';

export type GateScaffoldTarget = 'all' | 'package-scripts' | 'github-actions' | 'git-hooks';

export interface GateScaffoldOptions {
  rootDir?: string;
  target?: GateScaffoldTarget;
  force?: boolean;
}

export interface GateScaffoldResult {
  kind: 'gate-scaffold';
  rootDir: string;
  target: GateScaffoldTarget;
  files: Array<{ relativePath: string; action: 'create' | 'update' | 'skip' }>;
  nextActions: string[];
}

const ASHIBA_CLI_SCRIPT = 'node node_modules/@ashiba/cli/dist/index.js';

/**
 * Register commands that scaffold passive Ashiba gates into customer projects.
 */
export function registerGateCommand(program: Command): void {
  const gate = program.command('gate').description('Scaffold passive Ashiba check gates without adding hook libraries');

  gate
    .command('scaffold')
    .description('Create the standard passive Ashiba check gates')
    .option('--target <target>', 'Advanced target: all, package-scripts, github-actions, or git-hooks', 'all')
    .option('--root-dir <path>', 'Project root directory', '.')
    .option('--force', 'Overwrite existing generated files when applicable', false)
    .action((options: GateScaffoldOptions) => {
      const result = runGateScaffold(options);
      process.stdout.write(formatGateScaffoldResult(result));
    });
}

/**
 * Scaffold one passive gate target into a customer project.
 */
export function runGateScaffold(options: GateScaffoldOptions): GateScaffoldResult {
  const target = parseTarget(options.target);
  const rootDir = path.resolve(options.rootDir ?? '.');
  if (target === 'all') return scaffoldAll(rootDir, options.force === true);
  if (target === 'package-scripts') return scaffoldPackageScripts(rootDir);
  if (target === 'github-actions') return scaffoldGitHubActions(rootDir, options.force === true, true);
  return scaffoldGitHooks(rootDir, options.force === true, true);
}

/**
 * Format a gate scaffold result for human CLI output.
 */
export function formatGateScaffoldResult(result: GateScaffoldResult): string {
  return `${[
    `Ashiba gate scaffold: ${result.target}`,
    `- root: ${result.rootDir}`,
    ...result.files.map((file) => `- ${file.action}: ${file.relativePath}`),
    ...(result.nextActions.length > 0 ? ['', 'Next:', ...result.nextActions.map((action) => `- ${action}`)] : []),
  ].join('\n')}\n`;
}

function scaffoldPackageScripts(rootDir: string): GateScaffoldResult {
  const file = writePackageScripts(rootDir);
  const packageManager = resolvePackageManager(rootDir);
  const runPrefix = packageManager === 'pnpm' ? 'pnpm' : 'npm run';

  return {
    kind: 'gate-scaffold',
    rootDir,
    target: 'package-scripts',
    files: [file],
    nextActions: [
      `Use \`${runPrefix} ashiba:check\` while editing.`,
      `Use \`${runPrefix} ashiba:verify\` before push, review, or CI.`,
    ],
  };
}

function scaffoldAll(rootDir: string, force: boolean): GateScaffoldResult {
  const scripts = writePackageScripts(rootDir);
  const actions = scaffoldGitHubActions(rootDir, force, false);
  const hooks = scaffoldGitHooks(rootDir, force, false);
  const packageManager = resolvePackageManager(rootDir);
  const runPrefix = packageManager === 'pnpm' ? 'pnpm' : 'npm run';

  return {
    kind: 'gate-scaffold',
    rootDir,
    target: 'all',
    files: [scripts, ...actions.files, ...hooks.files],
    nextActions: [
      `Use \`${runPrefix} ashiba:check\` while editing.`,
      `Use \`${runPrefix} ashiba:verify\` before push, review, or CI.`,
      'Run `git config core.hooksPath .githooks` once in each clone that should enforce the local pre-push gate.',
      'Make the GitHub Actions workflow a required status check if pull requests must not merge with drift.',
    ],
  };
}

function writePackageScripts(rootDir: string): { relativePath: string; action: 'update' } {
  const packageJsonPath = path.join(rootDir, 'package.json');
  if (!existsSync(packageJsonPath)) {
    throw invalidCliInputError(
      'ASHIBA_GATE_PACKAGE_JSON_REQUIRED',
      'ashiba gate scaffold requires package.json.',
      'Create package.json first, then rerun the gate scaffold command.',
    );
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    packageManager?: unknown;
    scripts?: Record<string, unknown>;
    [key: string]: unknown;
  };
  const scripts = { ...(packageJson.scripts ?? {}) };
  scripts['ashiba:check'] = typeof scripts['ashiba:check'] === 'string' ? scripts['ashiba:check'] : `${ASHIBA_CLI_SCRIPT} check`;
  scripts['ashiba:verify'] = typeof scripts['ashiba:verify'] === 'string' ? scripts['ashiba:verify'] : `${ASHIBA_CLI_SCRIPT} check --full --mapper-test-command "vitest run"`;
  packageJson.scripts = scripts;
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
  return { relativePath: 'package.json', action: 'update' };
}

function scaffoldGitHubActions(rootDir: string, force: boolean, ensureScripts: boolean): GateScaffoldResult {
  const files: GateScaffoldResult['files'] = ensureScripts ? [writePackageScripts(rootDir)] : [];
  const relativePath = '.github/workflows/ashiba-contract.yml';
  const destination = path.join(rootDir, relativePath);
  const exists = existsSync(destination);
  const action = exists ? (force ? 'update' : 'skip') : 'create';
  if (action !== 'skip') {
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, githubActionsWorkflow(rootDir, resolvePackageManager(rootDir)), 'utf8');
  }
  return {
    kind: 'gate-scaffold',
    rootDir,
    target: 'github-actions',
    files: [...files, { relativePath, action }],
    nextActions: action === 'skip'
      ? ['The workflow already exists. Rerun with --force if Ashiba should overwrite it.']
      : ['Make this workflow a required status check if pull requests must not merge with drift.'],
  };
}

function scaffoldGitHooks(rootDir: string, force: boolean, ensureScripts: boolean): GateScaffoldResult {
  const files: GateScaffoldResult['files'] = ensureScripts ? [writePackageScripts(rootDir)] : [];
  const relativePath = '.githooks/pre-push';
  const destination = path.join(rootDir, relativePath);
  const exists = existsSync(destination);
  const action = exists ? (force ? 'update' : 'skip') : 'create';
  if (action !== 'skip') {
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, nativePrePushHook(resolvePackageManager(rootDir)), 'utf8');
    try {
      chmodSync(destination, 0o755);
    } catch {
      // Windows may ignore POSIX mode bits. Git for Windows still reads the hook via hooksPath.
    }
  }
  return {
    kind: 'gate-scaffold',
    rootDir,
    target: 'git-hooks',
    files: [...files, { relativePath, action }],
    nextActions: [
      'Run `git config core.hooksPath .githooks` once in each clone that should enforce the local pre-push gate.',
      'Use GitHub Actions too when the shared branch needs a final gate.',
    ],
  };
}

function parseTarget(value: string | undefined): GateScaffoldTarget {
  if (value === undefined || value === 'all' || value === 'package-scripts' || value === 'github-actions' || value === 'git-hooks') return value ?? 'all';
  throw invalidCliInputError(
    'ASHIBA_GATE_TARGET_UNSUPPORTED',
    `Unsupported gate scaffold target: ${value ?? ''}`,
    'Use one of: all, package-scripts, github-actions, git-hooks.',
    { target: value },
  );
}

function githubActionsWorkflow(rootDir: string, packageManager: 'npm' | 'pnpm'): string {
  const setupPackageManager = packageManager === 'pnpm'
    ? [
      '      - uses: pnpm/action-setup@v4',
      '        with:',
      '          version: 10.19.0',
      '          run_install: false',
    ]
    : [];
  const installCommand = resolveInstallCommand(rootDir, packageManager);
  const verifyCommand = packageManager === 'pnpm' ? 'pnpm ashiba:verify' : 'npm run ashiba:verify';
  return [
    'name: Ashiba Contract Check',
    '',
    'on:',
    '  pull_request:',
    '  push:',
    '    branches:',
    '      - main',
    '',
    'jobs:',
    '  ashiba-contract:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    ...setupPackageManager,
    '      - uses: actions/setup-node@v4',
    '        with:',
    '          node-version: 22',
    `          cache: ${packageManager}`,
    `      - run: ${installCommand}`,
    `      - run: ${verifyCommand}`,
    '',
  ].join('\n');
}

function nativePrePushHook(packageManager: 'npm' | 'pnpm'): string {
  const verifyCommand = packageManager === 'pnpm' ? 'pnpm ashiba:verify' : 'npm run ashiba:verify';
  return [
    '#!/bin/sh',
    'set -e',
    '',
    verifyCommand,
    '',
  ].join('\n');
}

function resolvePackageManager(rootDir: string): 'npm' | 'pnpm' {
  const packageJsonPath = path.join(rootDir, 'package.json');
  const pnpmLockPath = path.join(rootDir, 'pnpm-lock.yaml');
  if (!existsSync(packageJsonPath)) return existsSync(pnpmLockPath) ? 'pnpm' : 'npm';
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { packageManager?: unknown };
    if (typeof packageJson.packageManager === 'string' && packageJson.packageManager.startsWith('pnpm@')) {
      return 'pnpm';
    }
  } catch {
    return existsSync(pnpmLockPath) ? 'pnpm' : 'npm';
  }
  return existsSync(pnpmLockPath) ? 'pnpm' : 'npm';
}

function resolveInstallCommand(rootDir: string, packageManager: 'npm' | 'pnpm'): string {
  if (packageManager === 'pnpm') {
    return existsSync(path.join(rootDir, 'pnpm-lock.yaml')) ? 'pnpm install --frozen-lockfile' : 'pnpm install';
  }
  return existsSync(path.join(rootDir, 'package-lock.json')) ? 'npm ci' : 'npm install';
}
