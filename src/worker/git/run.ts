import { spawn } from 'node:child_process'

/** Thrown when git exits with a status the caller did not accept. */
export class GitError extends Error {
  constructor(
    message: string,
    readonly args: readonly string[],
    readonly exitCode: number | null,
    readonly stderr: string,
    readonly stdout: string
  ) {
    super(message)
    this.name = 'GitError'
  }
}

export type RunOptions = {
  signal?: AbortSignal
  /** Written to stdin. */
  input?: string
  /** Default 120 s. */
  timeoutMs?: number
  /** Kill git and flag `truncated` once stdout passes this many bytes. Default 64 MiB. */
  maxBytes?: number
  /** Exit codes `git()` accepts besides 0. */
  okCodes?: readonly number[]
  /**
   * The command changes the repository: it may take locks, must never open an editor and runs
   * without a controlling terminal so ssh cannot prompt on /dev/tty.
   */
  mutate?: boolean
}

export type RunResult = { stdout: Buffer; stderr: string; code: number; truncated: boolean }

const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024
const MAX_STDERR_BYTES = 1024 * 1024

function gitEnv(mutate: boolean): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  if (mutate) {
    env.GIT_EDITOR = 'true'
    env.GIT_MERGE_AUTOEDIT = 'no'
    // Auth failure patterns are matched against English messages.
    env.LC_ALL = 'C'
  } else {
    env.GIT_OPTIONAL_LOCKS = '0'
  }
  return env
}

/** Runs `git <args>` in `cwd`. Resolves for any exit code; rejects on spawn failure, timeout or abort. */
export function runGit(cwd: string, args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
  const { signal, input, timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES, mutate = false } = options
  const fullArgs = ['-c', 'core.quotepath=false', '-c', 'color.ui=false', ...args]
  return new Promise<RunResult>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }
    const child = spawn('git', fullArgs, {
      cwd,
      env: gitEnv(mutate),
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: mutate && process.platform !== 'win32',
      windowsHide: true
    })
    const out: Buffer[] = []
    let outBytes = 0
    const err: Buffer[] = []
    let errBytes = 0
    let truncated = false
    let failure: Error | null = null

    const kill = (): void => {
      try {
        if (child.pid !== undefined && mutate && process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM')
        else child.kill('SIGTERM')
      } catch {
        // already gone
      }
    }
    const timer = setTimeout(() => {
      failure = new Error(`git ${args[0]} timed out after ${Math.round(timeoutMs / 1000)}s`)
      kill()
    }, timeoutMs)
    const onAbort = (): void => {
      failure = abortError()
      kill()
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout.on('data', (chunk: Buffer) => {
      if (truncated) return
      outBytes += chunk.length
      out.push(chunk)
      if (outBytes > maxBytes) {
        truncated = true
        kill()
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (errBytes >= MAX_STDERR_BYTES) return
      errBytes += chunk.length
      err.push(chunk)
    })
    child.stdin.on('error', () => {})
    child.on('error', (error) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (failure !== null) {
        reject(failure)
        return
      }
      resolve({
        stdout: Buffer.concat(out),
        stderr: Buffer.concat(err).toString('utf8'),
        code: code ?? -1,
        truncated
      })
    })
    if (input !== undefined) child.stdin.end(input)
    else child.stdin.end()
  })
}

function abortError(): Error {
  const error = new Error('cancelled') as Error & { code: string }
  error.code = 'cancelled'
  return error
}

function fail(args: readonly string[], result: RunResult): GitError {
  const stdout = result.stdout.toString('utf8')
  const message = result.stderr.trim() || stdout.trim() || `git ${args[0]} failed (exit ${result.code})`
  return new GitError(message, args, result.code, result.stderr, stdout)
}

/** stdout as text; throws `GitError` on a non-zero exit. */
export async function git(cwd: string, args: readonly string[], options: RunOptions = {}): Promise<string> {
  return (await gitBuffer(cwd, args, options)).toString('utf8')
}

/** stdout as bytes; throws `GitError` on a non-zero exit. */
export async function gitBuffer(cwd: string, args: readonly string[], options: RunOptions = {}): Promise<Buffer> {
  const result = await runGit(cwd, args, options)
  if (result.code !== 0 && !(options.okCodes?.includes(result.code) ?? false)) throw fail(args, result)
  return result.stdout
}

/** stdout as text, or null when git exits non-zero. */
export async function gitTry(cwd: string, args: readonly string[], options: RunOptions = {}): Promise<string | null> {
  const result = await runGit(cwd, args, options)
  return result.code === 0 ? result.stdout.toString('utf8') : null
}

/** The object id of the empty tree for the repository's hash algorithm. */
const emptyTrees = new Map<string, string>()
export async function emptyTree(cwd: string): Promise<string> {
  const cached = emptyTrees.get(cwd)
  if (cached !== undefined) return cached
  const id = (await git(cwd, ['hash-object', '-t', 'tree', '--stdin'], { input: '' })).trim()
  emptyTrees.set(cwd, id)
  return id
}
