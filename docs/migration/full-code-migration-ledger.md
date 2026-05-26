# Ashiba Full Code Migration Ledger

## Goal

Migrate the useful implementation surface from `rawsql-ts/packages/ztd-cli` into Ashiba packages and CLI commands while preserving Ashiba's product boundaries:

- `@ashiba/cli` owns Runtime Zero scaffolding and analysis workflows.
- Driver adapters may have runtime dependencies and own runtime database execution concerns.
- Extensions own optional capabilities such as schema pull and scalar SQL transforms.
- Ashiba tooling packages may depend on `rawsql-ts` core AST APIs through npm.
- Generated application code must remain visible, editable, and drift-checkable.

## Acceptance Criteria

- ztd-cli command families are either migrated, intentionally renamed, or explicitly recorded as out of scope.
- Migrated commands use Ashiba names, config wording, and error output modes.
- Human-oriented and AI-oriented error output both include cause and next action/hint. Generic fallback guidance is allowed only as a temporary safety net; package-specific errors should carry precise structured cause/action metadata.
- Runtime database execution remains in driver adapters, not in the core CLI.
- SQL AST parser internals are reused from `rawsql-ts` core instead of being fully ported or forked into Ashiba.
- Dev-time SQL structural analysis prefers `rawsql-ts` AST traversal. Regex or lexical SQL interpretation is treated as Ashiba AST migration debt, or as a reportable `rawsql-ts` parser/AST issue when valid SQL cannot be parsed, unless it is source-offset support or explicit diagnostics.
- AST-to-regex fallback that can change generated metadata, lint results, drift results, or execution metadata must be explicit and human-controlled, not silent.
- DDL pull remains an extension-facing capability because it depends on DBMS tooling such as `pg_dump`.
- Repository checks pass: `pnpm build`, `pnpm test`, and `pnpm docs:build`.
- Packaged CLI bins run from an isolated consumer install when the unpublished local `@ashiba/*` package set is provided as tarball overrides.
- The combined acceptance gate `pnpm verify` runs build, tests, VitePress docs build, and isolated consumer install smoke.
- Optional live PostgreSQL smoke is exposed as `pnpm verify:postgres-live` and runs when `ASHIBA_TEST_DATABASE_URL` or `DATABASE_URL` is provided.

## Migration Inventory

