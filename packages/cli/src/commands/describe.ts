import type { Command } from 'commander';

export const COMMANDS = [
  { name: 'check', summary: 'Run the human-first Ashiba diagnostic gate.', useCase: 'Use the fast local loop while editing; add --full before push, review, or CI to include mapper tests.' },
  { name: 'init', summary: 'Create a SQL-first starter after the user has chosen a DBMS and driver.', useCase: 'Start a new Ashiba project with visible SQL, DDL, ZTD test support, and no AI behavior files.' },
  { name: 'config', summary: 'Emit Ashiba project configuration.', useCase: 'Create or inspect ashiba.config.json; use --compact for machine-readable one-line JSON.' },
  { name: 'describe command', summary: 'Describe one command or list the command catalog for humans and AI agents.', useCase: 'Let an AI or reviewer understand the intended command surface before choosing a workflow.' },
  { name: 'gate scaffold', summary: 'Scaffold the standard passive check gates without adding hook libraries.', useCase: 'Run this once to create package scripts, GitHub Actions, and a native git hook file so drift is caught in the ordinary path.' },
  { name: 'ddl migration generate', summary: 'Compare DDL snapshot files or recursive DDL directories, generate reviewable migration SQL, and include migration risk info.', useCase: 'Review a schema change before DB deployment without connecting to or mutating a database.' },
  { name: 'query uses table', summary: 'Find SQL assets that reference a table.', useCase: 'Estimate impact before renaming, dropping, or changing a table.' },
  { name: 'query uses column', summary: 'Find SQL assets that reference a column.', useCase: 'Estimate impact before renaming, dropping, changing type/nullability, or changing semantics of a column.' },
  { name: 'query outline', summary: 'Describe CTE and statement structure for a SQL file.', useCase: 'Understand a complex SQL file before editing it or refreshing metadata.' },
  { name: 'query graph', summary: 'Build a dependency graph for CTE-heavy SQL.', useCase: 'See how CTEs depend on each other when reviewing a large query.' },
  { name: 'query slice', summary: 'Extract a runnable SQL slice around a target CTE or final query.', useCase: 'Debug a complex CTE by running one intermediate point in a SQL client to find where rows or values break.' },
  { name: 'query lint', summary: 'Report structural SQL maintainability risks.', useCase: 'Catch query shapes that are hard to review, maintain, or analyze before they enter a feature boundary.' },
  { name: 'query sssql add', summary: 'Add an optional filter branch and refresh query metadata.', useCase: 'Make an optional condition explicit in SQL while keeping runtime behavior metadata-backed.' },
  { name: 'query sssql refresh', summary: 'Refresh optional-condition metadata after SQL edits.', useCase: 'Regenerate metadata when the SQL still owns the intended optional filter shape.' },
  { name: 'query sssql remove', summary: 'Remove an optional filter branch and refresh query metadata.', useCase: 'Delete optional-condition scaffolding without hand-editing metadata.' },
  { name: 'feature scaffold', summary: 'Scaffold editable feature-local SQL boundaries.', useCase: 'Create a reviewable feature entrypoint, query.ts, SQL, DTO contracts, and mapper tests from DDL.' },
  { name: 'feature query scaffold', summary: 'Add another editable query boundary under an existing feature.', useCase: 'Grow a feature by adding a second SQL behavior without regenerating or hiding existing code.' },
  { name: 'feature query refresh', summary: 'Refresh generated query model metadata after SQL-only edits.', useCase: 'Fix drift after a human or AI edits the SQL file.' },
  { name: 'feature tests scaffold', summary: 'Scaffold feature-local mapper and logic test files.', useCase: 'Add generated mapping cases and human-owned logic case placeholders to an existing query boundary.' },
  { name: 'feature tests check', summary: 'Check and optionally fix generated mapping test assets.', useCase: 'Detect missing generated mapping coverage after DDL or query changes.' },
  { name: 'feature generated-mapper check', summary: 'Check named-parameter and result-column drift between SQL and editable query contracts.', useCase: 'Find contract drift before running or publishing generated application code.' },
  { name: 'model-gen', summary: 'Generate editable query contracts and generated query metadata files from visible SQL.', useCase: 'Use Ashiba metadata generation outside the feature scaffold flow.' },
  { name: 'lint', summary: 'Aggregate SQL lint over a file or directory.', useCase: 'Run project-level SQL maintainability checks in CI or before review.' },
  { name: 'check-contract', summary: 'Check visible SQL contracts against generated mapper boundaries.', useCase: 'Run a broad drift check before commit or release.' },
  { name: 'project check', summary: 'Aggregate passive project safety checks for DDL, SQL, contracts, and generated feature assets.', useCase: 'Catch discontinuous-work drift in the normal verify path instead of relying on humans to remember each refresh step.' },
  { name: 'perf init', summary: 'Scaffold the traditional performance lane.', useCase: 'Start an application-owned tuning scenario for realistic row counts and indexes.' },
  { name: 'perf run', summary: 'Inspect a performance run plan without owning DB execution.', useCase: 'Check benchmark parameters before an application-owned traditional DB-backed performance test.' },
  { name: 'perf scenario init', summary: 'Scaffold a manual traditional DB-backed tuning scenario.', useCase: 'Record target row counts, response-time requirements, timeout policy, and sandbox/adopted index boundaries.' },
  { name: 'perf scenario measure', summary: 'Record timing evidence and AI-oriented tuning guidance.', useCase: 'Return duration, timeout, requirement status, execution-plan evidence path, and next actions without making tuning decisions.' },
  { name: 'perf report diff', summary: 'Compare saved performance reports and evidence completeness.', useCase: 'Review whether a tuning change improved representative query duration.' },
  { name: 'rfba inspect', summary: 'Inspect feature/query review boundaries.', useCase: 'Confirm the project still exposes reviewable feature boundaries and query.ts files.' },
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

export function formatDescribe(commands: readonly { name: string; summary: string; useCase?: string }[]): string {
  if (commands.length === 0) {
    return 'No command descriptor found.\n';
  }
  return `${[
    'Ashiba command catalog',
    ...commands.map((command) => `- ${command.name}: ${command.summary}${command.useCase ? `\n  use case: ${command.useCase}` : ''}`),
  ].join('\n')}\n`;
}
