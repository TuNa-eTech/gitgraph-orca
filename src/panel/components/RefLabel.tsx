import type { Commit, Ref } from '../../shared/protocol'

export type RefLabelProps = {
  commit: Commit
  gitRef: Ref
  /** Name of the checked-out branch; its label is highlighted. */
  headBranch: string | null
  onContextMenu(e: MouseEvent, ref: Ref, commit: Commit): void
}

export function RefLabel({ commit, gitRef, headBranch, onContextMenu }: RefLabelProps) {
  const isHead = gitRef.kind === 'head' && gitRef.name === headBranch
  const label = gitRef.kind === 'stash' ? (gitRef.name || commit.stash || 'stash') : gitRef.name
  const cls = `gg-ref gg-ref-${gitRef.kind}${isHead ? ' gg-ref-current' : ''}${gitRef.annotated ? ' gg-ref-annotated' : ''}`
  const title =
    gitRef.kind === 'head'
      ? `Branch ${gitRef.name}${isHead ? ' (checked out)' : ''}`
      : gitRef.kind === 'remote'
        ? `Remote branch ${gitRef.name}`
        : gitRef.kind === 'tag'
          ? `${gitRef.annotated ? 'Annotated tag' : 'Tag'} ${gitRef.name}`
          : `Stash ${label}`
  return (
    <span class={cls} title={title} onContextMenu={(e) => onContextMenu(e as MouseEvent, gitRef, commit)}>
      {label}
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
