/**
 * Diagnostics for `.env` files.
 *
 * Copied from the Ecosistema Sang plugin (`modules/dotenvSupport.js`) on
 * 2026-07-18 and rewritten in TypeScript. The two codebases are intentionally
 * independent: fixes made here do not travel back, and vice versa.
 *
 * Beyond the port, this version limits itself to `.env` files that belong to a
 * detected Tempest project — a public extension has no business linting every
 * dotenv file a developer happens to open.
 */

import * as vscode from 'vscode';
import type { ProjectRegistry } from '../core/project';

const VALID_LINE = /^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=.*$/;
const COMMENT_OR_BLANK = /^\s*(#|$)/;
const KEY = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;
const DEBOUNCE_MS = 300;

export function registerDotenvDiagnostics(
	context: vscode.ExtensionContext,
	projects: ProjectRegistry,
): void {
	const diagnostics = vscode.languages.createDiagnosticCollection('tempest-dotenv');

	const validate = (document: vscode.TextDocument): void => {
		if (document.languageId !== 'dotenv' || !projects.find(document.uri)) {
			diagnostics.delete(document.uri);

			return;
		}

		diagnostics.set(document.uri, collect(document));
	};

	let timer: ReturnType<typeof setTimeout> | undefined;

	const validateDebounced = (document: vscode.TextDocument): void => {
		clearTimeout(timer);
		timer = setTimeout(() => validate(document), DEBOUNCE_MS);
	};

	const validateAll = (): void => {
		for (const document of vscode.workspace.textDocuments) {
			validate(document);
		}
	};

	context.subscriptions.push(
		diagnostics,
		new vscode.Disposable(() => clearTimeout(timer)),
		vscode.workspace.onDidOpenTextDocument(validate),
		vscode.workspace.onDidChangeTextDocument((event) => validateDebounced(event.document)),
		vscode.workspace.onDidCloseTextDocument((document) => diagnostics.delete(document.uri)),
		// Detection is asynchronous and finishes after activation, so the first pass
		// below usually runs while no project is known yet — and files restored from
		// the previous session are already open by then. Without this, a `.env` open
		// at startup would never be checked.
		projects.onDidChange(validateAll),
	);

	validateAll();
}

function collect(document: vscode.TextDocument): vscode.Diagnostic[] {
	const found: vscode.Diagnostic[] = [];
	const seen = new Map<string, number>();

	for (let index = 0; index < document.lineCount; index++) {
		const line = document.lineAt(index);

		if (COMMENT_OR_BLANK.test(line.text)) {
			continue;
		}

		if (!VALID_LINE.test(line.text)) {
			found.push(
				new vscode.Diagnostic(
					line.range,
					'Invalid line. Use KEY=VALUE, or start the line with # to comment it out.',
					vscode.DiagnosticSeverity.Warning,
				),
			);

			continue;
		}

		const key = KEY.exec(line.text)?.[1];

		if (!key) {
			continue;
		}

		const previous = seen.get(key);

		if (previous === undefined) {
			seen.set(key, index);

			continue;
		}

		const duplicate = new vscode.Diagnostic(
			line.range,
			`Duplicate key: '${key}' is already defined on line ${previous + 1}. The last definition wins.`,
			vscode.DiagnosticSeverity.Warning,
		);

		duplicate.relatedInformation = [
			new vscode.DiagnosticRelatedInformation(
				new vscode.Location(document.uri, document.lineAt(previous).range),
				`First definition of '${key}'.`,
			),
		];

		found.push(duplicate);
	}

	return found;
}
