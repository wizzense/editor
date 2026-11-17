import { BaseNode, nodeType } from '@pascal-app/core'
import { z } from 'zod'

const Vec3 = z.tuple([z.number(), z.number(), z.number()])

/** Eases between a key and the next. */
export const Ease = z.enum(['linear', 'smooth', 'in', 'out', 'step'])
export type Ease = z.infer<typeof Ease>

/**
 * One key. `f` is the absolute frame on the sequence clock (`fps`, may be fractional). `v` is the channel's
 * value: `{p, t, fov}` for `camera`, an `[dx, dy, dz]` offset in metres for `transform.position`.
 */
export const SeqKey = z.object({ f: z.number(), v: z.unknown(), e: Ease.optional() })
export type SeqKey = z.infer<typeof SeqKey>

export const SeqTrack = z.object({
  id: z.string(),
  /** The node the track animates. */
  target: z.string(),
  channel: z.string(),
  keys: z.array(SeqKey).default([]),
  muted: z.boolean().optional(),
  locked: z.boolean().optional(),
})
export type SeqTrack = z.infer<typeof SeqTrack>

export const SeqSection = z.object({ name: z.string(), f0: z.number(), f1: z.number() })
export type SeqSection = z.infer<typeof SeqSection>

/** A timeline over the scene: frames on one clock, named sections, and keyed tracks on nodes. */
export const SequenceNode = BaseNode.extend({
  id: z.string(),
  type: nodeType('seq:sequence'),
  kind: z.enum(['film', 'cutscene', 'loop']).default('film'),
  fps: z.number().positive().default(24),
  range: z.tuple([z.number(), z.number()]).default([1, 241]),
  sections: z.array(SeqSection).default([]),
  tracks: z.array(SeqTrack).default([]),
})
export type SequenceNode = z.infer<typeof SequenceNode>

/** A camera a sequence can key: where it is, what it looks at, its vertical field of view in degrees. */
export const SeqCameraNode = BaseNode.extend({
  id: z.string(),
  type: nodeType('seq:camera'),
  position: Vec3.default([0, 10, 10]),
  target: Vec3.default([0, 0, 0]),
  fov: z.number().positive().default(45),
})
export type SeqCameraNode = z.infer<typeof SeqCameraNode>

export const SEQUENCE_SCHEMA_VERSION = 1

/** The v1 load path for both kinds: missing fields take their defaults, and a key with no ease stays so. */
export function migrateSequence(raw: Record<string, unknown>): SequenceNode {
  return SequenceNode.parse(raw)
}

export function migrateSeqCamera(raw: Record<string, unknown>): SeqCameraNode {
  return SeqCameraNode.parse(raw)
}
