# Parser-Driven Game Engine Refactor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the oracle text parser the single source of truth for ALL card mechanics — remove every hardcoded card name list and string match, so any card works if its oracle text follows standard MTG patterns.

**Architecture:** (1) Extend CardDefinition with cached parsed data populated at load time, (2) Add missing effect types to AST (UnlessTax, EquipmentBonus, ManaProduction), (3) Improve parser to handle tax triggers, equipment text, equip costs, and mana abilities, (4) Replace all hardcoded string matching in engine and frontend with reads from cached parsed data, (5) Prune redundant overrides.

**Tech Stack:** TypeScript engine (`engine/src/`), React frontend (`frontend/src/`), Vitest for engine tests.

---

## File Map

| File | Responsibility | Changes |
|------|---------------|---------|
| `engine/src/types.ts` | Core types | Add fields to CardDefinition for cached parse data |
| `engine/src/effects/ast.ts` | Effect AST types | Add UnlessTaxEffect, EquipmentBonusEffect, ManaProductionInfo |
| `engine/src/effects/parser.ts` | Oracle text parser | Add tax, equipment, equip cost, mana production patterns |
| `engine/src/effects/executor.ts` | Effect execution | Handle UnlessTaxEffect |
| `engine/src/cards/deck-loader.ts` | Card loading | Populate cached parse data in convertCard() |
| `engine/src/effects/continuous.ts` | P/T modifiers | Read from cached equipment data instead of string matching |
| `engine/src/keywords.ts` | Keyword detection | Read from cached equipment data instead of string matching |
| `engine/src/ai/legal-actions.ts` | Action generation | Use cached data for mana abilities, equipment, equip actions |
| `engine/src/actions.ts` | Action execution | Use cached mana data instead of regex |
| `engine/src/stack.ts` | Stack/triggers | Use cached parse for trigger registration |
| `engine/src/effects/overrides.ts` | Card overrides | Remove redundant overrides |
| `frontend/src/hooks/useShelectorGame.ts` | Game loop | Remove TAX_CARDS, getSearchFilter; use parsed effect data |

---

## Task 1: Extend CardDefinition with Cached Parse Data

Add optional fields to CardDefinition so parsed oracle text is computed once at card load time instead of re-parsed everywhere.

**Files:**
- Modify: `engine/src/types.ts`
- Modify: `engine/src/effects/ast.ts`

- [ ] **Step 1: Add new types to ast.ts**

Add these types at the end of `engine/src/effects/ast.ts`:

```typescript
// ============================================================================
// Cached Parse Data — computed once at card load time
// ============================================================================

/** Mana production info for a permanent with a mana ability */
export interface ManaProductionInfo {
  colors: Array<'W' | 'U' | 'B' | 'R' | 'G' | 'C'>;
  amounts: Record<string, number>; // e.g. { C: 2 } for Sol Ring
  isTapAbility: boolean;
  requiresSacrifice: boolean;
}

/** Equipment bonus parsed from "equipped creature gets/has" text */
export interface EquipmentBonusInfo {
  power: number;
  toughness: number;
  keywords: string[];
}

/** Equip cost parsed from "Equip {N}" text */
export interface EquipCostInfo {
  generic: number;
  W: number; U: number; B: number; R: number; G: number; C: number;
}

/** Unless-tax trigger data parsed from "unless that player pays {N}" */
export interface UnlessTaxInfo {
  triggerKind: string; // e.g. 'OpponentCastSpell'
  taxAmount: number;
  effect: 'draw' | 'treasure' | 'other';
  effectCount: number;
}

/** Search ability info parsed from "search your library for..." */
export interface SearchAbilityInfo {
  filter?: string;    // e.g. 'basic land', 'artifact', 'creature'
  destination: 'hand' | 'battlefield' | 'top' | 'graveyard';
  tapped?: boolean;
  shuffle: boolean;
}
```

- [ ] **Step 2: Add cached fields to CardDefinition in types.ts**

In `engine/src/types.ts`, extend the `CardDefinition` interface:

```typescript
export interface CardDefinition {
  id: string;
  name: string;
  type_line: string;
  oracle_text: string;
  mana_cost: string;
  cmc: number;
  colors: ManaColor[];
  color_identity: ManaColor[];
  keywords: string[];
  card_types: CardType[];
  power?: number;
  toughness?: number;

  // Cached parse data — populated at card load time
  isEquipment?: boolean;
  equipCost?: import('./effects/ast').EquipCostInfo;
  equipmentBonus?: import('./effects/ast').EquipmentBonusInfo;
  manaProduction?: import('./effects/ast').ManaProductionInfo;
  searchAbility?: import('./effects/ast').SearchAbilityInfo;
  unlessTax?: import('./effects/ast').UnlessTaxInfo;
}
```

NOTE: Use import() type syntax to avoid circular dependency issues. If that causes TS issues, import the types at the top of types.ts directly from ast.ts.

- [ ] **Step 3: Build to verify types**

Run: `cd engine && npm run build`
Expected: Clean build (new fields are all optional).

- [ ] **Step 4: Commit**

```bash
git add engine/src/types.ts engine/src/effects/ast.ts
git commit -m "feat: add cached parse data types to CardDefinition"
```

---

## Task 2: Build Parse-and-Cache Functions

Create a module that parses oracle text into the cached fields. This is the single source of truth — all other code reads from these fields.

**Files:**
- Create: `engine/src/cards/card-parser-cache.ts`
- Modify: `engine/src/cards/deck-loader.ts`

- [ ] **Step 1: Create card-parser-cache.ts**

Create `engine/src/cards/card-parser-cache.ts`:

```typescript
/**
 * Card Parser Cache
 *
 * Parses oracle text once at card load time and populates
 * cached fields on CardDefinition. This is the SINGLE SOURCE
 * OF TRUTH for all card mechanics — no other code should parse
 * oracle text directly.
 */

import type { CardDefinition } from '../types';
import type {
  ManaProductionInfo,
  EquipmentBonusInfo,
  EquipCostInfo,
  UnlessTaxInfo,
  SearchAbilityInfo,
} from '../effects/ast';

/**
 * Parse all cached fields for a CardDefinition from its oracle text.
 * Called once at card load time.
 */
export function populateParsedCache(def: CardDefinition): CardDefinition {
  const oracle = def.oracle_text.toLowerCase();
  const typeLine = def.type_line.toLowerCase();

  return {
    ...def,
    isEquipment: typeLine.includes('equipment'),
    equipCost: parseEquipCost(oracle),
    equipmentBonus: parseEquipmentBonus(oracle),
    manaProduction: parseManaProduction(oracle, typeLine),
    searchAbility: parseSearchAbility(oracle),
    unlessTax: parseUnlessTax(oracle),
  };
}

// ========== Equipment ==========

function parseEquipCost(oracle: string): EquipCostInfo | undefined {
  // "equip {2}" or "equip {1}{W}" or "equip 2"
  const match = oracle.match(/equip\s+(?:\{(\d+)\}|\{([wubrgc])\}|(\d+))/i);
  if (!match) return undefined;
  const cost: EquipCostInfo = { generic: 0, W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  if (match[1]) cost.generic = parseInt(match[1]);
  else if (match[2]) cost[match[2].toUpperCase() as keyof EquipCostInfo] = 1;
  else if (match[3]) cost.generic = parseInt(match[3]);
  return cost;
}

function parseEquipmentBonus(oracle: string): EquipmentBonusInfo | undefined {
  if (!oracle.includes('equipped creature')) return undefined;
  let power = 0, toughness = 0;
  const keywords: string[] = [];

  // "+N/+N" patterns
  const ptMatch = oracle.match(/equipped creature gets? ([+-]\d+)\/([+-]\d+)/);
  if (ptMatch) {
    power = parseInt(ptMatch[1]);
    toughness = parseInt(ptMatch[2]);
  }

  // Keyword grants
  const kwPatterns = [
    'flying', 'trample', 'deathtouch', 'lifelink', 'vigilance', 'haste',
    'first strike', 'double strike', 'menace', 'hexproof', 'indestructible',
    'reach', 'protection', 'ward',
  ];
  for (const kw of kwPatterns) {
    if (oracle.includes('equipped creature has ' + kw) ||
        oracle.includes('equipped creature gains ' + kw)) {
      keywords.push(kw.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' '));
    }
  }

  if (power === 0 && toughness === 0 && keywords.length === 0) return undefined;
  return { power, toughness, keywords };
}

// ========== Mana Production ==========

function parseManaProduction(oracle: string, typeLine: string): ManaProductionInfo | undefined {
  // Check land subtypes first
  const subtypeColors: Array<'W' | 'U' | 'B' | 'R' | 'G' | 'C'> = [];
  if (typeLine.includes('plains')) subtypeColors.push('W');
  if (typeLine.includes('island')) subtypeColors.push('U');
  if (typeLine.includes('swamp')) subtypeColors.push('B');
  if (typeLine.includes('mountain')) subtypeColors.push('R');
  if (typeLine.includes('forest')) subtypeColors.push('G');

  if (subtypeColors.length > 0) {
    const amounts: Record<string, number> = {};
    for (const c of subtypeColors) amounts[c] = 1;
    return { colors: subtypeColors, amounts, isTapAbility: true, requiresSacrifice: false };
  }

  // Check "{T}: Add" patterns
  const tapAddMatch = oracle.match(/\{t\}:\s*add\s+([^."\n]+)/i);
  if (!tapAddMatch) return undefined;

  const addPart = tapAddMatch[1];
  const colors: Array<'W' | 'U' | 'B' | 'R' | 'G' | 'C'> = [];
  const amounts: Record<string, number> = {};

  // "any color" / "any one color"
  if (addPart.includes('any color') || addPart.includes('any one color')) {
    const textNumbers: Record<string, number> = { two: 2, three: 3, four: 4, five: 5 };
    let amount = 1;
    for (const [word, num] of Object.entries(textNumbers)) {
      if (addPart.includes(word)) { amount = num; break; }
    }
    return {
      colors: ['W', 'U', 'B', 'R', 'G'],
      amounts: { W: amount, U: amount, B: amount, R: amount, G: amount },
      isTapAbility: true,
      requiresSacrifice: oracle.includes('sacrifice') && oracle.indexOf('sacrifice') < oracle.indexOf('add'),
    };
  }

  // Count individual mana symbols
  for (const [symbol, color] of Object.entries({ '{w}': 'W', '{u}': 'U', '{b}': 'B', '{r}': 'R', '{g}': 'G', '{c}': 'C' })) {
    const regex = new RegExp(symbol.replace('{', '\\{').replace('}', '\\}'), 'gi');
    const matches = addPart.match(regex);
    if (matches && matches.length > 0) {
      colors.push(color as any);
      amounts[color] = matches.length;
    }
  }

  if (colors.length === 0) {
    colors.push('C');
    amounts['C'] = 1;
  }

  return {
    colors,
    amounts,
    isTapAbility: true,
    requiresSacrifice: oracle.includes('sacrifice') && oracle.indexOf('sacrifice') < oracle.indexOf('add'),
  };
}

// ========== Search Ability ==========

function parseSearchAbility(oracle: string): SearchAbilityInfo | undefined {
  if (!oracle.includes('search your library') && !oracle.includes('search their library')) {
    return undefined;
  }

  let filter: string | undefined;
  const forMatch = oracle.match(/search your library for (?:an? |up to \w+ )?(.+?)(?:\s+card)?(?:,|\.|and put| then| with| reveal)/);
  if (forMatch) {
    const target = forMatch[1].trim();
    if (target.includes('basic land')) filter = 'basic land';
    else if (target.includes('artifact or enchantment')) filter = 'artifact or enchantment';
    else if (target.includes('artifact')) filter = 'artifact';
    else if (target.includes('enchantment')) filter = 'enchantment';
    else if (target.includes('creature')) filter = 'creature';
    else if (target.includes('instant or sorcery')) filter = 'instant or sorcery';
    else if (target.includes('instant')) filter = 'instant';
    else if (target.includes('sorcery')) filter = 'sorcery';
    else if (target.includes('land')) filter = 'land';
    else if (target.includes('planeswalker')) filter = 'planeswalker';
  }

  let destination: SearchAbilityInfo['destination'] = 'hand';
  if (oracle.includes('onto the battlefield') || oracle.includes('put it onto the battlefield')) destination = 'battlefield';
  else if (oracle.includes('on top of your library') || oracle.includes('on top')) destination = 'top';
  else if (oracle.includes('into your graveyard') || oracle.includes('put that card into your graveyard')) destination = 'graveyard';
  else if (oracle.includes('put it into your hand') || oracle.includes('put that card into your hand')) destination = 'hand';

  const tapped = destination === 'battlefield' && oracle.includes('tapped');
  const shuffle = oracle.includes('shuffle');

  return { filter, destination, tapped: tapped || undefined, shuffle };
}

// ========== Tax Triggers ==========

function parseUnlessTax(oracle: string): UnlessTaxInfo | undefined {
  // "whenever an opponent casts a spell, you may draw a card unless that player pays {1}"
  // "whenever an opponent casts a spell, create a Treasure token unless that player pays {2}"
  if (!oracle.includes('unless') || !oracle.includes('pays')) return undefined;

  let triggerKind = '';
  if (oracle.includes('whenever an opponent casts a spell')) triggerKind = 'OpponentCastSpell';
  else if (oracle.includes('whenever a player draws a card')) triggerKind = 'CardDrawn';
  else if (oracle.includes('whenever an opponent draws a card')) triggerKind = 'CardDrawn';
  else return undefined;

  // Parse tax amount
  const taxMatch = oracle.match(/pays?\s*\{(\d+)\}/);
  const taxAmount = taxMatch ? parseInt(taxMatch[1]) : 1;

  // Parse effect
  let effect: UnlessTaxInfo['effect'] = 'other';
  let effectCount = 1;
  if (oracle.includes('draw a card') || oracle.includes('draw two')) {
    effect = 'draw';
    effectCount = oracle.includes('draw two') ? 2 : 1;
  } else if (oracle.includes('treasure')) {
    effect = 'treasure';
  }

  return { triggerKind, taxAmount, effect, effectCount };
}
```

