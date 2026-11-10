import type { ActionResult, GitAction } from '../../shared/protocol'
import { safeHash, safeRef, safeStash, safeValue } from './args'
import { git, gitTry, runGit } from './run'

/** One git invocation. `okCodes` are extra exit codes that count as success. */
export type Step = {
  args: string[]
  okCodes?: readonly number[]
  /** Names the step in failure messages (for example the remote of one push). */
  label?: string
  /** Skip the step when nothing is staged. */
  onlyIfStaged?: boolean
  /** Added to the action's output when the step succeeds. */
  note?: string
}

const AUTH_PATTERNS = [
  /could not read (Username|Password)/i,
  /Authentication failed/i,
  /Permission denied \(publickey/i,
  /terminal prompts disabled/i,
  /Host key verification failed/i,
  /fatal: could not read from remote repository.*\n.*(authenticat|permission)/i,
  /HTTP Basic: Access denied/i,
  /The requested URL returned error: 40[13]/i
]

export function isAuthFailure(text: string): boolean {
  return AUTH_PATTERNS.some((pattern) => pattern.test(text))
}

/** Subcommands the terminal fallback may run. */
const TERMINAL_COMMANDS = new Set(['push', 'pull', 'fetch', 'remote', 'ls-remote'])

export function isTerminalCommand(command: readonly string[]): boolean {
  const args = command[0] === 'git' ? command.slice(1) : command
  return args.length > 0 && TERMINAL_COMMANDS.has(args[0]) && args.every((arg) => !arg.includes('\0'))
}

/** Runs the action's steps in order in `cwd`; stops at the first failure. */
export async function runAction(cwd: string, action: GitAction, signal: AbortSignal): Promise<ActionResult> {
  let steps: Step[]
  try {
    steps = await planAction(cwd, action, signal)
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error) }
  }
  const outputs: string[] = []
  for (const step of steps) {
    let result
    try {
      if (step.onlyIfStaged) {
        const staged = await runGit(cwd, ['diff', '--cached', '--quiet'], { signal })
        if (staged.code === 0) continue
      }
      result = await runGit(cwd, step.args, { signal, mutate: true, timeoutMs: 10 * 60_000 })
    } catch (error) {
      return { status: 'error', message: error instanceof Error ? error.message : String(error) }
    }
    const text = [result.stderr.trim(), result.stdout.toString('utf8').trim()].filter((part) => part !== '').join('\n')
    if (result.code !== 0 && !(step.okCodes?.includes(result.code) ?? false)) {
      const detail = text || `git ${step.args[0]} failed (exit ${result.code})`
      const message = step.label === undefined ? detail : `${step.label}: ${detail}`
      if (isAuthFailure(result.stderr)) return { status: 'auth-required', message, command: step.args }
      return { status: 'error', message }
    }
    if (text !== '') outputs.push(text)
    if (step.note !== undefined) outputs.push(step.note)
  }
  const output = outputs.join('\n')
  return output === '' ? { status: 'ok' } : { status: 'ok', output }
}

