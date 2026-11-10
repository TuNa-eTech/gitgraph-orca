// Plugin settings as the panel sees them: `orca.settings` returns declared settings with their
// defaults, so the shared fallbacks only matter when a value has the wrong type.
import type { GraphSettings } from '../shared/protocol'
import { DEFAULT_PALETTE, sanitiseSettings } from '../shared/settings'

export async function readSettings(): Promise<GraphSettings> {
  let raw: Record<string, unknown> = {}
  try {
    raw = await orca.settings.get()
  } catch {
    // settings:own missing: defaults
  }
  return sanitiseSettings(raw)
}

/** Colour palette from the comma-separated `colours` setting. */
export function parsePalette(colours: string): string[] {
  const list = colours.split(',').map((c) => c.trim()).filter((c) => c !== '')
  return list.length > 0 ? list : DEFAULT_PALETTE
}

export function parseLines(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter((l) => l !== '')
}
