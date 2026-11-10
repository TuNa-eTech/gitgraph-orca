import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { UNCOMMITTED } from '../shared/protocol'
import { DEFAULT_SETTINGS } from '../shared/settings'
import { isAuthFailure, terminalCommandLine } from './git/actions'
import { parseNameStatus, parseNumstat } from './git/details'
import { normaliseRelative } from './repo'
import * as main from './main'

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Ann',
  GIT_AUTHOR_EMAIL: 'ann@example.com',
  GIT_COMMITTER_NAME: 'Ann',
  GIT_COMMITTER_EMAIL: 'ann@example.com'
}

function gitIn(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, env: ENV, encoding: 'utf8' })
}

function makeRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'git-graph-test-'))
  const git = (...args: string[]) => gitIn(dir, ...args)
  git('init', '--quiet', '--initial-branch=main')
  git('config', 'commit.gpgsign', 'false')
  git('config', 'tag.gpgsign', 'false')
  writeFileSync(path.join(dir, 'a.txt'), 'one\n')
  git('add', '.')
  git('commit', '--quiet', '-m', 'root')
  git('switch', '--quiet', '-c', 'feature')
  writeFileSync(path.join(dir, 'b.txt'), 'b1\nb2\n')
  git('add', '.')
  git('commit', '--quiet', '-m', 'feature: one, two')
  git('switch', '--quiet', 'main')
  writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\n')
  git('commit', '--quiet', '-am', 'main work')
  git('merge', '--quiet', '--no-ff', '-m', 'merge feature', 'feature')
  git('tag', 'v1')
  return dir
}

function hostFor(repo: string | null, settings: Record<string, string | number | boolean> = {}) {
  return mockHost({
    settings,
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
      },
      'editor.open': { opened: true },
      'terminal.create': { terminalId: 'term-1' }
    }
  })
}

async function withRepo(
  run: (ctx: { repo: string; worker: Awaited<ReturnType<typeof mountWorker>> }) => Promise<void>,
  settings: Record<string, string | number | boolean> = {}
): Promise<void> {
  const repo = makeRepo()
  const worker = await mountWorker(main, { host: hostFor(repo, settings) })
  try {
    await run({ repo, worker })
    assert.deepEqual(worker.refusals, [])
  } finally {
    await worker.deactivate()
    rmSync(repo, { recursive: true, force: true })
  }
}

type Worker = Awaited<ReturnType<typeof mountWorker>>

async function load(worker: Worker, input = {}) {
  const result = await worker.request('graph.load', input)
  assert.equal(result.status, 'ok')
  if (result.status !== 'ok') throw new Error('unreachable')
  return result
}

test('graph.load reads commits, branches, remotes and refs', async () => {
  await withRepo(async ({ worker }) => {
    const result = await load(worker)
    assert.equal(result.workspace.id, 'wt-1')
    assert.deepEqual(
      result.commits.map((commit) => commit.subject),
      ['merge feature', 'main work', 'feature: one, two', 'root']
    )
    const [merge, , feature, root] = result.commits
    assert.equal(merge.parents.length, 2)
    assert.deepEqual(merge.refs, [
      { kind: 'head', name: 'main' },
      { kind: 'tag', name: 'v1' }
    ])
    assert.deepEqual(feature.refs, [{ kind: 'head', name: 'feature' }])
    assert.deepEqual(root.parents, [])
    assert.equal(result.head, merge.hash)
    assert.equal(result.headBranch, 'main')
    assert.deepEqual(result.branches, ['feature', 'main'])
    assert.equal(result.hasMore, false)
    assert.deepEqual(result.submodules, [])
  })
})

test('graph.load pages with hasMore and honours the limit', async () => {
  await withRepo(async ({ worker }) => {
    const result = await load(worker, { limit: 2 })
    assert.equal(result.commits.length, 2)
    assert.equal(result.hasMore, true)
  })
})

test('graph.load filters by branch and glob', async () => {
  await withRepo(async ({ repo, worker }) => {
    gitIn(repo, 'branch', 'release/1.0', 'HEAD~1')
    const only = await load(worker, { branches: ['feature'] })
    assert.deepEqual(only.commits.map((commit) => commit.subject), ['feature: one, two', 'root'])
    const glob = await load(worker, { branches: ['release/*'] })
    assert.deepEqual(glob.commits.map((commit) => commit.hash), [gitIn(repo, 'rev-parse', 'release/1.0').trim(), ...glob.commits.slice(1).map((c) => c.hash)])
    assert.equal(glob.commits[0].refs.some((ref) => ref.name === 'release/1.0'), true)
  })
})

test('graph.load hides tags and uses first-parent only per settings', async () => {
  await withRepo(
    async ({ worker }) => {
      const result = await load(worker)
      assert.equal(result.commits.some((commit) => commit.refs.some((ref) => ref.kind === 'tag')), false)
      const filtered = await load(worker, { branches: ['main'] })
      assert.deepEqual(filtered.commits.map((commit) => commit.subject), ['merge feature', 'main work', 'root'])
    },
    { showTags: false, firstParentOnly: true }
  )
})

