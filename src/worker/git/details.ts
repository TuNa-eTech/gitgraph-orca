import { UNCOMMITTED, type CommitDetails, type FileChange, type FileStatus, type GraphSettings, type SignatureStatus, type TagDetails } from '../../shared/protocol'
import { safeHash, safeRef } from './args'
import { emptyTree, git, gitTry, runGit } from './run'

const FIELD = '\x1f'
const SIGNATURE_STATUSES = new Set<string>(['G', 'B', 'U', 'X', 'Y', 'R', 'E', 'N'])
/** Untracked files get an exact line count up to this many; the rest show no counts. */
const MAX_UNTRACKED_COUNTED = 50

export async function commitDetails(
  cwd: string,
  hash: string,
  settings: GraphSettings,
  signal: AbortSignal
): Promise<CommitDetails> {
  if (hash === UNCOMMITTED) throw new Error('Use commit.uncommitted for uncommitted changes.')
  safeHash(hash)
  const fields = ['%H', '%P', '%an', '%ae', '%at', '%cn', '%ce', '%ct', '%s']
  if (settings.showSignatureStatus) fields.push('%G?', '%GS', '%GK')
  fields.push('%b')
  const args = ['log', '-1', '--no-walk', `--format=${fields.join('%x1f')}`]
  if (settings.useMailmap) args.push('--use-mailmap')
  args.push(hash, '--')
  const out = await git(cwd, args, { signal })
  const parts = out.split(FIELD)
  const [full, parents, author, authorEmail, authorTime, committer, committerEmail, committerTime, subject] = parts
  const details: CommitDetails = {
    hash: full.trim(),
    parents: parents === '' ? [] : parents.split(' '),
    author,
    authorEmail,
    authorTime: Number(authorTime),
    committer,
    committerEmail,
    committerTime: Number(committerTime),
    subject,
    body: '',
    files: []
  }
  let rest = 9
  if (settings.showSignatureStatus) {
    const status = parts[9]
    if (SIGNATURE_STATUSES.has(status) && status !== 'N') {
      details.signature = { status: status as SignatureStatus, signer: parts[10] ?? '', key: parts[11] ?? '' }
    }
    rest = 12
  }
  details.body = parts.slice(rest).join(FIELD).trim()
  const base = details.parents[0] ?? (await emptyTree(cwd))
  details.files = await changedFiles(cwd, base, details.hash, signal)
  return details
}

/** Files that differ between two commits; either side may be UNCOMMITTED (the working tree). */
export async function compareFiles(cwd: string, from: string, to: string, signal: AbortSignal): Promise<FileChange[]> {
  if (from === UNCOMMITTED && to === UNCOMMITTED) return []
  if (to === UNCOMMITTED) return uncommittedVersus(cwd, safeHash(from), false, signal)
  if (from === UNCOMMITTED) return uncommittedVersus(cwd, safeHash(to), true, signal)
  return changedFiles(cwd, safeHash(from), safeHash(to), signal)
}

/** Working tree against HEAD. */
export async function uncommittedFiles(cwd: string, signal: AbortSignal): Promise<FileChange[]> {
  const head = await gitTry(cwd, ['rev-parse', '--verify', '-q', 'HEAD^{commit}'], { signal })
  return uncommittedVersus(cwd, head === null ? await emptyTree(cwd) : head.trim(), false, signal)
}

/**
 * Working tree against `rev`. `reverse` reports changes from the working tree to `rev` instead
 * (what comparing UNCOMMITTED -> rev shows).
 */
async function uncommittedVersus(cwd: string, rev: string, reverse: boolean, signal: AbortSignal): Promise<FileChange[]> {
  const files = await changedFiles(cwd, rev, null, signal, reverse)
  const untracked = (await git(cwd, ['ls-files', '--others', '--exclude-standard', '-z'], { signal }))
    .split('\0')
    .filter((entry) => entry !== '')
  const known = new Set(files.map((file) => file.path))
  let counted = 0
  for (const filePath of untracked) {
    if (known.has(filePath)) continue
    let additions: number | null = null
    if (counted < MAX_UNTRACKED_COUNTED) {
      counted++
      additions = await countUntrackedLines(cwd, filePath, signal)
    }
    files.push(
      reverse
        ? { status: 'D', path: filePath, additions: null, deletions: additions }
        : { status: 'U', path: filePath, additions, deletions: additions === null ? null : 0 }
    )
  }
  return sortFiles(files)
}

async function countUntrackedLines(cwd: string, filePath: string, signal: AbortSignal): Promise<number | null> {
  // `git diff --no-index` exits 1 when the files differ.
  const result = await runGit(cwd, ['diff', '--no-index', '--numstat', '--', '/dev/null', filePath], { signal })
  const added = (result.stdout.toString('utf8').split('\n')[0] ?? '').split('\t')[0]
  return /^\d+$/.test(added) ? Number(added) : null
}

