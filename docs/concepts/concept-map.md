# Concept Map

This page is the review index for Ashiba concepts. Ashiba is a multi-package product, so the concept map is grouped by package responsibility instead of being a flat list.

The current ConceptSpec format is provisional. This page is optimized for human review in VitePress.

## Product Baseline

- Product: `Ashiba`
- Baseline: `rawsql-ts/packages/ztd-cli`
- CLI package target: `@ashiba/cli`
- CLI command: `ashiba`

## Package Responsibility Categories

| Category | Package area | Review purpose |
|---|---|---|
| Repository Philosophy | Repository-wide concepts and policies | Defines the product promise, runtime policy, SQL-first posture, and boundaries that every package must preserve. |
| CLI | `@ashiba/cli` | Owns user-facing commands, scaffolding workflows, generated review artifacts, and migration from `ztd-cli`. |
| Driver Packages | `@ashiba/sql-*`, `@ashiba/driver-adapter-*`, `@ashiba/testkit-adapter-*`, `@ashiba/dialect-*` | Own thin driver seams, named parameters, sort profiles, dialect details, and testkit/production adapter separation. |
| Extension Packages | `@ashiba/sql-transform-*`, future `@ashiba/extension-*` | Own future SQL-first transforms without becoming ORM query planning or a query DSL. |

## Customer Contact Review Lanes

Ashiba concepts should also be reviewed by customer contact level. A library-only review is not enough because Ashiba scaffolds code into the customer's repository, then asks the customer to maintain that code.

| Contact level | Review focus | Why it matters |
|---|---|---|
| Primary contact | Ashiba as a library and CLI product | The first customer contact is the command, package, docs, help, runtime boundary, and generated-code promise. This level checks whether Ashiba itself is understandable and trustworthy. |
| Secondary contact | Ashiba as a scaffolder | The second customer contact is the scaffolded code placed into the customer's repository. This level checks whether file placement, comments, TODOs, extension points, and naming naturally guide beginners and customer-side AI toward the intended maintenance path. Customer tests are important here because library authors are no longer the ones editing the generated code. |
| Tertiary contact | Ashiba as validation and recovery tooling | The third customer contact appears after the customer changes SQL, DDL, DTOs, mappers, or generated-adjacent assets. This level checks whether broken consistency is detected in ordinary work, explained clearly, and recoverable quickly through fast local checks, full checks, hooks, or CI. |

## Repository Philosophy Concepts

These concepts apply to the whole repository and constrain all packages.

