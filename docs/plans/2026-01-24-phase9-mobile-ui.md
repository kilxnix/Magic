# Phase 9: Mobile UI (React Native) — Implementation Plan

**Goal:** A playable Commander game on mobile: battlefield-first layout, hand overlay, stack view, target selection, and basic drag/tap interactions.

**Phase 9 scope:**
- React Native app scaffold for gameplay (not deck builder)
- Render `GameState` (battlefield, hand, zones, life totals, phase/step)
- Player actions: cast spell, choose targets, pass priority, attack/block
- Core UX:
  - battlefield-first
  - hand overlay (swipe up)
  - stack button + stack modal
  - highlights for legal targets

**Non-goals:** animations polish, table view, deck generator integration (later phases).

---

## Task 1: RN App Shell + Engine Bridge

**Files:**
- Create: `frontend/mobile/` (Expo or RN project)
- Create: `frontend/mobile/src/engineBridge.ts`
- Create: `frontend/mobile/src/state/useGameStore.ts`

**Steps:**
1) Initialize project (Expo recommended)
2) Add engine as workspace dependency or via relative import
3) Create `useGameStore` holding:
   - current `GameState`
   - `dispatch(action)` API

**Tests:**
- Minimal unit tests for store reducer (Jest)

**Commit:**
```bash
git add frontend/mobile
git commit -m "feat(mobile): scaffold RN app and engine bridge"
```

---

## Task 2: Battlefield View

**Files:**
- Create: `frontend/mobile/src/screens/GameScreen.tsx`
- Create: `frontend/mobile/src/components/BattlefieldView.tsx`
- Create: `frontend/mobile/src/components/CardView.tsx`

**Behavior:**
- Render your battlefield at bottom
- Render opponents’ battlefields as swipeable sections
- Tap a permanent → open detail sheet

**Commit:**
```bash
git add frontend/mobile/src
git commit -m "feat(mobile): add battlefield-first game screen"
```

---

## Task 3: Hand Overlay + Casting Flow

**Files:**
- Create: `frontend/mobile/src/components/HandOverlay.tsx`
- Create: `frontend/mobile/src/flows/CastSpellFlow.tsx`

**Behavior:**
- Swipe up to open hand overlay
- Tap a card → if castable, start casting flow
- If spell requires targets, highlight legal targets and collect taps
- Confirm → call engine `castSpell(state, playerId, cardInstanceId, targets)`

**Tests:**
- Component tests for “hand opens/closes”
- Flow tests for “target selection required”

**Commit:**
```bash
git add frontend/mobile/src/components frontend/mobile/src/flows
git commit -m "feat(mobile): implement hand overlay and casting/target selection"
```

---

## Task 4: Priority + Stack UI

**Files:**
- Create: `frontend/mobile/src/components/PriorityBar.tsx`
- Create: `frontend/mobile/src/components/StackModal.tsx`

**Behavior:**
- “Pass” button
- Stack icon with count badge
- Stack modal shows stack items and targets

**Commit:**
```bash
git add frontend/mobile/src/components
git commit -m "feat(mobile): add priority controls and stack modal"
```

---

## Task 5: Combat UI (Attack/Block)

**Files:**
- Create: `frontend/mobile/src/flows/CombatFlow.tsx`
- Modify: `frontend/mobile/src/screens/GameScreen.tsx`

**Behavior:**
- Declare attackers: tap your creatures, then tap opponent to assign defender
- Declare blockers: drag (or tap-select) blocker onto attacker
- Show simple combat preview

**Commit:**
```bash
git add frontend/mobile/src/flows
git commit -m "feat(mobile): implement combat attacker/blocker flows"
```

---

## Task 6: HUD Overlays (Life, Phase, Zones)

**Files:**
- Create: `frontend/mobile/src/components/HUD.tsx`

**Behavior:**
- Life total badges with commander damage subview
- Phase/step indicator
- Graveyard/exile/command zone icons and counts

**Commit:**
```bash
git add frontend/mobile/src/components/HUD.tsx
git commit -m "feat(mobile): add HUD overlays (life/phase/zones)"
```

---

## Acceptance Criteria (Phase 9 complete)

- ✅ Mobile app can play through a basic game end-to-end.
- ✅ Casting + target selection works on touch.
- ✅ Stack and priority are visible and usable.
- ✅ Combat declare attackers/blockers is possible.
- ✅ UI stays responsive; no crashes on typical actions.
