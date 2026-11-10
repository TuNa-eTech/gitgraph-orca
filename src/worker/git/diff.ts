import { UNCOMMITTED, type DiffInput, type DiffResult, type FileAtRevisionResult } from '../../shared/protocol'
import { safeHash, safePath } from './args'
import { emptyTree, gitTry, runGit } from './run'

/** Diffs and file contents above this many bytes are reported as too-large. */
export const MAX_DIFF_BYTES = 2 * 1024 * 1024

const CONTEXT = 3

export async function fileDiff(cwd: string, input: DiffInput, signal: AbortSignal): Promise<DiffResult> {
  const filePath = safePath(input.path)
  const oldPath = input.oldPath === undefined ? undefined : safePath(input.oldPath)
  const common = ['diff', '--no-ext-diff', '--no-textconv', '--no-color', `--unified=${CONTEXT}`, '--find-renames']
  const pathspec = oldPath !== undefined && oldPath !== filePath ? [oldPath, filePath] : [filePath]

  if (input.to === UNCOMMITTED) {
    const base = input.from === null ? await headOrEmpty(cwd, signal) : safeHash(input.from)
    const args = [...common, base, '--', ...pathspec]
    const result = await runDiff(cwd, args, signal)
    if (!(result.status === 'ok' && !result.binary && result.patch === '')) return result
    // Nothing tracked changed: the file may be untracked.
    const untracked = await gitTry(cwd, ['ls-files', '--others', '--exclude-standard', '-z', '--', filePath], { signal })
    if (untracked !== null && untracked.split('\0').includes(filePath)) {
      return runDiff(cwd, [...common, '--no-index', '--', '/dev/null', filePath], signal, [0, 1])
    }
    return result
  }

  const to = safeHash(input.to)
  const from = input.from === null ? await parentOrEmpty(cwd, to, signal) : input.from === UNCOMMITTED ? null : safeHash(input.from)
  if (from === null) {
    // Working tree -> `to`: reverse of `to` -> working tree.
    return runDiff(cwd, [...common, '-R', to, '--', ...pathspec], signal)
  }
  return runDiff(cwd, [...common, from, to, '--', ...pathspec], signal)
}

async function runDiff(cwd: string, args: string[], signal: AbortSignal, okCodes: readonly number[] = [0]): Promise<DiffResult> {
  const result = await runGit(cwd, args, { signal, maxBytes: MAX_DIFF_BYTES })
  if (result.truncated) return { status: 'too-large', bytes: result.stdout.length }
  if (!okCodes.includes(result.code)) throw new Error(result.stderr.trim() || 'git diff failed')
  const text = result.stdout.toString('utf8')
  if (/^Binary files .* differ$/m.test(text) || /^GIT binary patch$/m.test(text)) return { status: 'ok', binary: true }
  return { status: 'ok', binary: false, patch: text }
}

async function headOrEmpty(cwd: string, signal: AbortSignal): Promise<string> {
  const head = await gitTry(cwd, ['rev-parse', '--verify', '-q', 'HEAD^{commit}'], { signal })
  return head === null ? emptyTree(cwd) : head.trim()
}

async function parentOrEmpty(cwd: string, hash: string, signal: AbortSignal): Promise<string> {
  const parent = await gitTry(cwd, ['rev-parse', '--verify', '-q', `${hash}^1`], { signal })
  return parent === null ? emptyTree(cwd) : parent.trim()
}

export async function fileAtRevision(cwd: string, rev: string, filePath: string, signal: AbortSignal): Promise<FileAtRevisionResult> {
  const clean = safePath(filePath)
  if (rev === UNCOMMITTED) throw new Error('Use file.open for working-tree files.')
  safeHash(rev)
  const spec = `${rev}:${clean}`
  const size = await gitTry(cwd, ['cat-file', '-s', spec], { signal })
  if (size === null) return { status: 'missing' }
  const bytes = Number(size.trim())
  if (bytes > MAX_DIFF_BYTES) return { status: 'too-large', bytes }
  const result = await runGit(cwd, ['cat-file', 'blob', spec], { signal, maxBytes: MAX_DIFF_BYTES })
  if (result.code !== 0) return { status: 'missing' }
  const buffer = result.stdout
  if (buffer.subarray(0, 8000).includes(0)) return { status: 'binary' }
  return { status: 'ok', content: buffer.toString('utf8') }
}
