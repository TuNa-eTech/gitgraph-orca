// Bundles the html panel (Preact) into dist/panel/. The worker needs no build: Orca transpiles
// src/worker/*.ts as Node loads them. Pass --watch to rebuild on save while `orca plugin dev watch .`
// reloads the panel.
import { copyFile, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { context } from 'esbuild'

const root = path.dirname(import.meta.dirname)
const srcDir = path.join(root, 'src', 'panel')
const outDir = path.join(root, 'dist', 'panel')
const watch = process.argv.includes('--watch')

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })
await copyFile(path.join(srcDir, 'index.html'), path.join(outDir, 'index.html'))

const ctx = await context({
  entryPoints: { main: path.join(srcDir, 'main.tsx'), styles: path.join(srcDir, 'styles.css') },
  outdir: outDir,
  bundle: true,
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  sourcemap: 'linked',
  minify: !watch,
  legalComments: 'none',
  logLevel: 'info'
})

if (watch) {
  await ctx.watch()
} else {
  await ctx.rebuild()
  await ctx.dispose()
}
