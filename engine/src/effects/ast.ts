// Phase 4 (parser-first): Effect system AST types
// Phase 10: Extended with modal, X costs, tokens, and more primitives
// Phase 14: Expanded with ForEach, ExileFromLibrary, GainControl, and more patterns
// Phase 15: Static/continuous abilities and conditional effects
// Phase 16: Blink/flicker, copy effects, keyword granting, phasing
// Phase 17: Planeswalker loyalty abilities and additional trigger types

import type { TargetSpec } from './targets';

export type Effect =
  | DrawEffect
  | DestroyEffect
  | DealDamageEffect
  | DealDamageDividedEffect
  | DealDamageEachTargetEffect
  | DealDamageForExiledCardsEffect
  | PreventDamageEffect
  | GainLifeEffect
  | LoseLifeEffect
  | ExileEffect
  | ExileAllGraveyardsEffect
  | ExileNFromGraveyardEffect
  | PutIntoLibraryEffect
  | ReturnToHandEffect
  | BounceControlledByPlayerEffect
  | SacrificeEffect
  | SacrificeSelfUnlessPlayerSacrificesEffect
  | SacrificeSelfUnlessPayEffect
  | MillEffect
  | AddCountersEffect
  | DistributeCountersEffect
  | RemoveCountersEffect
  | TapEffect
  | UntapEffect
  | CreateTokenEffect
  | RollD20Effect
  | FightEffect
  | DiscardEffect
  | ScryEffect
  | SurveilEffect
  | LookAtHandEffect
  | LookAtTopOfLibraryEffect
  | RevealHandChooseCardEffect
  | SearchLibraryEffect
  | ChooseFromTopOfLibraryEffect
  | PutCardsFromHandOnTopEffect
  | ShuffleLibraryEffect
  | CounterSpellEffect
  | ReturnFromGraveyardEffect
  | ModifyPTEffect
  | ExileFromLibraryEffect
  | ExileUntilNamedEffect
  | GainControlEffect
  | ConditionalEffect
  | BlinkEffect
  | ReturnFromExileEffect
  | CopyEffect
  /**
   * Slice 7 (becomes-copy): "~ becomes a copy of target creature until end of turn."
   * (Mirrorweave / Sakashima / Vesuvan Shapeshifter family.)
   * Temporarily replaces the target permanent's definitionId with that of the chosen
   * copy source. Reversed at end-of-turn cleanup (cleanupDamage clears
   * `becomesCopyOfDefinitionId` on each battlefield card).
   */
  | BecomesCopyEffect
  | CopySpellEffect
  | GrantKeywordEffect
  | LoseKeywordEffect
  | PhaseOutEffect
  | PreventGameOutcomeEffect
  | WinGameEffect
  | LoseGameEffect
  | AddManaEffect
  | GoadEffect
  | RegenerateEffect
  | ProliferateEffect
  | ExploreEffect
  | BecomeMonarchEffect
  | ConniveEffect
  | AmassEffect
  | PopulateEffect
  | AdaptEffect
  | BolsterEffect
  | MonstrosityEffect
  | FabricateEffect
  | MentorEffect
  | OptionalPayEffect
  | RevealTopMatchEffect
  | RevealUntilMatchEffect
  | ReturnAllFromGraveyardEffect
  | PutLandFromHandOntoBattlefieldEffect
  | AttachEffect
  | EnterAsCopyEffect
  /** Slice 11: "Target spell can't be countered [this turn]." — grants the
   *  cantBeCountered flag to a specific stack item (Vexing Shusher family). */
  | GrantCantBeCounteredEffect
  /**
   * Slice 5 (bite family): "Each other <Subtype> you control deals damage equal
   * to its power to <target>." (Bartz and Boko family.)
   * Each matching permanent on the battlefield deals damage equal to its OWN
   * power to the effect's target — amount varies per-permanent, so this cannot
   * be modelled as a fixed AmountRef.  The executor iterates matching permanents
   * and calls executeDealDamage(state, targetId, getEffectivePower(state, permanentId)).
   */
  | DealDamageAllByPowerEffect
  /**
   * Slice 9 (counter-migration): "put its counters on [up to one] target creature"
   * / "move a +1/+1 counter from this artifact onto target creature."
   *
   * Atomically reads the count of `counterType` from the source permanent
   * (or a fixed `count` for the Weapon Rack activated form), removes them
   * from `source`, and places them on `target`. The executor composes
   * executeRemoveCounters + executeAddCounters.
   *
   * `allCounters` is true for the "put its counters on" wording where ALL
   * counters of every type are moved. `count` is the fixed amount to move
   * (used only when allCounters is false).
   */
  | MoveCountersEffect
  /**
   * Slice 5 (Transform): "transform ~" / "transform Growing Rites of Itlimoc."
   * Flips the source permanent to its back face by setting activeFaceName to the
   * name of face index 1 (Scryfall face ordering: [front, back]).
   * Idempotent — if already transformed, no-ops.
   */
  | TransformSelfEffect
  /**
   * Slice 10: "Your opponents can't cast spells this turn." (Silence family).
   * The executor registers a SpellCastProhibitionRef covering all opponents for
   * the remainder of the current turn. canCastSpell (stack.ts) checks this list
   * before allowing a cast.
   */
  | OpponentsCantCastSpellsEffect
  /**
   * Slice 10: "You may choose new targets for target spell or ability."
   * (Deflecting Swat family). For v1 honesty, only rewrites a single-target
   * spell's targets array on the stack. The newTargetId is a runtime player
   * choice supplied via options; the executor falls back to a no-op if the
   * targeted spell has ≠ 1 target or the new target is not a valid card/player.
   */
  | ChangeSpellTargetsEffect
  /**
   * Slice 1 (base P/T set): "Target creature has base power and toughness N/M
   * until end of turn." (Diminish / Square Up / Sorceress Queen / Water Wings
   * family.) Layer 7b SET — overrides the printed value and all equipment/aura
   * base-set bonuses for the remainder of the turn. Stored as special counters
   * `_setBasePower` / `_setBaseToughness` on the target card instance, cleared
   * at end-of-turn cleanup (cleanupDamage). Optional `keywords` are granted
   * simultaneously (e.g. Water Wings: "…and gains flying and hexproof").
   */
  | SetBasePTEffect
  /**
   * Slice 9 (pump + grant-quoted-dies-ability):
   * "Target creature gets +N/+N and gains \"When this creature dies, <effect>\"."
   * (Demonic Gifts / Supernatural Stamina / Galuf's Final Act family.)
   *
   * Grants a transient Dies-trigger to the target creature by adding it to
   * `battlefieldAbilities`. The trigger fires once when the creature dies
   * (state-based.ts looks for `trigger.kind === 'Dies' && trigger.who === 'self'`).
   * Inner effect must be executor-backed; only ReturnFromGraveyard and AddCounters
   * bodies are accepted (the executor already runs those via the Dies path).
   *
   * `untilEndOfTurn` is always true (spells grant the trigger for the turn;
   * if the creature dies before cleanup, the trigger fires once — MTG-correct).
   */
  | GrantDiesTriggerEffect
  /**
   * Slice 10 (pump + all creature types): "creatures you control get +2/+0 and
   * gain all creature types until end of turn." (Volatile Claws / Shields of Velis
   * Vel / Blades of Velis Vel family.)
   *
   * Sets `grantedAllCreatureTypes = true` on each affected CardInstance for the
   * turn. matchesCardFilter bypasses the subtypes check when this flag is set.
   * Cleared at end-of-turn cleanup (cleanupDamage in state-based.ts).
   */
  | GrantAllCreatureTypesEffect
  /**
   * Slice 9 (switch P/T): "Switch [target creature's | its] power and toughness
   * until end of turn." (Dwarven Thaumaturgist / Merfolk Thaumaturgist /
   * Valakut Fireboar family.)
   *
   * Layer 7c swap — stores `_switchPT: 1` on the target's counters. Cleared at
   * end-of-turn cleanup (cleanupDamage in state-based.ts). getEffectivePower and
   * getEffectiveToughness in continuous.ts read the opposite axis when the flag
   * is present, implementing the MTG layer-7c characteristic-swapping rule.
   */
  | SwitchPowerToughnessEffect
  /**
   * Slice 8/11: 'Cast from a revealed hand' coercion
   * "Target opponent reveals their hand. You may cast an instant or sorcery spell
   *  from among those cards without paying its mana cost." (Mindclaw Shaman, etc.)
   *
   * The opponent reveals their hand; the controller finds the highest-mana-value
   * card matching `filter` and places it directly on the stack as a SpellStackItem
   * under the controller's casterId (without paying mana). The card moves from the
   * opponent's hand to zone 'stack'. When the spell resolves normally it goes to
   * the owner's (opponent's) graveyard.
   *
   * HONESTY: only instant/sorcery types are claimed (they are the type filter
   * in Mindclaw Shaman). The card enters the stack without paying mana cost,
   * resolves normally, and goes to the owner's graveyard. SpellCast event triggers
   * ("whenever you cast a spell") do NOT fire from this executor path because that
   * would require importing from stack.ts (circular dependency); this is an
   * acknowledged gap consistent with how other direct-stack effects work.
   */
  | CastFromRevealedHandEffect
  /**
   * Slice 9 (reveal-top-distribute): "Reveal the top N cards of your library.
   * An opponent chooses one [of them]. Put that card into your <chosenDestination>
   * and the rest into your <restDestination>." (Murmurs from Beyond / Truth or Tale
   * / Allure of the Unknown family — single-pile form).
   *
   * The opponent selects exactly one card from the revealed set via the prompt
   * system (namedCardChoices key `opponentChosenCardId`). The chosen card goes
   * to `chosenDestination`; the remaining N-1 cards go to `restDestination`.
   * An optional `filter` restricts which cards the opponent may choose (e.g.
   * Allure of the Unknown: "exiles a nonland card from among them").
   */
  | RevealTopDistributeEffect
  /**
   * Slice 9 (reveal-top-split-two-piles): "Reveal the top N cards of your library
   * [and separate them into two piles / Separate them into two piles].
   * An opponent chooses one of those piles. Put that pile into your <hand|graveyard>
   * and the other into your <graveyard|hand>."
   * (Steam Augury / Fact-or-Fiction family — two-pile form.)
   *
   * The controller splits the N revealed cards into two piles (pile A and pile B)
   * via `namedCardChoices[pileSplitChoiceId]` (a comma-separated list of instance
   * ids forming pile A; the rest form pile B).  An opponent then chooses one pile
   * via `namedCardChoices[opponentChosenPileChoiceId]` = 'A' or 'B'.
   *
   * AI fallback (no explicit choices):
   *  - Split: lower-MV cards in pile A, higher-MV cards in pile B (roughly equal halves).
   *  - Opponent picks: 'B' (the higher-MV pile — worst for the controller).
   *
   * `pileChosenDestination` — where the opponent-chosen pile goes ('hand' or 'graveyard').
   * `pileOtherDestination`  — where the unchosen pile goes (complement of above).
   */
  | RevealTopSplitTwoPilesEffect
  /**
   * Slice 7 (lure/forced-block): "All creatures able to block <subject> [this turn] do so."
   * (Elvish Bard, Breaker of Armies, Nemesis Mask equipped creature, Taunting Challenge
   * target creature, Goldenhide Ox 'must be blocked this turn if able' family.)
   *
   * At resolution, writes the lured creature's instanceId into
   * `state.combat.luredCreatureIds` (or queues it for the current turn via
   * CardInstance.grantedKeywords 'MustBeBlockedIfAble' for the static / non-combat form).
   * combat.ts `declareBlockers` reads `luredCreatureIds` and forces every creature
   * that canBlock the lured creature to do so (CR 509.1a / lure rule).
   *
   * `subject`:
   *   - 'Source'          — the source card itself (Elvish Bard static / Breaker of Armies)
   *   - 'SourceAttachedTo'— the equipped/enchanted creature (Nemesis Mask)
   *   - 'Chosen'          — a targeted creature named at cast time (Taunting Challenge)
   */
  | MustBeBlockedIfAbleEffect
  | SetCreatureTypeEffect
  /**
   * Slice 12 (en-Kor family): "The next N damage that would be dealt to this
   * creature this turn is dealt to target creature [you control] instead."
   *
   * Registers a damage-redirect shield on the source permanent (or the Source
   * TargetRef). When the next N points of damage would be dealt to the source
   * creature this turn, the damage is redirected to the chosen target creature
   * instead. Uses the existing DamagePreventionEffectRef infrastructure with
   * a new `redirectToId` field for the chosen target.
   *
   * `amount` — the N in "next N damage" (typically 1 for en-Kor).
   * `redirectTarget` — the Chosen TargetRef for the creature receiving the damage.
   */
  | RedirectDamageEffect
  /**
   * Slice 12 (Licid family): "{cost}: This creature loses this ability and
   * becomes an Aura enchantment with enchant creature. Attach it to target
   * creature you don't control [or that you control]."
   *
   * Sets `licidAura: true` and `attachedTo: chosenCreatureId` on the source
   * permanent. While licidAura is set, `getEffectiveCardTypes` returns
   * ['enchantment'] only, making the permanent function as an Aura on the
   * battlefield. The attachment is handled exactly like Equipment's `attachedTo`.
   *
   * This effect only claims the "become Aura + attach" step. The Licid's second
   * activated ability ("{0}: ~ leaves the battlefield and its last ability
   * doesn't trigger...") is separate and not claimed here.
   */
  | LicidTransformEffect
  /**
   * Slice 4: Planeswalker's Favor / Planeswalker's Fury / Wand of Ith family.
   * "Target opponent/player reveals a card at random from their hand."
   *
   * Reveals the card for information purposes (no zone change — same as LookAtHand),
   * and stores the randomly-selected card's mana value in ctx.lastRevealedCardManaValue
   * so that sibling effects using { kind: 'RevealedRandomCardManaValue' } can resolve
   * the amount. The random card is chosen as: if namedCardChoices has 'randomRevealedCardId',
   * use that; otherwise pick the lowest instanceId card in the target's hand (deterministic
   * fallback). No state change occurs — the card stays in hand.
   */
  | RevealRandomCardFromHandEffect
  /**
   * Slice 6: "Until your next turn, spells your opponents cast cost {N} more."
   * (Tax Collector / Gobakhan ETB-triggered tax family.)
   *
   * Registers a SpellCostTaxRef in state.spellCostTaxes. The tax applies to all
   * opponents of the controller and expires at the START of the controller's next
   * turn (pruned by pruneSpellCostTaxes in turn-manager.ts when the active player
   * matches the tax's controllerId and the turn is newer than registeredAtTurnNumber).
   *
   * HONEST: getSpellCostTaxIncrease (stack.ts) reads state.spellCostTaxes and adds
   * `amount` to the generic cost for any opponent of the tax's controllerId.
   * This mirrors the OpponentsCantCastSpells mechanism (SpellCastProhibitionRef),
   * replacing prohibition with a cost increase.
   */
  | OpponentSpellCostTaxEffect
  /**
   * Slice 8/12: "that player exiles a card at random from their hand."
   * (Elkin Lair / Wild Evocation family — upkeep exile from hand.)
   *
   * Randomly selects `count` cards from the event player's hand and moves them
   * to exile. "At random" uses the same seeded shuffle as Discard(random:true).
   * `player` is always `{ kind: 'EventPlayer' }` for the each-player-upkeep
   * wording; the executor resolves it via eventContext.eventPlayerId.
   */
  | ExileFromHandEffect
  /**
   * Slice 8/12: "that player may pay <cost>. If they don't, <downside>."
   * (Umbilicus / Emberwilde Djinn / Illusions of Grandeur family.)
   *
   * The player identified by `player` (always EventPlayer for each-player-upkeep
   * triggers) may choose to pay the specified cost. If they CAN pay and the AI
   * decides to (life buffer kept), the cost is deducted and downside skipped.
   * If they cannot or decline, `downsideEffects` are applied — with the same
   * event player bound as EventPlayer so "they return a permanent" resolves
   * correctly to the upkeep player's permanents.
   *
   * HONESTY: downside effects must parse via existing executor-backed matchers.
   * Bodies not parseable by parseMultipleEffects are auto-declined at parse time.
   */
  | EachPlayerUnlessPayEffect;

