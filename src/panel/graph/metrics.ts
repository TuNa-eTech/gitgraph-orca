export const ROW_HEIGHT = 24
export const LANE_WIDTH = 16
export const GRAPH_PAD = 12

export function laneX(lane: number): number {
  return GRAPH_PAD + lane * LANE_WIDTH
}

/** Natural width of the graph column for a layout with `laneCount` lanes. */
export function naturalGraphWidth(laneCount: number): number {
  return GRAPH_PAD * 2 + Math.max(0, laneCount - 1) * LANE_WIDTH
}
