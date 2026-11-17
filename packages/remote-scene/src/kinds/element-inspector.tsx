'use client'

import { engineAdapter, type RoleInfo } from '@pascal-app/engine-bridge'
import { useEffect, useState } from 'react'
import { activeSceneSync } from '../active'
import type { ExtElementNode } from './ext-element-schema'

function propsOf(node: ExtElementNode): Record<string, unknown> {
  const props = node.payload?.props
  return props && typeof props === 'object' ? (props as Record<string, unknown>) : {}
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-mono" title={value}>
        {value}
      </span>
    </div>
  )
}

/**
 * The inspector for a host-owned element: what it is (read-only) and its role. A role change is sent to the
 * host as an op; the field shows the new role when the host's event comes back, not before.
 */
export default function ElementInspector({ node }: { node: ExtElementNode }) {
  const props = propsOf(node)
  const role = typeof props.role === 'string' ? props.role : ''
  const [roles, setRoles] = useState<RoleInfo[] | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    const load = () =>
      engineAdapter
        .describe()
        .then((d) => live && setRoles(d.roles))
        .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)))
    load()
    const off = engineAdapter.onReady(() => {
      setError(null)
      load()
    })
    return () => {
      live = false
      off()
    }
  }, [])

  useEffect(() => {
    if (pending !== null && pending === role) setPending(null)
  }, [pending, role])

  const choose = async (next: string) => {
    const sync = activeSceneSync()
    if (!sync || next === role) return
    setPending(next)
    const result = await sync.postOps([
      { op: 'node.update', id: node.id, patch: { payload: { props: { role: next } } } },
    ])
    if (!result.ok) setPending(null)
  }

  const options = roles ?? []
  const known = options.some((r) => r.id === role)
  return (
    <div className="flex flex-col gap-1 px-3 py-2">
      <Row label="Kind" value={node.kind || '—'} />
      <Row label="Id" value={String(node.payload?.id ?? node.id)} />
      <Row label="Label" value={String(props.label ?? '—')} />
      <Row label="Step" value={String(props.step ?? '—')} />
      <label className="mt-2 flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">Role</span>
        <select
          className="rounded-md border border-border bg-background px-2 py-1 text-xs"
          disabled={!roles || pending !== null}
          onChange={(e) => void choose(e.target.value)}
          value={role}
        >
          {!known && <option value={role}>{role || '—'}</option>}
          {options.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      {pending !== null && (
        <span className="text-muted-foreground text-xs">Sending to the host…</span>
      )}
      {!roles && !error && <span className="text-muted-foreground text-xs">Loading roles…</span>}
      {error && <span className="text-muted-foreground text-xs">Roles: {error}</span>}
    </div>
  )
}
