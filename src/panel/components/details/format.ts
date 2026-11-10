// Formatting and text-linking helpers for the details pane.
import type { DiffInput, FileStatus, IssueLinking, SignatureStatus } from '../../../shared/protocol'

export type ChangeStatus = FileStatus

export const STATUS_LABEL: Record<FileStatus, string> = {
  A: 'Added',
  M: 'Modified',
  D: 'Deleted',
  R: 'Renamed',
  C: 'Copied',
  U: 'Untracked'
}

export const SIGNATURE_LABEL: Record<SignatureStatus, string> = {
  G: 'Valid signature',
  B: 'Bad signature',
  U: 'Good signature, unknown validity',
  X: 'Good signature, expired',
  Y: 'Good signature, expired key',
  R: 'Good signature, revoked key',
  E: 'Signature cannot be checked',
  N: 'No signature'
}

export function shortHash(hash: string): string {
  return hash.slice(0, 8)
}

export function baseName(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? path : path.slice(i + 1)
}

export function dirName(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i + 1)
}

/** Key identifying a review of a commit or a comparison. */
export function reviewKey(sel: { kind: 'commit'; hash: string } | { kind: 'compare'; from: string; to: string }): string {
  return sel.kind === 'commit' ? sel.hash : `${sel.from}..${sel.to}`
}

export type DiffTarget = Pick<DiffInput, 'from' | 'to'>

// ---------- linkification ----------

export type Segment = { text: string; href?: string }

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]}]/g

function compileIssue(linking: IssueLinking | null): RegExp | null {
  if (linking === null || linking.issue === '') return null
  try {
    return new RegExp(linking.issue, 'g')
  } catch {
    return null
  }
}

/** Splits `text` into plain and link segments: plain URLs, plus issue references from the repo's issue-linking config. */
export function linkify(text: string, linking: IssueLinking | null): Segment[] {
  type Hit = { start: number; end: number; href: string }
  const hits: Hit[] = []
  for (const m of text.matchAll(URL_RE)) {
    hits.push({ start: m.index, end: m.index + m[0].length, href: m[0] })
  }
  const issueRe = compileIssue(linking)
  if (issueRe !== null && linking !== null) {
    for (const m of text.matchAll(issueRe)) {
      if (m[0] === '') continue
      const href = linking.url.replace(/\$(\d+)/g, (_, n: string) => m[Number(n)] ?? '')
      if (!/^https?:\/\//i.test(href)) continue
      hits.push({ start: m.index, end: m.index + m[0].length, href })
    }
  }
  hits.sort((a, b) => a.start - b.start || b.end - a.end)
  const out: Segment[] = []
  let pos = 0
  for (const hit of hits) {
    if (hit.start < pos) continue
    if (hit.start > pos) out.push({ text: text.slice(pos, hit.start) })
    out.push({ text: text.slice(hit.start, hit.end), href: hit.href })
    pos = hit.end
  }
  if (pos < text.length) out.push({ text: text.slice(pos) })
  return out
}

export async function openExternal(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return
  await orca.shell?.openExternal(url)
}
