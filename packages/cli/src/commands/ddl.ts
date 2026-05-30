import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { Command } from 'commander';
import { compareDdlSql } from '../ddl-diff/index.js';
import { invalidCliInputError, requiredCliValueError } from '../errors.js';

type GitRunner = (args: string[], context: { label: string; spec: string; cwd?: string }) => string;

export interface DdlMigrationGenerateOptions {
  from?: string;
  to?: string;
  fromDir?: string;
  toDir?: string;
  fromGit?: string;
  toGit?: string;
  out?: string;
  format?: 'text' | 'json';
  dryRun?: boolean;
  dropTables?: boolean;
  dropColumns?: boolean;
  dropConstraints?: boolean;
  dropIndexes?: boolean;
  gitCwd?: string;
  gitRunner?: GitRunner;
}

export function registerDdlCommand(program: Command): void {
  const ddl = program.command('ddl').description('DDL review and migration helpers');

  const migration = ddl
    .command('migration')
    .description('Generate migration SQL and review migration risk from explicit DDL inputs')
    .addHelpText('after', `
Use case:
  Use this before database deployment to compare an old DDL snapshot and a new
  DDL snapshot. The command writes reviewable migration SQL and reports risks;
  it does not connect to or mutate a database.
`);

  migration
    .command('generate')
    .description('Compare two DDL snapshots, generate reviewable migration SQL, and include risk info')
    .option('--from <path>', 'Current or old DDL snapshot file')
    .option('--to <path>', 'Desired or new DDL snapshot file')
    .option('--from-dir <path>', 'Current or old DDL snapshot directory; reads .sql files recursively in stable order')
    .option('--to-dir <path>', 'Desired or new DDL snapshot directory; reads .sql files recursively in stable order')
    .option('--from-git <ref:path>', 'Current or old DDL snapshot from a git ref, for example main:db/ddl')
    .option('--to-git <ref:path>', 'Desired or new DDL snapshot from a git ref, for example feature/schema:db/ddl')
    .option('--out <path>', 'Write generated migration SQL to this file')
    .option('--dry-run', 'Preview generated migration SQL without writing --out', false)
    .option('--no-drop-tables', 'Do not emit DROP TABLE statements even when table drops are detected')
    .option('--no-drop-columns', 'Do not emit DROP COLUMN statements even when column drops are detected')
    .option('--no-drop-constraints', 'Do not emit DROP CONSTRAINT statements even when constraint drops are detected')
    .option('--no-drop-indexes', 'Do not emit DROP INDEX statements even when index drops are detected')
    .option('--format <format>', 'Output format: text or json', 'text')
    .action((options: DdlMigrationGenerateOptions) => {
      const result = runDdlMigrationGenerate(options);
      process.stdout.write(result);
    });
}

