// Plugin settings as the panel sees them: `orca.settings` returns declared settings with their
// defaults, so these fallbacks only matter when a value has the wrong type.
import type { GraphSettings } from '../shared/protocol'

export const DEFAULT_PALETTE = ['#4e9af1', '#e5534b', '#57ab5a', '#c69026', '#a371f7', '#39c5cf', '#e0823d', '#d56cb5', '#8ab43f', '#7d8bf0']

export const DEFAULT_SETTINGS: GraphSettings = {
  graphStyle: 'rounded',
  colours: DEFAULT_PALETTE.join(','),
  firstParentOnly: false,
  initialLoadCommits: 300,
  loadMoreCommits: 100,
  dateFormat: 'date-time',
  dateType: 'author',
  showRemoteBranches: true,
  showTags: true,
  showStashes: true,
  showUncommittedChanges: true,
  showUntrackedFiles: true,
  muteMergeCommits: true,
  useMailmap: false,
  showSignatureStatus: false,
  fetchAvatars: false,
  refLabelAlignment: 'normal',
  customBranchGlobPatterns: '',
  customEmojiShortcodes: ''
}

const ENUMS: Partial<Record<keyof GraphSettings, readonly string[]>> = {
  graphStyle: ['rounded', 'angular'],
  dateFormat: ['date-time', 'date', 'relative'],
  dateType: ['author', 'commit'],
  refLabelAlignment: ['normal', 'branches-left', 'branches-right']
}

export async function readSettings(): Promise<GraphSettings> {
  let raw: Record<string, unknown> = {}
  try {
    raw = await orca.settings.get()
  } catch {
    // settings:own missing: defaults
  }
  const result: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof GraphSettings)[]) {
    const value = raw[key]
    if (typeof value !== typeof DEFAULT_SETTINGS[key]) continue
    const allowed = ENUMS[key]
    if (allowed !== undefined && !allowed.includes(value as string)) continue
    if (typeof value === 'number' && !(value > 0)) continue
    result[key] = value
  }
  return result as GraphSettings
}

/** Colour palette from the comma-separated `colours` setting. */
export function parsePalette(colours: string): string[] {
  const list = colours.split(',').map((c) => c.trim()).filter((c) => c !== '')
  return list.length > 0 ? list : DEFAULT_PALETTE
}

export function parseLines(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter((l) => l !== '')
}
