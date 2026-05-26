# Ashiba Migration Status

## Migrated Commands

- `ashiba init`
- `ashiba config`
- `ashiba-config`
- `ashiba ddl migration generate`
- `ashiba ddl migration info`
- `ashiba query uses table`
- `ashiba query uses column`
- `ashiba query match-observed`
- `ashiba query outline`
- `ashiba query graph`
- `ashiba query slice`
- `ashiba query plan`
- `ashiba query lint`
- `ashiba query patch apply`
- `ashiba query sssql list`
- `ashiba query sssql add`
- `ashiba query sssql refresh`
- `ashiba query sssql remove`
- `ashiba feature scaffold`
- `ashiba feature query scaffold`
- `ashiba feature query refresh`
- `ashiba feature tests scaffold`
- `ashiba feature generated-mapper check`
- `ashiba model-gen`
- `ashiba lint`
- `ashiba check-contract`
- `ashiba perf init`
- `ashiba perf run --dry-run`
- `ashiba perf report diff`
- `ashiba test-evidence collect`
- `ashiba test-evidence render`
- `ashiba test-evidence diff`
- `ashiba rfba inspect`
- `ashiba describe command`
- packaged `ashiba` and `ashiba-config` bin smoke with local tarball overrides
- workspace `pnpm verify` acceptance gate
- optional workspace `pnpm verify:postgres-live` PostgreSQL smoke gate

The current implementation provides `ashiba --help`, `ashiba --version`, `ashiba config`, `ashiba-config`, DDL migration generate/info commands, query impact commands, observed SQL matching, CTE structure/graph/slice/plan commands, query lint, SQL patch apply, SSSQL authoring helpers, feature/query/test scaffolds, generated mapper drift checks, SQL-file model generation, top-level lint and contract-check commands, lightweight performance lane planning and report diffing, lightweight test evidence collection/rendering/diffing, RFBA boundary inspection, command descriptors, and a SQL-first `ashiba init` starter for explicit feature scaffolding flows. The starter remains intentionally smaller than the full `ztd-cli` starter where that starter would imply AI behavior-file distribution or runtime ownership.

RFBA is adopted as an Ashiba concept. Scaffolding should separate files by reviewable feature/query behavior using VSA-style boundaries, not by technical layers such as repository/service/model as the primary layout. Because review scope is partly subjective, Ashiba fixes the concrete review grain through feature and query scaffolds. A feature may contain multiple query boundaries, and feature boundaries may be subgrouped under the feature root. Generated imports use root-stable aliases for shared seams and app-level test support so subgroup depth does not make scaffolds fragile.

Watch-mode automatic regeneration is intentionally not implemented. DDL-derived schema/model drift should be detected explicitly by tests or checks, with clear cause and next action, then repaired by an explicit command so file changes remain reviewable.

Ashiba tooling may depend on `rawsql-ts` core AST APIs through npm. This is accepted for CLI-side development workflows such as query analysis, sqlgrep, CTE planning, linting, patch helpers, SSSQL helpers, and migration review support. Generated application code remains Ashiba Runtime Zero and must not depend on Ashiba CLI/runtime libraries or `rawsql-ts` parser internals.

Dev-time SQL structural analysis is AST-first. The `rawsql-ts` AST parser is the trusted source for development-time SQL structure. Regex or hand-written lexical parsing that interprets SQL structure is treated as Ashiba AST migration debt, or as a reportable `rawsql-ts` parser/AST issue when valid SQL cannot be parsed, unless the code is limited to source offsets or explicit diagnostics. Ashiba should fail clearly or require explicit human-controlled fallback rather than silently repairing, rewriting, or reinterpreting SQL.

## Implemented Packages

- `@ashiba/driver-adapter-core`
- `@ashiba/driver-adapter-mssql`
- `@ashiba/driver-adapter-mysql2`
- `@ashiba/driver-adapter-pg`
- `@ashiba/ddl-pull-pg-dump`

`sqlgrep`, query analysis, DDL diff/risk, CLI error formatting, and dev-time named-parameter metadata generation are implemented as internal `@ashiba/cli` modules, not as separate packages in the current slice. The package-boundary rule is: development-time capabilities that only support the Runtime Zero workflow should be folded into the CLI unless a concrete non-CLI library consumer appears.

## Pending Commands

- none in the current explicit Ashiba status slice.

## Renamed Concepts

- Product: `ztd-cli` baseline -> `Ashiba`
- Package: `@rawsql-ts/ztd-cli` -> `@ashiba/cli`
- CLI command: `ztd` -> `ashiba`
- Config command: `ztd-config` -> `ashiba-config`

