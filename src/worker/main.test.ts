import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import * as main from './main'

function makeRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'git-graph-test-'))
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: dir,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Ann',
        GIT_AUTHOR_EMAIL: 'ann@example.com',
        GIT_COMMITTER_NAME: 'Ann',
        GIT_COMMITTER_EMAIL: 'ann@example.com'
      }
    })
  git('init', '--quiet', '--initial-branch=main')
  git('commit', '--quiet', '--allow-empty', '-m', 'root')
  git('switch', '--quiet', '-c', 'feature')
  git('commit', '--quiet', '--allow-empty', '-m', 'feature: one, two')
  git('switch', '--quiet', 'main')
  git('commit', '--quiet', '--allow-empty', '-m', 'main work')
  git('merge', '--quiet', '--no-ff', '-m', 'merge feature', 'feature')
  git('tag', 'v1')
  return dir
}

function hostFor(repo: string | null) {
  return mockHost({
    results: {
      'workspace.readContext': { branch: 'refs/heads/main', displayName: 'demo', terminals: [] },
      'workspace.list': {
        workspaces:
          repo === null
            ? []
            : [
                { id: 'other', kind: 'folder', name: 'other', path: '/nope', branch: null, hostId: null },
                { id: 'wt-1', kind: 'worktree', name: 'demo', path: repo, branch: 'main', hostId: null }
              ],
        truncated: false
      }
    }
  })
}

test('reads every branch of the focused workspace, merges and refs included', async () => {
  const repo = makeRepo()
  try {
    const worker = await mountWorker(main, { host: hostFor(repo) })
    const result = await worker.request('graph.load', {})
    assert.equal(result.status, 'ok')
    if (result.status !== 'ok') return
    assert.equal(result.workspace.id, 'wt-1')
    assert.deepEqual(
      result.commits.map((commit) => commit.subject),
      ['merge feature', 'main work', 'feature: one, two', 'root']
    )
    const [merge, , feature, root] = result.commits
    assert.equal(merge.parents.length, 2)
    assert.deepEqual(merge.refs, ['HEAD -> main', 'tag: v1'])
    assert.deepEqual(feature.refs, ['feature'])
    assert.deepEqual(root.parents, [])
    assert.equal(result.truncated, false)
    assert.deepEqual(worker.refusals, [])
    await worker.deactivate()
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('marks the history truncated past the limit', async () => {
  const repo = makeRepo()
  try {
    const worker = await mountWorker(main, { host: hostFor(repo) })
    const result = await worker.request('graph.load', { limit: 2 })
    assert.equal(result.status, 'ok')
    if (result.status !== 'ok') return
    assert.equal(result.commits.length, 2)
    assert.equal(result.truncated, true)
    await worker.deactivate()
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('reports a focused workspace that workspace.list does not have', async () => {
  const worker = await mountWorker(main, { host: hostFor(null) })
  assert.deepEqual(await worker.request('graph.load', {}), {
    status: 'not-found',
    displayName: 'demo',
    branch: 'refs/heads/main'
  })
  await worker.deactivate()
})
