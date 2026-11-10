import type { Commit, GitAction, GraphData, GraphSettings } from '../../../shared/protocol'
import type { MenuItem } from './ContextMenu'
import { validateRefName, type DialogField, type DialogSpec, type DialogValues } from './Dialog'

export type MenuTarget =
  | { kind: 'commit'; commit: Commit }
  | { kind: 'branch'; name: string; commit: Commit }
  | { kind: 'remoteBranch'; remote: string; name: string; commit: Commit }
  | { kind: 'tag'; name: string; commit: Commit }
  | { kind: 'stash'; commit: Commit }
  | { kind: 'uncommitted' }

/** What the menus need from the host; implemented in actions.tsx. */
export type MenuContext = {
  graph: GraphData
  settings: GraphSettings
  /** Runs the action; on success closes the dialog and refreshes, on failure shows the error. Never rejects. */
  run(action: GitAction): Promise<void>
  open(spec: DialogSpec): void
  close(): void
  copy(text: string): void
  createPullRequest(branch: string): void
  viewTag(name: string): void
  archive(ref: string, format: 'zip' | 'tar'): void
  /** Starts `git rebase -i <onto>` in an Orca terminal. */
  interactiveRebase(onto: string): Promise<void>
}

const shortHash = (hash: string) => hash.slice(0, 8)

const item = (label: string, onClick: () => void, disabled = false): MenuItem => ({ kind: 'item', label, onClick, disabled })
const sep: MenuItem = { kind: 'separator' }

function confirm(
  ctx: MenuContext,
  title: string,
  message: string,
  label: string,
  action: GitAction,
  danger = false
): DialogSpec {
  return { title, message, primary: { label, danger }, onSubmit: () => ctx.run(action) }
}

/** Remote-tracking branch name without its remote prefix. */
function localPart(remote: string, name: string): string {
  return name.startsWith(`${remote}/`) ? name.slice(remote.length + 1) : name
}

const remoteOptions = (remotes: string[]) => remotes.map((r) => ({ value: r, label: r }))

function branchItems(ctx: MenuContext, name: string): MenuItem[] {
  const { graph } = ctx
  const isCurrent = graph.headBranch === name
  const remotesWithBranch = graph.remotes.filter((r) =>
    graph.commits.some((c) => c.refs.some((ref) => ref.kind === 'remote' && ref.name === `${r}/${name}`))
  )

  return [
    item('Checkout Branch', () => void ctx.run({ kind: 'branch.checkout', name }), isCurrent),
    item('Rename Branch…', () =>
      ctx.open({
        title: 'Rename Branch',
        message: `Rename branch "${name}" to:`,
        fields: [
          { kind: 'text', id: 'name', label: 'New name', value: name, validate: (v) => (v === name ? 'Enter a different name.' : validateRefName(v, 'Branch name')) },
        ],
        primary: { label: 'Rename' },
        onSubmit: (v) => ctx.run({ kind: 'branch.rename', from: name, to: String(v.name) }),
      })
    ),
    item(
      'Delete Branch…',
      () => {
        const fields: DialogField[] = [{ kind: 'checkbox', id: 'force', label: 'Force delete (even if not fully merged)', value: ctx.settings.dialogDeleteBranchForce }]
        for (const r of remotesWithBranch) fields.push({ kind: 'checkbox', id: `remote:${r}`, label: `Also delete on remote "${r}"` })
        ctx.open({
          title: 'Delete Branch',
          message: `Delete branch "${name}"?`,
          fields,
          primary: { label: 'Delete', danger: true },
          onSubmit: (v) =>
            ctx.run({
              kind: 'branch.delete',
              name,
              force: v.force === true,
              alsoRemotes: remotesWithBranch.filter((r) => v[`remote:${r}`] === true),
            }),
        })
      },
      isCurrent
    ),
    sep,
    item(
      'Merge into Current Branch…',
      () => mergeDialog(ctx, `branch "${name}"`, name),
      isCurrent || graph.head === null
    ),
    item('Rebase Current Branch onto This…', () => rebaseDialog(ctx, `"${name}"`, name), isCurrent),
    item('Interactive Rebase Current Branch onto This…', () => interactiveRebaseDialog(ctx, `"${name}"`, name), isCurrent),
    sep,
    item('Push Branch…', () => pushDialog(ctx, name), graph.remotes.length === 0),
    item('Create Pull Request…', () => ctx.createPullRequest(name)),
    sep,
    item('Copy Branch Name', () => ctx.copy(name)),
  ]
}

