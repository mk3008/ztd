---
layout: home
hero:
  name: Ashiba
  text: Show me the SQL.
  tagline: Ashiba handles the boring parts.
  image:
    src: /brand/ashiba-logo.jpg
    alt: Ashiba logo
  actions:
    - theme: brand
      text: API
      link: /api/commands
    - theme: alt
      text: Concepts
      link: /concepts/concept-map
features:
  - title: "SQL is yours"
    details: "Keep SQL as application-owned source code. Read it, edit it, review it, and run it in your SQL client."
  - title: "Generated code is yours"
    details: "Ashiba writes ordinary TypeScript into your repo, including DTOs, mapper boundaries, query contracts, tests, and metadata."
  - title: "Safety is checked"
    details: "Drift checks and mapping tests catch stale SQL, DDL, metadata, and generated contracts before they become accepted code."
  - title: "No ORM runtime"
    details: "Your app runs explicit SQL through a driver adapter and ordinary TypeScript boundaries. No hidden query DSL or object layer."
---

## Documentation

- [Command API](./api/commands.md)
- [SSSQL notation](./guide/sssql.md)
- [Concept map](./concepts/concept-map.md)