async function planAction(cwd: string, action: GitAction, signal: AbortSignal): Promise<Step[]> {
  switch (action.kind) {
    // ----- Branches -----
    case 'branch.create': {
      const name = safeRef(action.name, 'branch name')
      const at = safeRef(action.at, 'revision')
      return [{ args: action.checkout ? ['checkout', '-b', name, at, '--'] : ['branch', name, at] }]
    }
    case 'branch.checkout': {
      const name = safeRef(action.name, 'branch name')
      if (action.createLocal !== undefined && action.createLocal !== '') {
        const local = safeRef(action.createLocal, 'branch name')
        const exists = await gitTry(cwd, ['rev-parse', '--verify', '-q', `refs/heads/${local}`], { signal })
        if (exists === null) return [{ args: ['checkout', '-b', local, '--track', name, '--'] }]
        // The local branch exists: switch to it and say whether it lags behind the remote branch
        // the person picked (not its upstream, which may be unset or another remote).
        let note = `Local branch ${local} already exists; checked it out instead of creating it.`
        const behind = await gitTry(cwd, ['rev-list', '--count', `refs/heads/${local}..refs/remotes/${name}`], { signal })
        const count = behind === null ? 0 : Number(behind.trim())
        if (count > 0) note += ` It is behind ${name} by ${count} commit${count === 1 ? '' : 's'} (behind ${count}).`
        return [{ args: ['checkout', local, '--'], note }]
      }
      return [{ args: ['checkout', name, '--'] }]
    }
    case 'branch.rename':
      return [{ args: ['branch', '-m', safeRef(action.from, 'branch name'), safeRef(action.to, 'branch name')] }]
    case 'branch.delete': {
      const name = safeRef(action.name, 'branch name')
      const steps: Step[] = [{ args: ['branch', action.force ? '-D' : '-d', name] }]
      for (const remote of action.alsoRemotes ?? []) {
        steps.push({ args: ['push', safeRef(remote, 'remote'), '--delete', name] })
      }
      return steps
    }
    case 'branch.deleteRemote':
      return [{ args: ['push', safeRef(action.remote, 'remote'), '--delete', safeRef(action.name, 'branch name')] }]
    case 'branch.merge': {
      const ref = safeRef(action.ref, 'revision')
      const args = ['merge']
      if (action.mode === 'no-ff') args.push('--no-ff')
      else if (action.mode === 'squash') args.push('--squash')
      else args.push('--ff')
      if (action.noCommit) args.push('--no-commit')
      args.push(ref)
      const steps: Step[] = [{ args }]
      // `--squash` stages the result without committing; finish the commit unless asked not to.
      if (action.mode === 'squash' && !action.noCommit) steps.push({ args: ['commit', '--no-edit'] })
      return steps
    }
    case 'branch.rebase': {
      const args = ['rebase']
      if (action.ignoreDate) args.push('--ignore-date')
      args.push(safeRef(action.onto, 'revision'))
      return [{ args }]
    }
    case 'branch.push': {
      if (action.remotes.length === 0) throw new Error('Choose at least one remote.')
      const name = safeRef(action.name, 'branch name')
      return action.remotes.map((remote, index) => {
        const args = ['push']
        if (action.setUpstream && index === 0) args.push('--set-upstream')
        if (action.force === 'force-with-lease') args.push('--force-with-lease')
        else if (action.force === 'force') args.push('--force')
        args.push(safeRef(remote, 'remote'), name)
        return action.remotes.length > 1 ? { args, label: `Push to ${remote} failed` } : { args }
      })
    }
    case 'branch.pull': {
      const args = ['pull', '--no-edit']
      if (action.noFf) args.push('--no-ff')
      // A squash is a merge: never let `pull.rebase` or divergent histories turn it into a failure.
      if (action.squash) args.push('--squash', '--no-rebase')
      const remote = safeRef(action.remote, 'remote')
      const name = safeRef(action.name, 'branch name')
      args.push(remote, name)
      const steps: Step[] = [{ args }]
      // `--squash` stages the result without committing; commit it like a merge would.
      if (action.squash) steps.push({ args: ['commit', '-m', `Merge branch '${remote}/${name}'`], onlyIfStaged: true })
      return steps
    }
    case 'branch.fetchInto': {
      const args = ['fetch']
      if (action.force) args.push('--force')
      args.push(
        safeRef(action.remote, 'remote'),
        `${safeRef(action.remoteBranch, 'branch name')}:${safeRef(action.localBranch, 'branch name')}`
      )
      return [{ args }]
    }

    // ----- Commits -----
    case 'commit.checkout':
      return [{ args: ['checkout', safeHash(action.hash), '--'] }]
    case 'commit.cherryPick': {
      const args = ['cherry-pick']
      if (action.recordOrigin) args.push('-x')
      if (action.noCommit) args.push('--no-commit')
      if (action.mainline !== undefined) args.push('-m', String(positiveInt(action.mainline)))
      args.push(safeHash(action.hash))
      return [{ args }]
    }
    case 'commit.revert': {
      const args = ['revert', '--no-edit']
      if (action.mainline !== undefined) args.push('-m', String(positiveInt(action.mainline)))
      args.push(safeHash(action.hash))
      return [{ args }]
    }
    case 'commit.drop': {
      const hash = safeHash(action.hash)
      const parents = await gitTry(cwd, ['rev-list', '--parents', '-n', '1', hash], { signal })
      if (parents === null) throw new Error('Commit not found.')
      const parentCount = parents.trim().split(' ').length - 1
      if (parentCount > 1) throw new Error('Merge commits cannot be dropped.')
      if (parentCount === 0) throw new Error('The root commit cannot be dropped.')
      const ancestor = await gitTry(cwd, ['merge-base', '--is-ancestor', hash, 'HEAD'], { signal })
      if (ancestor === null) throw new Error('Only commits that are ancestors of HEAD can be dropped.')
      return [{ args: ['rebase', '--onto', `${hash}^`, hash] }]
    }
    case 'commit.reset': {
      if (!['soft', 'mixed', 'hard'].includes(action.mode)) throw new Error('Invalid reset mode.')
      return [{ args: ['reset', `--${action.mode}`, safeHash(action.hash), '--'] }]
    }

    // ----- Tags -----
    case 'tag.add': {
      const name = safeRef(action.name, 'tag name')
      const at = safeRef(action.at, 'revision')
      const args = ['tag']
      if (action.force) args.push('-f')
      if (action.message !== undefined && action.message !== '') args.push('-a', name, '-m', action.message, at)
      else args.push(name, at)
      const steps: Step[] = [{ args }]
      if (action.push !== undefined && action.push !== '') {
        steps.push({ args: ['push', ...(action.force ? ['--force'] : []), safeRef(action.push, 'remote'), `refs/tags/${name}`] })
      }
      return steps
    }
    case 'tag.delete': {
      const name = safeRef(action.name, 'tag name')
      const steps: Step[] = [{ args: ['tag', '-d', name] }]
      if (action.deleteOnRemote !== undefined && action.deleteOnRemote !== '') {
        steps.push({ args: ['push', safeRef(action.deleteOnRemote, 'remote'), '--delete', `refs/tags/${name}`] })
      }
      return steps
    }
    case 'tag.push': {
      const name = safeRef(action.name, 'tag name')
      return action.remotes.map((remote) => ({ args: ['push', safeRef(remote, 'remote'), `refs/tags/${name}`] }))
    }

    // ----- Stashes -----
    case 'stash.push': {
      const args = ['stash', 'push']
      if (action.includeUntracked) args.push('--include-untracked')
      if (action.message.trim() !== '') args.push('-m', action.message)
      return [{ args }]
    }
    case 'stash.apply':
      return [{ args: ['stash', 'apply', ...(action.reinstateIndex ? ['--index'] : []), safeStash(action.selector)] }]
    case 'stash.pop':
      return [{ args: ['stash', 'pop', ...(action.reinstateIndex ? ['--index'] : []), safeStash(action.selector)] }]
    case 'stash.drop':
      return [{ args: ['stash', 'drop', safeStash(action.selector)] }]
    case 'stash.branch':
      return [{ args: ['stash', 'branch', safeRef(action.name, 'branch name'), safeStash(action.selector)] }]

    // ----- Uncommitted -----
    case 'uncommitted.reset': {
      if (action.mode !== 'mixed' && action.mode !== 'hard') throw new Error('Invalid reset mode.')
      return [{ args: ['reset', `--${action.mode}`, 'HEAD', '--'] }]
    }
    case 'uncommitted.clean':
      return [{ args: ['clean', '-f', ...(action.directories ? ['-d'] : [])] }]

    // ----- Remotes -----
    case 'remote.fetch': {
      const args = ['fetch']
      if (action.prune) args.push('--prune')
      if (action.pruneTags) args.push('--prune-tags')
      if (action.remote === null) args.push('--all')
      else args.push(safeRef(action.remote, 'remote'))
      return [{ args }]
    }
    case 'remote.add': {
      const name = safeRef(action.name, 'remote name')
      const steps: Step[] = [{ args: ['remote', 'add', name, safeValue(action.url, 'URL')] }]
      if (action.pushUrl !== undefined && action.pushUrl !== '') {
        steps.push({ args: ['remote', 'set-url', '--push', name, safeValue(action.pushUrl, 'push URL')] })
      }
      if (action.fetch) steps.push({ args: ['fetch', name] })
      return steps
    }
    case 'remote.edit': {
      const oldName = safeRef(action.oldName, 'remote name')
      const name = safeRef(action.name, 'remote name')
      const steps: Step[] = []
      if (oldName !== name) steps.push({ args: ['remote', 'rename', oldName, name] })
      steps.push({ args: ['remote', 'set-url', name, safeValue(action.url, 'URL')] })
      if (action.pushUrl !== undefined && action.pushUrl !== '') {
        steps.push({ args: ['remote', 'set-url', '--push', name, safeValue(action.pushUrl, 'push URL')] })
      } else {
        steps.push({ args: ['config', '--local', '--unset-all', `remote.${name}.pushurl`], okCodes: [5] })
      }
      return steps
    }
    case 'remote.delete':
      return [{ args: ['remote', 'remove', safeRef(action.name, 'remote name')] }]
    case 'remote.prune':
      return [{ args: ['remote', 'prune', safeRef(action.name, 'remote name')] }]

    // ----- Config -----
    case 'user.set': {
      const scope = scopeFlag(action.scope)
      return [
        { args: ['config', scope, 'user.name', action.name] },
        { args: ['config', scope, 'user.email', action.email] }
      ]
    }
    case 'user.unset': {
      const scope = scopeFlag(action.scope)
      return [
        { args: ['config', scope, '--unset-all', 'user.name'], okCodes: [5] },
        { args: ['config', scope, '--unset-all', 'user.email'], okCodes: [5] }
      ]
    }
    default: {
      const unknown: never = action
      throw new Error(`Unknown action: ${JSON.stringify(unknown)}`)
    }
  }
}