function mergeDialog(ctx: MenuContext, label: string, ref: string): void {
  ctx.open({
    title: 'Merge into Current Branch',
    message: `Merge ${label} into ${ctx.graph.headBranch ? `"${ctx.graph.headBranch}"` : 'the current HEAD'}.`,
    fields: [
      {
        kind: 'radio',
        id: 'mode',
        label: 'Mode',
        value: ctx.settings.dialogMergeSquash ? 'squash' : ctx.settings.dialogMergeNoFastForward ? 'no-ff' : 'ff',
        options: [
          { value: 'ff', label: 'Fast-forward when possible' },
          { value: 'no-ff', label: 'Always create a merge commit (--no-ff)' },
          { value: 'squash', label: 'Squash (--squash)' },
        ],
      },
      { kind: 'checkbox', id: 'noCommit', label: "Don't commit (--no-commit)", when: (v) => v.mode !== 'squash' },
    ],
    primary: { label: 'Merge' },
    onSubmit: (v) =>
      ctx.run({
        kind: 'branch.merge',
        ref,
        mode: v.mode as 'ff' | 'no-ff' | 'squash',
        noCommit: v.mode === 'squash' ? false : v.noCommit === true,
      }),
  })
}

function rebaseDialog(ctx: MenuContext, label: string, onto: string): void {
  ctx.open({
    title: 'Rebase Current Branch',
    message: `Rebase ${ctx.graph.headBranch ? `"${ctx.graph.headBranch}"` : 'the current HEAD'} onto ${label}?`,
    fields: [{ kind: 'checkbox', id: 'ignoreDate', label: 'Ignore author date (--ignore-date)', value: ctx.settings.dialogRebaseIgnoreDate }],
    primary: { label: 'Rebase' },
    onSubmit: (v) => ctx.run({ kind: 'branch.rebase', onto, ignoreDate: v.ignoreDate === true }),
  })
}

function interactiveRebaseDialog(ctx: MenuContext, label: string, onto: string): void {
  ctx.open({
    title: 'Interactive Rebase',
    message: `Rebase ${ctx.graph.headBranch ? `"${ctx.graph.headBranch}"` : 'the current HEAD'} onto ${label} interactively? Git's todo list opens in a new Orca terminal, where you edit and finish the rebase.`,
    primary: { label: 'Open in Terminal' },
    onSubmit: () => ctx.interactiveRebase(onto),
  })
}

function pushDialog(ctx: MenuContext, name: string): void {
  const remotes = ctx.graph.remotes
  const preferred = remotes.includes('origin') ? 'origin' : remotes[0]
  ctx.open({
    title: 'Push Branch',
    message: `Push branch "${name}" to:`,
    fields: [
      ...remotes.map((r): DialogField => ({ kind: 'checkbox', id: `remote:${r}`, label: r, value: r === preferred })),
      { kind: 'checkbox', id: 'setUpstream', label: 'Set upstream (--set-upstream, first selected remote)', value: true },
      {
        kind: 'radio',
        id: 'force',
        label: 'Force',
        value: 'none',
        options: [
          { value: 'none', label: 'Normal push' },
          { value: 'force-with-lease', label: 'Force with lease (--force-with-lease)' },
          { value: 'force', label: 'Force (--force)' },
        ],
      },
    ],
    primary: { label: 'Push' },
    onSubmit: (v) => {
      const chosen = remotes.filter((r) => v[`remote:${r}`] === true)
      if (chosen.length === 0) throw new Error('Select at least one remote.')
      const action: GitAction = {
        kind: 'branch.push',
        name,
        remotes: chosen,
        setUpstream: v.setUpstream === true,
        force: v.force as 'none' | 'force-with-lease' | 'force',
      }
      if (action.force === 'none') return ctx.run(action)
      ctx.open(
        confirm(
          ctx,
          'Force Push',
          `Force pushing "${name}" to ${chosen.map((r) => `"${r}"`).join(', ')} can overwrite commits on the remote. Continue?`,
          'Force Push',
          action,
          true
        )
      )
    },
  })
}

