import type { Command } from 'commander';

export interface CommandArgumentSpec {
  name: string;
  required: boolean;
  description: string;
}

export interface CommandOptionSpec {
  flags: string;
  description: string;
  defaultValue?: string;
}

export interface CommandSpec {
  name: string;
  summary: string;
  useCase: string;
  usage: string;
  arguments?: CommandArgumentSpec[];
  options?: CommandOptionSpec[];
  notes?: string[];
  examples?: string[];
}

export function getCommandSpec(name: string): CommandSpec {
  const command = COMMANDS.find((candidate) => candidate.name === name);
  if (!command) {
    throw new Error(`Ashiba command catalog entry is missing: ${name}`);
  }
  return command;
}

export function getCommandSummary(name: string): string {
  return getCommandSpec(name).summary.replace(/\.$/, '');
}

export function formatCommandCatalogHelp(name: string): string {
  const command = getCommandSpec(name);
  const lines = [
    '',
    'Catalog use case:',
    `  ${command.useCase}`,
  ];

  if (command.notes?.length) {
    lines.push('', 'Combinations and notes:');
    for (const note of command.notes) {
      lines.push(`  - ${note}`);
    }
  }

  if (command.examples?.length) {
    lines.push('', 'Examples:');
    for (const example of command.examples) {
      lines.push(`  ${example}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

export function formatCommonUseCases(names: readonly string[]): string {
  return names.map((name) => {
    const command = getCommandSpec(name);
    return `  ${command.usage.padEnd(30)} ${command.useCase}`;
  }).join('\n');
}

export function applyCommandCatalogToProgram(program: Command): void {
  for (const spec of COMMANDS) {
    const command = findCommandByCatalogName(program, spec.name);
    if (!command) {
      continue;
    }
    command.description(getCommandSummary(spec.name));
    command.addHelpText('after', formatCommandCatalogHelp(spec.name));
  }
}

function findCommandByCatalogName(program: Command, name: string): Command | undefined {
  const parts = name.split(' ');
  let current: Command | undefined = program;
  for (const part of parts) {
    current = current.commands.find((command) => command.name() === part);
    if (!current) {
      return undefined;
    }
  }
  return current;
}

const commonRoot: CommandOptionSpec = { flags: '--root-dir <path>', description: 'Project root directory.', defaultValue: '.' };
const commonFormat: CommandOptionSpec = { flags: '--format <format>', description: 'Output format. Usually text or json.', defaultValue: 'text' };
const commonDryRun: CommandOptionSpec = { flags: '--dry-run', description: 'Print the planned result without writing files.', defaultValue: 'false' };
const commonForce: CommandOptionSpec = { flags: '--force', description: 'Overwrite generated or scaffold-owned files when applicable.', defaultValue: 'false' };

export const COMMANDS: readonly CommandSpec[] = [
  {
    name: 'check',
    summary: 'Run the human-first Ashiba diagnostic gate.',
    useCase: 'Use the fast local loop while editing; add --full before push, review, or CI to include mapper tests.',
    usage: 'ashiba check [options]',
    options: [
      commonRoot,
      commonFormat,
      { flags: '--warnings-as-errors', description: 'Treat warnings as check failures.', defaultValue: 'false' },
      { flags: '--fast', description: 'Run the fast local check only. This is the default.', defaultValue: 'false' },
      { flags: '--full', description: 'Run the fast check and the configured mapper test command.', defaultValue: 'false' },
      { flags: '--mapper-test-command <command>', description: 'Mapper test command used by --full.', defaultValue: 'vitest run' },
    ],
    examples: ['npx ashiba check', 'npx ashiba check --full --mapper-test-command "vitest run"'],
  },
  {
    name: 'init',
    summary: 'Create a SQL-first starter after the user has chosen a DBMS and driver.',
    useCase: 'Start a new Ashiba project with visible SQL, DDL, ZTD test support, and no AI behavior files.',
    usage: 'ashiba init [options]',
    options: [
      { flags: '--dir <path>', description: 'Target directory for the starter.', defaultValue: '.' },
      { flags: '--db <dbms>', description: 'Database starter to scaffold. Currently supported: postgres.' },
      { flags: '--driver <driver>', description: 'Wrapped driver starter to scaffold. Currently supported: pg for postgres.' },
      { flags: '--with-demo-ddl', description: 'Create demo DDL under db/ddl for the starter feature flow.', defaultValue: 'false' },
      { flags: '--with-migration-demo-ddl', description: 'Create a temporary old DDL snapshot under tmp/ddl for migration tutorial flow.', defaultValue: 'false' },
      commonForce,
      commonDryRun,
    ],
    examples: ['npx ashiba init --db postgres --driver pg --with-demo-ddl'],
  },
  {
    name: 'config',
    summary: 'Emit Ashiba project configuration.',
    useCase: 'Create or inspect ashiba.config.json; use --compact for machine-readable one-line JSON.',
    usage: 'ashiba config [options]',
    options: [{ flags: '--compact', description: 'Print compact JSON.', defaultValue: 'false' }],
    examples: ['npx ashiba config', 'npx ashiba config --compact'],
  },
  {
    name: 'describe command',
    summary: 'Describe one command or list the command catalog for humans and AI agents.',
    useCase: 'Let an AI or reviewer understand the intended command surface before choosing a workflow.',
    usage: 'ashiba describe command [options] [name...]',
    arguments: [{ name: 'name', required: false, description: 'Command name parts, for example "query optional add".' }],
    options: [commonFormat],
    examples: ['npx ashiba describe command', 'npx ashiba describe command query optional add --format json'],
  },
  {
    name: 'gate scaffold',
    summary: 'Scaffold the standard passive check gates without adding hook libraries.',
    useCase: 'Run this once to create package scripts, GitHub Actions, and a native git hook file so drift is caught in the ordinary path.',
    usage: 'ashiba gate scaffold [options]',
    options: [
      { flags: '--target <target>', description: 'Advanced target: all, package-scripts, github-actions, or git-hooks.', defaultValue: 'all' },
      commonRoot,
      commonForce,
    ],
    examples: ['npx ashiba gate scaffold', 'npx ashiba gate scaffold --target github-actions'],
  },
  {
    name: 'ddl migration generate',
    summary: 'Compare DDL snapshot files or recursive DDL directories, generate reviewable migration SQL, and include migration risk info.',
    useCase: 'Review a schema change before DB deployment without connecting to or mutating a database.',
    usage: 'ashiba ddl migration generate [options]',
    options: [
      { flags: '--from <path>', description: 'Current or old DDL snapshot file.' },
      { flags: '--to <path>', description: 'Desired or new DDL snapshot file.' },
      { flags: '--from-dir <path>', description: 'Current or old DDL snapshot directory; reads .sql files recursively in stable order.' },
      { flags: '--to-dir <path>', description: 'Desired or new DDL snapshot directory; reads .sql files recursively in stable order.' },
      { flags: '--out <path>', description: 'Write generated migration SQL to this file.' },
      commonDryRun,
      { flags: '--no-drop-tables', description: 'Do not emit DROP TABLE statements even when table drops are detected.' },
      { flags: '--no-drop-columns', description: 'Do not emit DROP COLUMN statements even when column drops are detected.' },
      { flags: '--no-drop-constraints', description: 'Do not emit DROP CONSTRAINT statements even when constraint drops are detected.' },
      { flags: '--no-drop-indexes', description: 'Do not emit DROP INDEX statements even when index drops are detected.' },
      commonFormat,
    ],
    notes: [
      'Use either --from/--to for single DDL snapshot files or --from-dir/--to-dir for recursive DDL directories.',
      '--from or --from-dir means the current/old database shape. --to or --to-dir means the desired/new local DDL shape.',
      'Use --out when you want a migration SQL artifact. Use --dry-run when you only want to preview.',
      'Use --no-drop-tables, --no-drop-columns, --no-drop-constraints, and --no-drop-indexes when Ashiba should report destructive differences without emitting destructive SQL.',
      '--format json is for machine-readable migration risk reporting; text is for review in a terminal.',
    ],
    examples: ['npx ashiba ddl migration generate --from-dir path/to/current-db-ddl --to-dir db/ddl --out tmp/ddl/migration.sql --no-drop-tables --no-drop-columns --no-drop-constraints'],
  },
  {
    name: 'feature scaffold',
    summary: 'Scaffold editable feature-local SQL boundaries.',
    useCase: 'Create a reviewable feature entrypoint, query.ts, SQL, DTO contracts, and mapper tests from DDL.',
    usage: 'ashiba feature scaffold [options] <name>',
    arguments: [{ name: 'name', required: true, description: 'Feature name to create under the configured feature root.' }],
    options: [
      { flags: '--table <table>', description: 'Target table name. Required.' },
      { flags: '--action <action>', description: 'Action: insert, update, delete, get-by-id, or list. Required.' },
      commonRoot,
      commonDryRun,
      commonForce,
    ],
    examples: ['npx ashiba feature scaffold users-list --table users --action list'],
  },
  {
    name: 'feature query scaffold',
    summary: 'Add another editable query boundary under an existing feature.',
    useCase: 'Grow a feature by adding a second SQL behavior without regenerating or hiding existing code.',
    usage: 'ashiba feature query scaffold [options] <feature> <query>',
    arguments: [
      { name: 'feature', required: true, description: 'Existing feature name.' },
      { name: 'query', required: true, description: 'New query boundary name.' },
    ],
    options: [
      { flags: '--table <table>', description: 'Target table name. Required.' },
      { flags: '--action <action>', description: 'Action: insert, update, delete, get-by-id, or list. Required.' },
      commonRoot,
      commonDryRun,
      commonForce,
    ],
    examples: ['npx ashiba feature query scaffold users get-by-id --table users --action get-by-id'],
  },
  {
    name: 'feature query refresh',
    summary: 'Refresh generated query model metadata after SQL-only edits.',
    useCase: 'Fix drift after a human or AI edits the SQL file.',
    usage: 'ashiba feature query refresh [options] <feature> <query>',
    arguments: [
      { name: 'feature', required: true, description: 'Feature name.' },
      { name: 'query', required: true, description: 'Query boundary name.' },
    ],
    options: [commonRoot, commonDryRun, commonFormat],
    examples: ['npx ashiba feature query refresh users-list list'],
  },
  {
    name: 'feature tests scaffold',
    summary: 'Scaffold feature-local mapper and logic test files.',
    useCase: 'Add generated mapping cases and human-owned logic case placeholders to an existing query boundary.',
    usage: 'ashiba feature tests scaffold [options] <feature>',
    arguments: [{ name: 'feature', required: true, description: 'Feature name.' }],
    options: [
      { flags: '--query <name>', description: 'Limit scaffolding to one query boundary.' },
      commonRoot,
      commonDryRun,
      commonForce,
    ],
    examples: ['npx ashiba feature tests scaffold users-list', 'npx ashiba feature tests scaffold users-list --query list'],
  },
  {
    name: 'feature tests check',
    summary: 'Check and optionally fix generated mapping test assets.',
    useCase: 'Detect missing generated mapping coverage after DDL or query changes.',
    usage: 'ashiba feature tests check [options] [feature]',
    arguments: [{ name: 'feature', required: false, description: 'Optional feature name.' }],
    options: [
      { flags: '--boundary-dir <path>', description: 'Explicit feature boundary directory, including subgrouped boundaries.' },
      { flags: '--query <name>', description: 'Limit check to one query boundary.' },
      commonRoot,
      { flags: '--fix', description: 'Rewrite generated mapping test assets and create missing logic-case stubs.', defaultValue: 'false' },
      commonFormat,
    ],
    examples: ['npx ashiba feature tests check', 'npx ashiba feature tests check users-list --fix'],
  },
  {
    name: 'feature generated-mapper check',
    summary: 'Check named-parameter and result-column drift between SQL and editable query contracts.',
    useCase: 'Find contract drift before running or publishing generated application code.',
    usage: 'ashiba feature generated-mapper check [options] [feature]',
    arguments: [{ name: 'feature', required: false, description: 'Optional feature name.' }],
    options: [
      { flags: '--boundary-dir <path>', description: 'Limit drift check to one explicit feature boundary directory, including subgrouped boundaries.' },
      { flags: '--query <name>', description: 'Limit drift check to one query boundary.' },
      commonRoot,
      commonFormat,
    ],
    examples: ['npx ashiba feature generated-mapper check', 'npx ashiba feature generated-mapper check users-list --query list'],
  },
  {
    name: 'project check',
    summary: 'Aggregate passive project safety checks for DDL, SQL, contracts, and generated feature assets.',
    useCase: 'Catch discontinuous-work drift in the normal verify path instead of relying on humans to remember each refresh step.',
    usage: 'ashiba project check [options]',
    options: [
      commonRoot,
      commonFormat,
      { flags: '--warnings-as-errors', description: 'Treat warnings as check failures.', defaultValue: 'false' },
    ],
    examples: ['npx ashiba project check', 'npx ashiba project check --warnings-as-errors'],
  },
  {
    name: 'check-contract',
    summary: 'Check visible SQL contracts against generated mapper boundaries.',
    useCase: 'Run a broad drift check before commit or release.',
    usage: 'ashiba check-contract [options]',
    options: [
      commonRoot,
      { flags: '--feature <name>', description: 'Limit check to one feature.' },
      { flags: '--query <name>', description: 'Limit check to one query boundary.' },
      { flags: '--scope-dir <path>', description: 'Limit QuerySpec-like catalog checks to one subtree.' },
      { flags: '--sql-root <path>', description: 'Fallback root for shared sqlFile layouts.' },
      commonFormat,
    ],
    examples: ['npx ashiba check-contract', 'npx ashiba check-contract --feature users-list --query list'],
  },
  {
    name: 'model-gen',
    summary: 'Generate editable query contracts and generated query metadata files from visible SQL.',
    useCase: 'Use Ashiba metadata generation outside the feature scaffold flow.',
    usage: 'ashiba model-gen [options] <sqlFile>',
    arguments: [{ name: 'sqlFile', required: true, description: 'SQL file to inspect.' }],
    options: [
      { flags: '--out <file>', description: 'Write the generated TypeScript scaffold to this file.' },
      { flags: '--id <id>', description: 'Override the query id.' },
      commonRoot,
      { flags: '--ddl-dir <path>', description: 'Optional DDL directory for static row type hints.' },
      commonDryRun,
      commonFormat,
    ],
    examples: ['npx ashiba model-gen src/features/users/queries/list/list.sql --out src/features/users/queries/list/query.ts'],
  },
  {
    name: 'lint',
    summary: 'Aggregate SQL lint over a file or directory.',
    useCase: 'Run project-level SQL maintainability checks in CI or before review.',
    usage: 'ashiba lint [options] <path>',
    arguments: [{ name: 'path', required: true, description: 'SQL file or directory to lint.' }],
    options: [
      { flags: '--root-dir <path>', description: 'Project root for config and DDL-aware rules.', defaultValue: '.' },
      { flags: '--ddl-dir <path>', description: 'DDL directory for DDL-aware table and column checks.' },
      commonFormat,
      { flags: '--rules <list>', description: 'Comma-separated query lint rules.' },
    ],
    examples: ['npx ashiba lint src/features', 'npx ashiba lint src/features --rules join-direction'],
  },
  {
    name: 'query uses table',
    summary: 'Find SQL assets that reference a table.',
    useCase: 'Estimate impact before renaming, dropping, or changing a table.',
    usage: 'ashiba query uses table [options] <target>',
    arguments: [{ name: 'target', required: true, description: 'Table target, optionally schema-qualified.' }],
    options: [
      commonFormat,
      { flags: '--view <view>', description: 'Investigation view: impact or detail.', defaultValue: 'impact' },
      { flags: '--root-dir <path>', description: 'Project root to scan.', defaultValue: 'process.cwd()' },
      { flags: '--scope-dir <path>', description: 'Limit discovery to one QuerySpec subtree.' },
      { flags: '--sql-root <path>', description: 'Fallback root for shared sqlFile layouts.' },
      { flags: '--exclude-generated', description: 'Exclude QuerySpec files under generated directories.' },
      { flags: '--any-schema', description: 'Allow <table> lookup across schemas.' },
      { flags: '--allow-parser-fallback', description: 'Allow explicit regex fallback when AST parsing fails for table usage.' },
    ],
    notes: [
      'Use this before renaming, dropping, or changing a table to find SQL files that mention it.',
      '--root-dir controls the project tree to scan. Use it when running outside the project root.',
      '--scope-dir narrows discovery to one subtree when you only want to inspect one feature or package area.',
      '--sql-root is a fallback for shared sqlFile layouts that are not under the discovered feature roots.',
      '--any-schema lets users search by table name without requiring the schema prefix.',
      '--view impact gives a compact review list. --view detail is better when investigating why a match was found.',
    ],
    examples: ['npx ashiba query uses table public.users --root-dir .'],
  },
  {
    name: 'query uses column',
    summary: 'Find SQL assets that reference a column.',
    useCase: 'Estimate impact before renaming, dropping, changing type/nullability, or changing semantics of a column.',
    usage: 'ashiba query uses column [options] <target>',
    arguments: [{ name: 'target', required: true, description: 'Column target, for example public.users.email.' }],
    options: [
      commonFormat,
      { flags: '--view <view>', description: 'Investigation view: impact or detail.', defaultValue: 'impact' },
      { flags: '--root-dir <path>', description: 'Project root to scan.', defaultValue: 'process.cwd()' },
      { flags: '--scope-dir <path>', description: 'Limit discovery to one QuerySpec subtree.' },
      { flags: '--sql-root <path>', description: 'Fallback root for shared sqlFile layouts.' },
      { flags: '--exclude-generated', description: 'Exclude QuerySpec files under generated directories.' },
      { flags: '--any-schema', description: 'Allow <table.column> or <column> lookup across schemas.' },
      { flags: '--any-table', description: 'Allow <column> lookup across tables; requires --any-schema.' },
      { flags: '--allow-parser-fallback', description: 'Allow explicit parser-failure diagnostics instead of failing the command.' },
    ],
    notes: [
      'Use this before renaming, dropping, changing type/nullability, or changing the meaning of a column.',
      '--root-dir controls the project tree to scan. Use it when running outside the project root.',
      '--any-schema allows schema-agnostic lookup. --any-table allows column-only lookup and requires --any-schema.',
      '--view impact is for quick review. --view detail is for investigating individual matches.',
    ],
    examples: ['npx ashiba query uses column public.users.email --root-dir .'],
  },
  {
    name: 'query outline',
    summary: 'Describe CTE and statement structure for a SQL file.',
    useCase: 'Understand a complex SQL file before editing it or refreshing metadata.',
    usage: 'ashiba query outline [options] <sqlFile>',
    arguments: [{ name: 'sqlFile', required: true, description: 'SQL file to inspect.' }],
    options: [commonFormat],
    examples: ['npx ashiba query outline src/features/users/queries/list/list.sql'],
  },
  {
    name: 'query graph',
    summary: 'Build a dependency graph for CTE-heavy SQL.',
    useCase: 'See how CTEs depend on each other when reviewing a large query.',
    usage: 'ashiba query graph [options] <sqlFile>',
    arguments: [{ name: 'sqlFile', required: true, description: 'SQL file to inspect.' }],
    options: [{ flags: '--format <format>', description: 'Output format: text, json, or dot.', defaultValue: 'text' }],
    examples: ['npx ashiba query graph path/to/query.sql --format dot'],
  },
  {
    name: 'query slice',
    summary: 'Extract a runnable SQL slice around a target CTE or final query.',
    useCase: 'Debug a complex CTE by running one intermediate point in a SQL client to find where rows or values break.',
    usage: 'ashiba query slice [options] <sqlFile>',
    arguments: [{ name: 'sqlFile', required: true, description: 'SQL file to slice.' }],
    options: [
      { flags: '--cte <name>', description: 'Slice a specific CTE into a standalone debug query.' },
      { flags: '--final', description: 'Slice the final query while removing unused CTEs.' },
      { flags: '--limit <count>', description: 'Add LIMIT to the emitted debug query when supported.' },
    ],
    examples: ['npx ashiba query slice path/to/query.sql --cte filtered_users --limit 50'],
  },
  {
    name: 'query lint',
    summary: 'Report structural SQL maintainability risks.',
    useCase: 'Catch query shapes that are hard to review, maintain, or analyze before they enter a feature boundary.',
    usage: 'ashiba query lint [options] <sqlFile>',
    arguments: [{ name: 'sqlFile', required: true, description: 'SQL file to lint.' }],
    options: [
      commonFormat,
      { flags: '--root-dir <path>', description: 'Project root for config and DDL-aware rules.', defaultValue: 'process.cwd()' },
      { flags: '--rules <list>', description: 'Comma-separated lint rules to enable, for example: join-direction.' },
    ],
    examples: ['npx ashiba query lint path/to/query.sql'],
  },
  {
    name: 'query optional add',
    summary: 'Add an SSSQL optional search condition branch and refresh query metadata.',
    useCase: 'Use SSSQL notation, for example (:email is null or users.email = :email), while keeping runtime behavior metadata-backed.',
    usage: 'ashiba query optional add [options] <sqlFile>',
    arguments: [{ name: 'sqlFile', required: true, description: 'SQL file to edit.' }],
    options: [
      commonFormat,
      { flags: '--filter <name>', description: 'Target column for scalar scaffold, or primary anchor column for EXISTS/NOT EXISTS.' },
      { flags: '--parameter <name>', description: 'Explicit parameter name for structured optional-condition scaffold.' },
      { flags: '--operator <operator>', description: 'Scalar operator.' },
      { flags: '--kind <kind>', description: 'Structured branch kind: scalar, exists, or not-exists.' },
      { flags: '--query <sql>', description: 'Subquery SQL for EXISTS/NOT EXISTS scaffold.' },
      { flags: '--query-file <path>', description: 'Read subquery SQL for EXISTS/NOT EXISTS scaffold from a file.' },
      { flags: '--anchor-column <names>', description: 'Comma-separated anchor columns used by $c0, $c1 placeholders.' },
      { flags: '--root-dir <path>', description: 'Project root for query metadata refresh.', defaultValue: 'process.cwd()' },
      { flags: '--ddl-dir <path>', description: 'Optional DDL directory for static row type hints.' },
      { flags: '--preview', description: 'Emit a unified diff without writing files.' },
      { flags: '--out <path>', description: 'Write output to file.' },
    ],
    examples: ['npx ashiba query optional add path/to/query.sql --filter email --operator =', 'npx ashiba query optional add path/to/query.sql --kind exists --filter user_id --query "select 1 from orders where orders.user_id = $c0"'],
  },
  {
    name: 'query optional refresh',
    summary: 'Refresh SSSQL optional-condition metadata after SQL edits.',
    useCase: 'Regenerate metadata when the SQL still owns the intended optional filter shape. See docs/guide/sssql.md for the notation.',
    usage: 'ashiba query optional refresh [options] <sqlFile>',
    arguments: [{ name: 'sqlFile', required: true, description: 'SQL file to refresh.' }],
    options: [commonFormat, { flags: '--preview', description: 'Emit a unified diff without writing files.' }, { flags: '--out <path>', description: 'Write output to file.' }],
    examples: ['npx ashiba query optional refresh path/to/query.sql'],
  },
  {
    name: 'query optional remove',
    summary: 'Remove an SSSQL optional search condition branch and refresh query metadata.',
    useCase: 'Delete optional-condition scaffolding without hand-editing metadata.',
    usage: 'ashiba query optional remove [options] <sqlFile>',
    arguments: [{ name: 'sqlFile', required: true, description: 'SQL file to edit.' }],
    options: [
      commonFormat,
      { flags: '--all', description: 'Remove all recognized optional condition branches in the query.' },
      { flags: '--parameter <name>', description: 'Parameter name that identifies the target branch.' },
      { flags: '--kind <kind>', description: 'Optional branch kind filter.' },
      { flags: '--operator <operator>', description: 'Optional scalar operator filter.' },
      { flags: '--target <target>', description: 'Optional target column filter.' },
      { flags: '--preview', description: 'Emit a unified diff without writing files.' },
      { flags: '--out <path>', description: 'Write output to file.' },
    ],
    examples: ['npx ashiba query optional remove path/to/query.sql --parameter email', 'npx ashiba query optional remove path/to/query.sql --all'],
  },
  {
    name: 'perf init',
    summary: 'Scaffold the traditional performance lane.',
    useCase: 'Start an application-owned tuning scenario for realistic row counts and indexes.',
    usage: 'ashiba perf init [options]',
    options: [commonRoot, commonDryRun, commonForce, commonFormat],
    examples: ['npx ashiba perf init'],
  },
  {
    name: 'perf run',
    summary: 'Inspect a performance run plan without owning DB execution.',
    useCase: 'Check benchmark parameters before an application-owned traditional DB-backed performance test.',
    usage: 'ashiba perf run [options]',
    options: [
      { flags: '--query <path>', description: 'SQL file to benchmark in the application-owned performance lane. Required.' },
      { flags: '--params <path>', description: 'JSON parameter file for the benchmark query.' },
      commonRoot,
      commonDryRun,
      commonFormat,
    ],
    examples: ['npx ashiba perf run --query src/features/users/queries/list/list.sql --dry-run'],
  },
  {
    name: 'perf scenario init',
    summary: 'Scaffold a manual traditional DB-backed tuning scenario.',
    useCase: 'Record target row counts, response-time requirements, timeout policy, and sandbox/adopted index boundaries.',
    usage: 'ashiba perf scenario init [options]',
    options: [
      { flags: '--scenario <name>', description: 'Scenario name. Required.' },
      { flags: '--query <path>', description: 'Visible SQL file measured by this scenario.' },
      { flags: '--target-rows <table=count>', description: 'Expected table row count, repeatable.' },
      { flags: '--max-duration-ms <number>', description: 'Target response time in milliseconds.' },
      { flags: '--timeout-ms <number>', description: 'Measurement timeout in milliseconds.', defaultValue: '30000' },
      commonRoot,
      commonDryRun,
      commonForce,
      commonFormat,
    ],
    examples: ['npx ashiba perf scenario init --scenario users-list --query src/features/users/queries/list/list.sql --target-rows public.users=100000'],
  },
  {
    name: 'perf scenario measure',
    summary: 'Record timing evidence and AI-oriented tuning guidance.',
    useCase: 'Return duration, timeout, requirement status, execution-plan evidence path, and next actions without making tuning decisions.',
    usage: 'ashiba perf scenario measure [options]',
    options: [
      { flags: '--scenario <name>', description: 'Scenario name. Required.' },
      { flags: '--duration-ms <number>', description: 'Observed query duration in milliseconds.' },
      { flags: '--timed-out', description: 'Mark the measurement as timed out.', defaultValue: 'false' },
      { flags: '--explain <path>', description: 'Execution plan evidence file produced by the tuning session.' },
      { flags: '--evidence-name <name>', description: 'Stable evidence file name, without extension.' },
      commonRoot,
      commonDryRun,
      commonFormat,
    ],
    examples: ['npx ashiba perf scenario measure --scenario users-list --duration-ms 42 --explain tmp/perf/users-list-explain.json'],
  },
  {
    name: 'perf report diff',
    summary: 'Compare saved performance reports and evidence completeness.',
    useCase: 'Review whether a tuning change improved representative query duration.',
    usage: 'ashiba perf report diff [options] <baseline> <candidate>',
    arguments: [
      { name: 'baseline', required: true, description: 'Baseline performance report JSON.' },
      { name: 'candidate', required: true, description: 'Candidate performance report JSON.' },
    ],
    options: [commonFormat],
    examples: ['npx ashiba perf report diff perf/baseline.json perf/candidate.json'],
  },
  {
    name: 'rfba inspect',
    summary: 'Inspect feature/query review boundaries.',
    useCase: 'Confirm the project still exposes reviewable feature boundaries and query.ts files.',
    usage: 'ashiba rfba inspect [options]',
    options: [commonRoot, commonFormat],
    examples: ['npx ashiba rfba inspect'],
  },
];
