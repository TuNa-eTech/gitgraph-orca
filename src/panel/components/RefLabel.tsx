import type { Commit, Ref } from '../../shared/protocol'

export type RefLabelProps = {
  commit: Commit
  gitRef: Ref
  /** Name of the checked-out branch; its label is highlighted. */
  headBranch: string | null
  /** Remote names whose same-named branch points at this commit, folded into this local label. */
  alsoRemotes?: string[]
  onContextMenu(e: MouseEvent, ref: Ref, commit: Commit): void
}

export function RefLabel({ commit, gitRef, headBranch, alsoRemotes, onContextMenu }: RefLabelProps) {
  const isHead = gitRef.kind === 'head' && gitRef.name === headBranch
  const label = gitRef.kind === 'stash' ? (gitRef.name || commit.stash || 'stash') : gitRef.name
  const cls = `gg-ref gg-ref-${gitRef.kind}${isHead ? ' gg-ref-current' : ''}${gitRef.annotated ? ' gg-ref-annotated' : ''}`
  const title =
    gitRef.kind === 'head'
      ? `Branch ${gitRef.name}${isHead ? ' (checked out)' : ''}${alsoRemotes?.length ? `\n${alsoRemotes.map((r) => `Remote branch ${r}/${gitRef.name}`).join('\n')}` : ''}`
      : gitRef.kind === 'remote'
        ? `Remote branch ${gitRef.name}`
        : gitRef.kind === 'tag'
          ? `${gitRef.annotated ? 'Annotated tag' : 'Tag'} ${gitRef.name}`
          : `Stash ${label}`
  return (
    <span class={cls} data-tip={title} onContextMenu={(e) => onContextMenu(e as MouseEvent, gitRef, commit)}>
      {label}
      {alsoRemotes?.length ? <span class="gg-ref-remote-suffix">{alsoRemotes.join(', ')}</span> : null}
    </span>
  )
}

/** Refs to show for a commit: stash rows always get a stash label. */
export function refsOf(commit: Commit): Ref[] {
  if (commit.stash !== undefined && !commit.refs.some((r) => r.kind === 'stash')) {
    return [...commit.refs, { kind: 'stash', name: commit.stash }]
  }
  return commit.refs
}

/**
 * Folds each remote branch into the local branch of the same name on the same commit
 * (`origin/main` into `main`). Returns the refs still to draw and, per local label, its remotes.
 */
export function combineRefs(refs: Ref[]): { refs: Ref[]; remotesOf: Map<Ref, string[]> } {
  const remotesOf = new Map<Ref, string[]>()
  const folded = new Set<Ref>()
  for (const local of refs) {
    if (local.kind !== 'head') continue
    for (const r of refs) {
      if (r.kind !== 'remote') continue
      const remote = r.remote ?? r.name.split('/')[0]
      if (r.name !== `${remote}/${local.name}`) continue
      folded.add(r)
      remotesOf.set(local, [...(remotesOf.get(local) ?? []), remote])
    }
  }
  return { refs: refs.filter((r) => !folded.has(r)), remotesOf }
}