test('graph.load adds an uncommitted row, counting untracked files only when asked', async () => {
  await withRepo(async ({ repo, worker }) => {
    assert.notEqual((await load(worker)).commits[0].hash, UNCOMMITTED)
    writeFileSync(path.join(repo, 'a.txt'), 'changed\n')
    writeFileSync(path.join(repo, 'new.txt'), 'new\n')
    const result = await load(worker)
    const [row, head] = result.commits
    assert.equal(row.hash, UNCOMMITTED)
    assert.deepEqual(row.parents, [result.head])
    assert.equal(row.subject, 'Uncommitted Changes (2)')
    assert.equal(head.subject, 'merge feature')
  })
  await withRepo(
    async ({ repo, worker }) => {
      writeFileSync(path.join(repo, 'new.txt'), 'new\n')
      assert.notEqual((await load(worker)).commits[0].hash, UNCOMMITTED)
    },
    { showUntrackedFiles: false }
  )
  await withRepo(
    async ({ repo, worker }) => {
      writeFileSync(path.join(repo, 'a.txt'), 'changed\n')
      assert.notEqual((await load(worker)).commits[0].hash, UNCOMMITTED)
    },
    { showUncommittedChanges: false }
  )
})

test('graph.load merges stashes by their base commit', async () => {
  await withRepo(async ({ repo, worker }) => {
    writeFileSync(path.join(repo, 'a.txt'), 'stash me\n')
    gitIn(repo, 'stash', 'push', '-m', 'wip')
    const result = await load(worker)
    const stash = result.commits.find((commit) => commit.stash === 'stash@{0}')
    assert.ok(stash)
    assert.deepEqual(stash.refs, [{ kind: 'stash', name: 'stash@{0}' }])
    assert.deepEqual(stash.parents, [result.head])
    assert.equal(result.commits.indexOf(stash) < result.commits.findIndex((c) => c.hash === result.head), true)
    assert.equal(result.commits.every((commit) => commit.hash !== UNCOMMITTED), true)
  })
})

test('graph.load reports a signature column only when asked', async () => {
  await withRepo(async ({ worker }) => {
    assert.equal((await load(worker)).commits[0].signature, undefined)
  })
  await withRepo(
    async ({ worker }) => {
      assert.equal((await load(worker)).commits[0].signature, 'N')
    },
    { showSignatureStatus: true }
  )
})

test('graph.load reports a focused workspace that workspace.list does not have', async () => {
  const worker = await mountWorker(main, { host: hostFor(null) })
  assert.deepEqual(await worker.request('graph.load', {}), {
    status: 'not-found',
    displayName: 'demo',
    branch: 'refs/heads/main'
  })
  await worker.deactivate()
})

test('graph.load rejects a repoPath that is not a submodule', async () => {
  await withRepo(async ({ worker }) => {
    for (const repoPath of ['..', '../x', 'sub', '/etc']) {
      const result = await worker.request('graph.load', { repoPath })
      assert.equal(result.status, 'git-error')
    }
  })
})

test('graph.load lists and opens submodules', async () => {
  await withRepo(async ({ repo, worker }) => {
    const sub = mkdtempSync(path.join(tmpdir(), 'git-graph-sub-'))
    try {
      gitIn(sub, 'init', '--quiet', '--initial-branch=main')
      writeFileSync(path.join(sub, 's.txt'), 's\n')
      gitIn(sub, 'add', '.')
      gitIn(sub, 'commit', '--quiet', '-m', 'sub root')
      execFileSync('git', ['-c', 'protocol.file.allow=always', 'submodule', 'add', '--quiet', sub, 'libs/sub'], { cwd: repo, env: ENV })
      const root = await load(worker)
      assert.deepEqual(root.submodules, ['libs/sub'])
      const inner = await load(worker, { repoPath: 'libs/sub' })
      assert.deepEqual(inner.commits.map((commit) => commit.subject), ['sub root'])
    } finally {
      rmSync(sub, { recursive: true, force: true })
    }
  })
})

test('commit.details lists files with stats, renames and the body', async () => {
  await withRepo(async ({ repo, worker }) => {
    gitIn(repo, 'mv', 'a.txt', 'renamed.txt')
    gitIn(repo, 'commit', '--quiet', '-m', 'rename it', '-m', 'Body line')
    const hash = gitIn(repo, 'rev-parse', 'HEAD').trim()
    const details = await worker.request('commit.details', { hash })
    assert.equal(details.subject, 'rename it')
    assert.equal(details.body, 'Body line')
    assert.equal(details.author, 'Ann')
    assert.deepEqual(details.files, [{ status: 'R', path: 'renamed.txt', oldPath: 'a.txt', additions: 0, deletions: 0 }])

    const root = gitIn(repo, 'rev-list', '--max-parents=0', 'HEAD').trim()
    const rootDetails = await worker.request('commit.details', { hash: root })
    assert.deepEqual(rootDetails.files, [{ status: 'A', path: 'a.txt', additions: 1, deletions: 0 }])
    assert.deepEqual(rootDetails.parents, [])
  })
})

test('commit.uncommitted and commit.compare', async () => {
  await withRepo(async ({ repo, worker }) => {
    writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\nthree\n')
    writeFileSync(path.join(repo, 'new.txt'), 'x\ny\n')
    const uncommitted = await worker.request('commit.uncommitted', {})
    assert.deepEqual(uncommitted.files, [
      { status: 'M', path: 'a.txt', additions: 1, deletions: 0 },
      { status: 'U', path: 'new.txt', additions: 2, deletions: 0 }
    ])
    const root = gitIn(repo, 'rev-list', '--max-parents=0', 'HEAD').trim()
    const head = gitIn(repo, 'rev-parse', 'HEAD').trim()
    const compared = await worker.request('commit.compare', { from: root, to: head })
    assert.deepEqual(compared.files.map((file) => file.path), ['a.txt', 'b.txt'])
    const toTree = await worker.request('commit.compare', { from: root, to: UNCOMMITTED })
    assert.deepEqual(toTree.files.map((file) => file.path), ['a.txt', 'b.txt', 'new.txt'])
  })
})

