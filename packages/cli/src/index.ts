#!/usr/bin/env node

import { Command } from 'commander';
import { formatAshibaError, parseAshibaErrorMode, type AshibaErrorMode } from './error-format.js';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerCheckCommand } from './commands/check.js';
import { registerCheckContractCommand } from './commands/check-contract.js';
import { registerConfigCommand } from './commands/config.js';
import { registerDescribeCommand } from './commands/describe.js';
import { registerDdlCommand } from './commands/ddl.js';
import { registerFeatureCommand } from './commands/feature.js';
import { registerGateCommand } from './commands/gate.js';
import { registerInitCommand } from './commands/init.js';
import { registerLintCommand } from './commands/lint.js';
import { registerModelGenCommand } from './commands/model-gen.js';
import { registerPerfCommand } from './commands/perf.js';
import { registerProjectCommand } from './commands/project.js';
import { registerQueryCommand } from './commands/query.js';
import { registerRfbaCommand } from './commands/rfba.js';

/**
 * Current CLI package version exposed by the Ashiba command.
 */
export const VERSION = '0.0.0';

/**
 * Build the Ashiba Commander program with all registered command surfaces.
 */
export function buildProgram(): Command {
  const program = new Command();
  program
    .name('ashiba')
    .description('Ashiba Runtime Zero SQL scaffolder for TypeScript applications.')
    .version(VERSION)
    .option('--error-format <mode>', 'Error output mode: human or ai', 'human')
    .addHelpText('after', `
Core message:
  Show me the SQL.
  Ashiba handles the boring parts.

Status:
  This CLI includes scaffolding, DDL review, query analysis, contract checks,
  model generation, RFBA inspection, and performance evidence.

Common use cases:
  ashiba check                Run the fast human-first diagnostic gate.
  ashiba check --full         Run the full gate for pre-push, review, or CI.
  ashiba gate scaffold        Create the standard passive gate surface.
  ashiba init                 Create a SQL-first starter after choosing a DBMS/driver.
  ashiba feature scaffold     Add a reviewable feature boundary from DDL metadata.
  ashiba query slice          Debug one CTE step inside a complex WITH query.
  ashiba ddl migration generate
                              Compare two DDL snapshots and review migration risk.
  ashiba describe command     Show the command catalog with AI-readable use cases.
`);

  registerCheckCommand(program);
  registerCheckContractCommand(program);
  registerConfigCommand(program);
  registerDescribeCommand(program);
  registerDdlCommand(program);
  registerFeatureCommand(program);
  registerGateCommand(program);
  registerInitCommand(program);
  registerLintCommand(program);
  registerModelGenCommand(program);
  registerPerfCommand(program);
  registerProjectCommand(program);
  registerQueryCommand(program);
  registerRfbaCommand(program);

  return program;
}

/**
 * Run the Ashiba CLI with the provided argv vector.
 */
export async function main(argv: string[] = process.argv): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(argv);
}

/**
 * Resolve the configured human-oriented or AI-oriented error output mode.
 */
export function getErrorMode(program: Command): AshibaErrorMode {
  const options = program.opts<{ errorFormat?: string }>();
  return parseAshibaErrorMode(options.errorFormat);
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : undefined;

if (isCliEntrypoint(invokedFile, currentFile, 'ashiba')) {
  const program = buildProgram();
  void program.parseAsync(process.argv).catch((error) => {
    const mode = safeGetErrorMode(program);
    process.stderr.write(formatAshibaError(error, mode).text);
    process.exit(1);
  });
}

function isCliEntrypoint(invokedFile: string | undefined, currentFile: string, binName: string): boolean {
  if (!invokedFile) return false;
  if (safeRealpath(currentFile) === safeRealpath(invokedFile)) return true;
  const invokedBase = path.basename(invokedFile).toLowerCase();
  return invokedBase === binName
    || invokedBase === `${binName}.js`
    || invokedBase === `${binName}.cmd`
    || invokedBase === `${binName}.ps1`;
}

function safeRealpath(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

function safeGetErrorMode(program: Command): AshibaErrorMode {
  try {
    return getErrorMode(program);
  } catch {
    return 'human';
  }
}
