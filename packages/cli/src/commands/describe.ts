import type { Command } from 'commander';

export const COMMANDS = [
  { name: 'init', summary: 'Create a small Ashiba SQL-first starter.' },
  { name: 'config', summary: 'Emit Ashiba project configuration.' },
  { name: 'describe command', summary: 'Describe one command or list the command catalog for humans and AI agents.' },
  { name: 'ddl risk', summary: 'Report destructive and operational risk for migration SQL.' },
  { name: 'ddl diff', summary: 'Compare DDL snapshots and emit a reviewable difference report.' },
  { name: 'ddl migration generate', summary: 'Compare two DDL snapshots and generate reviewable migration SQL.' },
  { name: 'ddl migration info', summary: 'Report destructive and operational risk for migration SQL.' },
  { name: 'query uses table', summary: 'Find SQL assets that reference a table.' },
  { name: 'query uses column', summary: 'Find SQL assets that reference a column.' },
  { name: 'query match-observed', summary: 'Match observed SQL against visible project SQL assets.' },
  { name: 'query outline', summary: 'Describe CTE and statement structure for a SQL file.' },
  { name: 'query graph', summary: 'Build a dependency graph for CTE-heavy SQL.' },
  { name: 'query slice', summary: 'Extract a reviewable SQL slice around a target CTE.' },
  { name: 'query plan', summary: 'Plan materialization and review steps for large SQL.' },
  { name: 'query lint', summary: 'Report structural SQL maintainability risks.' },
  { name: 'query patch apply', summary: 'Apply a reviewed SQL patch to visible SQL assets.' },
  { name: 'query sssql list', summary: 'List SQL-first optional-condition scaffold metadata.' },
  { name: 'query sssql scaffold', summary: 'Scaffold SQL-first optional-condition metadata.' },
  { name: 'query sssql refresh', summary: 'Refresh SQL-first optional-condition metadata.' },
  { name: 'query sssql remove', summary: 'Remove SQL-first optional-condition metadata.' },
  { name: 'feature scaffold', summary: 'Scaffold editable feature-local SQL boundaries.' },
  { name: 'feature query scaffold', summary: 'Add an editable query boundary under an existing feature.' },
  { name: 'feature tests scaffold', summary: 'Scaffold feature-local mapper and traditional test lane files.' },
  { name: 'feature generated-mapper check', summary: 'Check named-parameter drift between SQL and editable query boundary contracts.' },
  { name: 'model-gen', summary: 'Generate editable query contract scaffolds from visible SQL.' },
  { name: 'lint', summary: 'Aggregate SQL lint over a file or directory.' },
  { name: 'check-contract', summary: 'Check visible SQL contracts against generated mapper boundaries.' },
  { name: 'perf init', summary: 'Scaffold the traditional performance lane.' },
  { name: 'perf run', summary: 'Inspect a performance run plan without owning DB execution.' },
  { name: 'perf report diff', summary: 'Compare saved performance reports and evidence completeness.' },
  { name: 'test-evidence collect', summary: 'Collect lightweight mapper/performance test evidence inventory.' },
  { name: 'test-evidence render', summary: 'Render collected test evidence as Markdown.' },
  { name: 'test-evidence diff', summary: 'Compare collected test evidence snapshots.' },
  { name: 'rfba inspect', summary: 'Inspect feature/query review boundaries.' },
] as const;

export interface DescribeOptions {
  format?: 'text' | 'json';
}

export function registerDescribeCommand(program: Command): void {
  const describe = program.command('describe').description('Describe Ashiba commands for humans and AI agents');

  describe
    .command('command [name...]')
    .description('Describe one command or list the command catalog')
    .option('--format <format>', 'Output format: text or json', 'text')
    .action((nameParts: string[] | undefined, options: DescribeOptions) => {
      const name = (nameParts ?? []).join(' ').trim();
      const result = name ? COMMANDS.filter((command) => command.name === name) : [...COMMANDS];
      if (options.format === 'json') {
        process.stdout.write(`${JSON.stringify({ kind: 'describe-command', commands: result }, null, 2)}\n`);
        return;
      }
      process.stdout.write(formatDescribe(result));
    });
}

export function formatDescribe(commands: readonly { name: string; summary: string }[]): string {
  if (commands.length === 0) {
    return 'No command descriptor found.\n';
  }
  return `${['Ashiba command catalog', ...commands.map((command) => `- ${command.name}: ${command.summary}`)].join('\n')}\n`;
}