| ID | Display name | Status | Notes |
|---|---|---|---|
| `ashiba` | Ashiba | mostly done | Product identity for the `ztd-cli` rebrand; package and command surfaces now use Ashiba naming. Ashiba is not PostgreSQL-only; product-level vocabulary stays DBMS-neutral while DBMS-specific wrappers name their concrete driver or tool. Setup requires explicit DBMS starter selection and keeps package manager state application-owned. |
| `visible-sql` | Visible SQL | mostly done | SQL remains readable, reviewable, editable, executable, searchable, and uses named parameters for maintainability. |
| `boring-parts` | Boring Parts | mostly done | DTO definitions, mappers, query ID numbering, tests, optional migration review, sqlgrep, and impact analysis have initial Ashiba surfaces; richer row typing remains. |
| `ashiba-runtime-zero` | Ashiba Runtime Zero | mostly done | `@ashiba/cli` generates native TypeScript application code; generated application code does not require Ashiba CLI/runtime libraries, while driver adapters and extensions may have runtime dependencies. |
| `no-orm-runtime` | No ORM Runtime | mostly done | Rejects entities, relation loading, lazy loading, unit-of-work tracking, dirty tracking, and runtime model ownership; feature code owns orchestration. |
| `no-query-dsl-ceremony` | No Query DSL Ceremony | mostly done | SQL remains SQL, directly runnable in a SQL client, and free of Ashiba-only SQL notation. |
| `editable-generated-code` | Editable Generated Code | mostly done | Generated code remains visible customer-owned repository code, may be edited by humans and AI agents, and stays under drift checks after generation. Generated-owned metadata and human-editable code must be physically separated. |
| `passive-failure-surface` | Passive Failure Surface | partial | Ashiba must expose fast failures in the ordinary development path so customers notice broken DDL, SQL, DTO, mapper, metadata, or generated-adjacent consistency without relying on remembered manual refresh commands. Valid edits may happen separately from follow-up refresh/review steps, but stale artifacts must naturally surface through fast local checks, full checks, hooks, CI, or runtime metadata guards. Failures should include cause and next action; when recovery is mechanical, Ashiba should offer explicit refresh/fix commands instead of only explaining the problem. Scaffolded gates must be usable as generated, without hidden prerequisite steps. |
| `no-ai-behavior-file-distribution` | No AI Behavior File Distribution | mostly done | `ashiba init` may create README/docs, but Ashiba must not distribute `AGENTS.md`, `SKILL.md`, skills, prompts, or other files that alter AI-agent behavior. |
| `mapper-tested-type-safety` | Mapper-Tested Type Safety | mostly done | DTO and mapper type safety is guaranteed by mapping tests and DB-backed integration tests, not runtime result-row validation. Read queries primarily prove DB-to-TypeScript row mapping, with parameterized reads also proving TypeScript-to-DB parameter mapping. Mutation queries primarily prove TypeScript-to-DB parameter/write mapping, and also prove DB-to-TypeScript row mapping when the dialect exposes mutation result rows such as PostgreSQL `RETURNING`. |
| `error-output-modes` | Error Output Modes | mostly done | Shared formatter and CLI option support human-oriented and AI-oriented modes. Both modes include cause and next action/hint; known production errors in the current package set expose structured cause/action metadata, with formatter fallbacks kept as a safety net for unexpected errors. |
| `tooling-ast-dependency-policy` | Tooling AST Dependency Policy | partial | Ashiba tooling may depend on `rawsql-ts` core AST APIs through npm; development-only Runtime Zero support capabilities should be folded into `@ashiba/cli` unless a real non-CLI consumer exists. Dev-time SQL structural analysis should prefer tested AST APIs over regex/lexical parsing; remaining non-AST helpers are parser/AST capability debt unless limited to source offsets, generated TypeScript artifact extraction, or explicit diagnostics. Silent fallback is rejected. |
| `file-backed-runtime-sql` | File-Backed Runtime SQL | partial | Runtime execution boundaries accept reviewed SQL files or generated query source objects with SQL path and query model metadata, not arbitrary SQL string input. This applies to scaffolded/generated SQL clients and executors as well as driver adapter packages. The underlying driver still receives a string internally after metadata checks. |
| `query-model-metadata-contract` | Query Model Metadata Contract | partial | Runtime Zero SQL handling may use development-time AST analysis metadata only when the metadata is drift-checked against the source SQL by source hashes or equivalent checks. |
| `public-api-and-help-surface` | Public API and Help Surface | partial | Public exported functions require JSDoc. CLI commands require help surfaces before execution, with AI-oriented help allowed when a structured form is safer. |
| `human-first-command-interface` | Human-First Command Interface | partial | Ashiba should provide a small, memorable diagnostic entry point for people who do not know every specialized command. Higher-level commands may wrap narrower capabilities when that makes the ordinary loop easier to understand, fast enough to repeat, and safer to recover from. Default command paths should prefer one clear action over target selection; advanced flags may exist, but beginners should not need them. Names of commands, directories, files, and functions are part of the interface because they guide both humans and AI agents. |
| `cli-dry-run` | CLI Dry Run | partial | Mutating CLI commands must expose dry-run or equivalent preview behavior that reports planned effects without changing files or external state. Read-only inspection commands are already observational. |

## CLI Concepts

These concepts primarily belong to `@ashiba/cli`.

