import { BaseNode, nodeType } from '@pascal-app/core'
import { z } from 'zod'

const Vec3 = z.tuple([z.number(), z.number(), z.number()])

/**
 * An element owned by an external document (a level or plan row the scene host keeps). `payload` is the
 * external row verbatim; `position`, `rotation`, `size`, `pts` and `color` are derived from it by the host on
 * every write, and the editor only draws them. An edit leaves as an op the host rewrites into its own verbs.
 */
export const ExtElementNode = BaseNode.extend({
  id: z.string(),
  type: nodeType('ext:element'),
  /** Which external system owns the element. */
  ext: z.string().default(''),
  /** The element kind in that system. */
  kind: z.string().default(''),
  payload: z.record(z.string(), z.unknown()).default({}),
  position: Vec3.default([0, 0, 0]),
  rotation: Vec3.default([0, 0, 0]),
  /** Box extents [x, y, z] in metres; null draws a marker. */
  size: Vec3.nullable().default(null),
  /** A polyline (rails, wires) in the editor frame; null for boxes. */
  pts: z.array(Vec3).nullable().default(null),
  color: z.string().default('#9ca3af'),
})

export type ExtElementNode = z.infer<typeof ExtElementNode>

export const EXT_ELEMENT_SCHEMA_VERSION = 1

/**
 * The v1 load path: rows written before a field existed (or by a host that omits nulls) load with the
 * defaults, and a scalar Y rotation becomes the vector form.
 */
export function migrateExtElement(raw: Record<string, unknown>): ExtElementNode {
  const rotation = raw.rotation
  const next = typeof rotation === 'number' ? { ...raw, rotation: [0, rotation, 0] } : { ...raw }
  return ExtElementNode.parse(next)
}
