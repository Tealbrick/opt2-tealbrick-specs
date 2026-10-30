# Tealbrick specs

The frozen interface contract of Tealbrick: markdown specs (`docs/`) and the data-and-types package `@opt2-tealbrick/spec` (route table, credential types, JSON Schemas, root keys, vocabularies). Data and types only. Logic lives in `@opt2-tealbrick/manifest` (repository `Tealbrick/opt2-tealbrick-sdk`).

- Repository: `Tealbrick/opt2-tealbrick-specs` (GitHub organisation `Tealbrick`)
- Visibility target: PRIVATE. The repo is PUBLIC for now (the flip is held for the org Actions billing). Consumers install from the dist host, so the flip does not break anonymous installs.
- Licence: `@opt2-tealbrick/spec` is one of the SDK Packages under the Tealbrick SDK Licence (Part B of the Tealbrick Software Licence, version 1.1, published at https://tealbrick.com/software-licence). `LICENSE` and `NOTICE` are in the repo and in the package tarball, and `packages/spec/package.json` declares `"license": "SEE LICENSE IN LICENSE"`. Versions released before this change declared MIT and stay MIT (licence section 1.3, decision C220); see `LICENSING.md`.
- Status: spec 0.1.39. CI template ci-v9.9. Contracts were frozen at v0.1 on 2026-10-11 (`docs/FROZEN`). Changes are additive within a minor.

Do not put secrets, tokens, keys, customer data or personal data in this repository, its issues or its pull requests. This repository is public for now and must stay clean either way: no API keys, tokens, passwords, private keys, `.env` files, connection strings, personal names, private agent configurations or customer data. Every CI run starts with a secret scan (gitleaks, a step in `.woodpecker/ci.yaml`). GitHub secret scanning and push protection are NOT enabled on this repo (free organisation plan), so the CI step is the guard. An optional local guard is `pre-commit install`. If a secret is committed, rotate it first, then remove it from history.

## What this repo is and is not

This repo owns the wire: every Portal route, every credential type and lifetime, the manifest schema, the hold vocabularies, the error codes, the config and slice schemas. Every implementation imports it and none re-declares it.

If a markdown file and a schema disagree, the schema wins and the markdown is a spec bug. For credentials the `.ts` wins. For routes `routes.ts` wins.

## Quick start

pnpm workspace, TypeScript run directly by Node 24+ (type stripping).

```sh
corepack enable && pnpm install --frozen-lockfile --ignore-scripts
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Use it: install by release URL (no npm registry) from the dist host, and add its `integrity` to the lockfile (`node ci/tb-ci.ts pin-tarballs` in the platform repo):

```json
"@opt2-tealbrick/spec": "https://github.com/Tealbrick/opt2-tealbrick-dist/releases/download/opt2-tealbrick-specs-spec-v<x>/opt2-tealbrick-spec-<x>.tgz"
```

## Layout

| Path | Purpose |
|---|---|
| `docs/CORE.md` | Ids, audience format, crypto, trust chain, 13 credential kinds, the grant, `authorize()`, hook envelope, versioning |
| `docs/ACCESS.md`, `MANIFEST.md`, `BRIDGE.md`, `CREDENTIALS.md`, `PORTAL-API.md`, `SDK-API.md`, `CLI.md`, `CONFORMANCE.md`, `REPOS.md` | Topic specs |
| `docs/REQUESTS.md` | Append-only spec change requests |
| `docs/FROZEN` | Freeze marker and change rule |
| `packages/spec/src/routes.ts` | `ROUTES` (105 rows), error codes, rate classes, transports, audit actions |
| `packages/spec/src/admin.ts` | `ADMIN_ROUTES` (36 rows), admin gateway signing input |
| `packages/spec/src/credentials.ts` | `TYP`, claims, `LIFETIME_S`, `PORTAL_ROOT_KEYS` |
| `packages/spec/src/bridge.ts`, `manifest.ts`, `sdk.ts` | Bridge, manifest and SDK types and vocabularies (manifest vocabularies, credential registry, bridge wire types, SDK signatures) |
| `packages/spec/schemas/` | `manifest.schema.json`, `workspace-config.schema.json`, `instance-slice.schema.json` (draft 2020-12) |
| `packages/spec/examples/` | Example manifest |
| `tealbrick-ci.json` | Repo-specific CI settings (kind `specs`) |

## Configuration

None. It is a data package. `SPEC_VERSION` is a constant in `packages/spec/src/index.ts`.

## CI and release

Woodpecker CI with the shared opt2 pipeline template ci-v9.9 (`.woodpecker/ci.yaml` and `.github/workflows/opt2-release.yml` are generated copies; do not edit them, change `tealbrick-ci.json` or the template in `Tealbrick/opt2-tealbrick-platform`).

Tag `spec-v<x>`. The release Action runs `npm pack` and attaches `opt2-tealbrick-spec-<x>.tgz`, `.sha256` and `.integrity`. Not published to npm. Contracts change only through the specs lead and a recorded decision.

## Language

New code is TypeScript (Node 24+).

## Documentation

- `ARCHITECTURE.md` explains the design.
- `CONTRIBUTING.md` explains how to change it.
- The logic over this data lives in `Tealbrick/opt2-tealbrick-sdk`.
- System documentation (overview, environments, runbooks) lives in the private repo Tealbrick/opt2-tealbrick-docs.
