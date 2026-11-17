import type { NodeOp, SceneNode } from './ops'

export type DiffOptions = {
  /** Nodes the editor derives itself (never sent). */
  isDerived?: (node: SceneNode) => boolean
}

export type DiffResult = {
  ops: NodeOp[]
  /** Local changes the host does not take from a node diff (they are reverted). */
  refused: string[]
}

/** Kinds whose edits leave through their own ops (the timeline posts seq ops), never as a node diff. */
const OWN_OPS_PREFIX = 'seq:'
const HOST_OWNED = 'ext:element'
/** The only field of a host-owned element the editor may move; the rest is derived from its row. */
const HOST_OWNED_EDITABLE = ['position'] as const

function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const bb = b as unknown[]
    return a.length === bb.length && a.every((v, i) => equal(v, bb[i]))
  }
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  return ka.every((k) =>
    equal((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  )
}

function depth(id: string, nodes: Record<string, SceneNode>): number {
  let d = 0
  let cursor = nodes[id]
  const seen = new Set<string>()
  while (cursor?.parentId && !seen.has(cursor.id)) {
    seen.add(cursor.id)
    d++
    cursor = nodes[cursor.parentId]
  }
  return d
}

/**
 * The op batch that turns `before` into `current`, by node id: creates (parents first), then updates (only
 * the top-level fields that changed), then deletes. Undo and redo are commits like any other, so they
 * diff the same way.
 */
export function diffNodesToOps(
  before: Record<string, SceneNode>,
  current: Record<string, SceneNode>,
  options: DiffOptions = {},
): DiffResult {
  const isDerived = options.isDerived ?? (() => false)
  const creates: NodeOp[] = []
  const updates: NodeOp[] = []
  const deletes: NodeOp[] = []
  const refused: string[] = []
  const skip = (node: SceneNode) => node.type.startsWith(OWN_OPS_PREFIX) || isDerived(node)

  const created = Object.keys(current)
    .filter((id) => !before[id])
    .sort((a, b) => depth(a, current) - depth(b, current))
  for (const id of created) {
    const node = current[id] as SceneNode
    if (skip(node)) continue
    if (node.type === HOST_OWNED) {
      refused.push(id)
      continue
    }
    creates.push({ op: 'node.create', node })
  }

  for (const [id, node] of Object.entries(current)) {
    const prev = before[id]
    if (!prev || prev === node || skip(node)) continue
    const keys = new Set([...Object.keys(prev), ...Object.keys(node)])
    const patch: Record<string, unknown> = {}
    let refusedField = false
    for (const key of keys) {
      // The host keeps `children` from `parentId`; sending it would race other writers' creates.
      if (key === 'children' || equal(prev[key], node[key])) continue
      if (node.type === HOST_OWNED && !(HOST_OWNED_EDITABLE as readonly string[]).includes(key)) {
        refusedField = true
        continue
      }
      // A removed field is sent as null so the host's deep merge clears it.
      patch[key] = key in node ? node[key] : null
    }
    if (refusedField) refused.push(id)
    if (Object.keys(patch).length > 0) updates.push({ op: 'node.update', id, patch })
  }

  // Children before parents: correct whether or not the host cascades a delete.
  const deleted = Object.keys(before)
    .filter((id) => !current[id])
    .sort((a, b) => depth(b, before) - depth(a, before))
  for (const id of deleted) {
    const node = before[id] as SceneNode
    if (skip(node)) continue
    if (node.type === HOST_OWNED) {
      refused.push(id)
      continue
    }
    deletes.push({ op: 'node.delete', id })
  }

  return { ops: [...creates, ...updates, ...deletes], refused }
}