test('file.diff handles commits, root commits, the working tree and untracked files', async () => {
  await withRepo(async ({ repo, worker }) => {
    const head = gitIn(repo, 'rev-parse', 'HEAD').trim()
    const second = gitIn(repo, 'rev-parse', 'HEAD^1').trim()
    const diff = await worker.request('file.diff', { from: null, to: second, path: 'a.txt' })
    assert.equal(diff.status, 'ok')
    assert.ok(diff.status === 'ok' && !diff.binary && diff.patch.includes('+two'))

    const root = gitIn(repo, 'rev-list', '--max-parents=0', 'HEAD').trim()
    const rootDiff = await worker.request('file.diff', { from: null, to: root, path: 'a.txt' })
    assert.ok(rootDiff.status === 'ok' && !rootDiff.binary && rootDiff.patch.includes('+one'))

    writeFileSync(path.join(repo, 'a.txt'), 'edited\n')
    const working = await worker.request('file.diff', { from: null, to: UNCOMMITTED, path: 'a.txt' })
    assert.ok(working.status === 'ok' && !working.binary && working.patch.includes('+edited'))

    writeFileSync(path.join(repo, 'fresh.txt'), 'brand new\n')
    const fresh = await worker.request('file.diff', { from: null, to: UNCOMMITTED, path: 'fresh.txt' })
    assert.ok(fresh.status === 'ok' && !fresh.binary && fresh.patch.includes('+brand new'))

    writeFileSync(path.join(repo, 'bin.dat'), Buffer.from([0, 1, 2, 3, 0]))
    gitIn(repo, 'add', 'bin.dat')
    const binary = await worker.request('file.diff', { from: null, to: UNCOMMITTED, path: 'bin.dat' })
    assert.deepEqual(binary, { status: 'ok', binary: true })

    const between = await worker.request('file.diff', { from: root, to: head, path: 'b.txt' })
    assert.ok(between.status === 'ok' && !between.binary && between.patch.includes('+b1'))

    await assert.rejects(worker.request('file.diff', { from: null, to: head, path: '../etc/passwd' }))
  })
})

test('file.diff reports too-large output', async () => {
  await withRepo(async ({ repo, worker }) => {
    writeFileSync(path.join(repo, 'big.txt'), 'line of text\n'.repeat(300_000))
    gitIn(repo, 'add', 'big.txt')
    gitIn(repo, 'commit', '--quiet', '-m', 'big')
    const hash = gitIn(repo, 'rev-parse', 'HEAD').trim()
    const diff = await worker.request('file.diff', { from: null, to: hash, path: 'big.txt' })
    assert.equal(diff.status, 'too-large')
    const content = await worker.request('file.atRevision', { rev: hash, path: 'big.txt' })
    assert.equal(content.status, 'too-large')
  })
})

test('file.atRevision returns text, binary and missing', async () => {
  await withRepo(async ({ repo, worker }) => {
    const head = gitIn(repo, 'rev-parse', 'HEAD').trim()
    assert.deepEqual(await worker.request('file.atRevision', { rev: head, path: 'a.txt' }), { status: 'ok', content: 'one\ntwo\n' })
    assert.deepEqual(await worker.request('file.atRevision', { rev: head, path: 'nope.txt' }), { status: 'missing' })
    writeFileSync(path.join(repo, 'bin.dat'), Buffer.from([0, 1, 2]))
    gitIn(repo, 'add', 'bin.dat')
    gitIn(repo, 'commit', '--quiet', '-m', 'bin')
    const next = gitIn(repo, 'rev-parse', 'HEAD').trim()
    assert.deepEqual(await worker.request('file.atRevision', { rev: next, path: 'bin.dat' }), { status: 'binary' })
  })
})

test('file.open asks the host to open the file in the workspace', async () => {
  await withRepo(async ({ worker }) => {
    assert.deepEqual(await worker.request('file.open', { path: 'a.txt' }), { opened: true })
    assert.deepEqual(worker.host.callsOf('editor.open'), [{ workspaceId: 'wt-1', path: 'a.txt' }])
    await assert.rejects(worker.request('file.open', { path: '../secret' }))
  })
})

test('tag.details and commit.containedIn', async () => {
  await withRepo(async ({ repo, worker }) => {
    gitIn(repo, 'tag', '-a', 'v2', '-m', 'release two')
    const tag = await worker.request('tag.details', { name: 'v2' })
    assert.equal(tag.tagger, 'Ann')
    assert.equal(tag.email, 'ann@example.com')
    assert.equal(tag.message, 'release two')
    const feature = gitIn(repo, 'rev-parse', 'feature').trim()
    const contained = await worker.request('commit.containedIn', { hash: feature })
    assert.equal(contained.inHead, true)
    assert.deepEqual(contained.branches, ['feature', 'main'])
    assert.deepEqual(contained.tags, ['v1', 'v2'])
  })
})

type RunResult = { status: string; output?: string; message?: string }
async function run(worker: Worker, action: unknown): Promise<RunResult> {
  return worker.request('action.run', { action: action as never })
}
async function ok(worker: Worker, action: unknown): Promise<void> {
  const result = await run(worker, action)
  assert.equal(result.status, 'ok', result.message)
}

