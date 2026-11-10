// Details pane: commit / uncommitted / comparison details, file list, diff and file viewers, code review.
//
// Keyboard: while mounted, a capture-phase window keydown listener handles Up/Down (onNavigate up/down),
// Cmd/Ctrl+Up/Down (child/parent, alt = Shift) and Escape (closes the open viewer, else onClose). Handled
// events get preventDefault + stopPropagation + stopImmediatePropagation so App's own handlers never see
// them. Events are ignored when the target is a text field or when a role="dialog" element is open
// (so dialogs keep Escape), and Up/Down are left alone while a diff/file viewer is open (they scroll it).
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import { UNCOMMITTED } from '../../shared/protocol'
import type { CodeReview, CommitDetails, FileChange, GraphSettings, IssueLinking } from '../../shared/protocol'
import { DiffView } from './details/DiffView'
import { FileViewer } from './details/FileViewer'
import { FileList, FileTree } from './details/FileTree'
import type { FileActions } from './details/FileTree'
import { SIGNATURE_LABEL, linkify, openExternal, reviewKey, shortHash } from './details/format'
import { useStoredChoice } from './details/storage'
import { request } from '../request'
import { formatDate } from '../dates'
import { expandEmoji, parseCustomEmoji } from '../emoji'
import { Check, ClipboardCheck, Copy, FolderTree, List, ListChecks, X } from 'lucide-preact'
import { IconButton, ICON_SIZE } from './Toolbar'
import { ContextMenu, type MenuItem } from './actions/ContextMenu'

type Selection = { kind: 'commit'; hash: string } | { kind: 'compare'; from: string; to: string }

export type DetailsPaneProps = {
  repoPath?: string
  selection: Selection
  settings: GraphSettings
  onClose(): void
  onNavigate(dir: 'up' | 'down' | 'parent' | 'child', alt: boolean): void
  /** Absolute path of the workspace root, for "Copy Absolute Path". */
  rootPath: string
  /** Selects a commit in the graph (used by the parent hash links). */
  onSelectCommit(hash: string): void
}

type Loaded = { details: CommitDetails | null; files: FileChange[] }
type Viewer = { kind: 'diff'; file: FileChange; range: { from: string | null; to: string } } | { kind: 'file'; file: FileChange; rev: string }

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function Linked({ text, linking }: { text: string; linking: IssueLinking | null }) {
  const segments = useMemo(() => linkify(text, linking), [text, linking])
  return (
    <>
      {segments.map((s, i) =>
        s.href === undefined ? (
          s.text
        ) : (
          <a
            key={i}
            href={s.href}
            onClick={(e) => {
              e.preventDefault()
              void openExternal(s.href as string)
            }}
          >
            {s.text}
          </a>
        )
      )}
    </>
  )
}

function CopyButton({ text, title }: { text: string; title: string }) {
  const [done, setDone] = useState(false)
  return (
    <IconButton
      label={done ? 'Copied' : title}
      onClick={() => {
        void copyText(text).then((ok) => {
          if (ok) {
            setDone(true)
            setTimeout(() => setDone(false), 1200)
          }
        })
      }}
    >
      {done ? <Check size={14} /> : <Copy size={14} />}
    </IconButton>
  )
}

let manualCopy: ((text: string) => void) | null = null
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    manualCopy?.(text)
    return false
  }
}

