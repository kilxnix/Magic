# Engine + `useShelectorGame` hook API — inventory for the `useGameView` rebuild

Read-only inventory. Goal: map the new `GameView` contract onto the *real* engine/hook
data so the pure selector `useGameView(engineState) -> GameView` can be written accurately.

Key files (all absolute):
- Hook: `c:/Users/whate/Documents/AI Locally/Magic Brains/Magic/frontend/src/hooks/useShelectorGame.ts` (8950 lines)
- Current board: `c:/Users/whate/Documents/AI Locally/Magic Brains/Magic/frontend/src/components/GameBoard.tsx` (5168 lines)
- Layout constants: `c:/Users/whate/Documents/AI Locally/Magic Brains/Magic/frontend/src/lib/gameBoardLayout.ts`
- QA harness: `c:/Users/whate/Documents/AI Locally/Magic Brains/Magic/frontend/src/lib/qaGameScenarios.ts` (+ `qaGameScenarios.test.ts`)
- Engine package: imported as `'commander-engine'`; source under `c:/Users/whate/Documents/AI Locally/Magic Brains/Magic/engine/src` (barrel `engine/src/index.ts`).

> IMPORTANT CAVEAT FOR THE SELECTOR DESIGN: The new contract reads `useGameView(engineState) -> GameView`.
> But **the raw engine `GameState` alone does NOT contain legal actions, the targeting prompt, narration,
> per-card legal actions, `isYourTurn`, or `winner`** — those are *computed* by the hook (via engine functions
> like `getLegalActions` + a large amount of hook-side synthesis in `syncState`, lines 3307-3586). A pure
> `useGameView(engineState)` would have to re-run that derivation itself, OR the selector must take the hook's
> already-derived outputs (`legalActions`, `targetingPrompt`, `currentPrompt`, `chatMessages`, `isHumanTurn`,
> `winner`, `gameState`) as inputs. See the field map for which target fields require hook-level derivation.

---

## 1. Hook surface

### 1a. What `useShelectorGame()` returns

The hook returns one large object (literal at `useShelectorGame.ts:8851-8949`). It is NOT a single
`GameState`. The view-relevant members:

| member | type | source / notes |
|---|---|---|
| `gameState` | `SimpleGameState \| null` | the simplified board (see 1b). `:2746`, derived by `deriveSimpleState` `:2097`. |
| `legalActions` | `SimpleLegalAction[]` | the human's currently-legal actions, fully synthesized (see §2). `:2747`, set in `syncState` `:3580`. |
| `chatMessages` | `ChatMessage[]` | plain-language event narration (`{role:'shelector'\|'system'\|'player', text, timestamp}`, iface `:502`). Produced by `narrateDecisions` `:3592` and `addMessage` `:2929`. **This is the closest thing to `GameView.narration`.** |
| `gameLog` | `GameLogEntry[]` | structured per-action log w/ `playByPlay?`, `decision?`, `rulesAudit?` (iface `:481`). Alternate narration source. |
| `isLoading` | `boolean` | `:2749` |
| `isHumanTurn` | `boolean` | derived `:8844-8847`: `priorityPlayerId===human` OR a required combat decision OR (currentPrompt for human && legalActions>0). **Maps to `GameView.isYourTurn`.** |
| `isGameOver` | `boolean` | `gameState.gameOver ?? false` `:8848` |
| `winner` | `string \| null` | `gameState.winnerId ?? null` `:8849`. A player **id**, not a name. **Maps to `GameView.winner`.** |
| `opponentInfo` | `OpponentInfo \| null` | static deck-level info (`commander, colors, strategy, personality, deckSize`), iface `:508`. Not per-turn glance data. |
| `targetingPrompt` | `BoardTargetingPrompt \| null` | active board-target picker: `{label, sourceName, sourceInstanceId?, choices: TargetActionChoice[]}` iface `:300`. **Maps to `GameView.targeting`.** |
| `currentPrompt` | `EnginePrompt \| null` | engine-authored prompt w/ `priority: PrioritySnapshot`, `legalChoiceSummary`, `type`, `phase/step` (engine type, see §3). **Primary source for `GameView.priority`.** |
| `lastPlayedCard` | `LastPlayedCard \| null` | `{card, playerId, playerName, action:'Played'\|'Cast'\|'Activated', turnNumber}` iface `:443`. |
| `lastStateUpdate` / `authorityUpdates` | `EngineStateUpdate \| null` / `[]` | authoritative diffs (`visibleDiffs`, `rulesEvents`); engine type. Alt narration source. |
| `engineEventLog` | `EngineEventLogRecord[]` | replay/audit log (`engineEventLogRef.current`). |
| Choice sub-states | `libraryChoice`, `optionalTriggerChoice`, `taxPaymentChoice`, `wardPaymentChoice`, `damageAssignmentChoice`, `triggerOrderChoice` | modal mid-resolution decisions; each has a `resolve*` dispatcher (see §4). |
| Mulligan/discard/tutor | `mulliganPhase`, `mulliganCount`, `mulliganBottomCount`, `selectedMulliganCardIds`, `selectedMulliganBottomIds`, `discardPhase`, `discardCount`, `tutorPhase`, `tutorCards`, `tutorTitle` | pre-game / cleanup flows. |
| Modes | `coachMode`, `newPlayerMode`, `holdPriority`, `priorityStops` (`PriorityStops` `:156`), `untappableCardIds` | UI/coaching toggles. **`guided` ≈ `newPlayerMode`.** |
| `actionError` | `{reason, message} \| null` | last rejected-action error. |
| `endGame` | `EndGameState` (`:139`) | end-game modal state (`{open, kind:'win'\|'loss'\|'loop', reason?, loopSources?}`). |
| `undosRemaining` | `number` | |

