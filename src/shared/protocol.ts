// The panel <-> worker contract, declared once. src/panel and src/worker both include this file,
// so `plugin.request` in the panel and `orca.panels.handle` in the worker type-check against it.

// ---------- Repository and graph data ----------

export type GraphWorkspace = {
  id: string
  name: string
  /** Repository root (`git rev-parse --show-toplevel`). */
  path: string
  branch: string | null
}

export type RefKind = 'head' | 'remote' | 'tag' | 'stash'

export type Ref = {
  kind: RefKind
  /** Short name: `main`, `origin/main`, `v1.0`, `stash@{0}`. */
  name: string
  /** For `remote`: the remote name (`origin`). */
  remote?: string
  /** For `tag`: true when annotated. */
  annotated?: boolean
}

export type SignatureStatus = 'G' | 'B' | 'U' | 'X' | 'Y' | 'R' | 'E' | 'N'

export type Commit = {
  hash: string
  parents: string[]
  author: string
  email: string
  /** Author or committer time (per `dateType` setting), seconds since the epoch. */
  time: number
  refs: Ref[]
  subject: string
  /** Present only when the `showSignatureStatus` setting is on. */
  signature?: SignatureStatus
  /** For stash rows: the stash selector (`stash@{0}`). */
  stash?: string
}

/** Pseudo-hash of the uncommitted-changes row. */
export const UNCOMMITTED = '*'

export type GraphData = {
  workspace: GraphWorkspace
  /** Newest first. Includes stash commits and, first, an UNCOMMITTED row when there are changes. */
  commits: Commit[]
  /** Hash HEAD points at; null on an unborn branch. */
  head: string | null
  /** Current branch, null when detached. */
  headBranch: string | null
  /** All local branches, for the branch filter. */
  branches: string[]
  /** Remote-tracking branches as `remote/name` (no `remote/HEAD`, none of hidden remotes). */
  remoteBranches: string[]
  remotes: string[]
  /** More commits exist past `commits`. */
  hasMore: boolean
  /** Submodule paths relative to the root; the panel may switch to one with `repoPath`. */
  submodules: string[]
}

export type GraphLoadInput = {
  /** Number of commits to read (excluding the uncommitted row). */
  limit?: number
  /** Branch names or glob patterns; empty or absent = all. */
  branches?: string[]
  /** Override the repository: a submodule path relative to the workspace root. */
  repoPath?: string
}

export type GraphLoadResult =
  | ({ status: 'ok' } & GraphData)
  | { status: 'no-workspace' }
  | { status: 'not-found'; displayName: string; branch: string }
  | { status: 'git-error'; workspace: GraphWorkspace; message: string }

export const DEFAULT_COMMIT_LIMIT = 300
export const MAX_COMMIT_LIMIT = 5000

// ---------- Commit details, comparison, diffs ----------

export type FileStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'U'

export type FileChange = {
  status: FileStatus
  path: string
  /** For renames and copies. */
  oldPath?: string
  /** null for binary files. */
  additions: number | null
  deletions: number | null
}

export type CommitDetails = {
  hash: string
  parents: string[]
  author: string
  authorEmail: string
  authorTime: number
  committer: string
  committerEmail: string
  committerTime: number
  /** Full message body after the subject line. */
  body: string
  subject: string
  signature?: { status: SignatureStatus; signer: string; key: string }
  files: FileChange[]
}

/** `from`/`to`: commit hashes or UNCOMMITTED. */
export type CompareInput = { from: string; to: string; repoPath?: string }

export type DiffInput = {
  /** Base revision; null for "parent of `to`" (or empty tree for a root commit). */
  from: string | null
  /** Revision or UNCOMMITTED (working tree). */
  to: string
  path: string
  oldPath?: string
  repoPath?: string
}

export type DiffResult =
  | { status: 'ok'; binary: false; patch: string }
  | { status: 'ok'; binary: true }
  | { status: 'too-large'; bytes: number }

export type FileAtRevisionResult =
  | { status: 'ok'; content: string }
  | { status: 'binary' }
  | { status: 'too-large'; bytes: number }
  | { status: 'missing' }

export type TagDetails = {
  name: string
  hash: string
  tagger: string
  email: string
  time: number
  message: string
}

// ---------- Actions ----------

/** Every action resolves to this; `output` is git's combined stdout/stderr when useful. */
export type ActionResult =
  | { status: 'ok'; output?: string }
  | { status: 'error'; message: string }
  /** Credentials needed; the panel offers `action.runInTerminal` with `command`. */
  | { status: 'auth-required'; message: string; command: string[] }

export type MergeMode = 'ff' | 'no-ff' | 'squash'
export type ResetMode = 'soft' | 'mixed' | 'hard'

