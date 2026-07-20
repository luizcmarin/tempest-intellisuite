# Troubleshooting

Start with **Tempest: Show Extension Log** from the command palette. It records every console
command the extension ran, how long it took, and why anything failed.

## The extension does nothing in my project

It only treats a folder as a Tempest project when the console executable exists at its root. Check:

- Is there a `tempest` file at the root of the workspace folder?
- If it lives elsewhere, point `tempest.consolePath` at it.
- Is the project a *folder* in the workspace, rather than a subfolder of one you opened? Detection
  runs per workspace folder.

The log says which projects were detected on startup.

## Language features work, but nothing reads my project

Attribute completions, highlighting and snippets need no PHP — they work anywhere. Everything that
reads project data runs the console, so:

- **PHP is not on `PATH`.** Set `tempest.phpPath` to an absolute path.
- **The console fails to boot.** Run `php tempest about` in a terminal; if that fails, the extension
  cannot do better.
- **The project is slow to boot.** Raise `tempest.cli.timeout`.

## Permission errors mentioning `.tempest/`

Expected, and harmless. Parts of `.tempest/` — sessions and compiled views — are written by the web
server user, while the extension runs as you. The affected feature degrades; the rest keeps working.

To fix it at the source, give your user access to the directory, e.g. by adding yourself to the web
server's group and making the tree group-writable.

## A generated POST or DELETE route answers 403

Not a bug in the generated code, and not something the extension can change. Tempest 3.0 replaced
CSRF tokens with the `Sec-Fetch-Site` and `Sec-Fetch-Mode` headers, which browsers send
automatically. Tools that do not — `curl`, Postman, HTTP client scripts — look like a cross-site
request and are refused.

Forms rendered by the generated views work in a browser as they are. To exercise the same route from
the command line, send the headers a browser would:

```bash
curl -X POST -d 'title=Hello' \
  -H 'Sec-Fetch-Site: same-origin' \
  -H 'Sec-Fetch-Mode: navigate' \
  http://localhost:8000/products/create
```

## My new route or command does not appear

Two possible causes:

1. **Our cache.** Run **Tempest: Refresh Project Data**.
2. **Tempest's discovery cache.** In development it can mask newly written code — this is a common
   source of confusion, and not something the extension can fix from outside. Run
   `./tempest discovery:clear`, or set `DISCOVERY_CACHE=none` in `.env` while developing.

## Highlighting is wrong in a `.view.php` file

The Tempest View grammar applies to files ending in `.view.php`. If a file uses a different naming
convention, VS Code treats it as plain PHP. Set the language mode manually from the status bar, or
rename the file.

If highlighting is wrong *within* a Tempest View file, that is a grammar bug — please
[open an issue](https://github.com/luizcmarin/tempest-intellisuite/issues) with the snippet.

## Something else

Open an issue with:

- the output of `./tempest about`,
- your VS Code version and OS,
- the relevant portion of the extension log.