(There is also `lastEvents: ActionGameEvent[]` for loop detection.)

### 1b. `SimpleGameState` — the board the hook derives (`useShelectorGame.ts:247-281`)

```ts
interface SimpleGameState {
  turnNumber: number;        // ROUND number (publicTurnNumber, not engine.turnNumber) :2201
  phase: string;             // engine.phase verbatim :2218
  step: string;              // display step ('main' for main phases) :2190-2193
  activePlayerId: string;
  priorityPlayerId: string;
  humanPlayer: SimplePlayer;
  humanCommander: string;    // commander NAME (string)
  humanHand: SimpleCard[];
  humanBattlefield: SimpleCard[];
  humanGraveyard: SimpleCard[];
  humanCommandZone: SimpleCard[];
  stack: { id; kind: StackItem['kind']; name; casterId; card?: SimpleCard; targetNames: string[] }[];
  gameOver: boolean;
  winnerId: string | null;
  manaPool: { W;U;B;R;G;C: number };   // human's pool
  diceRolls: SimpleDiceRoll[]; lastDiceRoll: SimpleDiceRoll | null;
  // multiplayer (keyed by AI player id):
  aiPlayers: SimplePlayer[];
  aiHands / aiBattlefields / aiGraveyards / aiCommandZones: Record<string, SimpleCard[]>;
  aiCommanderNames: Record<string, string>;
  // back-compat single-AI aliases (first AI): aiPlayer, aiCommander, aiHand, aiBattlefield, aiGraveyard, aiCommandZone
}
```

`SimplePlayer` (`:222`): `{ id, name, life, poisonCounters, commanderDamage: Record<string,number>, playerCounters: Record<string,number>, handCount, libraryCount }`.

`SimpleCard` (`:201`, built by `toSimpleCard` `:765`): `{ instanceId, name, manaCost, typeLine, oracleText, keywords[], power?, toughness?, tapped, zone, ownerId, cardTypes: string[], isCommander, counters: Record<string,number>, damage, isToken, attachedTo?, attachments?: SimpleCard[] }`.
- `power/toughness` are **effective** P/T on the battlefield (`getEffectivePower/Toughness`) else printed (`toSimpleCard:766-768`).
- `attachments` are nested under the parent and filtered out of the top-level battlefield list (`mapCards:1601-1614`).
- **No image URI** — see OPEN ITEM in §3.

### 1c. Dispatch / action API (functions returned by the hook)

The single primary entrypoint for a normal move:

```ts
submitAction(action: SimpleLegalAction): void    // useShelectorGame.ts:7486
```

`SimpleLegalAction` (`:283`): `{ kind: string, cardInstanceId?, cardName?, label, paymentPreview?, targetChoices?: TargetActionChoice[], _engineAction: AIAction }`.
You pass back the *same* `SimpleLegalAction` object the hook handed you in `legalActions` (its
`_engineAction` carries the raw engine `AIAction`). The UI never builds `AIAction` itself **except**
combat: `GameBoard` constructs `DeclareAttackers`/`DeclareBlockers` `SimpleLegalAction`s inline (see §2/§4).

Internally `submitAction` → `applyAuthoritativeAction` (`:7891`) →
`createClientActionRequest(state, playerId, action._engineAction, {source:'ui', label})` (`:7897`) →
`applyClientActionRequest(state, request)` (`:7901`). That is the validated engine commit primitive.
Special `kind`s short-circuit before that: `'SkipRestOfTurn'`→`skipRestOfTurn()`, `'SkipEmptyPhases'`→`skipEmptyPhases()`,
and any action with `targetChoices.length>1` arms the board-target prompt instead of committing (`:7546-7569`).

