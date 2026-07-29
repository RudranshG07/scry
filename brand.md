# Brand — Scry

Defined in `src/app/globals.css` as CSS custom properties, exposed to Tailwind through
`@theme inline`. Use the token names, never the hex values.

## Palette

Dark only (`color-scheme: dark`). There is no light theme. The base is a warm near-black
rather than a blue-black, so the interface reads closer to film than to a terminal.

| Token | Value | Use |
| --- | --- | --- |
| `background` | `#0a0608` | Page background, no gradient wash |
| `foreground` | `#f5f2f0` | Primary text, warm white |
| `surface` | `#121013` | Cards and panels |
| `surface-raised` | `#191518` | Nested blocks inside a card |
| `surface-soft` | `#221d21` | Inactive controls and chips |
| `primary` | `#f5f2f0` | Primary action — white pill buttons, selection, active state |
| `primary-hover` | `#ffffff` | Primary hover |
| `primary-foreground` | `#0a0608` | Text on primary |
| `accent` | `#6badc4` | Healthy, verified, resolved. Taken from the base of the landing sky gradient |
| `muted` | `#241f23` | Dividers and inert fills |
| `muted-foreground` | `#9d9498` | Secondary text |
| `border` | `#2b2529` | All borders |
| `ring` | `#8ec9dd` | Focus rings, accent text on dark surfaces |
| `danger` | `#e5606a` | Invalid, challenged, errors, losses |
| `warning` | `#dfa955` | Observing, degraded quorum, cool-off, limits |

Radii: `--radius-card` (0.75rem) for cards, `--radius-control` (0.5rem) for inputs and
chips, `--radius-pill` for every button. Buttons are pills throughout, matching the
landing page.

### Semantic use

Status color carries meaning — keep these mappings (`src/components/ui/status-pill.tsx`):

- `accent` — Open, Resolved, healthy observers, verified evidence
- `warning` — Observing, reconnecting, uptime shortfall, responsible-use notices
- `danger` — Invalid, Challenged, disagreeing observers
- `primary` / `ring` — Scheduled, Result proposed, selection

Tinted surfaces use an opacity suffix on the token (`bg-accent/12`, `bg-danger/8`), never
a separate hex.

## Typography

Loaded via `next/font` in `src/app/layout.tsx`:

- **Instrument Serif** (`--font-instrument`, weight 400 only) — display type. Applied with
  the `.display` class on page headings and the landing hero. **Never pair it with a
  `font-semibold` utility**; only weight 400 is loaded, so anything heavier is synthesized
  and looks wrong.
- **Geist** (`--font-geist-sans`) — all UI text, labels, body.
- **Geist Mono** (`--font-geist-mono`) — every number that can change: probabilities,
  counts, countdowns, pools, hashes, addresses. Always with `tabular-nums` so live values
  do not shift the layout as digits change.
- **Dancing Script** (`--font-script`) — the wordmark only.

Number formatting is centralized in `src/lib/format.ts` — use it rather than calling
`toFixed` in a component.

## Landing page utilities

`globals.css` also carries the landing-specific classes: `.text-glow`, `.button-glow`,
`.liquid-glass`, `.quote-sky`, `.scrollbar-hide`. These belong to the marketing surface.
Do not use the glow utilities on product UI — a glowing number reads as decorative and
undercuts the claim that it was measured.

## Voice

Plain, specific, honest about uncertainty. A forecasting product, not a casino.

- Say what happened: "Observation did not meet the rule", not "Oops, something went wrong".
- Never imply a guaranteed return. Label market probability as pool share, and keep the
  model forecast and forecaster consensus visually separate from it.
- State preview limitations plainly: "No funds are submitted", "Forecasts stay on this
  device", "Contracts not deployed".
- No exclamation marks, no urgency pressure, no streak-baiting.

## Anti-patterns

The previous palette was violet `#745cff` with mint `#9df7cb`, a radial purple page glow,
`Sparkles` icons on headings, and an uppercase letterspaced eyebrow above every section.
That combination is the default look of generated interfaces. Do not reintroduce it.
