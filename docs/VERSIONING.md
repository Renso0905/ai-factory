# Versioning

The factory is released with semantic version tags.

| Tag | Meaning | Moves? |
| --- | --- | --- |
| `v1.2.3` | An exact release | Never |
| `v1` | Latest compatible `v1.x.y` | Yes, on each v1 release |

Projects call `project-ci.yml@v1` and so receive fixes and new non-breaking
checks without a change. A project that needs full reproducibility can pin
`@v1.2.3` or a commit SHA instead; the policy check accepts all three.

## What counts as breaking

A major version (`v2`) is required when a project that passed could now fail
without having changed: a new mandatory file, a stricter rule, a renamed job
(job names are the required check names), a removed input. New optional
inputs and bug fixes are minor or patch releases.

## Releasing

1. Merge to `main` through a pull request with `Factory CI` green.
2. Tag the exact release, then move the major tag:

```bash
git tag v1.0.1
git tag -f v1 v1.0.1
git push origin v1.0.1
git push -f origin v1
```

Only the human owner moves tags. To try a risky change first, push a
pre-release tag such as `v1.1.0-rc1` and call it from a project branch using
the `factory-ref` input.

## The factory-ref input

`project-ci.yml` loads its policy scripts from the factory at `factory-ref`
(default `v1`). GitHub does not tell a reusable workflow which ref it was
called at, so a project calling anything other than `@v1` should pass the same
value as `factory-ref`.

## Third-party actions

Pinned by commit SHA with the version in a trailing comment. Update them
deliberately in a pull request.
