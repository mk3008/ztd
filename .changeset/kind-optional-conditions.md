---
"@ashiba/cli": minor
"@ashiba/driver-adapter-core": minor
"@ashiba/driver-adapter-pg": minor
---

Simplify scaffold command names around optional search conditions and feature boundaries.

The CLI now exposes `ashiba query optional add|refresh|remove` instead of the previous `query sssql` command group. Generated query models and PostgreSQL execution options now use `optionalConditionCompression` so customer-facing scaffolded code no longer contains the SSSQL term.

Feature scaffolding commands now use positional names for the primary target, for example `ashiba feature scaffold users-list --table users --action list` and `ashiba feature query refresh users-list list`, removing redundant `--feature-name`, `--feature`, and `--query-name` flags from the main workflow.