Other dispatchers returned by the hook:

| function | signature | purpose |
|---|---|---|
| `startGame` | `useCallback` `:5376` (StartGameOptions) | start a game |
| `spawnOpponent` | `async :5287` (SpawnOptions?) | create AI opponent |
| `keepHand` | `() => void` `:5613` | keep opening hand |
| `mulligan` | `(cardInstanceIds?: string[]) => void` `:5715` | London mulligan |
| `toggleMulliganCard` / `toggleMulliganBottomCard` | `(id) => void` | mulligan selection |
| `discardCard` | `(cardInstanceId) => void` `:5895` | cleanup discard |
| `resolveTutor` / `cancelTutor` | `(cardInstanceId) / ()` | search/tutor picker |
| `cancelTargeting` | `() => void` `:8593` | dismiss board-target prompt |
| `resolveLibraryChoice` | `(topIds[], movedIds[])` `:5011` | scry/surveil |
| `resolveOptionalTriggerChoice` | `(use: boolean)` `:5074` | "may" trigger |
| `resolveTaxPaymentChoice` / `resolveWardPaymentChoice` | `(pay: boolean)` | tax / ward |
| `resolveDamageAssignmentChoice` | `(orders: DamageAssignmentOrder[])` `:5206` | combat damage order |
| `resolveTriggerOrderChoice` | `(orderedTriggerIds: string[])` `:5246` | APNAP trigger ordering |
| `undoAction` | `() => void` `:6818` | undo (≤10) |
| Manual corrections | `untapManaSource`, `adjustCounters`, `adjustPlayerCounter`, `adjustCommanderDamage`, `moveCardManually`, `adjustDamage`, `createManualToken`, `attachCardManually`, `setPhaseStepManually` | each builds the corresponding `Manual*` `AIAction` and routes through authority. |
| Mode setters | `setCoachMode`, `setNewPlayerMode`, `setHoldPriority`, `setPriorityStop(key,on)`, `setAllPriorityStops(on)` | |
| `clearActionError` | `() => setActionError(null)` | |
| End-game | `closeEndGame`, `newGame`, `declareDraw`, `concedeGame`, `playItOut`, `reviewLog` | |
| Save/resume | `exportGameSave(): ShelectorGameSaveSnapshot \| null` `:8599`, `restoreGameSave(snapshot): boolean` `:8694` | |

### 1d. The engine `AIAction` union (the `_engineAction` payload) — `engine/src/ai/types.ts:167-184`

```ts
type AIAction =
  | CastSpellAction   { kind:'CastSpell'; cardInstanceId; targets: string[]; chosenModes?; namedCardChoices?;
                        cardChoices?; xValue?; faceName?; delveCardIds?; convokeCreatureIds?; improviseArtifactIds? }  // :12
  | PlayLandAction    { kind:'PlayLand'; cardInstanceId; chosenCreatureType?; chosenColor?; payLifeToEnterUntapped? }  // :29
  | ActivateManaAbilityAction { kind:'ActivateManaAbility'; cardInstanceId; color: ManaColor }  // :41
  | ActivateAbilityAction     { kind:'ActivateAbility'; cardInstanceId; abilityIndex: number; targets: string[] }  // :141
  | DeclareAttackersAction    { kind:'DeclareAttackers'; attacks: AttackerDeclaration[] }  // :125
  | DeclareBlockersAction     { kind:'DeclareBlockers'; blocks: BlockerDeclaration[] }  // :133
  | PassPriorityAction        { kind:'PassPriority' }  // :151
  | EquipAction               { kind:'Equip'; equipmentInstanceId; targetCreatureId }  // :158
  | ManualUntapManaSource / ManualAdjustCounters / ManualAdjustPlayerCounter / ManualAdjustCommanderDamage
  | ManualMoveCard / ManualAdjustDamage / ManualCreateToken / ManualAttachCard / ManualSetPhaseStep  // correction actions :52-120
```
`AttackerDeclaration = { cardInstanceId, defendingPlayerId }` (`engine/src/types.ts:383`).
`BlockerDeclaration  = { cardInstanceId, blockingAttackerId }` (`engine/src/types.ts:388`).

---

## 2. Legality / derivation in the *current* board

### How legal actions are obtained (the critical path: `syncState`, `useShelectorGame.ts:3307-3586`)

1. `engineActions = getLegalActions(engine, humanId)` (`engine/src/ai/legal-actions.ts:953`). This returns the
   engine's enumerated `AIAction[]`: combat declarations (if in a combat step — returned exclusively and
   mandatorily, `:957-966`), else (with priority) cast-spell / play-land / mana / activated-ability / equip /
   pass actions. **The engine only emits `CastSpell`/`ActivateAbility`/`Equip` when the mana is ALREADY in the
   pool.**
