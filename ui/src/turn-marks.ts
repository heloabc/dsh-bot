export interface RailMark {
  id: string
}

/** One tick per user line, and one per assistant turn. Later segments of the same turn share that tick. */
export function railMarks(segments: readonly { id: string; kind: string; turn?: number }[]): RailMark[] {
  const marks: RailMark[] = []
  const seenTurns = new Set<number>()
  for (const segment of segments) {
    if (segment.kind === 'user') {
      marks.push({ id: segment.id })
      continue
    }
    const turn = segment.turn ?? -1
    if (seenTurns.has(turn)) continue
    seenTurns.add(turn)
    marks.push({ id: `turn:${turn}` })
  }
  return marks
}
