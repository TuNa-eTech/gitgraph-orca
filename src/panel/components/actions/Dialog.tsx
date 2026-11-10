import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'

export type FieldOption = { value: string; label: string }
export type DialogValues = Record<string, string | boolean>

type FieldBase = {
  id: string
  label: string
  /** Hide the field (and skip its validation) while this returns false. */
  when?: (values: DialogValues) => boolean
  hint?: string
}

export type DialogField =
  | (FieldBase & {
      kind: 'text'
      value?: string
      placeholder?: string
      multiline?: boolean
      /** Return an error message, or null when the value is acceptable. */
      validate?: (value: string, values: DialogValues) => string | null
    })
  | (FieldBase & { kind: 'checkbox'; value?: boolean })
  | (FieldBase & { kind: 'select'; options: FieldOption[]; value?: string })
  | (FieldBase & { kind: 'radio'; options: FieldOption[]; value?: string })

export type DialogSpec = {
  title: string
  message?: ComponentChildren
  fields?: DialogField[]
  /** Selectable block of text (copy fallback, command output). */
  preformatted?: string
  primary: { label: string; danger?: boolean }
  /** Label of the cancel button; `null` hides it. Default "Cancel". */
  cancelLabel?: string | null
  /** Responsible for closing the dialog (or replacing it) when it succeeds. */
  onSubmit: (values: DialogValues) => Promise<void> | void
  onCancel?: () => void
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Modal shell: backdrop, Escape to close, Tab focus trap, focus restore. */
export function Modal(props: {
  title: string
  onClose: () => void
  children: ComponentChildren
  footer?: ComponentChildren
  wide?: boolean
  onEnter?: () => void
  /** Ignore Escape/Enter while a request is running. */
  busy?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { busy, onClose, onEnter } = props

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const root = ref.current
    if (root) {
      const first = root.querySelector<HTMLElement>('[data-autofocus], input:not([type=checkbox]):not([type=radio]), textarea, select')
      ;(first ?? root.querySelector<HTMLElement>('button.primary') ?? root).focus()
    }
    return () => previous?.focus?.()
  }, [])

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (!busy) onClose()
      return
    }
    if (e.key === 'Enter' && onEnter && !e.isComposing) {
      const t = e.target as HTMLElement
      const tag = t.tagName
      if (tag === 'TEXTAREA' || tag === 'SELECT') return
      if (tag === 'BUTTON' && !t.classList.contains('primary')) return
      e.preventDefault()
      if (!busy) onEnter()
      return
    }
    if (e.key === 'Tab' && ref.current) {
      const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === ref.current)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  return (
    <div class="act-backdrop">
      <div
        ref={ref}
        class={props.wide ? 'act-modal act-modal-wide' : 'act-modal'}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div class="act-modal-title">{props.title}</div>
        <div class="act-modal-body">{props.children}</div>
        {props.footer ? <div class="act-modal-footer">{props.footer}</div> : null}
      </div>
    </div>
  )
}

function initialValues(fields: DialogField[]): DialogValues {
  const values: DialogValues = {}
  for (const f of fields) {
    if (f.kind === 'checkbox') values[f.id] = f.value ?? false
    else if (f.kind === 'text') values[f.id] = f.value ?? ''
    else values[f.id] = f.value ?? f.options[0]?.value ?? ''
  }
  return values
}

function visible(f: DialogField, values: DialogValues): boolean {
  return f.when ? f.when(values) : true
}

function fieldError(f: DialogField, values: DialogValues): string | null {
  if (f.kind !== 'text' || !f.validate || !visible(f, values)) return null
  return f.validate(String(values[f.id] ?? ''), values)
}

