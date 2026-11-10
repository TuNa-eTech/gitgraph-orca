import path from 'node:path'
import {
  UNCOMMITTED,
  type Commit,
  type GraphSettings,
  type Ref,
  type RepoConfig,
  type SignatureStatus
} from '../../shared/protocol'
import { git, gitTry } from './run'

const ORDER_FLAGS = { date: '--date-order', 'author-date': '--author-date-order', topo: '--topo-order' } as const

const FIELD = '\x1f'
const RECORD = '\x1e'

const SIGNATURE_STATUSES = new Set<string>(['G', 'B', 'U', 'X', 'Y', 'R', 'E', 'N'])

export type LogResult = {
  commits: Commit[]
  head: string | null
  headBranch: string | null
  branches: string[]
  remoteBranches: string[]
  remotes: string[]
  hasMore: boolean
}

type RefTables = {
  byHash: Map<string, Ref[]>
  branches: string[]
  remoteBranches: string[]
  remotes: string[]
}

/** A branch-filter entry is a glob when it contains wildcard characters. */
export function isGlob(entry: string): boolean {
  return /[*?[]/.test(entry)
}

/** `Name|glob` lines (or a bare glob) from the `customBranchGlobPatterns` setting. */
export function parseGlobPatterns(text: string): { name: string; glob: string }[] {
  const result: { name: string; glob: string }[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    const bar = line.indexOf('|')
    if (bar < 0) result.push({ name: line, glob: line })
    else {
      const name = line.slice(0, bar).trim()
      const glob = line.slice(bar + 1).trim()
      if (glob !== '') result.push({ name: name === '' ? glob : name, glob })
    }
  }
  return result
}

export async function loadLog(
  cwd: string,
  options: {
    limit: number
    branches: string[]
    settings: GraphSettings
    config: RepoConfig
    signal: AbortSignal
  }
): Promise<LogResult> {
  const { limit, settings, config, signal } = options
  const hidden = new Set(config.hideRemotes)

  const [refs, headHash, headBranch] = await Promise.all([
    readRefs(cwd, settings, hidden, signal),
    gitTry(cwd, ['rev-parse', '--verify', '-q', 'HEAD^{commit}'], { signal }),
    gitTry(cwd, ['symbolic-ref', '--short', '-q', 'HEAD'], { signal })
  ])
  const head = headHash === null ? null : headHash.trim()

  const revArgs = buildRevisionArgs(options.branches, refs, settings, hidden, head !== null)
  let commits: Commit[] = []
  let hasMore = false
  if (revArgs !== null) {
    const args = ['log', ORDER_FLAGS[settings.commitOrder], `--max-count=${limit + 1}`, `--format=${logFormat(settings)}`]
    if (settings.firstParentOnly) args.push('--first-parent')
    args.push(...revArgs, '--')
    const stdout = await git(cwd, args, { signal })
    commits = parseLog(stdout, settings)
    if (commits.length > limit) {
      hasMore = true
      commits.length = limit
    }
    for (const commit of commits) commit.refs = refs.byHash.get(commit.hash) ?? []
  }

  if (settings.showStashes && head !== null) {
    const stashes = await readStashes(cwd, settings, signal)
    commits = mergeStashes(commits, stashes)
  }

  return {
    commits,
    head,
    headBranch: headBranch === null ? null : headBranch.trim() || null,
    branches: refs.branches,
    remoteBranches: refs.remoteBranches,
    remotes: refs.remotes,
    hasMore
  }
}

function logFormat(settings: GraphSettings): string {
  const name = settings.useMailmap ? '%aN' : '%an'
  const email = settings.useMailmap ? '%aE' : '%ae'
  const time = settings.dateType === 'commit' ? '%ct' : '%at'
  const fields = ['%H', '%P', name, email, time, '%s']
  if (settings.showSignatureStatus) fields.push('%G?')
  return fields.join('%x1f') + '%x1e'
}

export function parseLog(stdout: string, settings: Pick<GraphSettings, 'showSignatureStatus'>): Commit[] {
  const commits: Commit[] = []
  for (const record of stdout.split(RECORD)) {
    const line = record.replace(/^\n/, '')
    if (line === '') continue
    const [hash, parents, author, email, time, subject, signature] = line.split(FIELD)
    const commit: Commit = {
      hash,
      parents: parents === '' ? [] : parents.split(' '),
      author,
      email,
      time: Number(time),
      refs: [],
      subject
    }
    if (settings.showSignatureStatus && signature !== undefined && SIGNATURE_STATUSES.has(signature)) {
      commit.signature = signature as SignatureStatus
    }
    commits.push(commit)
  }
  return commits
}

async function readRefs(
  cwd: string,
  settings: GraphSettings,
  hidden: Set<string>,
  signal: AbortSignal
): Promise<RefTables> {
  const [refOut, remoteOut] = await Promise.all([
    git(
      cwd,
      [
        'for-each-ref',
        '--format=%(objectname)%00%(*objectname)%00%(objecttype)%00%(refname)',
        'refs/heads',
        'refs/remotes',
        'refs/tags'
      ],
      { signal }
    ),
    git(cwd, ['remote'], { signal })
  ])
  const remotes = remoteOut.split('\n').filter((name) => name !== '')
  const byLength = [...remotes].sort((a, b) => b.length - a.length)
  const byHash = new Map<string, Ref[]>()
  const branches: string[] = []
  const remoteBranches: string[] = []
  const add = (hash: string, ref: Ref): void => {
    const list = byHash.get(hash)
    if (list === undefined) byHash.set(hash, [ref])
    else list.push(ref)
  }
  for (const line of refOut.split('\n')) {
    if (line === '') continue
    const [objectName, peeled, objectType, refName] = line.split('\0')
    if (refName.startsWith('refs/heads/')) {
      const name = refName.slice('refs/heads/'.length)
      branches.push(name)
      add(objectName, { kind: 'head', name })
    } else if (refName.startsWith('refs/remotes/')) {
      if (!settings.showRemoteBranches) continue
      const short = refName.slice('refs/remotes/'.length)
      if (short.endsWith('/HEAD')) continue
      const remote = byLength.find((candidate) => short.startsWith(candidate + '/')) ?? short.split('/')[0]
      if (hidden.has(remote)) continue
      remoteBranches.push(short)
      add(objectName, { kind: 'remote', name: short, remote })
    } else if (refName.startsWith('refs/tags/')) {
      if (!settings.showTags) continue
      const annotated = objectType === 'tag'
      const ref: Ref = { kind: 'tag', name: refName.slice('refs/tags/'.length) }
      if (annotated) ref.annotated = true
      add(annotated && peeled !== '' ? peeled : objectName, ref)
    }
  }
  const order = { head: 0, remote: 1, tag: 2, stash: 3 } as const
  for (const list of byHash.values()) {
    list.sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name))
  }
  branches.sort((a, b) => a.localeCompare(b))
  remoteBranches.sort((a, b) => a.localeCompare(b))
  return { byHash, branches, remoteBranches, remotes }
}

