# ztd-cli to Ashiba Gap Analysis

## 1. Summary

`ztd-cli` already has many Ashiba foundations: DDL-first workflows, visible SQL files, feature and query scaffolding, generated mapper checks, test scaffolding, ZTD test support, migration review artifacts, query impact analysis, and SQL grep-style matching.

Ashiba is primarily a rebrand and extraction of that foundation into `@ashiba/cli`, with clearer Ashiba Runtime Zero positioning for CLI-generated application code and new package boundaries for driver adapters, SQL libraries, dialects, and future transforms.

The initial command migration, packaged consumer smoke, and PostgreSQL adapter contract surface now exist in Ashiba form. Remaining work is future expansion rather than a blocker for the current PostgreSQL-centered CLI slice: optional explicit DB-dependent row/type probing, deeper database-semantic validation, later MySQL and SQL Server adapters, and optional transform-extension migration.

## 2. Existing ztd-cli Strengths

- SQL-first CLI with `commander` command registration.
- Starter scaffolding with DDL, visible SQL, feature boundaries, query boundaries, and tests.
- DDL pull, diff, risk analysis, and review artifacts.
- Feature scaffold and additive query scaffold that preserve parent boundary ownership.
- Feature tests scaffold with ZTD and traditional lane concepts.
- Query usage, observed SQL matching, outline, graph, slice, plan, lint, and SSSQL commands.
- Model generation that preserves `QuerySpec` ids, SQL file metadata, named params, and output mapping.
- Named parameter binder in `packages/_shared/binder`.
- Node Postgres testkit adapter with named parameter support.
- CLI telemetry for commands, which is useful context but not the same as a production logger-ready driver event seam.

## 3. Capability Matrix

| Capability | Status | Notes |
|---|---|---|
| DDL-first workflow | mostly done | `ddl migration generate`, `ddl migration info`, `ashiba-config`, templates. `pg_dump`-based DDL pull exists in the baseline, but DB connection is outside Ashiba migration query generation scope. |
| SQL files as review boundary | mostly done | Feature/query scaffolds create visible `.sql` files. |
| Feature scaffold | mostly done | `feature scaffold` creates boundary, query, SQL, tests entrypoint. |
| Query boundary scaffold | mostly done | `feature query scaffold` adds child query boundaries without rewriting parent boundary. |
| Generated row mapper | mostly done | Present through scaffold/model generation and query boundary contracts. SQL/DDL-derived result typing covers aliases, CTE output select lists, known function hints, literals, casts, direct DDL column hints, nullable wrappers, CASE branches, comparison/is-null booleans, arithmetic, string concatenation, and mutation `RETURNING`; historical live probing is future explicit DB-dependent work, not a default fallback. |
| Generated mapper drift check | mostly done | `feature generated-mapper check` checks named parameters and result columns, including aliases, CTE output select lists, and supported SQL/DDL-derived type hints, against editable query boundary interfaces. |
| Feature tests scaffold | mostly done | `feature tests scaffold` refreshes generated plans/types and preserves cases. |
| ZTD test lane | mostly done | Strong baseline; Ashiba should keep ZTD as a test technique, not product identity. Mapper tests should prefer this lane. |
| Traditional DB-backed test lane | mostly done | Supported as a scaffold lane concept with `ashiba perf` plan inspection, report diffing, evidence completeness checks, and `test-evidence` lane reporting. DB lifecycle and execution remain application-owned by concept. |
| DDL pull | PostgreSQL `pg_dump` helper | `@ashiba/ddl-pull-pg-dump` provides PostgreSQL `pg_dump` command construction, redacted command preview, and explicit pull execution helpers. It avoids a generic DDL pull name because it does not own MySQL or SQL Server pull behavior. It remains an extension helper because core migration query generation compares explicit DDL inputs without DB connection. It is not part of the `pg` driver adapter because it depends on external DBMS tooling, not the TypeScript driver API. |
| DDL diff | mostly done | Review-oriented artifacts are produced. |
| DDL risk analysis | mostly done | `ddl migration info` and migration risk analysis. |
| Migration artifact review | mostly done | Diff output includes SQL and companion review artifacts. |
| Query uses table | mostly done | `query uses table`. |
| Query uses column | mostly done | `query uses column`. |
| Observed SQL matching | mostly done | `query match-observed` is integrated into `@ashiba/cli` and uses `rawsql-ts` core AST APIs. |
| model-gen QuerySpec output | mostly done | `model-gen` handles SQL scan, named parameters, Postgres binding metadata with source SQL hash, query ID derivation, output rendering, query analysis snapshots, root query shape, safe-sort metadata, and result-column/type contracts. Live DB probing is deferred unless an explicit DB-dependent inspection workflow is requested. |
| sqlgrep naming | decided | Keep `sqlgrep` as the capability name and expose it through Ashiba query commands where useful. |
| driver-adapter-core | initial implementation | `@ashiba/driver-adapter-core` now provides shared event, masking, error, and safe sort contracts. |
| shared-binder named parameters | mostly done | The historical shared binder is integrated into `@ashiba/cli` for dev-time named-parameter metadata generation. `model-gen` emits precomputed Postgres binding metadata, including compiled safe-sort insertion offsets, so runtime adapters can avoid rescanning and reject missing or stale metadata. |
| Parameter contract check | initial implementation | Missing and unused params fail in the PostgreSQL adapter when runtime values are mapped from CLI-generated `orderedNames`. |
| Safe sort profile | mostly done | `@ashiba/driver-adapter-core` validates whitelisted ORDER BY fragments; `@ashiba/driver-adapter-pg` validates query model analysis and source SQL hash, then renders safe sort using CLI-generated root query shape, insertion metadata, and sortable dictionary. Root compound SELECT safe sort is rejected with subquery guidance. |
| Logger-ready production execution event | mostly done | `@ashiba/driver-adapter-pg` emits masked start/end/error observer events, including pre-execution validation failures and optional unmasked params. |
| ZTD SQL trace | mostly done | Test/debug trace exists in docs and test flow; not production logging. |