// Amount can be a fixed number, reference to X, or a dynamic "for each" count
export type AmountRef =
  | number
  | { kind: 'X' }
  | { kind: 'XMultiplied'; multiplier: number }
  | { kind: 'EventSpellManaValue' }
  | { kind: 'TargetPower'; target: TargetRef; multiplier?: number }
  /** Domain — "the number of basic land types among lands you control" (CR 700.13). */
  | { kind: 'DomainCount' }
  | GreatestPowerAmount
  | GreatestToughnessAmount
  | GreatestManaValueAmount
  | ForEachAmount
  | MVSumAmount
  /**
   * Dark Confidant / Pain Seer family: "you lose life equal to its mana value."
   * Resolved by the executor to the mana value of the card most recently moved
   * by a RevealTopMatch effect in the same effect chain (stored on ExecutionContext).
   */
  | { kind: 'RevealedTopCardManaValue' }
  /**
   * Slice 4: Planeswalker's Favor / Planeswalker's Fury family.
   * "equal to that card's mana value" — the mana value of the card most recently
   * randomly-revealed by a RevealRandomCardFromHand effect in the same effect chain
   * (stored in ctx.lastRevealedCardManaValue, same slot as RevealedTopCardManaValue).
   * Resolves to 0 when no random reveal preceded this effect (safe no-op).
   */
  | { kind: 'RevealedRandomCardManaValue' }
  /**
   * Slice 11: Dreamborn Muse family — "that player mills X cards, where X is the
   * number of cards in their hand." Resolved to the card count of the player
   * identified by eventContext.eventPlayerId at resolution time.
   */
  | { kind: 'EventPlayerHandCount' }
  /**
   * Slice 6: Eternity Vessel family — "enters with X charge counters on it,
   * where X is your life total." Resolved to the controller's current life total.
   */
  | LifeTotalAmount
  /**
   * Slice 5 (event-damage triggers): "you gain that much life" / "deals that
   * much damage" — "that much" refers to the amount of damage just dealt in the
   * triggering DealsDamage event, stored in eventContext.eventDamageAmount.
   * Resolved to 0 when there is no event context (safe no-op for callers).
   */
  | { kind: 'EventDamageAmount' }
  /**
   * Slice 10: "equal to that creature's toughness/power" — the live P/T of the
   * creature involved in the triggering event (eventContext.cardInstanceId).
   * Resolved via getEffectivePower / getEffectiveToughness at execution time.
   * Falls back to 0 when there is no event context.
   */
  | { kind: 'EventCreatureStat'; stat: 'power' | 'toughness' }
  /**
   * Slice 11: Havoc Festival family — "loses half their life, rounded up."
   * Each player (or specified player) loses ⌈life/2⌉. Resolved per-player at
   * execution time inside the LoseLife executor (EachPlayer loop). Resolves to 0
   * via resolveAmount as a safe no-op fallback for non-EachPlayer callers.
   */
  | { kind: 'HalfLifeRoundedUp' }
  /**
   * Brion Stoutarm family: the power of the creature sacrificed as part of the
   * activated-ability cost "sacrifice another creature". Captured before the
   * creature leaves the battlefield (during cost payment in activateAbility) and
   * stored in namedCardChoices['sacrificedCreaturePower'] on the stack item.
   * Resolved from namedCardChoices in the DealDamage / GainLife executor cases
   * (not via resolveAmount, which lacks namedCardChoices access).
   */
  | { kind: 'SacrificedCreaturePower' }
  /**
   * Slice 4: Storm Entity / "for each [other] spell cast this turn" — evaluated
   * at ETB/resolution time to state.spellsCastThisTurn.
   * When excludeSelf is true the count is decremented by 1 (the "other" qualifier:
   * the spell that put this creature onto the battlefield is not counted).
   * Resolved in executor.ts resolveAmount and stack.ts applyEntersWithCounters.
   */
  | { kind: 'SpellsCastThisTurn'; excludeSelf: boolean }
  /**
   * Slice 4 (devotion): "equal to your devotion to <color(s)>" — evaluated at
   * resolution time by calling countDevotionToColors(state, controller, colors).
   * Colors is a non-empty array of ManaColor (e.g. ['G'] for green devotion,
   * ['W', 'B'] for Athreos-style white-and-black devotion).
   * Used by GainLife (Setessan Petitioner), CreateToken count (Evangel of Heliod),
   * and AddCounters count (Reverent Hunter).
   */
  | { kind: 'DevotionCount'; colors: ('W' | 'U' | 'B' | 'R' | 'G')[] }
  /**
   * Slice 7: Wheel of Torture / Storm World / Rackling / Viseling family.
   * "where X is N minus the number of <filter> in <zone>" — a base integer
   * minus a dynamic ForEach count, clamped to 0 so damage is never negative.
   * Resolved in executor.ts resolveAmount by evaluating the ForEachAmount and
   * subtracting it from `base`, then clamping to max(0, result).
   */
  | { kind: 'BaseMinusCount'; base: number; count: ForEachAmount };

// Dynamic count: "for each [condition]" — evaluated at resolution time
export interface ForEachAmount {
  kind: 'ForEach';
  zone: 'battlefield' | 'hand' | 'graveyard' | 'library' | 'exile';
  filter?: CardFilter;
  /**
   * 'eventPlayer' — Slice 12: pestilence-style "equal to the number of <filter>
   * they control" where "they" is the per-player-upkeep event player.  Resolved
   * against eventContext.eventPlayerId at execution time.
   */
  controller: 'you' | 'opponent' | 'each' | 'target' | 'eventPlayer';
  target?: TargetRef;
  /**
   * Slice 6/12: "twice the number of <filter>" — multiply the ForEach count by
   * this integer at resolution time. E.g. "where X is twice the number of lands
   * you control" → multiplier: 2. Defaults to 1 (no multiplication).
   */
  multiplier?: number;
}

export interface GreatestPowerAmount {
  kind: 'GreatestPower';
  zone: 'battlefield';
  filter?: CardFilter;
  controller: 'you' | 'opponent' | 'each';
  /**
   * Slice 7: "other [subtypes] you control" — the "other" prefix means the
   * source permanent itself should be excluded from the greatest-power search.
   * Resolved by resolveGreatestPower using sourceInstanceId at execution time.
   */
  notSource?: boolean;
}

/**
 * Slice 4/CBC: "draw cards equal to the greatest toughness among creatures you
 * control" (Last March of the Ents family). Resolved by resolveGreatestToughness
 * using the same creature-on-battlefield scan as resolveGreatestPower.
 */
export interface GreatestToughnessAmount {
  kind: 'GreatestToughness';
  zone: 'battlefield';
  filter?: CardFilter;
  controller: 'you' | 'opponent' | 'each';
}

export interface GreatestManaValueAmount {
  kind: 'GreatestManaValue';
  zone: 'battlefield' | 'exile';
  filter?: CardFilter;
  controller: 'you' | 'opponent' | 'each';
}

/**
 * Slice 6: "where X is your life total" — evaluated at entry/resolution time
 * to the controller's current life total.
 */
export interface LifeTotalAmount {
  kind: 'LifeTotal';
  controller: 'you';
}

/**
 * Slice 10: "where X is the total mana value of <filter> cards in/your <zone>"
 * — evaluated at resolution time as the SUM of cmc values of all matching
 * cards in the zone. Examples:
 *   "where X is the total mana value of instant and sorcery cards in your graveyard"
 *   "where X is the total mana value of cards in your graveyard"
 */
export interface MVSumAmount {
  kind: 'MVSum';
  zone: 'battlefield' | 'hand' | 'graveyard' | 'library' | 'exile';
  filter?: CardFilter;
  controller: 'you' | 'opponent' | 'each';
}

export interface DrawEffect {
  kind: 'Draw';
  player: TargetRef;
  count: AmountRef;
}

export interface DestroyEffect {
  kind: 'Destroy';
  target: TargetRef;
  /** "...that can't be regenerated." — destruction ignores regeneration shields. */
  noRegen?: boolean;
}

export interface DealDamageEffect {
  kind: 'DealDamage';
  source?: SourceRef;
  target: TargetRef;
  amount: AmountRef;
}

/**
 * "~ deals N damage divided as you choose among <one, two, or three targets |
 * any number of target ...>." (Arc Lightning / Forked Lightning / Hail of Arrows
 * family.) `amount` is the TOTAL damage; the executor splits it across every id
 * chosen for the effect's single multi-target spec. An explicit per-target
 * division may ride the stack item's namedCardChoices payload
 * ("damageDivision": "2,1", portions parallel to the chosen ids); otherwise the
 * total is split evenly with the remainder going to the earliest chosen targets
 * (all to the first target when only one was chosen).
 */
export interface DealDamageDividedEffect {
  kind: 'DealDamageDivided';
  source?: SourceRef;
  /** Chosen ref bound to the single multi-target spec ("among ... targets"). */
  target: TargetRef;
  /** TOTAL damage divided among the chosen targets (fixed N or cast-time X). */
  amount: AmountRef;
}

/**
 * "~ deals N damage to each of up to M targets." — each chosen target takes N
 * damage independently (not N divided among them). Used for attack triggers like
 * "Whenever ~ attacks, it deals 1 damage to each of up to two targets."
 * The executor loops over every chosen id for the multi-target spec and applies
 * the same fixed amount to each one.
 */
export interface DealDamageEachTargetEffect {
  kind: 'DealDamageEachTarget';
  source?: SourceRef;
  /** Chosen ref bound to the multi-target spec (up to M choices). */
  target: TargetRef;
  /** Fixed amount of damage each chosen target receives. */
  amount: number;
}

export interface DealDamageForExiledCardsEffect {
  kind: 'DealDamageForExiledCards';
  target: TargetRef;
  exiledCardIds: string[];
  amountPerCard: number;
}

export interface PreventDamageEffect {
  kind: 'PreventDamage';
  target?: TargetRef;
  amount: AmountRef | 'all';
  combatOnly: boolean;
  duration: 'turn';
}

export interface GainLifeEffect {
  kind: 'GainLife';
  player: TargetRef;
  amount: AmountRef;
}

export interface LoseLifeEffect {
  kind: 'LoseLife';
  player: TargetRef;
  amount: AmountRef;
}

export interface ExileEffect {
  kind: 'Exile';
  target: TargetRef;
}

export interface ExileAllGraveyardsEffect {
  kind: 'ExileAllGraveyards';
}

/**
 * Slice 9/12: "that player exiles N cards from their graveyard."
 * (Curse of Oblivion / Oath family — per-player-upkeep graveyard exile.)
 *
 * The `player` TargetRef is typically EventPlayer (the active player at the
 * upkeep trigger), but accepts any TargetRef (Controller, Chosen, etc.) so
 * the same AST node works for target-player spell effects.
 *
 * The executor removes up to `count` cards from the player's graveyard
 * (AI picks the lowest-CMC ones first, preserving no strong preference).
 * If the graveyard has fewer than `count` cards, all are exiled.
 */
export interface ExileNFromGraveyardEffect {
  kind: 'ExileNFromGraveyard';
  player: TargetRef;
  count: AmountRef;
}

export interface PutIntoLibraryEffect {
  kind: 'PutIntoLibrary';
  target: TargetRef;
  position: 'top' | 'bottom' | 'shuffle';
}

export interface ReturnToHandEffect {
  kind: 'ReturnToHand';
  target: TargetRef;
}

/**
 * Bounce effect triggered by "that player returns a creature they control to
 * its owner's hand" (Sunken Hope family). The `player` TargetRef identifies
 * whose permanents are returned; `filter` (default: creature) narrows the
 * selection; `count` is how many to bounce. AI selects the lowest-value
 * permanent (mirroring the sacrifice-selection policy).
 */
export interface BounceControlledByPlayerEffect {
  kind: 'BounceControlledByPlayer';
  player: TargetRef;
  filter?: CardFilter;
  count: AmountRef;
}

export interface SacrificeEffect {
  kind: 'Sacrifice';
  player: TargetRef;
  filter?: CardFilter;
  count: AmountRef;
  /** "Sacrifice this creature / it / ~." — sacrifice the source permanent itself. */
  self?: boolean;
}

export interface SacrificeSelfUnlessPlayerSacrificesEffect {
  kind: 'SacrificeSelfUnlessPlayerSacrifices';
  player: TargetRef;
  filter?: CardFilter;
  count: AmountRef;
}

/**
 * Slice 4 (self-reference normalization): "sacrifice this Aura unless you pay {1}{U}."
 * The controller may pay the mana cost to keep the source permanent; if they
 * cannot or choose not to, the source permanent is sacrificed. Emitted by
 * matchSacrificeSelfUnlessPay after 'this aura/equipment/vehicle' is normalized
 * to '~' in the token stream.
 */
export interface SacrificeSelfUnlessPayEffect {
  kind: 'SacrificeSelfUnlessPay';
  manaCost?: number | string;
  lifeCost?: number;
}

export interface MillEffect {
  kind: 'Mill';
  player: TargetRef;
  count: AmountRef;
}

export interface AddCountersEffect {
  kind: 'AddCounters';
  target: TargetRef;
  counterType: string;
  count: AmountRef;
  /**
   * "put a ... counter on each OTHER creature you control" — the executor's
   * All* target expansion skips the source permanent itself.
   */
  excludeSelf?: boolean;
  /**
   * Slice 12: Quicksilver Fountain family — "that player puts a counter on
   * target [non-<Subtype>] land they control." When the target is AllOfType
   * with eventPlayerControls, the executor applies the counter to at most
   * this many matching permanents (AI picks the lowest-CMC one).
   */
  maxCount?: number;
}

/**
 * "Distribute N +1/+1 counters among one, two, or three target creatures [you control]."
 * (Armament Dragon family, Vastwood Animist-family pump spells, ETB distributors.)
 *
 * Mirrors DealDamageDivided: `total` is the TOTAL counter budget divided as the
 * controller chooses across up to `spec.count` chosen targets. The executor reads
 * an explicit "counterDivision" key from namedCardChoices (comma-separated portions
 * parallel to the chosen ids); absent or invalid → spread as evenly as possible
 * with the remainder going to the earliest targets (same policy as damage division).
 *
 * At least 1 counter must be assigned to each chosen target (magic CR 703.2c mirror).
 */