2. The hook then **synthesizes "virtual" actions** for plays that would be legal *after auto-tapping lands*:
   for every hand/command-zone card it computes `reducedSpellCost` + `findSpellPaymentPlan` and, if payable,
   pushes a synthetic `CastSpell` `SimpleLegalAction` with a `paymentPreview` (`:3351-3465`). Same for activated
   abilities (`:3467-3512`) and Equip (`:3514-3557`). Timing is enforced hook-side (instants/flash any time;
   sorcery-speed needs active player + main phase + empty stack).
3. Synthetic `SkipRestOfTurn` / `SkipEmptyPhases` actions are unshifted when no combat decision is pending (`:3560-3577`).
4. `collapseTargetedActions(dedupeSimpleActions(simpleActions), engine)` (`:3579`) merges many single-target
   variants of one spell into ONE `SimpleLegalAction` carrying `targetChoices: TargetActionChoice[]`
   (each `{targetId, label, action}`). `setLegalActions(visibleActions)` `:3580`.
5. `currentPrompt = buildVisibleActionPrompt(...)` (`:3581`) or `buildActionPrompt(engine)` when no actions.

Engine target enumeration used along the way: `getSpellTargetSpecs(state, card, opts): TargetSpec[]`
(`legal-actions.ts:48`) and `getLegalTargets(state, casterId, spec, sourceInstanceId?): string[]`
(`legal-actions.ts:108`). Activated abilities: `getActivatedAbilities(state, cardInstanceId): ActivatedAbility[]`
(`actions.ts:861`).

### How `GameBoard` consumes those (no extra engine calls — it reads `legalActions`)

- **Castable hand cards / playable permanents** (`GameBoard.tsx:2816-2821`): `playableIds = Set(legalActions.map(a=>a.cardInstanceId))`. Per-card primary action via `getPrimaryHandAction` `:3052` (prefers PlayLand, then CastSpell) and `getInspectAction` `:3074`. "Why no action" hints are hardcoded English in `getCardUnavailableHint` `:3117-3152`.
- **Eligible attackers / blockers** (`GameBoard.tsx:2889-2911`): derived purely from the combat `DeclareAttackers`/`DeclareBlockers` actions in `legalActions`. Every eligible attacker id appears in some `DeclareAttackers.attacks[]` → `eligibleAttackerIds`; every legal `(blocker→attacker)` pair appears in some `DeclareBlockers.blocks[]` → `legalBlockPairs: Map<blockerId, Set<attackerId>>`; defenders → `eligibleDefenderIds`. The board composes its own selection (`attackSelection`, `blockAssignments`) and builds a fresh `DeclareAttackers`/`DeclareBlockers` `SimpleLegalAction` on confirm (`confirmComposedAttack` `:2959`, `confirmComposedBlocks` `:2976`).
- **Legal targets / targeting highlight** (`GameBoard.tsx:2822-2853`): if `targetingPrompt` is active, only `targetingPrompt.choices[].targetId` glow; otherwise it reads `action._engineAction.targets` (+ `targetCreatureId` for Equip) from each non-collapsed legal action to highlight baked-in targets.
- **Stack** (`SimpleGameState.stack`, built in `deriveSimpleState:2137-2175`) plus richer `currentPrompt.priority.stackTop`/`stackSize`.
- **Combat / priority / phase state**: `currentPrompt` (`EnginePrompt`) — `priority: PrioritySnapshot` and `type: PromptType` ('declare-attackers'|'declare-blockers'|'priority'|'stack-response'|'main-action'|'game-over').
- **Opponent display** (`GameBoard.tsx:4196-4280`): iterates `gameState.aiPlayers`; shows commander name+image, `life`, `handCount`, `libraryCount`, player/poison counter badges, command zone. **No open-mana, total-power, creature-count, or flags computed today.**
- **Battlefield bucketing**: `groupBattlefieldCards(cards, stackLands)` (exported `GameBoard.tsx:519`) → rows keyed `creatures|artifacts|enchantments|lands|other` via `getBattlefieldRowKey` `:205`.
- **Examine / zoom**: `setInspectedCard(card)` / `handleCardClick` `:3048`; hover via `handleCardHover`; image zoom inside `CardImage` (`showHoverZoom`). No engine call — pure UI state over a `SimpleCard`.
- **Engine "feed"**: the `aria-label="Engine event feed"` panel (`:3911`) renders `authorityUpdates`/`lastStateUpdate.visibleDiffs` (summarized by `summarizeStateUpdate` `:215` / `summarizeVisibleDiffs`) plus `buildComplexTurnSignals` `:342` heuristics.

