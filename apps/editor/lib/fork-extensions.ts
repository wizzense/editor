// Fork extensions: the scene-host studio (a docked engine view, a timeline, and live sync with a scene host).
// Inert unless NEXT_PUBLIC_PASCAL_FORK_EXT=1. Everything it adds is an additive package; the only upstream
// touch point is the import of this file in bootstrap.ts.

import { loadPlugin, nodeRegistry, type Plugin, useScene } from '@pascal-app/core'
import { registerEditorHostView } from '@pascal-app/editor'
import { configureEngineView, engineHostView } from '@pascal-app/engine-bridge'
import { REMOTE_SCENE_PLUGIN_ID, remoteScenePlugin } from '@pascal-app/remote-scene'
import { SEQUENCE_PLUGIN_ID, sequencePlugin, timelineHostView } from '@pascal-app/sequence'

/** Whether this build carries the fork extensions. */
export const forkExtensionsEnabled = process.env.NEXT_PUBLIC_PASCAL_FORK_EXT === '1'

/** The page that edits a scene host's document. */
export const STUDIO_PATH = '/studio'

/** Plugin ids a scene host's document needs installed. */
export const FORK_PLUGIN_IDS = [REMOTE_SCENE_PLUGIN_ID, SEQUENCE_PLUGIN_ID]

const DEFAULT_ENGINE_VIEW_PATH = '/site/{scene}?scene={scene}&embed=1&bridge=1&parent={parent}'

let registered: Promise<void> | null = null

async function loadOnce(plugin: Plugin): Promise<void> {
  if ((plugin.nodes ?? []).every((def) => nodeRegistry.has(def.kind))) return
  await loadPlugin(plugin)
}

/** Registers the extension kinds and views (once). Resolves when the kinds can be loaded. */
export function registerForkExtensions(): Promise<void> {
  if (!forkExtensionsEnabled) return Promise.resolve()
  if (!registered) {
    registerEditorHostView(engineHostView)
    registerEditorHostView(timelineHostView)
    registered = Promise.all([loadOnce(remoteScenePlugin), loadOnce(sequencePlugin)]).then(() => {})
  }
  return registered
}

/** The scene host document URL from `?sceneHost=`, when the page was opened on one. */
export function sceneHostFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const value = new URL(window.location.href).searchParams.get('sceneHost')
    return value ? new URL(value).toString() : null
  } catch {
    return null
  }
}

/** Points the Engine view at the engine that serves `sceneUrl`'s scene. */
export function configureEngineFor(sceneUrl: string, sceneId: string): void {
  const engineUrl = process.env.NEXT_PUBLIC_PASCAL_ENGINE_URL
  if (!engineUrl) return
  configureEngineView({
    engineUrl,
    sceneId,
    sceneUrl,
    pathTemplate: process.env.NEXT_PUBLIC_PASCAL_ENGINE_VIEW_PATH || DEFAULT_ENGINE_VIEW_PATH,
  })
}

if (forkExtensionsEnabled) {
  void registerForkExtensions()
  // Dev inspection, like `__pascalNodeRegistry` in bootstrap: lets a browser check drive the store as a tool does.
  if (process.env.NODE_ENV !== 'production' && typeof globalThis !== 'undefined') {
    ;(globalThis as { __pascalSceneStore?: typeof useScene }).__pascalSceneStore = useScene
  }
  // A scene host link may land on the project list: the studio page is where its scene opens.
  if (typeof window !== 'undefined' && window.location.pathname === '/' && sceneHostFromUrl()) {
    window.location.replace(`${STUDIO_PATH}${window.location.search}`)
  }
}
