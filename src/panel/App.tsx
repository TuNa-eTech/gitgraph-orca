import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import type { Commit, GraphLoadResult } from '../shared/protocol'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'loaded'; result: GraphLoadResult }
  | { kind: 'failed'; message: string }

export function App() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const requestId = useRef(0)

  const load = useCallback(async () => {
    // A newer load (refresh, workspace switch) wins over one still in flight.
    const id = ++requestId.current
    setState({ kind: 'loading' })
    try {
      const result = await orca.plugin.request('graph.load', {})
      if (id === requestId.current) setState({ kind: 'loaded', result })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (id === requestId.current) setState({ kind: 'failed', message })
    }
  }, [])

  useEffect(() => {
    // Fires once on subscribe with the current workspace, then on every focus change.
    const subscription = orca.on('workspace.changed', () => void load())
    return () => subscription.dispose()
  }, [load])

  return (
    <>
      <div class="toolbar">
        <span class="title">{toolbarTitle(state)}</span>
        <button type="button" disabled={state.kind === 'loading'} onClick={() => void load()}>
          Refresh
        </button>
      </div>
      <Body state={state} />
    </>
  )
}

function toolbarTitle(state: LoadState): string {
  if (state.kind !== 'loaded') return 'Git Graph'
  const { result } = state
  if (result.status === 'ok' || result.status === 'git-error') return result.workspace.name
  return 'Git Graph'
}

function Body({ state }: { state: LoadState }) {
  if (state.kind === 'loading') return <p class="message">Loading…</p>
  if (state.kind === 'failed') return <p class="message error">{state.message}</p>

  const { result } = state
  switch (result.status) {
    case 'no-workspace':
      return <p class="message">Focus a workspace to see its history.</p>
    case 'not-found':
      return (
        <p class="message">
          No repository found for workspace “{result.displayName}” ({result.branch}).
        </p>
      )
    case 'git-error':
      return <p class="message error">{result.message}</p>
    case 'ok':
      return <CommitList commits={result.commits} truncated={result.truncated} />
  }
}

function CommitList({ commits, truncated }: { commits: Commit[]; truncated: boolean }) {
  if (commits.length === 0) return <p class="message">No commits yet.</p>
  return (
    <>
      <ul class="commits">
        {commits.map((commit) => (
          <li class="commit" key={commit.hash} title={commit.hash}>
            <span class="hash">{commit.hash.slice(0, 7)}</span>
            {commit.refs.map((ref) => (
              <span class="ref" key={ref}>
                {ref}
              </span>
            ))}
            <span class="subject">{commit.subject}</span>
            <span class="author">{commit.author}</span>
          </li>
        ))}
      </ul>
      {truncated && <p class="message">Showing the newest {commits.length} commits.</p>}
    </>
  )
}