---

## 3. `GameView` field → engine source map

`you.*`

| GameView field | Source |
|---|---|
| `you.life` | `SimpleGameState.humanPlayer.life` ← `getPlayer(engine,humanId).life`. Engine: `Player.life` (`engine/src/types.ts:444`). |
| `you.creatures` | `humanBattlefield.filter(getBattlefieldRowKey===  'creatures')` i.e. `cardTypes.includes('creature')` (`GameBoard.tsx:206`). |
| `you.lands` | `humanBattlefield.filter(cardTypes.includes('land'))`. |
| `you.other` | `humanBattlefield` minus creatures/lands (artifacts/enchantments/other rows). |
| `you.hand` | `SimpleGameState.humanHand` ← `mapCards(engine,'hand',humanId)`. |

`PermanentView` / `HandCardView`

| field | Source |
|---|---|
| `id` | `SimpleCard.instanceId` ← `CardInstance.instanceId`. |
| `name` | `SimpleCard.name` ← `getCardDefinition(engine,inst).name`. |
| `tapped` | `SimpleCard.tapped` ← `CardInstance.tapped` (`types.ts:62`). |
| `power`/`toughness` | `SimpleCard.power/toughness` ← `getEffectivePower/Toughness` on battlefield else printed (`toSimpleCard:766`). |
| `counters` | `SimpleCard.counters` ← `CardInstance.counters` (`types.ts:64`). |
| `isLand`/`isCreature` | derive from `SimpleCard.cardTypes` (`cardTypes.includes('land'|'creature')`); engine: `CardDefinition.card_types`. |
| `manaCost` (hand) | `SimpleCard.manaCost` ← `CardDefinition.mana_cost`. |
| `isAttacking` | `engine.combat.attackers[].cardInstanceId` (`CombatState`, `types.ts:394`) — NOT on `SimpleCard`. Today GameBoard derives "eligible" from `legalActions`, and committed attackers from `currentPrompt`/`CombatSummary`. **Partial.** |
| `isBlocking` | `engine.combat.blockers[].cardInstanceId`. Same as above. **Partial.** |
| `legalActions: LegalAction[]` | filter `legalActions` by `cardInstanceId===id` (`GameBoard.tsx:3056`). Requires the HOOK's derived `legalActions`, not raw `GameState`. |
| `imageUri?` | **OPEN ITEM:** No image URI exists on `SimpleCard`/`CardInstance`/`CardDefinition`. The UI resolves images by NAME via `<CardImage cardName={...}/>` (backend `/api/card-image/{name}` + Scryfall fallback). Closest data: `SimpleCard.name`. Selector should emit `name` and let the view resolve, or add a name→uri lookup. |

`LegalAction`

| field | Source |
|---|---|
| `id` (engine action id to dispatch) | **OPEN ITEM:** `SimpleLegalAction` has no stable id. Dispatch is by passing the whole object back to `submitAction` (its `_engineAction`). `EnginePrompt.legalChoices[].id` (`authority.ts:773`) DOES have ids if you drive via `currentPrompt` instead. Closest: synthesize `legalActionIdentity(action)` (`useShelectorGame.ts:2722`) or use `_engineAction`. |
| `kind` | `SimpleLegalAction.kind` (mirrors `AIAction['kind']` + synthetic `SkipRestOfTurn`/`SkipEmptyPhases`). |
| `label` | `SimpleLegalAction.label` (built in `toSimpleLegalAction:2394`). |
| `whyDisabled?` | **OPEN ITEM:** legal actions are by definition enabled. Disabled-reason English lives only in `getCardUnavailableHint` (`GameBoard.tsx:3117`) for cards with NO action, and `actionError.message` for rejected attempts. No per-action disabled metadata in the engine. |

`opponents: OpponentGlance[]` (per AI player; today only a subset exists)

