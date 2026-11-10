# Git Graph

An Orca plugin that shows the commit graph of the focused workspace's Git repository, like
VS Code's Git Graph.

## Layout

| Path | What it is |
| --- | --- |
| `orca-plugin.json` | Manifest: `trusted-worker`, one html panel, settings, workspace/terminal/storage capabilities. |
| `src/shared/protocol.ts` | Panel <-> worker contract (`graph.load`), typed on both sides. |
| `src/worker/main.ts` | Worker (Node). Finds the focused workspace's path and runs `git log`. Orca transpiles it; no build. |
| `src/worker/git/` | git wrappers: `run` (execFile), `log`, `details`, `diff`, `actions`, `config`. |
| `src/worker/{repo,state,settings,avatars,watch}.ts` | Repo resolution, view/review storage, settings, Gravatar cache, `.git` watcher. |
| `src/panel/` | Html panel in Preact, bundled by esbuild into `dist/panel/`. |
| `scripts/build.mjs` | Panel build (`--watch` to rebuild on save). |
| `assets/icon.svg` | Source of the plugin icon; `assets/icon.png` (256×256) is what the manifest uses. |

The panel runs in Orca's sandboxed frame (no file system, no network), so all Git access lives in
the worker. The panel asks with `orca.plugin.request('graph.load')` and reloads on
`workspace.changed`.

`workspace.readContext` gives the focused workspace's name and branch but no path, so the worker
matches it against `workspace.list` by name (preferring the same branch).

## Develop

```sh
pnpm install
pnpm types        # writes Orca's typings to .orca/types (Git-ignored)
pnpm build        # or `pnpm watch` in a second terminal
pnpm dev          # orca plugin dev watch .: loads the folder, streams logs, reloads on save
```

`dist/` is committed: Orca installs the plugin folder as-is and runs no build.

## Check

```sh
pnpm typecheck    # panel and worker tsconfigs
pnpm test         # orca plugin test .: worker tests against a real temporary repo
pnpm validate     # orca plugin validate .
```

See https://github.com/stablyai/orca/blob/main/docs/reference/plugin-authoring.md.