## Deferred Decisions

- none in the current explicit Ashiba status slice.

## Known Gaps

- `ashiba init` includes Ashiba config, Vitest config, explicit database test support, optional demo DDL, optional migration demo DDL, and library-owned generated test plan support. Feature/query boundary samples are created by explicit feature scaffold commands, not implicitly during init. It intentionally does not distribute AI behavior files from the historical starter.
- Feature scaffolding is implemented in Ashiba style with editable TypeScript, visible SQL, AST-derived `CREATE TABLE` metadata, generated query model metadata including optional-condition compression metadata, `ashiba.config.json` `ddl.sourceDir` support, and no generated Ashiba CLI/runtime dependency. It intentionally avoids generated runtime row validation. `ashiba feature query refresh` refreshes query model metadata after SQL-only edits without recreating the feature boundary.
- `ashiba feature generated-mapper check` currently checks SQL named parameters and SQL result columns, including CTE output select lists, aliases, supported expression type hints, and DDL-derived direct row type hints, against generated query boundary interfaces.
- `ashiba model-gen` currently generates editable named-parameter query contracts, Postgres precomputed binding metadata with source SQL hash, AST-derived query analysis snapshots, root query shape metadata, safe-sort insertion metadata, AST-derived sortable dictionaries, optional-condition compression metadata, AST-derived SQL result-column contracts from SELECT and RETURNING clauses, AST-derived DDL schema models from `CREATE TABLE`, and AST-derived DDL relation extraction for row type hints, including CTE output select lists, aliases, known SQL function type hints, RETURNING lists, SELECT-without-FROM aliases, ordinary SQL comments, Postgres dollar-quoted strings, and Postgres escape strings in select lists, FETCH/LIMIT/OFFSET/FOR insertion guards, `FOR UPDATE` safe-sort insertion metadata, obvious SQL literal types, SQL cast type hints, simple DDL-derived column type hints for direct table column references, nullable wrapper expression hints such as `coalesce`/`nullif`, CASE branch type hints, comparison/is-null boolean hints, DDL-derived arithmetic hints, string concatenation hints, and mutation-target DDL type hints for direct `RETURNING` columns. Historical live DB probing from `ztd-cli` is deferred as an explicit DB-dependent inspection workflow, not a hidden fallback in normal model generation.
- `ashiba lint` currently aggregates SQL structural lint over files/directories and adds AST-backed DDL-aware missing-table/missing-column checks for qualified reads, unqualified single-table SELECT/WHERE predicate references including simple right-hand column operands, GROUP BY/HAVING/ORDER BY references, INSERT columns, UPDATE SET columns, and direct mutation RETURNING columns when a DDL directory is available. Full database-semantic SQL validation remains a future explicit expansion.
- Dev-time AST-first audit is tracked in `docs/migration/dev-time-ast-first-audit.md`. Model generation now uses AST traversal for result columns, expression type hints, DDL schema metadata, DDL-derived relation extraction, and safe-sort sortable dictionaries. Feature scaffolding and DDL schema model generation identify `CREATE TABLE` statements through AST nodes rather than regex prefilters. DDL migration generation uses `rawsql-ts` `DDLDiffGenerator`, and DDL migration risk analysis uses rawsql-ts DDL AST statements for supported shapes. Remaining SQL source-offset helpers are tracked separately; if valid SQL cannot be parsed, treat that as a parser/AST bug to investigate or report, not as a silent fallback trigger.
- `ashiba check-contract` currently checks generated mapper drift plus QuerySpec-like catalog `sqlFile` resolution, named-parameter contracts, result-column contracts, result-column type contracts, generated query model source hash, AST parse status, statement kind, root query shape, top-level ORDER BY presence, named-parameter/result-column/result-type analysis freshness, safe-sort metadata freshness, and Postgres binding freshness. It also reports overall/mapper/catalog attainment and next actions for common drift repairs. Deeper QuerySpec coverage can be added when a concrete review consumer needs it.
- `ashiba perf` currently scaffolds and validates traditional performance lane plans, reports attainment/next actions for missing or unused benchmark parameters, and compares saved report durations with evidence completeness next actions without owning DB execution.
- `ashiba test-evidence collect` currently writes a test inventory, overall and per-lane done/partial/not done attainment, recommended mapper/performance test modes, todo-only test detection, result-file inventory, and next actions for missing or placeholder-only lanes; `ashiba test-evidence render` renders a collected summary as Markdown with attainment, next actions, and per-file executable/todo details; `ashiba test-evidence diff` compares collected summaries. Richer rawsql-ts evidence workflows remain, but the Ashiba review summary is now machine-readable.
- `ashiba rfba inspect` reports feature/query review boundaries, expected file existence, attainment, issues, and next actions. `ashiba describe command` covers the migrated Ashiba command surface. They are Ashiba-native review aids rather than full rawsql-ts descriptor/registry clones.
- `findings validate` is intentionally not migrated. Finding registries were a retrospective storage mechanism and a ConceptSpec predecessor; Ashiba should use Codex App past-log analysis to promote durable findings into ConceptSpec instead of keeping a separate findings registry feature.
- Production `pg` driver adapter has a thin implementation with `pg`-compatible contract tests for query delegation, required precomputed binding metadata, missing/stale query model rejection, parameter checks, query-model-gated safe sort rendering from source and compiled insertion metadata including `LIMIT` and `FOR UPDATE` guard positions, query-model sortable metadata as the maximum sort surface, root compound SELECT safe-sort rejection with subquery guidance, and logger-ready observer events for start/end/DB-error/pre-execution validation failures. Optional live PostgreSQL smoke exists and runs when `ASHIBA_TEST_DATABASE_URL` or `DATABASE_URL` is provided.
- Initial `mysql2` and `mssql` driver adapters exist as wrapper-specific packages. They support metadata-backed named-parameter binding, missing/unused parameter rejection, stale query-model rejection, and logger-ready observer events. Full MySQL and SQL Server starter templates remain future work.
- `pnpm verify:consumer-install` packs the local `@ashiba/*` package set, installs it into an isolated consumer project with tarball overrides, checks CLI bins, and imports the non-CLI packages.
- `pnpm verify` runs the local acceptance gate: workspace build, workspace tests, VitePress docs build, and isolated consumer install smoke.
- `pnpm verify:postgres-live` runs the optional PostgreSQL adapter live smoke. It uses `ASHIBA_TEST_DATABASE_URL` or `DATABASE_URL`; without one, the Vitest smoke is skipped.
- Transform extension migration, including scalar expansion, is explicitly deferred for the current migration pass.
- Human/AI error output modes have a CLI-internal formatter and CLI option. Both modes are now required to include cause plus next action/hint. The formatter supplies diagnostic fallbacks, and known production error paths in the current package set now use structured code/cause/nextAction metadata, including DDL diff, DDL pull, CLI parameter metadata, driver, safe-sort, and CLI validation paths; `packages/**/src` no longer uses plain `throw new Error`.
- Isolated consumer install smoke passes with local tarball overrides for the unpublished `@ashiba/*` package set. A registry-like smoke without overrides requires publishing the package set first.