| field | Source |
|---|---|
| `playerId` | `SimplePlayer.id` (`aiPlayers[i].id`). |
| `name` | `SimplePlayer.name` (= `aiCommanderNames[id]`). |
| `life` | `SimplePlayer.life`. |
| `commanderDamageToYou` | `SimpleGameState.humanPlayer.commanderDamage` ← `getPlayer(engine,humanId).commanderDamage: Record<commanderInstanceId, number>` (`types.ts:450`). Keyed by the opponent's commander instance id, not playerId — selector must map commander instance → controller. |
| `handCount` | `SimplePlayer.handCount` ← `getCardsInZone(engine,aiId,'hand').length`. |
| `creatureCount` | derive: `aiBattlefields[id].filter(cardTypes.includes('creature')).length`. Not precomputed. |
| `totalPower` | **OPEN ITEM (new):** not computed today. Compute `sum(getEffectivePower(engine, c.instanceId))` over the opponent's battlefield creatures, or sum `SimpleCard.power` on `aiBattlefields[id]` creatures. |
| `openMana` (untapped mana sources) | **OPEN ITEM (new):** not computed today. Closest: count untapped permanents on `aiBattlefields[id]` whose `CardDefinition.manaProduction` is set / oracle adds mana. The engine has `manaSourceAutoTapRank` (`useShelectorGame.ts:1688`) and `findLandsToTap` for the human; nothing exposes opponent open mana. Approximate from `aiBattlefields[id]` untapped lands/rocks. |
| `flags[]` | **OPEN ITEM (new):** no notion of opponent "flags" exists. Could derive from board signals (e.g. monarch = `engine.monarchId`, poison via `SimplePlayer.poisonCounters`, `playerCounters`). Define ad hoc. |

`stack: StackItemView[]`

| field | Source |
|---|---|
| `id` | `SimpleGameState.stack[].id` ← `StackItem.id`. |
| `controllerName` | `SimpleGameState.stack[].casterId` (resolve to player name); engine: `SpellStackItem.casterId` / `*.controllerId` (`types.ts:279/302/325`). |
| `title` | `SimpleGameState.stack[].name` (e.g. "Foo", "Foo trigger", "Foo ability") built `deriveSimpleState:2137-2166`; or `currentPrompt.priority.stackTop.name`. |
| `description` (plain language) | **OPEN ITEM:** no plain-language stack description today. Closest: `name` + `targetNames` (`SimpleGameState.stack[].targetNames` `:2173`). Effects text would need parsing/synthesis. |
| `resolvesNext` | top of stack = last array element. `currentPrompt.priority.canResolveTopOfStack` (`PrioritySnapshot`, `authority.ts:792`) tells whether it can resolve now. |

`priority`

| field | Source |
|---|---|
| `hasPriority` | `gameState.priorityPlayerId === humanId`, or hook's `isHumanTurn`. Engine: `Player.hasPriority` (`types.ts:465`) / `priorityPlayerIndex`. |
| `phaseLabel` | from `gameState.phase`/`step` or `currentPrompt.phase`/`step`. Display names in `GameBoard.tsx:319-326` / `:99-109`. |
| `hasMeaningfulResponse` | **OPEN ITEM:** closest is `isEmptyWindowSkippable(legalActions)` (`useShelectorGame.ts:474`) — its negation ≈ "has a meaningful action". Also `hasMeaningfulHumanActionForAutoSkip` (`:2021`). |
| `canPass` | `legalActions.some(a=>a.kind==='PassPriority')` (`GameBoard.tsx:2855`), gated by `currentPrompt.canSubmit` (`authority.ts:809`). |
| `canHold` | `holdPriority` flag + setter; engine has no "hold". UI concept only. |

`targeting`

| field | Source |
|---|---|
| `active` | `targetingPrompt != null`. |
| `prompt` | `targetingPrompt.label` / `.sourceName`. |
| `minTargets`/`maxTargets` | **OPEN ITEM:** `BoardTargetingPrompt` has no min/max; it carries a flat `choices` list (one target each). The underlying count lives in `TargetSpec.count` (`getSpellTargetSpecs`) but is not surfaced on `targetingPrompt`. For single-target collapsed actions, max=1. |
| `legalTargetIds[]` | `targetingPrompt.choices[].targetId` (`BoardTargetingPrompt.choices`, `:304`). |
| `selectedTargetIds[]` | **OPEN ITEM:** current flow resolves one target per tap (no multi-select accumulation in the prompt). No "selected targets" array is tracked on `targetingPrompt`. |

`combat`

| field | Source |
|---|---|
| `step` | from `gameState.step` / `currentPrompt.type`: `'declare_attackers'`→`'declare-attackers'`, `'declare_blockers'`→`'declare-blockers'`. `'order-damage'` ← `damageAssignmentChoice != null`. else `'none'`. |
| `eligibleIds[]` | declare-attackers: `eligibleAttackerIds` (from `DeclareAttackers.attacks` in `legalActions`, `GameBoard.tsx:2889-2900`); declare-blockers: keys of `legalBlockPairs` (`:2901-2906`). |
| `assignments{}` | UI-composed `attackSelection`/`blockAssignments` (board state). Committed state: `engine.combat.attackers/blockers` (`CombatState`, `types.ts:393`) or `currentPrompt`/`EngineStateUpdate` `CombatSummary` (`authority.ts:953`). |

`narration: NarrationEntry[]`