export interface DistributeCountersEffect {
  kind: 'DistributeCounters';
  /** Chosen ref bound to the single multi-target spec. */
  target: TargetRef;
  counterType: string;
  /** TOTAL counters distributed among the chosen targets. */
  total: AmountRef;
}

export interface RemoveCountersEffect {
  kind: 'RemoveCounters';
  target: TargetRef;
  counterType: string;
  count: AmountRef;
  /**
   * Slice 10: When true, ALL counter types on the target are removed
   * (e.g. "Remove all counters from target creature." — Suncleanser).
   * The executor iterates every counter type and calls executeRemoveCounters for each.
   * counterType is ignored when allCounters=true.
   */
  allCounters?: boolean;
}

/**
 * Slice 9 (counter-migration): "put its counters on [up to one] target creature"
 * / "move a +1/+1 counter from this artifact onto target creature."
 *
 * The executor:
 *  - allCounters=true  → iterates every counter type on the source and
 *    calls executeRemoveCounters + executeAddCounters for each type/count.
 *  - allCounters=false → moves exactly `count` of `counterType` from source
 *    to target (Weapon Rack form).
 * `source` is always the source permanent (Source ref).
 * `target` is the chosen target creature (Chosen ref).
 */
export interface MoveCountersEffect {
  kind: 'MoveCounters';
  /** The permanent whose counters are being moved (always Source). */
  source: TargetRef;
  /** The target receiving the counters. */
  target: TargetRef;
  /**
   * When true, ALL counter types on the source are moved.
   * When false, only `count` counters of `counterType` are moved.
   */
  allCounters: boolean;
  /** Counter type to move (used when allCounters is false). */
  counterType?: string;
  /** Fixed count to move (used when allCounters is false). */
  count?: number;
}

/** Slice 5 (Transform): Flip the source permanent to its back face. */
export interface TransformSelfEffect {
  kind: 'TransformSelf';
}

export interface TapEffect {
  kind: 'Tap';
  target: TargetRef;
}

/** "Goad target creature." (CR 701.39) The goaded creature must attack each
 *  combat if able, and must attack a player other than its goader if able,
 *  until the goader's next turn. */
export interface GoadEffect {
  kind: 'Goad';
  target: TargetRef;
}

/** "Regenerate target creature." / "Regenerate ~." (CR 701.18) Grants a
 *  regeneration shield that replaces the next destruction this turn. */
export interface RegenerateEffect {
  kind: 'Regenerate';
  target: TargetRef;
}

/** "Proliferate." (CR 701.27) The controller chooses any number of
 *  permanents/players with a counter and adds one more of an existing kind.
 *  Executed with a controller-optimal heuristic (own counters grow; only
 *  detrimental counters grow on opponents). */
export interface ProliferateEffect {
  kind: 'Proliferate';
}

/** "<creature> explores." (CR 701.40) Reveal the top card of the controller's
 *  library; if it's a land put it into their hand, otherwise put a +1/+1 counter
 *  on the exploring creature (card stays on top). */
export interface ExploreEffect {
  kind: 'Explore';
  target: TargetRef;
}

/** "You become the monarch." / "Target opponent becomes the monarch." (CR 720) */
export interface BecomeMonarchEffect {
  kind: 'BecomeMonarch';
  player: TargetRef;
}

/** "<creature> connives [N]." (CR 702.156) Draw N, then discard N; put a +1/+1
 *  counter on the creature for each nonland card discarded this way. */
export interface ConniveEffect {
  kind: 'Connive';
  target: TargetRef;
  count: AmountRef;
}

/** "Amass <Type> N." (CR 701.43) If you control no Army, create a 0/0 black Army
 *  creature token of the given type, then put N +1/+1 counters on an Army you control. */
export interface AmassEffect {
  kind: 'Amass';
  count: AmountRef;
  armyType?: string; // e.g. "Orc", "Zombie"
}

/** "Populate." (CR 701.32) Create a token that's a copy of a creature token you control. */
export interface PopulateEffect {
  kind: 'Populate';
}

/** "Adapt N." (CR 701.41) If the source has no +1/+1 counters, put N on it. */
export interface AdaptEffect {
  kind: 'Adapt';
  count: AmountRef;
}

/** "Bolster N." (CR 701.24) Put N +1/+1 counters on the creature you control with
 *  the least toughness (caster's choice among ties). */
export interface BolsterEffect {
  kind: 'Bolster';
  count: AmountRef;
}

/** "Monstrosity N." (CR 701.34) If the source isn't monstrous, put N +1/+1 counters
 *  on it and it becomes monstrous. */
export interface MonstrosityEffect {
  kind: 'Monstrosity';
  count: AmountRef;
}

/** "Fabricate N." (CR 702.123) Put N +1/+1 counters on the source, OR create N 1/1
 *  colorless Servo artifact tokens. Resolved to the counters mode (a legal choice)
 *  when the source is still a creature, else Servos. */
export interface FabricateEffect {
  kind: 'Fabricate';
  count: AmountRef;
}

/** Mentor (CR 702.110): put a +1/+1 counter on an attacking creature with lesser
 *  power than the source. Resolves its own target deterministically at execution. */
export interface MentorEffect {
  kind: 'Mentor';
}

/** "You may pay <cost>. If you do, <effects>." The gated effects happen ONLY if the
 *  controller actually pays. The engine pays when affordable (mana = tapping that
 *  many lands; life kept above a safety buffer). manaCost is the total mana value
 *  to pay; lifeCost is life to pay. */
/** "Reveal/Look at the top card of your library. If it's a <filter>, put it
 *  into your hand/graveyard" or "put it onto the battlefield [tapped]".
 *  Unmatched cards stay on top. */
export interface RevealTopMatchEffect {
  kind: 'RevealTopMatch';
  filter: CardFilter;
  matchDestination: 'hand' | 'graveyard' | 'battlefield';
  /** "put it onto the battlefield tapped" — battlefield destination only. */
  tapped?: boolean;
}

/**
 * "Reveal cards from the top of your library until you reveal a <filter> card."
 * Treasure Hunt / Hermit Druid / Clifftop Lookout family.
 *
 * The matched card goes to matchedDestination; all other revealed cards go to
 * restDestination. The "Treasure Hunt" wording puts ALL revealed cards (including
 * the matched one) into hand — set matchedDestination and restDestination both to
 * 'hand' for that variant.
 *
 * Slice 3 additions:
 *   count   — how many matching cards to find before stopping (default 1).
 *             Mirko Vosk uses count=4 ("until they reveal four land cards").
 *   player  — whose library to reveal from; defaults to the casting player
 *             (Controller). Use EventPlayer for "that player reveals" trigger
 *             tails (Bismuth Mindrender, Territorial Bruntar, Mirko Vosk).
 *
 * Declined shapes: "you may cast it" variants (free-cast-from-reveal subsystem).
 */
export interface RevealUntilMatchEffect {
  kind: 'RevealUntilMatch';
  /** Filter that the first matching card must satisfy. */
  filter: CardFilter;
  /** Where the matched card goes. */
  matchedDestination: 'hand' | 'battlefield' | 'battlefieldTapped' | 'graveyard';
  /** Where all non-matched revealed cards go. */
  restDestination: 'hand' | 'bottom' | 'graveyard';
  /**
   * How many matching cards to find before stopping the reveal loop.
   * Defaults to 1 when absent (single-match forms like Hermit Druid).
   * Mirko Vosk sets this to 4 ("until they reveal four land cards").
   * When count > 1 ALL matched cards go to matchedDestination.
   */
  count?: number;
  /**
   * Which player's library is revealed from.
   * Absent/undefined = the casting player (TargetRef Controller equivalent).
   * Set to { kind: 'EventPlayer' } for trigger tails where a third-party
   * player's library is looped ("that player reveals...").
   */
  player?: TargetRef;
}

/** "Return all <filter> cards from your/all graveyard(s) to the battlefield/hand."
 *  Mass reanimation / mass regrowth. */
export interface ReturnAllFromGraveyardEffect {
  kind: 'ReturnAllFromGraveyard';
  filter: CardFilter;
  whose: 'yours' | 'all';
  destination: 'battlefield' | 'hand';
  /**
   * Slice 8 (choose-type-return): when present, limits the mass-return to at most
   * this many cards (Haunting Voyage family: "return up to two creature cards of the
   * chosen type from your graveyard to your hand"). The executor returns the first N
   * matching cards found (stable iteration order). Absent = no limit (return all).
   */
  maxCount?: number;
}

export interface OptionalPayEffect {
  kind: 'OptionalPay';
  /** Generic-only costs stay a number ("pay {2}" → 2, paid by tapping that many
   *  untapped lands). Costs with colored pips keep the canonical mana string
   *  ("{2}{R}", "{1}{B/G}") so the executor can verify the controller's lands
   *  actually produce the required colors before paying. */
  manaCost?: number | string;
  lifeCost?: number;
  /** "you may pay {E}{E}. if you do, ..." — paid from the player's energy counters. */
  energyCost?: number;
  /** "you may sacrifice <filter>. if you do, ..." — paid conservatively (only a
   *  token matching the filter is sacrificed; otherwise the engine declines). */
  sacrificeFilter?: CardFilter;
  /** "you may discard N card(s). if you do, ..." — paid only from a full-enough hand. */
  discardCount?: number;
  /**
   * Slice 1: "{X}" or "{X}{R}" costs — the {X} component is paid by tapping
   * xValue additional lands (drawn from ctx.xValue at execution time). Any
   * non-X colored pips in manaCost are also paid normally. Inner effects that
   * reference { kind: 'X' } amounts resolve against the same xValue.
   */
  xCost?: boolean;
  effects: Effect[];
}

export interface UntapEffect {
  kind: 'Untap';
  target: TargetRef;
  /** Optional cap for non-targeting untap effects such as "untap up to seven lands." */
  maxCount?: AmountRef;
}

export interface CreateTokenEffect {
  kind: 'CreateToken';
  controller: TargetRef;
  token: TokenDefinition;
  count: AmountRef;
  /**
   * Attach the source permanent to the first token this effect creates.
   * This covers dice/table cards such as "create a token, then attach this to it".
   */
  attachSourceToCreated?: boolean;
  /** Token(s) enter tapped ("create a tapped ... token"). */
  tapped?: boolean;
}

export interface RollD20Outcome {
  min: number;
  max: number;
  effects: Effect[];
}

export interface RollD20Effect {
  kind: 'RollD20';
  outcomes: RollD20Outcome[];
  /** Test-only deterministic value; normal gameplay rolls randomly. */
  rollOverride?: number;
}

export interface DiscardEffect {
  kind: 'Discard';
  player: TargetRef;
  count: AmountRef;
  random?: boolean;
}

export interface ScryEffect {
  kind: 'Scry';
  player: TargetRef;
  count: AmountRef;
}

export interface SurveilEffect {
  kind: 'Surveil';
  player: TargetRef;
  count: AmountRef;
}

export interface LookAtHandEffect {
  kind: 'LookAtHand';
  player: TargetRef;
}

/**
 * Information-only look at the top N cards of a player's library.
 * No state change beyond revealing to the controller (same as LookAtHand).
 * Used for Orcish Spy / Merfolk Observer / Dewdrop Spy family.
 */
export interface LookAtTopOfLibraryEffect {
  kind: 'LookAtTopOfLibrary';
  player: TargetRef;
  count: AmountRef;
}

// Reveal-hand coercion (Thoughtseize/Castigate family): the chosen player
// reveals their hand, the effect's controller chooses a filter-matching card
// from it, and that card is discarded (by its owner) or exiled.
export interface RevealHandChooseCardEffect {
  kind: 'RevealHandChooseCard';
  /** Whose hand is revealed (the spell/trigger's player target). */
  player: TargetRef;
  /** Which revealed cards may be chosen ({} = any card). */
  filter: CardFilter;
  /**
   * Where the chosen card goes: that player discards it, exiles it, shuffles
   * it into their library (Perish the Thought family), it is put on top of
   * that player's library (Painful Memories family), or it is put third from
   * the top of that player's library (Lost Hours family).
   */
  disposition: 'discard' | 'exile' | 'shuffle' | 'putOnTop' | 'putThirdFromTop' | 'putOnBottom';
  /** namedCardChoices key for an explicit chosen-card instance id. */
  selectedCardChoiceId?: string;
  /**
   * Optional "you may" choose — the engine always picks when a legal card exists
   * (AI policy); when true and no card matches, elseEffects fire instead.
   */
  optional?: boolean;
  /** Effects that fire when the optional choose is declined (no matching card, or player declines). */
  elseEffects?: Effect[];
  /**
   * When true, ALL filter-matching cards in the revealed hand are moved via the
   * disposition (discard or exile) instead of choosing one. Used for Amnesia-style
   * "reveals their hand and discards all nonland cards" effects.
   */
  discardAll?: boolean;
  /**
   * Slice 12: Talara's Bane rider — "you gain life equal to that creature card's
   * toughness". When true, the executor gains life for the caster equal to the
   * chosen card's toughness BEFORE moving the card via the disposition.
   */
  gainLifeEqualToChosenCardToughness?: boolean;
}

export interface SearchLibraryEffect {
  kind: 'SearchLibrary';
  player: TargetRef;
  filter: CardFilter;
  destination: 'battlefield' | 'hand' | 'top' | 'graveyard';
  tapped?: boolean;
  shuffle: boolean;
  topCount?: number;
  putUnselectedTopCardsOnBottom?: boolean;
  minSelections?: number;
  maxSelections?: number;
  namedCardChoiceId?: string;
  selectedCardChoiceId?: string;
  /**
   * Slice 12: "search your library and/or graveyard" — when true the executor
   * also considers the controller's graveyard as a search zone alongside the
   * library. Honest: executeSearchLibrary includes graveyard candidates when set.
   */
  searchGraveyard?: boolean;
}

export interface PutCardsFromHandOnTopEffect {
  kind: 'PutCardsFromHandOnTop';
  player: TargetRef;
  count: AmountRef;
  selectedCardChoiceId?: string;
}

export interface ChooseFromTopOfLibraryEffect {
  kind: 'ChooseFromTopOfLibrary';
  player: TargetRef;
  count: AmountRef;
  destination: 'hand' | 'graveyard' | 'exile' | 'battlefield' | 'top';
  restDestination: 'bottom' | 'graveyard' | 'exile' | 'top' | 'hand';
  minSelections?: number;
  maxSelections?: number;
  fallbackSelectionCount?: number;
  selectedCardChoiceId?: string;
  /**
   * Type/subtype restriction on which revealed cards may be taken to `destination`
   * ("put any number of <filter> cards from among them into your hand"). When set
   * and no explicit selection is provided, the engine auto-takes every revealed
   * card matching this filter (up to maxSelections); non-matching revealed cards
   * always go to `restDestination`.
   */
  filter?: CardFilter;
  /**
   * "put a <typeA> card and/or a <typeB> card from among them into your hand" —
   * caps the filter-driven auto-selection at this many cards PER `filter.anyOf`
   * branch (a card matching several branches counts against the first branch
   * with remaining room). Only meaningful alongside `filter.anyOf`.
   */
  maxPerAnyOfBranch?: number;
  /**
   * "put it/them onto the battlefield tapped" — only meaningful when
   * destination === 'battlefield'. Cards matching the filter enter tapped.
   */
  tapped?: boolean;
}

export interface ShuffleLibraryEffect {
  kind: 'ShuffleLibrary';
  player: TargetRef;
}