function remoteBranchItems(ctx: MenuContext, remote: string, fullName: string): MenuItem[] {
  const branch = localPart(remote, fullName)
  const { graph } = ctx
  return [
    item('Checkout as New Local Branch…', () =>
      ctx.open({
        title: 'Checkout Remote Branch',
        message: `Create a local branch tracking "${fullName}" and check it out.`,
        fields: [{ kind: 'text', id: 'name', label: 'Local branch name', value: branch, validate: (v) => validateRefName(v, 'Branch name') }],
        primary: { label: 'Checkout' },
        onSubmit: (v) => ctx.run({ kind: 'branch.checkout', name: fullName, createLocal: String(v.name) }),
      })
    ),
    item('Delete Remote Branch…', () =>
      ctx.open(
        confirm(
          ctx,
          'Delete Remote Branch',
          `Delete branch "${branch}" on remote "${remote}"? This cannot be undone from here.`,
          'Delete',
          { kind: 'branch.deleteRemote', remote, name: branch },
          true
        )
      )
    ),
    sep,
    item('Fetch into Local Branch…', () =>
      ctx.open({
        title: 'Fetch into Local Branch',
        message: `Fetch "${fullName}" into a local branch.`,
        fields: [
          {
            kind: 'select',
            id: 'local',
            label: 'Local branch',
            options: graph.branches.map((b) => ({ value: b, label: b })),
            value: graph.branches.includes(branch) ? branch : graph.branches[0],
          },
          { kind: 'checkbox', id: 'force', label: 'Force (allow non-fast-forward update)' },
        ],
        primary: { label: 'Fetch' },
        onSubmit: (v) =>
          ctx.run({ kind: 'branch.fetchInto', remote, remoteBranch: branch, localBranch: String(v.local), force: v.force === true }),
      })
    ),
    item('Pull into Current Branch…', () =>
      ctx.open({
        title: 'Pull into Current Branch',
        message: `Pull "${fullName}" into ${graph.headBranch ? `"${graph.headBranch}"` : 'the current HEAD'}.`,
        fields: [
          { kind: 'checkbox', id: 'noFf', label: 'Always create a merge commit (--no-ff)', value: ctx.settings.dialogPullNoFastForward },
          { kind: 'checkbox', id: 'squash', label: 'Squash (--squash)' },
        ],
        primary: { label: 'Pull' },
        onSubmit: (v) => ctx.run({ kind: 'branch.pull', remote, name: branch, noFf: v.noFf === true, squash: v.squash === true }),
      })
    ),
    item('Merge into Current Branch…', () => mergeDialog(ctx, `branch "${fullName}"`, fullName)),
    sep,
    item('Create Pull Request…', () => ctx.createPullRequest(branch)),
    item('Copy Branch Name', () => ctx.copy(fullName)),
  ]
}

function parentOptions(commit: Commit) {
  return commit.parents.map((p, i) => ({ value: String(i + 1), label: `Parent ${i + 1} (${shortHash(p)})` }))
}