export type GitAction =
  // Branches
  | { kind: 'branch.create'; name: string; at: string; checkout: boolean }
  | { kind: 'branch.checkout'; name: string; /** For a remote branch: local name to create. */ createLocal?: string }
  | { kind: 'branch.rename'; from: string; to: string }
  | { kind: 'branch.delete'; name: string; force: boolean; alsoRemotes?: string[] }
  | { kind: 'branch.deleteRemote'; remote: string; name: string }
  | { kind: 'branch.merge'; ref: string; mode: MergeMode; noCommit: boolean }
  | { kind: 'branch.rebase'; onto: string; ignoreDate: boolean }
  /** `setUpstream` sets the first remote of `remotes` as the upstream. */
  | { kind: 'branch.push'; name: string; remotes: string[]; setUpstream: boolean; force: 'none' | 'force-with-lease' | 'force' }
  /** With `squash`, the squashed changes are committed as "Merge branch '<remote>/<name>'". */
  | { kind: 'branch.pull'; remote: string; name: string; noFf: boolean; squash: boolean }
  | { kind: 'branch.fetchInto'; remote: string; remoteBranch: string; localBranch: string; force: boolean }
  // Commits
  | { kind: 'commit.checkout'; hash: string }
  | { kind: 'commit.cherryPick'; hash: string; mainline?: number; noCommit: boolean; recordOrigin: boolean }
  | { kind: 'commit.revert'; hash: string; mainline?: number }
  | { kind: 'commit.drop'; hash: string }
  | { kind: 'commit.reset'; hash: string; mode: ResetMode }
  // Tags
  | { kind: 'tag.add'; name: string; at: string; message?: string; push?: string; force: boolean }
  | { kind: 'tag.delete'; name: string; deleteOnRemote?: string }
  | { kind: 'tag.push'; name: string; remotes: string[] }
  // Stashes
  | { kind: 'stash.push'; message: string; includeUntracked: boolean }
  | { kind: 'stash.apply'; selector: string; reinstateIndex: boolean }
  | { kind: 'stash.pop'; selector: string; reinstateIndex: boolean }
  | { kind: 'stash.drop'; selector: string }
  | { kind: 'stash.branch'; selector: string; name: string }
  // Uncommitted
  | { kind: 'uncommitted.reset'; mode: 'mixed' | 'hard' }
  | { kind: 'uncommitted.clean'; directories: boolean }
  // Remotes
  | { kind: 'remote.fetch'; remote: string | null; prune: boolean; pruneTags: boolean }
  | { kind: 'remote.add'; name: string; url: string; pushUrl?: string; fetch: boolean }
  | { kind: 'remote.edit'; oldName: string; name: string; url: string; pushUrl?: string }
  | { kind: 'remote.delete'; name: string }
  | { kind: 'remote.prune'; name: string }
  // Config
  | { kind: 'user.set'; scope: 'local' | 'global'; name: string; email: string }
  | { kind: 'user.unset'; scope: 'local' | 'global' }

export type ActionInput = { action: GitAction; repoPath?: string }

// ---------- Repository settings ----------

export type RemoteInfo = { name: string; url: string | null; pushUrl: string | null }

export type IssueLinking = { issue: string; url: string }

export type PullRequestProvider = 'github' | 'gitlab' | 'bitbucket' | 'custom'

export type PullRequestConfig = {
  provider: PullRequestProvider
  /** For `custom`: URL template with $1..$8 like vscode-git-graph's custom providers. */
  customTemplate?: string
  hostRootUrl: string
  sourceOwner: string
  sourceRepo: string
  sourceRemote: string
  destOwner: string
  destRepo: string
  destBranch: string
  destRemote: string | null
}

/** Per-repository plugin config, stored in plugin storage and exportable to `.orca/git-graph.json`. */
export type RepoConfig = {
  issueLinking: IssueLinking | null
  pullRequest: PullRequestConfig | null
  /** Hidden remotes in the graph. */
  hideRemotes: string[]
}

export type RepoSettings = {
  remotes: RemoteInfo[]
  user: {
    local: { name: string | null; email: string | null }
    global: { name: string | null; email: string | null }
  }
  config: RepoConfig
}

// ---------- Panel view state and code review (stored by the worker) ----------

export type ViewState = {
  columnWidths: Record<string, number>
  hiddenColumns: string[]
  branchFilter: string[]
  scrollTop?: number
}

export type CodeReview = {
  id: string
  /** `hash` or `from..to`. */
  key: string
  remaining: string[]
  lastActive: number
}

