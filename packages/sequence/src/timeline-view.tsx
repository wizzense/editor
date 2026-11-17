'use client'

import { useScene } from '@pascal-app/core'
import { engineAdapter } from '@pascal-app/engine-bridge'
import { activeSceneSync, onActiveSceneSync, toast } from '@pascal-app/remote-scene'
import { useViewer } from '@pascal-app/viewer'
import { type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { frameToX, keyOp, type Ruler, rulerStep, unkeyOp, xToFrame } from './ops'
import type { Ease, SeqTrack, SequenceNode } from './schema'

const EASES: Ease[] = ['linear', 'smooth', 'in', 'out', 'step']
const PAD = 12
const ROW = 22
const SCRUB_INTERVAL_MS = 100

type SelectedKey = { track: SeqTrack; f: number }

function useSequence(): SequenceNode | null {
  return useScene((state) => {
    for (const node of Object.values(state.nodes)) {
      if ((node as { type: string }).type === 'seq:sequence') return node as unknown as SequenceNode
    }
    return null
  })
}

function useCameraId(): string | null {
  return useScene((state) => {
    for (const node of Object.values(state.nodes)) {
      if ((node as { type: string }).type === 'seq:camera') return node.id as string
    }
    return null
  })
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(600)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 600))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

/** Sends at most one `time` every 100 ms while scrubbing, and always the last one. */
function useThrottledTime(seqId: string | undefined) {
  const last = useRef(0)
  const pending = useRef<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  return useCallback(
    (f: number) => {
      if (!seqId) return
      const now = Date.now()
      const wait = SCRUB_INTERVAL_MS - (now - last.current)
      if (wait <= 0) {
        last.current = now
        engineAdapter.time(seqId, f)
        return
      }
      pending.current = f
      if (timer.current) return
      timer.current = setTimeout(() => {
        timer.current = null
        last.current = Date.now()
        if (pending.current !== null) engineAdapter.time(seqId, pending.current)
        pending.current = null
      }, wait)
    },
    [seqId],
  )
}

function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className="rounded-md border border-border px-2 py-1 font-medium text-xs hover:bg-accent disabled:opacity-40"
      type="button"
      {...props}
    />
  )
}

/**
 * The Timeline view: section bands, a frame ruler and a scrub head that drives the docked engine, one row of
 * key diamonds per track, and the keying, play and save controls. Every key change is an op to the host; the
 * view redraws when the host's event brings the sequence back.
 */
