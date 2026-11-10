// Plugin settings, declared once for the panel and the worker. Mirrors `contributes.settings` in
// orca-plugin.json: every key there has its default here, and its enum (if any) in ENUMS.
import type { GraphSettings } from './protocol'

export const DEFAULT_PALETTE = ['#4e9af1', '#e5534b', '#57ab5a', '#c69026', '#a371f7', '#39c5cf', '#e0823d', '#d56cb5', '#8ab43f', '#7d8bf0']

export const DEFAULT_SETTINGS: GraphSettings = {
  graphStyle: 'rounded',
  colours: DEFAULT_PALETTE.join(','),
  firstParentOnly: false,
  commitOrder: 'date',
  initialLoadCommits: 300,
  loadMoreCommits: 100,
  loadMoreAutomatically: true,
  scrollToHeadOnLoad: false,
  dateFormat: 'date-time',
  dateType: 'author',
  showRemoteBranches: true,
  showTags: true,
  showStashes: true,
  showUncommittedChanges: true,
  showUntrackedFiles: true,
  watchWorkingTree: true,
  muteMergeCommits: true,
  useMailmap: false,
  showSignatureStatus: false,
  fetchAvatars: false,
  refLabelAlignment: 'normal',
  combineLocalAndRemoteLabels: true,
  detailsLocation: 'auto',
  fetchPrune: false,
  fetchPruneTags: false,
  customBranchGlobPatterns: '',
  customEmojiShortcodes: '',
  dialogCreateBranchCheckout: false,
  dialogAddTagType: 'annotated',
  dialogMergeNoFastForward: true,
  dialogMergeSquash: false,
  dialogPullNoFastForward: false,
  dialogRebaseIgnoreDate: true,
  dialogDeleteBranchForce: false,
  dialogCherryPickRecordOrigin: false,
  dialogStashIncludeUntracked: true,
  dialogStashReinstateIndex: false,
  dialogResetCommitMode: 'mixed',
  dialogResetUncommittedMode: 'mixed'
}

export const SETTING_ENUMS: Partial<Record<keyof GraphSettings, readonly string[]>> = {
  graphStyle: ['rounded', 'angular'],
  commitOrder: ['date', 'author-date', 'topo'],
  dateFormat: ['date-time', 'date', 'iso-date-time', 'iso-date', 'relative'],
  dateType: ['author', 'commit'],
  refLabelAlignment: ['normal', 'branches-left', 'branches-right'],
  detailsLocation: ['auto', 'bottom', 'right'],
  dialogAddTagType: ['annotated', 'lightweight'],
  dialogResetCommitMode: ['soft', 'mixed', 'hard'],
  dialogResetUncommittedMode: ['mixed', 'hard']
}

/** Settings as read from Orca, each falling back to its default when missing or invalid. */
export function sanitiseSettings(raw: Record<string, unknown>): GraphSettings {
  const result: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof GraphSettings)[]) {
    const value = raw[key]
    if (typeof value !== typeof DEFAULT_SETTINGS[key]) continue
    const allowed = SETTING_ENUMS[key]
    if (allowed !== undefined && !allowed.includes(value as string)) continue
    if (typeof value === 'number' && !(value > 0)) continue
    result[key] = value
  }
  return result as GraphSettings
}
