import type { AnyNodeDefinition, HandleDescriptor, NodeDefinition } from '@pascal-app/core'
import { EXT_ELEMENT_SCHEMA_VERSION, ExtElementNode } from './ext-element-schema'

const MARKER = 0.6
const MOVE_FRONT_OFFSET = 0.35

export function extElementExtents(node: ExtElementNode): [number, number, number] {
  if (node.size) return [node.size[0], node.size[1], node.size[2]]
  if (node.pts && node.pts.length > 1) {
    const xs = node.pts.map((p) => p[0])
    const ys = node.pts.map((p) => p[1])
    const zs = node.pts.map((p) => p[2])
    return [
      Math.max(0.2, Math.max(...xs) - Math.min(...xs)),
      Math.max(0.2, Math.max(...ys) - Math.min(...ys)),
      Math.max(0.2, Math.max(...zs) - Math.min(...zs)),
    ]
  }
  return [MARKER, MARKER, MARKER]
}

/** The same front-edge move grip the spawn point and items use. */
function moveHandle(): HandleDescriptor<ExtElementNode> {
  return {
    kind: 'translate',
    placement: {
      position: (n) => [0, 0.02, (n.pts ? 0 : extElementExtents(n)[2] / 2) + MOVE_FRONT_OFFSET],
    },
    apply: (_n, pos) => ({ position: [pos[0], pos[1], pos[2]] }),
    snapExtents: (n) => {
      const [x, , z] = extElementExtents(n)
      return [x, z]
    },
  }
}

export const extElementDefinition: NodeDefinition<typeof ExtElementNode> = {
  kind: 'ext:element',
  schemaVersion: EXT_ELEMENT_SCHEMA_VERSION,
  schema: ExtElementNode,
  category: 'site',
  snapProfile: 'item',
  // The host owns these rows and rebuilds them from its own data: nothing to bake or rebuild per frame.
  dirtyTracking: false,

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    ext: '',
    kind: '',
    payload: {},
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    size: null,
    pts: null,
    color: '#9ca3af',
  }),

  capabilities: {
    movable: { axes: ['x', 'z'], gridSnap: true },
    selectable: { hitVolume: 'bbox' },
    // Elements are created and removed by their owner (the host), not by duplicating here.
    duplicable: false,
    deletable: false,
    presettable: false,
    dragBounds: (node) => ({ size: extElementExtents(node as unknown as ExtElementNode) }),
  },

  handles: [moveHandle()],
  // No editable fields of its own (they derive from the host row): the kind owns its inspector card.
  parametrics: { groups: [], customPanel: () => import('./element-panel') },

  renderer: { kind: 'parametric', module: () => import('./ext-element-renderer') },

  presentation: {
    label: 'External element',
    description:
      'An element owned by a scene host. Its geometry is a proxy derived from the host row.',
    icon: { kind: 'iconify', name: 'lucide:box' },
    paletteSection: 'structure',
    hidden: true,
  },

  mcp: {
    description:
      'An element owned by an external scene host (payload = its row verbatim). Move it with position; other edits go through the host.',
  },
} as NodeDefinition<typeof ExtElementNode>

export const extElementNodeDefinition = extElementDefinition as unknown as AnyNodeDefinition
