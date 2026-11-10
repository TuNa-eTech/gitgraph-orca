import { useEffect, useState } from 'preact/hooks'

/** A string preference persisted in the plugin's frame storage; falls back to in-memory state when storage fails. */
export function useStoredChoice<T extends string>(key: string, initial: T, allowed: readonly T[]): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial)
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const stored = await orca.storage.get(key)
        if (live && typeof stored === 'string' && (allowed as readonly string[]).includes(stored)) setValue(stored as T)
      } catch {
        // storage unavailable: keep the default
      }
    })()
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const set = (v: T) => {
    setValue(v)
    try {
      void orca.storage.set(key, v).catch(() => {})
    } catch {
      // storage unavailable: choice stays in memory
    }
  }
  return [value, set]
}
