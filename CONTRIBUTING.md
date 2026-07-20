# Contributing

Thanks for considering a contribution. This document covers how to build the extension and the few
rules that keep it coherent.

## Getting set up

Requires [bun](https://bun.sh) and VS Code 1.90+.

```bash
bun install
bun run typecheck     # tsc --noEmit
bun run build:bundle  # esbuild → build/extension.js
```

Press **F5** in VS Code to launch an Extension Development Host, then open a Tempest project inside
it. A clean project scaffold from [tempest-app](https://github.com/tempestphp/tempest-app) is enough
to exercise everything.

## Packaging

```bash
bunx @vscode/vsce package --no-dependencies
```

## Design rules

These are not style preferences — they are what makes the extension trustworthy.

1. **Nothing is installed in the user's project.** No Composer package, no middleware, no endpoint.
   A feature that genuinely needs code in the project must be *opt-in*, must write a visible and
   removable file, and the extension must work without it.
2. **Prefer JSON to parsing text.** `completion:generate`, `routes --json` and `about --json` are
   data. The console's tables are presentation and break with terminal width, colour and layout
   changes. Where text parsing is unavoidable, isolate it in one tested module and open an upstream
   issue (see [docs/upstream.md](docs/upstream.md)).
3. **Detect features, never versions.** The published docs lag behind the framework by a wide
   margin. Ask the project what commands it has; do not compare version numbers.
4. **Degrade quietly.** No Tempest project, no PHP on PATH, a permission error inside `.tempest/` —
   all are normal states. Say so and move on; never break the language features.
5. **Console commands are read-only.** Anything that mutates a project (`migrate:*`, `cache:clear`,
   `make:*`) runs in a real VS Code terminal where the user can see it, answer prompts and cancel.
6. **No network, no telemetry.** Webviews must be fully self-contained — no CDN, no remote fonts.
7. **Third-party code needs a verified licence,** its copyright notice preserved, and an entry in
   [docs/third-party.md](docs/third-party.md). When in doubt, write it from scratch.

## Language and conventions

- Code, comments, UI strings, docs and commit messages are in **English**.
- Tabs for indentation, matching the existing files.
- Comments explain *why*, not *what*. Skip the ones that restate the code.
- Settings live under the `tempest.` prefix and are documented in
  [docs/configuration.md](docs/configuration.md).

## Pull requests

- Keep them focused; unrelated changes are easier to review separately.
- `bun run typecheck` and `bun run build:bundle` must pass.
- Describe how you verified the change in a real Tempest project — this extension's behaviour
  depends on a live framework, so "it compiles" is not verification.
- Update [CHANGELOG.md](CHANGELOG.md) under an *Unreleased* heading.

## Reporting bugs

Include your Tempest version (`./tempest about`), VS Code version, OS, and the relevant output from
**Tempest: Show Extension Log** — it records every console command the extension ran.
