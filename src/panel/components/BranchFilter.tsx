import { ChevronDown, GitBranch } from 'lucide-preact'
import { useEffect, useRef, useState } from 'preact/hooks'

export type BranchFilterProps = {
  branches: string[]
  /** Remote-tracking branches (`origin/main`); empty when remote branches are hidden. */
  remoteBranches: string[]
  /** Names of the user's custom glob patterns (`Name|glob` lines). */
  patterns: string[]
  value: string[]
  onChange(value: string[]): void
}

export function BranchFilter({ branches, remoteBranches, patterns, value, onChange }: BranchFilterProps) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (root.current !== null && !root.current.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', key)
    }
  }, [open])

  const selected = new Set(value)
  const toggle = (name: string) => {
    const next = new Set(selected)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    onChange([...next])
  }
  const summary = value.length === 0 ? 'All branches' : value.length === 1 ? value[0] : `${value.length} branches`
  const item = (name: string) => (
    <label key={name} class="gg-menu-item" title={name}>
      <input type="checkbox" checked={selected.has(name)} onChange={() => toggle(name)} />
      <span class="gg-ellipsis">{name}</span>
    </label>
  )
  return (
    <div class="gg-dropdown" ref={root}>
      <button
        type="button"
        class={`gg-dropdown-button${value.length > 0 ? ' filtered' : ''}`}
        data-tip={open ? undefined : `Branches: ${summary}`}
        aria-label={`Branches: ${summary}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <GitBranch size={14} strokeWidth={1.75} />
        <span class="gg-ellipsis gg-dropdown-label">{summary}</span>
        <ChevronDown class="gg-dropdown-chevron" size={12} strokeWidth={2} />
      </button>
      {open && (
        <div class="gg-menu gg-dropdown-menu">
          <label class="gg-menu-item">
            <input type="checkbox" checked={value.length === 0} onChange={() => onChange([])} />
            Show All
          </label>
          {patterns.length > 0 && <div class="gg-menu-sep" />}
          {patterns.map(item)}
          {branches.length > 0 && <div class="gg-menu-sep" />}
          {branches.map(item)}
          {remoteBranches.length > 0 && <div class="gg-menu-sep" />}
          {remoteBranches.length > 0 && <div class="gg-menu-heading">Remote branches</div>}
          {remoteBranches.map(item)}
        </div>
      )}
    </div>
  )
}