/** `git diff --name-status` + `--numstat` between `base` and `target` (or the working tree). */
async function changedFiles(
  cwd: string,
  base: string,
  target: string | null,
  signal: AbortSignal,
  reverse = false
): Promise<FileChange[]> {
  const range = target === null ? [base] : [base, target]
  const common = ['diff', '--no-ext-diff', '--no-textconv', '--find-renames', '-z', ...(reverse ? ['-R'] : [])]
  const [statusOut, numstatOut] = await Promise.all([
    git(cwd, [...common, '--name-status', ...range, '--'], { signal }),
    git(cwd, [...common, '--numstat', ...range, '--'], { signal })
  ])
  return sortFiles(mergeChanges(parseNameStatus(statusOut), parseNumstat(numstatOut)))
}

type Entry = { status: FileStatus; path: string; oldPath?: string }

export function parseNameStatus(out: string): Entry[] {
  const tokens = out.split('\0')
  const entries: Entry[] = []
  for (let i = 0; i < tokens.length; i++) {
    const code = tokens[i]
    if (code === '') continue
    const letter = code[0]
    if (letter === 'R' || letter === 'C') {
      entries.push({ status: letter, oldPath: tokens[i + 1], path: tokens[i + 2] })
      i += 2
    } else {
      const status: FileStatus = letter === 'A' || letter === 'D' || letter === 'M' ? letter : letter === 'U' ? 'U' : 'M'
      entries.push({ status, path: tokens[i + 1] })
      i += 1
    }
  }
  return entries
}

type Count = { additions: number | null; deletions: number | null }

export function parseNumstat(out: string): Map<string, Count> {
  const counts = new Map<string, Count>()
  const tokens = out.split('\0')
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token === '') continue
    const [added, deleted, ...pathParts] = token.split('\t')
    const count: Count = {
      additions: /^\d+$/.test(added) ? Number(added) : null,
      deletions: /^\d+$/.test(deleted) ? Number(deleted) : null
    }
    const inline = pathParts.join('\t')
    if (inline === '') {
      // Rename: the old and new paths follow as separate entries.
      counts.set(tokens[i + 2], count)
      i += 2
    } else {
      counts.set(inline, count)
    }
  }
  return counts
}

function mergeChanges(entries: Entry[], counts: Map<string, Count>): FileChange[] {
  return entries.map((entry) => {
    const count = counts.get(entry.path) ?? { additions: null, deletions: null }
    const change: FileChange = { status: entry.status, path: entry.path, additions: count.additions, deletions: count.deletions }
    if (entry.oldPath !== undefined) change.oldPath = entry.oldPath
    return change
  })
}

function sortFiles(files: FileChange[]): FileChange[] {
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

export async function tagDetails(cwd: string, name: string, signal: AbortSignal): Promise<TagDetails> {
  safeRef(name, 'tag name')
  const format = ['%(objecttype)', '%(objectname)', '%(*objectname)', '%(taggername)', '%(taggeremail)', '%(taggerdate:unix)', '%(contents)'].join('%00')
  const out = await git(cwd, ['for-each-ref', `--format=${format}`, `refs/tags/${name}`], { signal })
  if (out.trim() === '') throw new Error(`Tag not found: ${name}`)
  const [type, objectName, peeled, tagger, email, date, ...message] = out.replace(/\n$/, '').split('\0')
  if (type !== 'tag') {
    return { name, hash: objectName, tagger: '', email: '', time: 0, message: '' }
  }
  return {
    name,
    hash: peeled || objectName,
    tagger,
    email: email.replace(/^<|>$/g, ''),
    time: Number(date) || 0,
    message: message.join('\0').trim()
  }
}

export async function containedIn(
  cwd: string,
  hash: string,
  signal: AbortSignal
): Promise<{ inHead: boolean; branches: string[]; tags: string[] }> {
  safeHash(hash)
  const [refs, tags, head] = await Promise.all([
    gitTry(cwd, ['for-each-ref', '--contains', hash, '--format=%(refname)', 'refs/heads', 'refs/remotes'], { signal, timeoutMs: 30_000 }),
    gitTry(cwd, ['for-each-ref', '--contains', hash, '--format=%(refname:short)', 'refs/tags'], { signal, timeoutMs: 30_000 }),
    gitTry(cwd, ['merge-base', '--is-ancestor', hash, 'HEAD'], { signal })
  ])
  const branches: string[] = []
  for (const line of (refs ?? '').split('\n')) {
    if (line.startsWith('refs/heads/')) branches.push(line.slice('refs/heads/'.length))
    else if (line.startsWith('refs/remotes/') && !line.endsWith('/HEAD')) branches.push(line.slice('refs/remotes/'.length))
  }
  return {
    inHead: head !== null,
    branches,
    tags: (tags ?? '').split('\n').filter((tag) => tag !== '')
  }
}
