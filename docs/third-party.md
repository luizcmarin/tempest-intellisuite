# Third-party code

Every piece of code in this extension that did not originate here is listed below, with its licence
and the date it was brought in. Nothing enters without a verified licence, its copyright notice
preserved, and a row in this table.

## Bundled code

| Source | Licence | Brought in | Notes |
| ------ | ------- | ---------- | ----- |
| _(none)_ | — | — | The `github-action` codicon (© Microsoft, CC BY 4.0) was used for the Forge button and was removed on 2026-07-19 along with the Forge itself. Nothing third-party ships today. |

The runtime bundle contains only code written for this project. `vscode`
and Node built-ins are
external, and the `devDependencies` (esbuild, TypeScript, vsce, type definitions) are build-time
only — they never ship inside the `.vsix`.

## Ported from Ecosistema Sang

The [Ecosistema Sang](https://github.com/LuizMarin/sang-plugin) plugin is a personal development hub
by the same author. A few of its generic editor modules were rewritten in TypeScript here.

| Module | Ported as | Date |
| ------ | --------- | ---- |
| `modules/dotenvSupport.js` | `src/providers/dotenv.ts` | 2026-07-18 |
| `modules/htmlTools.js` (tag manager only) | `src/providers/tags.ts` | 2026-07-18 |

Only the tag-manager half of `htmlTools.js` was taken. The rest of it wired up
`vscode-html-languageservice`, `vscode-css-languageservice` and `vscode-emmet-helper`; Emmet turned
out to need three lines of configuration instead, and bundling those libraries for what remained
would have grown the extension from 48 KB to roughly two megabytes.

`modules/smartEditing.js` was evaluated and left behind — see `docs/architecture.md`.

These are **copies, not a shared library**. The two projects serve different audiences and evolve
independently; a fix in one does not travel to the other. Each ported file says so in its header.

Only modules that were original to that plugin were ported. Its ports of other extensions —
[Todo Tree](https://github.com/Gruntfuggly/todo-tree),
[Error Lens](https://github.com/usernamehw/vscode-error-lens) and
[Path Intellisense](https://github.com/ChristianKohler/PathIntellisense) — were deliberately left
out, and the functionality they covered is either out of scope here or written from scratch against
Tempest's own conventions.

## Rule for future contributions

Before copying code from anywhere:

1. Find the licence and confirm it permits redistribution.
2. Preserve the original copyright notice and licence text.
3. Add a row above with the source, licence and date.
4. Note the origin in the file's header.

If any of these cannot be satisfied, write the code from scratch instead.