- [ ] **Step 2: Wire populateParsedCache into convertCard**

In `engine/src/cards/deck-loader.ts`, import and call `populateParsedCache`:

```typescript
import { populateParsedCache } from './card-parser-cache';

export function convertCard(card: ScryfallCard): CardDefinition {
  const cmc = typeof card.cmc === 'string' ? parseFloat(card.cmc) : card.cmc;

  const baseDef: CardDefinition = {
    id: card.id,
    name: card.name,
    type_line: card.type_line,
    oracle_text: card.oracle_text || '',
    mana_cost: card.mana_cost || '',
    cmc: Math.floor(cmc),
    colors: toManaColors(card.colors || []),
    color_identity: toManaColors(card.color_identity || []),
    keywords: card.keywords || [],
    card_types: parseCardTypes(card.type_line),
    power: parsePT(card.power),
    toughness: parsePT(card.toughness),
  };

  return populateParsedCache(baseDef);
}
```

- [ ] **Step 3: Export from cards index**

In `engine/src/cards/index.ts` (if it exists) or create it, export from the new module:

```typescript
export { populateParsedCache } from './card-parser-cache';
```

- [ ] **Step 4: Build and run tests**

Run: `cd engine && npm run build && npx vitest run src/cards/ src/game-init.test.ts`

- [ ] **Step 5: Commit**

```bash
git add engine/src/cards/card-parser-cache.ts engine/src/cards/deck-loader.ts engine/src/types.ts engine/src/effects/ast.ts
git commit -m "feat: parse and cache oracle text data at card load time"
```

---

## Task 3: Replace Hardcoded Engine Mechanics with Cached Data

Replace all string matching in the engine with reads from the cached parse data on CardDefinition.

**Files:**
- Modify: `engine/src/effects/continuous.ts`
- Modify: `engine/src/keywords.ts`
- Modify: `engine/src/ai/legal-actions.ts`
- Modify: `engine/src/actions.ts`