/**
 * Slice 11: Grant uncounterable status to a specific stack item.
 * "Target spell can't be countered [this turn]." (Vexing Shusher family).
 * The executor sets SpellStackItem.cantBeCountered = true on the targeted item.
 */
export interface GrantCantBeCounteredEffect {
  kind: 'GrantCantBeCountered';
  target: TargetRef;
}

/**
 * Slice 5 (bite family): "Each other <Subtype> you control deals damage equal
 * to its power to <target>." (Bartz and Boko / Living Inferno family.)
 *
 * The executor finds every permanent matching `sourceFilter` on the battlefield
 * (filtered by `controller`), optionally excluding the source permanent
 * (`excludeSource`), then for each one calls executeDealDamage with that
 * permanent's own effective power as the damage amount.
 */
export interface DealDamageAllByPowerEffect {
  kind: 'DealDamageAllByPower';
  /** Filter selecting which permanents deal damage (e.g. {subtypes:['bird']}). */
  sourceFilter: CardFilter;
  /**
   * 'you' — only the caster's/controller's permanents.
   * 'all' — all permanents matching the filter regardless of controller.
   */
  controller: 'you' | 'all';
  /** Exclude the source permanent itself from the dealing set ("other" forms). */
  excludeSource?: boolean;
  /** The target that receives damage from each dealing permanent. */
  target: TargetRef;
}

export interface CounterSpellEffect {
  kind: 'CounterSpell';
  target: TargetRef;
  filter?: 'noncreature' | 'creature' | 'creatureOrEnchantment' | 'artifactOrCreature' | 'instantOrSorcery' | 'enchantmentInstantOrSorcery'; // undefined = any spell
  exileInstead?: boolean;
}

export interface FightEffect {
  kind: 'Fight';
  fighterA: TargetRef;
  fighterB: TargetRef;
}

export interface ReturnFromGraveyardEffect {
  kind: 'ReturnFromGraveyard';
  target: TargetRef;
  destination: 'hand' | 'battlefield';
  counters?: string[];
  /** If true, the card enters the battlefield tapped (Supernatural Stamina / Not Dead After All). */
  tapped?: boolean;
}

export interface ModifyPTEffect {
  kind: 'ModifyPT';
  target: TargetRef;
  power: AmountRef; // e.g. +2, -2, or a dynamic amount such as target power
  toughness: AmountRef;
  untilEndOfTurn: boolean;
}

// Exile cards from the top of a library (impulse draw)
export interface ExileFromLibraryEffect {
  kind: 'ExileFromLibrary';
  player: TargetRef;
  count: AmountRef;
  mayPlay?: boolean; // "you may play them this turn"
  delayedDamageEachOpponentPerCard?: number;
}

export interface ExileUntilNamedEffect {
  kind: 'ExileUntilNamed';
  player: TargetRef;
  namedCard?: string;
  namedCardChoiceId?: string;
  foundDestination: 'hand' | 'exile';
  exileBeforeSearch?: number;
}

// Gain control of a permanent
export interface GainControlEffect {
  kind: 'GainControl';
  target: TargetRef;
  /**
   * Slice 11: optional override for who gains control. If absent, defaults to
   * the caster (controller). Set to `{ kind: 'EventPlayer' }` for "that player
   * gains control of this enchantment" (Risky Move family).
   */
  newController?: TargetRef;
}

// ============================================================================
// Phase 16: Blink/Flicker, Copy, Keyword Granting, Phasing
// ============================================================================

// Blink/Flicker: exile then return to battlefield (triggers ETB again)
export interface BlinkEffect {
  kind: 'Blink';
  target: TargetRef;
  delayed?: boolean; // true = "return at the beginning of the next end step"
  ownerControl?: boolean; // true = "under its owner's control"
}

export interface ReturnFromExileEffect {
  kind: 'ReturnFromExile';
  target: TargetRef;
}

// Copy: create a token copy of target creature
export interface CopyEffect {
  kind: 'Copy';
  target: TargetRef;
}

/**
 * Slice 7 (becomes-copy): "target creature becomes a copy of target creature until end of turn."
 *
 * `subject`  — the permanent that is transformed (typically a Chosen target or the Source).
 * `copySource` — the permanent whose copiable characteristics are copied (Chosen target).
 * `mass`     — when true the effect applies to EACH other creature (Mirrorweave).
 *
 * Implementation: the executor writes `becomesCopyOfDefinitionId` onto the subject card
 * instance. `getCardDefinition` in game-state.ts returns the copied definition while
 * this field is set. `cleanupDamage` in state-based.ts clears it at end-of-turn.
 *
 * Scope limitations (HONESTY): only the single-target form and the mass-each-other form
 * where the copy source is a single nonlegendary target are supported. Riders that bolt
 * on counters/keywords to the copy result are declined.
 */
export interface BecomesCopyEffect {
  kind: 'BecomesCopy';
  /** The permanent being transformed. Kind 'Source' = the spell's source; Kind 'Chosen' = targeted. */
  subject: TargetRef;
  /** The permanent being copied. */
  copySource: TargetRef;
  /**
   * When true, ALL OTHER creatures on the battlefield also become copies
   * (Mirrorweave). The executor iterates every battlefield creature except
   * the copySource itself.
   */
  mass?: boolean;
}

/**
 * "You may have this creature enter as a copy of any [Subtype] creature [or artifact]
 * on the battlefield." (Clone / Jwari Shapeshifter family.)
 *
 * Entry-choice marker: at permanent entry the engine picks the best-valued battlefield
 * creature (or creature/artifact when includesArtifacts is true) and overwrites the
 * entering permanent's definition to match, using the same copy-characteristics logic
 * as executeCopy. Decline is always an option (engine picks if a legal target exists).
 *
 * NOTE: Declined for "except it's…" exception riders until def-swap supports overlays.
 */
export interface EnterAsCopyEffect {
  kind: 'EnterAsCopy';
  /** Subtype constraint on the battlefield permanent to copy, e.g. 'ally'. Undefined = any creature. */
  subtypeFilter?: string;
  /** When true, artifacts on the battlefield (not just creatures) are also legal choices. */
  includesArtifacts?: boolean;
  /**
   * Source variant for the copy pool:
   *   'battlefield'  (default) — any creature on the battlefield
   *   'graveyard'              — any creature card in a graveyard
   *   'youControl'             — a creature you control
   *   'opponentControls'       — a creature an opponent controls
   *   'anotherCreatureYouControl' — another creature you control (Sakashima of a Thousand Faces)
   *   'artifactOrCreatureYouControl' — an artifact or creature you control (Waxen Shapethief)
   *   'creatureOrPlaneswalkerYouControl' — a creature or planeswalker you control (Spark Double)
   *   'permanentYouControl'    — a permanent you control (Moritte of the Frost)
   */
  sourceVariant?: 'battlefield' | 'graveyard' | 'youControl' | 'opponentControls' | 'anotherCreatureYouControl' | 'artifactOrCreatureYouControl' | 'creatureOrPlaneswalkerYouControl' | 'permanentYouControl';
  /**
   * Pool type filter for Slice-8 noncreature-subject pools.
   * When set, the candidate pool is filtered to this card type instead of defaulting to 'creature'.
   *   'artifact'              — any artifact (Sculpting Steel)
   *   'enchantment'           — any enchantment (Copy Enchantment)
   *   'land'                  — any land (Copy Land)
   *   'nonlandPermanent'      — any nonland permanent (Clever Impersonator)
   *   'artifactOrEnchantment' — any artifact or enchantment (Mirrormade)
   *   'equipment'             — any Equipment (Masterwork of Ingenuity)
   * Undefined = creature pool (legacy default, driven by includesArtifacts / subtypeFilter).
   */
  poolType?: 'artifact' | 'enchantment' | 'land' | 'nonlandPermanent' | 'artifactOrEnchantment' | 'equipment';
  /**
   * P/T override applied after the copy (Quicksilver Gargantuan — "except it's 7/7").
   * Both fields must be set together.
   */
  ptOverride?: { power: number; toughness: number };
  // ── Slice-6 'except' riders ─────────────────────────────────────────────
  /** "except it enters with a <type> counter on it" — counter placed at entry. */
  entryCounter?: { counterType: string; count: number };
  /** "except it's a <type/subtype> in addition to its other types" — type overlay. */
  additionalTypes?: string[];
  /** "except it has <keyword>" — keyword overlay via the grant-keyword path. */
  addedKeywords?: string[];
  /** "except its name is ~" — name override; '~' means the card's own original name. */
  nameOverride?: '~';
  /**
   * When true, the copy is also legendary even if the copied permanent is not.
   * Used by Sakashima the Impostor ("it's legendary") name-override combo.
   */
  addedLegendary?: boolean;
  /**
   * Slice-7: "except it isn't legendary" — suppresses the legendary supertype of the
   * copied definition. The entering permanent is treated as non-legendary for the
   * legend rule (state-based.ts SBA) even though the copied definition is legendary.
   * Set on the CardInstance as `nonLegendary: true` by the executor.
   */
  nonLegendary?: boolean;
}

// CopySpell: copy a spell on the stack, optionally with mana value limit.
export interface CopySpellEffect {
  kind: 'CopySpell';
  target: TargetRef;
  maxManaValue?: number;
}

// Grant a keyword to a creature (one-shot, not static)
export interface GrantKeywordEffect {
  kind: 'GrantKeyword';
  target: TargetRef;
  keyword: string;
  untilEndOfTurn: boolean;
}

export interface LoseKeywordEffect {
  kind: 'LoseKeyword';
  target: TargetRef;
  keyword: string;
  untilEndOfTurn: boolean;
}

/**
 * Slice 10: Grant all creature types until end of turn.
 * Sets grantedAllCreatureTypes on affected CardInstances; matchesCardFilter
 * bypasses subtype checks when the flag is set.
 */
export interface GrantAllCreatureTypesEffect {
  kind: 'GrantAllCreatureTypes';
  target: TargetRef; // AllCreaturesYouControl | AllOfType | AllCreatures | Chosen
  untilEndOfTurn: true;
}

/**
 * Slice 4 (activated-ability type-change): "this creature becomes a [type] until
 * end of turn." — Mistform Dreamer / Amoeba Spy family.
 *
 * Sets `grantedSubtypes` on the target CardInstance to the specified subtypes for
 * the remainder of the turn. Cleared at end-of-turn cleanup (cleanupDamage in
 * state-based.ts). matchesCardFilter checks grantedSubtypes when evaluating subtype
 * constraints so the creature is treated as having the new type for targeting,
 * anthem, and tribal interactions.
 *
 * HONESTY: only specific, named types are supported by this effect (e.g., "becomes
 * a Zombie until end of turn"). The "creature type of your choice" variant requires
 * a runtime player selection that cannot be represented in the current activated-
 * ability API and is therefore NOT claimed by this effect — those lines are absorbed
 * as honest skips in parseOracleTextPerLine.
 */
export interface SetCreatureTypeEffect {
  kind: 'SetCreatureType';
  target: TargetRef; // Source or Chosen
  subtypes: string[]; // canonical lower-case subtype name(s) to grant
  untilEndOfTurn: true;
}

/**
 * Slice 12 (en-Kor family): Registers a one-turn damage-redirect shield on the
 * source permanent. The next `amount` points of damage that would be dealt to
 * the source permanent are dealt to `redirectTarget` instead.
 *
 * Implemented by extending DamagePreventionEffectRef with `redirectToId`.
 * In applyDamageReplacementEffects, when a shield has redirectToId, the damage
 * event's targetId is changed to redirectToId (rather than the damage being
 * cancelled) and the shield is consumed.
 */
export interface RedirectDamageEffect {
  kind: 'RedirectDamage';
  /** The permanent whose incoming damage will be redirected (always Source). */
  source: 'Source';
  /** The target that receives the damage instead (a chosen creature). */
  redirectTarget: TargetRef;
  /** The maximum number of damage points to redirect this turn. */
  amount: number;
}

/**
 * Slice 12 (Licid family): Transforms the source creature into an Aura
 * enchantment and attaches it to the chosen target creature.
 *
 * Sets `licidAura: true` and `attachedTo: chosenCreatureId` on the source
 * CardInstance. While licidAura is set, getEffectiveCardTypes returns only
 * ['enchantment'], making the permanent behave as an Aura on the battlefield.
 */
export interface LicidTransformEffect {
  kind: 'LicidTransform';
  /** The chosen creature to attach the Licid-Aura to. */
  attachTarget: TargetRef;
}

// Phase out a permanent
export interface PhaseOutEffect {
  kind: 'PhaseOut';
  target: TargetRef;
}

export interface PreventGameOutcomeEffect {
  kind: 'PreventGameOutcome';
  player: TargetRef;
  preventsLoss?: boolean;
  preventsWin?: boolean;
  preventsLifeLoss?: boolean;
  duration: 'turn';
}

// Win the game
export interface WinGameEffect {
  kind: 'WinGame';
  player: TargetRef;
}

// Lose the game
export interface LoseGameEffect {
  kind: 'LoseGame';
  player: TargetRef;
}

// Add mana to a player's pool
export interface AddManaEffect {
  kind: 'AddMana';
  player: TargetRef;
  mana: { W?: AmountRef; U?: AmountRef; B?: AmountRef; R?: AmountRef; G?: AmountRef; C?: AmountRef };
  /**
   * Slice 5: chosen-color mana. When true, add one mana of the color stored in
   * the source permanent's choices.chosenColor instead of a fixed color. Amount
   * is always 1. Used by Sol Grail / Ring of Three Wishes family.
   */
  chosenColorAmount?: number;
}

export interface PutLandFromHandOntoBattlefieldEffect {
  kind: 'PutLandFromHandOntoBattlefield';
  player: TargetRef;
  tapped?: boolean;
  selectedCardChoiceId?: string;
  /**
   * Slice 8/12: Braids-style put-from-hand — optional card-type filter.
   * When absent, defaults to land-only (original matchPutLandFromHandOntoBattlefield behaviour).
   * When present, the executor picks any matching card from the player's hand.
   */
  filter?: CardFilter;
}

/**
 * "When this Equipment enters, attach it to target creature you control."
 * (Maul of the Skyclaves, Shining Armor, Mithril Coat.) Attaches the source
 * permanent (the Equipment, `source: 'Source'`) to a chosen creature WITHOUT
 * paying the equip cost. The continuous equipmentBonus cache (continuous.ts
 * getEquipmentPTBonus + keywords.ts) applies the buff once `attachedTo` is set.
 */
export interface AttachEffect {
  kind: 'Attach';
  /** The permanent being attached. Currently always the source Equipment. */
  source: 'Source';
  /** The permanent it attaches to (a chosen target creature). */
  target: TargetRef;
}

// Token definition for CreateToken
export interface TokenDefinition {
  name: string;
  colors: Array<'W' | 'U' | 'B' | 'R' | 'G'>;
  types: string[];
  subtypes?: string[];
  power: number;
  toughness: number;
  powerAmount?: AmountRef;
  toughnessAmount?: AmountRef;
  counters?: Record<string, AmountRef>;
  keywords?: string[];
  abilities?: string[];
}

