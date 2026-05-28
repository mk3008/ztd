import { spawnSync } from 'node:child_process';
import type { Command } from 'commander';
import { formatProjectCheckResult, runProjectCheck, type ProjectCheckOptions, type ProjectCheckResult } from './project.js';

export type AshibaCheckLevel = 'fast' | 'full';

export interface AshibaCheckOptions extends ProjectCheckOptions {
  fast?: boolean;
  full?: boolean;
  mapperTestCommand?: string;
}

export interface AshibaCheckCommandResult {
  kind: 'ashiba-check';
  level: AshibaCheckLevel;
  ok: boolean;
  projectCheck: ProjectCheckResult;
  mapperTest?: {
    command: string;
    ok: boolean;
    status: number | null;
    signal: NodeJS.Signals | null;
    error?: string;
    stdout?: string;
    stderr?: string;
  };
}

const DEFAULT_MAPPER_TEST_COMMAND = 'npx vitest run';

/**
 * Register the top-level human-first diagnostic command.
 */
export function registerCheckCommand(program: Command): void {
  program
    .command('check')
    .description('Run the human-first Ashiba diagnostic gate')
    .option('--root-dir <path>', 'Project root directory', '.')
    .option('--format <format>', 'Output format: text or json', 'text')
    .option('--warnings-as-errors', 'Treat warnings as check failures', false)
    .option('--fast', 'Run the fast local check only. This is the default.', false)
    .option('--full', 'Run the fast check and the configured mapper test command.', false)
    .option('--mapper-test-command <command>', 'Mapper test command used by --full', DEFAULT_MAPPER_TEST_COMMAND)
    .action((options: AshibaCheckOptions) => {
      const result = runAshibaCheck(options);
      if (options.format === 'json') {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        process.stdout.write(formatAshibaCheckResult(result, options));
      }
      if (!result.ok) process.exit(1);
    });
}

/**
 * Run the Ashiba diagnostic gate without going through Commander.
 */
export function runAshibaCheck(options: AshibaCheckOptions = {}): AshibaCheckCommandResult {
  const level = resolveCheckLevel(options);
  const projectCheck = runProjectCheck(options);
  const result: AshibaCheckCommandResult = {
    kind: 'ashiba-check',
    level,
    ok: projectCheck.ok,
    projectCheck,
  };

  if (level === 'full' && projectCheck.ok) {
    const command = (options.mapperTestCommand ?? DEFAULT_MAPPER_TEST_COMMAND).trim();
    const mapperTest = runMapperTestCommand(command, projectCheck.rootDir, options.format === 'json');
    result.mapperTest = mapperTest;
    result.ok = result.ok && mapperTest.ok;
  }

  return result;
}

/**
 * Format a diagnostic gate result for human CLI output.
 */
export function formatAshibaCheckResult(result: AshibaCheckCommandResult, options: AshibaCheckOptions = {}): string {
  const lines = [
    `Ashiba check: ${result.ok ? 'ok' : 'failed'}`,
    `- level: ${result.level}`,
    '',
    formatProjectCheckResult(result.projectCheck, options).trimEnd(),
  ];

  if (result.level === 'fast') {
    lines.push('', 'Next:', '- Use `ashiba check --full` before push, review, or CI when DB-backed mapper tests should run.');
  } else if (result.mapperTest) {
    lines.push(
      '',
      `Mapper test: ${result.mapperTest.ok ? 'ok' : 'failed'}`,
      `- command: ${result.mapperTest.command}`,
    );
    if (!result.mapperTest.ok) {
      lines.push('- next: Fix the DB-backed mapper test failure, then rerun `ashiba check --full`.');
      if (result.mapperTest.error) lines.push(`- error: ${result.mapperTest.error}`);
    }
  } else {
    lines.push(
      '',
      'Mapper test: skipped',
      '- reason: fast project check failed first.',
      '- next: Fix the fast check issues, then rerun `ashiba check --full`.',
    );
  }

  return `${lines.join('\n')}\n`;
}

function resolveCheckLevel(options: AshibaCheckOptions): AshibaCheckLevel {
  if (options.fast === true && options.full === true) {
    throw new Error('Use either --fast or --full, not both.');
  }
  return options.full === true ? 'full' : 'fast';
}

function runMapperTestCommand(command: string, cwd: string, captureOutput: boolean): NonNullable<AshibaCheckCommandResult['mapperTest']> {
  if (command.length === 0) {
    return {
      command,
      ok: false,
      status: 1,
      signal: null,
      error: 'Mapper test command is empty.',
    };
  }

  const result = spawnSync(command, {
    cwd,
    shell: true,
    stdio: captureOutput ? 'pipe' : 'inherit',
    encoding: captureOutput ? 'utf8' : undefined,
  });
  return {
    command,
    ok: result.status === 0 && !result.error,
    status: result.status,
    signal: result.signal,
    error: result.error?.message,
    ...(captureOutput ? {
      stdout: typeof result.stdout === 'string' ? result.stdout : '',
      stderr: typeof result.stderr === 'string' ? result.stderr : '',
    } : {}),
  };
}
