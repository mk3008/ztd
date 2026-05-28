import { promises as fs } from 'fs';
import path from 'path';

async function main() {
  const root = process.cwd();
  const apiDir = path.join(root, 'docs', 'api');

  await ensureIndexFrontMatter(apiDir);
  await writeCommandApiPage(apiDir);
  await wrapMarkdownWithVPre(apiDir);
}

async function ensureIndexFrontMatter(apiDir) {
  const indexPath = path.join(apiDir, 'README.md');
  const targetPath = path.join(apiDir, 'index.md');

  let source = indexPath;
  try {
    await fs.access(indexPath);
  } catch {
    source = targetPath;
  }

  try {
    await fs.access(source);
  } catch {
    console.warn('[postprocess-docs] index markdown not found, skipping front matter injection');
    return;
  }

  if (source === indexPath) {
    await fs.rename(indexPath, targetPath);
  }

  const content = await fs.readFile(targetPath, 'utf8');
  if (!content.trimStart().startsWith('---')) {
    const frontMatter = ['---', 'title: API Overview', 'outline: deep', '---', ''].join('\n');
    await fs.writeFile(targetPath, frontMatter + content, 'utf8');
    console.log('[postprocess-docs] Injected front matter into api/index.md');
  }
}

async function writeCommandApiPage(apiDir) {
  const commandsPath = path.join(apiDir, 'commands.md');
  await fs.writeFile(commandsPath, `${[
    '---',
    'title: Command API',
    'outline: deep',
    '---',
    '',
    '# Command API',
    '',
    'Ashiba command contracts are exposed by the CLI itself.',
    '',
    'Use this page as a stable navigation index, then use command help for exact options and `ashiba describe command --format json` for machine-readable command descriptors.',
    '',
    '```bash',
    'npx ashiba --help',
    'npx ashiba <command> --help',
    'npx ashiba describe command --format json',
    '```',
    '',
    '## ashiba check',
    '',
    'Run the human-first diagnostic gate. Use the fast check while editing and the full check before push, review, or CI.',
    '',
    '```bash',
    'npx ashiba check',
    'npx ashiba check --full',
    '```',
    '',
    '## ashiba gate scaffold',
    '',
    'Scaffold the standard passive check gates without adding hook libraries.',
    '',
    '```bash',
    'npx ashiba gate scaffold',
    '```',
    '',
    '## ashiba init',
    '',
    'Create a SQL-first starter after choosing a DBMS and driver.',
    '',
    '```bash',
    'npx ashiba init --db postgres --driver pg --with-demo-ddl',
    '```',
    '',
    '## ashiba feature scaffold',
    '',
    'Create a reviewable feature boundary from DDL metadata.',
    '',
    '```bash',
    'npx ashiba feature scaffold --feature-name users-list --table users --action list',
    '```',
    '',
    '## ashiba feature query scaffold',
    '',
    'Add another query boundary under an existing feature.',
    '',
    '```bash',
    'npx ashiba feature query scaffold --feature users-list --query-name get-by-id --action get-by-id --table users',
    '```',
    '',
    '## ashiba feature query refresh',
    '',
    'Refresh generated query model metadata after SQL-only edits. The command needs a feature or boundary directory selector.',
    '',
    '```bash',
    'npx ashiba feature query refresh --feature users-list --query list',
    '```',
    '',
    '## ashiba feature tests scaffold',
    '',
    'Add generated mapper-test cases and human-owned test placeholders to an existing query boundary.',
    '',
    '```bash',
    'npx ashiba feature tests scaffold --feature users-list',
    '```',
    '',
    '## ashiba feature tests check',
    '',
    'Detect missing or stale generated mapping-test assets.',
    '',
    '```bash',
    'npx ashiba feature tests check',
    '```',
    '',
    '## ashiba feature generated-mapper check',
    '',
    'Check SQL parameters, DDL-backed parameter types, result columns, and editable query contracts.',
    '',
    '```bash',
    'npx ashiba feature generated-mapper check',
    '```',
    '',
    '## ashiba project check',
    '',
    'Run the project-level passive check gate for DDL diagnostics, contract drift, generated feature assets, SQL lint, and INSERT ownership.',
    '',
    '```bash',
    'npx ashiba project check',
    '```',
    '',
    '## ashiba check-contract',
    '',
    'Check visible SQL contracts before commit or release.',
    '',
    '```bash',
    'npx ashiba check-contract',
    '```',
    '',
    '## ashiba ddl migration generate',
    '',
    'Generate reviewable migration SQL from DDL file snapshots or DDL source directories.',
    '',
    '```bash',
    'npx ashiba ddl migration generate --from-dir old-ddl --to-dir db/ddl --out tmp/ddl/migration.sql',
    '```',
    '',
    '## ashiba lint',
    '',
    'Run SQL lint and DDL-aware checks over a SQL file or directory.',
    '',
    '```bash',
    'npx ashiba lint src/features',
    '```',
    '',
    '## ashiba query',
    '',
    'Inspect, visualize, or debug complex SQL.',
    '',
    '```bash',
    'npx ashiba query outline path/to/query.sql',
    'npx ashiba query graph path/to/query.sql',
    'npx ashiba query slice path/to/query.sql',
    '```',
    '',
    '## ashiba query uses',
    '',
    'Find SQL assets that reference a table or column.',
    '',
    '```bash',
    'npx ashiba query uses table users',
    'npx ashiba query uses column users.email',
    '```',
    '',
    '## ashiba query sssql',
    '',
    'Maintain SQL-first optional-condition metadata.',
    '',
    '```bash',
    'npx ashiba query sssql add path/to/query.sql --filter status',
    'npx ashiba query sssql refresh path/to/query.sql',
    'npx ashiba query sssql remove path/to/query.sql --parameter status',
    '```',
    '',
    '## ashiba model-gen',
    '',
    'Generate editable query contracts and generated metadata from a SQL file.',
    '',
    '```bash',
    'npx ashiba model-gen path/to/query.sql --out path/to/query.ts',
    '```',
    '',
    '## ashiba perf scenario',
    '',
    'Capture DB-backed performance evidence while keeping DB execution and tuning decisions application-owned.',
    '',
    '```bash',
    'npx ashiba perf scenario init --scenario users-list --query src/features/users-list/queries/list/list.sql',
    'npx ashiba perf scenario measure --scenario users-list --duration-ms 42',
    '```',
    '',
    '## ashiba rfba inspect',
    '',
    'Inspect review-first feature and query boundaries.',
    '',
    '```bash',
    'npx ashiba rfba inspect',
    '```',
    '',
  ].join('\n')}`, 'utf8');
  console.log('[postprocess-docs] Wrote api/commands.md');
}

async function wrapMarkdownWithVPre(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await wrapMarkdownWithVPre(fullPath);
      continue;
    }
    if (!entry.name.endsWith('.md')) {
      continue;
    }

    const original = await fs.readFile(fullPath, 'utf8');
    let frontMatter = '';
    let body = original;

    if (original.startsWith('---')) {
      const end = original.indexOf('\n---', 3);
      if (end !== -1) {
        frontMatter = original.slice(0, end + 4).trimEnd();
        body = original.slice(end + 4).replace(/^\s+/, '');
      }
    }

    const genericLineRE = /^(\s*[-*>+]?\s*)([^`\n<>]*?\b[A-Za-z0-9_$]+<[^>\n]+>[^`\n]*)$/gm;
    body = body.replace(genericLineRE, (match, prefix, content) => {
      const trimmed = content.trim();
      if (content.includes('`')) {
        return match;
      }
      return `${prefix}\`${trimmed}\``;
    });

    body = body.replace(/(?<=\b[A-Za-z0-9_$])<([^>\n]+)>/g, (_match, inner) => `&lt;${inner}&gt;`);
    body = body.replace(/\\<([^>\n]+)>/g, (_match, inner) => `&lt;${inner}&gt;`);

    const trimmedBody = body.trimStart();
    const hasWrapper = trimmedBody.startsWith('<div v-pre>') && trimmedBody.includes('</div>');

    if (hasWrapper) {
      const output = frontMatter ? `${frontMatter}\n\n${trimmedBody}\n` : `${trimmedBody}\n`;
      await fs.writeFile(fullPath, output, 'utf8');
      continue;
    }

    const wrappedBody = `<div v-pre>\n${body.trim()}\n</div>\n`;
    const output = frontMatter ? `${frontMatter}\n\n${wrappedBody}` : wrappedBody;
    await fs.writeFile(fullPath, output, 'utf8');
    console.log(`[postprocess-docs] Wrapped ${path.relative(dir, fullPath)} with <div v-pre> block`);
  }
}

main().catch((error) => {
  console.error('[postprocess-docs] Failed with error:', error);
  process.exitCode = 1;
});