// Card filter for sacrifice/search effects
export interface CardFilter {
  anyOf?: CardFilter[];
  names?: string[];
  nameIncludes?: string[];
  types?: string[];
  subtypes?: string[];
  excludeSubtypes?: string[];
  supertypes?: string[];
  /** Slice 11: Destructive Flow family — excludes permanents that have one of these supertypes. */
  excludeSupertypes?: string[];
  colors?: Array<'W' | 'U' | 'B' | 'R' | 'G'>;
  /**
   * Slice 4 (OptionalPay reflexive tail): matched card must NOT have any of these
   * colors. Used by "each nonwhite creature", "each non-green creature" mass-damage
   * patterns in matchDealDamage. Evaluated by matchesCardFilter and the DealDamage
   * AllOfType executor loop.
   */
  excludeColors?: Array<'W' | 'U' | 'B' | 'R' | 'G'>;
  multicolored?: boolean;
  /** Slice 11: Defiler of Souls family — matches only permanents with exactly one color. */
  monocolored?: boolean;
  /**
   * Mana-value bound. When `x` is true the bound is "mana value X ..." (Green
   * Sun's Zenith); the SearchLibrary executor substitutes the cast-time X for
   * `value` before filtering (`value` holds the X=0 floor as a safe fallback).
   */
  cmc?: { op: 'eq' | 'lte' | 'gte'; value: number; x?: boolean };
  permanent?: boolean;
  excludeTypes?: string[];
  manaValueLessThanSourcePower?: boolean;
  power?: { op: 'eq' | 'lte' | 'gte'; value: number };
  chosenCreatureTypeFromSource?: boolean;
  /**
   * Slice 3/13: chosen-card-TYPE filter — only cards whose card_types array
   * contains the source permanent's choices.chosenCreatureType (interpreted as a
   * card type such as "creature", "land", "artifact", etc. rather than a creature
   * subtype). Used by matchRevealTopChosenType (Vigean Intuition / Spectral
   * Arcanist): "Reveal the top N cards. Put all cards of the chosen type into
   * your hand." Evaluated by matchesCardFilter.
   */
  chosenCardTypeFromSource?: boolean;
  /**
   * Slice 5: chosen-color filter — only permanents whose color matches the
   * source permanent's choices.chosenColor. Consumed by Caged Sun / Gauntlet of
   * Power anthems ("creatures [you control] of the chosen color get +1/+1") and
   * by matchesCardFilter in executor.ts and isAffectedBy in continuous.ts.
   */
  chosenColorFromSource?: boolean;
  /**
   * Slice 6 (reveal-hand chosen-color): "choose a card of that color" — matches
   * hand cards whose color includes the color chosen at cast time (stored in the
   * execution context's namedCardChoices['chosenColor'] key). Used by the Addle /
   * Hint of Insanity family where a "Choose a color." preamble precedes the
   * reveal-hand coercion. Evaluated by matchesCardFilter in executor.ts.
   * AI default when no namedCardChoices['chosenColor'] is provided: matches any
   * card (falls back to unfiltered pick, similar to empty filter).
   */
  chosenColorFromCastTime?: boolean;
  /**
   * Slice 6/spell-pump: "choose a creature type" SPELL preamble — matches
   * battlefield creatures whose subtype equals the type chosen at cast time
   * (stored in the execution context's namedCardChoices['chosenCreatureType']).
   * Used by matchChosenTypePump (And They Shall Know No Fear family): "Choose a
   * creature type. Creatures you control of the chosen type get +N/+M [and gain
   * <keyword>] until end of turn." Evaluated by matchesCardFilter in executor.ts.
   * AI default when no namedCardChoices['chosenCreatureType'] is provided: no
   * creature matches (safe no-op — distinct from the empty-filter fallthrough used
   * by chosenColorFromCastTime because subtype mismatches are silent rejections).
   */
  chosenCreatureTypeFromCastTime?: boolean;
  /**
   * Slice 8: keyword-holder filter — only creatures that currently have this
   * keyword (printed or continuously granted) match the filter.
   * e.g. "Other creatures you control with flying get +1/+1."
   * Evaluated by isAffectedBy (continuous.ts) via instanceHasKeyword, and by
   * matchesCardFilter using the printed def.keywords as a static fallback.
   * Engine-enforced keywords only (flying, trample, etc.).
   */
  withKeyword?: string;
  /**
   * Slice 5 (controller-agnostic filtered anthems): negated keyword-holder filter —
   * only creatures that currently LACK this keyword match the filter.
   * e.g. "Creatures without flying get -2/-0." (Gravitational Shift, Crosswinds)
   * Evaluated by isAffectedBy (continuous.ts) and matchesCardFilter (executor.ts),
   * mirror image of withKeyword: a creature matches iff it does NOT have the keyword.
   * Engine-enforced keywords only (flying, reach, trample, etc.).
   */
  withoutKeyword?: string;
  /**
   * Slice 9: "named ~" self-referential name filter — matches only cards whose
   * name equals the source card's name (resolved at execution time from the
   * sourceInstanceId context). Used by Plague Rats family:
   *   "... equal to the number of creatures named ~ on the battlefield."
   */
  namesSelf?: true;
  /**
   * Slice 2 (combat-status anthem): when true, only creatures that are currently
   * declared attackers satisfy this filter. Evaluated in continuous.ts isAffectedBy
   * by checking state.combat.attackers. Not meaningful outside the combat phase;
   * the modifier simply does not apply when there is no combat state.
   * Example: Orcish Oriflamme ("Attacking creatures you control get +1/+0"),
   * Nobilis of War ("Attacking creatures you control get +2/+0").
   */
  attacking?: true;
  /**
   * Slice 2 (combat-status anthem): when true, only creatures that are currently
   * declared blockers satisfy this filter. Evaluated in continuous.ts isAffectedBy
   * by checking state.combat.blockers. Not meaningful outside the combat phase.
   * Example: Weakstone ("Attacking creatures get -1/-0") covers the opponent side.
   */
  blocking?: true;
  /**
   * Slice 4 (modal bullet gap): tapped/untapped status filter for mass effects.
   * When true, only tapped permanents match; when false, only untapped permanents
   * match. Evaluated by the AllOfType executor loops alongside matchesCardFilter
   * (requires card instance access, so cannot go inside matchesCardFilter itself).
   * Example: Split Up ("Destroy all tapped creatures" / "Destroy all untapped creatures").
   */
  tapped?: boolean;
  /**
   * Slice 2 (beginning-of-combat pump tails): when true, only creatures whose
   * instance ID differs from the sourceInstanceId in the execution context
   * satisfy this filter — i.e. "other creatures you control …".
   * Evaluated by matchesCardInstanceFilter in executor.ts.
   */
  notSource?: boolean;
  /**
   * Slice 8: token filter — when true, only token permanents (card.isToken === true)
   * satisfy the filter. Used by "return all creature tokens to their owners' hands"
   * (Perplexing Test) and similar mass-bounce/destroy effects.
   * Evaluated by the AllOfType executor loops (instance state check, like tapped).
   */
  tokenOnly?: boolean;
  /**
   * Slice 8: nontoken filter — when true, only non-token permanents satisfy the
   * filter. Used by "destroy all nontoken creatures" (Hour of Reckoning) and
   * "return all nontoken creatures to their owners' hands" (Perplexing Test).
   * Evaluated by the AllOfType executor loops (instance state check, like tapped).
   */
  nontoken?: boolean;
  /**
   * Slice 8: blocked filter — when true, only attacker permanents that have at
   * least one declared blocker assigned satisfy the filter.
   * Used by "destroy all blocked creatures" (Fight to the Death).
   * Evaluated by the AllOfType executor Destroy loop (instance state check).
   */
  blocked?: boolean;
  /**
   * Slice 4: Noetic Scales family — "with power greater than the number of cards
   * in their hand". When true, only creatures whose effective power exceeds the
   * controlling player's current hand count satisfy the filter. Evaluated at
   * execution time inside the BounceControlledByPlayer executor where the event
   * player's hand count is available as context.
   * NOTE: matchesCardFilter alone cannot evaluate this (it has no live game state
   * or player ref); the BounceControlledByPlayer executor applies this check
   * inline after the base matchesCardFilter passes.
   */
  powerGreaterThanEventPlayerHandCount?: true;
}

// Modal choice (for "Choose one" spells)
export interface ModalChoice {
  label: string;
  effects: Effect[];
  targets: { id: string; type: string }[];
}

export interface ModalSpell {
  kind: 'Modal';
  chooseCount: number; // 1 for "Choose one", 2 for "Choose two"
  upTo?: boolean; // true for "choose one or both" (choose up to N)
  choices: ModalChoice[];
}

export interface TriggeredAbility {
  kind: 'TriggeredAbility';
  trigger: Trigger;
  effects: Effect[];
  optional?: boolean; // "you may" triggered abilities need an explicit player choice.
  /**
   * Slice 10 (modal-as-trigger-body): When set, this triggered ability's effect
   * body is a modal spell ("When ~ dies, choose one — • ... • ..."). `effects` is
   * empty; resolution uses this modal to execute the chosen mode(s).
   * Stored so the parser's honesty gate (all bullets must parse) is evaluated at
   * parse time; the executor routes through the same modal path as activated
   * ability modals in stack.ts.
   */
  modal?: ModalSpell;
}

export type Trigger =
  | { kind: 'ETB'; who: 'self' | 'any' | 'controller' }
  | { kind: 'Dies'; who: 'self' | 'any' }
  | { kind: 'AttachedCreatureDies' }
  | { kind: 'Attacks'; who: 'self'; alone?: boolean }
  | { kind: 'Unblocked'; who: 'self' }
  | { kind: 'Upkeep'; whose: 'yours' | 'each' | 'opponents' }
  | { kind: 'DrawStep'; whose: 'yours' }
  | { kind: 'BeginningCombat'; whose: 'yours' | 'each' }
  | { kind: 'EndStep'; whose: 'yours' | 'opponents' | 'next' | 'each' }
  | { kind: 'AnotherCreatureETB'; controller: 'yours'; nontoken?: boolean; tokenOnly?: boolean }
  | { kind: 'CreatureYouControlDies' }
  // "Whenever another creature you control dies" (other: excludes the source itself)
  // and "Whenever a creature an opponent controls dies".
  | { kind: 'OtherCreatureDies'; who: 'youControl' | 'opponentControl'; other?: boolean }
  | { kind: 'CreatureYouControlAttacks' }
  | { kind: 'YouCastSpell' }
  | { kind: 'CastNoncreatureSpell' }
  // Phase 17: Additional trigger types
  | { kind: 'LifeGain' }
  | { kind: 'LifeLoss' }
  | { kind: 'CardDrawn' }
  | { kind: 'OpponentCastSpell'; maxManaValue?: number }
  // "Whenever a player casts a spell [with mana value N or less]" — fires for
  // EVERY caster including the controller (Manabarbs-style punishers).
  | { kind: 'AnyPlayerCastSpell'; maxManaValue?: number }
  | { kind: 'AnyCreatureETB'; controller?: 'yours' | 'any'; nontoken?: boolean; tokenOnly?: boolean }
  | { kind: 'CombatDamageToPlayer'; who: 'self' | 'creatureYouControl'; requiresDeathtouch?: boolean }
  | { kind: 'CastInstantOrSorcery' }
  | { kind: 'CastOrCopyInstantOrSorcery' }
  | { kind: 'Landfall' }
  | { kind: 'BecomesTapped'; who: 'self' }
  // "Whenever a player taps a land for mana" (Manabarbs/Scald subfamily). Rides
  // the PermanentTapped event with its forMana flag; optional land restrictions
  // ("an Island", "a nonbasic land") are checked against the tapped card's type line.
  | { kind: 'PlayerTapsLandForMana'; subtype?: string; nonbasic?: boolean }
  /**
   * Slice 5 (event-damage triggers): "Whenever this creature / enchanted creature
   * deals damage" — fires on ANY damage dealt by the source (not just combat
   * damage to a player). Used by the pre-errata lifelink family (Mourning Thrull,
   * Armadillo Cloak, Vampiric Link) and the Guilty Conscience reflection wording.
   * who:
   *   'self'            — the source permanent itself deals the damage
   *   'enchantedCreature' — the creature this Aura is attached to deals the damage
   */
  | { kind: 'DealsDamage'; who: 'self' | 'enchantedCreature' }
  /**
   * Slice 7: "Whenever this creature or another <Subtype> you control enters" —
   * Ally / Mutant / Phyrexian / Dinosaur / Equipment / creature family.
   * Fires when:
   *   (a) the source permanent itself enters the battlefield (self ETB), OR
   *   (b) another creature or permanent of the matching subtype that the controller
   *       controls enters the battlefield.
   * `subtype` is the lowercase singular subtype token ("ally", "dinosaur", etc.);
   * an empty string means plain "creature" (no subtype restriction).
   */
  | { kind: 'SelfOrAnotherSubtypeETB'; subtype: string }
  /**
   * Slice 2: "Whenever another legendary permanent you control enters" —
   * Yoshimaru, Ever Faithful family. Fires when any permanent with the Legendary
   * supertype (other than the source itself) enters the battlefield under the same
   * controller. Does NOT fire when the source permanent itself enters (pure "another"
   * trigger, not "self or another"). The PermanentETB game event is fired for every
   * permanent entering the battlefield so that this trigger can check the legendary
   * supertype regardless of card type.
   */
  | { kind: 'AnotherLegendaryPermanentETB' }
  /**
   * Slice 8/11: "Whenever this creature blocks or becomes blocked by a creature, that
   * creature <effect> until end of turn." (Witherscale Wurm / Dwarven Nomad / Lim-Dûl's
   * Cohort family.)
   *
   * Fires once per combat pair when blockers are finalized — once for the blocking
   * creature and once for each attacker it blocks (and vice versa). The `opposingCreatureId`
   * in the event context is the OTHER creature in the combat pair and is bound to
   * `{ kind: 'EventCreature' }` in the effect body ("that creature").
   */
  | { kind: 'BlocksOrBlockedBy'; who: 'self' }
  /**
   * Slice 1 (Morph/Megamorph): "When this creature is turned face up, <effect>."
   * Fires when the source permanent transitions from face-down (morph 2/2) to its
   * printed face-up identity via the turn-face-up activated action. Only registers
   * on permanents that were cast face-down and still have faceDown=true.
   */
  | { kind: 'TurnedFaceUp'; who: 'self' };

export type TargetRef =
  | { kind: 'Chosen'; targetId: string }
  | { kind: 'TargetController'; targetId: string }
  | { kind: 'Controller' }
  | { kind: 'ActivePlayer' }
  | { kind: 'Player'; playerId: string }
  | { kind: 'EachOpponent' }
  | { kind: 'EachPlayer' }
  | { kind: 'AllCreatures' }
  | { kind: 'AllOtherCreatures' }
  | { kind: 'AllAttackingCreatures' }
  /**
   * Slice 6 (combat-damage trigger bodies): "put a +1/+1 counter on each attacking
   * creature you control." Only the caster's attacking creatures receive the counter
   * (mirrors the "you control" restriction). Handled in executor.ts AddCounters branch.
   */
  | { kind: 'AllAttackingCreaturesYouControl' }
  | { kind: 'AllCreaturesYouControl' }
  | { kind: 'AllCreaturesYouControlMatching'; filter: CardFilter }
  | { kind: 'AllOfType'; filter: CardFilter; controllerControls?: boolean; opponentControls?: boolean; eventPlayerControls?: boolean }
  | { kind: 'Source' }
  | { kind: 'SourceAttachedTo' }
  | { kind: 'EventCaster' }
  | { kind: 'EventSpell' }
  | { kind: 'EventCreature' }
  // "that player" — the player tied to the triggering event regardless of the
  // trigger head (upkeep's active player, a cast spell's caster, the controller
  // of a land tapped for mana). Resolved from eventContext.eventPlayerId.
  | { kind: 'EventPlayer' };

