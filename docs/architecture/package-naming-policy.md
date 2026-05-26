# Ashiba Package Naming Policy

## Product Identity

- Product name: `Ashiba`
- CLI package: `@ashiba/cli`
- CLI command: `ashiba`

Do not use `sql-ashiba`.

## CLI Package

Use:

```txt
@ashiba/cli
```

The CLI bin must be:

```txt
ashiba
```

## Production Driver Adapters

Use:

```txt
@ashiba/driver-adapter-*
```

These packages are thin wrappers over existing database drivers. Do not call them simply drivers unless Ashiba actually implements a database driver.

Reserved names:

- `@ashiba/driver-adapter-core`
- `@ashiba/driver-adapter-pg`
- `@ashiba/driver-adapter-postgres-js`
- `@ashiba/driver-adapter-mysql2`
- `@ashiba/driver-adapter-mssql`

Driver adapter package names must identify the wrapped driver library, not only the database family. This keeps room for multiple adapters for the same DBMS, such as `pg` and `postgres.js` for PostgreSQL. Use the package name that callers install, such as `@ashiba/driver-adapter-pg` for the `pg` npm package.

## Testkit Adapters

Use:

```txt
@ashiba/testkit-adapter-*
```

Reserved names:

- `@ashiba/testkit-adapter-pg`
- `@ashiba/testkit-adapter-mysql2`
- `@ashiba/testkit-adapter-mssql`

Testkit adapters are not production driver adapters.

Testkit adapter package names must identify the wrapped driver library or driver-family adapter target in the same style as production driver adapters. Use `pg`, `mysql2`, and `mssql` rather than generic DBMS labels when the implementation is tied to those driver ecosystems.

## Driver-Neutral SQL Libraries

Use:

```txt
@ashiba/sql-*
```

Reserved names:

- `@ashiba/sql-impact`
- `@ashiba/sql-migration`
- `@ashiba/ddl-pull-pg-dump`
- `@ashiba/sql-transform-pipeline`
- `@ashiba/sql-transform-scalar`

Do not create separate packages such as `@ashiba/sql-grep-core`, `@ashiba/sql-binder`, `@ashiba/sql-ddl-diff`, or `@ashiba/error-format` for the current Ashiba slice. If a capability is used only during development and supports the Runtime Zero generated-code workflow, prefer integrating it into `@ashiba/cli` instead of creating a fine-grained package. `sqlgrep`, DDL diff/risk, CLI error formatting, and dev-time named-parameter metadata generation are representative cases unless an external library consumer appears.

SQL analysis code may depend on `rawsql-ts` core for AST parsing when the CLI performs structural SQL analysis. This is an Ashiba tooling dependency, not a generated application code dependency.

## Dialect Packages

Use:

```txt
@ashiba/dialect-*
```

Reserved names:

- `@ashiba/dialect-postgres`
- `@ashiba/dialect-mysql`
- `@ashiba/dialect-sqlserver`

Dialect packages may contain placeholder style, identifier quoting, limit/offset syntax, returning support, migration diff rules, and sort expression rules.

## Extension Packages

Use only when a plugin mechanism exists:

```txt
@ashiba/extension-*
```

Reserved future names:

- `@ashiba/extension-pipeline`
- `@ashiba/extension-scalar`

Do not create plugin-style extension packages yet if ordinary SQL libraries are enough. Wrapper package names must include both the Ashiba capability and the wrapped tool or library. PostgreSQL `pg_dump`-based schema pull should use an explicit package name such as `@ashiba/ddl-pull-pg-dump`; `ddl-pull` names the capability and `pg-dump` names the wrapped executable. Moving it under `@ashiba/extension-*` can wait until a plugin mechanism exists.

Avoid generic names such as `@ashiba/sql-ddl-pull` unless the package is designed to own DDL pull behavior across supported database families such as PostgreSQL, MySQL, and SQL Server.

DDL pull must not be placed in `@ashiba/driver-adapter-pg`. It depends on live database access and external DBMS tooling such as `pg_dump`, not on the TypeScript driver adapter contract.

## Driver Adapter Responsibilities

Driver adapters may handle parameter value mapping from CLI-generated metadata, parameter contract checks, safe sort profiles, logger-ready structured execution events, and row result normalization. They should not expose a runtime SQL-scanning binder API.

Driver adapters must not handle business SQL generation, ORM entities, query DSL ownership, relation magic, or runtime model tracking.

## Transform Package Responsibilities

`@ashiba/sql-transform-pipeline` owns CTE structure analysis, query pipeline plans, materialization plans, debuggable SQL slices, and safe expansion from SQL-first source.

`@ashiba/sql-transform-scalar` is planned for migration from the `rawsql-ts` / `ztd-cli` SSSQL optional-condition tooling.

Safe sort is not a transform package. The whitelisted sort profile belongs to the DB driver wrapper boundary and must be gated by explicit query model analysis rather than Ashiba-only SQL markers. ORDER BY insertion uses CLI-generated safe insertion metadata: insertion position, order-by/comma mode, and sortable dictionary. Driver runtime AST parsing is not part of the design; unsupported shapes should fail with guidance instead.