| ID | Display name | Status | Notes |
|---|---|---|---|
| `scaffolded-unit-tests` | Scaffolded Unit Tests | mostly done | Scaffolded unit tests are mapping-contract tests for Ashiba Runtime Zero development. They do not own database state behavior, row-count semantics, transaction isolation, locking, or business mutation correctness. |
| `test-lanes` | Test Lanes | mostly done | Supports traditional and Zero Table Dependency lanes through init, feature test scaffolds, generated mapping checks, and performance-lane helpers. |
| `performance-tuning-session` | Performance Tuning Session | mostly done | Traditional DB-backed tuning evidence: representative row counts, timeout status, plans, timings, sandbox-only candidate indexes, and explicit DDL promotion. |
| `drift-detection` | Drift Detection | mostly done | Checks DDL, SQL, DTO types, and mappers during development. |
| `migration-artifact` | Migration Artifact | mostly done | Review-oriented migration output, not hidden apply behavior. |
| `migration-query-generation` | Migration Query Generation | mostly done | Optional CLI support compares two DDL inputs and emits reviewable migration DDL plus risk info; DB connection, apply, rollback, scheduling, and migration-platform ownership are out of scope. |
| `sql-impact-analysis` | SQL Impact Analysis | mostly done | Table usage, column usage, query outline, dependency graph, CTE slice debugging, and JSON output. |
| `sqlgrep` | sqlgrep | mostly done | Keep `sqlgrep` as the capability name; expose it through Ashiba query commands where useful. |
| `cli-no-hidden-sql-rewrite` | CLI No Hidden SQL Rewrite | mostly done | `@ashiba/cli` does not hide dynamic SQL rewriting in generated application code; driver adapters and SQL-first extensions keep their own explicit boundaries. |
| `rfba` | RFBA | mostly done | Review-First Boundary Architecture: scaffolding fixes repeatable VSA-style feature/query review grain, supports subgrouped boundaries, and avoids technical-layer folders as the primary split. |
| `scaffold-as-guidance` | Scaffold As Guidance | partial | Scaffolded files are a customer-facing product surface, not only generated output. File placement, directory names, function names, comments, TODOs, and empty extension points should guide beginners and customer-side AI toward the intended maintenance path without requiring deep Ashiba knowledge. CLI scaffolding and generated holes are preferred guardrails when they are faster and more reliable than asking an AI to infer the project shape from prose. |
| `query-boundary` | Query Boundary | mostly done | Feature-local named SQL access boundary for SQL, query ID, DTO/mapped result contract, parameter contract, execution contract, log trace identity, and verification. |
| `feature-boundary` | Feature Boundary | mostly done | Feature-owned public surface and query boundary container; one feature may contain multiple query boundaries as behavior grows. |

## Driver Package Concepts

These concepts belong to driver-neutral SQL libraries, production driver adapters, testkit adapters, and dialect packages.

| ID | Display name | Status | Notes |
|---|---|---|---|
| `thin-driver-adapter` | Thin Driver Adapter | mostly done | `pg` adapter owns named binding, parameter checks, query-model-gated safe sort, stale metadata rejection, and observer events while avoiding ORM and transaction ownership. Wrapper package names include the wrapped driver or tool name. |
| `named-parameter-binding` | Named Parameter Binding | mostly done | Source SQL uses named parameters such as `:name` or `@name`; DB driver wrappers compile them to driver placeholders. |
| `parameter-contract-check` | Parameter Contract Check | mostly done | Missing and unused parameters fail before execution in binder and PostgreSQL adapter paths. |
| `safe-sort-profile` | Safe Sort Profile | mostly done | DB driver wrapper-owned safe sort surface based on whitelisted profiles and CLI-generated query model metadata: source hash, root query shape, insertion position, order-by/comma mode, and sortable dictionary. Sort keys must exactly match the query model whitelist. |
| `optional-condition-compression` | Optional Condition Compression | partial | Explicit driver-owned optional search condition removal based on CLI-generated query model metadata. Runtime does not parse SQL, does not use Ashiba-only SQL markers, and rejects missing or stale metadata. |
| `logger-ready-execution-event` | Logger-Ready Execution Event | mostly done | Structured driver observer events cover start/end/error, masked params by default, optional unmasked params, query metadata, DB errors, and pre-execution validation failures. Scaffolded/generated SQL execution paths are also checked; low-level pool helpers are not enough when presented as the SQL client. |

