// One tooltip for the whole panel. Elements opt in with `data-tip` (and `data-tip-kbd` for a
// shortcut); pointer and focus events are delegated from the document, so buttons keep no state.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'

const SHOW_DELAY_MS = 400
/** Moving to another button within this time after a tooltip hid shows the next one at once. */
const WARM_MS = 500
const GAP = 6
const MARGIN = 4

type Tip = { text: string; kbd: string | null; anchor: DOMRect }

const tipTarget = (node: EventTarget | null): HTMLElement | null =>
  node instanceof Element ? (node.closest('[data-tip]') as HTMLElement | null) : null

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null)
  // Position is written straight to the element after it renders: its size is only known then.
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let current: HTMLElement | null = null
    let timer: number | undefined
    let hiddenAt = 0
    /** A tooltip is on screen: moving to another button replaces it at once. */
    let visible = false

    const show = (el: HTMLElement) => {
      const text = el.dataset.tip
      if (!text) return
      visible = true
      setTip({ text, kbd: el.dataset.tipKbd ?? null, anchor: el.getBoundingClientRect() })
    }
    const schedule = (el: HTMLElement, immediate: boolean) => {
      clearTimeout(timer)
      current = el
      if (immediate || visible || Date.now() - hiddenAt < WARM_MS) show(el)
      else timer = window.setTimeout(() => current === el && show(el), SHOW_DELAY_MS)
    }
    const hide = () => {
      clearTimeout(timer)
      if (visible) hiddenAt = Date.now()
      visible = false
      current = null
      setTip(null)
    }

    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      const el = tipTarget(e.target)
      if (el !== null && el !== current) schedule(el, false)
    }
    const onOut = (e: PointerEvent) => {
      if (current === null) return
      const next = e.relatedTarget
      if (next instanceof Node && current.contains(next)) return
      const el = tipTarget(next)
      if (el !== null) schedule(el, false)
      else hide()
    }
    const onFocusIn = (e: FocusEvent) => {
      const el = tipTarget(e.target)
      // Keyboard focus only: a click also focuses the button and should not pop a tooltip.
      if (el !== null && el.matches(':focus-visible')) schedule(el, true)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide()

    document.addEventListener('pointerover', onOver)
    document.addEventListener('pointerout', onOut)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', hide)
    document.addEventListener('pointerdown', hide, true)
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('scroll', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('pointerover', onOver)
      document.removeEventListener('pointerout', onOut)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', hide)
      document.removeEventListener('pointerdown', hide, true)
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('scroll', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [])

  // Centre under the anchor; flip above when it would leave the panel, clamp to the sides.
  useLayoutEffect(() => {
    const el = box.current
    if (tip === null || el === null) return
    const { width, height } = el.getBoundingClientRect()
    const a = tip.anchor
    const below = a.bottom + GAP + height <= window.innerHeight - MARGIN
    const top = below ? a.bottom + GAP : Math.max(MARGIN, a.top - GAP - height)
    const left = Math.min(Math.max(MARGIN, a.left + a.width / 2 - width / 2), window.innerWidth - width - MARGIN)
    el.style.left = `${Math.round(left)}px`
    el.style.top = `${Math.round(top)}px`
    el.style.visibility = 'visible'
  }, [tip])

  if (tip === null) return null
  return (
    <div
      ref={box}
      class="gg-tip"
      role="tooltip"
      style={{ visibility: 'hidden', left: '0px', top: '0px' }}
    >
      {tip.text}
      {tip.kbd !== null && <kbd class="gg-tip-kbd">{tip.kbd}</kbd>}
    </div>
  )
}