test('branch actions: create, checkout, rename, delete, merge', async () => {
  await withRepo(async ({ repo, worker }) => {
    await ok(worker, { kind: 'branch.create', name: 'topic', at: 'feature', checkout: false })
    assert.equal(gitIn(repo, 'rev-parse', 'topic').trim(), gitIn(repo, 'rev-parse', 'feature').trim())
    await ok(worker, { kind: 'branch.create', name: 'topic2', at: 'main', checkout: true })
    assert.equal(gitIn(repo, 'branch', '--show-current').trim(), 'topic2')
    await ok(worker, { kind: 'branch.checkout', name: 'main' })
    await ok(worker, { kind: 'branch.rename', from: 'topic', to: 'renamed' })
    await ok(worker, { kind: 'branch.delete', name: 'renamed', force: false })
    await ok(worker, { kind: 'branch.create', name: 'x', at: 'main', checkout: false })
    const bad = await run(worker, { kind: 'branch.create', name: '--evil', at: 'main', checkout: false })
    assert.equal(bad.status, 'error')
    const dup = await run(worker, { kind: 'branch.create', name: 'x', at: 'main', checkout: false })
    assert.equal(dup.status, 'error')

    gitIn(repo, 'switch', '--quiet', '-c', 'side', 'feature')
    writeFileSync(path.join(repo, 'side.txt'), 's\n')
    gitIn(repo, 'add', '.')
    gitIn(repo, 'commit', '--quiet', '-m', 'side work')
    gitIn(repo, 'switch', '--quiet', 'main')
    await ok(worker, { kind: 'branch.merge', ref: 'side', mode: 'squash', noCommit: false })
    assert.equal(gitIn(repo, 'log', '-1', '--format=%s').trim().length > 0, true)
    assert.equal(existsSync(path.join(repo, 'side.txt')), true)
  })
})

test('tag actions: add lightweight and annotated, delete', async () => {
  await withRepo(async ({ repo, worker }) => {
    await ok(worker, { kind: 'tag.add', name: 'light', at: 'main', force: false })
    assert.equal(gitIn(repo, 'cat-file', '-t', 'light').trim(), 'commit')
    await ok(worker, { kind: 'tag.add', name: 'ann', at: 'main', message: 'hello', force: false })
    assert.equal(gitIn(repo, 'cat-file', '-t', 'ann').trim(), 'tag')
    assert.equal((await run(worker, { kind: 'tag.add', name: 'ann', at: 'main', force: false })).status, 'error')
    await ok(worker, { kind: 'tag.delete', name: 'light' })
    assert.equal(gitIn(repo, 'tag', '--list', 'light').trim(), '')
  })
})

test('stash actions: push, apply, pop, drop', async () => {
  await withRepo(async ({ repo, worker }) => {
    writeFileSync(path.join(repo, 'a.txt'), 'dirty\n')
    writeFileSync(path.join(repo, 'untracked.txt'), 'u\n')
    await ok(worker, { kind: 'stash.push', message: 'wip', includeUntracked: true })
    assert.equal(gitIn(repo, 'status', '--porcelain').trim(), '')
    assert.equal(gitIn(repo, 'stash', 'list').includes('wip'), true)
    await ok(worker, { kind: 'stash.apply', selector: 'stash@{0}', reinstateIndex: false })
    assert.equal(readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'dirty\n')
    gitIn(repo, 'reset', '--hard', '--quiet')
    gitIn(repo, 'clean', '-fdq')
    await ok(worker, { kind: 'stash.pop', selector: 'stash@{0}', reinstateIndex: false })
    assert.equal(gitIn(repo, 'stash', 'list').trim(), '')
    assert.equal(existsSync(path.join(repo, 'untracked.txt')), true)
    gitIn(repo, 'stash', 'push', '--include-untracked', '-m', 'again')
    await ok(worker, { kind: 'stash.drop', selector: 'stash@{0}' })
    assert.equal(gitIn(repo, 'stash', 'list').trim(), '')
    assert.equal((await run(worker, { kind: 'stash.drop', selector: 'stash@{0; rm}' })).status, 'error')
  })
})

