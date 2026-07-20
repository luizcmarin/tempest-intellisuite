# Security Policy

## Supported Versions

Only the latest release published on the VS Code Marketplace receives security fixes.

| Version | Supported |
| ------- | --------- |
| latest  | ✅        |
| older   | ❌        |

## Reporting a Vulnerability

Please **do not open a public issue** for security problems.

Instead, report it privately through GitHub:

1. Go to the [Security tab](https://github.com/luizcmarin/tempest-intellisuite/security) of this
   repository.
2. Click **Report a vulnerability** and fill in the advisory form.

You can expect an initial response within **7 days**. If the report is confirmed, a fix will be
released as soon as possible and you will be credited in the advisory (unless you prefer to remain
anonymous).

## What this extension does

Relevant to assessing impact:

- **It executes a local process.** The extension runs the project's Tempest console
  (`php tempest …`) to read data such as the command manifest, the route list and the project
  report. Both executables are configurable (`tempest.phpPath`, `tempest.consolePath`) and resolve
  inside the opened workspace, which means **opening an untrusted workspace can lead to executing a
  script from it** — the same trust model as any task runner or language server. Use VS Code's
  Workspace Trust when opening code you do not trust.
- **Commands it runs on its own are read-only.** Data collection never mutates the project. Anything
  that does — migrations, cache clearing, generators — runs only when you ask, in a visible
  terminal.
- **It writes outside the project.** Cached data goes to the extension's own storage directory, not
  into your project. The two exceptions are both explicit: files you ask the Forge to generate, and
  the two Lens collector files, which are installed only after a dialog naming them and removed by a
  single command.
- **It makes no network requests** and collects no telemetry. Nothing leaves the machine.
- **Everything it runs is logged** to the *Tempest IntelliSuite* output channel.

Reports about the Tempest framework itself should go to
[tempestphp/tempest-framework](https://github.com/tempestphp/tempest-framework/security).
