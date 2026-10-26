'use client'

// Live agent reveal: an agent building over MCP plays the construction reveal in the open editor.
//
// The MCP server writes a bound scene and the editor hears each write on the scene's event stream. By default the
// editor swaps the whole graph in (a load: everything shows at once). With live reveal on, the write is diffed
// against the editor's scene and applied as one agent commit, so the reveal stages what the agent just made (walls
// rise, rooms come in, furniture drops), the same way it plays a build the in-editor agent makes. A building made
// by a script (a diagram turned into rooms, doors, stairs and a roof) can then be filmed as it goes up.
//
// On with `?reveal=live` in the project URL (or localStorage `pascal-live-reveal` = "1"). While on, the editor
// watches: it does not autosave over the agent's scene (the agent's writes are the source of truth).

import {
  type AnyNode,
  type AnyNodeId,
  isDerivedNode,
  runAsSceneCommitAuthor,
  useScene,
} from '@pascal-app/core'
import {
  type SceneGraph,
  useConstructionReveal,
  useConstructionRevealLevel,
} from '@pascal-app/editor'
import { ConstructionReveal } from '@pascal-app/viewer'

const STORAGE_KEY = 'pascal-live-reveal'

/** Whether this page plays an agent's live writes as a construction reveal. */
export function liveRevealEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (new URL(window.location.href).searchParams.get('reveal') === 'live') return true
    return window.localStorage?.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

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

  const create: { node: AnyNode; parentId?: AnyNodeId }[] = []
  const update: { id: AnyNodeId; data: Partial<AnyNode> }[] = []
  const remove: AnyNodeId[] = []

  const createdIds = Object.keys(remote)
    .filter((id) => !local[id as AnyNodeId] && !isDerivedNode(remote[id]))
    .sort((a, b) => depthOf(a, remote) - depthOf(b, remote))
  for (const id of createdIds) {
    const node = remote[id] as AnyNode
    const copy = ('children' in node ? { ...node, children: [] } : { ...node }) as AnyNode
    create.push({ node: copy, parentId: (node.parentId ?? undefined) as AnyNodeId | undefined })
  }
  for (const [id, node] of Object.entries(remote)) {
    const mine = local[id as AnyNodeId]
    if (!mine || isDerivedNode(node) || isDerivedNode(mine)) continue
    const a = JSON.stringify(withoutChildren(mine as unknown as Record<string, unknown>))
    const b = JSON.stringify(withoutChildren(node as unknown as Record<string, unknown>))
    if (a !== b) {
      update.push({
        id: id as AnyNodeId,
        data: withoutChildren(node as unknown as Record<string, unknown>) as Partial<AnyNode>,
      })
    }
  }
  for (const [id, node] of Object.entries(local)) {
    if (remote[id] || isDerivedNode(node)) continue
    // a subtree goes with its root
    if (node.parentId && !remote[node.parentId] && local[node.parentId as AnyNodeId]) continue
    remove.push(id as AnyNodeId)
  }
  if (!create.length && !update.length && !remove.length) return true
  runAsSceneCommitAuthor('agent', () => {
    useScene.getState().applyNodeChanges({ create, update, delete: remove })
  })
  return true
}

/** Mount in the viewer: stages the agent's commits at the person's construction level and animation speed. */
export function LiveAgentReveal() {
  const level = useConstructionRevealLevel()
  const speed = useConstructionReveal((state) => state.speed)
  return (
    <ConstructionReveal
      level={level === 'off' ? 'full' : level}
      reveals={(commit) => commit.author === 'agent'}
      speed={speed}
    />
  )
}
