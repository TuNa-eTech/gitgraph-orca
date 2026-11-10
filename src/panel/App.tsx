import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { UNCOMMITTED, type Commit, type GraphData, type Ref } from '../shared/protocol'
import { ActionsHost, openContextMenu, openRepoSettings, type MenuTarget } from './components/actions'
import { Toolbar } from './components/Toolbar'
import { TooltipLayer } from './components/Tooltip'
import { CommitTable, type TableApi } from './components/CommitTable'
import { DetailsPane } from './components/DetailsPane'
import { FindWidget, type FindState } from './components/FindWidget'
import { formatDate } from './dates'
import { expandEmoji, parseCustomEmoji } from './emoji'
import { layoutGraph } from './graph/layout'
import { ROW_HEIGHT } from './graph/metrics'
import { parseLines, parsePalette } from './settings'
import { useGraphState } from './state'
import { request } from './request'
import { useElementSize } from './useElementSize'

/** Panel width at which the details pane moves from below the graph to its right. */
const SIDE_DOCK_MIN_WIDTH = 900

type Selection = { kind: 'commit'; hash: string } | { kind: 'compare'; from: string; to: string }

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))
const isEditable = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return el !== null && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

export function App() {
  const g = useGraphState()
  const { settings, result, view } = g
  const data: GraphData | null = result !== null && result.status === 'ok' ? result : null

  const [selection, setSelection] = useState<Selection | null>(null)
  /** null until the person drags the splitter: then the pane takes a share of the panel. */
  const [detailsHeight, setDetailsHeight] = useState<number | null>(null)
  const [detailsWidth, setDetailsWidth] = useState(420)
  const rootRef = useRef<HTMLDivElement>(null)
  const size = useElementSize(rootRef)
  const dock: 'right' | 'bottom' = size.width >= SIDE_DOCK_MIN_WIDTH ? 'right' : 'bottom'
  const [find, setFind] = useState<FindState | null>(null)
  const [findFocus, setFindFocus] = useState(0)
  const [matchIndex, setMatchIndex] = useState(0)
  const [fetching, setFetching] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const tableApi = useRef<TableApi | null>(null)

  const commits = data?.commits ?? []
  const layout = useMemo(
    () => layoutGraph(commits, data?.head ?? null, { firstParentOnly: settings.firstParentOnly }),
    [data, settings.firstParentOnly]
  )
  const palette = useMemo(() => parsePalette(settings.colours), [settings.colours])
  const emoji = useMemo(() => parseCustomEmoji(settings.customEmojiShortcodes), [settings.customEmojiShortcodes])
  const patterns = useMemo(
    () =>
      parseLines(settings.customBranchGlobPatterns).map((line) => {
        const bar = line.indexOf('|')
        return bar < 0 ? line : line.slice(0, bar).trim() || line.slice(bar + 1).trim()
      }),
    [settings.customBranchGlobPatterns]
  )

  // Keep the selection across reloads; drop hashes that no longer exist.
  useEffect(() => {
    if (data === null) return
    setSelection((cur) => {
      if (cur === null) return cur
      const has = (h: string) => layout.indexOf.has(h)
      if (cur.kind === 'commit') return has(cur.hash) ? cur : null
      return has(cur.from) && has(cur.to) ? cur : null
    })
  }, [layout, data])

  const selected = useMemo<ReadonlySet<string>>(() => {
    if (selection === null) return new Set()
    return new Set(selection.kind === 'commit' ? [selection.hash] : [selection.from, selection.to])
  }, [selection])

  // ----- scroll restore -----
  const restored = useRef(-1)
  useEffect(() => {
    if (g.restore !== undefined && data !== null && restored.current !== g.restore.id) {
      restored.current = g.restore.id
      requestAnimationFrame(() => tableApi.current?.setScrollTop(g.restore?.top ?? 0))
    }
  }, [g.restore, data])

  // ----- find -----
  const { matches, findInvalid } = useMemo(() => {
    if (find === null || find.query === '') return { matches: [] as string[], findInvalid: false }
    let test: (s: string) => boolean
    if (find.regex) {
      try {
        const re = new RegExp(find.query, find.caseSensitive ? '' : 'i')
        test = (s) => re.test(s)
      } catch {
        return { matches: [] as string[], findInvalid: true }
      }
    } else {
      const q = find.caseSensitive ? find.query : find.query.toLowerCase()
      test = (s) => (find.caseSensitive ? s : s.toLowerCase()).includes(q)
    }
    const found: string[] = []
    for (const c of commits) {
      if (c.hash === UNCOMMITTED) continue
      const fields = [
        c.subject,
        expandEmoji(c.subject, emoji),
        c.hash,
        c.author,
        c.email,
        formatDate(c.time, 'date-time'),
        formatDate(c.time, 'date'),
        ...c.refs.map((r) => r.name),
        c.stash ?? ''
      ]
      if (fields.some(test)) found.push(c.hash)
    }
    return { matches: found, findInvalid: false }
  }, [find, commits, emoji])
  const matchSet = useMemo<ReadonlySet<string>>(() => new Set(matches), [matches])
  const index = matches.length === 0 ? -1 : Math.min(matchIndex, matches.length - 1)
  const currentMatch = index >= 0 ? matches[index] : null
  useEffect(() => setMatchIndex(0), [find?.query, find?.regex, find?.caseSensitive])
  useEffect(() => {
    if (currentMatch !== null) {
      const row = layout.indexOf.get(currentMatch)
      if (row !== undefined) tableApi.current?.scrollToRow(row, true)
    }
  }, [currentMatch, layout])

  // ----- selection / navigation -----
  const select = useCallback(
    (row: number, e: { metaKey: boolean; ctrlKey: boolean }) => {
      const hash = commits[row]?.hash
      if (hash === undefined) return
      setSelection((cur) => {
        if (cur === null) return { kind: 'commit', hash }
        if (e.metaKey || e.ctrlKey) {
          const base = cur.kind === 'commit' ? cur.hash : cur.from
          if (base === hash) return cur
          return { kind: 'compare', from: base, to: hash }
        }
        if (cur.kind === 'commit' && cur.hash === hash) return null
        return { kind: 'commit', hash }
      })
    },
    [commits]
  )

  const children = useMemo(() => {
    const map = new Map<string, number[]>()
    commits.forEach((c, row) => {
      const parents = c.hash === UNCOMMITTED && c.parents.length === 0 && data?.head ? [data.head] : c.parents
      for (const p of parents) {
        const list = map.get(p)
        if (list === undefined) map.set(p, [row])
        else list.push(row)
      }
    })
    return map
  }, [commits, data])

  const navigate = useCallback(
    (dir: 'up' | 'down' | 'parent' | 'child', alt: boolean) => {
      if (selection === null) return
      const hash = selection.kind === 'commit' ? selection.hash : selection.to
      const row = layout.indexOf.get(hash)
      if (row === undefined) return
      let target: number | undefined
      if (dir === 'up') target = row - 1
      else if (dir === 'down') target = row + 1
      else if (dir === 'parent') {
        const c = commits[row]
        const parents = c.hash === UNCOMMITTED && c.parents.length === 0 && data?.head ? [data.head] : c.parents
        const parent = alt && parents.length > 1 ? parents[1] : parents[0]
        target = parent === undefined ? undefined : layout.indexOf.get(parent)
      } else {
        const kids = children.get(hash) ?? []
        const lane = layout.vertices[row].lane
        // Nearest child on the same lane, else the nearest child anywhere; alt prefers a child on another lane.
        const nearest = (rows: number[]) => (rows.length === 0 ? undefined : Math.max(...rows))
        const same = kids.filter((k) => layout.vertices[k].lane === lane)
        const other = kids.filter((k) => layout.vertices[k].lane !== lane)
        target = alt ? (nearest(other) ?? nearest(same)) : (nearest(same) ?? nearest(other))
      }
      if (target === undefined || target < 0 || target >= commits.length) return
      setSelection({ kind: 'commit', hash: commits[target].hash })
      tableApi.current?.scrollToRow(target)
    },
    [selection, layout, commits, children, data]
  )

  // ----- tooltip -----
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  const tipCache = useRef(new Map<string, string>())
  const tipTimer = useRef<number | undefined>(undefined)
  const tipFor = useRef<string | null>(null)
  useEffect(() => tipCache.current.clear(), [data])
  const onVertexHover = useCallback(
    (row: number | null, e?: MouseEvent) => {
      clearTimeout(tipTimer.current)
      if (row === null || e === undefined) {
        tipFor.current = null
        setTip(null)
        return
      }
      const commit = commits[row]
      if (commit === undefined || commit.hash === UNCOMMITTED) return
      const x = e.clientX
      const y = e.clientY
      tipFor.current = commit.hash
      tipTimer.current = window.setTimeout(async () => {
        let text = tipCache.current.get(commit.hash)
        if (text === undefined) {
          try {
            const r = await request('commit.containedIn', { hash: commit.hash, repoPath: g.repoPath })
            text = [
              commit.stash ? commit.stash : commit.hash,
              commit.stash ? '' : `${r.inHead ? 'Contained in HEAD' : 'Not contained in HEAD'}`,
              r.branches.length ? `Branches: ${r.branches.join(', ')}` : '',
              r.tags.length ? `Tags: ${r.tags.join(', ')}` : ''
            ]
              .filter((l) => l !== '')
              .join('\n')
            tipCache.current.set(commit.hash, text)
          } catch {
            return
          }
        }
        if (tipFor.current === commit.hash) setTip({ x, y, text })
      }, 450)
    },
    [commits, g.repoPath]
  )
  useEffect(() => () => clearTimeout(tipTimer.current), [])

  // ----- context menus -----
  const onRowContextMenu = useCallback(
    (row: number, e: MouseEvent) => {
      const commit = commits[row]
      if (commit === undefined) return
      let target: MenuTarget
      if (commit.hash === UNCOMMITTED) target = { kind: 'uncommitted' }
      else if (commit.stash !== undefined) target = { kind: 'stash', commit }
      else target = { kind: 'commit', commit }
      openContextMenu(e, target)
    },
    [commits]
  )
  const onRefContextMenu = useCallback((e: MouseEvent, ref: Ref, commit: Commit) => {
    let target: MenuTarget
    switch (ref.kind) {
      case 'head':
        target = { kind: 'branch', name: ref.name, commit }
        break
      case 'remote':
        target = { kind: 'remoteBranch', remote: ref.remote ?? ref.name.split('/')[0], name: ref.name, commit }
        break
      case 'tag':
        target = { kind: 'tag', name: ref.name, commit }
        break
      case 'stash':
        target = { kind: 'stash', commit }
        break
    }
    openContextMenu(e, target)
  }, [])

  // ----- toolbar actions -----
  const fetchRemotes = useCallback(async () => {
    setFetching(true)
    setNotice(null)
    try {
      const r = await request('action.run', {
        action: { kind: 'remote.fetch', remote: null, prune: false, pruneTags: false },
        repoPath: g.repoPath
      })
      if (r.status !== 'ok') setNotice(r.message)
      g.reload()
    } catch (e) {
      setNotice(errorMessage(e))
    } finally {
      setFetching(false)
    }
  }, [g.repoPath, g.reload])

  const openFind = useCallback(() => {
    setFind((cur) => cur ?? { query: '', caseSensitive: false, regex: false })
    setFindFocus((n) => n + 1)
  }, [])
  const scrollToHead = useCallback(() => {
    const hash = data?.head
    const row = hash ? layout.indexOf.get(hash) : undefined
    if (row !== undefined) {
      tableApi.current?.scrollToRow(row, true)
      setSelection({ kind: 'commit', hash: commits[row].hash })
    }
  }, [data, layout, commits])
  const jumpStash = useCallback(
    (dir: 1 | -1) => {
      const rows = layout.vertices.filter((v) => v.stash).map((v) => v.row)
      if (rows.length === 0) return
      const cur = selection === null ? -1 : (layout.indexOf.get(selection.kind === 'commit' ? selection.hash : selection.to) ?? -1)
      const next = dir === 1 ? (rows.find((r) => r > cur) ?? rows[0]) : ([...rows].reverse().find((r) => r < cur) ?? rows[rows.length - 1])
      setSelection({ kind: 'commit', hash: commits[next].hash })
      tableApi.current?.scrollToRow(next, true)
    },
    [layout, selection, commits]
  )

  const keys = useRef({ openFind, scrollToHead, jumpStash, reload: g.reload })
  keys.current = { openFind, scrollToHead, jumpStash, reload: g.reload }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]') !== null) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        keys.current.openFind()
        return
      }
      // Cmd/Ctrl+H/R/S as in vscode-git-graph; the bare letters work too, for when Orca keeps
      // the modified chord for itself.
      if (e.altKey || (!mod && isEditable(e.target))) return
      const k = e.key.toLowerCase()
      if (k === 'h') keys.current.scrollToHead()
      else if (k === 'r') keys.current.reload()
      else if (k === 's') keys.current.jumpStash(e.shiftKey ? -1 : 1)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Keep the graph usable when the panel shrinks below what the stored split asks for. Until
  // the person drags the splitter the bottom pane takes 45% of the panel.
  const detailsH = Math.max(120, Math.min(detailsHeight ?? Math.round(size.height * 0.45), size.height - 160))
  const detailsW = Math.max(280, Math.min(detailsWidth, size.width - 360))

  const startSplit = (e: MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const startH = detailsH
    const startW = detailsWidth
    const move = (m: MouseEvent) => {
      if (dock === 'right') setDetailsWidth(Math.max(280, Math.min(size.width - 360, startW + startX - m.clientX)))
      else setDetailsHeight(Math.max(120, Math.min(size.height - 160, startH + startY - m.clientY)))
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const title = result !== null && (result.status === 'ok' || result.status === 'git-error') ? result.workspace.name : 'Git Graph'

  return (
    <div class="gg-app" ref={rootRef}>
      <Toolbar
        title={title}
        submodules={data?.submodules ?? []}
        repoPath={g.repoPath}
        onRepoPath={g.setRepoPath}
        branches={data?.branches ?? null}
        patterns={patterns}
        branchFilter={view.branchFilter}
        onBranchFilter={(v) => g.patchView({ branchFilter: v })}
        showRemotes={settings.showRemoteBranches}
        onShowRemotes={g.setShowRemoteBranches}
        notice={notice}
        onClearNotice={() => setNotice(null)}
        findOpen={find !== null}
        onFind={() => (find === null ? openFind() : setFind(null))}
        canFetch={(data?.remotes.length ?? 0) > 0}
        fetching={fetching}
        onFetch={() => void fetchRemotes()}
        loading={g.loading}
        onRefresh={g.reload}
        hasData={data !== null}
        onSettings={openRepoSettings}
      />
      {find !== null && (
        <FindWidget
          state={find}
          count={matches.length}
          index={index}
          invalid={findInvalid}
          focusToken={findFocus}
          onChange={setFind}
          onStep={(d) => matches.length > 0 && setMatchIndex((index + d + matches.length) % matches.length)}
          onClose={() => setFind(null)}
        />
      )}
      <div class={`gg-content gg-dock-${dock}`}>
      <div class="gg-main">
        {g.error !== null && <p class="message error">{g.error}</p>}
        {data === null ? (
          <Status result={result} loading={g.loading} />
        ) : commits.length === 0 ? (
          <p class="message">No commits to show.</p>
        ) : (
          <CommitTable
            commits={commits}
            layout={layout}
            palette={palette}
            settings={settings}
            view={view}
            headBranch={data.headBranch}
            hasMore={data.hasMore}
            loading={g.loading}
            emoji={emoji}
            selected={selected}
            matches={matchSet}
            currentMatch={currentMatch}
            apiRef={tableApi}
            onViewChange={g.patchView}
            onRowClick={(row, e) => select(row, e)}
            onRowContextMenu={onRowContextMenu}
            onRefContextMenu={onRefContextMenu}
            onVertexHover={onVertexHover}
            onLoadMore={g.loadMore}
            onScrollEnd={g.saveScroll}
          />
        )}
      </div>
      {data !== null && selection !== null && (
        <>
          <div class="gg-splitter" role="separator" aria-orientation={dock === 'right' ? 'vertical' : 'horizontal'} onMouseDown={(e) => startSplit(e as MouseEvent)} />
          <div class="gg-details" style={dock === 'right' ? { width: `${detailsW}px` } : { height: `${detailsH}px` }}>
            <DetailsPane
              repoPath={g.repoPath}
              selection={selection}
              settings={settings}
              onClose={() => setSelection(null)}
              onNavigate={navigate}
              onContextMenuFile={undefined}
            />
          </div>
        </>
      )}
      </div>
      {data !== null && <ActionsHost graph={data} repoPath={g.repoPath} onDone={g.reload} />}
      <TooltipLayer />
      {tip !== null && (
        <div class="gg-tooltip" style={{ left: `${Math.min(tip.x + 12, window.innerWidth - 280)}px`, top: `${tip.y + ROW_HEIGHT / 2}px` }}>
          {tip.text}
        </div>
      )}
    </div>
  )
}

function Status({ result, loading }: { result: ReturnType<typeof useGraphState>['result']; loading: boolean }) {
  if (result === null) return <p class="message">{loading ? 'Loading…' : ''}</p>
  switch (result.status) {
    case 'no-workspace':
      return <p class="message">Focus a workspace to see its history.</p>
    case 'not-found':
      return (
        <p class="message">
          No repository found for workspace “{result.displayName}” ({result.branch}).
        </p>
      )
    case 'git-error':
      return <p class="message error">{result.message}</p>
    case 'ok':
      return null
  }
}
