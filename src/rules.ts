export const KILL_LIMIT = 5
export const MATCH_SECONDS = 180
export const INTERP_DELAY = 0.1
export const MAX_EXTRAP = 0.05
/** Slack around the victim's real position. Covers a couple of frames of bullet drift. */
export const HIT_SLACK = 48
export const SPAWN_NEAR_MIN = 340
export const SPAWN_NEAR_MAX = 620

export type MotionSample = {
  t: number
  x: number
  y: number
  angle: number
  vx: number
  vy: number
}

export type Vec = { x: number; y: number }

export type WorldBox = { w: number; h: number }

export function leaderIds(players: { id: string; score: number }[]): string[] {
  let max = 0
  for (const p of players) if (p.score > max) max = p.score
  if (max <= 0) return []
  return players.filter((p) => p.score === max).map((p) => p.id)
}

export function arenaPhase(
  remoteCount: number,
  matchOver: boolean,
): 'waiting' | 'combat' | 'ended' {
  if (matchOver) return 'ended'
  if (remoteCount > 0) return 'combat'
  return 'waiting'
}

/** Newcomer moves next to someone already placed. Incumbents stay put. */
export function shouldAnchorToPeer(input: {
  selfId: string
  peerId: string
  selfAge: number
  peerAge: number
  hasThrust: boolean
  didAnchor: boolean
}): boolean {
  if (input.didAnchor || input.hasThrust) return false
  if (input.selfAge > 2.5) return false
  if (input.peerAge <= 2.5 && input.selfId < input.peerId) return false
  return true
}

export function nearbyPoint(
  anchor: Vec,
  avoid: Vec[],
  world: WorldBox,
  rand: () => number,
): Vec {
  const margin = 80
  for (let i = 0; i < 24; i++) {
    const ang = rand() * Math.PI * 2
    const dist = SPAWN_NEAR_MIN + rand() * (SPAWN_NEAR_MAX - SPAWN_NEAR_MIN)
    const x = clamp(anchor.x + Math.cos(ang) * dist, margin, world.w - margin)
    const y = clamp(anchor.y + Math.sin(ang) * dist, margin, world.h - margin)
    const separated = avoid.every((a) => Math.hypot(a.x - x, a.y - y) > 200)
    const fromAnchor = Math.hypot(x - anchor.x, y - anchor.y)
    if (separated && fromAnchor > 260) return { x, y }
  }
  return {
    x: clamp(anchor.x + 420, margin, world.w - margin),
    y: clamp(anchor.y, margin, world.h - margin),
  }
}

export function judgeHit(input: {
  px: number
  py: number
  claimX: number
  claimY: number
  bulletX?: number
  bulletY?: number
  radius: number
}): 'accept' | 'pending' | 'reject' {
  const bulletKnown = input.bulletX != null && input.bulletY != null
  if (!bulletKnown) {
    const claimNear =
      Math.hypot(input.claimX - input.px, input.claimY - input.py) <= input.radius
    return claimNear ? 'pending' : 'reject'
  }
  const bulletNear =
    Math.hypot(input.bulletX! - input.px, input.bulletY! - input.py) <= input.radius
  return bulletNear ? 'accept' : 'reject'
}

export function poseAt(
  samples: MotionSample[],
  renderTime: number,
  maxExtrap = MAX_EXTRAP,
): { x: number; y: number; angle: number } | null {
  if (samples.length === 0) return null
  const first = samples[0]!
  if (renderTime <= first.t) {
    return { x: first.x, y: first.y, angle: first.angle }
  }
  const last = samples[samples.length - 1]!
  if (renderTime >= last.t) {
    const extra = Math.min(maxExtrap, Math.max(0, renderTime - last.t))
    return {
      x: last.x + last.vx * extra,
      y: last.y + last.vy * extra,
      angle: last.angle,
    }
  }
  let i = 0
  while (i < samples.length - 1 && samples[i + 1]!.t < renderTime) i++
  const a = samples[i]!
  const b = samples[i + 1]!
  const span = b.t - a.t || 1
  const u = (renderTime - a.t) / span
  const s = u * u * (3 - 2 * u)
  let da = b.angle - a.angle
  while (da > Math.PI) da -= Math.PI * 2
  while (da < -Math.PI) da += Math.PI * 2
  return {
    x: a.x + (b.x - a.x) * s,
    y: a.y + (b.y - a.y) * s,
    angle: a.angle + da * s,
  }
}