export type SourceRef = { kind: 'ThisSpell' } | { kind: 'ThisPermanent' };

// Activated ability cost components
export interface ActivatedAbilityCost {
  tap?: boolean;
  /**
   * 'self'            — sacrifice the source permanent itself (original form).
   * 'another-creature' — sacrifice ANOTHER creature the controller controls
   *                      (Brion Stoutarm family). During cost payment the engine
   *                      picks deterministically (highest power, ties broken by
   *                      lowest CMC) and stores the sacrificed power in
   *                      namedCardChoices['sacrificedCreaturePower'] on the stack
   *                      item so effects can reference it at resolution time.
   * CardFilter        — sacrifice a permanent matching the filter (existing form).
   */
  sacrifice?: 'self' | 'another-creature' | CardFilter;
  mana?: string; // raw mana cost like "{2}{B}"
  payLife?: number;
}

// Activated ability definition parsed from oracle text
export interface ActivatedAbility {
  kind: 'ActivatedAbility';
  cost: ActivatedAbilityCost;
  effects: Effect[];
  isManaAbility: boolean;
  targets: TargetSpec[];
  /**
   * Slice 6: "{N}: Choose one — • A. • B." activated modal abilities.
   * When set, this ability's effect body is a modal spell; `effects` is empty
   * and `targets` is empty. Resolution uses this modal to execute the chosen mode.
   * Stored here so parseActivatedAbilities can claim modal-body activated abilities
   * through the same honesty gate as parseModalSpell (all bullets must parse).
   */
  modal?: ModalSpell;
  /**
   * Slice 7: timing restriction parsed from "Activate only as a sorcery." /
   * "Activate only during your turn[, and only before attackers are declared]."
   * riders.  When 'sorcery', the ability may only be activated at sorcery speed:
   * the active player must have priority, it must be a main phase, and the stack
   * must be empty.
   */
  timing?: 'sorcery';
}

// ============================================================================
// Phase 15: Static/Continuous Abilities
// ============================================================================

/**
 * What a static ability modifies.
 */
export type StaticModifier =
  | { kind: 'ModifyPT'; power: number; toughness: number }
  | {
      kind: 'ModifyPTByUniqueColorsAmongOtherLegendaryPermanentsYouControl';
      powerPerColor: number;
      toughnessPerColor: number;
    }
  /**
   * Layer-7a characteristic-defining ability: "X's power [and toughness are each]
   * equal to the number of <filter> <zone-phrase>." (Revenant, Harmonious
   * Grovestrider, Snow Villiers). Both `powerFormula` and `toughnessFormula`
   * hold the same ForEachAmount when the text says "power and toughness are each
   * equal to ..."; `toughnessFormula` is null when only power is set by the CDA
   * and the printed toughness value applies unmodified; `powerFormula` is null
   * when only toughness is set by the CDA (e.g. Yavimaya Kavu: "~'s toughness
   * is equal to the number of green creatures on the battlefield") and the
   * printed power value applies unmodified.
   */
  | {
      kind: 'SetBasePTDynamic';
      powerFormula: ForEachAmount | null;
      toughnessFormula: ForEachAmount | null;
    }
  /**
   * Slice 10: Dynamic P/T modification driven by a ForEach count — used for
   * attached-buff where-X auras (Exoskeletal Armor, Death's Approach).
   *   "Enchanted creature gets +X/+X, where X is the number of creature cards
   *    in your graveyard."
   *   "Enchanted creature gets -X/-X, where X is the number of creature cards
   *    in your graveyard."
   *
   * Each of `powerFormula` and `toughnessFormula` is either a ForEachAmount
   * (the modifier that scales with the count) or null (modifier is 0 for that
   * axis). The sign is carried by `powerSign` / `toughnessSign` (1 or -1).
   *
   * These statics are registered with `attachedOnly: true` — continuous.ts
   * recognises them and resolves the count against the source's controller at
   * query time, applying the delta to the enchanted/equipped creature.
   */
  | {
      kind: 'ModifyPTDynamic';
      powerFormula: ForEachAmount | null;
      toughnessFormula: ForEachAmount | null;
      powerSign: 1 | -1;
      toughnessSign: 1 | -1;
    }
  | { kind: 'GrantKeyword'; keyword: string }
  | { kind: 'GrantKeywords'; keywords: string[] }
  | { kind: 'ReduceCost'; amount: number }
  | { kind: 'IncreaseCost'; amount: number }
  /**
   * "You may cast this spell as though it had flash [if you pay {N} more to
   * cast it]." Printed on the spell itself (selfOnly static). stack.ts reads
   * this modifier to grant instant-speed casting; when surcharge > 0 the
   * generic cost is increased by that amount only when the spell is being cast
   * at instant speed (i.e. outside the sorcery-speed window). The optional
   * `condition` field on the outer StaticAbilityEffect gates the grant (Ferocious
   * family). No continuous-layer or keyword-map consumer reads this modifier
   * (mirrors CantBeCountered / EntersTapped); stack.ts is the single
   * enforcement site via `hasAsThoughFlash` / `getAsThoughFlashSurcharge`.
   *
   * Slice 9 extension: `typeFilter` is set on **battlefield** statics (e.g.
   * "You may cast creature spells as though they had flash.") registered via
   * registerContinuousAbilitiesForPermanent. stack.ts hasAsThoughFlash scans
   * continuousEffects for these when the spell being cast matches the filter.
   * `selfOnly` is false for these (not spell-self statics).
   */
  | { kind: 'AsThoughFlash'; surcharge: number; sacrificeAtCleanupIfFlashCast?: boolean; typeFilter?: CardFilter }
  /**
   * Slice 7: Tapped-for-mana rider — "Whenever enchanted land is tapped for mana,
   * its controller adds <mana>" (Market Festival / Overgrowth / Trace of Abundance
   * family) and "Whenever a player taps a land for mana, that player adds <mana>"
   * (Zhur-Taa Ancient family).
   *
   * Parsed as a StaticAbilityEffect (not a stack trigger) and enforced inside
   * tapLandForMana (actions.ts) which is the single land-mana choke point.
   *
   * `scope`:
   *   'attachedLand' — only fires when the land this aura is attached to is tapped.
   *   'anyLand'      — fires when ANY land is tapped (Zhur-Taa Ancient family).
   *
   * `mana`: fixed color amounts to add. Mutually exclusive with `anyColor` /
   * `twoAnyColor`.
   *
   * `anyColor`: add one mana of any color (Trace of Abundance). Shares the
   * slice-3 any-color production path.
   *
   * `twoAnyColor`: add two mana in any combination of colors (Dawn's Reflection).
   */
  | {
      kind: 'TappedForManaRider';
      scope: 'attachedLand' | 'anyLand';
      mana?: { W?: number; U?: number; B?: number; R?: number; G?: number; C?: number };
      anyColor?: number;
      twoAnyColor?: true;
      /**
       * Slice 3: "adds one mana of the chosen color" (Utopia Sprawl / Wild Growth
       * family with a prior "As ~ enters, choose a color." header). Add one mana of
       * the color stored in source.choices.chosenColor at rider-fire time.
       */
      chosenColor?: true;
    }
  /**
   * Slice 9 (ControlEnchanted): "You control enchanted creature." /
   * "You control enchanted permanent." — the iconic theft-Aura family
   * (Control Magic, Mind Control, Confiscate, Persuasion, Threads of Disloyalty,
   * Take Possession, Lay Claim, etc.).
   *
   * HONEST: enforced end-to-end via two hook sites in stack.ts /
   * state-based.ts:
   *   1. On attach (registerContinuousAbilitiesForPermanent): executeGainControl
   *      transfers the enchanted permanent's ownerId to the Aura's controller;
   *      the Aura's choices.previousEnchantedOwnerId stores the original owner
   *      for the revert path.
   *   2. On leave (state-based.ts SBA Aura-to-graveyard path + pruneDetachedEffects
   *      path in executor.ts): the enchanted permanent's ownerId is restored to
   *      previousEnchantedOwnerId if the permanent is still on the battlefield.
   *
   * The modifier is `attachedOnly: true` so continuous.ts isAffectedBy skips it
   * (preventing double-application in the layer system); the GainControl machinery
   * in executeGainControl is the single enforcement site.
   */
  | { kind: 'ControlEnchanted' }
  /**
   * Slice 1 (engine-gap): Seedborn Muse static — "Untap all permanents you
   * control during each other player's untap step."
   *
   * Parsed as a StaticAbilityEffect (not a Spell) and enforced in
   * performUntapStep (turn-manager.ts): after untapping the active player's
   * permanents, any permanent whose controller is NOT the active player and that
   * bears this static causes ALL permanents controlled by THAT non-active player
   * to also untap.
   *
   * The static is selfOnly (the source itself drives the untap; no continuous-
   * layer or targeting logic reads it). It is registered via
   * registerContinuousAbilitiesForPermanent so turn-manager can scan
   * continuousEffects for it.
   */
  | { kind: 'UntapDuringOtherUntapSteps' }
  /**
   * Slice 4 (engine-gap): Grant-activated-mana-ability static —
   * "Creatures you control have '{T}: Add one mana of any color.'"
   * (Enduring Vitality and cards with the same pattern).
   *
   * Registered via registerContinuousAbilitiesForPermanent. At query time,
   * getAvailableManaColors and tapLandForMana (actions.ts) scan continuousEffects
   * for this modifier to expose the granted mana ability on any creature that
   * matches `filter` and is controlled by the effect's `controllerId`.
   *
   * `grantedMana`: the ManaProductionInfo that is effectively added to the
   * matching creature (mirrors a parsed "{T}: Add one mana of any color." entry).
   */
  | { kind: 'GrantActivatedManaAbility'; grantedMana: ManaProductionInfo }
  /**
   * Gisela, Blade of Goldnight damage-doubling static:
   * "If a source would deal damage to an opponent or a permanent an opponent controls,
   *  that source deals double that damage to that player or permanent instead."
   *
   * While this continuous effect is active (Gisela on battlefield), every damage
   * event whose target is an opponent (or permanent controlled by an opponent) of
   * the effect's controller has its amount doubled.
   *
   * Enforced in applyDamageReplacementEffects (replacement.ts) by scanning
   * state.continuousEffects for this modifier kind.
   */
  | { kind: 'GiselaDamageDoubling' }
  /**
   * Gisela, Blade of Goldnight damage-halving static:
   * "If a source would deal damage to you or a permanent you control,
   *  prevent half that damage, rounded up."
   *
   * While active, every damage event targeting the controller or a permanent they
   * control has its amount reduced: prevented = ceil(amount / 2), so dealt = floor(amount / 2).
   * (half of 3 rounded up = 2 prevented → 1 dealt; half of 4 rounded up = 2 prevented → 2 dealt)
   *
   * Enforced in applyDamageReplacementEffects (replacement.ts).
   */
  | { kind: 'GiselaDamageHalving' }
  /**
   * Tam, Mindful First-Year — "Each other creature you control has hexproof from
   * each of its colors."
   *
   * Each affected creature gains hexproof from every color it is itself colored
   * (e.g. a red creature gains hexproof from red; a green/blue creature gains
   * hexproof from green AND blue). The protected colors are per-creature, not
   * fixed on the static itself.
   *
   * Enforced in validateTargetChoices (targets.ts): when an opponent's spell
   * or ability tries to target a creature, we check whether the targeting
   * source shares any color with the target's own colors AND the target has
   * this modifier active (via continuousEffects). If so, the target is invalid.
   *
   * The modifier carries no color fields because the colors are resolved
   * dynamically from the target creature's own color identity at check time.
   */
  | { kind: 'HexproofFromOwnColors' }
  /**
   * Layer 5 (CR 613.4b): "Each nonland permanent you control is all colors."
   * (Leyline of the Guildpact family.)
   *
   * While this continuous effect is active, every permanent matching the
   * static's filter has its effective color identity overridden to all five
   * colors {W, U, B, R, G} for the purposes of any color check.
   *
   * Queried via getEffectiveColors(state, instanceId) in continuous.ts — the
   * precedent mirrors getEffectivePower / getEffectiveToughness for layer 7.
   * matchesCardFilter (executor.ts) uses getEffectiveColors when a battlefield
   * instance context is available so that color filters, excludeColors,
   * multicolored, and monocolored checks all reflect the overlay.
   */
  | { kind: 'SetAllColors' }
  /**
   * Slice 4 (top-library-play): "Play with the top card of your library revealed.
   * You may play lands and cast spells from the top of your library." family.
   * (Magus of the Future, Melek, Vampire Nocturnus, Korlessa, etc.)
   *
   * While this continuous effect is active (source on battlefield), the controller
   * may play/cast the top card of their library as though it were in their hand.
   * An optional `typeFilter` restricts which cards may be played/cast from the top
   * ("instant and sorcery spells", "Dragon spells", "creature spells with power 2 or less").
   * The reveal/visibility half is free (top card is already known to the engine).
   *
   * Enforced in canCastSpell (stack.ts) and canPlayLandDetailed (actions.ts):
   * when the card being cast/played is at the top of the controller's library,
   * both paths scan continuousEffects for this modifier and, if found, allow
   * the action as if the card were in hand.
   *
   * getLegalActions (ai/legal-actions.ts) also enumerates the top-of-library card
   * as a playable option when this modifier is registered for the player.
   */
  | { kind: 'PlayFromTopLibrary'; typeFilter?: CardFilter }
  /**
   * Slice 13 (CDA-companion): "Nontoken creatures you control are Forest lands in
   * addition to their other types." (Ashaya, Soul of the Wild family).
   *
   * While active, every permanent matching `filter` and controlled by the effect's
   * controller is additionally treated as a land with the given basic land subtype
   * (e.g. 'Forest'). This is a layer-4/6 type-changing effect (CR 613.3b).
   *
   * HONESTY: Enforced in `countForEachCDA` (continuous.ts) — when counting lands
   * for a CDA formula that includes { types: ['land'] } or a specific land-subtype
   * filter, instances with this modifier that match `filter` are also counted.
   * `getGrantedLandSubtype` (continuous.ts) is the single query site so any future
   * mana-production wiring can call the same function.
   *
   * NOTE: Mana production from these creatures (tap for {G}) is NOT wired; the
   * grant only affects land counting for CDA purposes in this implementation.
   * Faces where the companion clause is otherwise unexecuted are declined per the
   * honesty bar.
   */
  | { kind: 'GrantLandSubtype'; subtype: string }
  /**
   * Slice 10 (play-permission): "You may play an additional land on each of
   * your turns." (Exploration, Azusa, Oracle of Mul Daya, Wayward Swordtooth,
   * Case of the Locked Hothouse, etc.).
   *
   * HONEST: maxLandsThisTurn (actions.ts:350) re-scans the oracle text of every
   * battlefield permanent at land-play time and grants the extra drop accordingly.
   * Absorbing this line is genuine enforcement — the ability IS executed. The
   * `selfOnly` marker records it for parse-credit and audit visibility; no
   * continuous-layer consumer is needed because actions.ts is the single enforcement site.
   *
   * `count`: 1 for the standard single-additional-land form; 2+ for Azusa /
   * "two additional lands" forms. Stored for audit; maxLandsThisTurn reads the
   * oracle text directly so the value here is informational only.
   */
  | { kind: 'AdditionalLandDrop'; count: number }
  /**
   * Slice 10 (play-permission): "You may play lands from your graveyard."
   * (Crucible of Worlds, Ancient Greenwarden, Ramunap Excavator, Perennial
   * Behemoth, etc.).
   *
   * HONEST: pure-downside honest skip. The engine has no land-from-graveyard
   * play mechanic (grep src/ confirms zero enforcement in actions.ts / stack.ts).
   * Absorbing this line removes an ability the player cannot access — same
   * precedent as morph/kicker/loyalty-restriction absorption. The `selfOnly`
   * marker credits the face for parse visibility without fabricating any benefit.
   */
  | { kind: 'PlayLandsFromGraveyard' }
  /**
   * Slice 5 (player-level static prohibitions): "You have hexproof."
   * (Ivory Mask, Leyline of Sanctity, Crystal Barricade family).
   *
   * While active (source on battlefield), the controller of the source cannot
   * be targeted by spells or abilities their opponents control.
   *
   * HONEST: validateTargetChoices (targets.ts) scans state.continuousEffects for
   * this modifier when the target is a Player. If found and the caster is NOT
   * the protected player, the target is rejected — mirroring the hexproof check
   * on permanents (canBeTargetedByOpponent). The selfOnly flag limits coverage
   * to the source's controller only (not opponents).
   */
  | { kind: 'PlayerHexproof' }
  /**
   * Slice 5 (player-level static prohibitions): "You have shroud."
   * (Ivory Mask — older printings, Spirit of the Labyrinth variants).
   *
   * While active, the controller of the source cannot be targeted by ANY spell
   * or ability, including their own.
   *
   * HONEST: validateTargetChoices (targets.ts) scans state.continuousEffects for
   * this modifier when the target is a Player, and rejects the target regardless
   * of whether the caster is the same player or an opponent — mirroring shroud
   * on permanents (canBeTargetedByController / canBeTargetedByOpponent).
   */
  | { kind: 'PlayerShroud' }
  /**
   * Slice 5 (player-level static prohibitions): "Players can't gain life."
   * (Leyline of Punishment, Sulfuric Vortex, Erebos, God of the Dead family).
   *
   * While active (source on battlefield), executeGainLife (executor.ts) is
   * short-circuited for ALL players — no player may gain life.
   *
   * HONEST: executeGainLife already calls applyReplacements with a LifeGained
   * event and returns early when the result is null. We additionally scan
   * state.continuousEffects for this modifier before the replacement chain and
   * skip the gain entirely, mirroring the playerCantLoseLife pattern in
   * game-outcome.ts.
   */
  | { kind: 'CantGainLife' }
  /**
   * Slice 5 (player-level static prohibitions): "Damage can't be prevented."
   * (Leyline of Punishment, Everlasting Torment, Sulfuric Vortex family).
   *
   * While active (source on battlefield), all damage prevention effects
   * (state.damagePreventionEffects and DamageDealt replacement effects in the
   * activeReplacements registry) are bypassed.
   *
   * HONEST: applyDamageReplacementEffects (replacement.ts) checks for this
   * modifier in state.continuousEffects and skips the prevention loops when
   * found. Gisela-style doubling/halving (which is NOT prevention) still applies.
   */
  | { kind: 'DamageCantBePrevented' }
  /**
   * Slice 10 (combat statics): "Cast this spell only during the declare blockers step."
   * (Mirror Match family).
   *
   * Recognition-only marker (selfOnly) emitted by matchCastOnlyDuringDeclareBlockers
   * in static-abilities.ts.  The enforcement hook is in canCastSpell (stack.ts):
   * a function hasCastOnlyDuringDeclareBlockers reads the spell's oracle text at
   * cast time and, when found, requires state.step === 'declare_blockers'.
   *
   * HONEST: canCastSpell already enforces timing for instants / sorceries;
   * the oracle-text scan adds the step-level gate without new infrastructure.
   */
  | { kind: 'CastOnlyDuringDeclareBlockers' }
  /**
   * Slice 10 (combat statics): "Creatures with power less than this creature's power
   * can't block it."  (Wandering Wolf family).
   *
   * Recognition-only marker (selfOnly) emitted by matchPowerLessThanCantBlock in
   * static-abilities.ts.  The enforcement hook is in canBlock (keywords.ts): a
   * function attackerHasPowerLessRestriction reads the attacker's oracle text at
   * block-declaration time and returns false when the potential blocker's effective
   * power is strictly less than the attacker's effective power.
   *
   * HONEST: canBlock is the single blocking gate; this mirrors the skulk check
   * (blockerPower > attackerPower → fail) but in the opposite direction
   * (blockerPower < attackerPower → fail).
   */
  | { kind: 'PowerLessThanThisCantBlock' }
  /**
   * Slice 4/CBC: "Your opponents can't cast spells during your turn."
   * (Dragonlord Dromoka family). A continuous static ability on a battlefield
   * permanent whose controller's opponents cannot cast spells while it is the
   * controller's turn.
   *
   * HONEST: canCastSpell (stack.ts) scans continuousEffects for this modifier
   * when an opponent of the effect's controller tries to cast during the
   * controller's active turn. Registered via registerContinuousAbilitiesForPermanent.
   */
  | { kind: 'OpponentsCantCastDuringYourTurn' };

