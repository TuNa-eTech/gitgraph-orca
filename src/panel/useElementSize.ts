import { useLayoutEffect, useState } from 'preact/hooks'
import type { RefObject } from 'preact'

export type Size = { width: number; height: number }

/** The element's content-box size, updated on every resize (the panel, the split, the window). */
export function useElementSize(ref: RefObject<HTMLElement>, initial: Size = { width: 800, height: 600 }): Size {
  const [size, setSize] = useState<Size>(initial)
  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    const read = () => setSize((cur) => (cur.width === el.clientWidth && cur.height === el.clientHeight ? cur : { width: el.clientWidth, height: el.clientHeight }))
    const ro = new ResizeObserver(read)
    ro.observe(el)
    read()
    return () => ro.disconnect()
  }, [ref])
  return size
}
