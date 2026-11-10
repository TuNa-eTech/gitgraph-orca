import { createHash } from 'node:crypto'
import type { OrcaWorkerApi } from 'orca/worker'

const TTL_MS = 14 * 24 * 60 * 60 * 1000
const MAX_BYTES = 128 * 1024
const FETCH_TIMEOUT_MS = 8000

type Cached = { dataUri: string | null; fetchedAt: number }

const inflight = new Map<string, Promise<string | null>>()

/** Gravatar image for an email as a data URI, cached in plugin storage. null when none exists. */
export async function getAvatar(orca: OrcaWorkerApi, email: string): Promise<string | null> {
  const normalised = email.trim().toLowerCase()
  if (normalised === '' || !normalised.includes('@')) return null
  const hash = createHash('md5').update(normalised).digest('hex')
  const key = `avatar:${hash}`
  const cached = await orca.storage.get(key).catch(() => null)
  if (isCached(cached) && Date.now() - cached.fetchedAt < TTL_MS) return cached.dataUri

  let pending = inflight.get(key)
  if (pending === undefined) {
    pending = download(hash).then(async ({ dataUri, cache }) => {
      if (cache) await orca.storage.set(key, { dataUri, fetchedAt: Date.now() }).catch(() => undefined)
      return dataUri
    })
    inflight.set(key, pending)
    void pending.finally(() => inflight.delete(key)).catch(() => undefined)
  }
  return pending
}

function isCached(value: unknown): value is Cached {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Cached).fetchedAt === 'number' &&
    (typeof (value as Cached).dataUri === 'string' || (value as Cached).dataUri === null)
  )
}

/** `cache` is false for network failures, so a flaky connection is retried next time. */
async function download(hash: string): Promise<{ dataUri: string | null; cache: boolean }> {
  try {
    const response = await fetch(`https://www.gravatar.com/avatar/${hash}?s=54&d=404`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })
    if (response.status === 404) return { dataUri: null, cache: true }
    if (!response.ok) return { dataUri: null, cache: false }
    const type = response.headers.get('content-type') ?? 'image/jpeg'
    if (!/^image\/(jpeg|png|gif|webp)$/.test(type)) return { dataUri: null, cache: true }
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length === 0 || bytes.length > MAX_BYTES) return { dataUri: null, cache: true }
    return { dataUri: `data:${type};base64,${bytes.toString('base64')}`, cache: true }
  } catch {
    return { dataUri: null, cache: false }
  }
}