/**
 * Revision arguments for `git log`, or null when the filter selects nothing.
 * No filter: every branch, tag and (visible) remote branch plus HEAD.
 */
function buildRevisionArgs(
  filter: string[],
  refs: RefTables,
  settings: GraphSettings,
  hidden: Set<string>,
  hasHead: boolean
): string[] | null {
  const args: string[] = []
  const entries = filter.filter((entry) => entry.trim() !== '')
  if (entries.length === 0) {
    args.push('--branches')
    if (settings.showTags) args.push('--tags')
    if (settings.showRemoteBranches) {
      for (const remote of hidden) args.push(`--exclude=${remote}/*`)
      args.push('--remotes')
    }
    if (hasHead) args.push('HEAD')
    return args
  }
  const custom = parseGlobPatterns(settings.customBranchGlobPatterns)
  const localSet = new Set(refs.branches)
  for (const entry of entries) {
    const pattern = custom.find((candidate) => candidate.name === entry)
    if (pattern !== undefined) {
      args.push(`--glob=${pattern.glob}`)
    } else if (isGlob(entry)) {
      if (entry.startsWith('refs/')) args.push(`--glob=${entry}`)
      else args.push(`--branches=${entry}`, ...(settings.showRemoteBranches ? [`--remotes=${entry}`] : []))
    } else if (localSet.has(entry)) {
      args.push(`refs/heads/${entry}`)
    } else if (refs.remoteBranches.includes(entry)) {
      args.push(`refs/remotes/${entry}`)
    } else if (entry === 'HEAD' && hasHead) {
      args.push('HEAD')
    }
  }
  return args.length === 0 ? null : args
}

