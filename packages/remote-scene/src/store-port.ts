import {
  type AnyNode,
  isApplyingRemoteSceneChange,
  isDerivedNode,
  isRestoringSceneHistory,
  subscribeSceneCommits,
  useScene,
} from '@pascal-app/core'
import { applyRemoteNodes, isApplyingRemoteNodes } from './apply'
import type { SceneNode } from './ops'
import type { ScenePort } from './sync'

type Nodes = Record<string, SceneNode>

const storeNodes = () => useScene.getState().nodes as unknown as Nodes

/**
 * The sync's view of the editor's scene store. Local changes are diffed from the last state the host and the
 * editor agreed on, so an edit, an undo and a redo all leave the same way, and nothing the host sent is sent
 * back.
 */
export function createStorePort(): ScenePort {
  let lastKnown: Nodes = storeNodes()
  return {
    nodes: storeNodes,
    isDerived: (node) => isDerivedNode(node as unknown as AnyNode),
    applyNodes(nodes, scope) {
      applyRemoteNodes(nodes, scope)
      lastKnown = storeNodes()
    },
    subscribeLocalCommits(fn) {
      lastKnown = storeNodes()
      const emit = (current: Nodes) => {
        if (current === lastKnown) return
        const before = lastKnown
        lastKnown = current
        fn(before, current)
      }
      const offCommits = subscribeSceneCommits((commit) => {
        const current = commit.current.nodes as unknown as Nodes
        if (commit.origin !== 'local' || isApplyingRemoteNodes() || isApplyingRemoteSceneChange()) {
          lastKnown = current
          return
        }
        emit(current)
      })
      // Undo and redo rewrite the store without a commit: diff them after the jump settles.
      const offTemporal = useScene.temporal.subscribe(() => {
        if (!isRestoringSceneHistory()) return
        queueMicrotask(() => emit(storeNodes()))
      })
      return () => {
        offCommits()
        offTemporal()
      }
    },
  }
}
