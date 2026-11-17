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

import { useConstructionReveal, useConstructionRevealLevel } from '@pascal-app/editor'
import { ConstructionReveal } from '@pascal-app/viewer'

// The graph diff that applies a remote write as the agent's commit lives with the scene-host sync now.
export { applyRemoteGraphAsAgent } from '@pascal-app/remote-scene'

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
