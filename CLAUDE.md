# Working on ai-factory

This repository is the quality-control authority for every project. Treat
changes here as sensitive: a weaker rule here weakens every project.

- Read `docs/ARCHITECTURE.md`, `docs/STANDARDS.md` and `docs/GOVERNANCE.md` first.
- Run `npm run typecheck`, `npm test` and `npm run policy:self` before proposing a change.
- Every policy rule has an id, a row in `docs/STANDARDS.md`, and tests for both the passing and failing case.
- Scripts are TypeScript run directly by Node 24: erasable syntax only, `.ts` import extensions, no runtime dependencies.
- Job names in `project-ci.yml` are the required check names in projects. Renaming one is a breaking change (`docs/VERSIONING.md`).
- Do not move version tags, merge pull requests, or change repository settings. Those belong to the human owner.
- Tests must never contain a literal credential-shaped string; assemble fakes at runtime.
