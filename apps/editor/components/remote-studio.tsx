'use client'

// The studio page: the whole editor on a scene host's document. The host is the one writer; this page loads
// its document, follows its event stream, sends every edit back as an op batch, and docks the engine that
// renders the same document beside the 3D and 2D views, with a timeline under them.

import { Editor, openEditorView, type SceneGraph, type SidebarTab } from '@pascal-app/editor'
import {
  createStorePort,
  RemoteSceneSync,
  setActiveSceneSync,
  toast,
} from '@pascal-app/remote-scene'
import { Hammer, Layers, Palette, Settings } from 'lucide-react'
import Image from 'next/image'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  configureEngineFor,
  FORK_PLUGIN_IDS,
  registerForkExtensions,
  sceneHostFromUrl,
} from '@/lib/fork-extensions'
import { BuildTab } from './build-tab'
import { PaintPanel } from './paint-panel'
import { EditorViewerToolbarLeft, EditorViewerToolbarRight } from './viewer-toolbar'

const icon = (src: string) => (
  <Image alt="" className="h-8 w-8 object-contain" height={32} src={src} width={32} />
)

const SIDEBAR_TABS: (SidebarTab & { component: React.ComponentType })[] = [
  {
    id: 'site',
    label: 'Scene',
    component: () => null,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Layers className="h-5 w-5" />,
    icon: icon('/icons/scene.webp'),
  },
  {
    id: 'build',
    label: 'Build',
    component: BuildTab,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Hammer className="h-5 w-5" />,
    icon: icon('/icons/build.webp'),
  },
  {
    id: 'paint',
    label: 'Paint',
    component: PaintPanel,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Palette className="h-5 w-5" />,
    icon: icon('/icons/paint.webp'),
  },
  {
    id: 'settings',
    label: 'Settings',
    component: () => null,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Settings className="h-5 w-5" />,
    icon: icon('/icons/settings.webp'),
  },
]

function sessionAuthorId(): string {
  const random =
    globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10)
  return `pascal:${random}`
}

export function RemoteStudio() {
  const syncRef = useRef<RemoteSceneSync | null>(null)
  const [title, setTitle] = useState('Scene host')
  const [status, setStatus] = useState<{ version: number; connected: boolean } | null>(null)
  const sceneUrl = sceneHostFromUrl()

  useEffect(() => {
    document.body.classList.add('dark')
    return () => {
      document.body.classList.remove('dark')
      syncRef.current?.stop()
      setActiveSceneSync(null)
    }
  }, [])

  const handleLoad = useCallback(async (): Promise<SceneGraph | null> => {
    if (!sceneUrl) throw new Error('Open this page with ?sceneHost=<scene document URL>')
    await registerForkExtensions()
    syncRef.current?.stop()
    const sync = new RemoteSceneSync({
      sceneUrl,
      author: { kind: 'human', id: sessionAuthorId() },
      port: createStorePort(),
      notify: toast,
      plugins: FORK_PLUGIN_IDS,
    })
    syncRef.current = sync
    const graph = await sync.load()
    setActiveSceneSync(sync)
    configureEngineFor(sceneUrl, sync.client.sceneId)
    const site = graph.rootNodeIds[0] ? graph.nodes[graph.rootNodeIds[0]] : undefined
    setTitle(typeof site?.name === 'string' ? site.name : sync.client.sceneId)
    sync.onStatus((s) => setStatus({ version: s.version, connected: s.connected }))
    // The editor applies the graph right after this resolves (a load, not an edit): follow the host from then on.
    setTimeout(() => {
      sync.start()
      openEditorView('engine', { beside: true })
    }, 0)
    return graph as unknown as SceneGraph
  }, [sceneUrl])

  // Edits leave as op batches the moment they are made; there is no document to autosave here.
  const handleSave = useCallback(async () => {}, [])

  return (
    <div className="dark relative h-screen w-screen">
      <Editor
        layoutVersion="v2"
        navbarSlot={
          <div className="flex items-center gap-2 px-3 text-sm">
            <span className="font-medium">{title}</span>
            {status && (
              <span
                className="font-mono text-muted-foreground text-xs"
                data-testid="studio-version"
              >
                v{status.version} {status.connected ? '· live' : '· offline'}
              </span>
            )}
            <button
              className="rounded-md border border-border px-2 py-0.5 text-xs hover:bg-accent"
              onClick={() => openEditorView('timeline', { beside: true })}
              type="button"
            >
              Timeline
            </button>
          </div>
        }
        onLoad={handleLoad}
        onSave={handleSave}
        projectId={`scene-host:${title}`}
        projectName={title}
        sidebarTabs={SIDEBAR_TABS}
        viewerToolbarLeft={<EditorViewerToolbarLeft />}
        viewerToolbarRight={<EditorViewerToolbarRight vrButton={null} vrLabel="Enter VR" />}
      />
    </div>
  )
}
