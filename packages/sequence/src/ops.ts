import type { Ease, SeqKey, SeqTrack, SequenceNode } from './schema'

/** Two keys closer than this are the same key (a re-key replaces it). */
export const KEY_EPSILON = 1e-3

export type TrackRef = { target: string; channel: string }

export function trackIdFor(ref: TrackRef): string {
  return `trk_${ref.target}_${ref.channel.replace(/[^A-Za-z0-9]+/g, '_')}`
}

export function findTrack(seq: SequenceNode, ref: TrackRef): SeqTrack | undefined {
  return seq.tracks.find((t) => t.target === ref.target && t.channel === ref.channel)
}

/**
 * The sequence with a key at `f` on the track (created when missing), replacing a key at the same frame.
 * Pure: the input node is not changed. The host applies the same rule; this is for display before it answers.
 */
export function key(
  seq: SequenceNode,
  ref: TrackRef,
  f: number,
  v: unknown,
  e?: Ease,
): SequenceNode {
  const next: SeqKey = e === undefined ? { f, v } : { f, v, e }
  const existing = findTrack(seq, ref)
  const track: SeqTrack = existing ?? { id: trackIdFor(ref), ...ref, keys: [] }
  const keys = [...track.keys.filter((k) => Math.abs(k.f - f) >= KEY_EPSILON), next].sort(
    (a, b) => a.f - b.f,
  )
  const updated = { ...track, keys }
  return {
    ...seq,
    tracks: existing
      ? seq.tracks.map((t) => (t === existing ? updated : t))
      : [...seq.tracks, updated],
  }
}

/** The sequence without the key at `f` on the track. Unchanged (the same object) when there is none. */
export function unkey(seq: SequenceNode, ref: TrackRef, f: number): SequenceNode {
  const existing = findTrack(seq, ref)
  if (!existing?.keys.some((k) => Math.abs(k.f - f) < KEY_EPSILON)) return seq
  const updated = {
    ...existing,
    keys: existing.keys.filter((k) => Math.abs(k.f - f) >= KEY_EPSILON),
  }
  return { ...seq, tracks: seq.tracks.map((t) => (t === existing ? updated : t)) }
}

/** The host op for a key / an unkey. */
export function keyOp(seqId: string, ref: TrackRef, f: number, v: unknown, e?: Ease) {
  return {
    op: 'seq.key',
    seq: seqId,
    track: { target: ref.target, channel: ref.channel },
    f,
    v,
    ...(e === undefined ? {} : { e }),
  }
}

export function unkeyOp(seqId: string, ref: TrackRef, f: number) {
  return { op: 'seq.unkey', seq: seqId, track: { target: ref.target, channel: ref.channel }, f }
}

// ─── Ruler: frames ↔ pixels ────────────────────────────────────────────

export type Ruler = { range: readonly [number, number]; width: number; pad?: number }

/** The x of frame `f` on a ruler `width` px wide with `pad` px at each end. */
export function frameToX(f: number, { range, width, pad = 0 }: Ruler): number {
  const [f0, f1] = range
  const span = Math.max(1e-9, f1 - f0)
  return pad + ((f - f0) / span) * Math.max(0, width - 2 * pad)
}

/** The frame at `x`, clamped to the range and snapped to whole frames. */
export function xToFrame(x: number, { range, width, pad = 0 }: Ruler): number {
  const [f0, f1] = range
  const usable = Math.max(1e-9, width - 2 * pad)
  const f = f0 + ((x - pad) / usable) * (f1 - f0)
  return Math.min(f1, Math.max(f0, Math.round(f)))
}

/** Ruler ticks: a step from 1-2-5 × 10^n that leaves at least `minPx` between labels. */
export function rulerStep(ruler: Ruler, minPx = 60): number {
  const span = ruler.range[1] - ruler.range[0]
  const usable = Math.max(1, ruler.width - 2 * (ruler.pad ?? 0))
  const raw = (span * minPx) / usable
  const pow = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)))
  for (const m of [1, 2, 5, 10]) if (m * pow >= raw) return Math.max(1, m * pow)
  return Math.max(1, 10 * pow)
}