## Transform Package Concepts

These concepts are extension capabilities outside the core `@ashiba/cli` Runtime Zero path. They may have runtime dependencies when needed. They should stay SQL-first and review-oriented, and must not redefine core `@ashiba/cli` as a hidden runtime SQL rewriter.

| ID | Display name | Status | Target package |
|---|---|---|---|
| `pipeline-expansion` | Pipeline Expansion | mostly done | Dev-time CTE structure, graph, slice, and plan support is folded into `@ashiba/cli` query commands because it supports Runtime Zero review and has no separate runtime consumer. |
| `scalar-expansion` | Scalar Expansion | deferred | Extension capability planned from `rawsql-ts` / `ztd-cli` optional-condition tooling; deferred for the current pass. |

Future `@ashiba/extension-*` packages are reserved until a plugin mechanism exists.

## Category Relationship View

```mermaid
flowchart TD
  Repo["Repository Philosophy"]
  CLI["@ashiba/cli"]
  Drivers["Driver Packages"]
  Extensions["Transform Packages"]

  Repo --> CLI
  Repo --> Drivers
  Repo --> Extensions

  CLI --> FeatureBoundary["Feature Boundary"]
  FeatureBoundary --> RFBA["RFBA"]
  FeatureBoundary --> QueryBoundary["Query Boundary"]
  QueryBoundary --> NoHiddenRewrite["CLI No Hidden SQL Rewrite"]
  QueryBoundary --> MapperType
  CLI --> Tests["Scaffolded Unit Tests"]
  Tests --> TestLanes["Test Lanes"]
  Tests --> MapperType["Mapper-Tested Type Safety"]
  Tests --> Drift["Drift Detection"]
  Drift --> PassiveFailure["Passive Failure Surface"]
  CLI --> Impact["SQL Impact Analysis"]
  Impact --> Sqlgrep["sqlgrep"]
  CLI --> NoHiddenRewrite["CLI No Hidden SQL Rewrite"]
  CLI --> Migration["Migration Artifact"]
  Migration --> MigrationQuery["Migration Query Generation"]
  CLI --> ScaffoldGuidance["Scaffold As Guidance"]

  Drivers --> ThinAdapter["Thin Driver Adapter"]
  ThinAdapter --> NamedParams["Named Parameter Binding"]
  ThinAdapter --> ParamCheck["Parameter Contract Check"]
  ThinAdapter --> FileBackedSql["File-Backed Runtime SQL"]
  ThinAdapter --> SafeSort["Safe Sort Profile"]
  ThinAdapter --> OptionalCompression["Optional Condition Compression"]
  ThinAdapter --> LoggerEvent["Logger-Ready Execution Event"]

  Extensions --> Pipeline["Pipeline Expansion"]
  Extensions --> Scalar["Scalar Expansion"]

  Repo --> VisibleSql["Visible SQL"]
  Repo --> RuntimeZero["Ashiba Runtime Zero"]
  Repo --> AstPolicy["Tooling AST Dependency Policy"]
  RuntimeZero --> NoOrm["No ORM Runtime"]
  Repo --> ErrorModes["Error Output Modes"]
  Repo --> PublicApiHelp["Public API and Help Surface"]
  Repo --> NoAgentFiles["No AI Behavior File Distribution"]
  Repo --> NoDsl["No Query DSL Ceremony"]
  RuntimeZero --> MapperType
  Pipeline --> VisibleSql
  Scalar --> VisibleSql
  NoHiddenRewrite --> SafeSort
  LoggerEvent --> ErrorModes
  AstPolicy --> Impact
  AstPolicy --> Sqlgrep
  NoAgentFiles --> ErrorModes
  PublicApiHelp --> ErrorModes
  Repo --> HumanCommand["Human-First Command Interface"]
  HumanCommand --> PublicApiHelp
  HumanCommand --> ErrorModes
  HumanCommand --> PassiveFailure
  PassiveFailure --> HumanCommand
  PassiveFailure --> Drift
  PassiveFailure --> MapperType
  Repo --> PrimaryContact["Primary Contact"]
  Repo --> SecondaryContact["Secondary Contact"]
  Repo --> TertiaryContact["Tertiary Contact"]
  PrimaryContact --> PublicApiHelp
  SecondaryContact --> RFBA
  SecondaryContact --> ScaffoldGuidance
  SecondaryContact --> FeatureBoundary
  SecondaryContact --> QueryBoundary
  TertiaryContact --> Drift
  TertiaryContact --> PassiveFailure
  TertiaryContact --> MapperType
  FileBackedSql --> NamedParams
  FileBackedSql --> SafeSort
```

