import {
  type AnyNode,
  type AnyNodeId,
  isDerivedNode,
  pauseSceneHistory,
  resumeSceneHistory,
  runAsSceneCommitAuthor,
  useScene,
} from '@pascal-app/core'
import type { SceneGraph } from '@pascal-app/editor'

function withoutChildren(node: Record<string, unknown>): Record<string, unknown> {
  const { children: _children, ...rest } = node
  return rest
}

function depthOf(id: string, nodes: Record<string, AnyNode>): number {
  let depth = 0
  let cursor = nodes[id as AnyNodeId]
  const seen = new Set<string>()
  while (cursor?.parentId && !seen.has(cursor.id)) {
    seen.add(cursor.id)
    depth++
    cursor = nodes[cursor.parentId as AnyNodeId]
  }
  return depth
}

type NodeChanges = {
  create: { node: AnyNode; parentId?: AnyNodeId }[]
  update: { id: AnyNodeId; data: Partial<AnyNode> }[]
  delete: AnyNodeId[]
}

/**
 * The changes that bring the editor's nodes to `remote` for the ids in `scope` (every remote id and every
 * local id when `scope` is 'all'; otherwise only the listed ids, where a null remote value deletes).
 */
function changesTo(
  remote: Record<string, AnyNode | null>,
  local: Record<string, AnyNode>,
  scope: 'all' | 'listed',
): NodeChanges {
  const present = Object.fromEntries(
    Object.entries(remote).filter(([, node]) => node !== null),
  ) as Record<string, AnyNode>
  const lookup = { ...local, ...present }
  const changes: NodeChanges = { create: [], update: [], delete: [] }

  const createdIds = Object.keys(present)
    .filter((id) => !local[id as AnyNodeId] && !isDerivedNode(present[id] as AnyNode))
    .sort((a, b) => depthOf(a, lookup) - depthOf(b, lookup))
  for (const id of createdIds) {
    const node = present[id] as AnyNode
    const copy = ('children' in node ? { ...node, children: [] } : { ...node }) as AnyNode
    changes.create.push({
      node: copy,
      parentId: (node.parentId ?? undefined) as AnyNodeId | undefined,
    })
  }
  for (const [id, node] of Object.entries(present)) {
    const mine = local[id as AnyNodeId]
    if (!mine || isDerivedNode(node) || isDerivedNode(mine)) continue
    const a = JSON.stringify(withoutChildren(mine as unknown as Record<string, unknown>))
    const b = JSON.stringify(withoutChildren(node as unknown as Record<string, unknown>))
    if (a !== b) {
      changes.update.push({
        id: id as AnyNodeId,
        data: withoutChildren(node as unknown as Record<string, unknown>) as Partial<AnyNode>,
      })
    }
  }
  const deleteIds =
    scope === 'all'
      ? Object.keys(local).filter((id) => !present[id])
      : Object.keys(remote).filter((id) => remote[id] === null && local[id as AnyNodeId])
  for (const id of deleteIds) {
    const node = local[id as AnyNodeId] as AnyNode
    if (isDerivedNode(node)) continue
    // a subtree goes with its root
    if (node.parentId && deleteIds.includes(node.parentId) && local[node.parentId as AnyNodeId])
      continue
    changes.delete.push(id as AnyNodeId)
  }
  return changes
}

const isEmpty = (c: NodeChanges) => !(c.create.length || c.update.length || c.delete.length)

/**
 * Apply a remote graph as the difference from the editor's scene, authored by the agent. Returns false when there is
 * nothing to diff against (an empty editor: the caller loads the graph the usual way).
 */
export function applyRemoteGraphAsAgent(graph: SceneGraph | null | undefined): boolean {
  const remote = (graph?.nodes ?? {}) as Record<string, AnyNode>
  const state = useScene.getState()
  const local = state.nodes as Record<string, AnyNode>
  if (Object.keys(local).length === 0 || Object.keys(remote).length === 0) return false
  // Node ids are shared with the server, so the scaffold (site, building, first level) must be the same one.
  const rootsShared = (graph?.rootNodeIds ?? []).some((id) => local[id as AnyNodeId])
  if (!rootsShared) return false

  // Scene materials first: a node painted with a custom finish refers to one (scene:mat_…), and without it the
  // editor (and the GLB it exports) falls back to the default finish.
  const remoteMaterials = (graph?.materials ?? {}) as Record<string, unknown>
  for (const [id, material] of Object.entries(remoteMaterials)) {
    const mine = (state.materials as Record<string, unknown>)[id]
    if (!mine) useScene.getState().addSceneMaterial(material as never)
    else if (JSON.stringify(mine) !== JSON.stringify(material))
      useScene.getState().updateSceneMaterial(id as never, material as never)
  }

  const changes = changesTo(remote, local, 'all')
  if (isEmpty(changes)) return true
  runAsSceneCommitAuthor('agent', () => {
    useScene.getState().applyNodeChanges(changes)
  })
  return true
}

let applyingRemote = 0

/** Whether the scene is being written by {@link applyRemoteNodes} (a sync must not send it back). */
export function isApplyingRemoteNodes(): boolean {
  return applyingRemote > 0
}

/**
 * Bring the listed nodes to the host's state (null = deleted) as a collaborator's change: it is not recorded in
 * this editor's undo history and is not sent back. Idempotent: nodes already in that state are left alone.
 * With `scope: 'all'`, every local node missing from `nodes` is deleted too (a full reload).
 */
export function applyRemoteNodes(
  nodes: Record<string, unknown>,
  scope: 'all' | 'listed' = 'listed',
): boolean {
  const local = useScene.getState().nodes as Record<string, AnyNode>
  const changes = changesTo(nodes as Record<string, AnyNode | null>, local, scope)
  if (isEmpty(changes)) return false
  applyingRemote++
  pauseSceneHistory(useScene)
  try {
    runAsSceneCommitAuthor('agent', () => useScene.getState().applyNodeChanges(changes))
  } finally {
    resumeSceneHistory(useScene)
    applyingRemote--
  }
  return true
}
