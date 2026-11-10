import type { GraphSettings } from '../shared/protocol'

function locale(): string | undefined {
  try {
    Intl.DateTimeFormat.supportedLocalesOf(orca.locale)
    return orca.locale
  } catch {
    return undefined
  }
}

const formatters = new Map<string, Intl.DateTimeFormat | Intl.RelativeTimeFormat>()

function dateTimeFormat(kind: 'date-time' | 'date'): Intl.DateTimeFormat {
  let f = formatters.get(kind) as Intl.DateTimeFormat | undefined
  if (!f) {
    f = new Intl.DateTimeFormat(locale(), kind === 'date' ? { dateStyle: 'medium' } : { dateStyle: 'medium', timeStyle: 'short' })
    formatters.set(kind, f)
  }
  return f
}

function relativeFormat(): Intl.RelativeTimeFormat {
  let f = formatters.get('relative') as Intl.RelativeTimeFormat | undefined
  if (!f) {
    f = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' })
    formatters.set('relative', f)
  }
  return f
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60]
]

export function formatDate(seconds: number, format: GraphSettings['dateFormat'], now = Date.now()): string {
  if (format !== 'relative') return dateTimeFormat(format).format(new Date(seconds * 1000))
  const diff = Math.round(now / 1000 - seconds)
  for (const [unit, size] of UNITS) {
    if (Math.abs(diff) >= size) return relativeFormat().format(-Math.round(diff / size), unit)
  }
  return relativeFormat().format(-diff, 'second')
}

export function formatFullDate(seconds: number): string {
  return new Intl.DateTimeFormat(locale(), { dateStyle: 'full', timeStyle: 'long' }).format(new Date(seconds * 1000))
}
