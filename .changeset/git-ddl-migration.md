---
"@ashiba-ts/cli": minor
---

Add git ref DDL inputs to `ashiba ddl migration generate`. Use `--from-git <ref:path>` or `--to-git <ref:path>` to compare committed DDL snapshots with local files or directories and write reviewable migration SQL.

Improve drift repair guidance in project checks so failed generated mapping-test diagnostics point to the visible SQL, editable query boundary, and generated assets that should be refreshed.
