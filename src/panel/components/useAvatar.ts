import { useEffect, useState } from 'preact/hooks'
import { request } from '../request'

const cache = new Map<string, string | null>()
const pending = new Map<string, Promise<string | null>>()

function fetchAvatar(email: string, hash: string): Promise<string | null> {
  const cached = cache.get(email)
  if (cached !== undefined) return Promise.resolve(cached)
  let promise = pending.get(email)
  if (promise === undefined) {
    promise = request('avatar.get', { email, hash })
      .then((r) => r.dataUri)
      .catch(() => null)
      .then((uri) => {
        cache.set(email, uri)
        pending.delete(email)
        return uri
      })
    pending.set(email, promise)
  }
  return promise
}

export function clearAvatarCache(): void {
  cache.clear()
}

/** Avatar data URI for an author email, cached per email; null while loading or unavailable. */
export function useAvatar(email: string, hash: string, enabled: boolean): string | null {
  const [uri, setUri] = useState<string | null>(enabled ? (cache.get(email) ?? null) : null)
  useEffect(() => {
    if (!enabled || email === '') {
      setUri(null)
      return
    }
    let alive = true
    void fetchAvatar(email, hash).then((u) => alive && setUri(u))
    return () => {
      alive = false
    }
  }, [email, hash, enabled])
  return uri
}
