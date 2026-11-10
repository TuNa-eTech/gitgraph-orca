import { Cloud, CloudDownload, CloudOff, LoaderCircle, RefreshCw, Search, Settings } from 'lucide-preact'
import type { ComponentChildren } from 'preact'
import { BranchFilter } from './BranchFilter'

export const ICON_SIZE = 16
const STROKE = 1.75

type IconButtonProps = {
  label: string
  /** Shortcut shown after the label in the tooltip. */
  shortcut?: string
  pressed?: boolean
  disabled?: boolean
  onClick(): void
  children: ComponentChildren
}

export function IconButton({ label, shortcut, pressed, disabled, onClick, children }: IconButtonProps) {
  // No `title`: the panel's TooltipLayer shows `data-tip`, and a native title would show twice.
  return (
    <button
      type="button"
      class={`gg-icon-btn${pressed ? ' on' : ''}`}
      data-tip={label}
      data-tip-kbd={shortcut}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

const mod = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl+'

export type ToolbarProps = {
  title: string
  submodules: string[]
  repoPath: string | undefined
  onRepoPath(path: string | undefined): void
  branches: string[] | null
  patterns: string[]
  branchFilter: string[]
  onBranchFilter(value: string[]): void
  showRemotes: boolean
  onShowRemotes(show: boolean): void
  notice: string | null
  onClearNotice(): void
  findOpen: boolean
  onFind(): void
  /** False when the repository has no remotes. */
  canFetch: boolean
  fetching: boolean
  onFetch(): void
  loading: boolean
  onRefresh(): void
  hasData: boolean
  onSettings(): void
}

export function Toolbar(p: ToolbarProps) {
  return (
    <div class="gg-toolbar">
      <span class="gg-title" title={p.title}>{p.title}</span>
      {p.submodules.length > 0 && (
        <select class="gg-select gg-repo" title="Repository" value={p.repoPath ?? ''} onChange={(e) => p.onRepoPath((e.target as HTMLSelectElement).value || undefined)}>
          <option value="">{p.title}</option>
          {p.submodules.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      )}
      {p.branches !== null && <BranchFilter branches={p.branches} patterns={p.patterns} value={p.branchFilter} onChange={p.onBranchFilter} />}
      <span class="gg-spacer" />
      {p.notice !== null && (
        <span class="gg-notice" title={p.notice} onClick={p.onClearNotice}>
          {p.notice}
        </span>
      )}
      <div class="gg-toolbar-actions">
        <IconButton label="Find" shortcut={`${mod}F`} pressed={p.findOpen} onClick={p.onFind}>
          <Search size={ICON_SIZE} strokeWidth={STROKE} />
        </IconButton>
        <IconButton label={p.showRemotes ? 'Hide remote branches' : 'Show remote branches'} pressed={p.showRemotes} onClick={() => p.onShowRemotes(!p.showRemotes)}>
          {p.showRemotes ? <Cloud size={ICON_SIZE} strokeWidth={STROKE} /> : <CloudOff size={ICON_SIZE} strokeWidth={STROKE} />}
        </IconButton>
        <IconButton label={p.canFetch ? 'Fetch from remotes' : 'Fetch (no remotes)'} disabled={!p.hasData || !p.canFetch || p.fetching || p.loading} onClick={p.onFetch}>
          {p.fetching ? <LoaderCircle class="gg-spin" size={ICON_SIZE} strokeWidth={STROKE} /> : <CloudDownload size={ICON_SIZE} strokeWidth={STROKE} />}
        </IconButton>
        <IconButton label="Refresh" shortcut={`${mod}R`} disabled={p.loading} onClick={p.onRefresh}>
          <RefreshCw class={p.loading ? 'gg-spin' : ''} size={ICON_SIZE} strokeWidth={STROKE} />
        </IconButton>
        <IconButton label="Repository settings" disabled={!p.hasData} onClick={p.onSettings}>
          <Settings size={ICON_SIZE} strokeWidth={STROKE} />
        </IconButton>
      </div>
    </div>
  )
}
