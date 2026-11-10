import { CaseSensitive, ChevronDown, ChevronUp, Regex, X } from 'lucide-preact'
import { useEffect, useRef } from 'preact/hooks'
import { IconButton, ICON_SIZE } from './Toolbar'

export type FindState = { query: string; caseSensitive: boolean; regex: boolean }

export type FindWidgetProps = {
  state: FindState
  count: number
  /** 0-based index of the current match, -1 when none. */
  index: number
  invalid: boolean
  focusToken: number
  onChange(next: FindState): void
  onStep(delta: 1 | -1): void
  onClose(): void
}

export function FindWidget(props: FindWidgetProps) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [props.focusToken])
  const { state } = props
  const status = state.query === '' ? '' : props.invalid ? 'Invalid' : props.count === 0 ? 'No results' : `${props.index + 1}/${props.count}`
  return (
    <div class="gg-find" role="search">
      <input
        ref={input}
        type="text"
        placeholder="Find"
        value={state.query}
        class={props.invalid ? 'invalid' : ''}
        onInput={(e) => props.onChange({ ...state, query: (e.target as HTMLInputElement).value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            props.onStep(e.shiftKey ? -1 : 1)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            props.onClose()
          }
        }}
      />
      <IconButton label="Match case" pressed={state.caseSensitive} onClick={() => props.onChange({ ...state, caseSensitive: !state.caseSensitive })}>
        <CaseSensitive size={ICON_SIZE} />
      </IconButton>
      <IconButton label="Use regular expression" pressed={state.regex} onClick={() => props.onChange({ ...state, regex: !state.regex })}>
        <Regex size={ICON_SIZE} />
      </IconButton>
      <span class="gg-find-status" aria-live="polite">{status}</span>
      <IconButton label="Previous match" shortcut="Shift+Enter" disabled={props.count === 0} onClick={() => props.onStep(-1)}>
        <ChevronUp size={ICON_SIZE} />
      </IconButton>
      <IconButton label="Next match" shortcut="Enter" disabled={props.count === 0} onClick={() => props.onStep(1)}>
        <ChevronDown size={ICON_SIZE} />
      </IconButton>
      <IconButton label="Close" shortcut="Escape" onClick={props.onClose}>
        <X size={ICON_SIZE} />
      </IconButton>
    </div>
  )
}
