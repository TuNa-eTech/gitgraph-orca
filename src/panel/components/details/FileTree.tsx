import { Copy, Eye, FileDiff, SquareArrowOutUpRight } from 'lucide-preact'
import { useMemo, useState } from 'preact/hooks'
import { IconButton } from '../Toolbar'
import type { FileChange } from '../../../shared/protocol'
import { STATUS_LABEL, baseName, dirName } from './format'

export type FileActions = {
  onDiff(file: FileChange): void
  onViewFile(file: FileChange): void
  onOpenFile(file: FileChange): void
  onCopyPath(file: FileChange): void
  onContext?(e: MouseEvent, file: FileChange): void
  canViewFile(file: FileChange): boolean
  /** Paths still to review; null when no review is active. */
  remaining: ReadonlySet<string> | null
  activePath?: string
}

function Counts({ file }: { file: FileChange }) {
  if (file.additions === null || file.deletions === null) return <span class="dp-counts dp-muted">bin</span>
  return (
    <span class="dp-counts">
      <span class="dp-add">+{file.additions}</span> <span class="dp-del">−{file.deletions}</span>
    </span>
  )
}

function FileRow({ file, actions, depth, label }: { file: FileChange; actions: FileActions; depth: number; label: 'path' | 'name' }) {
  const unreviewed = actions.remaining?.has(file.path) ?? false
  const name = baseName(file.path)
  const title =
    file.oldPath !== undefined ? `${STATUS_LABEL[file.status]}: ${file.oldPath} → ${file.path}` : `${STATUS_LABEL[file.status]}: ${file.path}`
  return (
    <div
      class={`dp-file${unreviewed ? ' dp-unreviewed' : ''}${actions.activePath === file.path ? ' dp-active' : ''}`}
      style={{ paddingLeft: `${6 + depth * 12}px` }}
      data-tip={title}
      role="button"
      tabIndex={0}
      onClick={() => actions.onDiff(file)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          actions.onDiff(file)
        }
      }}
      onContextMenu={(e) => {
        if (actions.onContext) {
          e.preventDefault()
          actions.onContext(e, file)
        }
      }}
    >
      <span class={`dp-status dp-status-${file.status}`}>{file.status}</span>
      <span class="dp-file-name">
        {label === 'path' && <span class="dp-muted">{dirName(file.path)}</span>}
        {file.oldPath !== undefined ? (
          <>
            <span class="dp-muted">{label === 'path' ? file.oldPath : baseName(file.oldPath)} → </span>
            {label === 'path' ? baseName(file.path) : name}
          </>
        ) : (
          name
        )}
      </span>
      <Counts file={file} />
      <span class="dp-file-actions" onClick={(e) => e.stopPropagation()}>
        <IconButton label="View diff" onClick={() => actions.onDiff(file)}>
          <FileDiff size={14} />
        </IconButton>
        <IconButton label="View file at revision" disabled={!actions.canViewFile(file)} onClick={() => actions.onViewFile(file)}>
          <Eye size={14} />
        </IconButton>
        <IconButton label="Open file in editor" disabled={file.status === 'D'} onClick={() => actions.onOpenFile(file)}>
          <SquareArrowOutUpRight size={14} />
        </IconButton>
        <IconButton label="Copy relative path" onClick={() => actions.onCopyPath(file)}>
          <Copy size={14} />
        </IconButton>
      </span>
    </div>
  )
}

export function FileList({ files, actions }: { files: FileChange[]; actions: FileActions }) {
  return (
    <div class="dp-files">
      {files.map((f) => (
        <FileRow key={f.path} file={f} actions={actions} depth={0} label="path" />
      ))}
    </div>
  )
}

type Dir = { name: string; path: string; dirs: Map<string, Dir>; files: FileChange[] }

function buildTree(files: FileChange[]): Dir {
  const root: Dir = { name: '', path: '', dirs: new Map(), files: [] }
  for (const file of files) {
    const parts = file.path.split('/')
    parts.pop()
    let node = root
    for (const part of parts) {
      let next = node.dirs.get(part)
      if (next === undefined) {
        next = { name: part, path: node.path === '' ? part : `${node.path}/${part}`, dirs: new Map(), files: [] }
        node.dirs.set(part, next)
      }
      node = next
    }
    node.files.push(file)
  }
  return root
}

/** Merges chains of directories that contain a single directory and no files. */
function compact(dir: Dir): Dir {
  let node = dir
  while (node.path !== '' && node.files.length === 0 && node.dirs.size === 1) {
    const only = [...node.dirs.values()][0]
    if (only === undefined) break
    node = { ...only, name: `${node.name}/${only.name}` }
  }
  return node
}

function DirNode({ dir, actions, depth, collapsed, toggle }: { dir: Dir; actions: FileActions; depth: number; collapsed: Set<string>; toggle(p: string): void }) {
  const shown = depth === 0 ? dir : compact(dir)
  const dirs = [...shown.dirs.values()].sort((a, b) => a.name.localeCompare(b.name))
  const files = [...shown.files].sort((a, b) => baseName(a.path).localeCompare(baseName(b.path)))
  const closed = collapsed.has(shown.path)
  return (
    <>
      {depth > 0 && (
        <div
          class="dp-dir"
          style={{ paddingLeft: `${6 + (depth - 1) * 12}px` }}
          role="button"
          tabIndex={0}
          aria-expanded={!closed}
          onClick={() => toggle(shown.path)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              toggle(shown.path)
            }
          }}
        >
          <span class="dp-twisty">{closed ? '▸' : '▾'}</span> {shown.name}
        </div>
      )}
      {!closed && (
        <>
          {dirs.map((d) => (
            <DirNode key={d.path} dir={d} actions={actions} depth={depth + 1} collapsed={collapsed} toggle={toggle} />
          ))}
          {files.map((f) => (
            <FileRow key={f.path} file={f} actions={actions} depth={depth} label="name" />
          ))}
        </>
      )}
    </>
  )
}

export function FileTree({ files, actions }: { files: FileChange[]; actions: FileActions }) {
  const root = useMemo(() => buildTree(files), [files])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggle = (p: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (!next.delete(p)) next.add(p)
      return next
    })
  return (
    <div class="dp-files">
      <DirNode dir={root} actions={actions} depth={0} collapsed={collapsed} toggle={toggle} />
    </div>
  )
}
