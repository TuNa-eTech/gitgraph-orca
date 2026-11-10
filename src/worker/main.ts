// The plugin's worker: a Node process Orca starts on the panel's first `plugin.request`.
// Panels are sandboxed frames with no file system, so every `git` call runs here.
import type { OrcaWorkerApi } from 'orca/worker'
import {
  DEFAULT_COMMIT_LIMIT,
  MAX_COMMIT_LIMIT,
  type GraphLoadResult,
  type GraphWorkspace
} from '../shared/protocol'
import { readGitLog } from './git-log'

export default function activate(orca: OrcaWorkerApi): void {
  orca.panels.handle('graph.load', async (input, { signal }) => {
    const limit = clampLimit(input?.limit)
    return loadGraph(orca, limit, signal)
  })
}

async function loadGraph(
  orca: OrcaWorkerApi,
  limit: number,
  signal: AbortSignal
): Promise<GraphLoadResult> {
  const context = await orca.host.call('workspace.readContext', {}, { signal })
  if (context === null) return { status: 'no-workspace' }

  const workspace = await findFocusedWorkspace(orca, context, signal)
  if (workspace === null) {
    return { status: 'not-found', displayName: context.displayName, branch: context.branch }
  }

  try {
    const { commits, truncated } = await readGitLog(workspace.path, limit, signal)
    return { status: 'ok', workspace, commits, truncated }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    orca.log(`git log failed in ${workspace.path}: ${message}`)
    return { status: 'git-error', workspace, message }
  }
}

/**
 * `workspace.readContext` names the focused workspace but gives no path or id, so match it
 * against `workspace.list` by name, preferring the entry on the same branch.
 */
async function findFocusedWorkspace(
  orca: OrcaWorkerApi,
  context: { displayName: string; branch: string },
  signal: AbortSignal
): Promise<GraphWorkspace | null> {
  const { workspaces } = await orca.host.call('workspace.list', {}, { signal })
  const headPrefix = /^refs\/heads\//
  const branch = context.branch.replace(headPrefix, '')
  const named = workspaces.filter((workspace) => workspace.name === context.displayName)
  const match =
    named.find((workspace) => workspace.branch?.replace(headPrefix, '') === branch) ??
    named[0] ??
    null
  if (match === null) return null
  return { id: match.id, name: match.name, path: match.path, branch: match.branch }
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isInteger(limit) || limit < 1) return DEFAULT_COMMIT_LIMIT
  return Math.min(limit, MAX_COMMIT_LIMIT)
}
