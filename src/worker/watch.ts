import { watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import { gitDirs } from './git/log'

const DEBOUNCE_MS = 750

/** Watches one repository's `.git` and calls `onChange` (debounced) when HEAD, refs, the index or stashes change. */
export class RepoWatcher {
  private current: { key: string; watchers: FSWatcher[] } | null = null
  private timer: NodeJS.Timeout | null = null
  private busy = 0

  constructor(private readonly onChange: (cwd: string) => void) {}

  /** Starts watching `cwd` (replacing any previous repository). Safe to call on every graph.load. */
  async watch(cwd: string): Promise<void> {
    if (this.current?.key === cwd) return
    this.close()
    let dirs: { gitDir: string; commonDir: string }
    try {
      dirs = await gitDirs(cwd)
    } catch {
      return
    }
    const watchers: FSWatcher[] = []
    const trigger = (): void => this.schedule(cwd)
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
    this.current = { key: cwd, watchers }
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

  private schedule(cwd: string): void {
    if (this.busy > 0) return
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.onChange(cwd)
    }, DEBOUNCE_MS)
  }

  close(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    for (const watcher of this.current?.watchers ?? []) watcher.close()
    this.current = null
  }
}
