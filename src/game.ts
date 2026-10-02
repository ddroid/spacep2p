import type { InputState } from './input'
import type { NetSession } from './net'
import { selfId } from './net'
import {
  formatArenaStatus,
  type ArenaStatusView,
} from './hudPresenters'
import {
  HIT_SLACK,
  INTERP_DELAY,
  KILL_LIMIT,
  MATCH_SECONDS,
  arenaPhase,
  edgeAnchor,
  judgeHit,
  leaderIds,
  nearbyPoint,
  pickTimeWinner,
  placeMarker,
  poseAt,
  safeColor,
  shouldAnchorToPeer,
} from './rules'
import type {
  Bullet,
  FireMsg,
  HelloMsg,
  HitMsg,
  KillMsg,
  OverMsg,
  Particle,
  PlayerState,
  RemotePlayer,
  Star,
  StateMsg,
  Vec2,
} from './types'

export const ARENA_CAPACITY = 4

export const WORLD = { w: 3200, h: 3200 }
const SHIP_R = 16
const BULLET_SPEED = 620
const BULLET_LIFE = 1.15
const FIRE_COOLDOWN = 0.18
const MAX_HP = 100
const THRUST = 520
const BOOST_THRUST = 920
const DRAG = 1.8
const MAX_SPEED = 420
const MAX_BOOST_SPEED = 680
const BOOST_DRAIN = 0.45
const BOOST_REGEN = 0.28
const RESPAWN_TIME = 2.8
const STATE_HZ = 20
const HIT_DAMAGE = 22
const SHIP_HIT_R = 18
const DRONE_HP = 44
const DRONE_R = 18

const PILOT_COLORS = [
  '#00f0ff',
  '#ff2d95',
  '#b8ff3c',
  '#ff9f1c',
  '#a78bfa',
  '#38bdf8',
  '#fb7185',
  '#facc15',
]

export type EdgeHint = {
  id: string
  x: number
  y: number
  angle: number
  color: string
  leader: boolean
}