test('commit actions: reset, revert, cherry-pick, drop, checkout', async () => {
  await withRepo(async ({ repo, worker }) => {
    const head = gitIn(repo, 'rev-parse', 'HEAD').trim()
    const mainWork = gitIn(repo, 'rev-parse', 'HEAD^1').trim()
    await ok(worker, { kind: 'commit.reset', hash: mainWork, mode: 'hard' })
    assert.equal(gitIn(repo, 'rev-parse', 'HEAD').trim(), mainWork)
    assert.equal(existsSync(path.join(repo, 'b.txt')), false)
    await ok(worker, { kind: 'commit.reset', hash: head, mode: 'soft' })
    assert.equal(gitIn(repo, 'rev-parse', 'HEAD').trim(), head)
    await ok(worker, { kind: 'commit.reset', hash: mainWork, mode: 'mixed' })
    gitIn(repo, 'reset', '--hard', '--quiet', head)

    await ok(worker, { kind: 'commit.revert', hash: mainWork })
    assert.equal(gitIn(repo, 'log', '-1', '--format=%s').startsWith('Revert'), true)
    gitIn(repo, 'reset', '--hard', '--quiet', head)

    // Merge commits cannot be dropped; plain ones can.
    const refused = await run(worker, { kind: 'commit.drop', hash: head })
    assert.equal(refused.status, 'error')
    writeFileSync(path.join(repo, 'c.txt'), 'c\n')
    gitIn(repo, 'add', '.')
    gitIn(repo, 'commit', '--quiet', '-m', 'c1')
    const c1 = gitIn(repo, 'rev-parse', 'HEAD').trim()
    writeFileSync(path.join(repo, 'd.txt'), 'd\n')
    gitIn(repo, 'add', '.')
    gitIn(repo, 'commit', '--quiet', '-m', 'd1')
    await ok(worker, { kind: 'commit.drop', hash: c1 })
    assert.deepEqual(gitIn(repo, 'log', '--format=%s', '-2').trim().split('\n'), ['d1', 'merge feature'])
    assert.equal(existsSync(path.join(repo, 'c.txt')), false)
    gitIn(repo, 'switch', '--quiet', '-c', 'other', 'feature')
    writeFileSync(path.join(repo, 'other.txt'), 'o\n')
    gitIn(repo, 'add', '.')
    gitIn(repo, 'commit', '--quiet', '-m', 'other')
    const otherTip = gitIn(repo, 'rev-parse', 'HEAD').trim()
    gitIn(repo, 'switch', '--quiet', 'main')
    assert.equal((await run(worker, { kind: 'commit.drop', hash: otherTip })).status, 'error')

    await ok(worker, { kind: 'commit.cherryPick', hash: otherTip, noCommit: false, recordOrigin: true })
    assert.equal(gitIn(repo, 'log', '-1', '--format=%B').includes('cherry picked from commit'), true)
    await ok(worker, { kind: 'commit.checkout', hash: mainWork })
    assert.equal(gitIn(repo, 'branch', '--show-current').trim(), '')
  })
})

test('uncommitted actions: reset and clean', async () => {
  await withRepo(async ({ repo, worker }) => {
    writeFileSync(path.join(repo, 'a.txt'), 'dirty\n')
    mkdtempSync(path.join(repo, 'dir-'))
    writeFileSync(path.join(repo, 'dir-file.txt'), 'x\n')
    await ok(worker, { kind: 'uncommitted.reset', mode: 'hard' })
    assert.equal(readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'one\ntwo\n')
    await ok(worker, { kind: 'uncommitted.clean', directories: false })
    assert.equal(existsSync(path.join(repo, 'dir-file.txt')), false)
  })
})

test('remote and user actions, and repo.settings', async () => {
  await withRepo(async ({ repo, worker }) => {
    const bare = mkdtempSync(path.join(tmpdir(), 'git-graph-bare-'))
    try {
      gitIn(bare, 'init', '--quiet', '--bare')
      await ok(worker, { kind: 'remote.add', name: 'origin', url: bare, fetch: false })
      await ok(worker, { kind: 'branch.push', name: 'main', remotes: ['origin'], setUpstream: true, force: 'none' })
      await ok(worker, { kind: 'tag.push', name: 'v1', remotes: ['origin'] })
      await ok(worker, { kind: 'remote.fetch', remote: null, prune: true, pruneTags: false })
      const loaded = await load(worker)
      assert.deepEqual(loaded.remotes, ['origin'])
      assert.equal(loaded.commits[0].refs.some((ref) => ref.kind === 'remote' && ref.name === 'origin/main' && ref.remote === 'origin'), true)

      await ok(worker, { kind: 'remote.edit', oldName: 'origin', name: 'upstream', url: bare, pushUrl: bare })
      await ok(worker, { kind: 'user.set', scope: 'local', name: 'Bob', email: 'bob@example.com' })
      const settings = await worker.request('repo.settings', {})
      assert.equal(settings.remotes[0].name, 'upstream')
      assert.equal(settings.remotes[0].url, bare)
      assert.deepEqual(settings.user.local, { name: 'Bob', email: 'bob@example.com' })
      await ok(worker, { kind: 'user.unset', scope: 'local' })
      assert.deepEqual((await worker.request('repo.settings', {})).user.local, { name: null, email: null })
      await ok(worker, { kind: 'remote.delete', name: 'upstream' })
      assert.equal(gitIn(repo, 'remote').trim(), '')
    } finally {
      rmSync(bare, { recursive: true, force: true })
    }
  })
})

test('authentication failures come back as auth-required with the git argv', async () => {
  await withRepo(async ({ repo, worker }) => {
    gitIn(repo, 'remote', 'add', 'origin', 'https://127.0.0.1:1/none.git')
    const result = await run(worker, { kind: 'branch.push', name: 'main', remotes: ['origin'], setUpstream: false, force: 'none' })
    assert.ok(['error', 'auth-required'].includes((result as { status: string }).status))
    const terminal = await worker.request('action.runInTerminal', { command: ['push', 'origin', 'main'] })
    assert.deepEqual(terminal, { terminalId: 'term-1' })
    const [call] = worker.host.callsOf('terminal.create') as { workspaceId: string; command: string }[]
    assert.equal(call.workspaceId, 'wt-1')
    assert.equal(call.command, `cd ${realpathSync(repo)} && git push origin main`)
    await assert.rejects(worker.request('action.runInTerminal', { command: ['reset', '--hard'] }))
  })
  assert.equal(isAuthFailure("fatal: could not read Username for 'https://github.com': terminal prompts disabled"), true)
  assert.equal(isAuthFailure('remote: Invalid username or password.\nfatal: Authentication failed for x'), true)
  assert.equal(isAuthFailure('git@github.com: Permission denied (publickey).'), true)
  assert.equal(isAuthFailure('error: failed to push some refs'), false)
})

