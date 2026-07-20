import * as vscode from 'vscode';
import type { ContainerIndex, ContainerService } from '../core/container';
import type { ProjectRegistry } from '../core/project';
import { useStatementEdit } from '../php';

interface InjectableService {
    className: string;
    fqcn: string;
    property: string;
    description: string;
}

/**
 * The services worth putting at the top of the list.
 *
 * The container knows about a hundred-odd bindings, most of which nobody
 * type-hints by hand. These are the ones people actually reach for, so they are
 * ranked first — and they double as the fallback when the container cannot be
 * read at all (no PHP on PATH, a project that will not boot).
 */
const CORE_SERVICES: InjectableService[] = [
    { className: 'Console', fqcn: 'Tempest\\Console\\Console', property: 'console', description: 'Console input/output' },
    { className: 'Container', fqcn: 'Tempest\\Container\\Container', property: 'container', description: 'The dependency container itself' },
    { className: 'Database', fqcn: 'Tempest\\Database\\Database', property: 'database', description: 'Database connection and query execution' },
    { className: 'Router', fqcn: 'Tempest\\Router\\Router', property: 'router', description: 'Route matching and URI generation' },
    { className: 'ViewRenderer', fqcn: 'Tempest\\View\\ViewRenderer', property: 'viewRenderer', description: 'Renders .view.php templates' },
    { className: 'CommandBus', fqcn: 'Tempest\\CommandBus\\CommandBus', property: 'commandBus', description: 'Dispatches command messages to handlers' },
    { className: 'EventBus', fqcn: 'Tempest\\EventBus\\EventBus', property: 'eventBus', description: 'Dispatches events to listeners' },
    { className: 'Clock', fqcn: 'Tempest\\Clock\\Clock', property: 'clock', description: 'Testable time source' },
    { className: 'HttpClient', fqcn: 'Tempest\\HttpClient\\HttpClient', property: 'httpClient', description: 'Outgoing HTTP requests' },
    { className: 'Logger', fqcn: 'Tempest\\Log\\Logger', property: 'logger', description: 'PSR-3 logger' },
];

/**
 * Autowiring suggestions inside `__construct(…)`.
 *
 * Everything the project's container can resolve is offered — including the
 * bindings the project registered itself, which a fixed list could never know
 * about. The core services stay pinned to the top, and if the container cannot
 * be read the list simply falls back to them.
 */
export class ConstructorInjectionProvider implements vscode.CompletionItemProvider {
    constructor(
        private readonly projects?: ProjectRegistry,
        private readonly container?: ContainerIndex,
    ) {}

    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): Promise<vscode.CompletionItem[] | undefined> {
        if (!this.insideConstructorParameters(document, position)) {
            return undefined;
        }

        const items = CORE_SERVICES.map((service, index) =>
            this.toItem(document, service, `1${String(index).padStart(3, '0')}`, service.description),
        );

        const project = this.projects?.find(document.uri);

        if (!project || !this.container) {
            return items;
        }

        const known = new Set(CORE_SERVICES.map((service) => service.fqcn));

        for (const [index, service] of (await this.container.all(project)).entries()) {
            if (known.has(service.id)) {
                continue;
            }

            items.push(
                this.toItem(
                    document,
                    {
                        className: service.shortName,
                        fqcn: service.id,
                        property: lowerFirst(service.shortName),
                        description: describe(service),
                    },
                    `2${String(index).padStart(3, '0')}`,
                    describe(service),
                ),
            );
        }

        return items;
    }

    private toItem(
        document: vscode.TextDocument,
        service: InjectableService,
        sortText: string,
        detail: string,
    ): vscode.CompletionItem {
        const item = new vscode.CompletionItem(
            `${service.className} $${service.property}`,
            vscode.CompletionItemKind.Constructor,
        );

        item.detail = `${service.fqcn} — ${detail}`;
        item.documentation = new vscode.MarkdownString(
            `Autowires \`${service.fqcn}\` as a promoted property. Tempest's container resolves it automatically — no configuration needed.`,
        );
        item.insertText = new vscode.SnippetString(
            `private ${service.className} \\$\${1:${service.property}},`,
        );
        item.filterText = `${service.className} ${service.property}`;
        item.sortText = sortText;

        const edit = useStatementEdit(document, service.fqcn);

        if (edit) {
            item.additionalTextEdits = [edit];
        }

        return item;
    }

    /**
     * Heuristic: the closest `__construct(` before the cursor still has an
     * unbalanced parenthesis, so the cursor sits in the parameter list.
     */
    private insideConstructorParameters(document: vscode.TextDocument, position: vscode.Position): boolean {
        const offset = document.offsetAt(position);
        const text = document.getText().slice(Math.max(0, offset - 2000), offset);

        const constructorIndex = text.lastIndexOf('__construct');
        if (constructorIndex === -1) {
            return false;
        }

        const afterConstructor = text.slice(constructorIndex);
        const open = (afterConstructor.match(/\(/g) ?? []).length;
        const close = (afterConstructor.match(/\)/g) ?? []).length;

        return open > close;
    }
}

function describe(service: ContainerService): string {
    return service.tag
        ? `tagged "${service.tag}" · ${service.section.toLowerCase()}`
        : service.section.toLowerCase();
}

function lowerFirst(value: string): string {
    return value.charAt(0).toLowerCase() + value.slice(1);
}