| field | Source |
|---|---|
| narration lines | `chatMessages` (`{role:'shelector'\|'system'\|'player', text}`) — primary plain-language log (`narrateDecisions:3592`). Structured alternative: `gameLog[].playByPlay` (`GameLogEntry`, `:481`). Engine-diff alternative: `lastStateUpdate.visibleDiffs` summarized via `summarizeStateUpdate`. |

top-level

| field | Source |
|---|---|
| `guided` | `newPlayerMode` (hook flag). |
| `isYourTurn` | `isHumanTurn` (hook, `:8844`). |
| `winner` | `winner` = `gameState.winnerId` (player **id**). To show a name, resolve via `players`/`aiCommanderNames`. |

---

## 4. Action dispatch map (LegalActionKind → exact engine/dispatch call)

In all rows below, `act` = the `SimpleLegalAction` from `legalActions`. The hook's `submitAction(act)`
ultimately does `createClientActionRequest(state, humanId, act._engineAction, {source:'ui', label})` →
`applyClientActionRequest(state, request)` (`useShelectorGame.ts:7897-7901`). The engine `AIAction.kind`
inside `_engineAction` is what the authority layer dispatches on.

| LegalActionKind | How to perform it |
|---|---|
| **cast** | `submitAction(act)` where `act._engineAction.kind==='CastSpell'` (`CastSpellAction`: `cardInstanceId`, `targets[]`, optional `xValue`/`faceName`/`chosenModes`/convoke/delve/improvise). If `act.targetChoices.length>1`, `submitAction` first arms `targetingPrompt`; the chosen `TargetActionChoice.action` is then submitted (`:7546-7569`). Hook auto-taps lands via an internal payment prompt before committing (`applyAuthoritativePaymentPrompt` `:7918`). |
| **play-land** | `submitAction(act)`; `_engineAction.kind==='PlayLand'` (`cardInstanceId`, optional `chosenCreatureType`/`chosenColor`/`payLifeToEnterUntapped` → these surface secondary prompts, `:pendingPlayLandChoiceRef`). |
| **activate** | `submitAction(act)`; `_engineAction.kind==='ActivateAbility'` (`cardInstanceId`, `abilityIndex`, `targets[]`). Mana auto-tapped first if needed. For mana abilities specifically: `_engineAction.kind==='ActivateManaAbility'` (`cardInstanceId`, `color`). |
| **equip** | `submitAction(act)`; `_engineAction.kind==='Equip'` (`equipmentInstanceId`, `targetCreatureId`). |
| **attack** | Board builds the action itself and calls `onAction`/`submitAction` with `_engineAction = { kind:'DeclareAttackers', attacks: [{cardInstanceId, defendingPlayerId}] }` (`confirmComposedAttack`, `GameBoard.tsx:2959-2971`). Eligible set comes from the engine-enumerated `DeclareAttackers` options in `legalActions`. |
| **block** | Board builds `_engineAction = { kind:'DeclareBlockers', blocks: [{cardInstanceId, blockingAttackerId}] }` (`confirmComposedBlocks`, `GameBoard.tsx:2976-2988`). Legal pairs from `legalBlockPairs`. "No blocks" = empty `blocks`. |
| **order-damage** | NOT via `submitAction`. Use `resolveDamageAssignmentChoice(orders: DamageAssignmentOrder[])` (`:5206`) when `damageAssignmentChoice` is set. |
| **choose-target** | Not a standalone dispatch. Targets are baked into the cast/activate `_engineAction.targets`. The board-target UX: tap a spell with `targetChoices` → `targetingPrompt` arms → tap a glowing target → `submitAction(choice.action)` (the per-target `SimpleLegalAction`). Cancel via `cancelTargeting()` (`:8593`). (Mid-resolution engine target prompts use `createSelectTargetPromptRequest`/`applySelectTargetPromptResponse`.) |
| **pass** | `submitAction(act)` where `act.kind==='PassPriority'` (label is context-aware: "Done"/"Don't Respond"/"Go to Combat"/"End Turn", `:2603-2619`). Synthetic `SkipRestOfTurn`→`skipRestOfTurn()` (`:7308`) and `SkipEmptyPhases`→`skipEmptyPhases()` (`:7198`) batch-pass. |
| **hold** | No engine action. `setHoldPriority(on)` toggles a hook flag (`:2874`) that changes auto-pass behavior; `priorityStops` (`setPriorityStop`/`setAllPriorityStops`) controls where the loop stops. |
| **mulligan** | `mulligan(cardInstanceIds?)` (`:5715`) / `keepHand()` (`:5613`); selection helpers `toggleMulliganCard`/`toggleMulliganBottomCard`. Engine primitives used internally: `redrawOpeningHandForMulligan`, `bottomOpeningHandCardsForMulligan`, `applyOpeningMulliganRedraw`. |
| **examine** | Pure UI, no dispatch: `setInspectedCard(card)` / hover (`handleCardClick` `:3048`, `handleCardHover`). Image zoom is internal to `<CardImage>`. |

