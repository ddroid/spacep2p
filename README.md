# Nebula Arena

Real-time multiplayer space combat with **no game server** — peer discovery and matchmaking via [Trystero](https://github.com/dmotz/trystero) (WebRTC + Nostr relays).

## Play

```bash
npm install
npm run dev
```

1. Open the app in a browser.
2. Enter a callsign → **Create Arena**.
3. Copy the room link (or code) and open it in a second browser/tab (or share with a friend).
4. Dogfight in the nebula.

### Controls

| Input | Action |
|-------|--------|
| **WASD** / arrows | Thrust |
| **Mouse** | Aim |
| **Click** / **Space** | Fire |
| **Shift** | Boost |
| **Esc** | Leave arena |

On phones/tablets: **left stick** move · **right stick** aim · **FIRE** / **BOOST** buttons.

## Stack

- **Vite + TypeScript** — build tooling
- **Trystero 0.25** — `joinRoom` over Nostr, `makeAction` for game events
- **Canvas 2D** — ships, projectiles, particles, HUD

## Architecture (short)

| Channel | Rate | Purpose |
|---------|------|---------|
| `hello` | on join | Callsign + color |
| `state` | ~20 Hz | Position, velocity, aim, HP, score |
| `fire` | on shot | Bullet spawn |
| `hit` | on impact | Damage claim (shooter → victim) |
| `kill` | on destroy | Kill feed |

Each peer is authoritative for their own ship. Remote ships are interpolated between state snapshots. Hit detection is shooter-side; the victim applies damage when they receive a `hit`.

Static files only need a host that serves the SPA — game traffic never goes through your server after the page loads.

## TURN (mobile / cross-network)

Peers on the same Wi‑Fi often connect with STUN alone. Mobile data and some NATs need a **TURN** relay. Without it you’ll see:

`LINK ERROR: could not connect to peer … configure TURN servers`

1. Copy `.env.example` → `.env` and fill in credentials from [Metered Open Relay](https://www.metered.ca/tools/openrelay/) (free) or [Cloudflare TURN](https://developers.cloudflare.com/realtime/turn/).
2. Rebuild / redeploy so Vite embeds `VITE_TURN_*`.

On Dokploy, add the same `VITE_TURN_URLS`, `VITE_TURN_USERNAME`, and `VITE_TURN_CREDENTIAL` as build environment variables.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Local dev server |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview production build |