export type GameUI = {
  setRoomCode: (code: string) => void
  setPeerCount: (n: number) => void
  setArenaStatus: (status: ArenaStatusView) => void
  setHp: (hp: number, max: number) => void
  setBoost: (boost: number) => void
  setScoreboard: (rows: { name: string; score: number; self: boolean; color: string }[]) => void
  pushKill: (text: string) => void
  toast: (text: string) => void
  setRespawn: (show: boolean, text?: string) => void
  setEdgeHints: (hints: EdgeHint[]) => void
  setMatchResult: (show: boolean, title?: string, detail?: string) => void
  onArenaFull: () => void
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

function len(x: number, y: number) {
  return Math.hypot(x, y)
}

function norm(x: number, y: number): Vec2 {
  const l = len(x, y) || 1
  return { x: x / l, y: y / l }
}

function colorForId(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return PILOT_COLORS[h % PILOT_COLORS.length]!
}

function makeStars(n: number): Star[] {
  const stars: Star[] = []
  for (let i = 0; i < n; i++) {
    stars.push({
      x: Math.random() * WORLD.w,
      y: Math.random() * WORLD.h,
      z: 0.25 + Math.random() * 0.75,
      size: 0.6 + Math.random() * 1.8,
      twinkle: Math.random() * Math.PI * 2,
    })
  }
  return stars
}

function spawnPos(avoid: Vec2[]): Vec2 {
  for (let tries = 0; tries < 40; tries++) {
    const p = {
      x: 200 + Math.random() * (WORLD.w - 400),
      y: 200 + Math.random() * (WORLD.h - 400),
    }
    if (avoid.every((a) => len(a.x - p.x, a.y - p.y) > 280)) return p
  }
  return { x: WORLD.w / 2, y: WORLD.h / 2 }
}

export class Game {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private input: InputState
  private net: NetSession
  private ui: GameUI
  private name: string
  private color: string

  private me: PlayerState
  private remotes = new Map<string, RemotePlayer>()
  private bullets: Bullet[] = []
  private particles: Particle[] = []
  private stars: Star[]
  private cam = { x: 0, y: 0 }
  private boostFuel = 1
  private fireCd = 0
  private respawnIn = 0
  private seq = 0
  private stateAcc = 0
  private bulletSeq = 0
  private running = false
  private raf = 0
  private lastT = 0
  private time = 0
  private dpr = 1
  private onResize: () => void
  private processedHits = new Set<string>()
  private announced = new Set<string>()
  private pendingHellos = new Map<string, HelloMsg>()
  private ignored = new Set<string>()
  private didAnchor = false
  private hasThrust = false
  private matchLeft = MATCH_SECONDS
  private matchOver = false
  private announcedEnd = false
  private endDetail = ''
  private lastClockSec = -1
  private awarded = new Set<string>()
  private seenKills = new Set<string>()
  private claims = new Map<string, { bulletId: string; name: string; until: number }>()
  private pendingHits: { from: string; msg: HitMsg; until: number }[] = []
  private drone: {
    x: number
    y: number
    angle: number
    hp: number
    alive: boolean
    respawnIn: number
  } | null = null

  constructor(
    canvas: HTMLCanvasElement,
    input: InputState,
    net: NetSession,
    ui: GameUI,
    name: string,
  ) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.input = input
    this.net = net
    this.ui = ui
    this.name = name.slice(0, 16) || 'Pilot'
    this.color = colorForId(selfId)
    this.stars = makeStars(220)

    const pos = spawnPos([])
    this.me = {
      id: selfId,
      name: this.name,
      color: this.color,
      x: pos.x,
      y: pos.y,
      vx: 0,
      vy: 0,
      angle: -Math.PI / 2,
      hp: MAX_HP,
      maxHp: MAX_HP,
      score: 0,
      alive: true,
      thrusting: false,
      boosting: false,
      seq: 0,
      t: 0,
    }

    this.onResize = () => this.resize()
    window.addEventListener('resize', this.onResize)
    this.resize()

    this.ui.setRoomCode(net.roomId)
    this.ui.setArenaStatus(formatArenaStatus({ phase: 'scanning' }))
    this.ui.setHp(this.me.hp, this.me.maxHp)
    this.ui.setBoost(this.boostFuel)
    this.refreshScoreboard()
  }

  start() {
    this.running = true
    this.lastT = performance.now()
    // Introduce ourselves after a tick so actions are registered
    this.net.sendHello({
      name: this.name,
      color: this.color,
      score: this.me.score,
      age: this.time,
    })
    this.refreshArenaStatus()
    this.loop(this.lastT)
  }

  stop() {
    this.running = false
    cancelAnimationFrame(this.raf)
    window.removeEventListener('resize', this.onResize)
    this.ui.setEdgeHints([])
    this.ui.setMatchResult(false)
  }

  /** Network handlers — called from main */

  onPeerJoin(peerId: string) {
    if (this.ignored.has(peerId)) return
    if (this.remotes.size + 1 >= ARENA_CAPACITY) {
      this.ignored.add(peerId)
      this.net.sendFull(peerId, ARENA_CAPACITY)
      return
    }
    this.net.sendHello(
      { name: this.name, color: this.color, score: this.me.score, age: this.time },
      peerId,
    )
    this.sendStateNow()
  }

  onPeerLeave(peerId: string) {
    this.ignored.delete(peerId)
    this.pendingHellos.delete(peerId)
    const r = this.remotes.get(peerId)
    if (!r) return
    this.remotes.delete(peerId)
    this.ui.toast(`${r.name} left the arena`)
    this.updatePeerCount()
    this.refreshScoreboard()
    this.refreshArenaStatus()
  }

  onHello(peerId: string, msg: HelloMsg) {
    if (this.ignored.has(peerId)) return
    const r = this.remotes.get(peerId)
    if (!r) {
      this.pendingHellos.set(peerId, msg)
      return
    }
    r.name = msg.name
    r.color = safeColor(msg.color, r.color)
    r.score = msg.score
    this.announce(peerId, r.name)
    this.updatePeerCount()
    this.refreshScoreboard()
  }

  onState(peerId: string, msg: StateMsg) {
    if (this.ignored.has(peerId)) return
    if (!Number.isFinite(msg.x) || !Number.isFinite(msg.y)) return

    let created = false
    let r = this.remotes.get(peerId)
    if (!r) {
      const hello = this.pendingHellos.get(peerId)
      this.pendingHellos.delete(peerId)
      r = this.makeRemote(
        peerId,
        msg.x,
        msg.y,
        hello ?? {
          name: peerId.slice(0, 6),
          color: colorForId(peerId),
          score: msg.score,
          age: msg.age,
        },
      )
      this.remotes.set(peerId, r)
      this.announce(peerId, r.name)
      this.updatePeerCount()
      created = true
    }

    if (msg.seq < r.seq) return

    const prev = r.samples[r.samples.length - 1]
    if (prev && len(msg.x - prev.x, msg.y - prev.y) > 800) r.samples = []
    r.samples.push({
      t: this.time,
      x: msg.x,
      y: msg.y,
      angle: msg.angle,
      vx: msg.vx,
      vy: msg.vy,
    })
    const cutoff = this.time - 1
    while (r.samples.length > 2 && r.samples[0]!.t < cutoff) r.samples.shift()

    r.vx = msg.vx
    r.vy = msg.vy
    r.hp = msg.hp
    r.score = msg.score
    r.alive = msg.alive
    r.thrusting = msg.thrusting
    r.boosting = msg.boosting
    r.seq = msg.seq
    r.t = msg.t
    r.lastSeen = this.time

    this.tryAnchor(peerId, msg.x, msg.y, msg.age)
    const claim = this.claims.get(peerId)
    if (claim && !msg.alive && this.time <= claim.until) {
      this.awardPoint(claim.bulletId, r.name)
      this.claims.delete(peerId)
    } else if (claim && this.time > claim.until) {
      this.claims.delete(peerId)
    }
    if (msg.score >= KILL_LIMIT) this.finishMatch(peerId, r.name, 'kills', false)
    this.refreshScoreboard()
    if (created) this.refreshArenaStatus()
  }

  onFire(peerId: string, msg: FireMsg) {
    if (this.ignored.has(peerId)) return
    if (!Number.isFinite(msg.x) || !Number.isFinite(msg.y)) return
    if (this.bullets.some((b) => b.id === msg.id)) return
    const r = this.remotes.get(peerId)
    const color = r?.color ?? colorForId(peerId)
    this.bullets.push({
      id: msg.id,
      ownerId: peerId,
      x: msg.x,
      y: msg.y,
      vx: msg.vx,
      vy: msg.vy,
      life: BULLET_LIFE,
      color,
    })
  }

  onHit(peerId: string, msg: HitMsg) {
    if (this.ignored.has(peerId)) return
    if (msg.targetId !== selfId) return
    if (!this.me.alive || this.matchOver) return
    this.considerHit(peerId, msg)
  }

  onKill(peerId: string, msg: KillMsg) {
    if (this.ignored.has(peerId)) return
    this.noteKill(msg)
    if (msg.killerId === selfId) this.awardPoint(msg.bulletId, msg.victimName)
  }

  onFull(_peerId: string) {
    this.ui.onArenaFull()
  }

  private announce(peerId: string, name: string) {
    if (this.announced.has(peerId)) return
    this.announced.add(peerId)
    this.ui.toast(`${name} linked`)
  }

  onOver(_peerId: string, msg: OverMsg) {
    this.announcedEnd = true
    this.finishMatch(msg.winnerId, msg.winnerName, msg.reason, msg.tied)
  }

  // —— internals ——

  private makeRemote(
    id: string,
    x: number,
    y: number,
    hello: HelloMsg,
  ): RemotePlayer {
    return {
      id,
      name: hello.name,
      color: hello.color,
      x,
      y,
      vx: 0,
      vy: 0,
      angle: -Math.PI / 2,
      hp: MAX_HP,
      maxHp: MAX_HP,
      score: hello.score,
      alive: true,
      thrusting: false,
      boosting: false,
      seq: 0,
      t: 0,
      samples: [
        {
          t: this.time,
          x,
          y,
          angle: -Math.PI / 2,
          vx: 0,
          vy: 0,
        },
      ],
      lastSeen: this.time,
    }
  }

  private updatePeerCount() {
    this.ui.setPeerCount(this.remotes.size + 1)
  }

  private refreshArenaStatus() {
    const connected = this.remotes.size + 1
    const phase = arenaPhase(this.remotes.size, this.matchOver)
    const timeLeft = phase === 'combat' ? Math.ceil(this.matchLeft) : undefined
    this.ui.setArenaStatus(
      formatArenaStatus({
        phase,
        connected,
        capacity: ARENA_CAPACITY,
        timeLeft,
        killLimit: KILL_LIMIT,
        detail: this.endDetail,
      }),
    )
  }

  private refreshScoreboard() {
    const rows = [
      {
        name: this.me.name,
        score: this.me.score,
        self: true,
        color: this.me.color,
      },
      ...[...this.remotes.values()].map((r) => ({
        name: r.name,
        score: r.score,
        self: false,
        color: r.color,
      })),
    ].sort((a, b) => b.score - a.score)
    this.ui.setScoreboard(rows)
  }

  private resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = window.innerWidth
    const h = window.innerHeight
    this.canvas.width = Math.floor(w * this.dpr)
    this.canvas.height = Math.floor(h * this.dpr)
    this.canvas.style.width = `${w}px`
    this.canvas.style.height = `${h}px`
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
  }

  private loop = (now: number) => {
    if (!this.running) return
    const dt = Math.min(0.05, (now - this.lastT) / 1000)
    this.lastT = now
    this.time += dt
    this.update(dt)
    this.draw()
    this.raf = requestAnimationFrame(this.loop)
  }

  private update(dt: number) {
    const renderT = this.time - INTERP_DELAY
    for (const r of this.remotes.values()) {
      const pose = poseAt(r.samples, renderT)
      if (!pose) continue
      r.x = pose.x
      r.y = pose.y
      r.angle = pose.angle
    }

    if (!this.matchOver && this.remotes.size > 0) {
      this.matchLeft = Math.max(0, this.matchLeft - dt)
      const sec = Math.ceil(this.matchLeft)
      if (sec !== this.lastClockSec) {
        this.lastClockSec = sec
        this.refreshArenaStatus()
      }
      if (this.matchLeft <= 0) this.finishByTime()
    }

    this.flushPendingHits()
    this.updateDrone(dt)

    // Respawn
    if (!this.me.alive && !this.matchOver) {
      this.respawnIn -= dt
      this.ui.setRespawn(
        true,
        `Respawning in ${Math.max(0, this.respawnIn).toFixed(1)}…`,
      )
      if (this.respawnIn <= 0) this.respawn()
    } else if (this.me.alive) {
      this.ui.setRespawn(false)
      this.updateLocal(dt)
    } else {
      this.ui.setRespawn(false)
    }

    // Bullets
    for (const b of this.bullets) {
      b.x += b.vx * dt
      b.y += b.vy * dt
      b.life -= dt
    }
    this.bullets = this.bullets.filter(
      (b) =>
        b.life > 0 &&
        b.x > -50 &&
        b.y > -50 &&
        b.x < WORLD.w + 50 &&
        b.y < WORLD.h + 50,
    )

    if (this.me.alive && !this.matchOver) {
      for (const b of [...this.bullets]) {
        if (b.ownerId === selfId) {
          let spent = false
          for (const r of this.remotes.values()) {
            if (!r.alive) continue
            if (len(b.x - r.x, b.y - r.y) < SHIP_HIT_R) {
              this.claimHit(r, b)
              spent = true
              break
            }
          }
          if (!spent && this.drone?.alive && len(b.x - this.drone.x, b.y - this.drone.y) < DRONE_R) {
            this.hitDrone(b)
          }
        } else if (len(b.x - this.me.x, b.y - this.me.y) < SHIP_HIT_R) {
          this.applyDamage(b.ownerId, b.id, b.x, b.y)
        }
      }
    }

    // Particles
    for (const p of this.particles) {
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vx *= 0.96
      p.vy *= 0.96
      p.life -= dt
    }
    this.particles = this.particles.filter((p) => p.life > 0)

    // Network tick
    this.stateAcc += dt
    if (this.stateAcc >= 1 / STATE_HZ) {
      this.stateAcc = 0
      if (this.me.alive || this.respawnIn > 0) this.sendStateNow()
    }

    // Camera
    const viewW = this.canvas.width / this.dpr
    const viewH = this.canvas.height / this.dpr
    const targetX = this.me.x - viewW / 2
    const targetY = this.me.y - viewH / 2
    this.cam.x += (targetX - this.cam.x) * Math.min(1, 8 * dt)
    this.cam.y += (targetY - this.cam.y) * Math.min(1, 8 * dt)
    this.cam.x = clamp(this.cam.x, 0, Math.max(0, WORLD.w - viewW))
    this.cam.y = clamp(this.cam.y, 0, Math.max(0, WORLD.h - viewH))
    this.publishEdgeHints(viewW, viewH)
  }

  private updateLocal(dt: number) {
    const ax = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0)
    const ay = (this.input.down ? 1 : 0) - (this.input.up ? 1 : 0)
    const thrusting = ax !== 0 || ay !== 0
    if (thrusting) this.hasThrust = true
    const wantBoost = this.input.boost && thrusting && this.boostFuel > 0.05

    if (wantBoost) {
      this.boostFuel = Math.max(0, this.boostFuel - BOOST_DRAIN * dt)
    } else {
      this.boostFuel = Math.min(1, this.boostFuel + BOOST_REGEN * dt)
    }
    this.ui.setBoost(this.boostFuel)

    const thrust = wantBoost ? BOOST_THRUST : THRUST
    if (thrusting) {
      const n = norm(ax, ay)
      this.me.vx += n.x * thrust * dt
      this.me.vy += n.y * thrust * dt
    }

    // Drag
    this.me.vx -= this.me.vx * DRAG * dt
    this.me.vy -= this.me.vy * DRAG * dt

    const maxSp = wantBoost ? MAX_BOOST_SPEED : MAX_SPEED
    const sp = len(this.me.vx, this.me.vy)
    if (sp > maxSp) {
      this.me.vx = (this.me.vx / sp) * maxSp
      this.me.vy = (this.me.vy / sp) * maxSp
    }

    this.me.x += this.me.vx * dt
    this.me.y += this.me.vy * dt
    this.me.x = clamp(this.me.x, SHIP_R, WORLD.w - SHIP_R)
    this.me.y = clamp(this.me.y, SHIP_R, WORLD.h - SHIP_R)

    // Aim — input stores device-pixel coords (canvas.width space)
    const mx = this.cam.x + this.input.mouseX / this.dpr
    const my = this.cam.y + this.input.mouseY / this.dpr
    this.me.angle = Math.atan2(my - this.me.y, mx - this.me.x)

    this.me.thrusting = thrusting
    this.me.boosting = wantBoost

    // Engine particles
    if (thrusting && Math.random() < (wantBoost ? 0.9 : 0.55)) {
      const back = this.me.angle + Math.PI
      const spread = (Math.random() - 0.5) * 0.7
      const sp2 = wantBoost ? 180 : 90
      this.particles.push({
        x: this.me.x + Math.cos(back) * 14,
        y: this.me.y + Math.sin(back) * 14,
        vx: Math.cos(back + spread) * sp2 + this.me.vx * 0.2,
        vy: Math.sin(back + spread) * sp2 + this.me.vy * 0.2,
        life: 0.25 + Math.random() * 0.2,
        maxLife: 0.45,
        size: wantBoost ? 3.5 : 2.2,
        color: wantBoost ? '#ff9f1c' : this.me.color,
        glow: true,
      })
    }

    // Fire
    this.fireCd = Math.max(0, this.fireCd - dt)
    if (this.input.fire && this.fireCd <= 0 && !this.matchOver) {
      this.fireCd = FIRE_COOLDOWN
      this.shoot()
    }
  }

  private shoot() {
    const id = `${selfId}-${this.bulletSeq++}`
    const nose = 22
    const bx = this.me.x + Math.cos(this.me.angle) * nose
    const by = this.me.y + Math.sin(this.me.angle) * nose
    const vx = Math.cos(this.me.angle) * BULLET_SPEED + this.me.vx * 0.35
    const vy = Math.sin(this.me.angle) * BULLET_SPEED + this.me.vy * 0.35
    const bullet: Bullet = {
      id,
      ownerId: selfId,
      x: bx,
      y: by,
      vx,
      vy,
      life: BULLET_LIFE,
      color: this.me.color,
    }
    this.bullets.push(bullet)
    // Muzzle flash
    this.burst(bx, by, '#fff', 5, 0.45)
    this.particles.push({
      x: bx,
      y: by,
      vx: Math.cos(this.me.angle) * 40,
      vy: Math.sin(this.me.angle) * 40,
      life: 0.08,
      maxLife: 0.08,
      size: 5,
      color: this.me.color,
      glow: true,
    })
    const msg: FireMsg = { id, x: bx, y: by, vx, vy, t: this.time }
    this.net.sendFire(msg)
  }

  private claimHit(target: RemotePlayer, bullet: Bullet) {
    this.bullets = this.bullets.filter((b) => b.id !== bullet.id)
    this.burst(bullet.x, bullet.y, target.color, 12, 1.4)
    this.claims.set(target.id, {
      bulletId: bullet.id,
      name: target.name,
      until: this.time + 1.2,
    })
    const msg: HitMsg = {
      targetId: target.id,
      bulletId: bullet.id,
      damage: HIT_DAMAGE,
      x: bullet.x,
      y: bullet.y,
    }
    this.net.sendHit(msg)
  }

  private die(killerId: string, bulletId: string) {
    this.me.alive = false
    this.me.hp = 0
    this.me.vx = 0
    this.me.vy = 0
    this.respawnIn = RESPAWN_TIME
    this.ui.setHp(0, this.me.maxHp)
    this.burst(this.me.x, this.me.y, this.me.color, 48, 3.5)
    const killer = this.remotes.get(killerId)
    const msg: KillMsg = {
      killerId,
      victimId: selfId,
      killerName: killer?.name ?? 'Pilot',
      victimName: this.me.name,
      bulletId,
    }
    this.noteKill(msg)
    this.net.sendKill(msg)
    this.sendStateNow()
  }

  private respawn() {
    const avoid = [...this.remotes.values()].map((r) => ({ x: r.x, y: r.y }))
    const anchor = this.respawnAnchor()
    const pos = anchor ? nearbyPoint(anchor, avoid, WORLD, Math.random) : spawnPos(avoid)
    this.me.x = pos.x
    this.me.y = pos.y
    this.me.vx = 0
    this.me.vy = 0
    this.me.hp = MAX_HP
    this.me.alive = true
    this.boostFuel = 1
    this.ui.setHp(this.me.hp, this.me.maxHp)
    this.ui.setBoost(1)
    this.ui.setRespawn(false)
    this.burst(pos.x, pos.y, this.me.color, 20, 1.5)
    this.sendStateNow()
  }

  private sendStateNow() {
    this.seq++
    const msg: StateMsg = {
      x: this.me.x,
      y: this.me.y,
      vx: this.me.vx,
      vy: this.me.vy,
      angle: this.me.angle,
      hp: this.me.hp,
      score: this.me.score,
      alive: this.me.alive,
      thrusting: this.me.thrusting,
      boosting: this.me.boosting,
      seq: this.seq,
      t: this.time,
      age: this.time,
    }
    this.net.sendState(msg)
  }

  private tryAnchor(peerId: string, x: number, y: number, peerAge: number) {
    if (
      !shouldAnchorToPeer({
        selfId,
        peerId,
        selfAge: this.time,
        peerAge,
        hasThrust: this.hasThrust,
        didAnchor: this.didAnchor,
      })
    ) {
      if (this.time > 2.5 || this.hasThrust) this.didAnchor = true
      return
    }
    const pos = nearbyPoint({ x, y }, [{ x, y }], WORLD, Math.random)
    this.me.x = pos.x
    this.me.y = pos.y
    this.me.vx = 0
    this.me.vy = 0
    const viewW = this.canvas.width / this.dpr
    const viewH = this.canvas.height / this.dpr
    this.cam.x = pos.x - viewW / 2
    this.cam.y = pos.y - viewH / 2
    this.didAnchor = true
    this.sendStateNow()
  }

  private respawnAnchor(): Vec2 | null {
    const living = [...this.remotes.values()].filter((r) => r.alive)
    if (living.length === 0) return null
    const leaders = this.currentLeaderIds()
    const pool = living.filter((r) => leaders.has(r.id))
    const pickFrom = pool.length > 0 ? pool : living
    let best = pickFrom[0]!
    let bestD = Infinity
    for (const r of pickFrom) {
      const d = len(r.x - this.me.x, r.y - this.me.y)
      if (d < bestD) {
        best = r
        bestD = d
      }
    }
    return { x: best.x, y: best.y }
  }

  private currentLeaderIds(): Set<string> {
    return new Set(
      leaderIds([
        { id: selfId, score: this.me.score },
        ...[...this.remotes.values()].map((r) => ({ id: r.id, score: r.score })),
      ]),
    )
  }

  private considerHit(peerId: string, msg: HitMsg) {
    const key = `${msg.bulletId}:${selfId}`
    if (this.processedHits.has(key)) return
    const bullet = this.bullets.find((b) => b.id === msg.bulletId && b.ownerId === peerId)
    const verdict = judgeHit({
      px: this.me.x,
      py: this.me.y,
      claimX: msg.x,
      claimY: msg.y,
      bulletX: bullet?.x,
      bulletY: bullet?.y,
      radius: HIT_SLACK,
    })
    if (verdict === 'pending') {
      if (!this.pendingHits.some((p) => p.msg.bulletId === msg.bulletId)) {
        this.pendingHits.push({ from: peerId, msg, until: this.time + 0.2 })
      }
      return
    }
    if (verdict === 'reject') return
    this.applyDamage(peerId, msg.bulletId, msg.x, msg.y)
  }

  private flushPendingHits() {
    if (this.pendingHits.length === 0) return
    this.pendingHits = this.pendingHits.filter((p) => {
      if (this.time > p.until || this.matchOver || !this.me.alive) return false
      const bullet = this.bullets.find((b) => b.id === p.msg.bulletId && b.ownerId === p.from)
      const verdict = judgeHit({
        px: this.me.x,
        py: this.me.y,
        claimX: p.msg.x,
        claimY: p.msg.y,
        bulletX: bullet?.x,
        bulletY: bullet?.y,
        radius: HIT_SLACK,
      })
      if (verdict === 'accept') {
        this.applyDamage(p.from, p.msg.bulletId, p.msg.x, p.msg.y)
        return false
      }
      if (verdict === 'reject') return false
      return true
    })
  }

  private applyDamage(attackerId: string, bulletId: string, x: number, y: number) {
    if (!this.me.alive || this.matchOver) return
    const key = `${bulletId}:${selfId}`
    if (this.processedHits.has(key)) return
    this.processedHits.add(key)
    if (this.processedHits.size > 200) {
      const first = this.processedHits.values().next().value
      if (first) this.processedHits.delete(first)
    }
    this.me.hp = Math.max(0, this.me.hp - HIT_DAMAGE)
    this.ui.setHp(this.me.hp, this.me.maxHp)
    this.burst(x, y, this.me.color, 10, 1.2)
    this.bullets = this.bullets.filter((b) => b.id !== bulletId)
    if (this.me.hp <= 0) this.die(attackerId, bulletId)
  }

  private noteKill(msg: KillMsg) {
    if (this.seenKills.has(msg.bulletId)) return
    this.seenKills.add(msg.bulletId)
    this.ui.pushKill(`${msg.killerName}  destroyed  ${msg.victimName}`)
  }

  private awardPoint(bulletId: string, victimName: string) {
    if (this.matchOver || this.awarded.has(bulletId)) return
    this.awarded.add(bulletId)
    this.me.score += 1
    this.refreshScoreboard()
    if (!this.seenKills.has(bulletId)) {
      this.seenKills.add(bulletId)
      this.ui.pushKill(`${this.me.name}  destroyed  ${victimName}`)
    }
    if (this.me.score >= KILL_LIMIT) {
      this.finishMatch(selfId, this.me.name, 'kills', false)
    }
  }

  private finishByTime() {
    const picked = pickTimeWinner([
      { id: selfId, name: this.me.name, score: this.me.score },
      ...[...this.remotes.values()].map((r) => ({
        id: r.id,
        name: r.name,
        score: r.score,
      })),
    ])
    this.finishMatch(picked.id, picked.name, 'time', picked.tied)
  }

  private finishMatch(
    winnerId: string,
    winnerName: string,
    reason: 'kills' | 'time',
    tied: boolean,
  ) {
    if (this.matchOver) return
    this.matchOver = true
    this.drone = null
    const title = tied || !winnerName ? 'DRAW' : `${winnerName} takes the arena`
    const detail = tied
      ? 'Even score when time ran out'
      : reason === 'kills'
        ? `First to ${KILL_LIMIT}`
        : 'Highest score when time ran out'
    this.endDetail = tied ? 'Draw' : `${winnerName} takes the arena`
    this.ui.setMatchResult(true, title, detail)
    this.ui.setRespawn(false)
    this.ui.setEdgeHints([])
    this.refreshArenaStatus()
    this.refreshScoreboard()
    if (!this.announcedEnd) {
      this.announcedEnd = true
      this.net.sendOver({ winnerId, winnerName, reason, tied })
    }
  }

  private updateDrone(dt: number) {
    const solo = this.remotes.size === 0 && !this.matchOver && this.me.alive
    if (!solo) {
      this.drone = null
      return
    }
    if (!this.drone) {
      const pos = nearbyPoint(
        { x: this.me.x, y: this.me.y },
        [{ x: this.me.x, y: this.me.y }],
        WORLD,
        Math.random,
      )
      this.drone = { x: pos.x, y: pos.y, angle: 0, hp: DRONE_HP, alive: true, respawnIn: 0 }
    }
    const d = this.drone
    if (!d.alive) {
      d.respawnIn -= dt
      if (d.respawnIn <= 0) {
        const pos = nearbyPoint(
          { x: this.me.x, y: this.me.y },
          [{ x: this.me.x, y: this.me.y }],
          WORLD,
          Math.random,
        )
        d.x = pos.x
        d.y = pos.y
        d.hp = DRONE_HP
        d.alive = true
      }
      return
    }
    d.angle += dt * 0.8
    const tx = this.me.x + Math.cos(d.angle) * 280
    const ty = this.me.y + Math.sin(d.angle) * 280
    d.x += (tx - d.x) * Math.min(1, dt * 1.6)
    d.y += (ty - d.y) * Math.min(1, dt * 1.6)
    const away = len(d.x - this.me.x, d.y - this.me.y)
    if (away < 180 && away > 0) {
      d.x = this.me.x + ((d.x - this.me.x) / away) * 180
      d.y = this.me.y + ((d.y - this.me.y) / away) * 180
    }
    d.x = clamp(d.x, 48, WORLD.w - 48)
    d.y = clamp(d.y, 48, WORLD.h - 48)
  }

  private hitDrone(bullet: Bullet) {
    const d = this.drone
    if (!d?.alive) return
    this.bullets = this.bullets.filter((b) => b.id !== bullet.id)
    d.hp -= HIT_DAMAGE
    this.burst(bullet.x, bullet.y, '#b8ff3c', 12, 1.2)
    if (d.hp <= 0) {
      d.alive = false
      d.respawnIn = 1.4
      this.burst(d.x, d.y, '#b8ff3c', 28, 2)
    }
  }

  private publishEdgeHints(viewW: number, viewH: number) {
    if (this.matchOver) {
      this.ui.setEdgeHints([])
      return
    }
    const narrow = viewW < 760
    const bounds = {
      left: 28,
      top: narrow ? 188 : 84,
      right: viewW - 28,
      bottom: viewH - (narrow ? 200 : 112),
    }
    const origin = { x: this.me.x - this.cam.x, y: this.me.y - this.cam.y }
    const leaders = this.currentLeaderIds()
    const hints: EdgeHint[] = []
    for (const r of this.remotes.values()) {
      if (!r.alive) continue
      const sx = r.x - this.cam.x
      const sy = r.y - this.cam.y
      const onScreen = sx >= -8 && sy >= -8 && sx <= viewW + 8 && sy <= viewH + 8
      if (onScreen) continue
      const edge = edgeAnchor(origin, { x: sx, y: sy }, bounds)
      if (!edge) continue
      hints.push({
        id: r.id,
        x: edge.x,
        y: edge.y,
        angle: edge.angle,
        color: safeColor(r.color),
        leader: leaders.has(r.id),
      })
    }
    this.ui.setEdgeHints(hints)
  }

  private burst(x: number, y: number, color: string, n: number, power: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = (40 + Math.random() * 180) * power
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.3 + Math.random() * 0.6,
        maxLife: 0.9,
        size: 1.5 + Math.random() * 3 * power,
        color: Math.random() > 0.4 ? color : '#fff',
        glow: true,
      })
    }
  }

  // —— rendering ——

  private draw() {
    const ctx = this.ctx
    const viewW = this.canvas.width / this.dpr
    const viewH = this.canvas.height / this.dpr

    this.drawBackdrop(viewW, viewH)

    ctx.save()
    ctx.translate(-this.cam.x, -this.cam.y)

    this.drawStars(viewW, viewH)
    this.drawGrid()
    if (this.me.alive) this.drawPlayerAura()
    this.drawBoundary()

    for (const p of this.particles) this.drawParticle(p)
    for (const b of this.bullets) this.drawBullet(b)
    if (this.drone?.alive) this.drawDrone()
    for (const r of this.remotes.values()) {
      if (r.alive) this.drawShip(r, false)
    }
    if (this.me.alive) this.drawShip(this.me, true)

    const leaders = this.currentLeaderIds()
    for (const r of this.remotes.values()) {
      if (r.alive) this.drawLabel(r, false, leaders.has(r.id))
    }
    if (this.me.alive) this.drawLabel(this.me, true, leaders.has(selfId))

    ctx.restore()

    this.drawVignetteAndPostFx(viewW, viewH)

    if (this.me.alive) {
      this.drawCrosshair()
    }
  }

  private drawBackdrop(viewW: number, viewH: number) {
    const ctx = this.ctx
    // Pure pitch-black 8-bit arcade space with subtle CRT indigo tint
    ctx.fillStyle = '#020008'
    ctx.fillRect(0, 0, viewW, viewH)
  }

  private drawStars(viewW: number, viewH: number) {
    const ctx = this.ctx
    const left = this.cam.x - 40
    const top = this.cam.y - 40
    const right = this.cam.x + viewW + 40
    const bottom = this.cam.y + viewH + 40

    const colors = ['#ffffff', '#00ffff', '#ffea00', '#ff0055', '#38bdf8']
    for (const s of this.stars) {
      if (s.x < left || s.y < top || s.x > right || s.y > bottom) continue
      const ox = s.x + (this.cam.x - WORLD.w / 2) * (1 - s.z) * 0.015
      const oy = s.y + (this.cam.y - WORLD.h / 2) * (1 - s.z) * 0.015

      // Chunky square pixel stars in classic 8-bit palette
      const colIndex = Math.floor(Math.abs(s.twinkle * 10)) % colors.length
      const blink = Math.sin(this.time * 6 + s.twinkle * 4) > -0.25
      if (!blink) continue
      ctx.fillStyle = colors[colIndex]!
      const px = Math.floor(ox)
      const py = Math.floor(oy)
      const sz = Math.max(2, Math.round(s.size * s.z * 2.2))
      ctx.fillRect(px, py, sz, sz)
    }
  }

  private drawGrid() {
    const ctx = this.ctx
    const viewW = this.canvas.width / this.dpr
    const viewH = this.canvas.height / this.dpr

    // Chunky arcade dot matrix grid
    ctx.fillStyle = 'rgba(0, 255, 128, 0.22)'
    const dotStep = 60
    const dx0 = Math.floor(this.cam.x / dotStep) * dotStep
    const dy0 = Math.floor(this.cam.y / dotStep) * dotStep
    for (let x = dx0; x < this.cam.x + viewW + dotStep; x += dotStep) {
      for (let y = dy0; y < this.cam.y + viewH + dotStep; y += dotStep) {
        ctx.fillRect(x - 1, y - 1, 2, 2)
      }
    }
  }

  private drawBoundary() {
    const ctx = this.ctx
    // Chunky 4px stepped dashed arcade caution border
    ctx.lineWidth = 4
    ctx.strokeStyle = '#ff0055'
    ctx.setLineDash([12, 12])
    ctx.strokeRect(4, 4, WORLD.w - 8, WORLD.h - 8)
    ctx.setLineDash([])
    // Corner yellow boxes
    ctx.fillStyle = '#ffea00'
    ctx.fillRect(0, 0, 16, 16)
    ctx.fillRect(WORLD.w - 16, 0, 16, 16)
    ctx.fillRect(0, WORLD.h - 16, 16, 16)
    ctx.fillRect(WORLD.w - 16, WORLD.h - 16, 16, 16)
  }

  private drawPlayerAura() {
    const ctx = this.ctx
    const x = this.me.x
    const y = this.me.y

    // Stepped chunky 8-bit arcade radar ring
    ctx.strokeStyle = 'rgba(0, 255, 128, 0.35)'
    ctx.lineWidth = 2
    ctx.setLineDash([8, 8])
    ctx.beginPath()
    ctx.arc(x, y, 90, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
  }

  private drawShip(p: PlayerState | RemotePlayer, isSelf: boolean) {
    const ctx = this.ctx
    const scale = isSelf ? 1.2 : 1

    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.rotate(p.angle)
    ctx.scale(scale, scale)

    // Retro 8-bit / Pixel Arcade: stepped chunky pixel spacecraft!
    ctx.shadowBlur = 0 // Clean crisp pixel art
    const baseColor = p.color

    // Center fuselage pixel block
    ctx.fillStyle = baseColor
    ctx.fillRect(-8, -4, 20, 8)
    // Stepped nose block
    ctx.fillRect(12, -2, 6, 4)
    // Stepped left wing
    ctx.fillRect(-6, -12, 10, 8)
    ctx.fillRect(-10, -16, 6, 4)
    // Stepped right wing
    ctx.fillRect(-6, 4, 10, 8)
    ctx.fillRect(-10, 12, 6, 4)

    // Pixel cockpit (yellow 8-bit square)
    ctx.fillStyle = isSelf ? '#ffff00' : '#ffffff'
    ctx.fillRect(2, -2, 4, 4)

    // Pixel highlight border
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1
    ctx.strokeRect(-8, -4, 20, 8)

    // 8-bit flickering stepped pixel thruster flame
    if (p.thrusting) {
      const flick = (Math.floor(this.time * 20) % 3) * 3
      // Red outer flame block
      ctx.fillStyle = '#ff0044'
      ctx.fillRect(-14 - flick, -4, 6 + flick, 8)
      // Yellow inner flame block
      ctx.fillStyle = '#ffea00'
      ctx.fillRect(-11 - flick * 0.6, -2, 4 + flick * 0.6, 4)
    }

    ctx.restore()

    // HP Ring
    if (p.hp < p.maxHp) {
      const ring = isSelf ? 36 : 30
      ctx.beginPath()
      ctx.arc(p.x, p.y, ring, -Math.PI / 2, -Math.PI / 2 + (p.hp / p.maxHp) * Math.PI * 2)
      ctx.strokeStyle = p.color
      ctx.lineWidth = 2
      ctx.shadowBlur = 0
      ctx.globalAlpha = 0.75
      ctx.stroke()
      ctx.globalAlpha = 1
    }
  }

  private drawLabel(p: PlayerState | RemotePlayer, isSelf: boolean, leader: boolean) {
    const ctx = this.ctx
    const fontPx = isSelf ? 12 : 11
    const textWidth = Math.max(28, p.name.length * fontPx * 0.65)
    const textHeight = fontPx + (leader ? 18 : 0)
    const spot = placeMarker({
      x: p.x,
      y: p.y,
      textWidth,
      textHeight,
      gap: isSelf ? 58 : 48,
      obstacles: this.labelObstacles(),
    })

    ctx.save()
    // Chunky 8-bit arcade label
    ctx.font = '8px "Press Start 2P", monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillStyle = '#000000'
    ctx.fillText(p.name, spot.x + 1, spot.baseline + 1)
    ctx.fillStyle = isSelf ? '#ffff00' : p.color
    ctx.fillText(p.name, spot.x, spot.baseline)
    if (leader) this.drawCrown(spot.x, spot.baseline - 10)
    ctx.restore()
  }

  private labelObstacles(): { x: number; y: number; r: number }[] {
    const obstacles: { x: number; y: number; r: number }[] = []
    if (this.me.alive) obstacles.push({ x: this.me.x, y: this.me.y, r: 46 })
    for (const r of this.remotes.values()) {
      if (r.alive) obstacles.push({ x: r.x, y: r.y, r: 40 })
    }
    if (this.drone?.alive) obstacles.push({ x: this.drone.x, y: this.drone.y, r: 26 })
    return obstacles
  }

  private drawCrown(x: number, bottom: number) {
    const ctx = this.ctx
    ctx.save()
    ctx.translate(x, bottom)

    // 8-bit stepped pixel crown
    ctx.fillStyle = '#ffea00'
    ctx.fillRect(-6, -8, 2, 8)
    ctx.fillRect(-2, -10, 4, 10)
    ctx.fillRect(4, -8, 2, 8)
    ctx.fillRect(-6, -2, 12, 2)

    ctx.restore()
  }

  private drawDrone() {
    const d = this.drone
    if (!d?.alive) return
    const ctx = this.ctx
    ctx.save()
    ctx.translate(d.x, d.y)
    ctx.rotate(d.angle)

    // 8-bit space invader / UFO pixel drone
    ctx.fillStyle = '#00ff66'
    ctx.fillRect(-6, -8, 12, 4)
    ctx.fillRect(-10, -4, 20, 6)
    ctx.fillRect(-12, 2, 24, 4)
    ctx.fillRect(-8, 6, 4, 3)
    ctx.fillRect(4, 6, 4, 3)
    // Red pixel eyes
    ctx.fillStyle = '#ff0044'
    ctx.fillRect(-4, -1, 3, 3)
    ctx.fillRect(1, -1, 3, 3)

    ctx.restore()

    const spot = placeMarker({
      x: d.x,
      y: d.y,
      textWidth: 46,
      textHeight: 12,
      gap: 28,
      obstacles: this.labelObstacles(),
    })
    ctx.save()
    ctx.font = '8px "Press Start 2P", monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillStyle = '#00ff66'
    ctx.fillText('DRONE', spot.x, spot.baseline)
    ctx.restore()
  }

  private drawBullet(b: Bullet) {
    const ctx = this.ctx
    ctx.save()
    // Chunky 8-bit square pixel pellet
    ctx.fillStyle = Math.sin(this.time * 30) > 0 ? '#ffea00' : '#ffffff'
    ctx.fillRect(Math.floor(b.x - 3), Math.floor(b.y - 3), 6, 6)
    ctx.restore()
  }

  private drawParticle(p: Particle) {
    const ctx = this.ctx
    const a = clamp(p.life / p.maxLife, 0, 1)
    ctx.globalAlpha = a

    // Chunky 8-bit square pixel explosion debris
    ctx.fillStyle = p.color
    const sz = Math.max(2, Math.round(p.size * a * 1.5))
    ctx.fillRect(Math.floor(p.x - sz / 2), Math.floor(p.y - sz / 2), sz, sz)

    ctx.globalAlpha = 1
  }

  private drawVignetteAndPostFx(viewW: number, viewH: number) {
    const ctx = this.ctx

    // 8-bit CRT arcade scanlines drawn on canvas
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)'
    for (let y = 0; y < viewH; y += 4) {
      ctx.fillRect(0, y, viewW, 1.5)
    }

    // Heavy dark CRT corner curvature vignette
    const crtVig = ctx.createRadialGradient(
      viewW / 2,
      viewH / 2,
      Math.min(viewW, viewH) * 0.45,
      viewW / 2,
      viewH / 2,
      Math.max(viewW, viewH) * 0.72,
    )
    crtVig.addColorStop(0, 'rgba(0,0,0,0)')
    crtVig.addColorStop(1, 'rgba(0,0,0,0.85)')
    ctx.fillStyle = crtVig
    ctx.fillRect(0, 0, viewW, viewH)
  }

  private drawCrosshair() {
    const ctx = this.ctx
    const hx = this.input.mouseX / this.dpr
    const hy = this.input.mouseY / this.dpr

    // Chunky 8-bit arcade pixel crosshair
    ctx.fillStyle = '#ffea00'
    ctx.fillRect(Math.floor(hx - 2), Math.floor(hy - 2), 4, 4)
    ctx.fillRect(Math.floor(hx - 14), Math.floor(hy - 1), 7, 2)
    ctx.fillRect(Math.floor(hx + 7), Math.floor(hy - 1), 7, 2)
    ctx.fillRect(Math.floor(hx - 1), Math.floor(hy - 14), 2, 7)
    ctx.fillRect(Math.floor(hx - 1), Math.floor(hy + 7), 2, 7)
  }
}