## Decided Direction

- `ztd-config` is migrated as `ashiba-config`.
- `ashiba init` may create README/docs, but Ashiba must not distribute `AGENTS.md`, `AGENT.md`, `SKILL.md`, skills, prompts, or other AI behavior files. AI guidance should come from visible scaffolding, contracts, command descriptors, and AI-oriented errors.
- DDL watch auto-update is not migrated. Prefer explicit drift failures and actionable error messages over silent background regeneration.
- Public v1 query analysis should migrate the full `ztd-cli` query analysis command set.
- Unused named parameters are errors.
- PostgreSQL `ddl pull` through `pg_dump` is represented by the `@ashiba/ddl-pull-pg-dump` helper package. It is not an initial migration query generation responsibility and is not part of the `pg` driver adapter. The package name is intentionally capability-plus-wrapper specific because this package does not own MySQL or SQL Server pull behavior.
- Keep `sqlgrep` as the capability name and expose it through Ashiba query commands where useful.
- Transaction management is not an Ashiba responsibility. Scaffolded transaction-shaped feature code becomes editable application code.
- `rawsql-ts` core AST analysis can remain an npm dependency of Ashiba tooling packages; parser internals do not need to be ported into Ashiba.
- Dev-time SQL structure analysis should prefer `rawsql-ts` AST. Silent fallback from AST to regex/lexical interpretation is not accepted; Ashiba traversal gaps should be fixed, and unexpected `rawsql-ts` parse failures for valid SQL should be investigated or reported.
- Safe sort metadata shape is decided: source hash, root query shape, insertion position, order-by/comma mode, and sortable dictionary. Root compound SELECT safe sort is rejected from metadata with guidance to wrap the compound query in an explicit subquery.
- Historical live DB row/type probing from `ztd-cli` is not part of the current default model generation path. If adopted later, it should be explicit, DB-dependent, and should not silently replace AST/DDL-derived metadata.
- MySQL / SQL Server full starter templates and transform extension migration are deferred until after the current PostgreSQL-centered CLI migration pass.
