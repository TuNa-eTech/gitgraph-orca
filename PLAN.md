# Git Graph for Orca: feature port plan

Source studied: `.tmps/git-graph-1.30.0` (mhutchie/vscode-git-graph 1.30.0, compiled `out/*.js` + `media/out.min.js`).

## 0. License constraint (read first)

The extension's LICENSE allows use and modification but says: "Permission is NOT GRANTED to publish, distribute, sublicense, and/or sell derivative works". Copying its code into this plugin and publishing it to the Orca catalog would breach that.

Rule for this project: use the extension only as a **feature reference** (behaviour, git commands, UX). Write all code from scratch. Do not paste code, CSS or the minified webview bundle. Octicons (MIT) may be used if needed, with their license kept.

## 1. Architecture mapping

| VS Code extension | Orca plugin |
| --- | --- |
| `extension.ts`, `commands.ts` | `src/worker/main.ts` (`activate`, `orca.panels.handle`) |
| `dataSource.ts` (spawns git) | `src/worker/git/*.ts` |
| `repoManager.ts` (finds repos) | `workspace.list` + `git rev-parse --show-toplevel` per workspace |
| `repoFileWatcher.ts` | `fs.watch` on `.git/` (HEAD, refs, index) in the worker, debounced, pushes `graph.changed` |
| `gitGraphView.ts` message switch (~60 message types) | Typed `PluginRequests` in `src/shared/protocol.ts` |
| Webview (`media/out.min.js`) | Preact html panel `src/panel/` |
| `extensionState.ts` (globalState) | `storage.get/set` (view state, code reviews, avatar cache) |
| `config.ts` (`git-graph.*` settings) | `contributes.settings` + `settings:own` capability |
| VS Code dialogs / quick picks | In-panel modal dialogs (Preact) |
| `diffDocProvider.ts` + VS Code diff editor | Diff rendered inside the panel (no Orca diff API) |
| Open file | `editor.open` (current version only) |
| `statusBarItem.ts` | Not possible: status bar items need the `declarative` profile; this plugin is `trusted-worker`. Skip. |
| `askpass/` (credential prompts for push/pull/fetch) | Run with `GIT_TERMINAL_PROMPT=0`; on auth failure offer "Run in terminal" via `terminal.create` |
| `avatarManager.ts` | Worker fetches Gravatar/GitHub/GitLab avatars, caches in storage, sends data URIs (panel has no network) |

Messages from panel to worker go through `orca.plugin.request(name, input)`. Worker-to-panel updates: the panel re-requests on `workspace.changed`, plus a long-poll request `graph.watch` that resolves when the file watcher fires (no push API from worker to panel exists).

## 2. Feature inventory and port decision

Status: ✅ port, ⚠️ port with Orca workaround, ❌ drop.

### Graph view
| Feature | Decision |
| --- | --- |
| Commit graph: lanes, colours, curved/angular style, first-parent mode | ✅ |
| Local + remote branches, tags, HEAD, stashes as ref labels | ✅ |
| Uncommitted changes row (`git status`) | ✅ |
| Load more commits (paging), "load all" | ✅ |
| Branch filter dropdown (all / selected / glob patterns) | ✅ |
| Columns Date/Author/Commit: resize, show/hide | ✅ |
| Hover vertex tooltip: in HEAD?, which branches/tags contain it | ✅ |
| Find widget (message/date/author/hash/ref, regex, case) | ✅ |
| Emoji shortcodes + gitmoji in messages | ✅ (own table) |
| Mute merge commits, hide remotes, show tags toggles | ✅ |
| Signature status (`%G?`) | ✅ |
| Mailmap (`--use-mailmap`) | ✅ |
| Repo dropdown (multiple repos/submodules) | ⚠️ one repo = focused workspace; submodules listed in dropdown |
| Avatars | ⚠️ worker fetch, opt-in setting |

### Commit details / comparison
| Feature | Decision |
| --- | --- |
| Details pane: author, committer, date, parents, body, signature | ✅ |
| File change tree/list with A/M/D/R status, additions/deletions | ✅ |
| Compare two commits (Ctrl/Cmd-click), compare with uncommitted | ✅ |
| URLs and issue links in body open in browser | ✅ `shell.openExternal` |
| View diff of a file | ⚠️ unified/side-by-side diff drawn in the panel from `git diff` |
| View file at revision | ⚠️ read-only viewer in the panel (`git show rev:path`) |
| Open current file | ✅ `editor.open` |
| Copy path / hash / names | ⚠️ `navigator.clipboard`; verify it works in the sandboxed frame, else show a select-all text box |
| Code review (track reviewed files, persist, expire after 90 days) | ✅ storage |