function CopyFallback({ text, onClose }: { text: string; onClose(): void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  return (
    <div class="dp-modal-backdrop" onClick={onClose}>
      <div
        class="dp-modal"
        role="dialog"
        aria-label="Copy text"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
      >
        <div>Clipboard is unavailable. Select and copy the text:</div>
        <input ref={ref} type="text" readOnly value={text} onFocus={(e) => (e.currentTarget as HTMLInputElement).select()} />
        <div class="dp-modal-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function Person({ label, name, email, time, settings }: { label: string; name: string; email: string; time: number; settings: GraphSettings }) {
  return (
    <div class="dp-row">
      <span class="dp-label">{label}</span>
      <span>
        {name} <span class="dp-muted">&lt;{email}&gt;</span> · <span title={new Date(time * 1000).toLocaleString()}>{formatDate(time, settings.dateFormat)}</span>
      </span>
    </div>
  )
}

export function DetailsPane(props: DetailsPaneProps): JSX.Element {
  const { repoPath, selection, settings, rootPath } = props
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [linking, setLinking] = useState<IssueLinking | null>(null)
  const [view, setView] = useStoredChoice<'tree' | 'list'>('details.fileView', 'tree', ['tree', 'list'])
  const [viewer, setViewer] = useState<Viewer | null>(null)
  const [review, setReview] = useState<CodeReview | null>(null)
  const [copyFallback, setCopyFallback] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)

  const selKey = reviewKey(selection)
  const isUncommitted = selection.kind === 'commit' && selection.hash === UNCOMMITTED
  const reviewable = selection.kind === 'compare' || !isUncommitted

  manualCopy = (t) => setCopyFallback(t)
  useEffect(
    () => () => {
      manualCopy = null
    },
    []
  )

  // Load files / details.
  useEffect(() => {
    let live = true
    setLoaded(null)
    setError(null)
    setViewer(null)
    setNotice(null)
    setMenu(null)
    const load = async (): Promise<Loaded> => {
      if (selection.kind === 'compare') {
        const r = await request('commit.compare', { from: selection.from, to: selection.to, repoPath })
        return { details: null, files: r.files }
      }
      if (selection.hash === UNCOMMITTED) {
        const r = await request('commit.uncommitted', { repoPath })
        return { details: null, files: r.files }
      }
      const d = await request('commit.details', { hash: selection.hash, repoPath })
      return { details: d, files: d.files }
    }
    load().then(
      (r) => live && setLoaded(r),
      (e: unknown) => live && setError(errorMessage(e))
    )
    return () => {
      live = false
    }
  }, [repoPath, selKey])

  // Issue-linking config.
  useEffect(() => {
    let live = true
    request('repo.settings', { repoPath }).then(
      (r) => live && setLinking(r.config.issueLinking),
      () => {}
    )
    return () => {
      live = false
    }
  }, [repoPath])

  // Existing review for this selection.
  useEffect(() => {
    let live = true
    setReview(null)
    if (!reviewable) return
    request('review.get', { key: selKey, repoPath }).then(
      (r) => live && setReview(r),
      () => {}
    )
    return () => {
      live = false
    }
  }, [repoPath, selKey, reviewable])

  const files = loaded?.files ?? []
  const remaining = useMemo(() => (review === null ? null : new Set(review.remaining)), [review])

  const diffRange = (): { from: string | null; to: string } =>
    selection.kind === 'compare' ? { from: selection.from, to: selection.to } : { from: null, to: selection.hash }

  /** Revision at which a file's content can be shown; null when it cannot. */
  const viewRev = (file: FileChange): string | null => {
    if (selection.kind === 'compare') {
      const rev = file.status === 'D' ? selection.from : selection.to
      return rev === UNCOMMITTED ? null : rev
    }
    if (selection.hash === UNCOMMITTED) return null
    return file.status === 'D' ? null : selection.hash
  }

  /** Commit the files are shown at when diffing against the working tree; null when not applicable. */
  const workingDiffRev = selection.kind === 'compare' ? selection.to : selection.hash

  const fileMenu = (file: FileChange): MenuItem[] => {
    const rev = viewRev(file)
    const canWorking = workingDiffRev !== UNCOMMITTED && file.status !== 'D'
    const absolute = [rootPath, repoPath, file.path].filter((p): p is string => p !== undefined && p !== '').join('/').replace(/\/{2,}/g, '/')
    const items: MenuItem[] = [{ kind: 'item', label: 'View Diff', onClick: () => actions.onDiff(file) }]
    items.push({ kind: 'item', label: 'View File at This Revision', disabled: rev === null, onClick: () => actions.onViewFile(file) })
    if (canWorking) {
      items.push({
        kind: 'item',
        label: 'Diff with Working File',
        onClick: () => {
          setViewer({ kind: 'diff', file, range: { from: workingDiffRev, to: UNCOMMITTED } })
          void markReviewed(file.path)
        }
      })
    }
    items.push(
      { kind: 'item', label: 'Open File', disabled: file.status === 'D', onClick: () => actions.onOpenFile(file) },
      { kind: 'separator' },
      { kind: 'item', label: 'Copy Relative Path', onClick: () => void copyText(file.path) },
      { kind: 'item', label: 'Copy Absolute Path', onClick: () => void copyText(absolute) }
    )
    return items
  }

  const markReviewed = async (path: string) => {
    if (review === null || !review.remaining.includes(path)) return
    try {
      const updated = await request('review.update', { id: review.id, reviewed: path, repoPath })
      if (updated === null || updated.remaining.length === 0) {
        if (updated !== null) await request('review.end', { id: updated.id, repoPath })
        setReview(null)
      } else setReview(updated)
    } catch (e) {
      setNotice(`Review update failed: ${errorMessage(e)}`)
    }
  }

  const startReview = async () => {
    try {
      setReview(await request('review.start', { key: selKey, files: files.map((f) => f.path), repoPath }))
    } catch (e) {
      setNotice(`Could not start review: ${errorMessage(e)}`)
    }
  }
  const endReview = async () => {
    if (review === null) return
    try {
      await request('review.end', { id: review.id, repoPath })
      setReview(null)
    } catch (e) {
      setNotice(`Could not end review: ${errorMessage(e)}`)
    }
  }

  const actions: FileActions = {
    onDiff: (file) => {
      setViewer({ kind: 'diff', file, range: diffRange() })
      void markReviewed(file.path)
    },
    onViewFile: (file) => {
      const rev = viewRev(file)
      if (rev !== null) setViewer({ kind: 'file', file, rev })
    },
    onOpenFile: (file) => {
      void markReviewed(file.path)
      request('file.open', { path: file.path, repoPath }).then(
        (r) => setNotice(r.opened ? null : `Could not open ${file.path}.`),
        (e: unknown) => setNotice(`Could not open ${file.path}: ${errorMessage(e)}`)
      )
    },
    onCopyPath: (file) => void copyText(file.path),
    onContext: (e, file) => setMenu({ x: e.clientX, y: e.clientY, items: fileMenu(file) }),
    canViewFile: (file) => viewRev(file) !== null,
    remaining,
    activePath: viewer?.file.path
  }

  // Keyboard handling (see header comment).
  const latest = useRef({ props, viewer })
  latest.current = { props, viewer }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (document.querySelector('[role="dialog"]') !== null) return
      const { props: p, viewer: v } = latest.current
      const handled = () => {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
      }
      if (e.key === 'Escape') {
        handled()
        if (v !== null) setViewer(null)
        else p.onClose()
        return
      }
      if (v !== null || e.altKey) return
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const meta = e.metaKey || e.ctrlKey
        if (!meta && e.shiftKey) return
        handled()
        if (meta) p.onNavigate(e.key === 'ArrowUp' ? 'child' : 'parent', e.shiftKey)
        else p.onNavigate(e.key === 'ArrowUp' ? 'up' : 'down', false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const details = loaded?.details ?? null
  const emoji = useMemo(() => parseCustomEmoji(settings.customEmojiShortcodes), [settings.customEmojiShortcodes])
  const title =
    selection.kind === 'compare'
      ? `Compare ${selection.from === UNCOMMITTED ? 'Uncommitted' : shortHash(selection.from)} ↔ ${selection.to === UNCOMMITTED ? 'Uncommitted' : shortHash(selection.to)}`
      : isUncommitted
        ? 'Uncommitted Changes'
        : `Commit ${shortHash(selection.hash)}`

  const sums = useMemo(() => {
    let add = 0
    let del = 0
    for (const f of files) {
      add += f.additions ?? 0
      del += f.deletions ?? 0
    }
    return { add, del }
  }, [files])

  let content: JSX.Element
  if (viewer !== null && viewer.kind === 'diff') {
    content = <DiffView repoPath={repoPath} from={viewer.range.from} to={viewer.range.to} file={viewer.file} onBack={() => setViewer(null)} />
  } else if (viewer !== null) {
    content = <FileViewer repoPath={repoPath} rev={viewer.rev} path={viewer.file.path} onBack={() => setViewer(null)} />
  } else {
    content = (
      <div class="dp-scroll">
        {details !== null && (
          <div class="dp-meta">
            <div class="dp-row">
              <span class="dp-label">Commit</span>
              <span class="dp-mono">{details.hash}</span>
              <CopyButton text={details.hash} title="Copy commit hash" />
            </div>
            {details.parents.length > 0 && (
              <div class="dp-row">
                <span class="dp-label">{details.parents.length > 1 ? 'Parents' : 'Parent'}</span>
                <span class="dp-parents">
                  {details.parents.map((p) => (
                    <span class="dp-parent" key={p}>
                      <button type="button" class="dp-link dp-mono" data-tip={`Go to ${p}`} onClick={() => props.onSelectCommit(p)}>
                        {shortHash(p)}
                      </button>
                      <CopyButton text={p} title="Copy parent hash" />
                    </span>
                  ))}
                </span>
              </div>
            )}
            <Person label="Author" name={details.author} email={details.authorEmail} time={details.authorTime} settings={settings} />
            {(details.committer !== details.author || details.committerEmail !== details.authorEmail || details.committerTime !== details.authorTime) && (
              <Person label="Committer" name={details.committer} email={details.committerEmail} time={details.committerTime} settings={settings} />
            )}
            {details.signature !== undefined && details.signature.status !== 'N' && (
              <div class="dp-row">
                <span class="dp-label">Signature</span>
                <span class={`dp-sig dp-sig-${details.signature.status === 'G' ? 'good' : 'bad'}`}>
                  {SIGNATURE_LABEL[details.signature.status]}
                  {details.signature.signer !== '' && <span class="dp-muted"> · {details.signature.signer}</span>}
                  {details.signature.key !== '' && <span class="dp-muted dp-mono"> · {details.signature.key}</span>}
                </span>
              </div>
            )}
            <div class="dp-subject">
              <Linked text={expandEmoji(details.subject, emoji)} linking={linking} />
            </div>
            {details.body.trim() !== '' && (
              <div class="dp-body">
                <Linked text={expandEmoji(details.body.trim(), emoji)} linking={linking} />
              </div>
            )}
          </div>
        )}
        <div class="dp-files-head">
          <span>
            {files.length} file{files.length === 1 ? '' : 's'} changed{' '}
            <span class="dp-add">+{sums.add}</span> <span class="dp-del">−{sums.del}</span>
          </span>
          <span class="dp-segment" role="group" aria-label="File view">
            <IconButton label="Tree view" pressed={view === 'tree'} onClick={() => setView('tree')}>
              <FolderTree size={ICON_SIZE} />
            </IconButton>
            <IconButton label="List view" pressed={view === 'list'} onClick={() => setView('list')}>
              <List size={ICON_SIZE} />
            </IconButton>
          </span>
        </div>
        {review !== null && (
          <div class="dp-muted dp-review-note">
            Code review: {review.remaining.length} of {files.length} file{files.length === 1 ? '' : 's'} left to review
          </div>
        )}
        {loaded !== null && files.length === 0 && <div class="dp-notice">No file changes.</div>}
        {view === 'tree' ? <FileTree files={files} actions={actions} /> : <FileList files={files} actions={actions} />}
      </div>
    )
  }

  return (
    <div class="dp-pane" tabIndex={-1}>
      <div class="dp-header">
        <span class="dp-title">{title}</span>
        {reviewable &&
          loaded !== null &&
          (review === null ? (
            <IconButton label="Start code review" disabled={files.length === 0} onClick={() => void startReview()}>
              <ListChecks size={ICON_SIZE} />
            </IconButton>
          ) : (
            <IconButton label={`End code review (${review.remaining.length} left)`} pressed onClick={() => void endReview()}>
              <ClipboardCheck size={ICON_SIZE} />
            </IconButton>
          ))}
        <IconButton label="Close details" shortcut="Esc" onClick={props.onClose}>
          <X size={ICON_SIZE} />
        </IconButton>
      </div>
      {error !== null && <div class="dp-notice dp-error">Could not load details: {error}</div>}
      {notice !== null && <div class="dp-notice dp-error">{notice}</div>}
      {loaded === null && error === null && <div class="dp-notice">Loading…</div>}
      {(loaded !== null || viewer !== null) && content}
      {menu !== null && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {copyFallback !== null && <CopyFallback text={copyFallback} onClose={() => setCopyFallback(null)} />}
    </div>
  )
}