/** Plugin settings declared in orca-plugin.json `contributes.settings`. */
export type GraphSettings = {
  graphStyle: 'rounded' | 'angular'
  colours: string
  firstParentOnly: boolean
  commitOrder: 'date' | 'author-date' | 'topo'
  initialLoadCommits: number
  loadMoreCommits: number
  loadMoreAutomatically: boolean
  scrollToHeadOnLoad: boolean
  dateFormat: 'date-time' | 'date' | 'iso-date-time' | 'iso-date' | 'relative'
  dateType: 'author' | 'commit'
  showRemoteBranches: boolean
  showTags: boolean
  showStashes: boolean
  showUncommittedChanges: boolean
  showUntrackedFiles: boolean
  /** Refresh when files in the working tree change (not only `.git`). */
  watchWorkingTree: boolean
  muteMergeCommits: boolean
  useMailmap: boolean
  showSignatureStatus: boolean
  fetchAvatars: boolean
  refLabelAlignment: 'normal' | 'branches-left' | 'branches-right'
  /** One label for `main` and `origin/main` when both point at the same commit. */
  combineLocalAndRemoteLabels: boolean
  /** `auto`: right of the graph on wide panels, below it on narrow ones. */
  detailsLocation: 'auto' | 'bottom' | 'right'
  fetchPrune: boolean
  fetchPruneTags: boolean
  customBranchGlobPatterns: string
  customEmojiShortcodes: string
  // Defaults of action dialogs
  dialogCreateBranchCheckout: boolean
  dialogAddTagType: 'annotated' | 'lightweight'
  dialogMergeNoFastForward: boolean
  dialogMergeSquash: boolean
  dialogPullNoFastForward: boolean
  dialogRebaseIgnoreDate: boolean
  dialogDeleteBranchForce: boolean
  dialogCherryPickRecordOrigin: boolean
  dialogStashIncludeUntracked: boolean
  /** Apply and Pop stash: reinstate the index. */
  dialogStashReinstateIndex: boolean
  dialogResetCommitMode: ResetMode
  dialogResetUncommittedMode: 'mixed' | 'hard'
}

type Repo = { repoPath?: string }

declare module 'orca' {
  interface PluginRequests {
    'graph.load': { input: GraphLoadInput | undefined; output: GraphLoadResult }
    'commit.details': { input: { hash: string } & Repo; output: CommitDetails }
    'commit.uncommitted': { input: Repo | undefined; output: { files: FileChange[] } }
    'commit.compare': { input: CompareInput; output: { files: FileChange[] } }
    'file.diff': { input: DiffInput; output: DiffResult }
    'file.atRevision': { input: { rev: string; path: string } & Repo; output: FileAtRevisionResult }
    /** Opens the working-tree file in an Orca editor tab. */
    'file.open': { input: { path: string } & Repo; output: { opened: boolean } }
    'tag.details': { input: { name: string } & Repo; output: TagDetails }
    /** Branches/tags containing a commit, for the hover tooltip. */
    'commit.containedIn': { input: { hash: string } & Repo; output: { inHead: boolean; branches: string[]; tags: string[] } }
    'action.run': { input: ActionInput; output: ActionResult }
    /** Runs a git command that needed credentials in a new Orca terminal. */
    'action.runInTerminal': { input: { command: string[] } & Repo; output: { terminalId: string } }
    /** Starts `git rebase -i <onto>` in a new Orca terminal (git's editor runs there). */
    'rebase.interactive': { input: { onto: string } & Repo; output: { terminalId: string } }
    /** `git archive` bytes as base64, for `files.saveAs`. */
    'commit.archive': { input: { ref: string; format: 'zip' | 'tar' } & Repo; output: { base64: string; name: string } }
    'repo.settings': { input: Repo | undefined; output: RepoSettings }
    'repo.saveConfig': { input: { config: RepoConfig } & Repo; output: { ok: true } }
    'repo.exportConfig': { input: Repo | undefined; output: { path: string } }
    'view.load': { input: Repo | undefined; output: ViewState | null }
    'view.save': { input: { state: ViewState } & Repo; output: { ok: true } }
    'review.get': { input: { key: string } & Repo; output: CodeReview | null }
    'review.start': { input: { key: string; files: string[] } & Repo; output: CodeReview }
    'review.update': { input: { id: string; reviewed: string } & Repo; output: CodeReview | null }
    'review.end': { input: { id: string } & Repo; output: { ok: true } }
    /** Avatar image as a data URI, or null when unavailable or `fetchAvatars` is off. */
    'avatar.get': { input: { email: string; hash: string } & Repo; output: { dataUri: string | null } }
  }
  interface PluginPanelEvents {
    /** The repository changed on disk (HEAD, refs, index); the panel reloads. */
    'graph.changed': { path: string }
  }
}