### Git actions (context menus)
| Area | Actions | Decision |
| --- | --- | --- |
| Branch | create, checkout, rename, delete (force), merge (ff/no-ff/squash), rebase, reset, push (set-upstream, force-with-lease), pull, fetch into local, delete remote branch | ✅ |
| Commit | checkout (detached), create branch, add tag (light/annotated, push), cherry-pick (mainline, no-commit), revert, drop, merge, rebase onto, reset soft/mixed/hard, copy hash/subject, archive | ✅ archive via `files.saveAs` |
| Tag | delete (local/remote), push, view annotated tag details | ✅ |
| Stash | apply, pop, drop, create branch from, push stash (include untracked) | ✅ |
| Uncommitted | stash, reset, clean untracked (+dirs) | ✅ |
| Remote | add, edit, delete, fetch, prune | ✅ |
| Create pull request (GitHub/GitLab/Bitbucket/custom) | ✅ build URL, `shell.openExternal` |
| Interactive rebase | ❌ (extension doesn't do it either) |

Every destructive action (reset hard, force push, delete, drop, clean) needs a confirmation dialog. Every action shells out with argument arrays (`execFile`), never a shell string.

### Repository settings widget
| Feature | Decision |
| --- | --- |
| Remotes table (view/add/edit/delete/fetch/prune) | ✅ |
| user.name / user.email (local + global) | ✅ |
| Issue linking regex + URL template | ✅ |
| Pull request provider config | ✅ |
| Export config to `.vscode/vscode-git-graph.json` | ⚠️ write `.orca/git-graph.json` instead, read both |

### Keyboard shortcuts
Cmd/Ctrl+F find, +H scroll to HEAD, +R refresh, +S / Shift+S next/prev stash, Up/Down and Cmd+Up/Down navigation in details, Enter/Escape in dialogs. ✅ (panel key handlers; check they don't clash with Orca shortcuts while the panel has focus).

### Dropped
Status bar item, VS Code SCM integration ("view SCM"), editor-group placement settings, tab icon colour theme, `retainContextWhenHidden`, add/remove repository commands (Orca owns workspaces), "open to repo of active text editor".

### Settings to expose (`contributes.settings`, max useful subset)
`graphStyle` (rounded/angular), `colours` (comma list), `firstParentOnly`, `initialLoadCommits`, `loadMoreCommits`, `dateFormat` (date+time / date / relative), `dateType` (author/commit), `showRemoteBranches`, `showTags`, `showStashes`, `showUncommittedChanges`, `showUntrackedFiles`, `muteMergeCommits`, `useMailmap`, `showSignatureStatus`, `fetchAvatars`, `refLabelAlignment`, `customBranchGlobPatterns` (multiline), `customEmojiShortcodes` (multiline JSON). Orca settings are scalar only, so lists use multiline strings parsed in the worker.

## 3. Code layout

```
src/shared/protocol.ts        all request/response types
src/worker/main.ts            activate, handler registry, repo resolution
src/worker/git/run.ts         execFile wrapper: cwd, env, timeout, error mapping
src/worker/git/log.ts         commits + refs + stashes + status
src/worker/git/details.ts     commit details, file changes, numstat, compare
src/worker/git/diff.ts        file diff, file at revision
src/worker/git/actions.ts     branch/commit/tag/stash/remote/uncommitted actions
src/worker/git/config.ts      remotes, user, repo config file
src/worker/watch.ts           .git watcher + long-poll
src/worker/avatars.ts
src/worker/state.ts           storage: view state, code reviews
src/panel/graph/layout.ts     lane assignment (pure, unit-tested)
src/panel/graph/Graph.tsx     SVG rendering
src/panel/components/         CommitTable, RefLabel, DetailsPane, FileTree, DiffView,
                              FindWidget, BranchFilter, ContextMenu, Dialog, SettingsWidget
src/panel/state.ts            store (signals or reducer)
```

## 4. Phases

Each phase ends with typecheck, tests, `orca plugin validate .`, reload and an `orca plugin shot`.

1. **Graph core.** Lane layout algorithm (pure function, tests for merges, octopus, orphan roots, first-parent), SVG graph, commit table with columns, ref labels (branch/remote/tag/HEAD/stash), uncommitted row, load more. Settings: style, colours, load counts, date format.
2. **Refresh + state.** `.git` watcher with long-poll, repo resolution for submodules, persisted view state (column widths, filter, scroll), branch filter, show/hide toggles.
3. **Commit details.** Details pane, file list/tree, compare two commits and with working tree, in-panel diff viewer, file at revision, open file, copy actions, URL/issue links.
4. **Read-only extras.** Find widget, hover tooltip, keyboard shortcuts, emoji, signature status, mailmap, avatars.
5. **Git actions.** Context menus + dialogs for branch, commit, tag, stash, uncommitted, with confirmations. Auth-failure fallback to terminal. Tests per action against temp repos.
6. **Repository settings.** Remotes, user details, issue linking, PR creation, config export/import.
7. **Code review.** Reviewed-file tracking, persistence, 90-day expiry.
8. **Release.** README, CHANGELOG, icon, catalog metadata, performance check on a large repo (e.g. 50k commits with paging).

## 5. Risks and open questions

- **License** (section 0): clean-room only.
- **No diff API in Orca**: an in-panel diff viewer is the largest UI piece outside the graph.
- **No worker→panel push**: long-poll `graph.watch` must handle panel reload and worker restart.
- **Clipboard in the sandboxed frame**: unverified.
- **Credentials**: no askpass; auth failures fall back to running the command in an Orca terminal.
- **Repo path**: still resolved by matching workspace name + branch (see README); ambiguous if two workspaces share both.
- **Remote hosts** (`hostId` non-null in `workspace.list`): git runs locally in the worker, so SSH workspaces are unsupported at first.
- **Performance**: big repos need paging and virtualised rows; `plugin.request` output size limits are unknown, so page commits (e.g. 300 per request).