export function runDdlMigrationGenerate(
  options: DdlMigrationGenerateOptions,
  renderOptions: { commandKind?: string; title?: string } = {}
): string {
  const from = readDdlInput({
    filePath: options.from,
    dirPath: options.fromDir,
    gitSpec: options.fromGit,
    gitCwd: options.gitCwd,
    gitRunner: options.gitRunner,
    fileLabel: '--from',
    dirLabel: '--from-dir',
    gitLabel: '--from-git',
  });
  const to = readDdlInput({
    filePath: options.to,
    dirPath: options.toDir,
    gitSpec: options.toGit,
    gitCwd: options.gitCwd,
    gitRunner: options.gitRunner,
    fileLabel: '--to',
    dirLabel: '--to-dir',
    gitLabel: '--to-git',
  });
  const safety = {
    dropTables: options.dropTables ?? true,
    dropColumns: options.dropColumns ?? true,
    dropConstraints: options.dropConstraints ?? true,
    dropIndexes: options.dropIndexes ?? true,
  };
  const result = compareDdlSql({ localSql: to.sql, remoteSql: from.sql, safety });
  const commandKind = renderOptions.commandKind ?? 'ddl-migration-generate';
  const title = renderOptions.title ?? 'DDL migration generate';

  if (options.out && options.dryRun !== true) {
    writeFileSync(options.out, result.sql, 'utf8');
  }

  if (options.format === 'json') {
    return `${JSON.stringify({
      kind: commandKind,
      from: from.path,
      to: to.path,
      fromFiles: from.files,
      toFiles: to.files,
      out: options.out ? path.normalize(options.out) : undefined,
      dryRun: options.dryRun === true,
      hasChanges: result.hasChanges,
      safety,
      summary: result.summary,
      applyPlan: result.applyPlan,
      risks: result.risks,
    }, null, 2)}\n`;
  }

  const lines = [title, `- from: ${from.path}`, `- to: ${to.path}`];
  if (from.files.length > 0) {
    lines.push(`- from files: ${from.files.length}`);
  }
  if (to.files.length > 0) {
    lines.push(`- to files: ${to.files.length}`);
  }
  if (options.out) {
    lines.push(`- sql: ${path.normalize(options.out)}${options.dryRun === true ? ' (dry-run, not written)' : ''}`);
  }
  if (options.dryRun === true) {
    lines.push('- dry-run: true');
  }
  const disabledSafety = Object.entries(safety)
    .filter(([, enabled]) => enabled === false)
    .map(([name]) => name);
  if (disabledSafety.length > 0) {
    lines.push(`- suppressed operations: ${disabledSafety.join(', ')}`);
  }
  lines.push('', result.text.trimEnd());
  return `${lines.join('\n')}\n`;
}

function requirePath(value: string | undefined, label: string): string {
  if (!value || value.trim().length === 0) {
    throw requiredCliValueError(label);
  }
  return path.normalize(value);
}

function readDdlInput(input: {
  filePath: string | undefined;
  dirPath: string | undefined;
  gitSpec: string | undefined;
  gitCwd: string | undefined;
  gitRunner: GitRunner | undefined;
  fileLabel: string;
  dirLabel: string;
  gitLabel: string;
}): {
  path: string;
  sql: string;
  files: string[];
} {
  const selected = [
    input.filePath ? input.fileLabel : undefined,
    input.dirPath ? input.dirLabel : undefined,
    input.gitSpec ? input.gitLabel : undefined,
  ].filter((label): label is string => label !== undefined);
  if (selected.length > 1) {
    throw invalidCliInputError(
      'ASHIBA_DDL_INPUT_AMBIGUOUS',
      `${selected.join(' and ')} cannot be used together.`,
      `Pass only one DDL source: ${input.fileLabel}, ${input.dirLabel}, or ${input.gitLabel}.`,
      { options: selected },
    );
  }
  if (input.gitSpec) {
    return readGitDdlInput(input.gitSpec, input.gitLabel, input.gitCwd, input.gitRunner);
  }
  if (input.dirPath) {
    const resolved = requirePath(input.dirPath, input.dirLabel);
    const files = collectSqlFiles(resolved);
    return {
      path: resolved,
      files: files.map((file) => path.normalize(file)),
      sql: files.map((file) => readFileSync(file, 'utf8').trimEnd()).filter((sql) => sql.length > 0).join('\n\n'),
    };
  }
  const resolved = requirePath(input.filePath, input.fileLabel);
  if (!existsSync(resolved)) {
    throw invalidCliInputError(
      'ASHIBA_DDL_INPUT_FILE_NOT_FOUND',
      `DDL input file does not exist: ${resolved}.`,
      `Check the file path, or pass a DDL directory with ${input.dirLabel}.`,
      { file: resolved },
    );
  }
  const stat = statSync(resolved);
  if (!stat.isFile()) {
    throw invalidCliInputError(
      'ASHIBA_DDL_INPUT_FILE_NOT_FILE',
      `DDL input path is not a file: ${resolved}.`,
      `Pass a file to ${input.fileLabel}, or use ${input.dirLabel} for recursive directory input.`,
      { file: resolved },
    );
  }
  return {
    path: resolved,
    files: [],
    sql: readFileSync(resolved, 'utf8'),
  };
}

