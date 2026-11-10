// Data layer of the panel: plugin settings, the loaded graph and the persisted view state.
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import {
  DEFAULT_COMMIT_LIMIT,
  MAX_COMMIT_LIMIT,
  type GraphLoadResult,
  type GraphSettings,
  type ViewState
} from '../shared/protocol'
import { DEFAULT_SETTINGS, readSettings } from './settings'
import { request } from './request'

export const EMPTY_VIEW: ViewState = { columnWidths: {}, hiddenColumns: [], branchFilter: [] }

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))

export type GraphState = {
  settings: GraphSettings
  result: GraphLoadResult | null
  /** A request failed (as opposed to git failing, which arrives in `result`). */
  error: string | null
  loading: boolean
  repoPath: string | undefined
  view: ViewState
  /** Scroll position stored for this repository; `id` changes whenever it should be applied. */
  restore: { top: number; id: number } | undefined
  saveScroll(top: number): void
  setRepoPath(path: string | undefined): void
  patchView(patch: Partial<ViewState>): void
  reload(): void
  loadMore(): void
  loadAll(): void
  /** Writes the `showRemoteBranches` setting; the settings listener then reloads. */
  setShowRemoteBranches(show: boolean): void
}

export function useGraphState(): GraphState {
  const [settings, setSettings] = useState<GraphSettings>(DEFAULT_SETTINGS)
  const [result, setResult] = useState<GraphLoadResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [repoPath, setRepoPathState] = useState<string | undefined>(undefined)
  const [view, setView] = useState<ViewState>(EMPTY_VIEW)
  const [restore, setRestore] = useState<{ top: number; id: number } | undefined>(undefined)
  const restoreId = useRef(0)

  // Mutable mirror read by async code, so a callback never sees a stale value.
  const live = useRef({
    settings,
    repoPath,
    view,
    limit: 0,
    workspace: '',
    viewKey: null as string | null,
    requestId: 0
  })
  live.current.settings = settings
  live.current.repoPath = repoPath
  live.current.view = view

  const load = useCallback(async () => {
    const id = ++live.current.requestId
    setLoading(true)
    try {
      const key = `${live.current.workspace}\n${live.current.repoPath ?? ''}`
      if (live.current.viewKey !== key) {
        live.current.viewKey = key
        let stored: ViewState | null = null
        try {
          stored = await request('view.load', { repoPath: live.current.repoPath })
        } catch {
          stored = null
        }
        if (id !== live.current.requestId) return
        const next = stored ?? EMPTY_VIEW
        live.current.view = next
        setView(next)
        setRestore(next.scrollTop ? { top: next.scrollTop, id: ++restoreId.current } : undefined)
      }
      if (live.current.limit === 0) {
        const fresh = await readSettings()
        if (id !== live.current.requestId) return
        live.current.settings = fresh
        setSettings(fresh)
        live.current.limit = fresh.initialLoadCommits || DEFAULT_COMMIT_LIMIT
      }
      const res = await request('graph.load', {
        limit: live.current.limit,
        branches: live.current.view.branchFilter,
        repoPath: live.current.repoPath
      })
      if (id !== live.current.requestId) return
      setResult(res)
      setError(null)
    } catch (e) {
      if (id === live.current.requestId) setError(errorMessage(e))
    } finally {
      if (id === live.current.requestId) setLoading(false)
    }
  }, [])

  const reloadSoon = useRef<number | undefined>(undefined)
  const reload = useCallback(() => {
    clearTimeout(reloadSoon.current)
    reloadSoon.current = window.setTimeout(() => void load(), 120)
  }, [load])

  useEffect(() => {
    const workspace = orca.on('workspace.changed', (event) => {
      const name = event.context?.displayName ?? ''
      if (name !== live.current.workspace) {
        live.current.workspace = name
        live.current.limit = 0
        live.current.repoPath = undefined
        setRepoPathState(undefined)
      }
      reload()
    })
    const changed = orca.plugin.on('graph.changed', () => reload())
    const refresh = async () => {
      try {
        setSettings(await readSettings())
      } catch {
        // keep the previous settings
      }
    }
    void refresh()
    const settingsSub = orca.settings.onDidChange(() => {
      void refresh()
      reload()
    })
    return () => {
      workspace.dispose()
      changed.dispose()
      settingsSub.dispose()
      clearTimeout(reloadSoon.current)
    }
  }, [reload])

  const saveTimer = useRef<number | undefined>(undefined)
  const saveView = useCallback((state: ViewState) => {
    clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      request('view.save', { state, repoPath: live.current.repoPath }).catch(() => undefined)
    }, 400)
  }, [])

  const patchView = useCallback(
    (patch: Partial<ViewState>) => {
      const next = { ...live.current.view, ...patch }
      live.current.view = next
      setView(next)
      saveView(next)
      if (patch.branchFilter !== undefined) {
        live.current.limit = 0
        reload()
      }
    },
    [reload, saveView]
  )

  const setRepoPath = useCallback(
    (path: string | undefined) => {
      live.current.repoPath = path
      live.current.limit = 0
      setRepoPathState(path)
      reload()
    },
    [reload]
  )

  const grow = useCallback(
    (to: (current: number, more: number) => number) => {
      const { settings: s } = live.current
      const current = live.current.limit || s.initialLoadCommits
      live.current.limit = Math.min(MAX_COMMIT_LIMIT, to(current, s.loadMoreCommits))
      void load()
    },
    [load]
  )

  return {
    settings,
    result,
    error,
    loading,
    repoPath,
    view,
    restore,
    saveScroll: (top) => {
      live.current.view = { ...live.current.view, scrollTop: top }
      saveView(live.current.view)
    },
    setRepoPath,
    patchView,
    reload: () => void load(),
    loadMore: () => grow((current, more) => current + more),
    loadAll: () => grow(() => MAX_COMMIT_LIMIT),
    setShowRemoteBranches: (show) => {
      orca.settings.set('showRemoteBranches', show).catch(() => undefined)
    }
  }
}