## 4. Ashiba Concept Fit

`ztd-cli` fits Ashiba well because it already treats SQL and DDL as review boundaries. Its generated assets are meant to be inspected, and its test workflow moves safety into development-time checks.

The product concept needs clearer boundaries:

- Ashiba Runtime Zero means no Ashiba CLI/runtime library is required by CLI-generated application code.
- Driver adapters and extension packages may have runtime dependencies.
- Thin driver adapters are allowed.
- ZTD remains a testing technique only.
- Generated code is visible, editable, and drift-detectable.

## 5. Missing Pieces

- Later MySQL and SQL Server driver adapters.
- Full semantic SQL validation beyond the current structural and DDL-aware checks, which now include qualified reads, single-table unqualified predicate operands, grouping/ordering references, mutation columns, and direct returning columns.
- Optional explicit DB-dependent row/type probing from the historical `ztd-cli` workflow.
- Optional richer rawsql-ts evidence workflow parity if a concrete Ashiba reviewer need appears.
- Transform extension migration, including scalar expansion, after the PostgreSQL-centered CLI migration pass.

## 6. Rename Needs

| Current | Target | Notes |
|---|---|---|
| `@rawsql-ts/ztd-cli` | `@ashiba/cli` | Product package rename. |
| `ztd` bin | `ashiba` | CLI command rename. |
| Product-level ZTD wording | Ashiba | Keep ZTD only for Zero Table Dependency testing. |
| `@rawsql-ts/shared-binder` | `@ashiba/cli` internal parameter metadata | Development-time metadata generation. Runtime adapters map values from precomputed metadata instead of exposing a standalone SQL binder package. |
| `@rawsql-ts/adapter-node-pg` testkit usage | `@ashiba/testkit-adapter-pg` or production adapter split | Current package is testkit-oriented, not the production driver adapter target. |
| `@rawsql-ts/sql-grep-core` | `@ashiba/cli` internal `sqlgrep` capability | Keep `sqlgrep` as the capability name. Do not split it into a package unless an external library consumer appears. |

## 7. Migration Risks

- Renaming all `ztd` terminology at once could break a working baseline.
- Keeping `ztd` product naming would weaken the Ashiba identity.
- Treating CLI telemetry as production logging would overclaim the current implementation.
- Reusing testkit adapters as production driver adapters could blur runtime boundaries.
- Hidden migration apply behavior must not be added.
- DDL pull must not be confused with core migration query generation or PostgreSQL driver adapter behavior because it depends on live DB/schema-pull behavior and external DBMS tooling such as `pg_dump`.
- Generated file ownership must remain clear to avoid overwriting human-authored cases.

## 8. Recommended Migration Order

1. ConceptSpec and inventory.
2. Package naming policy.
3. Gap analysis and issue plan.
4. Establish `@ashiba/cli` package identity and command entrypoints.
5. Migrate command framework behavior.
6. Migrate DDL and migration commands.
7. Migrate feature/query scaffolding.
8. Migrate test scaffolding and drift detection.
9. Migrate query impact analysis and sqlgrep-style commands into `@ashiba/cli`.
10. Add package consumer install verification.
11. Add optional live PostgreSQL smoke when `ASHIBA_TEST_DATABASE_URL` or `DATABASE_URL` is provided.
12. Transform package plans and selected command naming.
13. MySQL and SQL Server adapter planning.

## 9. Issues to Create

Use the ordered issues in `docs/issues/implementation-plan.md`. The first coding issue should not start until the concept, inventory, gap analysis, naming policy, migration plan, driver adapter plan, and transform plan exist.

## Inspected Files and Paths

- `packages/ztd-cli/package.json`
- `packages/ztd-cli/README.md`
- `packages/ztd-cli/src/index.ts`
- `packages/ztd-cli/src/commands/init.ts`
- `packages/ztd-cli/src/commands/feature.ts`
- `packages/ztd-cli/src/commands/featureTests.ts`
- `packages/ztd-cli/src/commands/modelGen.ts`
- `packages/ztd-cli/src/commands/query.ts`
- `packages/ztd-cli/src/commands/ddl.ts`
- `packages/ztd-cli/src/commands/ztdConfigCommand.ts`
- `packages/ztd-cli/templates`
- `packages/_shared/binder`
- `packages/_shared/binder/src/compileNamedParameters.ts`
- `packages/adapters/adapter-node-pg`
- `packages/adapters/adapter-node-pg/src/types.ts`
- `packages/adapters/adapter-node-pg/src/driver/PgTestkitClient.ts`

`packages/drivers/driver-adapter-core` was requested for inspection, but it was not present in the local `rawsql-ts` checkout. Ashiba now has an initial `@ashiba/driver-adapter-core` package created from the documented binder and adapter boundary.
