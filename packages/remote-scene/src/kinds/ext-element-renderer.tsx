'use client'

import {
  type AnyNodeId,
  useLiveNodeOverrides,
  useLiveTransforms,
  useRegistry,
} from '@pascal-app/core'
import { createDefaultMaterial, useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useMemo, useRef } from 'react'
import { CatmullRomCurve3, type Group, Vector3 } from 'three'
import { extElementExtents } from './ext-element'
import type { ExtElementNode } from './ext-element-schema'

/**
 * The proxy for a host-owned element: a box from `size`, or a tube along `pts`, coloured `color`. The host
 * draws the real thing in the engine view; this is what the editor selects, moves and snaps.
 */
export default function ExtElementRenderer({ node }: { node: ExtElementNode }) {
  const ref = useRef<Group>(null!)
  const liveOverride = useLiveNodeOverrides((state) => state.get(node.id as AnyNodeId))
  const effective = useMemo(
    () => (liveOverride ? ({ ...node, ...liveOverride } as ExtElementNode) : node),
    [node, liveOverride],
  )
  const liveTransform = useLiveTransforms((state) => state.get(node.id))
  const shading = useViewer((state) => state.shading)
  const handlers = useNodeEvents(node as never, 'ext:element' as never)
  useRegistry(node.id, 'ext:element', ref)

  const material = useMemo(
    () => createDefaultMaterial(effective.color || '#9ca3af', 0.8, shading),
    [effective.color, shading],
  )

  const tube = useMemo(() => {
    const pts = effective.pts
    if (!pts || pts.length < 2) return null
    // Points are absolute; draw them relative to the node position so a move carries the line.
    const [ox, oy, oz] = effective.position
    const curve = new CatmullRomCurve3(
      pts.map((p) => new Vector3(p[0] - ox, p[1] - oy, p[2] - oz)),
      false,
      'centripetal',
      0,
    )
    return { curve, segments: Math.min(256, pts.length * 4) }
  }, [effective.pts, effective.position])

  const [sx, sy, sz] = extElementExtents(effective)
  const position = liveTransform?.position ?? effective.position
  const rotationY = liveTransform?.rotation ?? effective.rotation[1]

  return (
    <group
      position={position}
      ref={ref}
      rotation={[effective.rotation[0], rotationY, effective.rotation[2]]}
      visible={effective.visible !== false}
    >
      {tube ? (
        <mesh {...handlers}>
          <tubeGeometry args={[tube.curve, tube.segments, 0.15, 6, false]} />
          <primitive attach="material" object={material} />
        </mesh>
      ) : (
        <mesh position={[0, sy / 2, 0]} {...handlers}>
          <boxGeometry args={[sx, sy, sz]} />
          <primitive attach="material" object={material} />
        </mesh>
      )}
    </group>
  )
}