## Review Checks

- Repository-wide concepts must apply consistently to every package category.
- Concept review must identify which customer contact level is being judged: primary contact for Ashiba as a library/CLI, secondary contact for scaffolded customer code, or tertiary contact for validation and recovery after customer edits.
- Primary-contact review checks whether package names, commands, docs, help, runtime boundaries, and the generated-code promise are understandable before the customer has learned Ashiba deeply.
- Secondary-contact review checks the scaffolded code as customer-owned code. File placement, names, comments, TODOs, and extension points should make the intended maintenance path obvious to beginners and customer-side AI. Customer tests should cover this level because library tests alone do not prove the scaffold guides real users.
- Tertiary-contact review checks what happens after the customer changes the scaffolded world. Drift, broken mapping, stale metadata, and unsafe SQL/DDL changes should be detected through ordinary local checks, hooks, or CI, and recovery guidance should be fast enough for iterative human and AI development.
- Visible SQL includes editability; scaffolded SQL and adjacent generated code must remain easy for humans and AI agents to change.
- Watch-mode automatic regeneration should not silently rewrite schema/model artifacts; drift should fail explicitly with cause and next action.
- Non-continuous human or AI work must have a passive failure surface in the ordinary path. If DDL, SQL, mapper, or query contract edits leave stale follow-up artifacts, normal tests, gates, or metadata guards should detect the breakage and point to recovery rather than relying on remembered refresh commands or careful behavior.
- Passive failure surface is a core Ashiba safety concept, not just a convenience command. A check that exists but depends on humans remembering to run it is not yet passive; it becomes passive when connected to a fast local loop, full local gate, hook, CI, or runtime guard that is part of ordinary work.
- Passive checks must stay fast enough to remain in the edit loop. If a diagnostic becomes slow, Ashiba should expose timing/coverage information and keep a smaller fast path available.
- Recovery is part of detection. A good error points to the next command or mechanical fix, and a safe mechanical recovery should be available as an explicit refresh/fix command where possible.
- Gate scaffolding must not generate a CI workflow or hook that fails because Ashiba's own package scripts are missing. The default path should create a complete passive gate surface, and advanced target flags must still preserve a working customer path.
- `ashiba init` may create ordinary project documentation, but Ashiba must not distribute AI behavior files such as `AGENTS.md`, `SKILL.md`, skills, or prompts; AI guidance should come from visible scaffolds, contracts, and AI-oriented errors.
- Ashiba Runtime Zero applies to `@ashiba/cli` generated application code, not to every driver or extension package.
- Tooling AST dependencies, including `rawsql-ts` core, are allowed for Ashiba development packages and must not leak into generated application runtime code.
- Development-time capabilities that only support the Runtime Zero workflow should be integrated into `@ashiba/cli`; `sqlgrep` is the representative case.
- CLI concepts must cover practical ORM-like development support through scaffolding and checks, without implying an ORM runtime.
- Scaffolded unit tests are mapping tests. They verify the contract between TypeScript, visible SQL, DDL-backed DB execution, and DTO/query-result mapping; they are not a database state management or mutation behavior test suite.
- Scaffolded unit tests guarantee that query inputs can be bound from TypeScript into SQL/DB execution and that returned result rows, when present, can be mapped back into the generated TypeScript result shape.
- Scaffolded unit tests do not guarantee row cardinality, row-count semantics, insertion/deletion counts, which business rows should be updated or deleted, transaction isolation, locking behavior, or final database state. Those concerns belong to customer-owned application/business design, database constraints, or operational checks, not to Ashiba's generated mapping unit tests.
- Ashiba does not infer or check single-row cardinality after scaffolding. Generated code may start with a one-row shape, but `query.ts` and its row handling are customer-owned; intentionally returning the first row, returning many rows, or changing nullability is outside Ashiba's mapping-test responsibility.
- Mapping tests must use the configured DDL source directory as a directory, not a single DDL file. Every effective DDL file under that directory participates according to Ashiba's DDL ordering rules, and missing DDL should fail the test path rather than silently skip mapping verification.
- Read-query tests primarily cover DB-to-TypeScript mapping. When a read query has parameters, they also cover TypeScript-to-DB parameter mapping.
- Create/update/delete-query tests primarily cover TypeScript-to-DB mapping. When a dialect-specific mutation result surface exists, such as PostgreSQL `RETURNING` or another DBMS equivalent, tests also cover DB-to-TypeScript mapping for those returned rows.
- RFBA must separate files by reviewable feature/query behavior using VSA-style boundaries, not by technical layers such as repository/service/model as the primary layout.
- Scaffolding must fix a repeatable review grain because review scope is subjective; prose concepts alone are not enough.
- Scaffolding must also be reviewed as customer guidance. The generated layout should make the next reasonable edit location obvious, especially for cross-cutting seams such as SQL logging, adapters, test support, and query boundaries.
- Names are guardrails. File names, directory names, function names, and command names should be optimized for discovery and maintenance by beginners and customer-side AI, not only for library-internal neatness.
- CLI scaffolding should be preferred over AI inference when the project shape is mechanical. Generated code and explicit holes should make the intended extension point obvious before prose documentation is needed.
- A feature may contain multiple query boundaries, and `feature query scaffold` must support adding SQL behavior to an existing feature without forcing a new feature boundary.
- Feature boundaries may be subgrouped under the feature root; imports to shared seams or app-level test support should use root-stable aliases instead of depth-sensitive relative paths.
- Query boundaries should expose typed DTO/mapped result contracts to feature code and provide stable query IDs or names for debugging, drift checks, logs, performance evidence, and AI-oriented errors.
- Public exported functions must have JSDoc, and CLI commands must expose help before running mutating or expensive work.
- CLI help may be split into human-oriented and AI-oriented forms when that makes command contracts safer to consume.
- Ashiba must not require beginners to memorize the full command surface before they can diagnose ordinary drift or broken generated assets. Specialized commands may exist, but the product should also expose a small, memorable diagnostic entry point that is safe to try first and that can point to narrower recovery commands when needed.
- Human-first command design is also AI-friendly command design: if a person can discover what to run, why it failed, and what to try next, an AI agent can usually follow the same surface without repository-specific hidden knowledge.
- The fast local diagnostic path is more important than editor write-feel. IntelliSense can help, but Ashiba's primary guardrails are visible names, generated boundaries, fast checks, clear errors, and explicit recovery commands.
- Migration generation is optional review support. Ashiba may emit migration SQL and risk reports, but it must not present itself as the owner of applying migrations, rollback policy, deployment timing, or migration-platform governance.
- Core CLI scaffolding must not hide SQL transformation or dynamic SQL building inside generated application code; keep SQL visible and use driver/extension concepts for their bounded responsibilities.
- Driver package concepts must stay thin and must not own business SQL.
- Driver execution boundaries should not expose arbitrary SQL string input; use file-backed/generated query source objects and keep the final driver SQL string internal.
- Safe sort requests must exactly match query model whitelist keys; raw ORDER BY fragments and guessed column names are not accepted.
- Metadata that enables Runtime Zero SQL handling must be treated as part of the query contract, not a loose cache; stale metadata must fail before use.
- Optional condition compression must be explicit, metadata-backed, source-hash-checked, and free of Ashiba-only SQL markers.
- Transform package concepts must preserve visible SQL and must not become a query DSL.
- `Safe Sort Profile` is owned by the driver wrapper boundary; transform packages may define static schema or validation helpers only if that does not move ORDER BY rendering out of the driver wrapper or require Ashiba-only SQL notation.
