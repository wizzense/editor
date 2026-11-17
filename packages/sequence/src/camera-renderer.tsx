'use client'

import { useRegistry } from '@pascal-app/core'
import { createDefaultMaterial, useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { BufferGeometry, Float32BufferAttribute, type Group, LineBasicMaterial } from 'three'
import type { SeqCameraNode } from './schema'

const BODY = 0.6

/** A small frustum at the camera position, aimed at its target, with a line to the target. */
export default function SeqCameraRenderer({ node }: { node: SeqCameraNode }) {
  const ref = useRef<Group>(null!)
  const aim = useRef<Group>(null!)
  const shading = useViewer((state) => state.shading)
  const handlers = useNodeEvents(node as never, 'seq:camera' as never)
  useRegistry(node.id, 'seq:camera', ref)

  const material = useMemo(() => createDefaultMaterial('#f59e0b', 0.5, shading), [shading])
  const line = useMemo(() => {
    const geometry = new BufferGeometry()
    const [px, py, pz] = node.position
    const [tx, ty, tz] = node.target
    geometry.setAttribute(
      'position',
      new Float32BufferAttribute([0, 0, 0, tx - px, ty - py, tz - pz], 3),
    )
    return geometry
  }, [node.position, node.target])
  const lineMaterial = useMemo(() => new LineBasicMaterial({ color: '#f59e0b' }), [])

  useLayoutEffect(() => {
    // The frustum's cone points down -Z after lookAt: aim the group at the target in world space.
    aim.current?.lookAt(node.target[0], node.target[1], node.target[2])
  }, [node.target])

  const depth = BODY * 1.4
  const radius = Math.tan(((node.fov ?? 45) * Math.PI) / 360) * depth

  return (
    <group position={node.position} ref={ref} visible={node.visible !== false}>
      <group ref={aim}>
        <mesh position={[0, 0, -depth / 2]} rotation={[Math.PI / 2, Math.PI / 4, 0]} {...handlers}>
          <coneGeometry args={[radius * Math.SQRT2, depth, 4, 1, true]} />
          <primitive attach="material" object={material} />
        </mesh>
        <mesh position={[0, 0, BODY * 0.35]} {...handlers}>
          <boxGeometry args={[BODY * 0.7, BODY * 0.5, BODY * 0.7]} />
          <primitive attach="material" object={material} />
        </mesh>
      </group>
      <lineSegments geometry={line} material={lineMaterial} />
    </group>
  )
}