/**
 * A static ability that applies continuously while the source is on the battlefield.
 * Examples:
 *   "Creatures you control get +1/+1"
 *   "Other creatures you control have flying"
 *   "Spells you cast cost {1} less to cast"
 *   "Elves you control get +1/+1"
 */
export interface StaticAbilityEffect {
  kind: 'StaticAbility';
  modifier: StaticModifier;
  filter: CardFilter;
  controller: 'you' | 'opponent' | 'any';
  excludeSelf: boolean; // true for "Other creatures you control..."
  selfOnly?: boolean; // true for "~ gets..." / named-card self modifiers
  // true for Aura/Equipment "Enchanted/Equipped creature gets..." statics. These
  // are applied to the attached permanent via the cached equipmentBonus path
  // (continuous.ts getEquipmentPTBonus + keywords.ts), so the continuous
  // StaticAbility path must skip them to avoid double-application.
  attachedOnly?: boolean;
  // Conditional statics — "As long as <condition>, this creature gets +X/+Y"
  // (incl. Threshold). Evaluated continuously at query time against the
  // source's controller (continuous.ts isAffectedBy / getCostReduction and
  // keywords.ts getKeywordsForInstance); while false the modifier does not apply.
  condition?: Condition;
}

// ============================================================================
// Phase 15: Conditional Effects
// ============================================================================

/**
 * A condition that can be checked against the game state.
 */
export type Condition =
  // excludeSource: "you control ANOTHER <filter>" — the condition's source
  // permanent itself does not satisfy the filter. Only meaningful where a
  // source instance is in scope (continuous.ts evaluateCondition).
  | { kind: 'ControlsType'; controller: 'you' | 'opponent'; filter: CardFilter; excludeSource?: boolean }
  | { kind: 'ControlsMoreThan'; who: 'opponent'; what: CardFilter; thanWho: 'you' }
  | { kind: 'CardsInZoneAtLeast'; controller: 'you' | 'opponent' | 'each'; zone: 'battlefield' | 'hand' | 'graveyard' | 'library'; count: number; filter?: CardFilter }
  | { kind: 'LifeAtOrBelow'; controller: 'you' | 'opponent'; amount: number }
  | { kind: 'LifeAtOrAbove'; controller: 'you' | 'opponent'; amount: number }
  /**
   * Slice 7: "as long as your life total is less than or equal to half your starting life total"
   * (Bhaal / Myrkul family). The threshold is half the controller's starting life total,
   * computed at evaluation time from player.startingLife (defaults to 40 in Commander).
   */
  | { kind: 'LifeAtOrBelowHalfStarting'; controller: 'you' | 'opponent' }
  /**
   * Slice 7: "as long as your life total is greater than your starting life total"
   * (Elenda, Saint of Dusk family). The threshold is the controller's starting life total.
   */
  | { kind: 'LifeAboveStarting'; controller: 'you' | 'opponent' }
  | { kind: 'PlayerAttackedThisTurn'; controller: 'you' | 'opponent' }
  /** True when at least one creature has died this turn (state.creaturesDiedThisTurn > 0). */
  | { kind: 'CreatureDiedThisTurn' }
  /** True when opponents collectively control at least `count` permanents matching `what`. */
  | { kind: 'OpponentsControlAtLeast'; count: number; what: CardFilter }
  // "<color> is the most common color among all permanents [or is tied for
  // most common]" (Zanam/Sulam/Ruham/Goham Djinn). Counts each battlefield
  // permanent once per color it has; colorless permanents count for nothing.
  | { kind: 'ColorIsMostCommonAmongPermanents'; color: 'W' | 'U' | 'B' | 'R' | 'G'; orTiedForMost?: boolean }
  // Slice 12: Lieutenant family — "as long as you control your commander."
  // True when the source's controller has any battlefield permanent marked as
  // their commander (card.isCommander === true or listed in
  // player.commanderInstanceId / commanderInstanceIds).
  | { kind: 'ControlsCommander' }
  /**
   * Slice 12: "if that player has more cards in hand than you" —
   * the event player's hand size exceeds the trigger controller's hand size.
   * Resolved using eventContext.eventPlayerId at execution time.
   * Used by Anvil of Bogardan family per-player upkeep conditional riders.
   */
  | { kind: 'EventPlayerHasMoreCardsInHand' }
  /**
   * Slice 2 (werewolf day->night): "if no spells were cast last turn."
   * True when state.spellsCastLastTurn === 0.
   */
  | { kind: 'NoSpellsLastTurn' }
  /**
   * Slice 2 (werewolf night->day): "if a player cast two or more spells last turn."
   * True when state.spellsCastLastTurn >= 2 (total across all players, since
   * the engine tracks a single aggregate count in spellsCastLastTurn).
   */
  | { kind: 'AnyPlayerTwoOrMoreSpellsLastTurn' }
  /**
   * Slice 1 (negated-control): "as long as you control no [other] <filter>" /
   * "as long as your opponents control no <filter>". True when NO battlefield
   * permanent owned by the specified controller matches the filter.
   * Examples: Erebos's Titan (opponents control no creatures),
   * Jeskai Infiltrator (you control no other creatures),
   * Angelic Voices (you control no nonartifact, nonwhite creatures).
   */
  | { kind: 'ControlsNone'; controller: 'you' | 'opponent'; filter: CardFilter; excludeSource?: boolean }
  /**
   * Slice 11 (intervening-if ETB): "When this creature enters, if you cast it, <effect>."
   * True when the permanent entered the battlefield as the result of being cast
   * (not put by another effect such as reanimate, blink, token creation, etc.).
   * Evaluated at trigger resolution against eventContext.enteredViaCast, which
   * createETBTriggers sets to true only for the spell-resolution path in stack.ts.
   */
  | { kind: 'EnteredByCasting' }
  /**
   * Slice 9/11 (self-static pump): "as long as you've cast two or more spells this turn."
   * True when state.spellsCastThisTurn >= count. Evaluated in continuous.ts
   * evaluateCondition; state.spellsCastThisTurn is incremented by castSpell in stack.ts
   * and reset to 0 at each turn start.
   * Example: Brightspear Zealot (count=2), Effortless Master-adjacent forms.
   */
  | { kind: 'SpellsCastThisTurnAtLeast'; count: number }
  /**
   * Slice 9/11 (self-static pump): "as long as there are N or more mana values among
   * cards in your graveyard" (Syndicate Infiltrator family / delirium-adjacent).
   * True when the controller's graveyard contains cards with at least `count` DISTINCT
   * mana values (CMC values). Evaluated in continuous.ts evaluateCondition by
   * iterating over the controller's graveyard and collecting a Set<number> of cmc values.
   */
  | { kind: 'DistinctManaValuesInGraveyardAtLeast'; count: number }
  /**
   * Slice 5 (Delirium): "as long as there are four or more card types among cards in your
   * graveyard." True when the controller's graveyard contains cards spanning at least `count`
   * DISTINCT card types from the standard set (artifact, creature, enchantment, instant, land,
   * planeswalker, sorcery, battle). Each card contributes all of its own card types; a
   * double-faced card or split card with two types contributes each type once.
   * Evaluated in continuous.ts evaluateCondition by iterating the controller's graveyard,
   * collecting a Set<string> of card_types seen.
   * Examples: Thraben Foulbloods, Inquisitor's Ox, Gnarlwood Dryad (all Delirium).
   */
  | { kind: 'CardTypesInGraveyardAtLeast'; count: number }
  /**
   * Slice 4 (top-card-conditional anthem): "as long as the top card of your library is
   * <color> / a <type> card" (Vampire Nocturnus, Crown of Convergence family).
   *
   * True when the controller's library is non-empty AND the top card satisfies the
   * specified color or card-type predicate.
   *
   * `colors` — one or more color identifiers (e.g. ['B'] for "is black", ['W','U'] for
   *   "is white or blue"). The top card must include at least one of the listed colors.
   * `cardTypes` — one or more card types (e.g. ['creature'] for "is a creature card").
   *   The top card must have at least one matching card_type.
   *
   * Exactly one of `colors` or `cardTypes` is set; both set = implementation error.
   * Evaluated in continuous.ts evaluateCondition by reading state.cards and finding
   * the first card whose ownerId equals the controller and zone equals 'library'.
   * The engine preserves Map insertion order for library zones so the first matching
   * entry is the top of the library (same assumption used by canPlayCardFromTopOfLibrary
   * in stack.ts).
   */
  | { kind: 'TopCardOfLibraryIs'; colors?: Array<'W' | 'U' | 'B' | 'R' | 'G'>; cardTypes?: string[] }
  /**
   * Slice 11 (self conditional anthem): "During your turn, this creature gets +N/+N."
   * True when the source's controller is the current active player
   * (state.players[state.activePlayerIndex].id === controllerId).
   * Evaluated in continuous.ts evaluateCondition.
   */
  | { kind: 'IsActivePlayer' }
  /**
   * Slice 2 — conditional self-buff: "as long as it's untapped" (Giant Tortoise family).
   * True when the source permanent is NOT tapped (card.tapped === false).
   * `sourceInstanceId` must be provided to evaluateCondition; if missing, evaluates false.
   * Evaluated in continuous.ts evaluateCondition by reading state.cards.get(sourceInstanceId).
   */
  | { kind: 'SelfIsUntapped' }
  /**
   * Slice 2 — conditional self-buff: "as long as it's attacking" (Freyalise's Winds family).
   * True when the source creature is currently declared as an attacker
   * (state.combat?.attackers contains the sourceInstanceId).
   * `sourceInstanceId` must be provided; if missing or no combat, evaluates false.
   * Evaluated in continuous.ts evaluateCondition.
   */
  | { kind: 'SelfIsAttacking' }
  /**
   * Slice 5 — conditional self-buff: "as long as this creature is equipped"
   * (Skyhunter Cub / Kitesail Apprentice / Armory Veteran family).
   * True when any battlefield permanent with subtype Equipment has
   * `attachedTo === sourceInstanceId`. sourceInstanceId must be provided
   * to evaluateCondition; if absent, evaluates false.
   * Evaluated in continuous.ts evaluateCondition.
   */
  | { kind: 'SelfIsEquipped' }
  /**
   * Slice 5 — conditional self-buff: "as long as this creature is enchanted"
   * (Thran Golem / Freewind Equenaut family).
   * True when any battlefield permanent with card type enchantment (Aura)
   * has `attachedTo === sourceInstanceId`. sourceInstanceId must be provided
   * to evaluateCondition; if absent, evaluates false.
   * Evaluated in continuous.ts evaluateCondition.
   */
  | { kind: 'SelfIsEnchanted' };

