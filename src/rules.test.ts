import { describe, expect, it } from 'vitest'
import {
  HIT_SLACK,
  arenaPhase,
  edgeAnchor,
  judgeHit,
  leaderIds,
  nearbyPoint,
  pickTimeWinner,
  placeMarker,
  poseAt,
  shouldAnchorToPeer,
} from './rules'

describe('leaderIds', () => {
  it('ignores a field of zeroes', () => {
    expect(
      leaderIds([
        { id: 'a', score: 0 },
        { id: 'b', score: 0 },
      ]),
    ).toEqual([])
  })

  it('returns everyone tied for the most kills', () => {
    expect(
      leaderIds([
        { id: 'a', score: 2 },
        { id: 'b', score: 4 },
        { id: 'c', score: 4 },
      ]),
    ).toEqual(['b', 'c'])
  })
})

describe('arenaPhase', () => {
  it('stays waiting until a remote ship exists', () => {
    expect(arenaPhase(0, false)).toBe('waiting')
  })

  it('switches to combat once a remote exists', () => {
    expect(arenaPhase(1, false)).toBe('combat')
  })

  it('ends over an active fight', () => {
    expect(arenaPhase(2, true)).toBe('ended')
  })
})

describe('shouldAnchorToPeer', () => {
  it('moves a newcomer toward an incumbent', () => {
    expect(
      shouldAnchorToPeer({
        selfId: 'bbb',
        peerId: 'aaa',
        selfAge: 0.4,
        peerAge: 12,
        hasThrust: false,
        didAnchor: false,
      }),
    ).toBe(true)
  })

  it('keeps the pilot who has been in the room', () => {
    expect(
      shouldAnchorToPeer({
        selfId: 'aaa',
        peerId: 'bbb',
        selfAge: 12,
        peerAge: 0.4,
        hasThrust: false,
        didAnchor: false,
      }),
    ).toBe(false)
  })

  it('lets the higher id move when both just joined', () => {
    expect(
      shouldAnchorToPeer({
        selfId: 'bbb',
        peerId: 'aaa',
        selfAge: 0.3,
        peerAge: 0.3,
        hasThrust: false,
        didAnchor: false,
      }),
    ).toBe(true)
    expect(
      shouldAnchorToPeer({
        selfId: 'aaa',
        peerId: 'bbb',
        selfAge: 0.3,
        peerAge: 0.3,
        hasThrust: false,
        didAnchor: false,
      }),
    ).toBe(false)
  })
})

describe('nearbyPoint', () => {
  it('lands near the anchor and inside the world', () => {
    const point = nearbyPoint({ x: 400, y: 400 }, [{ x: 400, y: 400 }], { w: 3200, h: 3200 }, () => 0.25)
    const dist = Math.hypot(point.x - 400, point.y - 400)
    expect(dist).toBeGreaterThan(260)
    expect(dist).toBeLessThan(700)
    expect(point.x).toBeGreaterThan(80)
    expect(point.y).toBeLessThan(3120)
  })
})

describe('judgeHit', () => {
  it('waits when the claim is close and the bullet has not arrived', () => {
    expect(
      judgeHit({
        px: 0,
        py: 0,
        claimX: 10,
        claimY: 0,
        radius: HIT_SLACK,
      }),
    ).toBe('pending')
  })

  it('rejects a claim far from the ship when no bullet exists', () => {
    expect(
      judgeHit({
        px: 0,
        py: 0,
        claimX: 400,
        claimY: 0,
        radius: HIT_SLACK,
      }),
    ).toBe('reject')
  })

  it('accepts when the simulated bullet is near the real ship', () => {
    expect(
      judgeHit({
        px: 100,
        py: 100,
        claimX: 100,
        claimY: 100,
        bulletX: 120,
        bulletY: 100,
        radius: HIT_SLACK,
      }),
    ).toBe('accept')
  })

  it('rejects a close claim whose bullet is elsewhere', () => {
    expect(
      judgeHit({
        px: 100,
        py: 100,
        claimX: 100,
        claimY: 100,
        bulletX: 900,
        bulletY: 100,
        radius: HIT_SLACK,
      }),
    ).toBe('reject')
  })
})

describe('poseAt', () => {
  const samples = [
    { t: 1, x: 0, y: 0, angle: 0, vx: 100, vy: 0 },
    { t: 1.2, x: 40, y: 0, angle: Math.PI / 2, vx: 100, vy: 0 },
  ]

  it('holds the first snapshot before the buffer delay elapses', () => {
    expect(poseAt(samples, 0.5)).toEqual({ x: 0, y: 0, angle: 0 })
  })

  it('blends between snapshots', () => {
    const pose = poseAt(samples, 1.1)
    expect(pose!.x).toBeGreaterThan(0)
    expect(pose!.x).toBeLessThan(40)
    expect(pose!.angle).toBeGreaterThan(0)
    expect(pose!.angle).toBeLessThan(Math.PI / 2)
  })

  it('extrapolates at most a short step past the latest snapshot', () => {
    const pose = poseAt(samples, 2, 0.05)
    expect(pose!.x).toBeCloseTo(40 + 100 * 0.05)
    expect(pose!.y).toBe(0)
  })
})

describe('edgeAnchor', () => {
  const bounds = { left: 20, top: 20, right: 200, bottom: 120 }

  it('hides the marker when the target is on screen', () => {
    expect(edgeAnchor({ x: 100, y: 70 }, { x: 140, y: 80 }, bounds)).toBeNull()
  })

  it('sits on the right edge when the target is to the right', () => {
    const hit = edgeAnchor({ x: 100, y: 70 }, { x: 400, y: 70 }, bounds)
    expect(hit!.x).toBe(200)
    expect(hit!.y).toBeCloseTo(70)
    expect(hit!.angle).toBeCloseTo(0)
  })

  it('passes through a corner when the target is diagonally off screen', () => {
    const hit = edgeAnchor({ x: 100, y: 70 }, { x: 400, y: -200 }, bounds)
    expect(hit!.x).toBeGreaterThan(bounds.left)
    expect(hit!.y).toBe(bounds.top)
  })
})

describe('placeMarker', () => {
  it('sits above a ship when that space is clear', () => {
    const spot = placeMarker({
      x: 100,
      y: 100,
      textWidth: 40,
      textHeight: 14,
      gap: 50,
      obstacles: [{ x: 100, y: 100, r: 36 }],
    })
    expect(spot.baseline).toBeLessThan(100 - 36)
    expect(Math.hypot(spot.x - 100, spot.baseline - 100)).toBeGreaterThan(36)
  })

  it('moves aside when another ship occupies the space above', () => {
    const spot = placeMarker({
      x: 100,
      y: 100,
      textWidth: 48,
      textHeight: 16,
      gap: 40,
      obstacles: [
        { x: 100, y: 100, r: 30 },
        { x: 100, y: 40, r: 30 },
      ],
    })
    const hitsUpper = Math.hypot(spot.x - 100, (spot.baseline - 8) - 40) < 30
    expect(hitsUpper).toBe(false)
  })
})

describe('pickTimeWinner', () => {
  it('names the higher score', () => {
    expect(
      pickTimeWinner([
        { id: 'a', name: 'Vega', score: 1 },
        { id: 'b', name: 'Nyx', score: 3 },
      ]),
    ).toMatchObject({ id: 'b', tied: false })
  })

  it('flags an even score', () => {
    expect(
      pickTimeWinner([
        { id: 'a', name: 'Vega', score: 2 },
        { id: 'b', name: 'Nyx', score: 2 },
      ]).tied,
    ).toBe(true)
  })
})