test('terminalCommandLine quotes arguments', () => {
  assert.equal(terminalCommandLine(['push', 'o rigin', "it's"], '/tmp/my repo'), `cd '/tmp/my repo' && git push 'o rigin' 'it'\\''s'`)
})

test('commit.archive returns base64 bytes', async () => {
  await withRepo(async ({ worker }) => {
    const archive = await worker.request('commit.archive', { ref: 'main', format: 'tar' })
    assert.match(archive.name, /^main-[0-9a-f]+\.tar$/)
    assert.equal(Buffer.from(archive.base64, 'base64').includes('a.txt'), true)
    await assert.rejects(worker.request('commit.archive', { ref: '--output=x', format: 'zip' }))
  })
})

test('repo config is stored, exported to .orca/git-graph.json and used as a fallback', async () => {
  await withRepo(async ({ repo, worker }) => {
    const config = {
      issueLinking: { issue: '#(\\d+)', url: 'https://example.com/$1' },
      pullRequest: null,
      hideRemotes: ['origin']
    }
    assert.deepEqual(await worker.request('repo.saveConfig', { config }), { ok: true })
    assert.deepEqual((await worker.request('repo.settings', {})).config, config)
    assert.deepEqual(await worker.request('repo.exportConfig', {}), { path: '.orca/git-graph.json' })
    assert.deepEqual(JSON.parse(readFileSync(path.join(repo, '.orca', 'git-graph.json'), 'utf8')), config)
  })
  await withRepo(async ({ repo, worker }) => {
    execFileSync('mkdir', ['-p', path.join(repo, '.orca')])
    writeFileSync(path.join(repo, '.orca', 'git-graph.json'), JSON.stringify({ hideRemotes: ['up'], issueLinking: null, pullRequest: null }))
    assert.deepEqual((await worker.request('repo.settings', {})).config.hideRemotes, ['up'])
  })
})

