// Lane layout of the commit graph. Pure: the same commits always give the same vertices and edges.
//
// Commits arrive newest first. Each active lane waits for one commit (the parent that a drawn
// child points at). A commit takes the leftmost lane waiting for it; other lanes waiting for the
// same commit converge into it. Its first parent keeps the lane; every further parent (merge,
// octopus) opens a lane of its own, or joins a lane that already waits for that parent.
import { UNCOMMITTED, type Commit } from '../../shared/protocol'

/** A position in lane space: `row` is the commit row, `lane` the horizontal slot. */
export type LayoutPoint = { row: number; lane: number }

export type LayoutEdge = {
  /** Polyline in lane space. Consecutive points on different lanes lie on adjacent rows. */
  points: LayoutPoint[]
  /** Index into the colour palette (take it modulo the palette length). */
  colour: number
  /** Edge of the uncommitted row. */
  dashed: boolean
  /** The parent is not in the loaded list; the edge runs past the last row. */
  toBottom: boolean
}

export type LayoutVertex = {
  hash: string
  row: number
  lane: number
  colour: number
  merge: boolean
  head: boolean
  stash: boolean
  uncommitted: boolean
}

export type GraphLayout = {
  /** One vertex per commit, same order as the input. */
  vertices: LayoutVertex[]
  edges: LayoutEdge[]
  laneCount: number
  indexOf: Map<string, number>
}

export type LayoutOptions = {
  /** Draw only the first parent of every commit. */
  firstParentOnly?: boolean
}

type Lane = {
  /** Hash of the commit this lane is waiting for. */
  hash: string
  colour: number
  /** Row and lane where the pending edge started (at the child commit). */
  startRow: number
  startLane: number
  dashed: boolean
}

export function layoutGraph(commits: Commit[], head: string | null, options: LayoutOptions = {}): GraphLayout {
  const total = commits.length
  const indexOf = new Map<string, number>()
  commits.forEach((commit, row) => indexOf.set(commit.hash, row))

  const slots: (Lane | null)[] = []
  const vertices: LayoutVertex[] = []
  const edges: LayoutEdge[] = []
  let laneCount = 0
  let nextColour = 0

  const firstFree = (): number => {
    const free = slots.indexOf(null)
    return free === -1 ? slots.length : free
  }
  const pickColour = (): number => {
    const used = new Set<number>()
    for (const slot of slots) if (slot !== null) used.add(slot.colour)
    let colour = nextColour
    for (let tries = 0; tries < 64 && used.has(colour); tries++) colour++
    nextColour = colour + 1
    return colour
  }
  const occupy = (index: number, lane: Lane): void => {
    slots[index] = lane
    if (index + 1 > laneCount) laneCount = index + 1
  }

  /** Closes the pending edge of `lane` (sitting in slot `slot`) at row `endRow`, lane `endLane`. */
  const closeEdge = (lane: Lane, slot: number, endRow: number, endLane: number, toBottom: boolean): void => {
    const raw: LayoutPoint[] = [{ row: lane.startRow, lane: lane.startLane }]
    if (endRow === lane.startRow + 1) {
      raw.push({ row: endRow, lane: endLane })
    } else {
      if (lane.startLane !== slot) raw.push({ row: lane.startRow + 1, lane: slot })
      if (slot !== endLane) raw.push({ row: endRow - 1, lane: slot })
      raw.push({ row: endRow, lane: endLane })
    }
    const points = raw.filter((p, i) => i === 0 || p.row !== raw[i - 1].row || p.lane !== raw[i - 1].lane)
    edges.push({ points, colour: lane.colour, dashed: lane.dashed, toBottom })
  }

  for (let row = 0; row < total; row++) {
    const commit = commits[row]
    const uncommitted = commit.hash === UNCOMMITTED
    const stash = commit.stash !== undefined
    let parents = commit.parents
    if (uncommitted && parents.length === 0 && head !== null) parents = [head]
    // A stash commit's extra parents are its index/untracked helper commits, not history.
    if (stash || options.firstParentOnly) parents = parents.slice(0, 1)

    const matches: number[] = []
    slots.forEach((slot, index) => {
      if (slot !== null && slot.hash === commit.hash) matches.push(index)
    })

    let lane: number
    let colour: number
    if (matches.length === 0) {
      lane = firstFree()
      colour = pickColour()
    } else {
      lane = matches[0]
      colour = (slots[lane] as Lane).colour
    }
    for (const index of matches) {
      closeEdge(slots[index] as Lane, index, row, lane, false)
      slots[index] = null
    }
    if (lane + 1 > laneCount) laneCount = lane + 1

    parents.forEach((parent, k) => {
      const existing = slots.findIndex((slot) => slot !== null && slot.hash === parent)
      if (existing !== -1) {
        // The parent already has a lane: this line bends into it on the next row.
        const target = slots[existing] as Lane
        edges.push({
          points: [
            { row, lane },
            { row: row + 1, lane: existing }
          ],
          colour: k === 0 ? colour : target.colour,
          dashed: uncommitted,
          toBottom: false
        })
        return
      }
      const slot = k === 0 && slots[lane] == null ? lane : firstFree()
      occupy(slot, {
        hash: parent,
        colour: k === 0 ? colour : pickColour(),
        startRow: row,
        startLane: lane,
        dashed: uncommitted
      })
    })

    vertices.push({
      hash: commit.hash,
      row,
      lane,
      colour,
      merge: parents.length > 1,
      head: commit.hash === head,
      stash,
      uncommitted
    })
  }

  // Lanes still waiting for a commit that is not loaded run off the bottom.
  slots.forEach((slot, index) => {
    if (slot !== null) closeEdge(slot, index, total, index, true)
  })

  return { vertices, edges, laneCount, indexOf }
}
