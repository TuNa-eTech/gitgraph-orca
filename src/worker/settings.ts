import type { OrcaWorkerApi } from 'orca/worker'
import type { GraphSettings } from '../shared/protocol'
import { sanitiseSettings } from '../shared/settings'

/** The plugin's settings, each falling back to its default when missing or invalid. */
export async function readSettings(orca: OrcaWorkerApi): Promise<GraphSettings> {
  let raw: Record<string, unknown> = {}
  try {
    raw = await orca.settings.get()
  } catch {
    // settings:own not granted: use defaults
  }
  return sanitiseSettings(raw)
}