export function Dialog(props: { spec: DialogSpec; onClose: () => void }) {
  const { spec, onClose } = props
  const fields = spec.fields ?? []
  const [values, setValues] = useState<DialogValues>(() => initialValues(fields))
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(() => () => void (alive.current = false), [])

  const errors: Record<string, string> = {}
  for (const f of fields) {
    const err = fieldError(f, values)
    if (err) errors[f.id] = err
  }
  const invalid = Object.keys(errors).length > 0

  const set = (id: string, value: string | boolean) => setValues((v) => ({ ...v, [id]: value }))

  const cancel = () => {
    spec.onCancel?.()
    onClose()
  }

  const submit = async () => {
    if (busy) return
    if (invalid) {
      const all: Record<string, boolean> = {}
      for (const id of Object.keys(errors)) all[id] = true
      setTouched((t) => ({ ...t, ...all }))
      return
    }
    // Only pass values of visible fields.
    const out: DialogValues = {}
    for (const f of fields) if (visible(f, values)) out[f.id] = values[f.id]
    setBusy(true)
    setFailure(null)
    try {
      await spec.onSubmit(out)
    } catch (error) {
      if (alive.current) setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  const footer = (
    <>
      {spec.cancelLabel === null ? null : (
        <button type="button" disabled={busy} onClick={cancel}>
          {spec.cancelLabel ?? 'Cancel'}
        </button>
      )}
      <button
        type="button"
        class={spec.primary.danger ? 'primary danger' : 'primary'}
        disabled={busy || invalid}
        onClick={() => void submit()}
      >
        {busy ? 'Working…' : spec.primary.label}
      </button>
    </>
  )

  return (
    <Modal title={spec.title} onClose={cancel} footer={footer} busy={busy} onEnter={() => void submit()}>
      {spec.message ? <div class="act-message">{spec.message}</div> : null}
      {spec.preformatted !== undefined ? <pre class="act-pre">{spec.preformatted}</pre> : null}
      {fields.map((f) => {
        if (!visible(f, values)) return null
        const error = touched[f.id] ? errors[f.id] : undefined
        return (
          <div class="act-field" key={f.id}>
            {f.kind === 'checkbox' ? (
              <label class="act-check">
                <input
                  type="checkbox"
                  checked={values[f.id] === true}
                  disabled={busy}
                  onChange={(e) => set(f.id, (e.target as HTMLInputElement).checked)}
                />
                <span>{f.label}</span>
              </label>
            ) : (
              <label class="act-label" for={`act-f-${f.id}`}>
                {f.label}
              </label>
            )}
            {f.kind === 'text' && !f.multiline ? (
              <input
                id={`act-f-${f.id}`}
                type="text"
                value={String(values[f.id] ?? '')}
                placeholder={f.placeholder}
                disabled={busy}
                spellcheck={false}
                class={error ? 'invalid' : undefined}
                onInput={(e) => {
                  set(f.id, (e.target as HTMLInputElement).value)
                  setTouched((t) => ({ ...t, [f.id]: true }))
                }}
              />
            ) : null}
            {f.kind === 'text' && f.multiline ? (
              <textarea
                id={`act-f-${f.id}`}
                rows={3}
                value={String(values[f.id] ?? '')}
                placeholder={f.placeholder}
                disabled={busy}
                class={error ? 'invalid' : undefined}
                onInput={(e) => {
                  set(f.id, (e.target as HTMLTextAreaElement).value)
                  setTouched((t) => ({ ...t, [f.id]: true }))
                }}
              />
            ) : null}
            {f.kind === 'select' ? (
              <select
                id={`act-f-${f.id}`}
                value={String(values[f.id] ?? '')}
                disabled={busy}
                onChange={(e) => set(f.id, (e.target as HTMLSelectElement).value)}
              >
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : null}
            {f.kind === 'radio' ? (
              <div class="act-radios">
                {f.options.map((o) => (
                  <label class="act-check" key={o.value}>
                    <input
                      type="radio"
                      name={`act-r-${f.id}`}
                      checked={values[f.id] === o.value}
                      disabled={busy}
                      onChange={() => set(f.id, o.value)}
                    />
                    <span>{o.label}</span>
                  </label>
                ))}
              </div>
            ) : null}
            {f.hint ? <div class="act-hint">{f.hint}</div> : null}
            {error ? <div class="act-error">{error}</div> : null}
          </div>
        )
      })}
      {failure ? <div class="act-error act-failure">{failure}</div> : null}
    </Modal>
  )
}

/** Validates a name the way `git check-ref-format --branch` does for the common cases. */
export function validateRefName(name: string, what = 'Name'): string | null {
  if (name.trim() === '') return `${what} is required.`
  if (name !== name.trim()) return `${what} must not start or end with whitespace.`
  if (name === '@') return `${what} cannot be "@".`
  if (name.startsWith('-')) return `${what} cannot start with "-".`
  if (name.startsWith('/') || name.endsWith('/')) return `${what} cannot start or end with "/".`
  if (name.includes('//')) return `${what} cannot contain "//".`
  if (name.includes('..')) return `${what} cannot contain "..".`
  if (name.includes('@{')) return `${what} cannot contain "@{".`
  if (name.endsWith('.')) return `${what} cannot end with ".".`
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x20\x7f~^:?*[\\]/.test(name)) return `${what} contains a character git does not allow (space, ~ ^ : ? * [ \\).`
  for (const part of name.split('/')) {
    if (part.startsWith('.')) return `${what} components cannot start with ".".`
    if (part.endsWith('.lock')) return `${what} components cannot end with ".lock".`
  }
  return null
}