| Source family | Ashiba target | Status | Notes |
| --- | --- | --- | --- |
| `init` | `@ashiba/cli init` | done | Ashiba starter implemented with config, explicit DB test support, optional demo DDL, optional migration demo DDL, explicit feature scaffold flow, and no AI behavior-file distribution. |
| `ztd config` | `ashiba config`, `ashiba-config` | done | Renamed to Ashiba config. |
| PostgreSQL DDL pull | `@ashiba/ddl-pull-pg-dump` | done | `pg_dump` helper package, not a generic DDL pull package and not a driver adapter. |
| DDL risk / diff contracts | `@ashiba/cli` internal modules | done | Pure DDL comparison and risk contracts migrated on top of `rawsql-ts` DDL AST APIs and `DDLDiffGenerator`. Kept inside the CLI because migration query generation is a CLI responsibility in the current slice. |
| DDL CLI commands | `ashiba ddl migration generate`, `ashiba ddl migration info` | done | Compare two DDL snapshots through `rawsql-ts` DDL diff generation and report hand-edited migration SQL risk from rawsql-ts DDL AST statements without DB connection responsibility. Pre-release short aliases were removed; the public surface uses the migration command names directly. |
| Query analysis / sqlgrep | `@ashiba/cli` internal modules, `ashiba query ...` | done | Uses, observed SQL matching, outline, graph, slice, plan, lint, patch, and SSSQL helpers migrated while reusing `rawsql-ts` core AST APIs. Kept inside the CLI because there is no separate library consumer yet. |
| Feature scaffolding | `ashiba feature ...` | done | Feature, additive query, and mapper test scaffolds implemented with editable Runtime Zero application code, visible SQL, AST-derived `CREATE TABLE` metadata with AST-based statement recognition, generated ZTD cases for deterministic scaffold paths, and `ashiba.config.json` `ddl.sourceDir` support. |
| Generated mapper drift check | `ashiba feature generated-mapper check` | mostly done | SQL named parameters and SQL result columns are checked against editable query boundary interfaces. CTE output select lists, aliases, known SQL function type hints, obvious SQL literal types, SQL cast type hints, simple DDL-derived direct column types, nullable wrapper expressions such as `coalesce`/`nullif`, CASE branch type hints, comparison/is-null boolean hints, DDL-derived arithmetic hints, string concatenation hints, and mutation-target direct `RETURNING` types are covered. DB probing is not required for the current Ashiba CLI slice; add it later only as an explicit DB-dependent inspection workflow. |
| Model generation | `ashiba model-gen ...` | mostly done | SQL-file named-parameter contract generation, Postgres binding metadata with source SQL hash, query analysis snapshots, safe-sort insertion metadata plus AST-derived sortable dictionaries, optional-condition compression metadata, AST-derived SQL result-column inference, AST-derived DDL schema models, and AST-derived DDL relation extraction are implemented, including CTE output select lists, aliases, known SQL function type hints, RETURNING lists, SELECT-without-FROM aliases, ordinary SQL comments, Postgres dollar-quoted strings, and Postgres escape strings in select lists, FETCH/LIMIT/OFFSET/FOR insertion guards, `FOR UPDATE` safe-sort insertion metadata, obvious SQL literal types, SQL cast type hints, simple DDL-derived direct column type hints, nullable wrapper expression hints such as `coalesce`/`nullif`, CASE branch type hints, comparison/is-null boolean hints, DDL-derived arithmetic hints, string concatenation hints, and mutation-target DDL type hints for direct `RETURNING` columns. Historical live probing is deferred as an explicit DB-dependent option, not a hidden model-gen fallback. |
| Lint / contract checks | `ashiba lint`, `ashiba check-contract` | mostly done | Top-level SQL lint aggregation, AST-backed DDL-aware missing-table/missing-column checks for qualified reads, unqualified single-table SELECT/WHERE predicate references including simple right-hand column operands, GROUP BY/HAVING/ORDER BY references, INSERT columns, UPDATE SET columns, and direct mutation RETURNING columns, generated mapper named-parameter plus result-column contract checks, QuerySpec-like `sqlFile`/named-parameter/result-column/result-column-type checks, query model source hash, AST parse status, statement kind, root query shape, top-level ORDER BY presence, named-parameter/result-column/result-type analysis freshness, safe-sort metadata freshness, Postgres binding freshness checks, contract-check attainment, and next-action reporting are implemented. Full database-semantic validation remains a future opt-in expansion rather than a current CLI blocker. |
| Test evidence | `ashiba test-evidence ...` | mostly done | Test inventory, mapper/performance lane status, overall and per-lane done/partial/not done attainment, recommended modes, todo-only placeholder detection, result-file inventory, missing/placeholder lane next actions, Markdown render with next actions plus per-file executable/todo details, and summary diff implemented. Richer rawsql-ts evidence workflows may still be ported if needed. |
| Performance helpers | `ashiba perf ...` | mostly done | Perf scaffold, dry-run query parameter plan with attainment/next actions, and saved duration report diff with evidence completeness checks implemented for the traditional DB-backed lane. DB lifecycle/execution remains application-owned. |
| RFBA / describe | `ashiba rfba`, `describe` | mostly done | Ashiba boundary inspection reports feature/query review boundaries, file existence, attainment, issues, and next actions. Command descriptors cover the migrated Ashiba command surface. Full rawsql-ts metadata catalog parity remains out of the current Ashiba slice unless a concrete consumer appears. |
| Safe sort and driver event support | `@ashiba/driver-adapter-core`, `@ashiba/driver-adapter-pg`, `@ashiba/driver-adapter-mysql2`, `@ashiba/driver-adapter-mssql` | mostly done | Whitelisted sort profile validation exists. Runtime AST parsing and Ashiba-only SQL markers are intentionally avoided. The `pg` adapter validates query model hash and renders safe sort using CLI-generated insertion metadata and sortable dictionaries, including insertion before `LIMIT` and `FOR UPDATE`. Query model sortable metadata is treated as the maximum sort surface; runtime sort profiles cannot replace recorded SQL expressions. Root compound SELECT shape is carried in query model metadata and rejected with subquery guidance. Initial `mysql2` and `mssql` adapters cover metadata-backed named-parameter binding, parameter contract checks, stale metadata rejection, and logger-ready observer events; safe sort and SSSQL compression are not yet expanded beyond the `pg` adapter. |
| Historical live row/type probing | optional future DB-dependent workflow | deferred | The `ztd-cli` baseline could inspect PostgreSQL result metadata through a live or ZTD-owned connection. Ashiba's current CLI path uses visible SQL, DDL metadata, and AST-derived query models instead. If this is needed later, it should be explicit, DB-dependent, and separate from silent model-gen fallback behavior. |
| Findings registry | none | out of scope | Finding registries were a retrospective storage mechanism and ConceptSpec predecessor. Ashiba drops the CLI feature in favor of analyzing past logs and promoting durable lessons into ConceptSpec. |

