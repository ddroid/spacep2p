export type Vec2 = { x: number; y: number }

export type PlayerState = {
  id: string
  name: string
  color: string
  x: number
  y: number
  vx: number
  vy: number
  angle: number
  hp: number
  maxHp: number
  score: number
  alive: boolean
  thrusting: boolean
  boosting: boolean
  seq: number
  t: number
}

export type Bullet = {
  id: string
  ownerId: string
  x: number
  y: number
  vx: number
  vy: number
  life: number
  color: string
}

export type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  color: string
  glow?: boolean
}

export type Star = {
  x: number
  y: number
  z: number
  size: number
  twinkle: number
}

/** Wire formats (JSON-serializable) */

export type HelloMsg = {
  name: string
  color: string
  score: number
}

export type StateMsg = {
  x: number
  y: number
  vx: number
  vy: number
  angle: number
  hp: number
  score: number
  alive: boolean
  thrusting: boolean
  boosting: boolean
  seq: number
  t: number
}

export type FireMsg = {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  t: number
}

export type HitMsg = {
  targetId: string
  bulletId: string
  damage: number
  x: number
  y: number
}

export type KillMsg = {
  killerId: string
  victimId: string
  killerName: string
  victimName: string
}

export type RemotePlayer = PlayerState & {
  /** For interpolation */
  fromX: number
  fromY: number
  fromAngle: number
  toX: number
  toY: number
  toAngle: number
  fromT: number
  toT: number
  lastSeen: number
}
