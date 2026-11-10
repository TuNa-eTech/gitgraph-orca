import { ArrowLeft } from 'lucide-preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { IconButton, ICON_SIZE } from '../Toolbar'
import type { FileAtRevisionResult } from '../../../shared/protocol'
import { Notice } from './DiffView'
import { request } from '../../request'

export function FileViewer(props: { repoPath?: string; rev: string; path: string; onBack(): void }) {
  const { repoPath, rev, path } = props
  const [result, setResult] = useState<FileAtRevisionResult | { status: 'error'; message: string } | null>(null)

  useEffect(() => {
    let live = true
    setResult(null)
    request('file.atRevision', { rev, path, repoPath })
      .then((r) => live && setResult(r))
      .catch((e: unknown) => live && setResult({ status: 'error', message: e instanceof Error ? e.message : String(e) }))
    return () => {
      live = false
    }
  }, [repoPath, rev, path])

  const lines = useMemo(() => {
    if (result === null || result.status !== 'ok') return []
    const all = result.content.split('\n')
    if (all[all.length - 1] === '') all.pop()
    return all
  }, [result])

  let body
  if (result === null) body = <Notice>Loading file…</Notice>
  else if (result.status === 'error') body = <Notice>Could not load file: {result.message}</Notice>
  else if (result.status === 'binary') body = <Notice>Binary file; cannot be shown.</Notice>
  else if (result.status === 'too-large') body = <Notice>This file is too large to display ({Math.ceil(result.bytes / 1024)} KiB).</Notice>
  else if (result.status === 'missing') body = <Notice>The file does not exist at this revision.</Notice>
  else
    body = (
      <div class="dp-diff dp-fileview">
        {lines.map((text, i) => (
          <div class="dp-cell" key={i}>
            <span class="dp-lineno">{i + 1}</span>
            <span class="dp-linetext">{text}</span>
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
        <span class="dp-viewer-title" title={`${path} @ ${rev}`}>
          {path} <span class="dp-muted">@ {rev.slice(0, 8)}</span>
        </span>
      </div>
      <div class="dp-viewer-body">{body}</div>
    </div>
  )
}
