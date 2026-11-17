'use client'

import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef, useState } from 'react'
import { engineAdapter } from './adapter'
import { engineViewConfig, engineViewSrc } from './engine-view-config'
import { createBridge } from './transport'

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

/**
 * The docked engine page. It mounts only while the view is on screen, so no hidden GL context keeps
 * running; closing the view disposes the bridge and the iframe with it.
 */
export default function EngineView() {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [config] = useState(engineViewConfig)
  const [status, setStatus] = useState<'loading' | 'ready' | 'no-config'>(
    config ? 'loading' : 'no-config',
  )
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    if (config) setSrc(engineViewSrc(config, window.location.origin))
  }, [config])

  useEffect(() => {
    const frame = frameRef.current
    const c = config
    if (!(frame && c && src)) return
    const engineOrigin = new URL(c.engineUrl).origin
    const bridge = createBridge({
      target: { postMessage: (m, o) => frame.contentWindow?.postMessage(m, o) },
      targetOrigin: engineOrigin,
      allowOrigins: [engineOrigin],
    })
    engineAdapter.attach(bridge)

    // Selection both ways; remember what the engine sent so it is not echoed back.
    let fromEngine: string[] | null = null
    const pushSelection = () => {
      const ids = useViewer.getState().selection.selectedIds as string[]
      if (fromEngine && sameIds(fromEngine, ids)) return
      fromEngine = null
      engineAdapter.select(ids)
    }
    const offReady = engineAdapter.onReady(() => {
      setStatus('ready')
      pushSelection()
    })
    const offSelected = engineAdapter.onSelected((ids) => {
      fromEngine = ids
      useViewer.getState().setSelection({ selectedIds: ids as never })
    })
    const offViewer = useViewer.subscribe((state, prev) => {
      if (state.selection.selectedIds !== prev.selection.selectedIds) pushSelection()
    })
    const onLoad = () => {
      engineAdapter.hello(c.sceneUrl).catch(() => {
        // The engine also announces `ready` unasked once its scene loads.
      })
    }
    frame.addEventListener('load', onLoad)
    return () => {
      frame.removeEventListener('load', onLoad)
      offReady()
      offSelected()
      offViewer()
      engineAdapter.detach(bridge)
      bridge.dispose()
    }
  }, [config, src])

  if (status === 'no-config') {
    return (
      <div className="flex h-full w-full items-center justify-center p-6 text-center text-muted-foreground text-sm">
        No engine is configured for this editor. Open a scene from a scene host to dock its engine
        here.
      </div>
    )
  }
  return (
    <div className="relative h-full w-full bg-black">
      {src && (
        <iframe
          allow="fullscreen; xr-spatial-tracking"
          className="h-full w-full border-0"
          ref={frameRef}
          src={src}
          title="Engine"
        />
      )}
      {status !== 'ready' && (
        <div className="pointer-events-none absolute top-2 left-2 rounded bg-background/80 px-2 py-1 text-muted-foreground text-xs">
          Connecting to the engine…
        </div>
      )}
    </div>
  )
}
