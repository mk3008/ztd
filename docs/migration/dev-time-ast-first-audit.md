# Dev-Time AST-First Audit

## Policy

When Ashiba code runs only during development, SQL structural analysis should prefer tested `rawsql-ts` AST APIs over regular expressions or hand-written lexical parsing.

The `rawsql-ts` AST parser is the trusted source for development-time SQL structure. If SQL structure cannot be understood through the AST path, treat that as one of these first:

- an Ashiba AST traversal gap
- a reportable `rawsql-ts` parser or AST issue when valid SQL cannot be parsed
- an unsupported SQL shape that should be reported to the human

Do not silently fall back to regex or lexical interpretation for SQL structure. Before public release, migration shims should be removed rather than carried forward; unsupported shapes should fail clearly or be fixed at the AST/parser boundary.

Regex and lexical scans are acceptable only for narrow helper work:

- source-offset slicing for generated metadata such as safe-sort insertion positions
- generated TypeScript metadata extraction when TypeScript parsing is not yet introduced
- path and string normalization
- parser-failure diagnostics that clearly say AST parsing failed

## Current AST-Aligned Areas

- `ashiba query uses table`
- `ashiba query uses column`
- `ashiba query match-observed`
- `ashiba query outline`
- `ashiba query graph`
- `ashiba query slice`
- `ashiba query plan`
- `ashiba query lint`
- `ashiba lint` DDL-aware table, column, predicate, mutation, and returning checks
- DDL schema model extraction from `CREATE TABLE` statements
- DDL migration diff generation through `rawsql-ts` `DDLDiffGenerator`
- DDL migration risk analysis through rawsql-ts DDL AST statements for supported DDL shapes
- Feature scaffold table metadata extraction from `CREATE TABLE` statements
- `ashiba model-gen` statement kind and root query shape metadata
- `ashiba model-gen` result-column extraction from SELECT and RETURNING clauses
- `ashiba model-gen` expression type inference for literals, casts, common functions, CASE, comparisons, arithmetic, concatenation, and DDL-derived column references
- `ashiba model-gen` DDL-derived relation extraction for row type hints
- `ashiba model-gen` safe-sort sortable dictionary extraction from SELECT items
- `ashiba check-contract` query model freshness checks against AST-derived model metadata

## Migration Debt

These areas still use regex or hand-written lexical parsing for SQL structural understanding and should move toward AST-backed extraction. When the current behavior exists only because AST traversal has not been implemented, classify the work as Ashiba AST migration debt. When valid SQL cannot be parsed by `rawsql-ts`, classify it as a parser/AST bug to investigate or report rather than a reason to add quiet regex behavior:

- `ashiba model-gen` safe-sort insertion offset discovery, where AST can identify shape but source offsets may still require lexical/source-map support.
- Remaining DDL migration risk shapes should be added by expanding rawsql-ts DDL AST support or Ashiba AST traversal, not by adding regex recognizers.

Resolved in current pass:

- DDL schema model and feature scaffold `CREATE TABLE` discovery now parse DDL statements and check `CreateTableQuery` AST nodes instead of using a regex to decide whether a statement is `CREATE TABLE`.

## Explicit Fallback Policy

- Runtime named-parameter binding must use CLI-generated binding metadata. Runtime AST parsing is explicitly not preferred, and runtime lexical fallback should be rejected rather than silently rescanning SQL.
- Driver safe-sort rendering must not parse SQL at runtime. It should consume CLI-generated metadata and reject stale or unsupported metadata.
- When safe sort composes with dialect-specific parameter binding, the query model must include the dialect SQL insertion offset as metadata because placeholder rewriting can change string indexes.
- Source insertion positions may require source-offset metadata. If `rawsql-ts` AST cannot provide offsets, a small lexical helper can remain, but AST must decide the SQL shape and whether the operation is allowed. If AST cannot decide the shape, fail with a clear unsupported-shape diagnostic instead of guessing.
- Generated TypeScript contract reading in `check-contract` may use structured object extraction or regex as a TypeScript artifact parser until a TypeScript AST dependency is justified.
- Any fallback that affects SQL meaning, query metadata, lint conclusions, or drift conclusions must be visible in output or guarded by an explicit option. Hidden fallback is not allowed.

## Next Implementation Direction

1. Keep safe-sort sortable dictionary extraction on AST select items; retain lexical insertion offset only for the source splice position.
2. Review remaining DDL migration risk shapes against rawsql-ts DDL AST coverage before widening public support.
3. When `rawsql-ts` AST support appears insufficient for a required dev-time feature, confirm whether the gap is Ashiba traversal coverage or a parser/AST bug, then fix or report that root cause instead of adding another silent regex path.