/**
 * A conditional effect that checks a condition before executing.
 * Examples:
 *   "If you control a Dragon, draw two cards"
 *   "If an opponent controls more creatures than you, draw a card"
 *   "As long as you control an enchantment, ~ gets +1/+1"
 */
export interface ConditionalEffect {
  kind: 'Conditional';
  condition: Condition;
  effect: Effect;
  elseEffect?: Effect;
}

// ============================================================================
// Phase 17: Planeswalker Loyalty Abilities
// ============================================================================

/**
 * A planeswalker loyalty ability.
 * Loyalty cost can be positive (+N), negative (-N), or zero (0).
 * Examples:
 *   "+1: Create a 1/1 white Soldier creature token."
 *   "-3: Destroy target creature."
 *   "0: Draw a card."
 */
export interface LoyaltyAbility {
  kind: 'LoyaltyAbility';
  loyaltyCost: number; // positive (+1), negative (-3), or 0
  effects: Effect[];
  targets: { id: string; type: string }[];
}

// ============================================================================
// Cached Parse Data — computed once at card load time
// ============================================================================

export interface ManaProductionInfo {
  colors: Array<'W' | 'U' | 'B' | 'R' | 'G' | 'C'>;
  amounts: Record<string, number>;
  isTapAbility: boolean;
  requiresSacrifice: boolean;
  exileAfterUse?: boolean;
  sacrificeFilter?: CardFilter;
  activationZone?: 'battlefield' | 'hand';
  requiresExileFromHand?: boolean;
  requiresDiscardHand?: boolean;
  amountScale?: 'creaturesYouControl';
  restriction?: 'creatureSpell' | 'creatureTypeSpell' | 'legendarySpell' | 'commanderSpell';
  /** True for fixed bundles such as "{T}: Add {C}{G}" where all listed mana is produced together. */
  producesAllColors?: boolean;
}

export interface EquipmentBonusInfo {
  power: number;
  toughness: number;
  keywords: string[];
  /**
   * CR 613.4 layer 7b: an aura/effect SETS the attached creature's base power and
   * toughness (e.g. Lignify "base power and toughness 0/4", Darksteel Mutation 0/1).
   * Overrides def.power/def.toughness before +1/+1 counters and pumps stack on top.
   */
  setBasePower?: number;
  setBaseToughness?: number;
  /**
   * CR 613 layer 4: aura/equipment ADDS card types to the attached permanent
   * ("becomes an artifact in addition to its other types"). Unioned onto the
   * printed card_types in getEffectiveCardTypes so combat/targeting/SBA see them.
   */
  addTypes?: import('../types').CardType[];
  /**
   * CR 613 layer 4 SET: aura/equipment REPLACES the attached permanent's card
   * types ("is an Insect artifact creature ..."). Applied before addTypes.
   */
  setTypes?: import('../types').CardType[];
  /**
   * CR 613 layer 6: the attached permanent "loses all [other] abilities"
   * (Darksteel Mutation, Lignify, Ovinize). The permanent's OWN printed +
   * continuous keywords are suppressed; keywords GRANTED by this same aura (in
   * `keywords` above, e.g. Darksteel Mutation's Indestructible) still apply, since
   * they have a later timestamp than the ability loss. (Suppression of the
   * permanent's triggered/activated/static abilities is a separate follow-up.)
   */
  losesAllAbilities?: boolean;
}

export interface EquipCostInfo {
  generic: number;
  W: number; U: number; B: number; R: number; G: number; C: number;
}

export interface UnlessTaxInfo {
  triggerKind: string;
  taxAmount: number;
  effect: 'draw' | 'treasure' | 'other';
  effectCount: number;
}

/**
 * Slice 10: "Your opponents can't cast spells this turn." (Silence family).
 * Prohibits all of the caster's opponents from casting spells for the duration
 * of the current turn. The executor registers a SpellCastProhibitionRef in
 * state.spellCastProhibitions; canCastSpell (stack.ts) enforces the prohibition.
 */
export interface OpponentsCantCastSpellsEffect {
  kind: 'OpponentsCantCastSpells';
}

/**
 * Slice 10: "You may choose new targets for target spell or ability."
 * (Deflecting Swat family). Rewrites the targets array of a single-target stack
 * item. `target` points at the stack item (a spell or triggered/activated
 * ability); `newTargetId` is the new target id supplied at execution time via
 * the chosenTargets map or options. v1: only single-target spells are rewritten;
 * spells with ≠ 1 target are a no-op (honesty bar).
 */
export interface ChangeSpellTargetsEffect {
  kind: 'ChangeSpellTargets';
  /** TargetRef resolving to a spell or ability on the stack. */
  target: TargetRef;
  /** TargetRef resolving to the new single target (card instance or player id). */
  newTarget: TargetRef;
}

/**
 * Slice 1 (base P/T set): "Target creature has base power and toughness N/M
 * until end of turn." Layer 7b SET — overrides printed value and equipment/aura
 * base-set bonuses for the remainder of the turn.
 */
export interface SetBasePTEffect {
  kind: 'SetBasePT';
  target: TargetRef;
  power: number;
  toughness: number;
  /** Optional keywords granted simultaneously (e.g. flying, hexproof from Water Wings). */
  keywords?: string[];
  /**
   * Slice 7 (transient polymorph): when true, the target also loses all abilities
   * for the turn (Turn to Frog / Dance of the Skywise / Turn//Burn family).
   * Sets `transientLosesAllAbilities: true` on the target CardInstance;
   * instanceLosesAllAbilities() in keywords.ts checks this flag.
   */
  losesAllAbilities?: true;
  /**
   * Slice 7 (transient polymorph): creature subtypes to grant transiently for the
   * turn (stored in `grantedSubtypes` on the target CardInstance, same as the
   * SetCreatureType activated-ability path). e.g. ['frog'] for Turn to Frog.
   */
  subtypes?: string[];
}

export interface SearchAbilityInfo {
  filter?: string;
  destination: 'hand' | 'battlefield' | 'top' | 'graveyard';
  tapped?: boolean;
  shuffle: boolean;
  /** Maximum cards searchable. 1 for "a card", 2 for "up to two ... cards", etc. Defaults to 1. */
  count?: number;
}

/**
 * Slice 9 (pump + grant-quoted-dies-ability):
 * Grants a transient "When this creature dies, <effects>" trigger to the
 * target creature for the remainder of the turn. The executor adds the
 * trigger to `battlefieldAbilities` for the target instance; state-based.ts
 * fires it when the creature dies (trigger.kind === 'Dies', trigger.who === 'self').
 */
export interface GrantDiesTriggerEffect {
  kind: 'GrantDiesTrigger';
  /** The creature receiving the granted Dies trigger (Chosen ref). */
  target: TargetRef;
  /** The effects that fire when the creature dies. */
  dieEffects: Effect[];
}

/**
 * Slice 9 (switch P/T): "Switch [target creature's | its] power and toughness
 * until end of turn." (Dwarven Thaumaturgist / Merfolk Thaumaturgist /
 * Valakut Fireboar family.)
 *
 * `target` is the creature whose P/T are swapped. May be a Chosen ref (targeted
 * form) or Source (self-trigger / one-shot form on self). The swap is a layer-7c
 * continuous effect stored as `_switchPT: 1` in the card's counters, cleared at
 * end-of-turn cleanup.
 */
export interface SwitchPowerToughnessEffect {
  kind: 'SwitchPowerToughness';
  target: TargetRef;
}

/**
 * Slice 8/11: CastFromRevealedHandEffect
 * See the union-member comment above for semantics.
 */
export interface CastFromRevealedHandEffect {
  kind: 'CastFromRevealedHand';
  /**
   * The player whose hand is revealed (typically a Chosen opponent target).
   */
  player: TargetRef;
  /**
   * Filter restricting which cards from the revealed hand may be cast.
   * For Mindclaw Shaman this is { types: ['instant', 'sorcery'] } (either type).
   * The executor selects the highest-mana-value matching card as the AI fallback.
   */
  filter: CardFilter;
  /**
   * Named choice key for an explicit user-selected card instance id.
   * Defaults to 'castFromHandCardId' if not set.
   */
  selectedCardChoiceId?: string;
}

/**
 * Slice 9: Reveal the top N cards, an opponent chooses one, chosen goes to
 * `chosenDestination`, rest go to `restDestination`.
 * (Murmurs from Beyond / Truth or Tale / Allure of the Unknown — single-pile form.)
 */
export interface RevealTopDistributeEffect {
  kind: 'RevealTopDistribute';
  /** Player who reveals their library (always Controller for this family). */
  player: TargetRef;
  /** How many cards to reveal from the top. */
  count: number;
  /**
   * Where the opponent-chosen card goes ('graveyard' or 'hand').
   * For Murmurs from Beyond: 'graveyard'; for a hypothetical inverse: 'hand'.
   */
  chosenDestination: 'graveyard' | 'hand';
  /**
   * Where the unchosen cards go ('hand' or 'graveyard').
   * For Murmurs from Beyond: 'hand'; complementary to chosenDestination.
   */
  restDestination: 'hand' | 'graveyard';
  /**
   * Optional filter on which revealed cards the opponent may choose.
   * When set, the opponent must pick a card matching this filter (e.g.
   * Allure of the Unknown's "nonland card"). The executor enforces the
   * filter at choice-resolution time; unchosen cards and non-matching
   * cards all go to restDestination.
   */
  filter?: CardFilter;
  /**
   * namedCardChoices key for the opponent's chosen card instance id.
   * Defaults to 'opponentChosenCardId'.
   */
  chosenCardChoiceId?: string;
}

/**
 * Slice 9 (reveal-top-split-two-piles): Steam Augury / Fact-or-Fiction two-pile form.
 * See the Effect union entry above for full documentation.
 */
export interface RevealTopSplitTwoPilesEffect {
  kind: 'RevealTopSplitTwoPiles';
  /** Player who reveals their library (always Controller for this family). */
  player: TargetRef;
  /** How many cards to reveal from the top. */
  count: number;
  /**
   * Where the opponent-chosen pile goes ('hand' or 'graveyard').
   * For Steam Augury (opponent chooses which pile controller gets): 'hand'.
   */
  pileChosenDestination: 'hand' | 'graveyard';
  /**
   * Where the unchosen pile goes. Complement of pileChosenDestination.
   */
  pileOtherDestination: 'hand' | 'graveyard';
  /**
   * namedCardChoices key for the controller's pile-split.
   * Value: comma-separated instance ids forming pile A; remaining revealed cards form pile B.
   * Defaults to 'pileSplitIds'.
   */
  pileSplitChoiceId?: string;
  /**
   * namedCardChoices key for the opponent's chosen pile ('A' or 'B').
   * Defaults to 'opponentChosenPile'.
   */
  opponentChosenPileChoiceId?: string;
}

/**
 * Slice 7 (lure): "All creatures able to block <subject> [this turn] do so."
 * See the Effect union entry above for full documentation.
 */
export interface MustBeBlockedIfAbleEffect {
  kind: 'MustBeBlockedIfAble';
  /**
   * Which creature must be blocked:
   *   'Source'          — the source permanent itself (Elvish Bard / Breaker of Armies)
   *   'SourceAttachedTo'— the equipped/enchanted creature (Nemesis Mask)
   *   'Chosen'          — a chosen targeted creature (Taunting Challenge)
   */
  subject: TargetRef;
}

/**
 * Slice 4: Planeswalker's Favor / Planeswalker's Fury / Wand of Ith family.
 * "Target opponent/player reveals a card at random from their hand."
 *
 * Information-only reveal (no zone change). The executor randomly picks a card
 * from the target's hand (deterministic: lowest instanceId for AI, or
 * namedCardChoices['randomRevealedCardId'] when explicitly provided) and stores
 * its mana value in ctx.lastRevealedCardManaValue so that sibling effects
 * (ModifyPT with RevealedRandomCardManaValue / DealDamage with RevealedRandomCardManaValue)
 * can resolve "that card's mana value" at execution time.
 */
export interface RevealRandomCardFromHandEffect {
  kind: 'RevealRandomCardFromHand';
  /** Whose hand is revealed (the Chosen target — always a Player). */
  player: TargetRef;
  /**
   * Slice 11: Wand of Ith family — "if it's a <filter> card, that player discards it."
   * When set, the executor discards the randomly revealed card if it matches this filter.
   * The reveal is otherwise information-only (same as the base form).
   */
  conditionalDiscardFilter?: CardFilter;
}

/**
 * Slice 6: "Until your next turn, spells your opponents cast cost {N} more to cast."
 * (Tax Collector / Gobakhan ETB-triggered cost increase.)
 *
 * Registers a SpellCostTaxRef in state.spellCostTaxes. The tax applies to all
 * opponents of the ability's controller and expires when the controller's
 * next turn begins (pruned by pruneSpellCostTaxes in turn-manager.ts).
 *
 * HONEST: getSpellCostTaxIncrease (stack.ts) reads state.spellCostTaxes and
 * adds `amount` to the generic cost for opponents of the tax's controllerId.
 * Mirrors OpponentsCantCastSpells but increases cost instead of prohibiting.
 */
export interface OpponentSpellCostTaxEffect {
  kind: 'OpponentSpellCostTax';
  /** Generic mana increase applied to spells cast by opponents. */
  amount: number;
}

/**
 * Slice 8/12: "that player exiles a card at random from their hand."
 * (Elkin Lair / Wild Evocation exile-from-hand family.)
 *
 * `player` identifies whose hand to exile from (always EventPlayer for
 * each-player-upkeep triggers). `count` is how many cards to exile.
 * Cards are selected at random using the same seeded shuffle as Discard(random:true).
 */
export interface ExileFromHandEffect {
  kind: 'ExileFromHand';
  player: TargetRef;
  count: AmountRef;
}

/**
 * Slice 8/12: "that player may pay <cost>. If they don't, <downside>."
 * (Umbilicus / Emberwilde Djinn / Illusions of Grandeur family.)
 *
 * The player identified by `player` (always EventPlayer for each-player-upkeep
 * triggers) may pay the specified cost. If they cannot or choose not to, the
 * `downsideEffects` are applied with the same event player bound.
 *
 * AI policy: pay if affordable (respecting the same life buffer as OptionalPay).
 */
export interface EachPlayerUnlessPayEffect {
  kind: 'EachPlayerUnlessPay';
  player: TargetRef;
  manaCost?: number | string;
  lifeCost?: number;
  downsideEffects: Effect[];
}
