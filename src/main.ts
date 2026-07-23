import './style.css'
import { createInput } from './input'
import { ARENA_CAPACITY, Game, type GameUI } from './game'
import {
  connectRoom,
  createRoomCode,
  type NetSession,
} from './net'
import {
  formatArenaStatus,
  formatPilotLabel,
  formatScoreboard,
  formatVitals,
  type ArenaStatusView,
  type ScoreboardView,
} from './hudPresenters'

const lobby = document.getElementById('lobby')!
const gameScreen = document.getElementById('game')!
const nameInput = document.getElementById('name-input') as HTMLInputElement
const roomInput = document.getElementById('room-input') as HTMLInputElement
const btnCreate = document.getElementById('btn-create') as HTMLButtonElement
const btnJoin = document.getElementById('btn-join') as HTMLButtonElement
const lobbyStatus = document.getElementById('lobby-status')!
const canvas = document.getElementById('canvas') as HTMLCanvasElement
const btnLeave = document.getElementById('btn-leave') as HTMLButtonElement
const btnCopy = document.getElementById('btn-copy') as HTMLButtonElement
const roomCodeEl = document.getElementById('room-code')!
const peerCountEl = document.getElementById('peer-count')!
const statusPrimaryEl = document.getElementById('status-primary')!
const statusSecondaryEl = document.getElementById('status-secondary')!
const statusPanel = document.getElementById('status-panel')!
const hpBar = document.getElementById('hp-bar')!
const boostBar = document.getElementById('boost-bar')!
const hpValueEl = document.getElementById('hp-value')!
const boostValueEl = document.getElementById('boost-value')!
const scoreboardEl = document.getElementById('scoreboard')!
const killFeed = document.getElementById('kill-feed')!
const toastEl = document.getElementById('toast')!
const respawnOverlay = document.getElementById('respawn-overlay')!
const respawnTimer = document.getElementById('respawn-timer')!

let session: NetSession | null = null
let game: Game | null = null
let inputCleanup: (() => void) | null = null
let busy = false
let lastHp = 100
let lastMaxHp = 100
let lastBoost = 1

// Restore callsign
const savedName = localStorage.getItem('nebula-callsign')
if (savedName) nameInput.value = savedName

// URL room deep-link
const params = new URLSearchParams(location.search)
const urlRoom = params.get('room')
if (urlRoom) roomInput.value = urlRoom.toUpperCase()

function setLobbyStatus(msg: string, isError = false) {
  lobbyStatus.hidden = !msg
  lobbyStatus.textContent = msg
  lobbyStatus.classList.toggle('error', isError)
}

function getName(): string {
  const n = nameInput.value.trim() || `Pilot-${Math.floor(Math.random() * 900 + 100)}`
  nameInput.value = n
  localStorage.setItem('nebula-callsign', n)
  return n
}

function applyArenaStatus(status: ArenaStatusView) {
  statusPrimaryEl.textContent = status.primary
  statusSecondaryEl.textContent = status.secondary
  statusSecondaryEl.hidden = !status.secondary
  statusPanel.classList.toggle('ok', status.ok)
  statusPanel.classList.toggle('error', !status.ok && status.primary === 'LINK ERROR')
}

function applyVitals() {
  const prevHull = Number.parseInt(hpValueEl.textContent.split('/')[0] ?? '100', 10)
  const v = formatVitals({ hp: lastHp, maxHp: lastMaxHp, boost: lastBoost })
  hpBar.style.width = `${v.hullPct}%`
  boostBar.style.width = `${v.boostPct}%`
  hpValueEl.textContent = v.hullText
  boostValueEl.textContent = v.boostText
  if (v.hullPct < prevHull) {
    hpBar.classList.remove('flash')
    void hpBar.offsetWidth
    hpBar.classList.add('flash')
    window.setTimeout(() => hpBar.classList.remove('flash'), 220)
  }
}

function renderScoreboard(view: ScoreboardView) {
  if (view.mode === 'waiting') {
    scoreboardEl.className = 'scoreboard waiting'
    scoreboardEl.innerHTML = `
      <div class="sb-waiting-headline heading">${escapeHtml(view.headline)}</div>
      <div class="sb-waiting-detail value">${escapeHtml(view.detail)}</div>
    `
    return
  }

  scoreboardEl.className = 'scoreboard'
  scoreboardEl.innerHTML = `
    <div class="sb-header">
      <span class="sb-rank">${view.headers.rank}</span>
      <span class="sb-dot-spacer"></span>
      <span class="sb-name">${view.headers.pilot}</span>
      <span class="sb-score">${view.headers.score}</span>
    </div>
    ${view.rows
      .map(
        (r) => `
      <div class="sb-row${r.self ? ' self' : ''}">
        <span class="sb-rank">${r.rank}</span>
        <span class="sb-dot" style="background:${r.color}"></span>
        <span class="sb-name player-name">${escapeHtml(r.name)}</span>
        <span class="sb-score">${r.score}</span>
      </div>`,
      )
      .join('')}
  `
}