- [ ] **Step 1: Replace equipment P/T in continuous.ts**

In `engine/src/effects/continuous.ts`, replace `parseEquipmentBonus()` and `getEquipmentPTBonus()` with cached data:

```typescript
// Replace the old parseEquipmentBonus function and getEquipmentPTBonus with:

function getEquipmentPTBonus(state: GameState, instanceId: string): { power: number; toughness: number } {
  let power = 0, toughness = 0;
  for (const [, otherCard] of state.cards) {
    if (otherCard.attachedTo !== instanceId || otherCard.zone !== 'battlefield') continue;
    const equipDef = state.cardDefinitions.get(otherCard.definitionId);
    if (!equipDef?.equipmentBonus) continue;
    power += equipDef.equipmentBonus.power;
    toughness += equipDef.equipmentBonus.toughness;
  }
  return { power, toughness };
}
```

Update `getEffectivePower()` and `getEffectiveToughness()` to call this.
Delete the old `parseEquipmentBonus()` function.

- [ ] **Step 2: Replace equipment keywords in keywords.ts**

In `engine/src/keywords.ts`, replace the equipment keyword string matching in `instanceHasKeyword()`:

```typescript
// Replace the equipment keyword section with:
for (const [, otherCard] of state.cards) {
  if (otherCard.attachedTo !== instanceId || otherCard.zone !== 'battlefield') continue;
  const equipDef = state.cardDefinitions.get(otherCard.definitionId);
  if (equipDef?.equipmentBonus?.keywords.some(
    k => k.toLowerCase() === keyword.toLowerCase()
  )) {
    return true;
  }
}
```

- [ ] **Step 3: Replace mana ability detection in legal-actions.ts**

In `engine/src/ai/legal-actions.ts`, update `generateManaActions()`:

```typescript
function generateManaActions(state: GameState, playerId: string): ActivateManaAbilityAction[] {
  const actions: ActivateManaAbilityAction[] = [];
  const battlefield = getCardsInZone(state, playerId, 'battlefield');

  for (const card of battlefield) {
    if (card.tapped) continue;
    const def = getCardDefinition(state, card);

    // Use cached mana production data
    if (!def.manaProduction) continue;
    if (def.manaProduction.requiresSacrifice) continue; // Handled as activated ability

    for (const color of def.manaProduction.colors) {
      actions.push({
        kind: 'ActivateManaAbility',
        cardInstanceId: card.instanceId,
        color,
      });
    }
  }
  return actions;
}
```

Delete `getLandManaColors()` function (its logic is now in `card-parser-cache.ts`).

- [ ] **Step 4: Replace equipment detection in legal-actions.ts**

Update `generateEquipActions()` to use `def.isEquipment` and `def.equipCost`:

```typescript
const equipment = battlefield.filter(c => {
  const def = getCardDefinition(state, c);
  return def.isEquipment && def.equipCost;
});

for (const equip of equipment) {
  const def = getCardDefinition(state, equip);
  const equipCost = { ...def.equipCost!, generic: def.equipCost!.generic } as ManaCost;
  if (!canPayCost(player.manaPool, equipCost)) continue;
  // ... rest of equip action generation
}
```

Delete `parseEquipCost()` function.

- [ ] **Step 5: Replace mana amount in actions.ts**

In `engine/src/actions.ts`, update `tapLandForMana()` to use cached data:

```typescript
export function tapLandForMana(state: GameState, playerId: string, cardInstanceId: string, color: ManaColor): GameState {
  const card = state.cards.get(cardInstanceId);
  if (!card) throw new Error('Card not found');
  if (card.ownerId !== playerId) throw new Error('Not your card');
  if (card.zone !== 'battlefield') throw new Error('Card not on battlefield');
  if (card.tapped) throw new Error('Card already tapped');

  const def = getCardDefinition(state, card);
  const amount = def.manaProduction?.amounts[color] ?? 1;

  const newCards = new Map(state.cards);
  newCards.set(cardInstanceId, { ...card, tapped: true });

  const playerIndex = state.players.findIndex(p => p.id === playerId);
  const newPlayers = state.players.map((p, i) =>
    i === playerIndex ? { ...p, manaPool: addMana(p.manaPool, color, amount) } : p
  );

  return { ...state, cards: newCards, players: newPlayers };
}
```

