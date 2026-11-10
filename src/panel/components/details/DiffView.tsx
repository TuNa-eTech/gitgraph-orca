import { ArrowLeft, Columns2, Rows2 } from 'lucide-preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { IconButton, ICON_SIZE } from '../Toolbar'
import type { DiffResult, FileChange } from '../../../shared/protocol'
import { useStoredChoice } from './storage'
import { request } from '../../request'

export type DiffLine = { kind: 'ctx' | 'add' | 'del'; oldNo: number | null; newNo: number | null; text: string }
export type Hunk = { header: string; lines: DiffLine[] }

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/** Parses a unified diff (as printed by `git diff`) into hunks, ignoring the file header. */
export function parsePatch(patch: string): Hunk[] {
  const hunks: Hunk[] = []
  let current: Hunk | null = null
  let oldNo = 0
  let newNo = 0
  for (const raw of patch.split('\n')) {
    const m = HUNK_RE.exec(raw)
    if (m) {
      current = { header: raw, lines: [] }
      hunks.push(current)
      oldNo = Number(m[1])
      newNo = Number(m[2])
      continue
    }
    if (current === null) continue
    const c = raw[0]
    const text = raw.slice(1)
    if (c === '+') current.lines.push({ kind: 'add', oldNo: null, newNo: newNo++, text })
    else if (c === '-') current.lines.push({ kind: 'del', oldNo: oldNo++, newNo: null, text })
    else if (c === ' ') current.lines.push({ kind: 'ctx', oldNo: oldNo++, newNo: newNo++, text })
    // "\ No newline at end of file" and trailing empties are dropped
  }
  return hunks
}

type SplitRow = { left: DiffLine | null; right: DiffLine | null }

function toSplit(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line === undefined) break
    if (line.kind === 'ctx') {
      rows.push({ left: line, right: line })
      i++
      continue
    }
    const dels: DiffLine[] = []
    const adds: DiffLine[] = []
    while (lines[i]?.kind === 'del') dels.push(lines[i++] as DiffLine)
    while (lines[i]?.kind === 'add') adds.push(lines[i++] as DiffLine)
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) rows.push({ left: dels[k] ?? null, right: adds[k] ?? null })
  }
  return rows
}

function Cell({ line, side }: { line: DiffLine | null; side: 'old' | 'new' }) {
  if (line === null) return <div class="dp-cell dp-cell-empty" />
  const no = side === 'old' ? line.oldNo : line.newNo
  return (
    <div class={`dp-cell dp-line-${line.kind}`}>
      <span class="dp-lineno">{no ?? ''}</span>
      <span class="dp-linetext">{line.text}</span>
    </div>
  )
}

export function Notice({ children }: { children: preact.ComponentChildren }) {
  return <div class="dp-notice">{children}</div>
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KiB`
  return `${(n / 1048576).toFixed(1)} MiB`
}

export function DiffView(props: { repoPath?: string; from: string | null; to: string; file: FileChange; onBack(): void }) {
  const { repoPath, from, to, file } = props
  const [layout, setLayout] = useStoredChoice<'split' | 'inline'>('details.diffLayout', 'inline', ['split', 'inline'])
  const [result, setResult] = useState<DiffResult | { status: 'error'; message: string } | null>(null)

  useEffect(() => {
    let live = true
    setResult(null)
    request('file.diff', { from, to, path: file.path, oldPath: file.oldPath, repoPath })
      .then((r) => live && setResult(r))
      .catch((e: unknown) => live && setResult({ status: 'error', message: e instanceof Error ? e.message : String(e) }))
    return () => {
      live = false
    }
  }, [repoPath, from, to, file.path, file.oldPath])

  const hunks = useMemo(() => (result !== null && result.status === 'ok' && !result.binary ? parsePatch(result.patch) : []), [result])

  let body
  if (result === null) body = <Notice>Loading diff…</Notice>
  else if (result.status === 'error') body = <Notice>Could not load diff: {result.message}</Notice>
  else if (result.status === 'too-large') body = <Notice>This diff is too large to display ({formatBytes(result.bytes)}).</Notice>
  else if (result.binary) body = <Notice>Binary file; no text diff available.</Notice>
  else if (hunks.length === 0) body = <Notice>No textual changes (mode change or empty file).</Notice>
  else
    body = (
      <div class={`dp-diff dp-diff-${layout}`}>
        {hunks.map((h, hi) => (
          <div class="dp-hunk" key={hi}>
            <div class="dp-hunk-header">{h.header}</div>
            {layout === 'inline'
              ? h.lines.map((l, li) => (
                  <div class={`dp-cell dp-line-${l.kind}`} key={li}>
                    <span class="dp-lineno">{l.oldNo ?? ''}</span>
                    <span class="dp-lineno">{l.newNo ?? ''}</span>
                    <span class="dp-linetext">
                      {l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}
                      {l.text}
                    </span>
                  </div>
                ))
              : toSplit(h.lines).map((row, ri) => (
                  <div class="dp-split-row" key={ri}>
                    <Cell line={row.left} side="old" />
                    <Cell line={row.right} side="new" />
                  </div>
                ))}
          </div>
        ))}
      </div>
    )

  return (
    <div class="dp-viewer">
      <div class="dp-viewer-bar">
        <IconButton label="Back to files" shortcut="Esc" onClick={props.onBack}>
          <ArrowLeft size={ICON_SIZE} />
        </IconButton>
        <span class="dp-viewer-title" title={file.path}>
          {file.oldPath !== undefined ? `${file.oldPath} → ${file.path}` : file.path}
        </span>
        <span class="dp-segment" role="group" aria-label="Diff layout">
          <IconButton label="Inline diff" pressed={layout === 'inline'} onClick={() => setLayout('inline')}>
            <Rows2 size={ICON_SIZE} />
          </IconButton>
          <IconButton label="Side-by-side diff" pressed={layout === 'split'} onClick={() => setLayout('split')}>
            <Columns2 size={ICON_SIZE} />
          </IconButton>
        </span>
      </div>
      <div class="dp-viewer-body">{body}</div>
    </div>
  )
}
