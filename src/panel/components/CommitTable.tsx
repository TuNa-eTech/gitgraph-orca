// Virtualised commit table: header (resizable, hideable columns), the SVG graph over the graph
// column, and only the rows near the viewport.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Commit, GraphSettings, Ref, ViewState } from '../../shared/protocol'
import { UNCOMMITTED } from '../../shared/protocol'
import { formatDate, formatFullDate } from '../dates'
import { expandEmoji } from '../emoji'
import { Graph } from '../graph/Graph'
import type { GraphLayout } from '../graph/layout'
import { ROW_HEIGHT, naturalGraphWidth } from '../graph/metrics'
import { RefLabel, refsOf } from './RefLabel'
import { useAvatar } from './useAvatar'

export type ColumnId = 'graph' | 'description' | 'date' | 'author' | 'commit'
const HIDEABLE: { id: ColumnId; label: string }[] = [
  { id: 'date', label: 'Date' },
  { id: 'author', label: 'Author' },
  { id: 'commit', label: 'Commit' }
]
const DEFAULT_WIDTHS: Record<string, number> = { date: 150, author: 140, commit: 84 }
const MIN_WIDTH: Record<string, number> = { graph: 40, date: 60, author: 60, commit: 50 }
const LABELS: Record<ColumnId, string> = { graph: 'Graph', description: 'Description', date: 'Date', author: 'Author', commit: 'Commit' }
/** Narrowest the description gets before optional columns start to auto-hide. */
const DESCRIPTION_MIN = 160
/** Optional columns, dropped in this order while the panel is too narrow for them. */
const AUTO_HIDE_ORDER: ColumnId[] = ['commit', 'author', 'date']
const OVERSCAN = 8
const COMPACT_REFS_BELOW = 340

export type TableApi = {
  /** Scrolls so `row` is visible (centred when `center`). */
  scrollToRow(row: number, center?: boolean): void
  getScrollTop(): number
  setScrollTop(top: number): void
}

export type CommitTableProps = {
  commits: Commit[]
  layout: GraphLayout
  palette: string[]
  settings: GraphSettings
  view: ViewState
  headBranch: string | null
  hasMore: boolean
  loading: boolean
  emoji: Record<string, string>
  selected: ReadonlySet<string>
  matches: ReadonlySet<string>
  currentMatch: string | null
  apiRef: { current: TableApi | null }
  onViewChange(patch: Partial<ViewState>): void
  onRowClick(row: number, e: MouseEvent): void
  onRowContextMenu(row: number, e: MouseEvent): void
  onRefContextMenu(e: MouseEvent, ref: Ref, commit: Commit): void
  onVertexHover(row: number | null, e?: MouseEvent): void
  onLoadMore(): void
  onScrollEnd(top: number): void
}