type StashEntry = { commit: Commit; baseHash: string }

async function readStashes(cwd: string, settings: GraphSettings, signal: AbortSignal): Promise<StashEntry[]> {
  const name = settings.useMailmap ? '%aN' : '%an'
  const email = settings.useMailmap ? '%aE' : '%ae'
  const time = settings.dateType === 'commit' ? '%ct' : '%at'
  const format = ['%H', '%P', name, email, time, '%s', '%gd'].join('%x1f') + '%x1e'
  const stdout = await gitTry(cwd, ['stash', 'list', `--format=${format}`], { signal })
  if (stdout === null) return []
  const result: StashEntry[] = []
  for (const record of stdout.split(RECORD)) {
    const line = record.replace(/^\n/, '')
    if (line === '') continue
    const [hash, parents, author, authorEmail, at, subject, selector] = line.split(FIELD)
    const baseHash = parents.split(' ')[0]
    if (baseHash === undefined || baseHash === '') continue
    result.push({
      baseHash,
      commit: {
        hash,
        parents: [baseHash],
        author,
        email: authorEmail,
        time: Number(at),
        refs: [{ kind: 'stash', name: selector }],
        subject,
        stash: selector
      }
    })
  }
  return result
}

/**
 * Puts each stash above its base commit, and by time among the others. A stash whose base
 * is not in the loaded page is left out (it would be an orphan row).
 */
function mergeStashes(commits: Commit[], stashes: StashEntry[]): Commit[] {
  if (stashes.length === 0) return commits
  const merged = [...commits]
  // Oldest first so newer stashes on the same base end up above older ones.
  for (const stash of [...stashes].reverse()) {
    const baseIndex = merged.findIndex((commit) => commit.hash === stash.baseHash)
    if (baseIndex < 0) continue
    let at = merged.findIndex((commit) => commit.time <= stash.commit.time)
    if (at < 0 || at > baseIndex) at = baseIndex
    merged.splice(at, 0, stash.commit)
  }
  return merged
}

/** The uncommitted-changes pseudo commit, or null when the working tree is clean. */
export async function readUncommitted(
  cwd: string,
  head: string | null,
  settings: GraphSettings,
  signal: AbortSignal
): Promise<Commit | null> {
  const stdout = await gitTry(
    cwd,
    ['status', '--porcelain=v1', '-z', settings.showUntrackedFiles ? '--untracked-files=normal' : '--untracked-files=no'],
    { signal }
  )
  if (stdout === null) return null
  // Entries are NUL separated; a rename/copy entry is followed by its source path.
  let count = 0
  const parts = stdout.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]
    if (entry.length < 4) continue
    count++
    if (entry[0] === 'R' || entry[0] === 'C' || entry[1] === 'R' || entry[1] === 'C') i++
  }
  if (count === 0) return null
  return {
    hash: UNCOMMITTED,
    parents: head === null ? [] : [head],
    author: '*',
    email: '',
    time: Math.floor(Date.now() / 1000),
    refs: [],
    subject: `Uncommitted Changes (${count})`
  }
}

/** Absolute `.git` directories: `[gitDir, commonDir]` (they differ in linked worktrees). */
export async function gitDirs(cwd: string, signal?: AbortSignal): Promise<{ gitDir: string; commonDir: string }> {
  const out = await git(cwd, ['rev-parse', '--absolute-git-dir', '--git-common-dir'], { signal })
  const [gitDir, common] = out.split('\n')
  return { gitDir, commonDir: path.resolve(cwd, common) }
}
