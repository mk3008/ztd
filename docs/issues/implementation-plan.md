# Ashiba Implementation Issue Plan

## 1. Define Ashiba Product Concept and README Skeleton

### Scope

- Create initial README.
- Add catchphrase.
- Define Concept, Features, Getting Started, Commands, Use Cases, Why Ashiba, Status, and Roadmap.
- Keep H1 very short, H2 as major sections, and H3 as short concept statements.

### Acceptance Criteria

- README starts with `# Show me the SQL.`
- README includes `Ashiba handles the boring parts.`
- README says `No ORM runtime`.
- README says `Thin driver adapter`.
- README lists DTO definitions, mappers, query ID numbering, tests, migrations, sqlgrep, and impact analysis.
- README says generated code is visible, editable, and meant to grow.
- README says Ashiba Runtime Zero applies to `@ashiba/cli` generated application code, while driver adapters and extensions may have runtime dependencies.
- README says ORM-like development support is provided through scaffolding and checks, not runtime ORM behavior.

## 2. Create @ashiba/cli Package Skeleton

### Scope

- Create `@ashiba/cli` package.
- Create `ashiba` bin.
- Copy minimum package scaffolding.
- Keep tests runnable.
- Do not publish.

### Acceptance Criteria

- `package.json` name is `@ashiba/cli`.
- bin is `ashiba`.
- build command exists.
- test command exists.
- local pack works.

## 3. Migrate ztd-cli Command Framework

### Scope

- Move command registration framework.
- Rename `ztd` command name to `ashiba`.
- Preserve JSON output behavior if useful.
- Avoid broad behavior rewrite.

### Acceptance Criteria

- `ashiba --help` works.
- Migrated commands are listed.
- ztd-specific command names are identified.

## 4. Migrate DDL and Migration Support

### Scope

- Migrate DDL diff support from the `ztd-cli` baseline.
- Migrate DDL risk/info support from the `ztd-cli` baseline.
- Preserve migration artifacts for review.
- Generate migration DDL and risk info from two DDL inputs.
- Do not make DB connection or migration apply part of CLI responsibility.
- Do not add hidden apply behavior.

### Acceptance Criteria

- `ashiba ddl migration generate` works from explicit DDL inputs.
- `ashiba ddl migration generate` works from explicit DDL inputs.
- `ashiba ddl migration info` reports risk from explicit DDL inputs.
- Migration artifacts are reviewable.
- Two DDL inputs can produce reviewable migration DDL and risk info.
- DB connection is not required for migration query generation.

## 5. Migrate Feature and Query Scaffolding

### Scope

- Migrate `feature scaffold`.
- Migrate `feature query scaffold`.
- Migrate generated row mapper output.
- Preserve visible SQL file layout.

### Acceptance Criteria

- Feature boundary is created.
- Query boundary is created.
- SQL file is created.
- Generated row mapper is created.
- Parent boundary is not silently rewritten.

## 6. Migrate Test Scaffolding and Drift Detection

### Scope

- Migrate `feature tests scaffold`.
- Migrate ZTD and traditional lanes as appropriate.
- Recommend ZTD for mapper tests.
- Recommend traditional DB-backed tests for performance tests.
- Migrate generated mapper check.
- Emphasize unit tests as safety mechanism.

### Acceptance Criteria

- Test plan is generated.
- Analysis JSON is generated.
- Type file is generated.
- Vitest entrypoint is generated.
- Mapper test lane defaults to or recommends ZTD.
- Performance test lane defaults to or recommends traditional DB-backed tests.
- Persistent test cases are not overwritten.
- Generated mapper drift fails check.

## 7. Migrate Query Impact Analysis and sqlgrep

### Scope

- Migrate `query uses table`.
- Migrate `query uses column`.
- Migrate observed SQL matching.
- Keep `sqlgrep` as the capability name.
- Preserve JSON output.

### Acceptance Criteria

- Table usage can be found.
- Column usage can be found.
- Observed SQL can be matched.
- Human and AI review can consume output.

## 8. Migrate or Redesign Driver Adapter Story

### Scope

- Create or migrate `@ashiba/driver-adapter-core`.
- Integrate shared binder behavior into `@ashiba/cli` parameter metadata generation.
- Preserve named parameter compilation for query-model metadata.
- Design logger-ready observer seam.
- Design safe sort profiles.
- Do not make transaction management an Ashiba responsibility.

### Acceptance Criteria

- Named parameters compile to driver placeholders.
- Ordered parameter names are available.
- Missing parameter errors are preserved.
- Unused parameter errors are enforced.
- No ORM runtime is introduced.
- Transaction management remains application-owned.
- Logger-ready seam is designed.
- Parameter masking policy is documented.
- Safe sort profile requirement is documented.

## 9. Rename ztd-specific Terminology

### Scope

- Identify product-level ztd terminology.
- Identify test-technique ZTD terminology.
- Rename product-level ztd to Ashiba.
- Keep ZTD only if it still means Zero Table Dependency testing.
- Rename `ztd-config` to `ashiba-config`.

### Acceptance Criteria

- Rename map exists.
- Keep map exists.
- Command rename map exists.
- Docs terminology map exists.
- `ashiba-config` is used as the config command name.

## 10. Add Migration Verification

### Scope

- Ensure `@ashiba/cli` builds, tests, and packs.
- Create consumer install smoke test.
- Keep `ztd-cli` working until replacement is verified.

### Acceptance Criteria

- Local build passes.
- Tests pass.
- Package pack works.
- Isolated consumer install works.
- No monorepo-only path leaks.

## 11. Define Package Naming Policy

### Scope

- Document naming rules for CLI, driver adapters, testkit adapters, SQL libraries, dialects, and extensions.
- Reserve transform package names.

### Acceptance Criteria

- `@ashiba/cli` is defined.
- `@ashiba/driver-adapter-*` is defined.
- `@ashiba/testkit-adapter-*` is defined.
- `@ashiba/sql-*` is defined.
- `@ashiba/dialect-*` is defined.
- `@ashiba/extension-*` is reserved only for plugin packages.
- DDL pull extension package placement is documented.
- DDL pull is explicitly outside `@ashiba/driver-adapter-pg`.

## 12. Create First Driver Adapter

### Scope

- Create first production driver adapter for `pg`.
- Use `@ashiba/driver-adapter-pg`.
- Keep PostgreSQL as the initial DB target.
- Keep MySQL and SQL Server as future DB targets.
- Reuse `@ashiba/driver-adapter-core`.
- Preserve named parameter compilation.
- Add parameter contract checks.
- Add logger-ready event seam if core supports it.

### Acceptance Criteria

- `pg` Pool or Client can be adapted.
- `:name` parameters compile to `$1`, `$2`.
- Ordered parameter names are exposed.
- Missing params fail before execution.
- Unused params fail before execution.
- Logger observer can receive structured events if enabled.
- No logger dependency is introduced.
- DDL pull is not included in the PostgreSQL driver adapter.

## 13. Design Transform Expansion Packages

### Scope

- Document pipeline expansion.
- Document scalar expansion.
- Keep safe sort profile design under driver adapter scope, not transform package scope.
- Decide what is implemented now and what is reserved.
- Treat pipeline and scalar expansion as extension capabilities outside the core CLI Runtime Zero path.

### Acceptance Criteria

- `@ashiba/sql-transform-pipeline` is reserved.
- `@ashiba/sql-transform-scalar` is planned for migration from `rawsql-ts` / `ztd-cli` SSSQL tooling.
- `@ashiba/sql-transform-sort` is not planned because safe sort is a DB driver wrapper responsibility.
- Plugin extension packages are not created prematurely.
