---
title: SSSQL Notation
---

# SSSQL Notation

SSSQL notation is Ashiba's name for optional-search SQL that stays valid SQL.

Use the name when you want to ask a human or AI to write an optional condition without explaining the full predicate shape every time.

```sql
where (:email is null or u.email = :email)
```

That condition means:

- when `:email` is provided, filter by `u.email = :email`
- when `:email` is `null`, keep the condition harmless
- keep the SQL readable, reviewable, and runnable in a SQL client

Ashiba keeps this as plain SQL. There is no hidden query DSL and no runtime-only condition builder.

## How To Ask For It

For AI-assisted work, prefer a short instruction like this:

```text
Add an email filter using Ashiba SSSQL notation.
```

The intended output is ordinary SQL:

```sql
where (:email is null or u.email = :email)
```

The Ashiba command surface uses the descriptive command name `query optional`, but help and docs refer to the notation as SSSQL.

```bash
npx ashiba query optional add path/to/query.sql --filter email
npx ashiba query optional refresh path/to/query.sql
npx ashiba query optional remove path/to/query.sql --parameter email
```

## Compression At Runtime

SSSQL conditions are readable, but leaving every optional branch in the final SQL can be noisy for the database planner. The PostgreSQL driver adapter can compress optional branches at execution time.

For example, when `email` is `null`, Ashiba can remove this branch from the SQL sent to PostgreSQL:

```sql
and (:email is null or u.email = :email)
```

The source SQL file stays unchanged. The generated metadata tells the adapter which ranges can be removed safely.

## Default Behavior

Feature scaffolded query sources enable optional-condition compression by default:

```ts
export const listQuery = {
  // ...
  optionalConditionCompression: true,
} as const;
```

The generated PostgreSQL SQL client passes that query setting to the driver adapter:

```ts
optionalConditionCompression:
  query.optionalConditionCompression ?? executeOptions?.optionalConditionCompression
```

So, in normal scaffolded feature code, SSSQL compression is on by default.

At the low-level driver adapter boundary, compression only runs when `optionalConditionCompression: true` is provided. This keeps hand-built adapter calls explicit.

## Disabling Compression

Disable compression for one generated query by editing the query source:

```ts
export const listQuery = {
  // ...
  optionalConditionCompression: false,
} as const;
```

Or disable it by passing execution options from your SQL client wiring when the query source does not set its own value:

```ts
createPgSqlClient(pool, {
  executeOptions: {
    optionalConditionCompression: false,
  },
});
```

If a generated query source explicitly sets `optionalConditionCompression: true`, that query-level setting wins. Change the generated query source when you want a specific query to opt out.

## Safety Boundary

Compression depends on generated query metadata. If the SQL changes and metadata becomes stale, Ashiba rejects compression instead of emitting guessed SQL.

Refresh metadata after SQL edits:

```bash
npx ashiba query optional refresh path/to/query.sql
npx ashiba feature query refresh users-list list
```

Then run the passive checks:

```bash
npx ashiba check
npx ashiba check --full
```