function scopeFlag(scope: 'local' | 'global'): string {
  if (scope !== 'local' && scope !== 'global') throw new Error('Invalid config scope.')
  return `--${scope}`
}

function positiveInt(value: number): number {
  if (!Number.isInteger(value) || value < 1) throw new Error('Invalid mainline parent number.')
  return value
}

/** `git archive` of a ref as bytes. */
export async function archive(cwd: string, ref: string, format: 'zip' | 'tar', signal: AbortSignal): Promise<{ base64: string; name: string }> {
  if (format !== 'zip' && format !== 'tar') throw new Error('Invalid archive format.')
  safeRef(ref, 'revision')
  const result = await runGit(cwd, ['archive', `--format=${format}`, ref], { signal, maxBytes: 64 * 1024 * 1024 })
  if (result.truncated) throw new Error('The archive is larger than 64 MiB.')
  if (result.code !== 0) throw new Error(result.stderr.trim() || 'git archive failed')
  const short = (await git(cwd, ['rev-parse', '--short', `${ref}^{commit}`], { signal })).trim()
  const safeName = ref.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  const label = /^[0-9a-f]{7,}$/i.test(ref) ? short : `${safeName}-${short}`
  return { base64: result.stdout.toString('base64'), name: `${label}.${format}` }
}

/** The shell command line that re-runs `command` (git argv) in a terminal, quoted for the host shell. */
export function terminalCommandLine(command: readonly string[], cwd: string): string {
  const argv = command[0] === 'git' ? command.slice(1) : [...command]
  const quote = process.platform === 'win32' ? quoteWindows : quotePosix
  const line = ['git', ...argv].map((part, index) => (index === 0 ? part : quote(part))).join(' ')
  return `cd ${quote(cwd)} && ${line}`
}

function quotePosix(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`
}

function quoteWindows(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./\\-]+$/.test(value) ? value : `'${value.replace(/'/g, "''")}'`
}