### Engine commit primitives worth naming for the rebuild
- `getLegalActions(state, playerId): AIAction[]` — `engine/src/ai/legal-actions.ts:953`
- `getSpellTargetSpecs(state, card, opts): TargetSpec[]` — `legal-actions.ts:48`
- `getLegalTargets(state, casterId, spec, srcId?): string[]` — `legal-actions.ts:108`
- `getActivatedAbilities(state, cardInstanceId): ActivatedAbility[]` — `actions.ts:861`
- `createClientActionRequest(state, playerId, action, opts)` + `applyClientActionRequest(state, req): ClientActionResponse` — `engine/src/authority.ts` (validated dispatch; returns `{ok, state?, update?, events?, reason?, message?}`).
- Imperative `try*` helpers (used by the QA harness, `engine/src/actions-public.ts`): `tryPlayLand`, `tryTapLandForMana`/`tapLandForMana`, `tryCastSpell`, `tryActivateAbility`, `tryDeclareAttackers`, `tryDeclareBlockers`, `tryEquip`, `tryPassPriority`, plus `advanceStep`, `resolveTopOfStack`, `resolveCombatDamage`, `checkStateBasedActions`, `putTriggersOnStack`.

### Relevant engine types (exact names, all from `'commander-engine'`)
`GameState` (`engine/src/types.ts:558`), `Player` (`:441`), `CardInstance` (`:57`), `CardDefinition`,
`StackItem`=`SpellStackItem|TriggeredAbilityStackItem|ActivatedAbilityStackItem` (`:342`),
`CombatState` (`:393`), `AttackerDeclaration`/`BlockerDeclaration` (`:383`/`:388`), `ManaPool` (`:411`),
`Phase`/`Step`/`Zone` (`:7`/`:9`/`:5`), `AIAction` (`ai/types.ts:167`),
`EnginePrompt`/`PrioritySnapshot`/`PromptType`/`StackObjectSummary`/`EngineStateUpdate`/`VisibleDiff`/`CombatSummary`
(`authority.ts:795/786/765/946/1048/812/953`).

---

## Summary of OPEN ITEMs (fields with no clean engine source)
1. `PermanentView.imageUri` / `HandCardView.imageUri` — images are resolved by card NAME via `<CardImage>` + backend; no URI on any engine/simple type. Emit `name`.
2. `LegalAction.id` — `SimpleLegalAction` has no stable id; dispatch is by object (`_engineAction`). `EnginePrompt.legalChoices[].id` exists if driving via the prompt API.
3. `LegalAction.whyDisabled` — legal actions are always enabled; "why no action" English exists only in `getCardUnavailableHint` and `actionError`.
4. `OpponentGlance.openMana`, `.totalPower`, `.creatureCount`, `.flags[]` — none computed today; derive from `aiBattlefields[id]` (untapped mana sources, summed power, creature count) and board signals (`monarchId`, poison, `playerCounters`).
5. `stack[].description` (plain language) — only `name` + `targetNames` exist; no parsed effect description.
6. `priority.hasMeaningfulResponse` — approximate via `!isEmptyWindowSkippable(legalActions)` / `hasMeaningfulHumanActionForAutoSkip`.
7. `targeting.minTargets`/`maxTargets`/`selectedTargetIds` — `BoardTargetingPrompt` is single-tap-per-target with a flat `choices` list; counts live upstream in `TargetSpec.count` but aren't surfaced.
8. `PermanentView.isAttacking`/`isBlocking` — only partially derivable from `legalActions` (eligibility) + `engine.combat`/`currentPrompt` (committed); not flags on `SimpleCard`.

## Critical architecture note for `useGameView`
A literally-pure `useGameView(engineState: GameState) -> GameView` would have to **re-implement** `syncState`'s
heavy derivation (virtual auto-tap cast/activate/equip actions, `collapseTargetedActions`, target enumeration,
combat eligibility). In practice the hook already produces `gameState` (SimpleGameState), `legalActions`,
`currentPrompt`, `targetingPrompt`, `chatMessages`, `isHumanTurn`, and `winner`. The selector should accept those
hook outputs (not the raw engine `GameState`) for everything in OPEN ITEMs 2/3/6/7/8 and the per-card
`legalActions`, and use the raw engine `GameState` only for the additive opponent-glance math (OPEN ITEM 4) and
effective P/T already captured in `SimpleCard`.