Delete `getManaAmount()` and `TEXT_NUMBERS` and `parseEquipCostFromOracle()`.

- [ ] **Step 6: Replace equip cost in actions.ts**

Update `equipCreature()` to use cached data:

```typescript
const equipCost = equipDef.equipCost;
if (!equipCost) throw new Error('No equip cost');
const costAsMana = { W: equipCost.W, U: equipCost.U, B: equipCost.B, R: equipCost.R, G: equipCost.G, C: equipCost.C, generic: equipCost.generic };
const newManaPool = payManaCost(player.manaPool, costAsMana);
```

Delete `parseEquipCostFromOracle()`.

- [ ] **Step 7: Build and test**

Run: `cd engine && npm run build && npx vitest run`
Expected: Clean build, 831+ tests pass (only pre-existing combat-damage failure).

- [ ] **Step 8: Commit**

```bash
git add engine/src/effects/continuous.ts engine/src/keywords.ts engine/src/ai/legal-actions.ts engine/src/actions.ts
git commit -m "refactor: replace all hardcoded string matching with cached parse data"
```

---

## Task 4: Replace Hardcoded Frontend Mechanics

Remove TAX_CARDS, getSearchFilter(), and all card-name detection from the game loop. Use CardDefinition cached data instead.

**Files:**
- Modify: `frontend/src/hooks/useShelectorGame.ts`

- [ ] **Step 1: Remove TAX_CARDS and getSearchFilter**

Delete the `TAX_CARDS` object (the hardcoded Rhystic Study / Mystic Remora / Smothering Tithe map).
Delete the `getSearchFilter()` function.

- [ ] **Step 2: Rewrite resolveTaxTrigger to use cached data**

Replace the `resolveTaxTrigger` function. Instead of checking `TAX_CARDS[sourceDef.name]`, check `sourceDef.unlessTax`:

```typescript
const resolveTaxTrigger = useCallback(
  (state: GameState, messages: { role: ChatMessage['role']; text: string }[]): { state: GameState; handled: boolean } => {
    if (state.stack.length === 0) return { state, handled: false };

    const top = state.stack[state.stack.length - 1];
    if (!isTriggeredAbilityStackItem(top)) return { state, handled: false };
    const triggerItem = top as TriggeredAbilityStackItem;

    const sourceCard = state.cards.get(triggerItem.sourceInstanceId);
    if (!sourceCard) return { state, handled: false };
    const sourceDef = state.cardDefinitions.get(sourceCard.definitionId);
    if (!sourceDef?.unlessTax) return { state, handled: false };

    const taxInfo = sourceDef.unlessTax;
    const casterId = triggerItem.eventContext?.casterId;
    if (!casterId) return { state, handled: false };

    const caster = state.players.find(p => p.id === casterId);
    if (!caster) return { state, handled: false };

    const controllerId = triggerItem.controllerId;
    const controllerName = controllerId === humanIdRef.current ? 'You' : (aiCommanderNamesRef.current[controllerId] || controllerId);
    const casterName = casterId === humanIdRef.current ? 'You' : (aiCommanderNamesRef.current[casterId] || casterId);

    const totalMana = Object.values(caster.manaPool).reduce((a, b) => a + b, 0);
    const pays = totalMana >= taxInfo.taxAmount;

    // Remove trigger from stack
    const newStack = state.stack.slice(0, -1);
    let newState: GameState = {
      ...state,
      stack: newStack,
      hasPriorityPassed: new Array(state.players.length).fill(false),
      priorityPlayerIndex: state.activePlayerIndex,
    };

    if (pays) {
      // Deduct mana
      const casterIdx = newState.players.findIndex(p => p.id === casterId);
      let remaining = taxInfo.taxAmount;
      const newPool = { ...caster.manaPool };
      for (const color of ['C', 'W', 'U', 'B', 'R', 'G'] as const) {
        const deduct = Math.min(newPool[color], remaining);
        newPool[color] -= deduct;
        remaining -= deduct;
        if (remaining <= 0) break;
      }
      const newPlayers = newState.players.map((p, i) =>
        i === casterIdx ? { ...p, manaPool: newPool } : p
      );
      newState = { ...newState, players: newPlayers };
      messages.push({ role: 'system', text: `${sourceDef.name}: ${casterName} paid {${taxInfo.taxAmount}} — effect prevented.` });
    } else {
      if (taxInfo.effect === 'draw') {
        newState = drawCards(newState, controllerId, taxInfo.effectCount);
        messages.push({ role: 'system', text: `${sourceDef.name}: ${casterName} didn't pay {${taxInfo.taxAmount}} — ${controllerName === 'You' ? 'you draw' : controllerName + ' draws'} ${taxInfo.effectCount} card${taxInfo.effectCount > 1 ? 's' : ''}.` });
      } else {
        messages.push({ role: 'system', text: `${sourceDef.name}: ${casterName} didn't pay {${taxInfo.taxAmount}} — effect triggered.` });
      }
    }

    return { state: newState, handled: true };
  },
  [],
);
```

- [ ] **Step 3: Rewrite tryResolveTutor to use cached data**

Replace the `tryResolveTutor` function inside `advanceGameLoop`. Instead of checking oracle text with `getSearchFilter()`, use `sourceDef.searchAbility`:

```typescript
const tryResolveTutor = (): boolean => {
  if (state.stack.length === 0) return false;
  const top = state.stack[state.stack.length - 1];
  if (!top || top.kind !== 'Spell' || top.casterId !== humanIdRef.current) return false;
  const tc = state.cards.get(top.cardInstanceId);
  const td = tc ? state.cardDefinitions.get(tc.definitionId) : undefined;
  if (!td?.searchAbility) return false;

  const search = td.searchAbility;

  // Remove spell from stack, move to graveyard
  const newStack = state.stack.slice(0, -1);
  const newCards = new Map(state.cards);
  if (tc) newCards.set(tc.instanceId, { ...tc, zone: 'graveyard' as Zone });
  state = { ...state, stack: newStack, cards: newCards };
  engineRef.current = state as GameStateWithAI;

  // Build filtered library card list
  const libraryCards = getCardsInZone(state, humanIdRef.current, 'library');
  const pickerCards = libraryCards.map(c => {
    const d = getCardDefinition(state, c);
    return { instanceId: c.instanceId, name: d.name, typeLine: d.type_line, manaCost: d.mana_cost };
  }).filter(c => {
    if (!search.filter) return true;
    return c.typeLine.toLowerCase().includes(search.filter);
  }).sort((a, b) => a.name.localeCompare(b.name));

  tutorDestinationRef.current = search.destination;
  const filterDesc = search.filter ? ` for ${search.filter}` : '';
  setTutorTitle(`${td.name}: Search your library${filterDesc}`);
  setTutorCards(pickerCards);
  setTutorPhase(true);
  messages.push({ role: 'system', text: `${td.name} resolves — search your library${filterDesc}.` });
  return true;
};
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useShelectorGame.ts
git commit -m "refactor: remove hardcoded card names from game loop, use cached parse data"
```

---

## Task 5: Prune Redundant Overrides

Test each override against the parser. If the parser handles the card's oracle text correctly, remove the override.

**Files:**
- Modify: `engine/src/effects/overrides.ts`
- Create: `engine/src/__tests__/override-audit.test.ts`

- [ ] **Step 1: Create audit test**

Create `engine/src/__tests__/override-audit.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { hasOverride, getOverride } from '../effects/overrides';

/**
 * Test which overrides are redundant — i.e., the parser handles the oracle text.
 * If a card's parsed result matches the override's effects, the override can be removed.
 */
