import type { InputState } from './input'
import type { NetSession } from './net'
import { selfId } from './net'
import {
  formatArenaStatus,
  type ArenaStatusView,
} from './hudPresenters'
import type {
  Bullet,
  FireMsg,
  HelloMsg,
  HitMsg,
  KillMsg,
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
    this.net.sendHello({ name: this.name, color: this.color, score: this.me.score })
    this.refreshArenaStatus()
    this.loop(this.lastT)
  }

  stop() {
    this.running = false
    cancelAnimationFrame(this.raf)
    window.removeEventListener('resize', this.onResize)
  }

  /** Network handlers — called from main */

  onPeerJoin(peerId: string) {
    this.ui.toast(`Pilot linked: ${peerId.slice(0, 6)}`)
    this.net.sendHello(
      { name: this.name, color: this.color, score: this.me.score },
      peerId,
    )
    this.sendStateNow()
    this.updatePeerCount()
    this.refreshArenaStatus()
  }

  onPeerLeave(peerId: string) {
    const r = this.remotes.get(peerId)
    this.remotes.delete(peerId)
    this.ui.toast(`${r?.name ?? peerId.slice(0, 6)} left the arena`)
    this.updatePeerCount()
    this.refreshScoreboard()
    this.refreshArenaStatus()
  }

  onHello(peerId: string, msg: HelloMsg) {
    let r = this.remotes.get(peerId)
    if (!r) {
      const pos = spawnPos([{ x: this.me.x, y: this.me.y }])
      r = this.makeRemote(peerId, pos.x, pos.y, msg)
      this.remotes.set(peerId, r)
    } else {
      r.name = msg.name
      r.color = msg.color
      r.score = msg.score
    }
    this.updatePeerCount()
    this.refreshScoreboard()
  }

  onState(peerId: string, msg: StateMsg) {
    let r = this.remotes.get(peerId)
    if (!r) {
      r = this.makeRemote(peerId, msg.x, msg.y, {
        name: peerId.slice(0, 6),
        color: colorForId(peerId),
        score: msg.score,
      })
      this.remotes.set(peerId, r)
    }

    if (msg.seq < r.seq) return

    r.fromX = r.x
    r.fromY = r.y
    r.fromAngle = r.angle
    r.fromT = this.time
    r.toX = msg.x
    r.toY = msg.y
    r.toAngle = msg.angle
    r.toT = this.time + 1 / STATE_HZ
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
    this.refreshScoreboard()
  }

  onFire(peerId: string, msg: FireMsg) {
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

  onHit(_peerId: string, msg: HitMsg) {
    // Only apply damage to ourselves when someone claims a hit on us
    if (msg.targetId !== selfId) return
    if (!this.me.alive) return
    const key = `${msg.bulletId}:${msg.targetId}`
    if (this.processedHits.has(key)) return
    this.processedHits.add(key)
    if (this.processedHits.size > 200) {
      const first = this.processedHits.values().next().value
      if (first) this.processedHits.delete(first)
    }

    this.me.hp = Math.max(0, this.me.hp - msg.damage)
    this.ui.setHp(this.me.hp, this.me.maxHp)
    this.burst(msg.x, msg.y, this.me.color, 10, 1.2)
    // Remove the bullet locally
    this.bullets = this.bullets.filter((b) => b.id !== msg.bulletId)

    if (this.me.hp <= 0) {
      this.die(_peerId)
    }
  }

  onKill(_peerId: string, msg: KillMsg) {
    this.ui.pushKill(
      `${msg.killerName}  destroyed  ${msg.victimName}`,
    )
    if (msg.killerId === selfId) {
      // Already counted locally when we detected the kill
    } else if (msg.killerId !== selfId) {
      const killer = this.remotes.get(msg.killerId)
      if (killer) killer.score = Math.max(killer.score, killer.score)
    }
    this.refreshScoreboard()
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
      fromX: x,
      fromY: y,
      fromAngle: -Math.PI / 2,
      toX: x,
      toY: y,
      toAngle: -Math.PI / 2,
      fromT: 0,
      toT: 0,
      lastSeen: this.time,
    }
  }

  private updatePeerCount() {
    this.ui.setPeerCount(this.remotes.size + 1)
  }

  private refreshArenaStatus() {
    const connected = this.remotes.size + 1
    const phase = this.remotes.size === 0 ? 'waiting' : 'combat'
    this.ui.setArenaStatus(
      formatArenaStatus({
        phase,
        connected,
        capacity: ARENA_CAPACITY,
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
    // Interpolate remotes
    for (const r of this.remotes.values()) {
      if (r.toT > r.fromT) {
        const a = clamp((this.time - r.fromT) / (r.toT - r.fromT), 0, 1)
        const s = a * a * (3 - 2 * a)
        r.x = r.fromX + (r.toX - r.fromX) * s
        r.y = r.fromY + (r.toY - r.fromY) * s
        // Angle lerp shortest path
        let da = r.toAngle - r.fromAngle
        while (da > Math.PI) da -= Math.PI * 2
        while (da < -Math.PI) da += Math.PI * 2
        r.angle = r.fromAngle + da * s
      } else {
        // Extrapolate slightly
        r.x += r.vx * dt * 0.3
        r.y += r.vy * dt * 0.3
      }
    }

    // Respawn
    if (!this.me.alive) {
      this.respawnIn -= dt
      this.ui.setRespawn(
        true,
        `Respawning in ${Math.max(0, this.respawnIn).toFixed(1)}…`,
      )
      if (this.respawnIn <= 0) this.respawn()
    } else {
      this.ui.setRespawn(false)
      this.updateLocal(dt)
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

    // Local hit detection: our bullets vs remotes
    if (this.me.alive) {
      for (const b of [...this.bullets]) {
        if (b.ownerId !== selfId) continue
        for (const r of this.remotes.values()) {
          if (!r.alive) continue
          if (len(b.x - r.x, b.y - r.y) < SHIP_HIT_R) {
            this.claimHit(r, b)
            break
          }
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
  }

  private updateLocal(dt: number) {
    const ax = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0)
    const ay = (this.input.down ? 1 : 0) - (this.input.up ? 1 : 0)
    const thrusting = ax !== 0 || ay !== 0
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
    if (this.input.fire && this.fireCd <= 0) {
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

    const msg: HitMsg = {
      targetId: target.id,
      bulletId: bullet.id,
      damage: HIT_DAMAGE,
      x: bullet.x,
      y: bullet.y,
    }
    this.net.sendHit(msg)

    // Optimistic damage on remote display
    target.hp = Math.max(0, target.hp - HIT_DAMAGE)
    if (target.hp <= 0 && target.alive) {
      target.alive = false
      this.me.score += 1
      this.ui.setHp(this.me.hp, this.me.maxHp)
      this.refreshScoreboard()
      this.burst(target.x, target.y, target.color, 40, 3)
      const kill: KillMsg = {
        killerId: selfId,
        victimId: target.id,
        killerName: this.me.name,
        victimName: target.name,
      }
      this.net.sendKill(kill)
      this.ui.pushKill(`${this.me.name}  destroyed  ${target.name}`)
    }
  }

  private die(killerId: string) {
    this.me.alive = false
    this.me.hp = 0
    this.me.vx = 0
    this.me.vy = 0
    this.respawnIn = RESPAWN_TIME
    this.ui.setHp(0, this.me.maxHp)
    this.burst(this.me.x, this.me.y, this.me.color, 48, 3.5)
    // Killer already broadcasts KillMsg on hit claim — avoid double feed
    void killerId
    this.sendStateNow()
  }

  private respawn() {
    const avoid = [...this.remotes.values()].map((r) => ({ x: r.x, y: r.y }))
    const pos = spawnPos(avoid)
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
    }
    this.net.sendState(msg)
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

    // Deep space backdrop
    const g = ctx.createRadialGradient(
      viewW * 0.5,
      viewH * 0.4,
      0,
      viewW * 0.5,
      viewH * 0.5,
      Math.max(viewW, viewH) * 0.75,
    )
    g.addColorStop(0, '#12122a')
    g.addColorStop(0.45, '#0a0a18')
    g.addColorStop(1, '#05050c')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, viewW, viewH)

    ctx.save()
    ctx.translate(-this.cam.x, -this.cam.y)

    this.drawStars(viewW, viewH)
    this.drawGrid()
    if (this.me.alive) this.drawPlayerAura()
    this.drawBoundary()

    for (const p of this.particles) this.drawParticle(p)
    for (const b of this.bullets) this.drawBullet(b)
    for (const r of this.remotes.values()) {
      if (r.alive) this.drawShip(r, false)
    }
    if (this.me.alive) this.drawShip(this.me, true)

    // Names
    for (const r of this.remotes.values()) {
      if (r.alive) this.drawLabel(r, false)
    }
    if (this.me.alive) this.drawLabel(this.me, true)

    ctx.restore()

    // Soft vignette around player screen position
    if (this.me.alive) {
      const px = this.me.x - this.cam.x
      const py = this.me.y - this.cam.y
      const playerGlow = ctx.createRadialGradient(px, py, 20, px, py, Math.min(viewW, viewH) * 0.42)
      playerGlow.addColorStop(0, 'rgba(80, 70, 180, 0.07)')
      playerGlow.addColorStop(0.55, 'rgba(0,0,0,0)')
      playerGlow.addColorStop(1, 'rgba(0,0,0,0.5)')
      ctx.fillStyle = playerGlow
      ctx.fillRect(0, 0, viewW, viewH)
    } else {
      const vig = ctx.createRadialGradient(
        viewW / 2,
        viewH / 2,
        Math.min(viewW, viewH) * 0.35,
        viewW / 2,
        viewH / 2,
        Math.max(viewW, viewH) * 0.7,
      )
      vig.addColorStop(0, 'rgba(0,0,0,0)')
      vig.addColorStop(1, 'rgba(0,0,0,0.55)')
      ctx.fillStyle = vig
      ctx.fillRect(0, 0, viewW, viewH)
    }

    // Crosshair
    if (this.me.alive) {
      const hx = this.input.mouseX / this.dpr
      const hy = this.input.mouseY / this.dpr
      ctx.strokeStyle = 'rgba(0,240,255,0.55)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(hx, hy, 10, 0, Math.PI * 2)
      ctx.moveTo(hx - 16, hy)
      ctx.lineTo(hx - 6, hy)
      ctx.moveTo(hx + 6, hy)
      ctx.lineTo(hx + 16, hy)
      ctx.moveTo(hx, hy - 16)
      ctx.lineTo(hx, hy - 6)
      ctx.moveTo(hx, hy + 6)
      ctx.lineTo(hx, hy + 16)
      ctx.stroke()
    }
  }

  private drawPlayerAura() {
    const ctx = this.ctx
    const x = this.me.x
    const y = this.me.y

    const glow = ctx.createRadialGradient(x, y, 8, x, y, 160)
    glow.addColorStop(0, 'rgba(80, 70, 180, 0.12)')
    glow.addColorStop(1, 'rgba(80, 70, 180, 0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(x, y, 160, 0, Math.PI * 2)
    ctx.fill()

    // Radar rings
    for (const radius of [70, 130]) {
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(0, 240, 255, ${radius === 70 ? 0.12 : 0.07})`
      ctx.lineWidth = 1
      ctx.setLineDash([4, 10])
      ctx.stroke()
      ctx.setLineDash([])
    }
  }

  private drawStars(viewW: number, viewH: number) {
    const ctx = this.ctx
    const left = this.cam.x - 40
    const top = this.cam.y - 40
    const right = this.cam.x + viewW + 40
    const bottom = this.cam.y + viewH + 40

    for (const s of this.stars) {
      if (s.x < left || s.y < top || s.x > right || s.y > bottom) continue
      const tw = 0.55 + 0.45 * Math.sin(this.time * 2 + s.twinkle)
      // Slow parallax offset by depth
      const ox = s.x + (this.cam.x - WORLD.w / 2) * (1 - s.z) * 0.015
      const oy = s.y + (this.cam.y - WORLD.h / 2) * (1 - s.z) * 0.015
      ctx.globalAlpha = 0.28 + s.z * 0.55 * tw
      ctx.fillStyle = '#c8d4ff'
      ctx.beginPath()
      ctx.arc(ox, oy, s.size * s.z, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  private drawGrid() {
    const ctx = this.ctx
    const step = 120
    const x0 = Math.floor(this.cam.x / step) * step
    const y0 = Math.floor(this.cam.y / step) * step
    const viewW = this.canvas.width / this.dpr
    const viewH = this.canvas.height / this.dpr
    const px = this.me.x
    const py = this.me.y

    for (let x = x0; x < this.cam.x + viewW + step; x += step) {
      const dist = Math.abs(x - px)
      const alpha = clamp(0.09 - dist / 4500, 0.02, 0.09)
      ctx.strokeStyle = `rgba(70, 80, 130, ${alpha})`
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x, this.cam.y)
      ctx.lineTo(x, this.cam.y + viewH)
      ctx.stroke()
    }
    for (let y = y0; y < this.cam.y + viewH + step; y += step) {
      const dist = Math.abs(y - py)
      const alpha = clamp(0.09 - dist / 4500, 0.02, 0.09)
      ctx.strokeStyle = `rgba(70, 80, 130, ${alpha})`
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(this.cam.x, y)
      ctx.lineTo(this.cam.x + viewW, y)
      ctx.stroke()
    }

    // Sparse sector labels
    ctx.font = '500 10px "JetBrains Mono", monospace'
    ctx.fillStyle = 'rgba(125, 140, 190, 0.28)'
    ctx.textAlign = 'left'
    for (let x = x0; x < this.cam.x + viewW + step; x += step * 4) {
      for (let y = y0; y < this.cam.y + viewH + step; y += step * 4) {
        const sx = Math.round(x / step)
        const sy = Math.round(y / step)
        ctx.fillText(`${sx}.${sy}`, x + 6, y + 14)
      }
    }
  }

  private drawBoundary() {
    const ctx = this.ctx
    ctx.strokeStyle = 'rgba(0,240,255,0.25)'
    ctx.lineWidth = 3
    ctx.shadowColor = '#00f0ff'
    ctx.shadowBlur = 12
    ctx.strokeRect(4, 4, WORLD.w - 8, WORLD.h - 8)
    ctx.shadowBlur = 0
  }

  private drawShip(p: PlayerState | RemotePlayer, isSelf: boolean) {
    const ctx = this.ctx
    const scale = isSelf ? 1.2 : 1
    const speed = len(p.vx, p.vy)

    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.rotate(p.angle)
    ctx.scale(scale, scale)

    // Directional movement trail
    if (speed > 40) {
      const trailLen = Math.min(28, 8 + speed * 0.04)
      const grad = ctx.createLinearGradient(-6, 0, -6 - trailLen, 0)
      grad.addColorStop(0, isSelf ? 'rgba(0,240,255,0.35)' : `${p.color}55`)
      grad.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.moveTo(-6, 0)
      ctx.lineTo(-6 - trailLen, 5)
      ctx.lineTo(-6 - trailLen, -5)
      ctx.closePath()
      ctx.fill()
    }

    // Engine glow behind ship
    ctx.shadowColor = isSelf ? '#00f0ff' : p.color
    ctx.shadowBlur = p.boosting ? 32 : isSelf ? 22 : 14

    // Hull
    ctx.beginPath()
    ctx.moveTo(20, 0)
    ctx.lineTo(-13, 13)
    ctx.lineTo(-7, 0)
    ctx.lineTo(-13, -13)
    ctx.closePath()
    ctx.fillStyle = p.color
    ctx.globalAlpha = 0.95
    ctx.fill()
    ctx.globalAlpha = 1

    // Thin cyan/white inner highlight for local player
    ctx.strokeStyle = isSelf ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.55)'
    ctx.lineWidth = isSelf ? 2 : 1.4
    ctx.stroke()
    if (isSelf) {
      ctx.beginPath()
      ctx.moveTo(14, 0)
      ctx.lineTo(-8, 7)
      ctx.lineTo(-4, 0)
      ctx.lineTo(-8, -7)
      ctx.closePath()
      ctx.strokeStyle = 'rgba(0,240,255,0.55)'
      ctx.lineWidth = 1
      ctx.stroke()
    }

    // Cockpit
    ctx.beginPath()
    ctx.arc(5, 0, isSelf ? 4 : 3.2, 0, Math.PI * 2)
    ctx.fillStyle = isSelf ? '#fff' : 'rgba(255,255,255,0.75)'
    ctx.shadowBlur = isSelf ? 12 : 8
    ctx.fill()

    // Thrust flame
    if (p.thrusting) {
      const flick = 10 + Math.random() * 12 * (p.boosting ? 1.6 : 1)
      ctx.beginPath()
      ctx.moveTo(-7, 0)
      ctx.lineTo(-7 - flick, 6)
      ctx.lineTo(-12, 0)
      ctx.lineTo(-7 - flick, -6)
      ctx.closePath()
      ctx.fillStyle = p.boosting ? '#ff9f1c' : '#fff'
      ctx.shadowColor = p.boosting ? '#ff9f1c' : p.color
      ctx.shadowBlur = 16
      ctx.fill()
    }

    ctx.restore()

    // Local-player indicator
    if (isSelf) {
      ctx.beginPath()
      ctx.moveTo(p.x, p.y + SHIP_R + 14)
      ctx.lineTo(p.x - 5, p.y + SHIP_R + 8)
      ctx.lineTo(p.x + 5, p.y + SHIP_R + 8)
      ctx.closePath()
      ctx.fillStyle = 'rgba(0,240,255,0.85)'
      ctx.fill()
    }

    // HP ring
    if (p.hp < p.maxHp) {
      ctx.beginPath()
      ctx.arc(p.x, p.y, SHIP_R + 10, -Math.PI / 2, -Math.PI / 2 + (p.hp / p.maxHp) * Math.PI * 2)
      ctx.strokeStyle = p.color
      ctx.lineWidth = 2
      ctx.shadowBlur = 0
      ctx.globalAlpha = 0.7
      ctx.stroke()
      ctx.globalAlpha = 1
    }
  }

  private drawLabel(p: PlayerState | RemotePlayer, isSelf: boolean) {
    const ctx = this.ctx
    const y = p.y - (isSelf ? 36 : 28)
    ctx.font = `600 ${isSelf ? 12 : 11}px "JetBrains Mono", monospace`
    ctx.textAlign = 'center'
    ctx.shadowColor = 'rgba(0,0,0,0.85)'
    ctx.shadowBlur = 4
    ctx.fillStyle = 'rgba(0,0,0,0.7)'
    ctx.fillText(p.name, p.x + 1, y + 1)
    ctx.fillStyle = p.color
    ctx.fillText(p.name, p.x, y)
    ctx.shadowBlur = 0
  }

  private drawBullet(b: Bullet) {
    const ctx = this.ctx
    const sp = len(b.vx, b.vy) || 1
    const tx = (b.vx / sp) * 7
    const ty = (b.vy / sp) * 7

    ctx.save()
    // Trail with opacity falloff
    const grad = ctx.createLinearGradient(b.x - tx * 1.6, b.y - ty * 1.6, b.x, b.y)
    grad.addColorStop(0, 'rgba(0,0,0,0)')
    grad.addColorStop(0.45, `${b.color}55`)
    grad.addColorStop(1, b.color)
    ctx.strokeStyle = grad
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(b.x - tx * 1.6, b.y - ty * 1.6)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()

    // Bright white core + weapon-color glow
    ctx.shadowColor = b.color
    ctx.shadowBlur = 14
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(b.x, b.y, 2.4, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 7
    ctx.beginPath()
    ctx.arc(b.x, b.y, 1.2, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  private drawParticle(p: Particle) {
    const ctx = this.ctx
    const a = clamp(p.life / p.maxLife, 0, 1)
    ctx.globalAlpha = a
    if (p.glow) {
      ctx.shadowColor = p.color
      ctx.shadowBlur = 8
    }
    ctx.fillStyle = p.color
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.size * a, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.globalAlpha = 1
  }
}
