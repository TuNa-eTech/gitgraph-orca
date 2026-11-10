import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Commit } from '../shared/protocol'

const execFileAsync = promisify(execFile)

const FIELD = '\x1f'
const RECORD = '\x1e'
// Hash, parents, author name, author email, author time, decorations, subject.
const FORMAT = ['%H', '%P', '%an', '%ae', '%at', '%D', '%s'].join('%x1f') + '%x1e'

export type GitLog = { commits: Commit[]; truncated: boolean }

/** Runs `git log` over every ref in `cwd`, newest first, and parses at most `limit` commits. */
export async function readGitLog(cwd: string, limit: number, signal: AbortSignal): Promise<GitLog> {
  // One extra commit tells whether the history goes on past `limit`.
  const stdout = await git(cwd, ['log', '--all', '--date-order', `--max-count=${limit + 1}`, `--format=${FORMAT}`], signal)
  const commits = parseGitLog(stdout)
  return { commits: commits.slice(0, limit), truncated: commits.length > limit }
}

export function parseGitLog(stdout: string): Commit[] {
  const commits: Commit[] = []
  for (const record of stdout.split(RECORD)) {
    const line = record.replace(/^\n/, '')
    if (line === '') continue
    const [hash, parents, author, email, time, refs, subject] = line.split(FIELD)
    commits.push({
      hash,
      parents: parents === '' ? [] : parents.split(' '),
      author,
      email,
      time: Number(time),
      refs: refs === '' ? [] : refs.split(', '),
      subject
    })
  }
  return commits
}

async function git(cwd: string, args: string[], signal: AbortSignal): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      signal,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024
    })
    return stdout
  } catch (error) {
    const stderr =
      error && typeof error === 'object' && 'stderr' in error && typeof error.stderr === 'string'
        ? error.stderr.trim()
        : ''
    throw new Error(stderr || (error instanceof Error ? error.message : String(error)))
  }
}
