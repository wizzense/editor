import { describe, expect, test } from 'bun:test'
import {
  frameToX,
  key,
  migrateSequence,
  rulerStep,
  type SequenceNode,
  unkey,
  xToFrame,
} from './index'

const seq = (): SequenceNode =>
  migrateSequence({
    id: 'seq_a',
    type: 'seq:sequence',
    fps: 24,
    range: [1, 361],
    sections: [{ name: 'part01', f0: 1, f1: 361 }],
    tracks: [
      {
        id: 'trk_cam',
        target: 'cam_a',
        channel: 'camera',
        keys: [
          { f: 1, v: { p: [0, 1, 2], t: [0, 0, 0], fov: 45 } },
          { f: 361, v: { p: [5, 1, 2], t: [0, 0, 0], fov: 45 } },
        ],
      },
    ],
  })

describe('ruler', () => {
  const ruler = { range: [1, 361] as const, width: 744, pad: 12 }

  test('frame and pixel map onto each other across the padded width', () => {
    expect(frameToX(1, ruler)).toBe(12)
    expect(frameToX(361, ruler)).toBe(732)
    expect(frameToX(181, ruler)).toBe(372)
    for (const f of [1, 2, 100, 160, 200, 360, 361])
      expect(xToFrame(frameToX(f, ruler), ruler)).toBe(f)
  })

  test('pixels outside the ruler clamp to its range', () => {
    expect(xToFrame(-50, ruler)).toBe(1)
    expect(xToFrame(5000, ruler)).toBe(361)
  })

  test('tick steps are 1-2-5 multiples that keep labels apart', () => {
    expect(rulerStep(ruler, 60)).toBe(50)
    expect(rulerStep({ range: [1, 25], width: 2000 }, 60)).toBe(1)
  })
})

describe('key / unkey', () => {
  test('key adds a sorted key without touching the input', () => {
    const before = seq()
    const frozen = structuredClone(before)
    const after = key(
      before,
      { target: 'cam_a', channel: 'camera' },
      200,
      { p: [1, 1, 1], t: [0, 0, 0], fov: 40 },
      'smooth',
    )
    expect(before).toEqual(frozen)
    expect(after.tracks[0]?.keys.map((k) => k.f)).toEqual([1, 200, 361])
    expect(after.tracks[0]?.keys[1]?.e).toBe('smooth')
  })

  test('a key within 1e-3 of an existing one replaces it', () => {
    const once = key(seq(), { target: 'cam_a', channel: 'camera' }, 1.0004, 'x')
    expect(once.tracks[0]?.keys.map((k) => [k.f, k.v])).toEqual([
      [1.0004, 'x'],
      [361, { p: [5, 1, 2], t: [0, 0, 0], fov: 45 }],
    ])
  })

  test('keying a new target creates its track', () => {
    const after = key(seq(), { target: 'el_a', channel: 'transform.position' }, 100, [0, 0, 0])
    const track = after.tracks.find((t) => t.target === 'el_a')
    expect(track).toEqual({
      id: 'trk_el_a_transform_position',
      target: 'el_a',
      channel: 'transform.position',
      keys: [{ f: 100, v: [0, 0, 0] }],
    })
  })

  test('unkey removes only that key, and is a no-op (same object) when there is none', () => {
    const s = seq()
    expect(unkey(s, { target: 'cam_a', channel: 'camera' }, 50)).toBe(s)
    const after = unkey(s, { target: 'cam_a', channel: 'camera' }, 1)
    expect(after.tracks[0]?.keys.map((k) => k.f)).toEqual([361])
    expect(s.tracks[0]?.keys).toHaveLength(2)
  })
})
