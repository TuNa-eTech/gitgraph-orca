import { randomUUID } from 'node:crypto'
import type { OrcaWorkerApi } from 'orca/worker'
import type { CodeReview, ViewState } from '../shared/protocol'

const REVIEW_TTL_MS = 90 * 24 * 60 * 60 * 1000

const viewKey = (cwd: string): string => `view:${cwd}`
const reviewKey = (cwd: string): string => `reviews:${cwd}`

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function sanitiseView(value: unknown): ViewState | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const widths: Record<string, number> = {}
  if (typeof raw.columnWidths === 'object' && raw.columnWidths !== null) {
    for (const [key, width] of Object.entries(raw.columnWidths)) {
      if (typeof width === 'number' && Number.isFinite(width)) widths[key] = width
    }
  }
  const state: ViewState = {
    columnWidths: widths,
    hiddenColumns: isStringArray(raw.hiddenColumns) ? raw.hiddenColumns : [],
    branchFilter: isStringArray(raw.branchFilter) ? raw.branchFilter : []
  }
  if (typeof raw.scrollTop === 'number' && Number.isFinite(raw.scrollTop)) state.scrollTop = raw.scrollTop
  return state
}

export async function loadView(orca: OrcaWorkerApi, cwd: string): Promise<ViewState | null> {
  return sanitiseView(await orca.storage.get(viewKey(cwd)))
}

export async function saveView(orca: OrcaWorkerApi, cwd: string, state: ViewState): Promise<void> {
  const clean = sanitiseView(state)
  if (clean !== null) await orca.storage.set(viewKey(cwd), clean as never)
}

function sanitiseReview(value: unknown): CodeReview | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || typeof raw.key !== 'string' || !isStringArray(raw.remaining)) return null
  if (typeof raw.lastActive !== 'number') return null
  return { id: raw.id, key: raw.key, remaining: raw.remaining, lastActive: raw.lastActive }
}

/** Reviews for one repository with the expired ones dropped (and removed from storage). */
async function loadReviews(orca: OrcaWorkerApi, cwd: string): Promise<CodeReview[]> {
  const stored = await orca.storage.get(reviewKey(cwd))
  const all = Array.isArray(stored) ? stored.map(sanitiseReview).filter((review): review is CodeReview => review !== null) : []
  const now = Date.now()
  const live = all.filter((review) => now - review.lastActive < REVIEW_TTL_MS)
  if (live.length !== all.length) await saveReviews(orca, cwd, live)
  return live
}

async function saveReviews(orca: OrcaWorkerApi, cwd: string, reviews: CodeReview[]): Promise<void> {
  if (reviews.length === 0) await orca.storage.delete(reviewKey(cwd))
  else await orca.storage.set(reviewKey(cwd), reviews as never)
}

export async function getReview(orca: OrcaWorkerApi, cwd: string, key: string): Promise<CodeReview | null> {
  return (await loadReviews(orca, cwd)).find((review) => review.key === key) ?? null
}

export async function startReview(orca: OrcaWorkerApi, cwd: string, key: string, files: string[]): Promise<CodeReview> {
  const reviews = (await loadReviews(orca, cwd)).filter((review) => review.key !== key)
  const review: CodeReview = { id: randomUUID(), key, remaining: [...new Set(files)], lastActive: Date.now() }
  reviews.push(review)
  await saveReviews(orca, cwd, reviews)
  return review
}

/** Marks `reviewed` done. Returns null when the review does not exist (or just finished and was removed). */
export async function updateReview(orca: OrcaWorkerApi, cwd: string, id: string, reviewed: string): Promise<CodeReview | null> {
  const reviews = await loadReviews(orca, cwd)
  const review = reviews.find((entry) => entry.id === id)
  if (review === undefined) return null
  review.remaining = review.remaining.filter((file) => file !== reviewed)
  review.lastActive = Date.now()
  await saveReviews(orca, cwd, reviews)
  return review
}

export async function endReview(orca: OrcaWorkerApi, cwd: string, id: string): Promise<void> {
  const reviews = await loadReviews(orca, cwd)
  await saveReviews(orca, cwd, reviews.filter((review) => review.id !== id))
}
