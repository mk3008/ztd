import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Command } from 'commander';
import { analyzeMigrationSqlRisks, compareDdlSql } from '../ddl-diff/index.js';
import { requiredCliValueError } from '../errors.js';

export interface DdlMigrationInfoOptions {
  file?: string;
  format?: 'text' | 'json';
}

export interface DdlMigrationGenerateOptions {
  from?: string;
  to?: string;
  out?: string;
  format?: 'text' | 'json';
  dryRun?: boolean;
}

export function registerDdlCommand(program: Command): void {
  const ddl = program.command('ddl').description('DDL review and migration helpers');

  const migration = ddl
    .command('migration')
    .description('Generate migration SQL and review migration risk from explicit DDL inputs');

  migration
    .command('generate')
    .description('Compare two DDL snapshots and generate reviewable migration SQL')
    .requiredOption('--from <path>', 'Current or old DDL snapshot')
    .requiredOption('--to <path>', 'Desired or new DDL snapshot')
    .option('--out <path>', 'Write generated migration SQL to this file')
    .option('--dry-run', 'Preview generated migration SQL without writing --out', false)
    .option('--format <format>', 'Output format: text or json', 'text')
    .action((options: DdlMigrationGenerateOptions) => {
      const result = runDdlMigrationGenerate(options);
      process.stdout.write(result);
    });

  migration
    .command('info')
    .description('Analyze generated or hand-edited migration SQL and report risk')
    .requiredOption('--file <path>', 'Migration SQL file to analyze')
    .option('--format <format>', 'Output format: text or json', 'text')
    .action((options: DdlMigrationInfoOptions) => {
      const result = runDdlMigrationInfo(options);
      process.stdout.write(result);
    });
}

export function runDdlMigrationInfo(
  options: DdlMigrationInfoOptions,
  renderOptions: { commandKind?: string; title?: string } = {}
): string {
  const filePath = requirePath(options.file, '--file');
  const sql = readFileSync(filePath, 'utf8');
  const risks = analyzeMigrationSqlRisks(sql);
  const commandKind = renderOptions.commandKind ?? 'ddl-migration-info';
  const title = renderOptions.title ?? 'Migration info';

  if (options.format === 'json') {
    return `${JSON.stringify({ kind: commandKind, file: filePath, risks }, null, 2)}\n`;
  }

  const lines = [title, `- file: ${filePath}`, '', 'Destructive risks'];
  lines.push(...formatRiskLines(risks.destructiveRisks));
  lines.push('', 'Operational risks');
  lines.push(...formatRiskLines(risks.operationalRisks));
  return `${lines.join('\n')}\n`;
}

export function runDdlMigrationGenerate(
  options: DdlMigrationGenerateOptions,
  renderOptions: { commandKind?: string; title?: string } = {}
): string {
  const fromPath = requirePath(options.from, '--from');
  const toPath = requirePath(options.to, '--to');
  const remoteSql = readFileSync(fromPath, 'utf8');
  const localSql = readFileSync(toPath, 'utf8');
  const result = compareDdlSql({ localSql, remoteSql });
  const commandKind = renderOptions.commandKind ?? 'ddl-migration-generate';
  const title = renderOptions.title ?? 'DDL migration generate';

  if (options.out && options.dryRun !== true) {
    writeFileSync(options.out, result.sql, 'utf8');
  }

  if (options.format === 'json') {
    return `${JSON.stringify({
      kind: commandKind,
      from: fromPath,
      to: toPath,
      out: options.out ? path.normalize(options.out) : undefined,
      dryRun: options.dryRun === true,
      hasChanges: result.hasChanges,
      summary: result.summary,
      applyPlan: result.applyPlan,
      risks: result.risks,
    }, null, 2)}\n`;
  }

  const lines = [title, `- from: ${fromPath}`, `- to: ${toPath}`];
  if (options.out) {
    lines.push(`- sql: ${path.normalize(options.out)}${options.dryRun === true ? ' (dry-run, not written)' : ''}`);
  }
  if (options.dryRun === true) {
    lines.push('- dry-run: true');
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

function formatRiskLines(risks: Array<{ kind: string; target?: string; from?: string; to?: string; guidance?: string[] }>): string[] {
  if (risks.length === 0) {
    return ['- none'];
  }

  const lines: string[] = [];
  for (const risk of risks) {
    if (risk.from && risk.to) {
      lines.push(`- ${risk.kind}: ${risk.from} -> ${risk.to}`);
    } else {
      lines.push(`- ${risk.kind}: ${String(risk.target ?? 'unknown')}`);
    }
    if (risk.guidance && risk.guidance.length > 0) {
      lines.push(`  guidance: ${risk.guidance.join(', ')}`);
    }
  }
  return lines;
}