export function CommitTable(props: CommitTableProps) {
  const { commits, layout, settings, view } = props
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState({ width: 800, height: 600 })
  const viewportH = viewport.height
  const [liveWidths, setLiveWidths] = useState<Record<string, number> | null>(null)
  const [headerMenu, setHeaderMenu] = useState<{ x: number; y: number } | null>(null)

  const hidden = new Set(view.hiddenColumns)
  const natural = naturalGraphWidth(layout.laneCount)
  const widths = liveWidths ?? view.columnWidths
  const widthOf = (id: string): number => {
    const w = widths[id]
    if (w !== undefined) return Math.max(MIN_WIDTH[id] ?? 40, w)
    if (id === 'graph') return Math.min(Math.max(natural, MIN_WIDTH.graph), 240)
    return DEFAULT_WIDTHS[id] ?? 100
  }
  const shown: ColumnId[] = (['graph', 'description', 'date', 'author', 'commit'] as ColumnId[]).filter((c) => !hidden.has(c))
  // Auto-hide optional columns that do not fit, without touching the person's saved choice.
  const fitted = new Set(shown)
  const need = () => [...fitted].reduce((sum, c) => sum + (c === 'description' ? DESCRIPTION_MIN : widthOf(c)), 0)
  for (const c of AUTO_HIDE_ORDER) {
    if (need() <= viewport.width) break
    fitted.delete(c)
  }
  const columns = shown.filter((c) => fitted.has(c))
  const autoHidden = shown.filter((c) => !fitted.has(c))
  const template = columns.map((c) => (c === 'description' ? `minmax(${DESCRIPTION_MIN}px, 1fr)` : `${widthOf(c)}px`)).join(' ')
  const minWidth = columns.reduce((sum, c) => sum + (c === 'description' ? DESCRIPTION_MIN : widthOf(c)), 0)
  const graphWidth = widthOf('graph')
  // Width the description column actually gets; below this its ref labels collapse to one + "+N".
  const descriptionWidth = viewport.width - columns.reduce((sum, c) => sum + (c === 'description' ? 0 : widthOf(c)), 0)
  const compactRefs = descriptionWidth < COMPACT_REFS_BELOW

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el === null) return
    const read = () => setViewport((cur) => (cur.width === el.clientWidth && cur.height === el.clientHeight ? cur : { width: el.clientWidth, height: el.clientHeight }))
    const ro = new ResizeObserver(read)
    ro.observe(el)
    read()
    return () => ro.disconnect()
  }, [])

  props.apiRef.current = {
    scrollToRow(row, center) {
      const el = scrollRef.current
      if (el === null) return
      const top = row * ROW_HEIGHT
      const visible = el.clientHeight - ROW_HEIGHT
      if (center || top < el.scrollTop || top + ROW_HEIGHT > el.scrollTop + visible) {
        el.scrollTop = Math.max(0, center ? top - visible / 2 + ROW_HEIGHT / 2 : top < el.scrollTop ? top : top + ROW_HEIGHT - visible)
      }
    },
    getScrollTop: () => scrollRef.current?.scrollTop ?? 0,
    setScrollTop(top) {
      if (scrollRef.current !== null) scrollRef.current.scrollTop = top
    }
  }

  const total = commits.length
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(total - 1, Math.ceil((scrollTop + viewportH) / ROW_HEIGHT) + OVERSCAN)

  const frame = useRef(0)
  const idle = useRef<number | undefined>(undefined)
  const onScroll = () => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const el = scrollRef.current
      if (el === null) return
      setScrollTop(el.scrollTop)
      if (props.hasMore && !props.loading && el.scrollTop + el.clientHeight >= el.scrollHeight - 160) props.onLoadMore()
    })
    clearTimeout(idle.current)
    idle.current = window.setTimeout(() => {
      if (scrollRef.current !== null) props.onScrollEnd(scrollRef.current.scrollTop)
    }, 300)
  }

  // When the loaded range does not fill the viewport, keep loading.
  useEffect(() => {
    const el = scrollRef.current
    if (el !== null && props.hasMore && !props.loading && el.scrollHeight <= el.clientHeight + 40) props.onLoadMore()
  }, [total, props.hasMore, props.loading, viewportH])

  const startResize = (id: ColumnId, e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = widthOf(id)
    let current = startW
    const move = (m: MouseEvent) => {
      current = Math.max(MIN_WIDTH[id] ?? 40, Math.round(startW + m.clientX - startX))
      setLiveWidths({ ...view.columnWidths, [id]: current })
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setLiveWidths(null)
      props.onViewChange({ columnWidths: { ...view.columnWidths, [id]: current } })
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const toggleColumn = (id: ColumnId) => {
    const next = new Set(view.hiddenColumns)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    props.onViewChange({ hiddenColumns: [...next] })
  }

  useEffect(() => {
    if (headerMenu === null) return
    const close = () => setHeaderMenu(null)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', key)
    }
  }, [headerMenu])

  const rows = []
  for (let row = first; row <= last; row++) {
    const commit = commits[row]
    const cls = [
      'gg-row',
      props.selected.has(commit.hash) ? 'gg-row-selected' : '',
      props.matches.has(commit.hash) ? 'gg-row-match' : '',
      props.currentMatch === commit.hash ? 'gg-row-match-current' : '',
      commit.hash === UNCOMMITTED ? 'gg-row-uncommitted' : '',
      props.settings.muteMergeCommits && commit.parents.length > 1 && commit.stash === undefined ? 'gg-row-muted' : ''
    ].join(' ')
    rows.push(
      <div
        key={commit.hash}
        class={cls}
        style={{ gridTemplateColumns: template, height: `${ROW_HEIGHT}px` }}
        onClick={(e) => props.onRowClick(row, e as MouseEvent)}
        onContextMenu={(e) => props.onRowContextMenu(row, e as MouseEvent)}
      >
        {columns.map((c) => (
          <Cell key={c} id={c} commit={commit} compactRefs={compactRefs} {...props} />
        ))}
      </div>
    )
  }

  return (
    <div class="gg-scroll" ref={scrollRef} onScroll={onScroll}>
      <div class="gg-header" style={{ gridTemplateColumns: template, minWidth: `${minWidth}px` }} onContextMenu={(e) => {
        e.preventDefault()
        setHeaderMenu({ x: e.clientX, y: e.clientY })
      }}>
        {columns.map((c) => (
          <div key={c} class={`gg-th gg-th-${c}`} title={c === 'graph' ? LABELS[c] : undefined}>
            <span class="gg-th-label">{LABELS[c]}</span>
            {c !== 'description' && <span class="gg-resizer" onMouseDown={(e) => startResize(c, e as MouseEvent)} />}
          </div>
        ))}
      </div>
      <div class="gg-body" style={{ minWidth: `${minWidth}px`, height: `${total * ROW_HEIGHT}px` }}>
        <div class="gg-rows" style={{ paddingTop: `${first * ROW_HEIGHT}px` }}>
          {rows}
        </div>
        {!hidden.has('graph') && last >= first && (
          <Graph
            layout={layout}
            palette={props.palette}
            style={settings.graphStyle}
            muteMerges={settings.muteMergeCommits}
            width={graphWidth}
            firstRow={first}
            lastRow={last}
            selected={props.selected}
            onVertexClick={props.onRowClick}
            onVertexContextMenu={props.onRowContextMenu}
            onVertexHover={props.onVertexHover}
          />
        )}
      </div>
      {props.hasMore && (
        <div class="gg-more" style={{ minWidth: `${minWidth}px` }}>
          <button type="button" disabled={props.loading} onClick={props.onLoadMore}>
            {props.loading ? 'Loading…' : 'Load more commits'}
          </button>
        </div>
      )}
      {headerMenu !== null && (
        <div class="gg-menu" style={{ left: `${headerMenu.x}px`, top: `${headerMenu.y}px` }} onMouseDown={(e) => e.stopPropagation()}>
          {HIDEABLE.map(({ id, label }) => (
            <label key={id} class="gg-menu-item" title={autoHidden.includes(id) ? 'Hidden while the panel is too narrow' : undefined}>
              <input type="checkbox" checked={!hidden.has(id)} onChange={() => toggleColumn(id)} />
              {label}
              {autoHidden.includes(id) && <span class="gg-menu-hint">(no room)</span>}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

type CellProps = CommitTableProps & { id: ColumnId; commit: Commit; compactRefs: boolean }

function Cell(p: CellProps) {
  const { commit, id, settings } = p
  switch (id) {
    case 'graph':
      return <div class="gg-cell gg-cell-graph" />
    case 'description':
      return <Description {...p} />
    case 'date':
      return (
        <div class="gg-cell gg-cell-date" title={commit.hash === UNCOMMITTED ? '' : formatFullDate(commit.time)}>
          {commit.hash === UNCOMMITTED ? '' : formatDate(commit.time, settings.dateFormat)}
        </div>
      )
    case 'author':
      return <Author commit={commit} fetchAvatars={settings.fetchAvatars} />
    case 'commit':
      return (
        <div class="gg-cell gg-cell-commit" title={commit.hash}>
          {commit.hash === UNCOMMITTED ? '*' : commit.hash.slice(0, 8)}
        </div>
      )
  }
}

function Author({ commit, fetchAvatars }: { commit: Commit; fetchAvatars: boolean }) {
  const uncommitted = commit.hash === UNCOMMITTED
  const uri = useAvatar(commit.email, commit.hash, fetchAvatars && !uncommitted)
  return (
    <div class="gg-cell gg-cell-author" title={uncommitted ? '' : `${commit.author} <${commit.email}>`}>
      {uri !== null && <img class="gg-avatar" src={uri} alt="" width={16} height={16} />}
      <span class="gg-ellipsis">{uncommitted ? '*' : commit.author}</span>
    </div>
  )
}

function Description({ commit, headBranch, settings, emoji, onRefContextMenu, compactRefs }: CellProps) {
  const allRefs = refsOf(commit)
  const text = useMemo(() => expandEmoji(commit.subject, emoji), [commit.subject, emoji])
  const label = (r: Ref) => <RefLabel key={`${r.kind}:${r.name}`} commit={commit} gitRef={r} headBranch={headBranch} onContextMenu={onRefContextMenu} />
  // Narrow description: keep the most telling label (checked-out branch, then any branch) and
  // summarise the rest as "+N", whose tooltip names them all.
  const primary = allRefs.find((r) => r.kind === 'head' && r.name === headBranch) ?? allRefs.find((r) => r.kind === 'head') ?? allRefs[0]
  const refs = compactRefs && allRefs.length > 1 && primary !== undefined ? [primary] : allRefs
  const overflow = refs.length < allRefs.length ? (
    <span key="more" class="gg-ref gg-ref-more" title={allRefs.map((r) => r.name || commit.stash || 'stash').join('\n')}>
      +{allRefs.length - refs.length}
    </span>
  ) : null
  const alignment = compactRefs ? 'normal' : settings.refLabelAlignment
  const branchRefs = refs.filter((r) => r.kind === 'head' || r.kind === 'remote')
  const otherRefs = refs.filter((r) => r.kind === 'tag' || r.kind === 'stash')
  const sig = commit.signature
  const subject = (
    <span class="gg-subject gg-ellipsis" title={commit.subject}>
      {sig !== undefined && sig !== 'N' && (
        <span class={`gg-sig gg-sig-${sig === 'G' ? 'good' : 'bad'}`} title={`Signature status: ${sig}`}>
          {sig === 'G' ? '✓ ' : '✗ '}
        </span>
      )}
      {text}
    </span>
  )
  if (alignment === 'branches-right') {
    return (
      <div class="gg-cell gg-cell-desc">
        {subject}
        <span class="gg-refs gg-refs-right">{[...otherRefs, ...branchRefs].map(label)}</span>
      </div>
    )
  }
  if (alignment === 'branches-left') {
    return (
      <div class="gg-cell gg-cell-desc">
        <span class="gg-refs">{branchRefs.map(label)}</span>
        {subject}
        <span class="gg-refs gg-refs-right">{otherRefs.map(label)}</span>
      </div>
    )
  }
  return (
    <div class="gg-cell gg-cell-desc">
      {refs.length > 0 && (
        <span class="gg-refs">
          {refs.map(label)}
          {overflow}
        </span>
      )}
      {subject}
    </div>
  )
}
