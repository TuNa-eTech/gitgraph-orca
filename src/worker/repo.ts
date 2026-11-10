import { existsSync } from 'node:fs'
import path from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'
import type { GraphLoadResult, GraphWorkspace } from '../shared/protocol'
import { git, gitTry } from './git/run'

/** A resolved repository: the workspace's top level, or one of its submodules. */
export type RepoContext = {
  workspace: GraphWorkspace
  /** The Orca workspace's own path (file paths for `editor.open` are relative to it). */
  workspacePath: string
  /** Directory git runs in: the top level, or `<top level>/<repoPath>`. */
  cwd: string
  /** Submodule path relative to the root, or '' for the root repository. */
  repoPath: string
  submodules: string[]
}

export type ResolveResult =
  | { status: 'ok'; repo: RepoContext }
  | Exclude<GraphLoadResult, { status: 'ok' }>

const topLevels = new Map<string, string>()

/**
 * `workspace.readContext` names the focused workspace but gives no path or id, so match it
 * against `workspace.list` by name, preferring the entry on the same branch.
 */
export async function findFocusedWorkspace(
  orca: OrcaWorkerApi,
  signal: AbortSignal
): Promise<
  | { status: 'ok'; workspace: { id: string; name: string; path: string; branch: string | null } }
  | { status: 'no-workspace' }
  | { status: 'not-found'; displayName: string; branch: string }
> {
  const context = await orca.host.call('workspace.readContext', {}, { signal })
  if (context === null) return { status: 'no-workspace' }
  const { workspaces } = await orca.host.call('workspace.list', {}, { signal })
  const headPrefix = /^refs\/heads\//
  const branch = context.branch.replace(headPrefix, '')
  const named = workspaces.filter((workspace) => workspace.name === context.displayName)
  const match =
    named.find((workspace) => workspace.branch?.replace(headPrefix, '') === branch) ?? named[0] ?? null
  if (match === null) return { status: 'not-found', displayName: context.displayName, branch: context.branch }
  return { status: 'ok', workspace: { id: match.id, name: match.name, path: match.path, branch: match.branch } }
}

export async function resolveRepo(
  orca: OrcaWorkerApi,
  repoPath: string | undefined,
  signal: AbortSignal
): Promise<ResolveResult> {
  const found = await findFocusedWorkspace(orca, signal)
  if (found.status !== 'ok') return found
  const { workspace } = found
  let root: string
  try {
    root = await topLevel(workspace.path, signal)
  } catch (error) {
    return { status: 'git-error', workspace: { ...workspace, path: workspace.path }, message: messageOf(error) }
  }
  const graphWorkspace: GraphWorkspace = { ...workspace, path: root }
  let submodules: string[]
  try {
    submodules = await listSubmodules(root, signal)
  } catch {
    submodules = []
  }
  let cwd = root
  let relative = ''
  if (repoPath !== undefined && repoPath !== '') {
    const normalised = normaliseRelative(repoPath)
    if (normalised === null || !submodules.includes(normalised)) {
      return { status: 'git-error', workspace: graphWorkspace, message: `Not a submodule of this repository: ${repoPath}` }
    }
    cwd = path.join(root, normalised)
    relative = normalised
  }
  return {
    status: 'ok',
    repo: { workspace: graphWorkspace, workspacePath: workspace.path, cwd, repoPath: relative, submodules }
  }
}

/** Like `resolveRepo`, but throws; for requests that need a repository to exist. */
export async function requireRepo(
  orca: OrcaWorkerApi,
  repoPath: string | undefined,
  signal: AbortSignal
): Promise<RepoContext> {
  const result = await resolveRepo(orca, repoPath, signal)
  if (result.status === 'ok') return result.repo
  switch (result.status) {
    case 'no-workspace':
      throw new Error('No workspace is focused.')
    case 'not-found':
      throw new Error(`Workspace "${result.displayName}" was not found.`)
    case 'git-error':
      throw new Error(result.message)
  }
}

async function topLevel(workspacePath: string, signal: AbortSignal): Promise<string> {
  const cached = topLevels.get(workspacePath)
  if (cached !== undefined && existsSync(cached)) return cached
  const out = (await git(workspacePath, ['rev-parse', '--show-toplevel'], { signal })).trim()
  const root = path.normalize(out)
  topLevels.set(workspacePath, root)
  return root
}

/** Initialised submodules, as paths relative to the root with forward slashes. */
async function listSubmodules(root: string, signal: AbortSignal): Promise<string[]> {
  if (!existsSync(path.join(root, '.gitmodules'))) return []
  const out = await gitTry(root, ['config', '--file', '.gitmodules', '-z', '--get-regexp', '^submodule\\..*\\.path$'], {
    signal
  })
  if (out === null) return []
  const result: string[] = []
  for (const entry of out.split('\0')) {
    const newline = entry.indexOf('\n')
    if (newline < 0) continue
    const value = normaliseRelative(entry.slice(newline + 1))
    if (value !== null && existsSync(path.join(root, value, '.git'))) result.push(value)
  }
  return result.sort()
}

/** A forward-slash relative path without `..`, `.` or absolute parts; null if unusable. */
export function normaliseRelative(input: string): string | null {
  const parts = input.replace(/\\/g, '/').split('/').filter((part) => part !== '' && part !== '.')
  if (parts.length === 0 || parts.some((part) => part === '..') || /^[a-zA-Z]:$/.test(parts[0])) return null
  if (input.startsWith('/') || input.startsWith('\\')) return null
  return parts.join('/')
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