export default function TimelineView() {
  const seq = useSequence()
  const cameraId = useCameraId()
  const selectedIds = useViewer((s) => s.selection.selectedIds as string[])
  const selectedNode = useScene((s) =>
    selectedIds[0] ? (s.nodes as Record<string, { type: string }>)[selectedIds[0]] : undefined,
  )
  const [rulerRef, width] = useWidth<HTMLDivElement>()
  const [playhead, setPlayhead] = useState<number>(seq?.range[0] ?? 1)
  const [playing, setPlaying] = useState(false)
  const [ease, setEase] = useState<Ease>('smooth')
  const [offset, setOffset] = useState<[number, number, number]>([0, 0, 0])
  const [selectedKey, setSelectedKey] = useState<SelectedKey | null>(null)
  const [wrote, setWrote] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [, setSyncTick] = useState(0)
  const sendTime = useThrottledTime(seq?.id)

  useEffect(() => onActiveSceneSync(() => setSyncTick((n) => n + 1)), [])
  useEffect(
    () =>
      engineAdapter.onTick((f, isPlaying) => {
        setPlayhead(f)
        setPlaying(isPlaying)
      }),
    [],
  )

  const ruler: Ruler = useMemo(
    () => ({ range: seq?.range ?? [1, 241], width, pad: PAD }),
    [seq?.range, width],
  )
  const step = rulerStep(ruler)
  const ticks = useMemo(() => {
    const out: number[] = []
    const [f0, f1] = ruler.range
    for (let f = Math.ceil(f0 / step) * step; f <= f1; f += step) out.push(f)
    return out
  }, [ruler.range, step])

  const scrubTo = (clientX: number, el: HTMLElement) => {
    const f = xToFrame(clientX - el.getBoundingClientRect().left, ruler)
    setPlayhead(f)
    sendTime(f)
  }
  const onScrubDown = (e: PointerEvent<HTMLDivElement>) => {
    if (playing) return
    e.currentTarget.setPointerCapture(e.pointerId)
    scrubTo(e.clientX, e.currentTarget)
  }
  const onScrubMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.buttons & 1 && !playing) scrubTo(e.clientX, e.currentTarget)
  }

  const post = async (ops: Record<string, unknown>[]) => {
    const sync = activeSceneSync()
    if (!sync) {
      toast('No scene host is connected.', 'error')
      return false
    }
    setBusy(true)
    try {
      const result = await sync.postOps(ops as never)
      return result.ok
    } finally {
      setBusy(false)
    }
  }

  const keyCamera = async () => {
    if (!(seq && cameraId)) return
    try {
      const pose = await engineAdapter.pose()
      await post([keyOp(seq.id, { target: cameraId, channel: 'camera' }, playhead, pose, ease)])
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const selectedElementId = selectedNode?.type === 'ext:element' ? (selectedIds[0] as string) : null
  const keySelected = async () => {
    if (!(seq && selectedElementId)) return
    await post([
      keyOp(
        seq.id,
        { target: selectedElementId, channel: 'transform.position' },
        playhead,
        offset,
        ease,
      ),
    ])
  }

  const deleteKey = async () => {
    if (!(seq && selectedKey)) return
    const { track, f } = selectedKey
    if (await post([unkeyOp(seq.id, { target: track.target, channel: track.channel }, f)]))
      setSelectedKey(null)
  }
  // The window listener calls the latest closure (seq and the selected key change between renders).
  const deleteKeyRef = useRef(deleteKey)
  deleteKeyRef.current = deleteKey

  useEffect(() => {
    if (!selectedKey) return
    const deleteKey = () => deleteKeyRef.current()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return
      e.preventDefault()
      e.stopPropagation()
      void deleteKey()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [selectedKey])

  const play = () => {
    if (!seq) return
    const from = playhead >= seq.range[1] ? seq.range[0] : playhead
    const section = seq.sections.find((s) => from >= s.f0 && from < s.f1)
    engineAdapter.play(seq.id, from, section?.f1 ?? seq.range[1])
    setPlaying(true)
  }
  const stop = async () => {
    try {
      setPlayhead(await engineAdapter.stop())
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'error')
    }
    setPlaying(false)
  }
  const save = async () => {
    const sync = activeSceneSync()
    if (!sync) return
    setBusy(true)
    try {
      const result = await sync.save()
      if (result.ok) setWrote(result.wrote ?? [])
      else toast(`Save failed: ${result.error ?? 'unknown'}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!seq) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-muted-foreground text-sm">
        This scene has no sequence.
      </div>
    )
  }

  const engineReady = engineAdapter.isReady()
  return (
    <div className="flex h-full w-full flex-col gap-2 overflow-hidden bg-background p-2 text-foreground">
      <div className="flex flex-wrap items-center gap-2">
        {playing ? (
          <Button aria-label="Stop" onClick={() => void stop()}>
            ■ Stop
          </Button>
        ) : (
          <Button aria-label="Play" disabled={!engineReady} onClick={play}>
            ▶ Play
          </Button>
        )}
        <label className="flex items-center gap-1 font-mono text-xs">
          f
          <input
            aria-label="Frame"
            className="w-16 rounded border border-border bg-background px-1 py-0.5 text-xs"
            data-testid="timeline-frame"
            disabled={playing}
            max={seq.range[1]}
            min={seq.range[0]}
            onChange={(e) => {
              const f = Number(e.target.value)
              if (!Number.isFinite(f)) return
              const clamped = Math.min(seq.range[1], Math.max(seq.range[0], f))
              setPlayhead(clamped)
              sendTime(clamped)
            }}
            type="number"
            value={Math.round(playhead * 10) / 10}
          />
          <span className="text-muted-foreground">{(playhead / seq.fps).toFixed(2)} s</span>
        </label>
        <Button disabled={busy || !engineReady || !cameraId} onClick={() => void keyCamera()}>
          Key camera here
        </Button>
        <span className="flex items-center gap-1 text-xs">
          offset
          {(['x', 'y', 'z'] as const).map((axis, i) => (
            <input
              aria-label={`offset ${axis}`}
              className="w-12 rounded border border-border bg-background px-1 py-0.5 text-xs"
              key={axis}
              onChange={(e) => {
                const next = [...offset] as [number, number, number]
                next[i] = Number(e.target.value) || 0
                setOffset(next)
              }}
              step={0.5}
              type="number"
              value={offset[i]}
            />
          ))}
        </span>
        <Button disabled={busy || !selectedElementId} onClick={() => void keySelected()}>
          Key selected
        </Button>
        <select
          aria-label="Ease"
          className="rounded-md border border-border bg-background px-1 py-1 text-xs"
          onChange={(e) => setEase(e.target.value as Ease)}
          value={ease}
        >
          {EASES.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
        <Button disabled={busy} onClick={() => void save()}>
          Save
        </Button>
        {selectedKey && (
          <Button disabled={busy} onClick={() => void deleteKey()}>
            Delete key f {selectedKey.f}
          </Button>
        )}
        {!engineReady && (
          <span className="text-muted-foreground text-xs">Open the Engine view to play.</span>
        )}
      </div>

      <div
        className="relative h-9 shrink-0 cursor-ew-resize select-none border-border border-b"
        data-testid="timeline-ruler"
        onPointerDown={onScrubDown}
        onPointerMove={onScrubMove}
        ref={rulerRef}
      >
        {seq.sections.map((s, i) => (
          <div
            className={`absolute top-0 h-4 overflow-hidden border-border border-r px-1 text-[10px] text-muted-foreground ${i % 2 ? 'bg-muted/40' : 'bg-muted/70'}`}
            key={`${s.name}-${s.f0}`}
            style={{
              left: frameToX(s.f0, ruler),
              width: frameToX(s.f1, ruler) - frameToX(s.f0, ruler),
            }}
            title={`${s.name}: f ${s.f0}–${s.f1}`}
          >
            {s.name}
          </div>
        ))}
        {ticks.map((f) => (
          <div
            className="absolute top-4 h-5 border-border border-l pl-0.5 text-[10px] text-muted-foreground"
            key={f}
            style={{ left: frameToX(f, ruler) }}
          >
            {f}
          </div>
        ))}
        <div
          className="pointer-events-none absolute top-0 h-full w-px bg-red-500"
          style={{ left: frameToX(playhead, ruler) }}
        />
      </div>

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {seq.tracks.map((track, row) => (
          <div
            className="relative border-border/50 border-b"
            key={track.id}
            style={{ height: ROW }}
            title={`${track.target} · ${track.channel}`}
          >
            <span className="pointer-events-none absolute top-0.5 left-1 z-0 text-[10px] text-muted-foreground">
              {track.target} · {track.channel}
            </span>
            {track.keys.map((k) => {
              const isSelected =
                selectedKey?.track.id === track.id && Math.abs(selectedKey.f - k.f) < 1e-3
              return (
                <button
                  aria-label={`key ${track.channel} f ${k.f}`}
                  className={`absolute z-10 h-3 w-3 -translate-x-1/2 rotate-45 border ${isSelected ? 'border-white bg-amber-400' : 'border-amber-200 bg-amber-600'}`}
                  key={`${row}-${k.f}`}
                  onClick={() => {
                    setSelectedKey({ track, f: k.f })
                    setPlayhead(k.f)
                    sendTime(k.f)
                  }}
                  style={{ left: frameToX(k.f, ruler), top: (ROW - 12) / 2 }}
                  title={`f ${k.f}${k.e ? ` · ${k.e}` : ''}`}
                  type="button"
                />
              )
            })}
            <div
              className="pointer-events-none absolute top-0 h-full w-px bg-red-500/60"
              style={{ left: frameToX(playhead, ruler) }}
            />
          </div>
        ))}
      </div>

      {wrote && (
        <div className="max-h-20 overflow-y-auto rounded border border-border p-1 font-mono text-[10px]">
          <div className="text-muted-foreground">Saved {wrote.length} file(s):</div>
          {wrote.map((path) => (
            <div key={path}>{path}</div>
          ))}
        </div>
      )}
    </div>
  )
}