test('hidden remotes are left out of the graph', async () => {
  await withRepo(async ({ repo, worker }) => {
    gitIn(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
    gitIn(repo, 'update-ref', 'refs/remotes/up/main', 'HEAD')
    gitIn(repo, 'remote', 'add', 'origin', '/nonexistent')
    gitIn(repo, 'remote', 'add', 'up', '/nonexistent2')
    await worker.request('repo.saveConfig', { config: { issueLinking: null, pullRequest: null, hideRemotes: ['origin'] } })
    const refs = (await load(worker)).commits[0].refs.filter((ref) => ref.kind === 'remote').map((ref) => ref.name)
    assert.deepEqual(refs, ['up/main'])
  })
})

test('view state and code reviews persist per repository, reviews expire after 90 days', async () => {
  await withRepo(async ({ worker }) => {
    assert.equal(await worker.request('view.load', {}), null)
    const state = { columnWidths: { message: 300 }, hiddenColumns: ['author'], branchFilter: ['main'], scrollTop: 40 }
    await worker.request('view.save', { state })
    assert.deepEqual(await worker.request('view.load', {}), state)

    assert.equal(await worker.request('review.get', { key: 'abc' }), null)
    const review = await worker.request('review.start', { key: 'abc', files: ['a.txt', 'b.txt'] })
    assert.deepEqual(review.remaining, ['a.txt', 'b.txt'])
    const updated = await worker.request('review.update', { id: review.id, reviewed: 'a.txt' })
    assert.deepEqual(updated?.remaining, ['b.txt'])
    assert.deepEqual((await worker.request('review.get', { key: 'abc' }))?.remaining, ['b.txt'])
    await worker.request('review.end', { id: review.id })
    assert.equal(await worker.request('review.get', { key: 'abc' }), null)

  })
})

test('code reviews idle for more than 90 days are dropped', async () => {
  const repo = makeRepo()
  try {
    const top = gitIn(repo, 'rev-parse', '--show-toplevel').trim()
    const day = 24 * 60 * 60 * 1000
    const seeded = mockHost({
      storage: {
        [`reviews:${top}`]: [
          { id: 'old', key: 'old', remaining: ['a.txt'], lastActive: Date.now() - 91 * day },
          { id: 'new', key: 'new', remaining: ['a.txt'], lastActive: Date.now() - 89 * day }
        ]
      },
      results: {
        'workspace.readContext': { branch: 'refs/heads/main', displayName: 'demo', terminals: [] },
        'workspace.list': {
          workspaces: [{ id: 'wt-1', kind: 'worktree', name: 'demo', path: repo, branch: 'main', hostId: null }],
          truncated: false
        }
      }
    })
    const worker = await mountWorker(main, { host: seeded })
    assert.equal(await worker.request('review.get', { key: 'old' }), null)
    assert.equal((await worker.request('review.get', { key: 'new' }))?.id, 'new')
    await worker.deactivate()
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('avatar.get is off unless fetchAvatars is enabled', async () => {
  await withRepo(async ({ worker }) => {
    assert.deepEqual(await worker.request('avatar.get', { email: 'ann@example.com', hash: 'x' }), { dataUri: null })
  })
})

test('graph.changed is posted when refs change on disk', async () => {
  await withRepo(async ({ repo, worker }) => {
    await load(worker)
    await new Promise((resolve) => setTimeout(resolve, 200))
    gitIn(repo, 'branch', 'watched')
    for (let i = 0; i < 30 && worker.posts.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(worker.posts.some((post) => post.event === 'graph.changed'), true)
    assert.equal((worker.posts[0].payload as { path: string }).path.length > 0, true)
  })
})

function makeBare(): string {
  const bare = mkdtempSync(path.join(tmpdir(), 'git-graph-bare-'))
  gitIn(bare, 'init', '--quiet', '--bare')
  return bare
}

test('graph.load lists remote branches, orders commits and filters by a remote branch', async () => {
  await withRepo(async ({ repo, worker }) => {
    gitIn(repo, 'update-ref', 'refs/remotes/origin/zeta', 'feature')
    gitIn(repo, 'update-ref', 'refs/remotes/origin/main', 'main')
    gitIn(repo, 'update-ref', 'refs/remotes/up/main', 'main')
    gitIn(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main')
    gitIn(repo, 'remote', 'add', 'origin', '/nonexistent')
    gitIn(repo, 'remote', 'add', 'up', '/nonexistent2')
    await worker.request('repo.saveConfig', { config: { issueLinking: null, pullRequest: null, hideRemotes: ['up'] } })
    const result = await load(worker)
    assert.deepEqual(result.remoteBranches, ['origin/main', 'origin/zeta'])
    const filtered = await load(worker, { branches: ['origin/zeta'] })
    assert.deepEqual(filtered.commits.map((commit) => commit.subject), ['feature: one, two', 'root'])
  })
  for (const commitOrder of ['author-date', 'topo']) {
    await withRepo(async ({ worker }) => {
      assert.equal((await load(worker)).commits.length, 4)
    }, { commitOrder })
  }
})

test('checking out a remote branch reuses an existing local branch and reports when it is behind', async () => {
  await withRepo(async ({ repo, worker }) => {
    const bare = makeBare()
    try {
      gitIn(repo, 'remote', 'add', 'origin', bare)
      gitIn(repo, 'push', '--quiet', '-u', 'origin', 'main')
      const first = await run(worker, { kind: 'branch.checkout', name: 'origin/main', createLocal: 'fresh' })
      assert.equal(first.status, 'ok', first.message)
      assert.equal(gitIn(repo, 'branch', '--show-current').trim(), 'fresh')
      await ok(worker, { kind: 'branch.checkout', name: 'main' })
      // Make origin/main one commit ahead of the local main.
      writeFileSync(path.join(repo, 'n.txt'), 'n\n')
      gitIn(repo, 'add', '.')
      gitIn(repo, 'commit', '--quiet', '-m', 'ahead')
      gitIn(repo, 'push', '--quiet', 'origin', 'main')
      gitIn(repo, 'reset', '--quiet', '--hard', 'HEAD~1')
      await ok(worker, { kind: 'branch.checkout', name: 'feature' })
      const result = await run(worker, { kind: 'branch.checkout', name: 'origin/main', createLocal: 'main' })
      assert.equal(result.status, 'ok', result.message)
      assert.match(result.output ?? '', /already exists/)
      assert.match(result.output ?? '', /behind 1/)
      assert.equal(gitIn(repo, 'branch', '--show-current').trim(), 'main')
      // A local branch with no upstream is compared with the remote branch that was picked.
      gitIn(repo, 'branch', 'solo', 'main')
      gitIn(repo, 'commit', '--quiet', '--allow-empty', '-m', 'solo ahead')
      gitIn(repo, 'push', '--quiet', 'origin', 'HEAD:solo')
      gitIn(repo, 'reset', '--quiet', '--hard', 'HEAD~1')
      const solo = await run(worker, { kind: 'branch.checkout', name: 'origin/solo', createLocal: 'solo' })
      assert.equal(solo.status, 'ok', solo.message)
      assert.match(solo.output ?? '', /behind 1\)/)
    } finally {
      rmSync(bare, { recursive: true, force: true })
    }
  })
})

test('pull with squash commits the squashed changes', async () => {
  await withRepo(async ({ repo, worker }) => {
    const bare = makeBare()
    try {
      gitIn(repo, 'remote', 'add', 'origin', bare)
      gitIn(repo, 'push', '--quiet', 'origin', 'main', 'feature')
      gitIn(repo, 'switch', '--quiet', '-c', 'pulled', 'main')
      gitIn(repo, 'switch', '--quiet', 'feature')
      writeFileSync(path.join(repo, 'f.txt'), 'f\n')
      gitIn(repo, 'add', '.')
      gitIn(repo, 'commit', '--quiet', '-m', 'on feature')
      gitIn(repo, 'push', '--quiet', 'origin', 'feature')
      gitIn(repo, 'switch', '--quiet', 'pulled')
      const before = gitIn(repo, 'rev-list', '--count', 'HEAD').trim()
      await ok(worker, { kind: 'branch.pull', remote: 'origin', name: 'feature', noFf: false, squash: true })
      assert.equal(gitIn(repo, 'log', '-1', '--format=%s').trim(), "Merge branch 'origin/feature'")
      assert.equal(Number(gitIn(repo, 'rev-list', '--count', 'HEAD').trim()), Number(before) + 1)
      assert.equal(gitIn(repo, 'status', '--porcelain').trim(), '')
      // Nothing new: still ok, no extra commit.
      await ok(worker, { kind: 'branch.pull', remote: 'origin', name: 'feature', noFf: false, squash: true })
      assert.equal(Number(gitIn(repo, 'rev-list', '--count', 'HEAD').trim()), Number(before) + 1)
    } finally {
      rmSync(bare, { recursive: true, force: true })
    }
  })
})

test('push to several remotes sets the upstream once and stops at the first failure', async () => {
  await withRepo(async ({ repo, worker }) => {
    const one = makeBare()
    const two = makeBare()
    try {
      gitIn(repo, 'remote', 'add', 'one', one)
      gitIn(repo, 'remote', 'add', 'two', two)
      await ok(worker, { kind: 'branch.push', name: 'main', remotes: ['one', 'two'], setUpstream: true, force: 'none' })
      const head = gitIn(repo, 'rev-parse', 'main').trim()
      assert.equal(gitIn(one, 'rev-parse', 'main').trim(), head)
      assert.equal(gitIn(two, 'rev-parse', 'main').trim(), head)
      assert.equal(gitIn(repo, 'config', 'branch.main.remote').trim(), 'one')

      gitIn(repo, 'remote', 'add', 'dead', path.join(tmpdir(), 'git-graph-no-such-remote'))
      gitIn(repo, 'remote', 'add', 'three', makeBare())
      const failed = await run(worker, { kind: 'branch.push', name: 'feature', remotes: ['one', 'dead', 'three'], setUpstream: false, force: 'none' })
      assert.equal(failed.status, 'error')
      assert.match(failed.message ?? '', /Push to dead failed/)
      assert.equal(gitIn(one, 'rev-parse', 'feature').trim(), gitIn(repo, 'rev-parse', 'feature').trim())
      assert.equal(gitIn(repo, 'ls-remote', 'three').trim(), '')
    } finally {
      rmSync(one, { recursive: true, force: true })
      rmSync(two, { recursive: true, force: true })
    }
  })
})

test('rebase.interactive opens git rebase -i in a terminal and refuses a dirty working tree', async () => {
  await withRepo(async ({ repo, worker }) => {
    assert.deepEqual(await worker.request('rebase.interactive', { onto: 'feature' }), { terminalId: 'term-1' })
    const [call] = worker.host.callsOf('terminal.create') as { workspaceId: string; command: string }[]
    assert.equal(call.workspaceId, 'wt-1')
    assert.equal(call.command, `cd ${realpathSync(repo)} && git rebase -i feature`)
    await assert.rejects(worker.request('rebase.interactive', { onto: '--exec=x' }))
    writeFileSync(path.join(repo, 'a.txt'), 'dirty\n')
    await assert.rejects(worker.request('rebase.interactive', { onto: 'feature' }), (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'conflict')
      assert.match((error as Error).message, /uncommitted changes/)
      return true
    })
    assert.equal(worker.host.callsOf('terminal.create').length, 1)
  })
})

test('the working tree is watched: tracked edits post graph.changed, ignored files do not', async () => {
  const repo = makeRepo()
  writeFileSync(path.join(repo, '.gitignore'), '*.log\nbuild/\n')
  gitIn(repo, 'add', '.')
  gitIn(repo, 'commit', '--quiet', '-m', 'ignore')
  const worker = await mountWorker(main, { host: hostFor(repo) })
  const changed = () => worker.posts.filter((post) => post.event === 'graph.changed').length
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  try {
    await load(worker)
    await sleep(500)
    const base = changed()
    writeFileSync(path.join(repo, 'debug.log'), 'x\n')
    mkdirSync(path.join(repo, 'build'))
    writeFileSync(path.join(repo, 'build', 'out.js'), 'x\n')
    await sleep(1800)
    assert.equal(changed(), base)
    writeFileSync(path.join(repo, 'a.txt'), 'edited\n')
    for (let i = 0; i < 40 && changed() === base; i++) await sleep(100)
    assert.equal(changed() > base, true)
  } finally {
    await worker.deactivate()
    rmSync(repo, { recursive: true, force: true })
  }
})

test('the working tree is not watched when watchWorkingTree is off', async () => {
  await withRepo(async ({ repo, worker }) => {
    await load(worker)
    await new Promise((resolve) => setTimeout(resolve, 500))
    writeFileSync(path.join(repo, 'a.txt'), 'edited\n')
    await new Promise((resolve) => setTimeout(resolve, 1800))
    assert.equal(worker.posts.some((post) => post.event === 'graph.changed'), false)
  }, { watchWorkingTree: false })
})

test('orca-plugin.json settings match the shared defaults', () => {
  const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'orca-plugin.json'), 'utf8')) as {
    contributes: { settings: { key: string; default: unknown; enum?: string[] }[] }
  }
  const declared = Object.fromEntries(manifest.contributes.settings.map((setting) => [setting.key, setting.default]))
  assert.deepEqual(declared, DEFAULT_SETTINGS)
  assert.equal(manifest.contributes.settings.length <= 64, true)
})

test('pure helpers', () => {
  assert.equal(normaliseRelative('a/b'), 'a/b')
  assert.equal(normaliseRelative('../a'), null)
  assert.equal(normaliseRelative('/a'), null)
  assert.equal(normaliseRelative('a\\b'), 'a/b')
  assert.deepEqual(parseNameStatus('M\0a.txt\0R100\0old\0new\0A\0z\0'), [
    { status: 'M', path: 'a.txt' },
    { status: 'R', oldPath: 'old', path: 'new' },
    { status: 'A', path: 'z' }
  ])
  const counts = parseNumstat('1\t2\ta.txt\0-\t-\tbin\0 0\t0\t\0old\0new\0'.replace(' 0', '0'))
  assert.deepEqual(counts.get('a.txt'), { additions: 1, deletions: 2 })
  assert.deepEqual(counts.get('bin'), { additions: null, deletions: null })
  assert.deepEqual(counts.get('new'), { additions: 0, deletions: 0 })
})
