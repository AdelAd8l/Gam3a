import type { Block } from './api'
import { toMinutes } from './format'

/** Lay a day's blocks out in lanes: blocks that overlap in time go side by side. Each block gets
 * its lane and how many lanes its group of overlapping blocks needs. */
export function lanes(dayBlocks: Block[]) {
  const sorted = [...dayBlocks].sort((a, b) => toMinutes(a.start) - toMinutes(b.start) || toMinutes(b.end) - toMinutes(a.end))
  const out: { block: Block; lane: number; of: number }[] = []
  let group: { block: Block; lane: number; of: number }[] = []
  let groupEnd = -1
  let laneEnds: number[] = []
  const close = () => {
    const n = laneEnds.length
    for (const item of group) item.of = n
    out.push(...group)
  }
  for (const block of sorted) {
    const start = toMinutes(block.start)
    if (start >= groupEnd && group.length) {
      close()
      group = []
      laneEnds = []
    }
    let lane = laneEnds.findIndex((end) => end <= start)
    if (lane === -1) lane = laneEnds.push(0) - 1
    laneEnds[lane] = toMinutes(block.end)
    group.push({ block, lane, of: 1 })
    groupEnd = Math.max(groupEnd, toMinutes(block.end))
  }
  if (group.length) close()
  return out
}
