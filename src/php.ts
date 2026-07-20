import * as vscode from 'vscode';

/**
 * Shared PHP-source helpers: `use` statement management for completions.
 */

/**
 * Builds a TextEdit that inserts `use <fqcn>;` in the right spot of a PHP
 * document (after the last existing `use`, else after `namespace`, else after
 * the opening tag / declare). Returns undefined when the import already exists.
 */
export function useStatementEdit(document: vscode.TextDocument, fqcn: string): vscode.TextEdit | undefined {
    const head = document.getText(new vscode.Range(0, 0, Math.min(document.lineCount, 120), 0));

    const escaped = fqcn.replace(/\\/g, '\\\\');
    if (new RegExp(`^use\\s+${escaped}\\s*;`, 'm').test(head)) {
        return undefined;
    }

    const statement = `use ${fqcn};\n`;

    const anchors: { pattern: RegExp; blankLineBefore: boolean }[] = [
        { pattern: /^use\s+[^;]+;[ \t]*$/gm, blankLineBefore: false },
        { pattern: /^namespace\s+[^;]+;[ \t]*$/gm, blankLineBefore: true },
        { pattern: /^declare\s*\([^)]+\)\s*;[ \t]*$/gm, blankLineBefore: true },
        { pattern: /^<\?php[ \t]*$/gm, blankLineBefore: true },
    ];

    for (const { pattern, blankLineBefore } of anchors) {
        let last: RegExpExecArray | null = null;
        for (let match = pattern.exec(head); match !== null; match = pattern.exec(head)) {
            last = match;
        }
        if (last !== null) {
            const line = document.positionAt(last.index).line;
            const insertAt = new vscode.Position(line + 1, 0);
            return vscode.TextEdit.insert(insertAt, blankLineBefore ? `\n${statement}` : statement);
        }
    }

    return vscode.TextEdit.insert(new vscode.Position(0, 0), statement);
}
