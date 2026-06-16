# Play Experience Redesign — Design Spec

- **Date:** 2026-06-16
- **Status:** Design approved; implementation plan next.
- **Sub-project:** 1 of N in the "surface the engine's power" frontend effort.

## Context

deckreps.app is a Commander deck-generation + playtesting platform. The TypeScript
rules engine now plays full-rules Magic at **86.51% honest card coverage** with an
honesty bar (it never fakes a card it can't actually run). The frontend's play
experience — the in-browser game board reached via "Test this deck" / the Play
page, running the engine against AI — *functions* but is rough: mobile-first and
cramped on desktop, with interaction dead-ends and overlapping floating docks
(the engine-feed-covers-buttons / dock-collision bug class we fought this week).

This redesign is the first sub-project of a broader effort to **rebuild the
frontend to surface the engine's power**. Audience: **end users — deck builders /
players who are also learning Magic.** Goal: make the playtest the hero — generate
or import a deck and actually *play* it, smoothly, on mobile and desktop, in a way
that **teaches the game by playing it correctly**.

## Goals & principles

1. **Successful + smooth interaction** on both mobile and desktop. Every action
   (cast, target, respond, block, mulligan) reliably works; no dead-ends; fast and
   legible. This is the north star.
2. **Surface the engine's power.** The engine's correctness (full rules, honesty
   bar) is the asset; the UI makes it visible and legible.
3. **Teach by playing correctly.** The engine plays the rules right; the UI
   narrates the machinery (stack, triggers, priority) in plain language so users
   learn by doing. The honesty bar is what makes it a trustworthy teacher.
4. **Two native form factors, one component set.** The desktop battlefield and the
   mobile floating table are two layouts of the *same* components — not a port.

## Approach

**Approach B — rebuild the view + interaction layer on top of the proven engine
hook.** `useShelectorGame` (engine state + action dispatch) is preserved
**unchanged**; everything above it is rebuilt. This keeps the hardened engine
wiring (and avoids re-introducing solved bugs) while fixing layout and interaction
holistically rather than as patches.

## Layout system

One battlefield, two layouts driven by viewport (~1024px breakpoint).

**Desktop (≥1024px) — battlefield view.** Persistent rails instead of floating
docks: phase/priority on the left, game log + narration feed on the right,
opponents as a glanceable strip across the top, **the stack pinned to the center**
where resolution happens, your battlefield as the main area, your hand fanned
along the bottom. Nothing overlaps your board — which structurally eliminates the
dock-collision / feed-blocking bug class.

**Mobile (<1024px) — floating table.** A disciplined version of the current
model: opponents collapse to a top strip, your board fills the screen, the
stack/priority surfaces as a bottom sheet only when it's your decision, the hand
swipes up, a phase/actions dock. Same components as desktop, laid out for thumb
reach.

**Opponents: collapsed-by-default, tap-to-explore (both form factors).** Each
opponent is a compact card glancing the decision-relevant reads — life, hand size,
**open mana** (emphasized: "can they respond?" is the single most important read),
board threat (creature count · total power) — with flags for a commander on the
field or the table threat. Tapping opens the full explorable board (every
permanent, lands with untapped count, graveyard, exile, command zone) as a
dismissible overlay on desktop / full-screen explorer on mobile (the existing
`OpponentExplorer` pattern). The glance is **contextual** — surfacing "2 untapped
blockers" during your attack step, flagging open mana amber as you go to cast.

## Interaction grammar

The invariant: **the engine is the source of truth for what's legal.** The UI asks
the engine "what can this object do right now?" and renders exactly that — never
hard-coding or guessing legality. Everything follows from this:

- **One gesture everywhere:** tap/click any object (hand card, your permanent,
  opponent permanent, a player) → a menu of *exactly* its legal actions in this
  moment (kicker hidden when unpayable, etc.).
- **Priority strip:** always shows whose priority it is and your options. Real
  responses are offered clearly (pass + hold-priority); with nothing useful you
  auto-pass, with an "always stop" toggle for control players. Never click-spam,
  never skipped past a real decision.
- **Targeting mode:** legal targets highlight, illegal dim, pick the required
  count, confirm/cancel. One flow for spells, abilities, and combat.
- **Combat flow:** declare attackers (tap → choose defender) → assign blockers →
  order damage only if ambiguous → confirm, with the contextual opponent glance
  feeding in.
- **Look vs. commit:** examining a card / exploring an opponent is always free and
  reversible; committing an action (cast, attack, confirm) is always deliberate.
- **No-dead-ends invariant:** at every priority window at least "pass" is
  available; the game can never wait on the player with no visible way forward.

## Learning model

- **Guided-play opt-in at game start:** a "play guided?" choice. On → the
  stack/priority narrate themselves and you get gentle "you have a response
  available" nudges. Off → clean play for people who know the game.
- **During play:** the stack is always visible regardless of the toggle; no
  coaching interruptions mid-game.
- **After the match:** coaching (key decisions, missed lines, concepts) lives in
  the **after-match report** — its own sub-project (sub-project 2), grown from the
  existing `turnReview` foundation.

## Component architecture

- `useShelectorGame` — **unchanged** (engine state + action dispatch).
- `useGameView` — a new, **pure view-model / selector layer** deriving from engine
  state everything the UI needs: legal actions per object, priority context, the
  stack with plain-language descriptors, combat state, targeting state, opponent
  glance summaries, and the narration feed. Testable in isolation; never mutates
  engine state. This is the bridge that makes the interaction grammar and the
  self-explaining stack consistent.
- Presentational components (consume the view-model, **no game logic**):
  `PermanentTile`, `PlayerBoard`, `OpponentCard`, `OpponentExplorer`, `StackView`,
  `HandView`, `ActionMenu`, `PriorityStrip`, `TargetingLayer`, `CombatFlow`,
  `NarrationFeed`.
- Two layout shells compose the same components, chosen by viewport:
  `DesktopBattlefield`, `MobileTable`.

No game logic in components → the redesign structurally cannot reintroduce the
engine bugs we just killed.

## Scope & phasing

- **Sub-project 1 (this spec):** the in-game play experience — responsive board,
  interaction grammar, learning-grade visible stack, guided-play opt-in — on the
  existing 1v1 (Shelector) games, reusing the engine hook.
- **Sub-project 2:** the after-match coaching report (grows from `turnReview`).
- **Sub-project 3+:** the deck→play on-ramp (generate/import → choose opponents +
  guided toggle → launch), then the rest of the app (generator / viewer /
  optimizer) brought up to match.

## Out of scope (deferred)

- Full guided tutorial / scripted lessons.
- Multiplayer board redesign (unless trivially shared with 1v1).
- Live mid-game coaching (reserved for the after-match report).
- The non-play pages (generator, viewer, optimizer, admin console).

## Verification

- `useGameView` selectors (legal-action derivation, stack descriptors, narration)
  are pure → unit-tested with vitest.
- A scripted full-game playthrough (extending `qaGameScenarios`) asserts the
  no-dead-ends and priority/stack invariants on **both** layout shells.
- Manual chrome-devtools pass at desktop and mobile viewports.

## Success criteria

- A full 1v1 game plays start to finish on both desktop and mobile with **no
  dead-ends and no illegal-action errors**.
- The stack is **always visible and self-explaining**; LIFO resolution is legible.
- Opponents are glanceable (life / hand / open-mana / threat) and one tap from
  full exploration, on both form factors.
- The guided-play toggle works; live play is un-naggy.
- **No regression in engine behavior** (the engine hook is untouched).
