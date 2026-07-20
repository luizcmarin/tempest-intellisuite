# Tempest PHP IntelliSuite — agent instructions

A VS Code extension for the [Tempest](https://tempestphp.com) PHP framework. TypeScript, bundled
with esbuild, built with bun.

> This is a **public product in English** — code, comments, UI strings, docs and commits. It lives
> inside the (Portuguese) Sang monorepo but shares nothing with it.

## Non-negotiables

1. **Nothing is installed in the user's project.** No Composer package, no middleware, no endpoint.
   A feature that truly needs code in the project must be opt-in, must write a visible and removable
   file, and the extension must work without it.
2. **Prefer JSON to parsing text.** `completion:generate`, `routes --json` and `about --json` are
   data; console tables are presentation. Text parsing needs an isolated tested module *and* an
   entry in `docs/upstream.md`.
3. **Detect features, never versions.** The published docs describe 3.0 while real installs are far
   ahead. Ask `commands.json` whether a command exists.
4. **Degrade quietly.** No project, no PHP, `EACCES` in `.tempest/` — all normal. Never break the
   language features.
5. **The CliRunner is read-only.** Anything that mutates a project runs in a real VS Code terminal.
6. **No network, no telemetry, no CDN.** Webviews are fully self-contained.
7. **Third-party code needs a verified licence** + preserved notice + a row in
   `docs/third-party.md`. When in doubt, write it from scratch.
8. **This extension does not generate scaffolds.** The Forge moved to the Sang plugin
   (`../sang-plugin/modules/forge.js`, conventions in `../sang-plugin/docs/convencoes-tempest.md`)
   on 2026-07-19. Scaffolding is opinion — it has to pick action names, file layout and a styling
   vocabulary — and this extension is language tooling. What stayed is `core/collectors.ts`, the
   narrow file-writing slice the Lens needs for its two collector files. Do not grow it back into a
   generator: a new stub here is a sign the work belongs in the plugin.

## Layout

```text
src/
├── extension.ts        # activation
├── core/
│   ├── project.ts      # ProjectRegistry — detection, tempest.isTempestProject
│   ├── cli.ts          # CliRunner — read-only console execution
│   └── datasources.ts  # commands.json, about --json, caching
│   └── collectors.ts   # the Lens's two PHP files, rendered from stubs
├── providers/          # language features
└── panel/              # webview (from 1.1)
templates/              # the two collector stubs, as data
```

## Commands

```bash
bun install
bun run typecheck     # tsc --noEmit
bun run build:bundle  # esbuild → build/extension.js
bun run package       # .vsix into ../dist/
```

From the monorepo root: `bun run build:tempest`, `bun run package:tempest`.

## Verification

**A live Tempest project lives at `../tempest-demo`** — the Atlas. Probe it instead of trusting
the docs, and read the framework's own source under its `vendor/tempest/framework`:

```bash
cd ../tempest-demo
php ./tempest                                   # command inventory
php ./tempest completion:generate --path=/tmp/commands.json
php ./tempest about --json
php ./tempest routes --json
php ./tempest config:show | grep -i debug       # resolves the real log path
php ./tempest serve                             # then exercise routes with curl
```

⚠️ **Never run** `migrate:fresh`, `migrate:down`, `cache:clear`, `static:clean` or `tail:debug`
there — they are destructive, and `tail:debug` deletes the log it tails. The Atlas is a seeded
demo, not a scratch install: leave its database as you found it, and clean up any record a check
creates.

⚠️ **Never run `composer qa` or `composer fmt` to check your own work** — the formatter rewrites
files you did not touch and undoes deliberate alignment (it has flattened `DemoSeeder`'s column
layout before). Run `composer lint` and `composer test`, and read `git status` afterwards.

"It typechecks" is not verification. Behaviour depends on a live framework, so exercise changes in
an Extension Development Host (**F5**) against that project.

## Conventions

- Tabs for indentation.
- Comments explain *why*. Delete the ones that restate the code.
- Settings under the `tempest.` prefix, documented in `docs/configuration.md`.
- Update `CHANGELOG.md` (Keep a Changelog) for anything user-visible.
- When the framework blocks you, add an item to `docs/upstream.md` — every workaround that exists
  because of a framework limitation has an entry there.

## Planning documents

Long-form planning lives in the monorepo, in Portuguese, at `../docs/tempest-intellisuite/`:
`PLANEJAMENTO.md` (phases and decisions), `RECONHECIMENTO.md` (measured facts about the framework),
`UPSTREAM.md` (mirrored here as `docs/upstream.md`).
