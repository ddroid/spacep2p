import { describe, expect, it } from 'vitest'
import {
  formatArenaStatus,
  formatPilotLabel,
  formatScoreboard,
  formatVitals,
  HUD_TOKENS,
} from './hudPresenters'

describe('formatArenaStatus', () => {
  it('shows waiting pilots as primary with connected count as secondary', () => {
    expect(
      formatArenaStatus({
        phase: 'waiting',
        connected: 1,
        capacity: 4,
      }),
    ).toEqual({
      primary: 'WAITING FOR PILOTS',
      secondary: '1 / 4 connected',
      ok: true,
    })
  })

  it('shows combat active when pilots are linked', () => {
    expect(
      formatArenaStatus({
        phase: 'combat',
        connected: 3,
        capacity: 4,
      }),
    ).toEqual({
      primary: 'COMBAT ACTIVE',
      secondary: '3 / 4 connected',
      ok: true,
    })
  })

  it('shows scanning relays while connecting', () => {
    expect(formatArenaStatus({ phase: 'scanning' })).toEqual({
      primary: 'SCANNING RELAYS',
      secondary: 'Finding peers…',
      ok: false,
    })
  })

  it('surfaces link errors as primary with empty secondary', () => {
    expect(
      formatArenaStatus({
        phase: 'error',
        detail: 'could not connect to peer',
      }),
    ).toEqual({
      primary: 'LINK ERROR',
      secondary: 'could not connect to peer',
      ok: false,
    })
  })
})

describe('formatPilotLabel', () => {
  it('uses singular for one pilot', () => {
    expect(formatPilotLabel(1)).toBe('1 PILOT')
  })

  it('uses plural for multiple pilots', () => {
    expect(formatPilotLabel(3)).toBe('3 PILOTS')
  })
})

describe('HUD_TOKENS', () => {
  it('exposes the agreed type scale and spacing system', () => {
    expect(HUD_TOKENS).toMatchObject({
      fontCaption: '10px',
      fontUi: '12px',
      fontImportant: '13px',
      fontPlayerName: '12px',
      space1: '4px',
      space2: '8px',
      space3: '12px',
      space4: '16px',
      radiusPanel: '8px',
      radiusButton: '6px',
      radiusKey: '4px',
      panelHeight: '40px',
      edgePadding: '16px',
      controlGap: '12px',
    })
  })
})

describe('formatVitals', () => {
  it('shows hull and boost as current over max with bar percents', () => {
    expect(
      formatVitals({
        hp: 92,
        maxHp: 100,
        boost: 0.61,
      }),
    ).toEqual({
      hullText: '92 / 100',
      boostText: '61 / 100',
      hullPct: 92,
      boostPct: 61,
    })
  })
})

describe('formatScoreboard', () => {
  it('shows waiting copy when only one pilot is present', () => {
    expect(
      formatScoreboard({
        players: [{ name: 'ddroid', score: 0, self: true, color: '#00f0ff' }],
        capacity: 4,
      }),
    ).toEqual({
      mode: 'waiting',
      headline: '1 / 4 PILOTS',
      detail: 'Waiting for 1 more pilot',
    })
  })

  it('shows ranked table rows when multiple pilots are present', () => {
    expect(
      formatScoreboard({
        players: [
          { name: 'ddroid', score: 3, self: true, color: '#00f0ff' },
          { name: 'nova', score: 5, self: false, color: '#ff2d95' },
        ],
        capacity: 4,
      }),
    ).toEqual({
      mode: 'table',
      headers: { rank: '#', pilot: 'PILOT', score: 'SCORE' },
      rows: [
        { rank: 1, name: 'nova', score: 5, self: false, color: '#ff2d95' },
        { rank: 2, name: 'ddroid', score: 3, self: true, color: '#00f0ff' },
      ],
    })
  })
})
