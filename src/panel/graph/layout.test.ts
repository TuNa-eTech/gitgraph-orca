import { assert, test } from 'orca/testing'
import { UNCOMMITTED, type Commit } from '../../shared/protocol'
import { layoutGraph } from './layout'

function c(hash: string, parents: string[], extra: Partial<Commit> = {}): Commit {
  return { hash, parents, author: 'a', email: 'a@x', time: 0, refs: [], subject: hash, ...extra }
}

test('linear history stays on one lane', () => {
  const g = layoutGraph([c('c', ['b']), c('b', ['a']), c('a', [])], 'c')
  assert.deepEqual(g.vertices.map((v) => v.lane), [0, 0, 0])
  assert.equal(g.laneCount, 1)
  assert.equal(g.edges.length, 2)
  assert.ok(g.vertices[0].head)
})

test('merge opens a second lane that converges at the fork point', () => {
  const g = layoutGraph([c('m', ['a', 'b']), c('b', ['base']), c('a', ['base']), c('base', [])], 'm')
  assert.equal(g.vertices[0].merge, true)
  assert.equal(g.vertices[1].lane, 1)
  assert.equal(g.vertices[2].lane, 0)
  assert.equal(g.vertices[3].lane, 1)
  assert.equal(g.laneCount, 2)
  const join = g.edges.find((e) => e.points[0].lane === 0 && e.points[e.points.length - 1].lane === 1)
  assert.ok(join, 'lane 0 bends into the lane that waits for base')
})

test('octopus merge gets a lane per extra parent', () => {
  const g = layoutGraph([c('m', ['a', 'b', 'd']), c('a', []), c('b', []), c('d', [])], 'm')
  assert.equal(g.laneCount, 3)
  assert.deepEqual(g.vertices.slice(1).map((v) => v.lane), [0, 1, 2])
})

test('missing parent runs to the bottom; several roots coexist', () => {
  const g = layoutGraph([c('x', ['gone']), c('r', [])], 'x')
  const bottom = g.edges.filter((e) => e.toBottom)
  assert.equal(bottom.length, 1)
  assert.equal(bottom[0].points[bottom[0].points.length - 1].row, 2)
  assert.equal(g.vertices[1].lane, 1)
})

test('uncommitted row links to HEAD with a dashed edge; stash does not pull helper parents', () => {
  const g = layoutGraph(
    [c(UNCOMMITTED, []), c('s', ['h', 'i'], { stash: 'stash@{0}' }), c('h', [])],
    'h'
  )
  assert.ok(g.vertices[0].uncommitted)
  assert.ok(g.vertices[1].stash)
  assert.equal(g.vertices[1].merge, false)
  assert.ok(g.edges.some((e) => e.dashed))
  assert.equal(g.vertices[2].lane, 0)
})

test('first-parent mode drops second parents', () => {
  const g = layoutGraph([c('m', ['a', 'b']), c('a', []), c('b', [])], 'm', { firstParentOnly: true })
  assert.equal(g.vertices[0].merge, false)
  assert.equal(g.vertices[1].lane, 0)
  assert.equal(g.vertices[2].lane, 0)
  assert.equal(g.laneCount, 1)
})
