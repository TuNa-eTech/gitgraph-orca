import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'

export type MenuItem =
  | { kind: 'item'; label: string; disabled?: boolean; onClick: () => void }
  | { kind: 'separator' }

export function ContextMenu(props: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const { items, onClose } = props
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: props.x, y: props.y })
  const [active, setActive] = useState(-1)

  // Keep the menu inside the viewport once its size is known.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      x: Math.max(0, Math.min(props.x, window.innerWidth - width - 2)),
      y: Math.max(0, Math.min(props.y, window.innerHeight - height - 2)),
    })
  }, [props.x, props.y, items])

  const enabled = items.flatMap((it, i) => (it.kind === 'item' && !it.disabled ? [i] : []))

  useEffect(() => {
    const onPointerDown = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (enabled.length === 0) return
        const dir = e.key === 'ArrowDown' ? 1 : -1
        setActive((cur) => {
          const at = enabled.indexOf(cur)
          const next = at < 0 ? (dir === 1 ? 0 : enabled.length - 1) : (at + dir + enabled.length) % enabled.length
          return enabled[next]
        })
      } else if (e.key === 'Enter') {
        const it = items[active]
        if (it && it.kind === 'item' && !it.disabled) {
          e.preventDefault()
          e.stopPropagation()
          onClose()
          it.onClick()
        }
      }
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
    }
  })

  return (
    <div
      ref={ref}
      class="act-menu"
      role="menu"
      style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) =>
        it.kind === 'separator' ? (
          <div class="act-menu-sep" role="separator" key={i} />
        ) : (
          <div
            key={i}
            role="menuitem"
            aria-disabled={it.disabled ? 'true' : undefined}
            class={`act-menu-item${it.disabled ? ' disabled' : ''}${i === active ? ' active' : ''}`}
            onMouseEnter={() => setActive(it.disabled ? -1 : i)}
            onClick={() => {
              if (it.disabled) return
              onClose()
              it.onClick()
            }}
          >
            {it.label}
          </div>
        )
      )}
    </div>
  )
}
