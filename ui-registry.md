# UI Registry

### Touch controls (sticks + action buttons)

File: `src/style.css` (`#touch-controls`, `.stick`, `.touch-btn`)
Last updated: 2026-07-10

| Property | Value |
| -------- | ----- |
| Background | `rgba(5, 8, 18, 0.45–0.55)` + cyan radial wash |
| Border | `1px solid rgba(0, 240, 255, 0.28)` (ring); magenta/amber for fire/boost |
| Border radius | `50%` (sticks + round action buttons) |
| Text — labels | JetBrains Mono, `0.52–0.58rem`, letter-spacing `0.12–0.16em` |
| Text — secondary | `--muted` / `rgba(139, 147, 184, 0.85)` |
| Spacing | Stick pad `118px`; fire `72px`; boost `58px`; gap `0.65–0.75rem` |
| Active state | Stronger border glow; fire/boost fill wash; slight `scale(0.94)` on buttons |
| Shadow | Soft black drop + accent glow (`cyan` / `magenta` / `amber`) |
| Accent usage | Move stick: `--cyan`; Fire: `--magenta`; Boost: `--amber` |

**Pattern notes:**
- Match HUD panels (`rgba(5, 8, 18, …)`, blur, thin cyan borders) rather than opaque cards.
- Touch UI appears at `max-width: 720px` and `(hover: none) and (pointer: coarse)`.
- Leave bottom HUD padding (`~9.5rem`) so vitals clear the sticks.
