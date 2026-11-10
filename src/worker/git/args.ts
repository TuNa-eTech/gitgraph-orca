/** Argument validation shared by the git wrappers. Every value goes to git as an argv entry. */

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/

/** A revision, branch, tag or remote name used as a positional argument: never an option. */
export function safeRef(value: string, what = 'name'): string {
  if (typeof value !== 'string' || value === '' || value.startsWith('-') || CONTROL.test(value) || /\s/.test(value)) {
    throw new Error(`Invalid ${what}: ${JSON.stringify(value)}`)
  }
  return value
}

/** A free-form positional value (URL, path): non-empty, not an option, no control characters. */
export function safeValue(value: string, what: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.startsWith('-') || CONTROL.test(value)) {
    throw new Error(`Invalid ${what}`)
  }
  return value
}

export function safeHash(value: string): string {
  if (!/^[0-9a-fA-F]{4,64}$/.test(value)) throw new Error(`Invalid commit hash: ${JSON.stringify(value)}`)
  return value
}

export function safeStash(value: string): string {
  if (!/^stash@\{\d+\}$/.test(value)) throw new Error(`Invalid stash: ${JSON.stringify(value)}`)
  return value
}

/** Repository-relative file path: forward slashes, no `..`, not absolute. */
export function safePath(value: string): string {
  const normalised = value.replace(/\\/g, '/')
  if (
    normalised === '' ||
    normalised.startsWith('/') ||
    /^[a-zA-Z]:/.test(normalised) ||
    normalised.split('/').some((part) => part === '..') ||
    normalised.includes('\0')
  ) {
    throw new Error(`Invalid path: ${JSON.stringify(value)}`)
  }
  return normalised
}
