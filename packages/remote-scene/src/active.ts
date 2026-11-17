import type { RemoteSceneSync } from './sync'

let active: RemoteSceneSync | null = null
const listeners = new Set<(sync: RemoteSceneSync | null) => void>()

/** The sync the editor's panels post through (one scene host per editor page). */
export function activeSceneSync(): RemoteSceneSync | null {
  return active
}

export function setActiveSceneSync(sync: RemoteSceneSync | null): void {
  active = sync
  for (const fn of listeners) fn(sync)
}

export function onActiveSceneSync(fn: (sync: RemoteSceneSync | null) => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
