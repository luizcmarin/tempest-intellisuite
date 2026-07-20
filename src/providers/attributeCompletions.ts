import * as vscode from 'vscode';
import { useStatementEdit } from '../php';

interface TempestAttribute {
    label: string;
    fqcn: string;
    /** Extra classes to import alongside the attribute (e.g. the Every enum). */
    extraImports?: string[];
    snippet: string;
    detail: string;
    documentation: string;
}

/**
 * Tempest v3 discovery attributes. Discovery scans the codebase for these
 * attributes and wires routes, console commands and scheduled tasks
 * automatically — no registration files needed.
 */
const ATTRIBUTES: TempestAttribute[] = [
    {
        label: 'Get',
        fqcn: 'Tempest\\Router\\Get',
        snippet: "Get(uri: '/${1:path}')",
        detail: 'Tempest\\Router\\Get — HTTP GET route',
        documentation: 'Registers the method as a **GET** route, discovered automatically.\n\n```php\n#[Get(uri: \'/posts/{id}\')]\npublic function show(int $id): Response { /* … */ }\n```',
    },
    {
        label: 'Post',
        fqcn: 'Tempest\\Router\\Post',
        snippet: "Post(uri: '/${1:path}')",
        detail: 'Tempest\\Router\\Post — HTTP POST route',
        documentation: 'Registers the method as a **POST** route, discovered automatically.\n\n```php\n#[Post(uri: \'/posts\')]\npublic function store(CreatePostRequest $request): Response { /* … */ }\n```',
    },
    {
        label: 'Put',
        fqcn: 'Tempest\\Router\\Put',
        snippet: "Put(uri: '/${1:path}')",
        detail: 'Tempest\\Router\\Put — HTTP PUT route',
        documentation: 'Registers the method as a **PUT** route, discovered automatically.',
    },
    {
        label: 'Patch',
        fqcn: 'Tempest\\Router\\Patch',
        snippet: "Patch(uri: '/${1:path}')",
        detail: 'Tempest\\Router\\Patch — HTTP PATCH route',
        documentation: 'Registers the method as a **PATCH** route, discovered automatically.',
    },
    {
        label: 'Delete',
        fqcn: 'Tempest\\Router\\Delete',
        snippet: "Delete(uri: '/${1:path}')",
        detail: 'Tempest\\Router\\Delete — HTTP DELETE route',
        documentation: 'Registers the method as a **DELETE** route, discovered automatically.',
    },
    {
        label: 'ConsoleCommand',
        fqcn: 'Tempest\\Console\\ConsoleCommand',
        snippet: "ConsoleCommand(name: '${1:app}:${2:command}', description: '${3}')",
        detail: 'Tempest\\Console\\ConsoleCommand — console command',
        documentation: 'Turns the method into a console command, discovered automatically.\n\n```php\n#[ConsoleCommand(name: \'aircraft:track\')]\npublic function __invoke(): ExitCode { /* … */ }\n```',
    },
    {
        label: 'ConsoleArgument',
        fqcn: 'Tempest\\Console\\ConsoleArgument',
        snippet: "ConsoleArgument(description: '${1}')",
        detail: 'Tempest\\Console\\ConsoleArgument — documents a command argument',
        documentation: 'Adds metadata (description, aliases) to a console command parameter.',
    },
    {
        label: 'Schedule',
        fqcn: 'Tempest\\Console\\Schedule',
        extraImports: ['Tempest\\Console\\Scheduler\\Every'],
        snippet: 'Schedule(Every::${1|MINUTE,QUARTER,HALF_HOUR,HOUR,DAY,WEEK,MONTH|})',
        detail: 'Tempest\\Console\\Schedule — recurring task',
        documentation: 'Schedules the command/method to run on an interval, discovered automatically.\n\n```php\n#[Schedule(Every::HOUR)]\n#[ConsoleCommand(\'aircraft:sync\')]\npublic function __invoke(): void { /* … */ }\n```\n\nUse `new Interval(minutes: 5)` for custom intervals.',
    },
    {
        label: 'Singleton',
        fqcn: 'Tempest\\Container\\Singleton',
        snippet: 'Singleton',
        detail: 'Tempest\\Container\\Singleton — single container instance',
        documentation: 'Marks the class (or initializer method) as a singleton in the container.',
    },
];

/**
 * Suggests Tempest discovery attributes when the cursor sits inside a PHP
 * attribute opening (`#[…`). Selecting an item also inserts the matching
 * `use` statement when missing.
 */
export class AttributeCompletionProvider implements vscode.CompletionItemProvider {
    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): vscode.CompletionItem[] | undefined {
        const linePrefix = document.lineAt(position.line).text.slice(0, position.character);

        // Only inside an attribute context: `#[`, `#[Ge`, `#[Schedule(…` is out.
        if (!/#\[\s*[A-Za-z\\]*$/.test(linePrefix)) {
            return undefined;
        }

        return ATTRIBUTES.map((attribute) => {
            const item = new vscode.CompletionItem(attribute.label, vscode.CompletionItemKind.Class);
            item.detail = attribute.detail;
            item.documentation = new vscode.MarkdownString(attribute.documentation);
            item.insertText = new vscode.SnippetString(attribute.snippet);
            item.sortText = `0${attribute.label}`;

            const edits: vscode.TextEdit[] = [];
            for (const fqcn of [attribute.fqcn, ...(attribute.extraImports ?? [])]) {
                const edit = useStatementEdit(document, fqcn);
                if (edit) {
                    edits.push(edit);
                }
            }
            if (edits.length > 0) {
                item.additionalTextEdits = edits;
            }

            return item;
        });
    }
}