function commitItems(ctx: MenuContext, commit: Commit): MenuItem[] {
  const { hash } = commit
  const short = shortHash(hash)
  const isMerge = commit.parents.length > 1
  const isHead = ctx.graph.head === hash
  const mainlineField = (): DialogField[] =>
    isMerge ? [{ kind: 'select', id: 'mainline', label: 'Mainline parent', options: parentOptions(commit) }] : []
  const mainline = (v: DialogValues) => (isMerge ? Number(v.mainline) : undefined)

  return [
    item('Add Tag…', () =>
      ctx.open({
        title: 'Add Tag',
        message: `Add a tag to commit ${short}.`,
        fields: [
          { kind: 'text', id: 'name', label: 'Tag name', validate: (v) => validateRefName(v, 'Tag name') },
          {
            kind: 'radio',
            id: 'type',
            label: 'Type',
            value: ctx.settings.dialogAddTagType,
            options: [
              { value: 'lightweight', label: 'Lightweight' },
              { value: 'annotated', label: 'Annotated' },
            ],
          },
          {
            kind: 'text',
            id: 'message',
            label: 'Message',
            multiline: true,
            when: (v) => v.type === 'annotated',
            validate: (v) => (v.trim() === '' ? 'An annotated tag needs a message.' : null),
          },
          {
            kind: 'select',
            id: 'push',
            label: 'Push to remote',
            options: [{ value: '', label: "Don't push" }, ...remoteOptions(ctx.graph.remotes)],
          },
        ],
        primary: { label: 'Add Tag' },
        onSubmit: (v) =>
          ctx.run({
            kind: 'tag.add',
            name: String(v.name),
            at: hash,
            message: v.type === 'annotated' ? String(v.message) : undefined,
            push: v.push ? String(v.push) : undefined,
            force: false,
          }),
      })
    ),
    item('Create Branch…', () =>
      ctx.open({
        title: 'Create Branch',
        message: `Create a branch at commit ${short}.`,
        fields: [
          { kind: 'text', id: 'name', label: 'Branch name', validate: (v) => validateRefName(v, 'Branch name') },
          { kind: 'checkbox', id: 'checkout', label: 'Check out', value: ctx.settings.dialogCreateBranchCheckout },
        ],
        primary: { label: 'Create' },
        onSubmit: (v) => ctx.run({ kind: 'branch.create', name: String(v.name), at: hash, checkout: v.checkout === true }),
      })
    ),
    sep,
    item(
      'Checkout (Detached HEAD)…',
      () =>
        ctx.open(
          confirm(ctx, 'Checkout Commit', `Check out commit ${short} in detached HEAD state?`, 'Checkout', { kind: 'commit.checkout', hash })
        ),
      isHead
    ),
    item('Cherry Pick…', () =>
      ctx.open({
        title: 'Cherry Pick',
        message: `Cherry pick commit ${short} onto the current HEAD.`,
        fields: [
          ...mainlineField(),
          { kind: 'checkbox', id: 'noCommit', label: "Don't commit (--no-commit)" },
          { kind: 'checkbox', id: 'recordOrigin', label: 'Record origin in message (-x)', value: ctx.settings.dialogCherryPickRecordOrigin },
        ],
        primary: { label: 'Cherry Pick' },
        onSubmit: (v) =>
          ctx.run({ kind: 'commit.cherryPick', hash, mainline: mainline(v), noCommit: v.noCommit === true, recordOrigin: v.recordOrigin === true }),
      })
    ),
    item('Revert…', () =>
      ctx.open({
        title: 'Revert Commit',
        message: `Create a commit that reverts ${short}.`,
        fields: mainlineField(),
        primary: { label: 'Revert' },
        onSubmit: (v) => ctx.run({ kind: 'commit.revert', hash, mainline: mainline(v) }),
      })
    ),
    item('Drop Commit…', () =>
      ctx.open(
        confirm(
          ctx,
          'Drop Commit',
          `Remove commit ${short} from history by rebasing the commits after it? This rewrites history.`,
          'Drop',
          { kind: 'commit.drop', hash },
          true
        )
      )
    ),
    sep,
    item('Merge into Current Branch…', () => mergeDialog(ctx, `commit ${short}`, hash), isHead),
    item('Rebase Current Branch onto This…', () => rebaseDialog(ctx, `commit ${short}`, hash), isHead),
    item('Interactive Rebase Current Branch onto This…', () => interactiveRebaseDialog(ctx, `commit ${short}`, hash), isHead),
    item('Reset Current Branch to This…', () =>
      ctx.open({
        title: 'Reset Current Branch',
        message: `Reset the current branch to commit ${short}.`,
        fields: [
          {
            kind: 'radio',
            id: 'mode',
            label: 'Mode',
            value: ctx.settings.dialogResetCommitMode,
            options: [
              { value: 'soft', label: 'Soft: keep index and working tree' },
              { value: 'mixed', label: 'Mixed: reset index, keep working tree' },
              { value: 'hard', label: 'Hard: discard all changes' },
            ],
          },
        ],
        primary: { label: 'Reset' },
        onSubmit: (v) => {
          const action: GitAction = { kind: 'commit.reset', hash, mode: v.mode as 'soft' | 'mixed' | 'hard' }
          if (action.mode !== 'hard') return ctx.run(action)
          ctx.open(
            confirm(ctx, 'Hard Reset', `A hard reset to ${short} discards all uncommitted changes. Continue?`, 'Hard Reset', action, true)
          )
        },
      })
    ),
    sep,
    item('Copy Commit Hash', () => ctx.copy(hash)),
    item('Copy Commit Subject', () => ctx.copy(commit.subject)),
    sep,
    item('Download Archive (zip)', () => ctx.archive(hash, 'zip')),
    item('Download Archive (tar)', () => ctx.archive(hash, 'tar')),
  ]
}