function buildUI(): GameUI {
  return {
    setRoomCode: (code) => {
      roomCodeEl.textContent = code
    },
    setPeerCount: (n) => {
      peerCountEl.textContent = formatPilotLabel(n)
    },
    setArenaStatus: (status) => {
      applyArenaStatus(status)
    },
    setHp: (hp, max) => {
      lastHp = hp
      lastMaxHp = max
      applyVitals()
    },
    setBoost: (boost) => {
      lastBoost = boost
      applyVitals()
    },
    setScoreboard: (rows) => {
      renderScoreboard(
        formatScoreboard({ players: rows, capacity: ARENA_CAPACITY }),
      )
    },
    pushKill: (text) => {
      const el = document.createElement('div')
      el.className = 'kill-item'
      el.textContent = text
      killFeed.prepend(el)
      setTimeout(() => el.classList.add('fade'), 3500)
      setTimeout(() => el.remove(), 4200)
      while (killFeed.children.length > 6) killFeed.lastChild?.remove()
    },
    toast: (text) => {
      toastEl.hidden = false
      toastEl.textContent = text
      toastEl.classList.remove('show')
      void toastEl.offsetWidth
      toastEl.classList.add('show')
      window.setTimeout(() => {
        toastEl.classList.remove('show')
      }, 2200)
    },
    setRespawn: (show, text) => {
      respawnOverlay.hidden = !show
      if (text) respawnTimer.textContent = text
    },
  }
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function enterArena(roomId: string) {
  if (busy) return
  busy = true
  setLobbyStatus('Connecting via Nostr relays…')
  btnCreate.disabled = true
  btnJoin.disabled = true

  try {
    const name = getName()
    const ui = buildUI()
    const input = createInput(canvas, {
      move: document.getElementById('stick-move')!,
      aim: document.getElementById('stick-aim')!,
      fire: document.getElementById('btn-fire')!,
      boost: document.getElementById('btn-boost')!,
    })
    inputCleanup = input.destroy

    const net = connectRoom(roomId, {
      onPeerJoin: (id) => game?.onPeerJoin(id),
      onPeerLeave: (id) => game?.onPeerLeave(id),
      onHello: (id, msg) => game?.onHello(id, msg),
      onState: (id, msg) => game?.onState(id, msg),
      onFire: (id, msg) => game?.onFire(id, msg),
      onHit: (id, msg) => game?.onHit(id, msg),
      onKill: (id, msg) => game?.onKill(id, msg),
      onJoinError: (err) => {
        applyArenaStatus(
          formatArenaStatus({ phase: 'error', detail: err }),
        )
        ui.toast(err)
      },
    })
    session = net

    // Update URL without reload
    const url = new URL(location.href)
    url.searchParams.set('room', net.roomId)
    history.replaceState(null, '', url)

    game = new Game(canvas, input.state, net, ui, name)
    game.start()

    lobby.hidden = true
    gameScreen.hidden = false
    setLobbyStatus('')
  } catch (e) {
    console.error(e)
    setLobbyStatus(
      e instanceof Error ? e.message : 'Failed to connect',
      true,
    )
    await leaveArena(false)
  } finally {
    busy = false
    btnCreate.disabled = false
    btnJoin.disabled = false
  }
}

async function leaveArena(showLobby = true) {
  game?.stop()
  game = null
  inputCleanup?.()
  inputCleanup = null
  if (session) {
    try {
      await session.leave()
    } catch {
      /* ignore */
    }
    session = null
  }
  if (showLobby) {
    gameScreen.hidden = true
    lobby.hidden = false
    killFeed.innerHTML = ''
    const url = new URL(location.href)
    url.searchParams.delete('room')
    history.replaceState(null, '', url)
  }
}

btnCreate.addEventListener('click', () => {
  void enterArena(createRoomCode())
})

btnJoin.addEventListener('click', () => {
  const code = roomInput.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (code.length < 4) {
    setLobbyStatus('Enter a valid room code (4–6 characters).', true)
    return
  }
  roomInput.value = code
  void enterArena(code)
})

roomInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnJoin.click()
})

nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (roomInput.value.trim()) btnJoin.click()
    else btnCreate.click()
  }
})

btnLeave.addEventListener('click', () => {
  void leaveArena(true)
})

btnCopy.addEventListener('click', async () => {
  if (!session) return
  const url = new URL(location.href)
  url.searchParams.set('room', session.roomId)
  try {
    await navigator.clipboard.writeText(url.toString())
    btnCopy.textContent = 'COPIED'
    btnCopy.classList.add('copied')
    setTimeout(() => {
      btnCopy.textContent = 'COPY'
      btnCopy.classList.remove('copied')
    }, 1500)
  } catch {
    // fallback
    prompt('Copy this arena link:', url.toString())
  }
})

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !gameScreen.hidden) {
    void leaveArena(true)
  }
})

// Auto-join from URL
if (urlRoom && urlRoom.length >= 4) {
  void enterArena(urlRoom.toUpperCase())
}