## Now

Completed the drift/model/perf evidence hardening slice: result-column drift, model-gen result columns, CTE/alias/function result-column extraction, DDL-aware lint for missing table/column references, QuerySpec-like catalog contract checks, perf report diff, contract-check result-column reporting, and stronger test evidence lane reporting with todo-only detection and result-file inventory are now implemented.
Also fixed packaged bin entrypoint detection and added a clean CLI prebuild so removed commands such as `findings` do not leak into tarballs through stale `dist` files. Added `pnpm verify:consumer-install`, which packs the local `@ashiba/*` package set, installs it into an isolated consumer project with local tarball overrides, checks `ashiba --version`, `ashiba --help`, `ashiba-config --compact`, and imports the non-CLI packages.
Added query model metadata for runtime-light driver behavior: source SQL hash, Postgres precomputed named-parameter binding, compiled SQL insertion offsets for metadata-composed safe sort, AST-derived statement metadata, root query shape, safe-sort insertion metadata, AST-derived sortable dictionaries, and AST-derived result-column contracts. The PostgreSQL adapter requires precomputed binding metadata, rejects missing or stale metadata before execution, performs bounded safe-sort splices from reviewed source and compiled metadata, rejects root compound SELECT safe sort with guidance to use an explicit subquery, and emits logger-ready error events even when validation fails before DB execution. Safe-sort metadata uses AST select items for sortable columns while keeping source-offset helpers only for insertion positions, so comments or quoted string bodies containing commas, semicolons, placeholders, or keywords do not require Ashiba-only notation.
Added `pnpm verify` as the combined local acceptance gate for build, unit/contract tests, docs build, and tarball-based consumer install smoke.
Added `pnpm verify:postgres-live` as an explicit optional live PostgreSQL smoke gate. It is intentionally separate from `pnpm verify` because it requires external database state.

## Next

The current PostgreSQL-centered CLI migration slice is implemented and verified locally. Future expansion should be opened as explicit follow-up work: optional DB-dependent row/type probing, deeper database-semantic validation, richer evidence workflows when a concrete reviewer need appears, broader safe-sort support for new SQL shapes, MySQL / SQL Server adapters, and transform extension migration. Deeper validation should be added only where it can be derived from visible SQL, DDL metadata, reviewed query-model metadata, or an explicitly requested DB-dependent workflow without hidden runtime parsing.

### Error-Surface Audit Task

Status: done for known production error paths in the current migrated package set.

Requirement: every user-facing or agent-facing Ashiba error must be available in human and AI output modes, and both modes must carry cause plus next action/hint. Generic formatter fallbacks prevent empty output, but they are not the desired final quality for known Ashiba error paths.

Current aligned areas:

- CLI-internal error formatting handles human and AI modes and now fills missing cause/nextAction with diagnostic fallbacks.
- CLI entrypoints route uncaught command errors through `formatAshibaError`.
- Commander argument errors and missing-file errors have specific cause and next-action normalization.
- `AshibaParameterError`, `AshibaSortError`, `AshibaPostgresQueryModelError`, `AshibaDdlDiffError`, and `AshibaDdlPullError` now expose structured cause/nextAction metadata that CLI formatting and driver observer normalization can carry.
- CLI command validation, sqlgrep/query-analysis validation, DDL/schema-model AST parse failures, and CLI-internal DDL diff/risk AST parse failures now throw structured errors with stable codes, cause, nextAction, and details where useful.
- Production `packages/**/src` no longer uses plain `throw new Error`; remaining `new Error` usage is limited to tests, external DB-error simulation, and formatter fallback tests.

Follow-up work:

- Keep this as a review gate for future packages: new user-facing or agent-facing errors should use structured code/cause/nextAction rather than relying on formatter fallbacks.
- Add more per-command human/AI output assertions as new command error paths are added or promoted to public API.

## Blockers

None for the current PostgreSQL-centered CLI migration slice. Safe sort has a metadata-based implementation; broader SQL shape support should be added through tests before acceptance is widened.

## Human Decisions Required

None for the current slice. The adopted safe-sort metadata shape is source hash, root query shape, insertion position, order-by/comma mode, and sortable dictionary. Future decisions may be needed only for complex SQL shapes that cannot be represented safely with this metadata.

## Evidence Ready?

done for the current PostgreSQL-centered CLI migration slice after the local acceptance gate passes. Deferred future packages remain outside this slice.
