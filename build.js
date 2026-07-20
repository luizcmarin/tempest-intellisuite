import esbuild from 'esbuild';
import { builtinModules } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const external = [
    'vscode',
    ...builtinModules,
    ...builtinModules.map((m) => `node:${m}`),
];

await esbuild.build({
    entryPoints: [path.resolve(__dirname, 'src/extension.ts')],
    bundle: true,
    outfile: path.resolve(__dirname, 'build/extension.js'),
    external,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    minify: true,
    sourcemap: false,
    logLevel: 'info',
});
