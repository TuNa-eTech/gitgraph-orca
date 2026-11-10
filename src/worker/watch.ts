import { watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import { gitDirs } from './git/log'
import { runGit } from './git/run'

const DEBOUNCE_MS = 750
/** Past this many distinct changed paths in one window, skip `git check-ignore` and just refresh. */
const MAX_PENDING_PATHS = 2000

/**
 * Watches one repository and calls `onChange` (debounced) when HEAD, refs, the index or stashes
 * change, and, with `watchWorkingTree`, when a file that git does not ignore changes.
 *
 * Working-tree watching uses one recursive `fs.watch` on the repository root. Recursive watching
 * is native on macOS and Windows; where the platform refuses it (older Node on Linux) the watcher
 * falls back to the top-level directory only, so edits in subdirectories go unnoticed until the
 * next refresh.
 */
export class RepoWatcher {
  private current: { key: string; cwd: string; working: boolean; watchers: FSWatcher[] } | null = null
  private timer: NodeJS.Timeout | null = null
  private busy = 0
  private refsChanged = false
  private pending = new Set<string>()

  constructor(private readonly onChange: (cwd: string) => void) {}

  /** Starts watching `cwd` (replacing any previous repository). Safe to call on every graph.load. */
  async watch(cwd: string, workingTree: boolean): Promise<void> {
    const key = `${cwd}\0${workingTree}`
    if (this.current?.key === key) return
    this.close()
    let dirs: { gitDir: string; commonDir: string }
    try {
      dirs = await gitDirs(cwd)
    } catch {
      return
    }
    const watchers: FSWatcher[] = []
    const trigger = (): void => this.schedule(cwd, null)
    const add = (target: string, recursive: boolean, filter?: (name: string) => boolean): void => {
      try {
        const watcher = watch(target, { recursive }, (_event, name) => {
          if (filter === undefined || name == null || filter(name.toString())) trigger()
        })
        watcher.on('error', () => watcher.close())
        watchers.push(watcher)
      } catch {
        // The path may not exist (no stash yet, no packed-refs); the directory watch covers creation.
      }
    }
    const top = (name: string): boolean => ['HEAD', 'index', 'packed-refs', 'FETCH_HEAD', 'ORIG_HEAD'].includes(name)
    // Watching the directories (not the files) survives git replacing files via rename.
    add(dirs.gitDir, false, top)
    add(path.join(dirs.commonDir, 'refs'), true)
    if (dirs.commonDir !== dirs.gitDir) add(dirs.commonDir, false, (name) => name === 'packed-refs')
    add(path.join(dirs.commonDir, 'logs', 'refs'), true, (name) => name === 'stash' || name.endsWith('stash'))
    if (workingTree) this.addWorkingTree(cwd, watchers)
    this.current = { key, cwd, working: workingTree, watchers }
  }

  /** Turns working-tree watching on or off for the repository being watched (a settings change). */
  async setWorkingTree(enabled: boolean): Promise<void> {
    const current = this.current
    if (current === null || current.working === enabled) return
    await this.watch(current.cwd, enabled)
  }

  private addWorkingTree(cwd: string, watchers: FSWatcher[]): void {
    const onEvent = (_event: string, name: string | Buffer | null): void => {
      if (name == null) return this.schedule(cwd, '')
      const relative = name.toString().split(path.sep).join('/')
      // `.git` is watched separately and precisely.
      if (relative === '.git' || relative.startsWith('.git/')) return
      this.schedule(cwd, relative)
    }
    for (const recursive of [true, false]) {
      try {
        const watcher = watch(cwd, { recursive }, onEvent)
        watcher.on('error', () => watcher.close())
        watchers.push(watcher)
        return
      } catch {
        // Recursive watching is unavailable here: retry non-recursively.
      }
    }
  }

  /** Brackets an action: file events while it runs are ignored (the panel reloads after the action). */
  async whileBusy<T>(work: () => Promise<T>): Promise<T> {
    this.busy++
    try {
      return await work()
    } finally {
      this.busy--
    }
  }

  /** `file` is a working-tree path to check against .gitignore, or null for a ref/index change. */
  private schedule(cwd: string, file: string | null): void {
    if (this.busy > 0) return
    if (file === null) this.refsChanged = true
    else if (this.pending.size <= MAX_PENDING_PATHS) this.pending.add(file)
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush(cwd)
    }, DEBOUNCE_MS)
  }

  private async flush(cwd: string): Promise<void> {
    const refs = this.refsChanged
    const files = [...this.pending]
    this.refsChanged = false
    this.pending.clear()
    if (refs || (await hasUnignored(cwd, files))) {
      if (this.busy === 0 && this.current?.cwd === cwd) this.onChange(cwd)
    }
  }

  close(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    this.refsChanged = false
    this.pending.clear()
    for (const watcher of this.current?.watchers ?? []) watcher.close()
    this.current = null
  }
}

/** True when at least one of the paths is not ignored by git (all paths when the check cannot run). */
async function hasUnignored(cwd: string, files: string[]): Promise<boolean> {
  if (files.length === 0) return false
  if (files.length > MAX_PENDING_PATHS || files.includes('')) return true
  try {
    const result = await runGit(cwd, ['check-ignore', '--stdin', '-z'], { input: files.join('\0') + '\0' })
    if (result.code !== 0 && result.code !== 1) return true
    const ignored = new Set(result.stdout.toString('utf8').split('\0').filter((entry) => entry !== ''))
    return files.some((file) => !ignored.has(file))
  } catch {
    return true
  }
}
