// SVG drawing of the visible slice of a GraphLayout. The SVG sits over the table rows (which
// reserve the graph column); only vertices are interactive.
import { useMemo } from 'preact/hooks'
import type { JSX } from 'preact'
import type { GraphLayout, LayoutEdge, LayoutPoint } from './layout'
import { ROW_HEIGHT, laneX } from './metrics'

export type GraphProps = {
  layout: GraphLayout
  palette: string[]
  style: 'rounded' | 'angular'
  muteMerges: boolean
  width: number
  /** First and last (inclusive) row to draw. */
  firstRow: number
  lastRow: number
  selected: ReadonlySet<string>
  onVertexClick(row: number, e: MouseEvent): void
  onVertexContextMenu(row: number, e: MouseEvent): void
  onVertexHover(row: number | null, e?: MouseEvent): void
}

function edgePath(edge: LayoutEdge, offsetRow: number, rowCount: number, style: 'rounded' | 'angular'): string {
  const px = (p: LayoutPoint) => laneX(p.lane)
  const py = (p: LayoutPoint) => (p.row >= rowCount ? rowCount - offsetRow : p.row - offsetRow + 0.5) * ROW_HEIGHT
  const pts = edge.points
  let d = `M${px(pts[0])} ${py(pts[0])}`
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const x1 = px(a)
    const y1 = py(a)
    const x2 = px(b)
    const y2 = py(b)
    if (x1 === x2) d += `L${x2} ${y2}`
    else if (style === 'angular') d += `L${x2} ${y2}`
    else {
      const ym = (y1 + y2) / 2
      d += `C${x1} ${ym} ${x2} ${ym} ${x2} ${y2}`
    }
  }
  return d
}

export function Graph(props: GraphProps) {
  const { layout, palette, style, firstRow, lastRow } = props
  const rowCount = layout.vertices.length
  const colour = (i: number) => palette[i % palette.length]

  const edges = useMemo(
    () => layout.edges.filter((e) => e.points[e.points.length - 1].row >= firstRow && e.points[0].row <= lastRow),
    [layout, firstRow, lastRow]
  )

  const nodes: JSX.Element[] = []
  for (let row = firstRow; row <= lastRow && row < rowCount; row++) {
    const v = layout.vertices[row]
    const cx = laneX(v.lane)
    const cy = (row - firstRow + 0.5) * ROW_HEIGHT
    const stroke = colour(v.colour)
    const dim = props.muteMerges && v.merge && !v.stash ? 0.45 : 1
    const sel = props.selected.has(v.hash)
    let shape: JSX.Element
    if (v.uncommitted) {
      shape = <circle class="gg-v gg-v-uncommitted" cx={cx} cy={cy} r={4} stroke={stroke} fill="none" stroke-width={2} stroke-dasharray="2 2" />
    } else if (v.stash) {
      shape = (
        <rect
          class="gg-v gg-v-stash"
          x={cx - 4}
          y={cy - 4}
          width={8}
          height={8}
          rx={1}
          transform={`rotate(45 ${cx} ${cy})`}
          stroke={stroke}
          stroke-width={2}
          fill="var(--orca-background)"
        />
      )
    } else if (v.head) {
      shape = (
        <>
          <circle cx={cx} cy={cy} r={6} fill="none" stroke="var(--orca-foreground)" stroke-width={1.5} />
          <circle class="gg-v gg-v-head" cx={cx} cy={cy} r={4} fill={stroke} />
        </>
      )
    } else {
      shape = <circle class="gg-v" cx={cx} cy={cy} r={4} fill={stroke} opacity={dim} />
    }
    nodes.push(
      <g key={v.hash}>
        {sel && <circle cx={cx} cy={cy} r={8} fill="none" stroke="var(--orca-ring, var(--orca-primary))" stroke-width={1.5} />}
        {shape}
        <circle
          class="gg-hit"
          cx={cx}
          cy={cy}
          r={8}
          fill="transparent"
          onClick={(e) => props.onVertexClick(row, e as MouseEvent)}
          onContextMenu={(e) => props.onVertexContextMenu(row, e as MouseEvent)}
          onMouseEnter={(e) => props.onVertexHover(row, e as MouseEvent)}
          onMouseLeave={() => props.onVertexHover(null)}
        />
      </g>
    )
  }

  const height = Math.max(0, Math.min(lastRow, rowCount - 1) - firstRow + 1) * ROW_HEIGHT
  return (
    <svg
      class="gg-svg"
      width={props.width}
      height={height}
      style={{ top: `${firstRow * ROW_HEIGHT}px` }}
    >
      {edges.map((edge, i) => (
        <path
          key={i}
          d={edgePath(edge, firstRow, rowCount, style)}
          fill="none"
          stroke={colour(edge.colour)}
          stroke-width={2}
          stroke-linecap="round"
          stroke-dasharray={edge.dashed ? '3 3' : undefined}
          opacity={0.9}
        />
      ))}
      {nodes}
    </svg>
  )
}