function readGitDdlInput(spec: string, label: string, gitCwd: string | undefined, gitRunner: GitRunner | undefined): { path: string; sql: string; files: string[] } {
  const parsed = parseGitDdlSpec(spec, label);
  const object = `${parsed.ref}:${parsed.treePath}`;
  const type = runGit(['cat-file', '-t', object], label, spec, gitCwd, gitRunner).trim();

  if (type === 'blob') {
    return {
      path: `${parsed.ref}:${path.posix.normalize(parsed.treePath)}`,
      files: [],
      sql: runGit(['show', object], label, spec, gitCwd, gitRunner),
    };
  }
  if (type !== 'tree') {
    throw invalidCliInputError(
      'ASHIBA_DDL_INPUT_GIT_NOT_FILE_OR_DIR',
      `Git DDL input is neither a file nor a directory: ${spec}.`,
      `Pass ${label} as <ref>:<sql-file-or-ddl-directory>.`,
      { spec, type },
    );
  }

  const listed = runGit(['ls-tree', '-r', '--name-only', parsed.ref, '--', parsed.treePath], label, spec, gitCwd, gitRunner)
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter((file) => file.length > 0 && file.toLowerCase().endsWith('.sql'))
    .sort();
  const sql = listed
    .map((file) => runGit(['show', `${parsed.ref}:${file}`], label, spec, gitCwd, gitRunner).trimEnd())
    .filter((text) => text.length > 0)
    .join('\n\n');
  return {
    path: `${parsed.ref}:${path.posix.normalize(parsed.treePath)}`,
    files: listed.map((file) => `${parsed.ref}:${file}`),
    sql,
  };
}

function parseGitDdlSpec(spec: string, label: string): { ref: string; treePath: string } {
  const separator = spec.indexOf(':');
  if (separator <= 0 || separator === spec.length - 1) {
    throw invalidCliInputError(
      'ASHIBA_DDL_INPUT_GIT_SPEC_INVALID',
      `Invalid git DDL input for ${label}: ${spec}.`,
      `Pass ${label} as <ref>:<sql-file-or-ddl-directory>, for example main:db/ddl.`,
      { spec },
    );
  }
  const ref = spec.slice(0, separator);
  const treePath = spec.slice(separator + 1).replaceAll('\\', '/');
  return { ref, treePath };
}

function runGit(args: string[], label: string, spec: string, gitCwd: string | undefined, gitRunner: GitRunner | undefined): string {
  try {
    if (gitRunner) {
      return gitRunner(args, { label, spec, cwd: gitCwd });
    }
    return execFileSync('git', args, { cwd: gitCwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    const stderr = error instanceof Error && 'stderr' in error ? String((error as { stderr?: unknown }).stderr ?? '') : '';
    throw invalidCliInputError(
      'ASHIBA_DDL_INPUT_GIT_READ_FAILED',
      `Failed to read DDL from git input ${label} ${spec}.`,
      stderr.trim() || `Check that the git ref and path exist: ${spec}.`,
      { spec },
    );
  }
}

function collectSqlFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    throw invalidCliInputError(
      'ASHIBA_DDL_INPUT_DIR_NOT_FOUND',
      `DDL input directory does not exist: ${dir}.`,
      'Check the directory path, or pass a single DDL snapshot with --from/--to.',
      { dir },
    );
  }
  const stat = statSync(dir);
  if (!stat.isDirectory()) {
    throw invalidCliInputError(
      'ASHIBA_DDL_INPUT_DIR_NOT_DIRECTORY',
      `DDL input path is not a directory: ${dir}.`,
      'Pass a directory to --from-dir/--to-dir, or use --from/--to for a single file.',
      { dir },
    );
  }
  const found: string[] = [];
  const directories: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const fullPath = path.join(dir, entry);
    const childStat = statSync(fullPath);
    if (childStat.isDirectory()) {
      directories.push(fullPath);
    } else if (childStat.isFile() && entry.toLowerCase().endsWith('.sql')) {
      found.push(fullPath);
    }
  }
  for (const directory of directories) {
    found.push(...collectSqlFiles(directory));
  }
  return found;
}
