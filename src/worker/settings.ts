import type { OrcaWorkerApi } from 'orca/worker'
import type { GraphSettings } from '../shared/protocol'

/** Mirrors the defaults declared in orca-plugin.json `contributes.settings`. */
export const DEFAULT_SETTINGS: GraphSettings = {
  graphStyle: 'rounded',
  colours: '#4e9af1,#e5534b,#57ab5a,#c69026,#a371f7,#39c5cf,#e0823d,#d56cb5,#8ab43f,#7d8bf0',
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

/** The plugin's settings, each falling back to its default when missing or of the wrong type. */
export async function readSettings(orca: OrcaWorkerApi): Promise<GraphSettings> {
  let raw: Record<string, unknown> = {}
  try {
    raw = await orca.settings.get()
  } catch {
    // settings:own not granted: use defaults
  }
  const result: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof GraphSettings)[]) {
    const value = raw[key]
    if (typeof value !== typeof DEFAULT_SETTINGS[key]) continue
    const allowed = ENUMS[key]
    if (allowed !== undefined && !allowed.includes(value as string)) continue
    result[key] = value
  }
  return result as GraphSettings
}