function tagItems(ctx: MenuContext, name: string, annotated: boolean): MenuItem[] {
  const { remotes } = ctx.graph
  return [
    item('View Details', () => ctx.viewTag(name), !annotated),
    item('Delete Tag…', () =>
      ctx.open({
        title: 'Delete Tag',
        message: `Delete tag "${name}"?`,
        fields: [
          {
            kind: 'select',
            id: 'remote',
            label: 'Also delete on remote',
            options: [{ value: '', label: 'No' }, ...remoteOptions(remotes)],
            when: () => remotes.length > 0,
          },
        ],
        primary: { label: 'Delete', danger: true },
        onSubmit: (v) => ctx.run({ kind: 'tag.delete', name, deleteOnRemote: v.remote ? String(v.remote) : undefined }),
      })
    ),
    item(
      'Push Tag…',
      () =>
        ctx.open({
          title: 'Push Tag',
          message: `Push tag "${name}" to:`,
          fields: remotes.map((r, i): DialogField => ({ kind: 'checkbox', id: `remote:${r}`, label: r, value: i === 0 || r === 'origin' })),
          primary: { label: 'Push' },
          onSubmit: (v) => {
            const chosen = remotes.filter((r) => v[`remote:${r}`] === true)
            if (chosen.length === 0) throw new Error('Select at least one remote.')
            return ctx.run({ kind: 'tag.push', name, remotes: chosen })
          },
        }),
      remotes.length === 0
    ),
    sep,
    item('Copy Tag Name', () => ctx.copy(name)),
  ]
}

