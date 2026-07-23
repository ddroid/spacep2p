export type ArenaStatusPhase = 'scanning' | 'waiting' | 'combat' | 'error'

export type ArenaStatusInput = {
  phase: ArenaStatusPhase
  connected?: number
  capacity?: number
  detail?: string
}

export type ArenaStatusView = {
  primary: string
  secondary: string
  ok: boolean
}

export const HUD_TOKENS = {
  fontCaption: '10px',
  fontUi: '12px',
  fontImportant: '13px',
  fontPlayerName: '12px',
  space1: '4px',
  space2: '8px',
  space3: '12px',
  space4: '16px',
  space5: '24px',
  space6: '32px',
  radiusPanel: '8px',
  radiusButton: '6px',
  radiusKey: '4px',
  radiusBar: '3px',
  panelHeight: '40px',
  edgePadding: '16px',
  controlGap: '12px',
  panelPadding: '10px 14px',
  transitionFast: '100ms',
  transitionUi: '160ms',
  transitionPanel: '220ms',
} as const

export function formatArenaStatus(input: ArenaStatusInput): ArenaStatusView {
  const capacity = input.capacity ?? 4
  const connected = input.connected ?? 0

  if (input.phase === 'waiting') {
    return {
      primary: 'WAITING FOR PILOTS',
      secondary: `${connected} / ${capacity} connected`,
      ok: true,
    }
  }

  if (input.phase === 'combat') {
    return {
      primary: 'COMBAT ACTIVE',
      secondary: `${connected} / ${capacity} connected`,
      ok: true,
    }
  }

  if (input.phase === 'scanning') {
    return {
      primary: 'SCANNING RELAYS',
      secondary: 'Finding peers…',
      ok: false,
    }
  }

  if (input.phase === 'error') {
    return {
      primary: 'LINK ERROR',
      secondary: input.detail ?? '',
      ok: false,
    }
  }

  return {
    primary: 'UNKNOWN',
    secondary: '',
    ok: false,
  }
}

export function formatPilotLabel(count: number): string {
  return count === 1 ? '1 PILOT' : `${count} PILOTS`
}

export function formatVitals(input: {
  hp: number
  maxHp: number
  boost: number
}): {
  hullText: string
  boostText: string
  hullPct: number
  boostPct: number
} {
  const hull = Math.max(0, Math.round(input.hp))
  const maxHp = Math.max(1, Math.round(input.maxHp))
  const boost = Math.max(0, Math.min(100, Math.round(input.boost * 100)))
  return {
    hullText: `${hull} / ${maxHp}`,
    boostText: `${boost} / 100`,
    hullPct: Math.max(0, Math.min(100, (hull / maxHp) * 100)),
    boostPct: boost,
  }
}

export type ScoreboardPlayer = {
  name: string
  score: number
  self: boolean
  color: string
}

export type ScoreboardView =
  | {
      mode: 'waiting'
      headline: string
      detail: string
    }
  | {
      mode: 'table'
      headers: { rank: string; pilot: string; score: string }
      rows: Array<ScoreboardPlayer & { rank: number }>
    }

export function formatScoreboard(input: {
  players: ScoreboardPlayer[]
  capacity: number
}): ScoreboardView {
  const capacity = input.capacity
  const connected = input.players.length

  if (connected <= 1) {
    return {
      mode: 'waiting',
      headline: `${connected} / ${capacity} PILOTS`,
      detail: 'Waiting for 1 more pilot',
    }
  }

  const rows = [...input.players]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .map((p, i) => ({ ...p, rank: i + 1 }))

  return {
    mode: 'table',
    headers: { rank: '#', pilot: 'PILOT', score: 'SCORE' },
    rows,
  }
}