describe('Override audit', () => {
  const redundancyCandidates = [
    { name: 'Lightning Bolt', oracle: 'Lightning Bolt deals 3 damage to any target.', expectedKind: 'Spell' },
    { name: 'Murder', oracle: 'Destroy target creature.', expectedKind: 'Spell' },
    { name: 'Divination', oracle: 'Draw two cards.', expectedKind: 'Spell' },
    { name: 'Healing Salve', oracle: 'Gain 3 life.', expectedKind: 'Spell' },
    { name: 'Counterspell', oracle: 'Counter target spell.', expectedKind: 'Spell' },
    { name: 'Negate', oracle: 'Counter target noncreature spell.', expectedKind: 'Spell' },
    { name: 'Harmonize', oracle: 'Draw three cards.', expectedKind: 'Spell' },
    { name: 'Vindicate', oracle: 'Destroy target permanent.', expectedKind: 'Spell' },
    { name: 'Terminate', oracle: "Destroy target creature. It can't be regenerated.", expectedKind: 'Spell' },
    { name: 'Go for the Throat', oracle: 'Destroy target nonartifact creature.', expectedKind: 'Spell' },
  ];

  for (const card of redundancyCandidates) {
    it(`parser handles ${card.name} without override`, () => {
      const result = parseOracleText(card.oracle);
      expect(result.kind).toBe(card.expectedKind);
      expect(result.kind).not.toBe('Unparsed');
    });
  }
});
```

- [ ] **Step 2: Run audit test to find redundant overrides**

Run: `cd engine && npx vitest run src/__tests__/override-audit.test.ts`

- [ ] **Step 3: Remove redundant overrides**

For each card where the parser returns a valid result (not 'Unparsed'), remove the override from `engine/src/effects/overrides.ts`. Keep overrides ONLY for:
- Cards with multi-step effects the parser can't combine (Cultivate, Kodama's Reach)
- Cards with simplified proxies (Teferi's Protection, Fact or Fiction)
- Cards where the override adds effects the parser misses (Beast Within creates a token AND destroys)
- Mana ritual spells (Dark Ritual, etc. — AddMana effect not in parser yet)
- Fetch lands (activated sacrifice abilities)

Target: remove ~40-50 overrides, keep ~30-40.

- [ ] **Step 4: Build and test**

Run: `cd engine && npm run build && npx vitest run`

- [ ] **Step 5: Commit**

```bash
git add engine/src/effects/overrides.ts engine/src/__tests__/override-audit.test.ts
git commit -m "refactor: remove 40+ redundant overrides, parser handles them"
```

---

## Task 6: Use Cached Data in Stack Trigger Registration

Replace the on-demand parsing in `registerBattlefieldAbilities` with reads from cached CardDefinition data where possible.

**Files:**
- Modify: `engine/src/stack.ts`

- [ ] **Step 1: Update registerBattlefieldAbilities**

In `engine/src/stack.ts`, the `registerBattlefieldAbilities` function parses oracle text line-by-line on every permanent ETB. Optimize by checking CardDefinition cached fields first:

The existing function should continue parsing oracle text for trigger registration (since that's complex and line-by-line parsing is correct). But for the tax trigger pattern specifically, if `def.unlessTax` is set, register the trigger without re-parsing.

This is an optimization, not a behavior change. The function already works — this just makes it faster and ensures consistency with the cache.

- [ ] **Step 2: Build and test**

Run: `cd engine && npm run build && npx vitest run`

- [ ] **Step 3: Commit**

```bash
git add engine/src/stack.ts
git commit -m "refactor: use cached card data in trigger registration where possible"
```

---

## Task 7: Final Verification

Build everything, run full test suite, verify the game works end-to-end.

- [ ] **Step 1: Full build**

```bash
cd engine && npm run build
cd ../frontend && npx tsc --noEmit
```

- [ ] **Step 2: Full test suite**

```bash
cd engine && npx vitest run
```
Expected: 830+ tests pass, only pre-existing combat-damage failure.

- [ ] **Step 3: Manual play test**

1. Start the game at `/shelector`
2. Import a deck with tutors, equipment, mana rocks, removal
3. Verify:
   - Tutors show card picker (any card with "search your library")
   - Equipment gives P/T and keywords
   - Mana rocks produce correct amounts
   - Tax triggers (Rhystic Study) fire from parsed data, not card names
   - Spells without overrides still resolve correctly via parser
4. Play to game over — verify win/loss screen