function stashItems(ctx: MenuContext, commit: Commit): MenuItem[] {
  const selector = commit.stash ?? ''
  const reinstate: DialogField = { kind: 'checkbox', id: 'reinstate', label: 'Reinstate index (--index)', value: ctx.settings.dialogStashReinstateIndex }
  return [
    item('Apply Stash…', () =>
      ctx.open({
        title: 'Apply Stash',
        message: `Apply ${selector} to the working tree.`,
        fields: [reinstate],
        primary: { label: 'Apply' },
        onSubmit: (v) => ctx.run({ kind: 'stash.apply', selector, reinstateIndex: v.reinstate === true }),
      })
    ),
    item('Pop Stash…', () =>
      ctx.open({
        title: 'Pop Stash',
        message: `Apply ${selector} and remove it from the stash list.`,
        fields: [reinstate],
        primary: { label: 'Pop' },
        onSubmit: (v) => ctx.run({ kind: 'stash.pop', selector, reinstateIndex: v.reinstate === true }),
      })
    ),
    item('Create Branch from Stash…', () =>
      ctx.open({
        title: 'Create Branch from Stash',
        message: `Create a branch from ${selector}, apply it, and drop it.`,
        fields: [{ kind: 'text', id: 'name', label: 'Branch name', validate: (v) => validateRefName(v, 'Branch name') }],
        primary: { label: 'Create' },
        onSubmit: (v) => ctx.run({ kind: 'stash.branch', selector, name: String(v.name) }),
      })
    ),
    item('Drop Stash…', () =>
      ctx.open(confirm(ctx, 'Drop Stash', `Permanently drop ${selector}?`, 'Drop', { kind: 'stash.drop', selector }, true))
    ),
    sep,
    item('Copy Stash Name', () => ctx.copy(selector)),
    item('Copy Stash Hash', () => ctx.copy(commit.hash)),
  ]
}

function uncommittedItems(ctx: MenuContext): MenuItem[] {
  return [
    item('Stash Uncommitted Changes…', () =>
      ctx.open({
        title: 'Stash Uncommitted Changes',
        fields: [
          { kind: 'text', id: 'message', label: 'Message (optional)' },
          { kind: 'checkbox', id: 'untracked', label: 'Include untracked files (--include-untracked)', value: ctx.settings.dialogStashIncludeUntracked },
        ],
        primary: { label: 'Stash' },
        onSubmit: (v) => ctx.run({ kind: 'stash.push', message: String(v.message).trim(), includeUntracked: v.untracked === true }),
      })
    ),
    sep,
    item('Reset Uncommitted Changes…', () =>
      ctx.open({
        title: 'Reset Uncommitted Changes',
        fields: [
          {
            kind: 'radio',
            id: 'mode',
            label: 'Mode',
            value: ctx.settings.dialogResetUncommittedMode,
            options: [
              { value: 'mixed', label: 'Mixed: unstage changes, keep working tree' },
              { value: 'hard', label: 'Hard: discard all tracked changes' },
            ],
          },
        ],
        primary: { label: 'Reset' },
        onSubmit: (v) => {
          const action: GitAction = { kind: 'uncommitted.reset', mode: v.mode as 'mixed' | 'hard' }
          if (action.mode === 'mixed') return ctx.run(action)
          ctx.open(
            confirm(ctx, 'Hard Reset', 'This discards all uncommitted changes to tracked files and cannot be undone. Continue?', 'Hard Reset', action, true)
          )
        },
      })
    ),
    item('Clean Untracked Files…', () =>
      ctx.open({
        title: 'Clean Untracked Files',
        message: 'Permanently delete untracked files from the working tree. This cannot be undone.',
        fields: [{ kind: 'checkbox', id: 'directories', label: 'Also delete untracked directories' }],
        primary: { label: 'Clean', danger: true },
        onSubmit: (v) => ctx.run({ kind: 'uncommitted.clean', directories: v.directories === true }),
      })
    ),
  ]
}

export function buildMenu(ctx: MenuContext, target: MenuTarget): MenuItem[] {
  switch (target.kind) {
    case 'branch':
      return branchItems(ctx, target.name)
    case 'remoteBranch':
      return remoteBranchItems(ctx, target.remote, target.name)
    case 'commit':
      return commitItems(ctx, target.commit)
    case 'tag':
      return tagItems(ctx, target.name, target.commit.refs.some((r) => r.kind === 'tag' && r.name === target.name && r.annotated === true))
    case 'stash':
      return stashItems(ctx, target.commit)
    case 'uncommitted':
      return uncommittedItems(ctx)
  }
}
