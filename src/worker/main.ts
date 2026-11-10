// The plugin's worker: a Node process Orca starts on the panel's first `plugin.request`.
// Panels are sandboxed frames with no file system, so every `git` call runs here.
import { realpathSync } from 'node:fs'
import path from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'
import {
  DEFAULT_COMMIT_LIMIT,
  MAX_COMMIT_LIMIT,
  type GraphLoadResult
} from '../shared/protocol'
import { runAction, archive, isTerminalCommand, terminalCommandLine } from './git/actions'
import { commitDetails, compareFiles, containedIn, tagDetails, uncommittedFiles } from './git/details'
import { fileAtRevision, fileDiff } from './git/diff'
import { loadLog, readUncommitted } from './git/log'
import { exportConfig, loadConfig, readRepoSettings, saveConfig } from './git/config'
import { normaliseRelative, requireRepo, resolveRepo, messageOf } from './repo'
import { readSettings } from './settings'
import { endReview, getReview, loadView, saveView, startReview, updateReview } from './state'
import { getAvatar } from './avatars'
import { RepoWatcher } from './watch'

let watcher: RepoWatcher | null = null

export default function activate(orca: OrcaWorkerApi): void {
  const current = new RepoWatcher((cwd) => orca.panels.post('graph.changed', { path: cwd }))
  watcher = current

  orca.panels.handle('graph.load', async (input, { signal }) => {
    const resolved = await resolveRepo(orca, input?.repoPath, signal)
    if (resolved.status !== 'ok') return resolved
    const { repo } = resolved
    const settings = await readSettings(orca)
    try {
      const config = await loadConfig(orca, repo.cwd)
      const limit = clampLimit(input?.limit, settings.initialLoadCommits)
      const log = await loadLog(repo.cwd, {
        limit,
        branches: input?.branches ?? [],
        settings,
        config,
        signal
      })
      let commits = log.commits
      if (settings.showUncommittedChanges) {
        const uncommitted = await readUncommitted(repo.cwd, log.head, settings, signal)
        if (uncommitted !== null) commits = [uncommitted, ...commits]
      }
      void current.watch(repo.cwd)
      const result: GraphLoadResult = {
        status: 'ok',
        workspace: repo.workspace,
        commits,
        head: log.head,
        headBranch: log.headBranch,
        branches: log.branches,
        remotes: log.remotes,
        hasMore: log.hasMore,
        submodules: repo.submodules
      }
      return result
    } catch (error) {
      const message = messageOf(error)
      orca.log(`git log failed in ${repo.cwd}: ${message}`)
      return { status: 'git-error', workspace: repo.workspace, message } satisfies GraphLoadResult
    }
  })

  orca.panels.handle('commit.details', async (input, { signal }) => {
    const repo = await requireRepo(orca, input.repoPath, signal)
    return commitDetails(repo.cwd, input.hash, await readSettings(orca), signal)
  })

  orca.panels.handle('commit.uncommitted', async (input, { signal }) => {
    const repo = await requireRepo(orca, input?.repoPath, signal)
    return { files: await uncommittedFiles(repo.cwd, signal) }
  })

  orca.panels.handle('commit.compare', async (input, { signal }) => {
    const repo = await requireRepo(orca, input.repoPath, signal)
    return { files: await compareFiles(repo.cwd, input.from, input.to, signal) }
  })

  orca.panels.handle('file.diff', async (input, { signal }) => {
    const repo = await requireRepo(orca, input.repoPath, signal)
    return fileDiff(repo.cwd, input, signal)
  })

  orca.panels.handle('file.atRevision', async (input, { signal }) => {
    const repo = await requireRepo(orca, input.repoPath, signal)
    return fileAtRevision(repo.cwd, input.rev, input.path, signal)
  })

  orca.panels.handle('file.open', async (input, { signal }) => {
    const repo = await requireRepo(orca, input.repoPath, signal)
    const relative = normaliseRelative(input.path)
    if (relative === null) throw new Error(`Invalid path: ${input.path}`)
    // `editor.open` paths are relative to the Orca workspace, which may be above a submodule.
    const inWorkspace = path.posix.join(repo.repoPath, relative)
    const rootToWorkspace = path.relative(realpathSync(repo.workspacePath), realpathSync(repo.workspace.path)).split(path.sep).join('/')
    const full = rootToWorkspace === '' ? inWorkspace : path.posix.join(rootToWorkspace, inWorkspace)
    const result = await orca.host.call(
      'editor.open',
      { workspaceId: repo.workspace.id, path: full },
      { signal }
    )
    return { opened: result.opened }
  })

  orca.panels.handle('tag.details', async (input, { signal }) => {
    const repo = await requireRepo(orca, input.repoPath, signal)
    return tagDetails(repo.cwd, input.name, signal)
  })

  orca.panels.handle('commit.containedIn', async (input, { signal }) => {
    const repo = await requireRepo(orca, input.repoPath, signal)
    return containedIn(repo.cwd, input.hash, signal)
  })

  orca.panels.handle('action.run', async (input, { signal }) => {
    const repo = await requireRepo(orca, input.repoPath, signal)
    return current.whileBusy(() => runAction(repo.cwd, input.action, signal))
  })

  orca.panels.handle('action.runInTerminal', async (input, { signal }) => {
    if (!isTerminalCommand(input.command)) throw new Error('This command cannot be run from the graph.')
    const repo = await requireRepo(orca, input.repoPath, signal)
    const command = terminalCommandLine(input.command, repo.cwd)
    const { terminalId } = await orca.host.call(
      'terminal.create',
      { workspaceId: repo.workspace.id, title: `git ${input.command[0] === 'git' ? input.command[1] : input.command[0]}`, command },
      { signal }
    )
    return { terminalId }
  })

  orca.panels.handle('commit.archive', async (input, { signal }) => {
    const repo = await requireRepo(orca, input.repoPath, signal)
    return archive(repo.cwd, input.ref, input.format, signal)
  })

  orca.panels.handle('repo.settings', async (input, { signal }) => {
    const repo = await requireRepo(orca, input?.repoPath, signal)
    return readRepoSettings(orca, repo.cwd, signal)
  })

  orca.panels.handle('repo.saveConfig', async (input, { signal }) => {
    const repo = await requireRepo(orca, input.repoPath, signal)
    await saveConfig(orca, repo.cwd, input.config)
    return { ok: true as const }
  })

  orca.panels.handle('repo.exportConfig', async (input, { signal }) => {
    const repo = await requireRepo(orca, input?.repoPath, signal)
    return { path: await exportConfig(orca, repo.cwd) }
  })

  orca.panels.handle('view.load', async (input, { signal }) => {
    const repo = await requireRepo(orca, input?.repoPath, signal)
    return loadView(orca, repo.cwd)
  })

  orca.panels.handle('view.save', async (input, { signal }) => {
    const repo = await requireRepo(orca, input.repoPath, signal)
    await saveView(orca, repo.cwd, input.state)
    return { ok: true as const }
  })

  orca.panels.handle('review.get', async (input, { signal }) => {
    const repo = await requireRepo(orca, input.repoPath, signal)
    return getReview(orca, repo.cwd, input.key)
  })

  orca.panels.handle('review.start', async (input, { signal }) => {
    const repo = await requireRepo(orca, input.repoPath, signal)
    return startReview(orca, repo.cwd, input.key, input.files)
  })

  orca.panels.handle('review.update', async (input, { signal }) => {
    const repo = await requireRepo(orca, input.repoPath, signal)
    return updateReview(orca, repo.cwd, input.id, input.reviewed)
  })

  orca.panels.handle('review.end', async (input, { signal }) => {
    const repo = await requireRepo(orca, input.repoPath, signal)
    await endReview(orca, repo.cwd, input.id)
    return { ok: true as const }
  })

  orca.panels.handle('avatar.get', async (input) => {
    const settings = await readSettings(orca)
    if (!settings.fetchAvatars) return { dataUri: null }
    return { dataUri: await getAvatar(orca, input.email) }
  })
}

export function deactivate(): void {
  watcher?.close()
  watcher = null
}

function clampLimit(limit: number | undefined, fallback: number): number {
  if (limit === undefined || !Number.isInteger(limit) || limit < 1) {
    return Math.min(Math.max(1, Math.floor(fallback) || DEFAULT_COMMIT_LIMIT), MAX_COMMIT_LIMIT)
  }
  return Math.min(limit, MAX_COMMIT_LIMIT)
}