export type ScreenRect = { left: number; top: number; right: number; bottom: number }

/**
 * Point on the inset screen rectangle where a ray from the local pilot
 * toward an off-screen target hits the edge. Null when the target is inside.
 * The hit slides along edges and through corners as the direction changes.
 */
export function edgeAnchor(
  origin: Vec,
  target: Vec,
  bounds: ScreenRect,
): { x: number; y: number; angle: number } | null {
  if (
    target.x >= bounds.left &&
    target.x <= bounds.right &&
    target.y >= bounds.top &&
    target.y <= bounds.bottom
  ) {
    return null
  }

  const ox = clamp(origin.x, bounds.left + 1, bounds.right - 1)
  const oy = clamp(origin.y, bounds.top + 1, bounds.bottom - 1)
  const dx = target.x - origin.x
  const dy = target.y - origin.y
  if (dx === 0 && dy === 0) return null

  let bestT = Infinity
  let hx = ox
  let hy = oy

  if (dx !== 0) {
    for (const ex of [bounds.left, bounds.right]) {
      const t = (ex - ox) / dx
      if (t <= 0) continue
      const y = oy + t * dy
      if (y >= bounds.top && y <= bounds.bottom && t < bestT) {
        bestT = t
        hx = ex
        hy = y
      }
    }
  }
  if (dy !== 0) {
    for (const ey of [bounds.top, bounds.bottom]) {
      const t = (ey - oy) / dy
      if (t <= 0) continue
      const x = ox + t * dx
      if (x >= bounds.left && x <= bounds.right && t < bestT) {
        bestT = t
        hx = x
        hy = ey
      }
    }
  }

  if (!Number.isFinite(bestT)) return null
  return { x: hx, y: hy, angle: Math.atan2(dy, dx) }
}

export function pickTimeWinner(players: { id: string; name: string; score: number }[]): {
  id: string
  name: string
  tied: boolean
} {
  const first = players[0]
  if (!first) return { id: '', name: '', tied: false }
  let best = first
  let tied = false
  for (const p of players.slice(1)) {
    if (p.score > best.score) {
      best = p
      tied = false
    } else if (p.score === best.score) {
      tied = true
    }
  }
  return { id: best.id, name: best.name, tied }
}

function rectHitsCircle(
  cx: number,
  baseline: number,
  textWidth: number,
  textHeight: number,
  obstacles: { x: number; y: number; r: number }[],
): boolean {
  const left = cx - textWidth / 2
  const right = cx + textWidth / 2
  const top = baseline - textHeight
  const bottom = baseline
  for (const s of obstacles) {
    const px = clamp(s.x, left, right)
    const py = clamp(s.y, top, bottom)
    if (Math.hypot(px - s.x, py - s.y) < s.r) return true
  }
  return false
}

/** Bottom-center of a label, kept off every ship disc. Prefers straight above. */
export function placeMarker(input: {
  x: number
  y: number
  textWidth: number
  textHeight: number
  gap: number
  obstacles: { x: number; y: number; r: number }[]
}): { x: number; baseline: number } {
  const dirs = [
    { x: 0, y: -1 },
    { x: 0.85, y: -0.7 },
    { x: -0.85, y: -0.7 },
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
  ]
  for (const dir of dirs) {
    const len = Math.hypot(dir.x, dir.y) || 1
    for (let dist = input.gap; dist <= input.gap + 72; dist += 12) {
      const cx = input.x + (dir.x / len) * dist
      const baseline = input.y + (dir.y / len) * dist
      if (
        !rectHitsCircle(cx, baseline, input.textWidth, input.textHeight, input.obstacles)
      ) {
        return { x: cx, baseline }
      }
    }
  }
  return { x: input.x, baseline: input.y - input.gap - 48 }
}

export function safeColor(color: string, fallback = '#00f0ff'): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : fallback
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}
