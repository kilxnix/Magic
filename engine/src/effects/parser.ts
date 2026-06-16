// Phase 4: Oracle text parser
// Phase 10: Extended with modal, X costs, tokens, and more patterns
// Phase 14: Expanded with ForEach, ExileFromLibrary, GainControl, sacrifice-as-effect, and more
// Phase 16: Blink/flicker, copy effects, keyword granting, phasing
// Phase 17: Planeswalker loyalty abilities and additional trigger types
// Converts tokenized oracle text into Effect AST + required TargetSpecs
//
// LAYOUT (post-modularization) — read before adding matchers:
// - Matcher bodies live in src/effects/matchers/<family>.ts (tokens, counters,
//   keyword-actions, damage, life-draw-mill, players, zones, mass-effects,
//   search-dig, pump-grants, trigger-prefixes, static-abilities). This file
//   keeps orchestration: tokenization, clause walking, and the dispatch arrays.
// - To add a matcher: write the function in its family module, export it,
//   import it here, then insert ONE entry at the correct position in BOTH
//   dispatch arrays — the `patterns` list in parseEffectClauseInternal AND the
//   `patterns` list in parseEffectClause. Ordering is SEMANTIC (specific/
//   complex patterns before general ones, X/where-X variants before their base
//   forms); a wrong position silently changes what parses.
// - Shared helpers (makeTargetSpec, COLOR_WORDS, filter/amount parsing, etc.)
//   are exported from this file; family modules import them from './parser'.

import { tokenizeOracleText } from './tokens';
import type { Effect, TriggeredAbility, Trigger, TargetRef, SourceRef, TokenDefinition, AmountRef, ModalSpell, ModalChoice, ActivatedAbility, ActivatedAbilityCost, CardFilter, ForEachAmount, BlinkEffect, CopyEffect, CopySpellEffect, GrantKeywordEffect, PhaseOutEffect, LoyaltyAbility, StaticAbilityEffect, StaticModifier, Condition, ConditionalEffect, WinGameEffect, LoseGameEffect, RollD20Outcome } from './ast';
import type { TargetSpec, TargetType } from './targets';
import { matchCreateToken, matchThatPlayerCreatesToken, matchCreateTokenEqualTo, matchCreateTokenForEach, matchCreateTokenThatMany, matchThatPlayerCreatesThatManyTokens, matchCreateTokenCopy } from './matchers/tokens';
import { matchAddCounters, matchAddCountersWhereX, matchEntersWithCountersWhereX, matchEntersWithCountersForEach, matchEntersWithCountersEqualTo, isEntersWithCountersDynamicLine, matchRemoveCounters, matchRemoveCountersTarget, matchRemoveCountersWhereX, matchRemoveAllCountersFromTarget, matchAddCountersAttached, matchYouGetCounters, matchGainEnergy, matchSupport, matchAddCountersThatMany, matchDistributeCounters, matchThatPlayerPutsCounterOnLandTheyControl, matchEntersWithCounters, isEntersWithCountersLine, matchMoveCounters, matchThatPlayerGetsCounters, matchAddCountersEqualToDevotion, matchTheyGetThatManyCounters, matchEntersWithCountersConditional, isEntersWithCountersConditionalLine, matchAddCountersForEach } from './matchers/counters';
import { matchInvestigate, matchExplore, matchAdapt, matchBolster, matchMonstrosity, matchFabricate, matchPopulate, matchAmass, matchConnive, matchProliferate, matchBecomeMonarch, matchScry, matchSurveil, matchGoad, matchRegenerate, matchRegenerateEnchantedCreature, matchPhaseOut, matchTap, matchUntap, matchUntapUpToOneTargetCreature, matchTapXTargetPermanents, matchUntapXTargetPermanents, matchWinGame, matchLoseGame, matchPreventGameOutcome, matchAddMana, matchForEachAddMana, matchAddManaAnyColor, matchAddManaAnyColorDynamic, matchAddManaChosenColor, matchTransformSelf } from './matchers/keyword-actions';
import { matchDealDamage, matchDealDamageEqualTo, matchDealDamageDivided, matchDealXDamage, matchDealDamageXWhereX, matchDealDamageForEach, matchDealDamageGreatestManaValue, matchPreventDamage, matchOneSidedDealDamageByPower, matchDamageToItselfByPower, matchFight, matchHaveItDealDamage, matchSelfFightUpToOneTarget, matchDealDamageEqualToEventPlayerControls, matchEnchantedCreatureFight, matchEnchantedCreatureDealsDamageByPower, matchDealDamageToEventCreatureController, matchDealsThatMuchDamageToTarget, matchDealDamageTwiceItsPower, matchMutinyStyle, matchEachSubtypeDealsDamageByPower, matchDealDamageSacrificedCreaturePower, matchDealsThatMuchDamageToEachCreatureThatPlayerControls, matchDealDamageXBaseMinusCount, matchDealDamageTwoTargets, matchThatPlayerLosesLifeXWhereX, matchDealDamageEachUpToNTargets, matchRedirectDamage } from './matchers/damage';
import { matchDraw, matchTargetPlayerDraw, matchThatPlayerDraw, matchDrawX, matchDrawXWhereX, matchDrawEqualToNumberOf, matchDrawEqualToGreatestToughness, matchForEachDraw, matchGainLife, matchLoseLife, matchGainLifeXWhereX, matchLoseLifeXWhereX, matchGainLifeEqualToNumberOf, matchLoseLifeEqualToNumberOf, matchTargetPlayerGainLifeX, matchTargetPlayerGainLife, matchTargetPlayerLoseLife, matchTargetPlayerLoseLifeEqualToNumberOf, matchEachPlayerGainLife, matchEachOpponentLosesLife, matchEachOpponentLosesXLifeWhereX, matchMill, matchMillXWhereX, matchMillEqualToNumberOf, matchEachPlayerOrOpponentMill, matchThatPlayerMill, matchGainLifeThatMuch, matchEachPlayerGainsThatMuchLife, matchDealsDamageThatMuchToCreatureController, matchDrawThatManyCards, matchTargetPlayerMillsThatManyCards, matchThatPlayerMillsThatManyCards, matchLoseLifeThatMuch, matchGainLifeSacrificedCreaturePower } from './matchers/life-draw-mill';
import { matchDiscard, matchDiscardSelf, matchThatPlayerDiscard, matchThatPlayerDiscardsThatMany, matchTargetPlayerDiscardAtRandom, matchEachOpponentDiscardsCard, matchRevealHandChooseCard, matchRevealHandAndTopOfLibraryChooseCard, matchRevealHandGainLife, matchRevealHandDiscardAll, matchRevealHandDiscardAllTwoSentence, matchRevealHandDiscardAtRandomFiltered, matchExileAllFromTargetHand, matchLookAtTargetPlayerHand, matchPutLandFromHandOntoBattlefield, matchEachPlayerEffect, matchEachOpponentSacrifice, matchTargetPlayerSacrifice, matchSacrificeAsEffect, matchSacrificeSelfUnlessTargetOpponentSacrifices, matchSacrificeSelfUnlessPay, matchGainControl, parseChosenHandCardFilter, matchThatPlayerReturnsCreature, matchThatPlayerReturnsMassBounce, matchThatPlayerUntapsLand, matchRevealHandChooseCardWithLifeGainRider, matchLookAtHandThenChooseCard, matchRevealHandDiscardXCards, matchDefendingPlayerEffect, matchRevealHandChosenColorChooseCard, matchRevealHandChosenColorDiscardAll, matchEachOpponentRevealsHandDiscardsFilter, matchRevealHandChooseCardEtbExileUntil, matchThatPlayerGainsControl, matchThatPlayerAddsMana, matchThatPlayerAddsManaAnyType, matchEachPlayerLosesHalfLife, matchOpponentsCantCastSpells, matchThatPlayerPutPermanentFromHandOntoBattlefield, matchThatPlayerLosesLife, matchCastFromRevealedHand, matchThatPlayerExilesFromGraveyard, matchThatPlayerPutsCardOnTopOfLibrary, matchRevealRandomCardFromHand, matchRevealRandomCardConditionalDiscard, matchUntilYourNextTurnOpponentSpellCostIncrease, matchThatPlayerRevealHandCoercion, matchTargetPlayerPartialRevealChooseCard, matchThatPlayerExilesAtRandom, matchRevealHandChooseCardAndGraveyardExile, matchRevealHandCommaThenChooseCard } from './matchers/players';
import { matchDestroy, matchDestroyPairedTypedTargets, matchExile, matchReturnToHand, matchReturnThatPlayerControlsToHand, matchReturnUpToOneOtherTargetYouControlToHand, matchReturnPermanentYouControlToHand, matchReturnThatCardToHand, matchReturnThatCardToBattlefield, matchReturnFromGraveyard, matchPutCreatureCardFromOpponentGraveyardOntoBattlefield, matchBlink, matchEnterAsCopy, matchPutIntoLibrary, matchPutGraveyardCardIntoLibrary, matchChosenTypeReturnFromGraveyard } from './matchers/zones';
import { matchDestroyAll, matchDestroyAllExpanded, matchDestroyAllColorCreatures, matchDestroyAllSubtypeCreatures, matchDestroyAllLandSubtype, matchDestroyAllTappedCreatures, matchExileAll, matchExileAllColorCreatures, matchReturnAllToHand, matchReturnAllFromGraveyard, matchExactMultiTarget, matchMassOpponentDebuff, matchMassKeywordHolderDebuff, matchDestroyAllNoncolorCreatures, matchDestroyAllTokenFilter, matchReturnAllTokenFilter, matchDestroyAllLegendaryFilter, matchExileAllSubtypeCreatures, matchDestroyAllBlockingBlocked, matchChooseNTargetSpell } from './matchers/mass-effects';
import { matchSearchLibraryGeneric, matchSearchThisWayShuffleTail, matchSearchLibrary, matchExileFromLibraryTop, matchThatPlayerExilesTopN, matchRevealTopIfMatch, matchRevealTopTake, matchRevealTopOntoBattlefield, matchDigTopTakeRest, matchLookAtTopPutOneIntoHand, matchLookAtTopReorderBack, matchRevealTopTakeExtended, matchDarkConfidantReveal, matchRevealTopSubtypeFilter, matchLookAtTopPutOneToBattlefield, matchRevealUntilMatch, matchRevealUntilMatchOtherPlayer, matchRevealTopPutRevealedToHand, matchLookAtTopWhereXForEach, matchLookAtTopDynamicCountReorderBack, matchLookAtTopXReorderBack, matchRevealTopUpToMFilter, matchLookAtTopPutNToGraveyard, matchLookAtTopOneOnTopRestBottom, matchLookAtTopOfTargetLibrary, matchLookAtTopTargetMayMill, matchLookAtTopTargetExileOneRestBack, matchRevealUntilAllToGraveyard, matchLookAtTopExileOneFromAmong, matchLookAtTopExileFilterRestToHand, matchLookAtTopPutItToGraveyard, matchLookAtTopThatMany, matchExileThatManyFromTopOfLibrary, matchRevealTopIfMatchWithElse, matchLookAtTopGreatestPower, matchRevealTopAllTypesAndAll, matchLookAtTopExileFaceDown, matchLookAtTopPutMOnBottomRestToHand, matchRevealTopAnyNumberOntoBattlefield, matchRevealTopMultiTypeThenBranch, matchLookAtTopAnyNumberToHand, matchLookAtTopAnyNumberToGraveyard, matchLookAtTopRevealOneFilterToHand, matchRevealTopUnconditioned, matchRevealTopChosenType, matchLookAtTopOneOnTopRestGraveyard, matchLookAtTopCardMayExile, matchLookAtTopWhereXSelfPowerExile, matchLookAtTopPowerFilterOntoBattlefield, matchLookAtTopAnyNumberMultiTypeOntoBattlefield, matchRevealTopDistribute, matchRevealTopSplitTwoPiles, matchETBTutorFilterExtensions, matchLookAtTopSelfPowerAnyNumberToHand, matchLookAtTopCardPlayLandOrGraveyard, matchLookAtTopTwiceNumberOfToHand, matchLookAtTopAllOnBottom, matchDigTopPutAllOntoBattlefield, matchRevealTopPutOneNoRest, matchLookAtTopRevealUpToKFilterToHand, matchExileTopOfEachLibrary, matchLookAtTopExileNRestTop, matchExileTopXDamageAmountTheirLibrary } from './matchers/search-dig';
import { matchModifyPT, matchModifyPTForEach, matchModifyPTWhereX, matchModifyPTAndLoseKeyword, matchTargetCreatureLosesKeyword, matchGrantKeyword, matchGrantKeywordAll, matchGrantKeywordAndDynamicPT, matchLeadingDurationPumpGrant, matchTargetCombatRestriction, matchMultiTargetCombatRestriction, matchAttachItToTarget, matchCopySpell, matchCopyThatSpell, matchCopyCreature, matchCopySelfCreature, matchCounterSpell, matchHaveTargetGetPT, matchEnchantedCreatureGrantKeyword, matchMultiTargetPumpGrant, matchCanBlockAdditionalActivated, matchAttackAsThoughNoDefender, matchSelfCantBeBlockedActivated, matchSelfDynamicPumpLifeTotal, matchGrantCantBeCountered, matchOtherCreaturesGrantKeyword, matchOtherCreaturesPump, matchThatCreatureGetsPT, matchThatCreatureGainsKeyword, matchThatCreatureCantBeRegenerated, matchMassPermanentGrant, matchChangeSpellTargets, matchSetBasePT, matchBecomesCopy, matchModifyPTAsymmetricX, matchPumpGrantAllCreatureTypes, matchSwitchPowerToughness, matchAttackingBlockingPump, matchBecomeCreatureTypeSelf, matchLicidBecomeAura, matchChosenTypePump, matchModifyPTNegativeX, matchTransientPolymorph, matchGrantProtection } from './matchers/pump-grants';
import { matchETBPrefix, matchDiesPrefix, matchAttacksPrefix, matchSelfAttacksAlonePrefix, matchSelfAttacksAndIsntBlockedPrefix, matchSelfBecomesTappedPrefix, matchCreatureYouControlAttacksPrefix, matchSelfCombatDamageToPlayerPrefix, matchCreatureYouControlCombatDamageToPlayerPrefix, matchSelfCombatDamageToPlayersPrefix, matchCreatureYouControlCombatDamageToPlayersPrefix, matchUpkeepPrefix, matchDrawStepPrefix, matchBeginningCombatPrefix, matchEndStepPrefix, matchEachOpponentEndStepPrefix, matchAnotherCreatureETBPrefix, matchCreatureYouControlDiesPrefix, matchOtherCreatureDiesPrefix, matchYouCastSpellPrefix, matchYouCastNoncreatureSpellPrefix, matchLifeGainPrefix, matchLifeLossPrefix, matchCardDrawnPrefix, matchOpponentCastSpellPrefix, matchAnyPlayerCastSpellPrefix, matchPlayerTapsLandForManaPrefix, matchAnyCreatureETBPrefix, matchCreatureYouControlETBPrefix, matchCastInstantOrSorceryPrefix, matchCastOrCopyInstantOrSorceryPrefix, matchEachPlayerUpkeepPrefix, matchEachOpponentUpkeepPrefix, matchEachUpkeepPrefix, matchEachEndStepPrefix, matchBeginningCombatEachPrefix, matchLandfallPrefix, matchTriggerPrefix, matchSelfDealsDamagePrefix, matchEnchantedCreatureDealsDamagePrefix, matchSelfOrAnotherSubtypeETBPrefix, matchBlocksOrBlockedByPrefix, matchTurnedFaceUpPrefix } from './matchers/trigger-prefixes';
import { matchAttachedStaticBuff, matchSelfMustAttack, matchEntersTapped, matchCantBeCountered, matchSelfCostReduction, isSelfCostReductionSentence, matchLandwalk, matchProtection, matchOtherEvasion, matchConditionalEvasion, matchAttackingAloneEvasion, matchBlockOnlyFlying, matchWardPayLife, matchStaticAbility, matchConditionalStaticAbility, matchDynamicCDA, matchAsThoughFlash, matchTypeFilteredAsThoughFlash, matchKeywordHolderAnthem, matchGlobalKeywordAnthem, matchAllSubtypeAnthem, matchAttackingAnthem, matchTappedForManaRider, matchCanBlockAdditionalStatic, matchCanBlockAnyNumber, matchControlEnchanted, matchBattlefieldCantBeCountered, matchUntapDuringOtherUntapSteps, matchLegendaryCreaturesDynamicAnthem, matchGrantActivatedManaAbility, matchGrantLandManaAbility, matchOtherTappedUntappedCreaturesHave, matchGiselaDamageDoubling, matchGiselaDamageHalving, matchHexproofFromOwnColors, matchSetAllColors, matchCompoundSubtypeSpellCostReduction, matchTopLibraryPlayStatic, matchTopLibraryConditionalAnthem, matchGrantLandSubtype, matchLureStatic, matchLureSpell, matchAdditionalLandDrop, matchPlayLandsFromGraveyard, isPlayPermissionSentence, isTopLibraryStaticSentence, matchSelfDuringYourTurnAnthem, matchPlayerHexproof, matchPlayerShroud, matchCantGainLife, matchDamageCantBePrevented, matchCastOnlyDuringDeclareBlockers, matchPowerLessThanCantBlock, matchOpponentsCantCastDuringYourTurn, matchSelfEquippedEnchantedAnthem } from './matchers/static-abilities';
export type { ConditionalStaticMatch } from './matchers/static-abilities';

export type ParsedOracle = (
  | { kind: 'Spell'; effects: Effect[]; targets: TargetSpec[]; xCost?: boolean }
  | { kind: 'ETB'; ability: TriggeredAbility; targets: TargetSpec[] }
  | { kind: 'Modal'; modal: ModalSpell; xCost?: boolean }
  | { kind: 'Dies'; ability: TriggeredAbility; targets: TargetSpec[] }
  | { kind: 'Triggered'; ability: TriggeredAbility; targets: TargetSpec[] }
  | { kind: 'Activated'; abilities: ActivatedAbility[] }
  | { kind: 'StaticAbility'; ability: StaticAbilityEffect }
  | { kind: 'Unparsed'; reason: string }
) & {
  /**
   * Family keyword-line-absorption: engine-known keyword lines ("Flying",
   * "Defender, hexproof", "Ward {2}") absorbed from a mixed face so the
   * remaining text could parse. The keywords' functions are enforced outside
   * this parse result (keywords.ts keyword cache, ward.ts, stack.ts prowess);
   * the list is recorded for visibility only.
   */
  absorbedKeywords?: string[];
};

let targetSpecCounter = 0;

export function makeTargetSpec(type: TargetType, constraints?: TargetSpec['constraints']): TargetSpec {
  return {
    id: `target_${++targetSpecCounter}`,
    type,
    count: 1,
    constraints,
  };
}

export const COLOR_WORDS: Record<string, 'W' | 'U' | 'B' | 'R' | 'G'> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
};

export function colorConstraintFromWord(word: string | undefined): TargetSpec['constraints'] | undefined {
  const color = word ? COLOR_WORDS[word] : undefined;
  return color ? { colors: [color] } : undefined;
}

type ConstraintColor = 'W' | 'U' | 'B' | 'R' | 'G';

/**
 * Read a (possibly multi-)color qualifier starting at `idx`: "white",
 * "white or blue", "red, white, or blue". The constraint's `colors` array is
 * OR-semantics in target legality (a target qualifies if it has ANY listed
 * color), so dual/tri-color removal like "destroy target white or blue creature"
 * now parses. Returns undefined when `slice[idx]` is not a color word.
 */
export function readColorConstraint(
  slice: string[],
  idx: number,
): { colors: ConstraintColor[]; consumed: number } | undefined {
  const first = slice[idx] ? COLOR_WORDS[slice[idx]] : undefined;
  if (!first) return undefined;
  const colors: ConstraintColor[] = [first];
  let i = idx + 1;
  for (;;) {
    // Only consume a separator ("," and/or "or") when it is followed by another
    // color word — never swallow a dangling separator.
    let j = i;
    if (slice[j] === ',') j += 1;
    if (slice[j] === 'or') j += 1;
    const next = slice[j] ? COLOR_WORDS[slice[j]] : undefined;
    if (j > i && next) {
      if (!colors.includes(next)) colors.push(next);
      i = j + 1;
    } else {
      break;
    }
  }
  return { colors, consumed: i - idx };
}

export function makeChosenRef(spec: TargetSpec): TargetRef {
  return { kind: 'Chosen', targetId: spec.id };
}

/**
 * Comprehensive lowercase → canonical-singular mapping for creature subtypes.
 * Used by readSubtypeTargetSpec to recognise "target Merfolk", "target Zombie",
 * "target Skeleton, Vampire, or Zombie", etc. in any verb context.
 *
 * Keys are always lowercase (as they appear after tokenisation). Values are the
 * canonical singular form (title-case kept at call sites via capitalisation).
 */
export const CREATURE_SUBTYPE_MAP: Record<string, string> = {
  // Class-A common
  elf: 'elf', elves: 'elf',
  goblin: 'goblin', goblins: 'goblin',
  zombie: 'zombie', zombies: 'zombie',
  dragon: 'dragon', dragons: 'dragon',
  angel: 'angel', angels: 'angel',
  demon: 'demon', demons: 'demon',
  merfolk: 'merfolk',
  soldier: 'soldier', soldiers: 'soldier',
  wizard: 'wizard', wizards: 'wizard',
  knight: 'knight', knights: 'knight',
  warrior: 'warrior', warriors: 'warrior',
  cleric: 'cleric', clerics: 'cleric',
  rogue: 'rogue', rogues: 'rogue',
  shaman: 'shaman', shamans: 'shaman',
  beast: 'beast', beasts: 'beast',
  elemental: 'elemental', elementals: 'elemental',
  vampire: 'vampire', vampires: 'vampire',
  sliver: 'sliver', slivers: 'sliver',
  human: 'human', humans: 'human',
  spirit: 'spirit', spirits: 'spirit',
  bird: 'bird', birds: 'bird',
  cat: 'cat', cats: 'cat',
  dinosaur: 'dinosaur', dinosaurs: 'dinosaur',
  pirate: 'pirate', pirates: 'pirate',
  dwarf: 'dwarf', dwarves: 'dwarf',
  wolf: 'wolf', wolves: 'wolf',
  // Extended list covering the 121 target-subtype faces
  skeleton: 'skeleton', skeletons: 'skeleton',
  samurai: 'samurai',
  wall: 'wall', walls: 'wall',
  ninja: 'ninja', ninjas: 'ninja',
  faerie: 'faerie', faeries: 'faerie', fairy: 'faerie', fairies: 'faerie',
  drake: 'drake', drakes: 'drake',
  golem: 'golem', golems: 'golem',
  homunculus: 'homunculus',
  insect: 'insect', insects: 'insect',
  serpent: 'serpent', serpents: 'serpent',
  kraken: 'kraken', krakens: 'kraken',
  leviathan: 'leviathan', leviathans: 'leviathan',
  octopus: 'octopus', octopuses: 'octopus',
  fish: 'fish',
  crab: 'crab', crabs: 'crab',
  turtle: 'turtle', turtles: 'turtle',
  whale: 'whale', whales: 'whale',
  shark: 'shark', sharks: 'shark',
  sphinx: 'sphinx', sphinxes: 'sphinx',
  djinn: 'djinn', djinns: 'djinn',
  efreet: 'efreet', efreets: 'efreet',
  genie: 'genie', genies: 'genie',
  ooze: 'ooze', oozes: 'ooze',
  slime: 'slime', slimes: 'slime',
  horror: 'horror', horrors: 'horror',
  abomination: 'abomination', abominations: 'abomination',
  nightmare: 'nightmare', nightmares: 'nightmare',
  illusion: 'illusion', illusions: 'illusion',
  shapeshifter: 'shapeshifter', shapeshifters: 'shapeshifter',
  treefolk: 'treefolk',
  dryad: 'dryad', dryads: 'dryad',
  satyr: 'satyr', satyrs: 'satyr',
  centaur: 'centaur', centaurs: 'centaur',
  archer: 'archer', archers: 'archer',
  monk: 'monk', monks: 'monk',
  barbarian: 'barbarian', barbarians: 'barbarian',
  berserker: 'berserker', berserkers: 'berserker',
  rebel: 'rebel', rebels: 'rebel',
  mercenary: 'mercenary', mercenaries: 'mercenary',
  pegasus: 'pegasus', pegasi: 'pegasus',
  unicorn: 'unicorn', unicorns: 'unicorn',
  bear: 'bear', bears: 'bear',
  wolf2: 'wolf',
  werewolf: 'werewolf', werewolves: 'werewolf',
  lizard: 'lizard', lizards: 'lizard',
  turtle2: 'turtle',
  frog: 'frog', frogs: 'frog',
  toad: 'toad', toads: 'toad',
  snake: 'snake', snakes: 'snake',
  scorpion: 'scorpion', scorpions: 'scorpion',
  spider: 'spider', spiders: 'spider',
  worm: 'worm', worms: 'worm',
  rat: 'rat', rats: 'rat',
  fox: 'fox', foxes: 'fox',
  rabbit: 'rabbit', rabbits: 'rabbit',
  squirrel: 'squirrel', squirrels: 'squirrel',
  elk: 'elk',
  ox: 'ox', oxen: 'ox',
  boar: 'boar', boars: 'boar',
  hippo: 'hippo', hippos: 'hippo', hippogriff: 'hippogriff',
  rhino: 'rhino', rhinos: 'rhino', rhinoceros: 'rhino',
  elephant: 'elephant', elephants: 'elephant',
  horse: 'horse', horses: 'horse',
  griffin: 'griffin', griffins: 'griffin', gryphon: 'griffin', gryphons: 'griffin',
  phoenix: 'phoenix', phoenixes: 'phoenix',
  hydra: 'hydra', hydras: 'hydra',
  wurm: 'wurm', wurms: 'wurm',
  giant: 'giant', giants: 'giant',
  ogre: 'ogre', ogres: 'ogre',
  troll: 'troll', trolls: 'troll',
  cyclops: 'cyclops',
  minotaur: 'minotaur', minotaurs: 'minotaur',
  gnome: 'gnome', gnomes: 'gnome',
  halfling: 'halfling', halflings: 'halfling',
  kithkin: 'kithkin',
  vedalken: 'vedalken',
  viashino: 'viashino',
  leonin: 'leonin',
  loxodon: 'loxodon',
  kor: 'kor',
  merrow: 'merrow',
  moonfolk: 'moonfolk',
  kavu: 'kavu',
  phyrexian: 'phyrexian', phyrexians: 'phyrexian',
  construct: 'construct', constructs: 'construct',
  thopter: 'thopter', thopters: 'thopter',
  myr: 'myr',
  servo: 'servo', servos: 'servo',
  juggernaut: 'juggernaut', juggernauts: 'juggernaut',
  scarecrow: 'scarecrow', scarecrows: 'scarecrow',
  gargoyle: 'gargoyle', gargoyles: 'gargoyle',
  zombie2: 'zombie',
  shade: 'shade', shades: 'shade',
  thrull: 'thrull', thrulls: 'thrull',
  wight: 'wight', wights: 'wight',
  revenant: 'revenant', revenants: 'revenant',
  specter: 'specter', specters: 'specter', spectre: 'specter', spectres: 'specter',
  wraith: 'wraith', wraiths: 'wraith',
  lich: 'lich', liches: 'lich',
  druid: 'druid', druids: 'druid',
  ranger: 'ranger', rangers: 'ranger',
  scout: 'scout', scouts: 'scout',
  nomad: 'nomad', nomads: 'nomad',
  peasant: 'peasant', peasants: 'peasant',
  advisor: 'advisor', advisors: 'advisor',
  artificer: 'artificer', artificers: 'artificer',
  assassin: 'assassin', assassins: 'assassin',
  pirate2: 'pirate',
  spellshaper: 'spellshaper', spellshapers: 'spellshaper',
};

/**
 * Read a creature-subtype target noun phrase beginning at `slice[idx]` (the
 * first word after the leading-qualifier words already consumed by the caller):
 *
 *   "Zombie"                              → subtypes: ['zombie']
 *   "Skeleton, Vampire, or Zombie"        → subtypes: ['skeleton','vampire','zombie']
 *   "Merfolk you control"                 → subtypes: ['merfolk'], controllerControls
 *   "Dinosaur you control"                → subtypes: ['dinosaur'], controllerControls
 *   "up to one target Dinosaur you control" — handled by callers stripping "up to one"
 *
 * Returns the parsed subtypes (in lowercase canonical form), a controllerControls
 * flag, and the number of tokens consumed (past the last subtype/qualifier word).
 * Returns null when the token at `idx` is not a known creature subtype.
 */
export function readCreatureSubtypeTargetPhrase(
  slice: string[],
  idx: number,
): { subtypes: string[]; controllerControls?: boolean; opponentControls?: boolean; consumed: number } | null {
  if (!slice[idx] || !CREATURE_SUBTYPE_MAP[slice[idx]]) return null;

  const subtypes: string[] = [CREATURE_SUBTYPE_MAP[slice[idx]]];
  let i = idx + 1;

  // Consume union list: ", Vampire, or Zombie" — only when each token is a known subtype
  for (;;) {
    let j = i;
    if (slice[j] === ',') j++;
    if (slice[j] === 'or') j++;
    if (slice[j] && CREATURE_SUBTYPE_MAP[slice[j]]) {
      const canon = CREATURE_SUBTYPE_MAP[slice[j]];
      if (!subtypes.includes(canon)) subtypes.push(canon);
      i = j + 1;
    } else {
      break;
    }
  }

  let controllerControls: boolean | undefined;
  let opponentControls: boolean | undefined;
  if (slice[i] === 'you' && slice[i + 1] === 'control') {
    controllerControls = true;
    i += 2;
  } else if (slice[i] === 'an' && slice[i + 1] === 'opponent' && slice[i + 2] === 'controls') {
    opponentControls = true;
    i += 3;
  }

  return {
    subtypes,
    ...(controllerControls ? { controllerControls } : {}),
    ...(opponentControls ? { opponentControls } : {}),
    consumed: i - idx,
  };
}

/** "non<type>" words that exclude a card type from the target noun phrase. */
const EXCLUDED_TYPE_BY_NON_WORD: Record<string, string> = {
  nonartifact: 'artifact',
  noncreature: 'creature',
  nonenchantment: 'enchantment',
  nonplaneswalker: 'planeswalker',
};

/** "non<supertype>" words that exclude a supertype from the target noun phrase. */
const EXCLUDED_SUPERTYPE_BY_NON_WORD: Record<string, string> = {
  nonlegendary: 'legendary',
  nonbasic: 'basic',
};

/**
 * Read target noun-phrase constraint modifiers sitting between "target" and the
 * type noun:
 *
 *   "attacking" / "blocking" / "attacking or blocking" → combatStatus
 *   "tapped" / "untapped"                              → tappedStatus
 *   "nontoken"                                         → nontoken
 *   "nonlegendary" / "nonbasic"                        → excludeSupertypes
 *   "nonartifact" / "nonenchantment" / …               → excludeTypes
 *   "non-Human" (tokenized "non", "-", "human")        → excludeSubtypes
 *
 * Chains like Victim of Night's "non-Vampire, non-Werewolf, non-Zombie" are
 * consumed in one pass — a separator ("," / "and") is only swallowed when
 * another recognized modifier follows. Returns the merged constraints plus the
 * number of tokens consumed (0 when no modifier is present).
 *
 * Note: "nonland" is intentionally NOT handled here — "nonland permanent"
 * already has the dedicated NonlandPermanent TargetType.
 */
export function readTargetNounModifiers(
  slice: string[],
  idx: number,
): { constraints: NonNullable<TargetSpec['constraints']>; consumed: number } {
  const constraints: NonNullable<TargetSpec['constraints']> = {};
  let i = idx;
  for (;;) {
    // Only consume a separator ("," and/or "and") when it is followed by
    // another recognized modifier — never swallow a dangling separator.
    let j = i;
    if (i > idx) {
      if (slice[j] === ',') j += 1;
      if (slice[j] === 'and') j += 1;
    }
    const word = slice[j];
    if (word === 'attacking') {
      if (slice[j + 1] === 'or' && slice[j + 2] === 'blocking') {
        constraints.combatStatus = 'attackingOrBlocking';
        i = j + 3;
      } else {
        constraints.combatStatus = 'attacking';
        i = j + 1;
      }
      continue;
    }
    if (word === 'blocking') {
      constraints.combatStatus = 'blocking';
      i = j + 1;
      continue;
    }
    if (word === 'tapped') {
      constraints.tappedStatus = 'tapped';
      i = j + 1;
      continue;
    }
    if (word === 'untapped') {
      constraints.tappedStatus = 'untapped';
      i = j + 1;
      continue;
    }
    if (word === 'nontoken') {
      constraints.nontoken = true;
      i = j + 1;
      continue;
    }
    if (word && EXCLUDED_SUPERTYPE_BY_NON_WORD[word]) {
      constraints.excludeSupertypes = [...(constraints.excludeSupertypes ?? []), EXCLUDED_SUPERTYPE_BY_NON_WORD[word]];
      i = j + 1;
      continue;
    }
    if (word && EXCLUDED_TYPE_BY_NON_WORD[word]) {
      constraints.excludeTypes = [...(constraints.excludeTypes ?? []), EXCLUDED_TYPE_BY_NON_WORD[word]];
      i = j + 1;
      continue;
    }
    // "non-Human" → ["non", "-", "human"]; exclude the subtype.
    if (word === 'non' && slice[j + 1] === '-' && slice[j + 2]) {
      const excluded = slice[j + 2];
      constraints.excludeSubtypes = [...(constraints.excludeSubtypes ?? []), excluded];
      i = j + 3;
      continue;
    }
    // Slice 3/BC: "target artifact creature", "target enchantment creature" —
    // type-AND constraint before the 'creature' noun. Adds the extra type to
    // constraints.types so the target validator requires both types.
    if ((word === 'artifact' || word === 'enchantment') && slice[j + 1] === 'creature') {
      constraints.types = [...(constraints.types ?? []), word];
      i = j + 1; // consume only the type word; 'creature' stays for the inner matcher
      continue;
    }
    // Slice 8: "without <keyword>" — target must lack the named keyword.
    // Recognized keywords: same set as GRANTABLE_KEYWORDS (flying, trample, etc.)
    // plus two-word forms (double strike, first strike). validated at resolve-time
    // by lacksKeywords in targets.ts (hasKeyword check).
    if (word === 'without') {
      const twoWordKey = slice[j + 1] + ' ' + slice[j + 2];
      if (GRANTABLE_KEYWORDS[twoWordKey]) {
        constraints.lacksKeywords = [...(constraints.lacksKeywords ?? []), GRANTABLE_KEYWORDS[twoWordKey].toLowerCase()];
        i = j + 3;
        continue;
      }
      if (slice[j + 1] && GRANTABLE_KEYWORDS[slice[j + 1]]) {
        constraints.lacksKeywords = [...(constraints.lacksKeywords ?? []), GRANTABLE_KEYWORDS[slice[j + 1]].toLowerCase()];
        i = j + 2;
        continue;
      }
    }
    break;
  }
  return { constraints, consumed: i - idx };
}

/**
 * Shared wrapper for target noun-phrase constraint modifiers ("attacking",
 * "tapped", "nonenchantment", "non-Human", …): when modifiers follow
 * `slice[targetIdx]` (which must be the word "target"), re-run the matcher on
 * the tokens with the modifier words removed and merge the parsed constraints
 * into the resulting single TargetSpec. Returns null when there are no
 * modifiers or the reduced clause does not parse to exactly one TargetSpec.
 */
export function retryWithTargetNounModifiers(
  slice: string[],
  targetIdx: number,
  matcher: (tokens: string[], startIndex: number) => PatternResult,
): PatternResult {
  if (slice[targetIdx] !== 'target') return null;
  const mods = readTargetNounModifiers(slice, targetIdx + 1);
  if (mods.consumed === 0) return null;
  const reduced = [...slice.slice(0, targetIdx + 1), ...slice.slice(targetIdx + 1 + mods.consumed)];
  const result = matcher(reduced, 0);
  if (!result || result.targets.length !== 1) return null;
  const spec = result.targets[0];
  spec.constraints = { ...(spec.constraints ?? {}), ...mods.constraints };
  return { ...result, consumed: result.consumed + mods.consumed };
}

/**
 * Read a "with power/toughness N or greater/less" suffix after the target noun
 * ("target creature with power 5 or greater gains …" — Spearbreaker Behemoth).
 * Mirrors applyManaValueTargetConstraint: returns the augmented constraints and
 * the next token index, or null when no such suffix is present.
 */
export function applyPowerToughnessTargetConstraint(
  tokens: string[],
  startIndex: number,
  constraints: TargetSpec['constraints'],
): { constraints: TargetSpec['constraints']; nextIndex: number } | null {
  let idx = startIndex;
  if (tokens[idx] !== 'with') return null;
  idx++;
  const stat = tokens[idx] === 'power' ? 'power' : tokens[idx] === 'toughness' ? 'toughness' : null;
  if (!stat) return null;
  idx++;
  const value = parseSmallNumberToken(tokens[idx] ?? '');
  if (Number.isNaN(value)) return null;
  idx++;
  let bound: { op: 'eq' | 'lte' | 'gte'; value: number };
  if (tokens[idx] === 'or' && tokens[idx + 1] === 'less') {
    bound = { op: 'lte', value };
    idx += 2;
  } else if (tokens[idx] === 'or' && tokens[idx + 1] === 'greater') {
    bound = { op: 'gte', value };
    idx += 2;
  } else {
    bound = { op: 'eq', value };
  }
  return {
    constraints: { ...(constraints || {}), [stat]: bound },
    nextIndex: idx,
  };
}

export function parseSmallNumberToken(token: string): number {
  const numeric = parseInt(token, 10);
  return Number.isNaN(numeric) ? parseWordNumber(token) : numeric;
}

export function isCantToken(token: string | undefined): boolean {
  return token === "can't" || token === 'can\u2019t' || token === 'cant' || token === 'cannot';
}

export function parsePowerToughnessToken(token: string): { fixed: number; amount?: AmountRef } | null {
  if (token === 'x') {
    return { fixed: 0, amount: { kind: 'EventSpellManaValue' } };
  }
  const fixed = parseInt(token, 10);
  if (Number.isNaN(fixed)) return null;
  return { fixed };
}

const LEADING_PREAMBLE_STARTS = new Set([
  'deathtouch',
  'defender',
  'double',
  'enchant',
  'equip',
  'first',
  'flash',
  'flying',
  'haste',
  'hexproof',
  'indestructible',
  'lifelink',
  'menace',
  'protection',
  'prowess',
  'reach',
  'trample',
  'vigilance',
  'ward',
]);

function startsWithTriggeredAbility(tokens: string[], idx: number): boolean {
  return tokens[idx] === 'when'
    || tokens[idx] === 'whenever'
    || (tokens[idx] === 'at' && tokens[idx + 1] === 'the' && tokens[idx + 2] === 'beginning');
}

function trimLeadingKeywordOrEnchantPreamble(tokens: string[]): string[] {
  if (tokens.length === 0 || startsWithTriggeredAbility(tokens, 0)) return tokens;
  if (!LEADING_PREAMBLE_STARTS.has(tokens[0])) return tokens;

  for (let idx = 1; idx < Math.min(tokens.length, 80); idx++) {
    if (startsWithTriggeredAbility(tokens, idx)) {
      return tokens.slice(idx);
    }
  }

  return tokens;
}

// Pattern matchers return [Effect[], TargetSpec[], tokensConsumed] or null

export type PatternResult = { effects: Effect[]; targets: TargetSpec[]; consumed: number } | null;

// matchDealDamageEqualTo moved to matchers/damage.ts

// matchDealDamage moved to matchers/damage.ts

// matchDealDamageDivided moved to matchers/damage.ts
// matchPreventDamage moved to matchers/damage.ts

/**
 * Match: "destroy target creature"
 * Match: "destroy target creature an opponent controls"
 * Match: "destroy target permanent"
 * Match: "destroy target artifact"
 * Match: "destroy target enchantment"
 * Match: "destroy target land"
 * Match: "destroy target artifact or enchantment"
 * Match: "destroy target artifact, enchantment, or land"
 */
/**
 * Peek for a trailing "[they|it|that] can't be regenerated" clause (CR 701.18).
 * Returns the number of tokens it spans (including a leading/trailing period), or 0.
 */
export function consumeCantBeRegenerated(tokens: string[], idx: number): number {
  let i = idx;
  if (tokens[i] === '.') i++;
  if (!['they', 'it', 'that'].includes(tokens[i])) return 0;
  i++;
  if (!(tokens[i] === "can't" || tokens[i] === 'can’t' || tokens[i] === 'cant' || tokens[i] === 'cannot')) return 0;
  i++;
  if (tokens[i] !== 'be') return 0;
  i++;
  if (tokens[i] !== 'regenerated') return 0;
  i++;
  if (tokens[i] === '.') i++;
  return i - idx;
}

/**
 * Match multi-target zone effects: "tap/destroy/exile/untap/return up to N target <plurals>".
 * Slice 1: extended to cover 'return' (with "to their owners' hands" suffix), 'untap',
 * compound targets like "nonland permanents", and an optional "other" qualifier → notSource.
 *
 * Produces a SINGLE TargetSpec whose `count` is N, plus one Effect whose target
 * is the Chosen ref for that spec. The executor's Tap/Destroy/Exile/ReturnToHand/Untap cases
 * iterate every id chosen for the spec (see resolveChosenTargetIds), so the effect is
 * honestly applied to all N targets.
 *
 * Only fires for N >= 2 with a plural noun — the "up to one target creature" (singular)
 * form is left to the existing single-target matchers to keep those paths untouched.
 */
function matchMultiTarget(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 6) return null;

  let kind: 'Tap' | 'Destroy' | 'Exile' | 'Untap' | 'ReturnToHand';
  if (slice[0] === 'tap') kind = 'Tap';
  else if (slice[0] === 'destroy') kind = 'Destroy';
  else if (slice[0] === 'exile') kind = 'Exile';
  else if (slice[0] === 'untap') kind = 'Untap';
  else if (slice[0] === 'return') kind = 'ReturnToHand';
  else return null;

  // Count prefix: "up to N" (N >= 2) OR "any number of" (Strive bodies).
  // "any number of" is treated as an unbounded multi-target (count = 10) with
  // minCount = 1 so the player may choose 0 (effectively optional).
  let count: number;
  let isAnyNumber = false;
  let typeIdx: number;

  if (slice[1] === 'any' && slice[2] === 'number' && slice[3] === 'of') {
    // "return/exile/destroy any number of target <type>"
    count = 10; // effectively unbounded; player chooses 0..N
    isAnyNumber = true;
    typeIdx = 4;
  } else if (slice[1] === 'up' && slice[2] === 'to') {
    count = parseSmallNumberToken(slice[3]);
    if (Number.isNaN(count) || count < 2) return null;
    typeIdx = 4;
  } else {
    return null;
  }

  // Optional "other" qualifier (notSource): "return up to two other target nonland permanents"
  let notSource = false;
  if (slice[typeIdx] === 'other') {
    notSource = true;
    typeIdx++;
  }

  if (slice[typeIdx] !== 'target') return null;
  typeIdx++;

  // Map plural (and compound) permanent nouns to TargetType.
  const pluralToType: Record<string, TargetType> = {
    creatures: 'Creature',
    lands: 'Land',
    artifacts: 'Artifact',
    enchantments: 'Enchantment',
    permanents: 'Permanent',
  };

  let targetType: TargetType | undefined;
  let consumed = typeIdx;

  // Compound "nonland permanents" → NonlandPermanent
  if (slice[typeIdx] === 'nonland' && (slice[typeIdx + 1] === 'permanents' || slice[typeIdx + 1] === 'permanent')) {
    targetType = 'NonlandPermanent';
    consumed = typeIdx + 2;
  } else {
    targetType = pluralToType[slice[typeIdx]];
    if (!targetType) return null;
    consumed = typeIdx + 1;
  }

  // For ReturnToHand: consume optional "to their owners' hands" / "to their owner's hand".
  if (kind === 'ReturnToHand') {
    if (slice[consumed] === 'to' && slice[consumed + 1] === 'their') {
      consumed += 2;
      if (slice[consumed] === "owners'" || slice[consumed] === "owner's") consumed++;
      if (slice[consumed] === 'hands' || slice[consumed] === 'hand') consumed++;
    } else {
      // require trailing phrase for bounce; if missing, don't parse
      return null;
    }
  }

  if (tokens[startIndex + consumed] === '.') consumed++;

  const constraints: TargetSpec['constraints'] = notSource ? { notSource: true } : undefined;
  const spec = makeTargetSpec(targetType, constraints);
  spec.count = count;
  if (isAnyNumber) spec.minCount = 0; // "any number" allows choosing zero

  let effect: Effect;
  if (kind === 'ReturnToHand') {
    effect = { kind: 'ReturnToHand', target: makeChosenRef(spec) };
  } else {
    effect = { kind, target: makeChosenRef(spec) } as Effect;
  }

  return { effects: [effect], targets: [spec], consumed };
}

// matchDestroy — moved to ./matchers/zones.ts

// matchDraw — moved to ./matchers/life-draw-mill.ts

// matchTargetPlayerDraw — moved to ./matchers/life-draw-mill.ts

// matchThatPlayerDraw — moved to ./matchers/life-draw-mill.ts

// matchThatPlayerDiscard — moved to ./matchers/players.ts

// matchPutLandFromHandOntoBattlefield — moved to ./matchers/players.ts

// matchLookAtTargetPlayerHand — moved to ./matchers/players.ts

// CHOSEN_HAND_CARD_TYPES, CHOSEN_HAND_EXCLUDED_TYPE_BY_NON_WORD, parseChosenHandCardFilter — moved to ./matchers/players.ts
// matchRevealHandChooseCard — moved to ./matchers/players.ts

export function parseRevealCardFilter(tokens: string[]): CardFilter {
  const meaningful = tokens.filter(token =>
    token !== ',' && token !== 'and' && token !== 'or' && token !== 'a' && token !== 'an'
  );
  if (meaningful.length === 0) return {};

  const cardTypes = new Set(['artifact', 'battle', 'creature', 'enchantment', 'instant', 'land', 'planeswalker', 'sorcery']);
  const subfilters: CardFilter[] = [];

  for (const token of meaningful) {
    if (cardTypes.has(token)) {
      subfilters.push({ types: [token] });
    } else {
      const label = token.charAt(0).toUpperCase() + token.slice(1);
      subfilters.push({ subtypes: [label] });
      subfilters.push({ nameIncludes: [label] });
    }
  }

  return subfilters.length === 1 ? subfilters[0] : { anyOf: subfilters };
}

export function titleCaseCardName(tokens: string[]): string {
  return tokens
    .filter(token => token !== ',' && token !== '.' && token !== 'then')
    .map(token => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ')
    .trim();
}

// matchLookAtTopPutOneIntoHand — moved to ./matchers/search-dig.ts

// matchRevealTopTake — moved to ./matchers/search-dig.ts
// matchDigTopTakeRest — moved to ./matchers/search-dig.ts
// matchRevealTopOntoBattlefield — moved to ./matchers/search-dig.ts
/**
 * Match: "gain N life"
 */
/**
 * Parse a dynamic amount after "equal to":
 *   "its power"                              → source's power
 *   "the number of <type> you control"       → ForEach battlefield (you)
 *   "the number of <type> an opponent controls" → ForEach battlefield (opponent)
 */
/**
 * Slice 10: Parse "that creature's toughness" / "that creature's power" — the
 * live P/T of the creature from the triggering event.
 * Returns { amount: EventCreatureStat, nextIndex } or null on mismatch.
 */
export function parseEventCreatureStatAmount(
  slice: string[],
  at: number,
): { amount: AmountRef; nextIndex: number } | null {
  // Accept "that creature's toughness" and "that creature's power"
  if (slice[at] === 'that' && slice[at + 1] === "creature's") {
    if (slice[at + 2] === 'toughness') {
      return { amount: { kind: 'EventCreatureStat', stat: 'toughness' }, nextIndex: at + 3 };
    }
    if (slice[at + 2] === 'power') {
      return { amount: { kind: 'EventCreatureStat', stat: 'power' }, nextIndex: at + 3 };
    }
  }
  return null;
}

export function parseEqualToAmount(slice: string[], at: number): { amount: AmountRef; nextIndex: number } | null {
  if (slice[at] === 'its' && slice[at + 1] === 'power') {
    return { amount: { kind: 'TargetPower', target: { kind: 'Source' } }, nextIndex: at + 2 };
  }
  // Slice 4: Planeswalker's Fury family — "equal to that card's mana value"
  // "that card's" is either one token (tokenizer kept the apostrophe-s) or two tokens.
  if (
    slice[at] === 'that' &&
    (slice[at + 1] === "card's" || (slice[at + 1] === 'card' && slice[at + 2] === "'s"))
  ) {
    const afterPossessive = slice[at + 1] === "card's" ? at + 2 : at + 3;
    if (slice[afterPossessive] === 'mana' && slice[afterPossessive + 1] === 'value') {
      return { amount: { kind: 'RevealedRandomCardManaValue' }, nextIndex: afterPossessive + 2 };
    }
  }
  // Slice 4 (devotion): "your devotion to <color(s)>"
  if (slice[at] === 'your' && slice[at + 1] === 'devotion' && slice[at + 2] === 'to') {
    const dev = parseDevotionAmount(slice, at);
    if (dev) return dev;
  }
  if (slice[at] === 'the' && slice[at + 1] === 'number' && slice[at + 2] === 'of') {
    const typeMap: Record<string, NonNullable<CardFilter['types']>> = {
      creatures: ['creature'], creature: ['creature'], artifacts: ['artifact'], artifact: ['artifact'],
      enchantments: ['enchantment'], enchantment: ['enchantment'], lands: ['land'], land: ['land'],
    };
    const types = typeMap[slice[at + 3]];
    if (!types) return null;
    let i = at + 4;
    // Slice 9: if the next word is a qualifier modifier (e.g. "named"), this is a
    // richer pattern that parseNumberOfFilterAmount handles; bail so it can match.
    if (slice[i] === 'named') return null;
    let controller: 'you' | 'opponent' | 'each' = 'each';
    if (slice[i] === 'you' && slice[i + 1] === 'control') { controller = 'you'; i += 2; }
    else if (slice[i] === 'an' && slice[i + 1] === 'opponent' && slice[i + 2] === 'controls') { controller = 'opponent'; i += 3; }
    return { amount: { kind: 'ForEach', zone: 'battlefield', filter: { types }, controller }, nextIndex: i };
  }
  return null;
}

/**
 * Slice 4 (devotion): Parse "your devotion to <color(s)>" starting at `at`.
 * Recognizes single-color ("your devotion to green") and multi-color
 * ("your devotion to white and blue") forms.
 * Returns { colors, nextIndex } on success, null otherwise.
 */
export function parseDevotionAmount(
  slice: string[],
  at: number,
): { amount: AmountRef; nextIndex: number } | null {
  if (slice[at] !== 'your' || slice[at + 1] !== 'devotion' || slice[at + 2] !== 'to') return null;
  let i = at + 3;
  const colorResult = readColorConstraint(slice, i);
  if (!colorResult || colorResult.colors.length === 0) return null;
  i += colorResult.consumed;
  return { amount: { kind: 'DevotionCount', colors: colorResult.colors }, nextIndex: i };
}

/**
 * Parse a "the number of <X>" dynamic amount that the executor's ForEach counter
 * supports directly. Thin alias for parseNumberOfFilterAmount (the generalized
 * shared count parser) kept for the existing "equal to the number of ..." callers.
 * Returns null for anything else (callers fall through to the generic matchers).
 */
export function parseNumberOfYouControlAmount(
  slice: string[],
  at: number,
): { amount: ForEachAmount; nextIndex: number } | null {
  return parseNumberOfFilterAmount(slice, at);
}

/**
 * Read the trailing "place" phrase of a dynamic count — the zone + controller
 * combinations the executor's ForEach counter resolves directly:
 *   "you control"                     → battlefield / you
 *   "an opponent controls"            → battlefield / opponent
 *   "on the battlefield"              → battlefield / each
 *   "in your hand|graveyard|library"  → that zone / you
 *   "in all graveyards"               → graveyard / each
 */
function readForEachZonePhrase(
  slice: string[],
  at: number,
): { zone: ForEachAmount['zone']; controller: ForEachAmount['controller']; nextIndex: number } | null {
  if (slice[at] === 'you' && slice[at + 1] === 'control') {
    return { zone: 'battlefield', controller: 'you', nextIndex: at + 2 };
  }
  if (slice[at] === 'an' && slice[at + 1] === 'opponent' && slice[at + 2] === 'controls') {
    return { zone: 'battlefield', controller: 'opponent', nextIndex: at + 3 };
  }
  if (slice[at] === 'on' && slice[at + 1] === 'the' && slice[at + 2] === 'battlefield') {
    return { zone: 'battlefield', controller: 'each', nextIndex: at + 3 };
  }
  if (slice[at] === 'in' && slice[at + 1] === 'your') {
    const zoneWord = slice[at + 2];
    const zone: ForEachAmount['zone'] | null =
      zoneWord === 'hand' ? 'hand'
      : zoneWord === 'graveyard' ? 'graveyard'
      : zoneWord === 'library' ? 'library'
      : null;
    if (!zone) return null;
    return { zone, controller: 'you', nextIndex: at + 3 };
  }
  if (slice[at] === 'in' && slice[at + 1] === 'all' && slice[at + 2] === 'graveyards') {
    return { zone: 'graveyard', controller: 'each', nextIndex: at + 3 };
  }
  if (slice[at] === 'in' && slice[at + 1] === 'exile') {
    return { zone: 'exile', controller: 'each', nextIndex: at + 2 };
  }
  return null;
}

/**
 * Parse the noun-phrase of a dynamic count ("creature cards", "snow permanents",
 * "clerics", "equipment") into a CardFilter, word by word. "card"/"cards" adds no
 * constraint (zone counts), "equipment" matches the artifact subtype, everything
 * else must parse via parseStaticFilterType. Bails (null) on any unknown word or
 * conflicting constraint so unsupported counts (devotion, "number of times ...",
 * party, storm) stay honestly Unparsed. Returns undefined when no constraint is
 * needed (pure zone count).
 */
function parseForEachFilterWords(words: string[]): CardFilter | undefined | null {
  const filter: CardFilter = {};

  // Slice 9: "named ~" self-referential pattern — may appear at end of words array,
  // optionally preceded by a type word (e.g. ["creatures", "named", "~"]).
  // Consume the "named ~" tail first, then continue processing any leading type words.
  let remaining = words;
  const namedIdx = words.indexOf('named');
  if (namedIdx !== -1) {
    if (words[namedIdx + 1] === '~' && namedIdx + 2 === words.length) {
      // Everything before "named ~" are type/modifier words; "named ~" becomes namesSelf.
      filter.namesSelf = true;
      remaining = words.slice(0, namedIdx);
    } else {
      // Unknown "named X" form — bail out honestly.
      return null;
    }
  }

  // Slice 10: "instant and sorcery" union — two card types joined by "and" within the
  // noun phrase. The executor's filter.types is checked with .some() so storing both
  // types in the array correctly matches cards of either type (instant OR sorcery).
  // Only type-type unions are supported; mixed constraints ("creature and artifact") that
  // would conflict on other filter keys (subtypes, colors, etc.) are declined (null).
  // We scan the remaining words for "and" preceded and followed by bare type words.
  const andIdx = remaining.indexOf('and');
  if (andIdx !== -1 && andIdx > 0 && andIdx + 1 < remaining.length) {
    // Collect all non-"and" / non-"card/cards" words on either side to detect a pure
    // type-union phrase like ["instant", "and", "sorcery"] or
    // ["instant", "and", "sorcery", "cards"].
    const beforeAnd = remaining.slice(0, andIdx).filter(w => w !== 'card' && w !== 'cards');
    const afterAnd = remaining.slice(andIdx + 1).filter(w => w !== 'card' && w !== 'cards');
    // Each segment must resolve to a CardFilter with only a `types` key.
    const typesFromWords = (ws: string[]): string[] | null => {
      const types: string[] = [];
      for (const w of ws) {
        const part = parseStaticFilterType(w);
        if (!part || !part.types || Object.keys(part).filter(k => k !== 'types').length > 0) {
          // Reject: word has no types, or has extra keys beyond types (e.g. supertypes, subtypes).
          return null;
        }
        for (const t of part.types) {
          if (!types.includes(t)) types.push(t);
        }
      }
      return types.length > 0 ? types : null;
    };
    const leftTypes = typesFromWords(beforeAnd);
    const rightTypes = typesFromWords(afterAnd);
    if (leftTypes && rightTypes) {
      const allTypes = [...leftTypes];
      for (const t of rightTypes) {
        if (!allTypes.includes(t)) allTypes.push(t);
      }
      if (filter.namesSelf) return { namesSelf: true, types: allTypes };
      return { types: allTypes };
    }
    // If the "and" union parse fails (mixed constraints, unknown words, etc.) fall through
    // to the per-word loop below, which will bail on "and" as an unknown word anyway.
  }

  for (const word of remaining) {
    if (word === 'card' || word === 'cards') continue;
    // Slice 7: "other" is a relative-to-source qualifier that is safe to drop here
    // (counting includes the source at most once and the difference is tolerated).
    if (word === 'other') continue;
    const part: CardFilter | null =
      word === 'equipment' ? { subtypes: ['equipment'] } : parseStaticFilterType(word);
    if (!part || Object.keys(part).length === 0) return null;
    for (const key of Object.keys(part) as Array<keyof CardFilter>) {
      if (filter[key] !== undefined) return null;
      (filter as Record<string, unknown>)[key] = part[key];
    }
  }
  return Object.keys(filter).length > 0 ? filter : undefined;
}

/**
 * Shared dynamic-count parser: "the number of <filter words> <place>" where
 * <place> is a readForEachZonePhrase shape. Generalizes parseEqualToAmount /
 * parseNumberOfYouControlAmount; emits the executor-backed ForEachAmount
 * (resolveAmount counts matching cards in the zone at resolution time).
 */
export function parseNumberOfFilterAmount(
  slice: string[],
  at: number,
): { amount: ForEachAmount; nextIndex: number } | null {
  if (slice[at] !== 'the' || slice[at + 1] !== 'number' || slice[at + 2] !== 'of') return null;
  let i = at + 3;
  const words: string[] = [];
  let place: ReturnType<typeof readForEachZonePhrase> = null;
  while (i < slice.length) {
    place = readForEachZonePhrase(slice, i);
    if (place) break;
    const word = slice[i];
    // The counted noun-phrase never crosses a sentence/clause boundary.
    // Limit raised to 5 (from 4) to accommodate "instant and sorcery cards"
    // (4 tokens before the zone phrase) — Slice 10.
    if (word === '.' || word === ',' || word === ';' || words.length >= 5) return null;
    words.push(word);
    i++;
  }
  if (!place || words.length === 0) return null;
  const filter = parseForEachFilterWords(words);
  if (filter === null) return null;
  return {
    amount: {
      kind: 'ForEach',
      zone: place.zone,
      controller: place.controller,
      ...(filter ? { filter } : {}),
    },
    nextIndex: place.nextIndex,
  };
}

/**
 * Parse the "[,] where x is the number of ..." tail used by spelled-out-X
 * effects ("gets +X/+X until end of turn, where X is the number of ...").
 * Returns the ForEachAmount and the index just past the counted phrase
 * (trailing period is left to the caller, per file convention).
 */
export function parseWhereXIsNumberOf(
  slice: string[],
  at: number,
): { amount: ForEachAmount; nextIndex: number } | null {
  let i = at;
  if (slice[i] === ',') i++;
  if (slice[i] !== 'where' || slice[i + 1] !== 'x' || slice[i + 2] !== 'is') return null;
  return parseNumberOfFilterAmount(slice, i + 3);
}

/**
 * Parse a "[,] where x is <amount>" tail for ETB enters-with-counters clauses.
 * Supports all evaluable where-X forms:
 *   "where X is the number of <filter> <place>"   → ForEachAmount
 *   "where X is the greatest mana value among <filter> in exile"  → GreatestManaValueAmount
 *   "where X is your life total"                  → LifeTotalAmount
 *   "where X is the total mana value of <filter> <place>" → MVSumAmount
 *
 * Returns null for unsupported forms (life-gained-this-turn, storm count,
 * amount-of-mana-spent, etc.) so callers remain honest.
 *
 * Exported for use by stack.ts entersWithCountersDynamic.
 */
export function parseWhereXIsAnyAmount(
  slice: string[],
  at: number,
): { amount: import('./ast').AmountRef; nextIndex: number } | null {
  let i = at;
  if (slice[i] === ',') i++;
  if (slice[i] !== 'where' || slice[i + 1] !== 'x' || slice[i + 2] !== 'is') return null;
  const afterIs = i + 3;

  // Form 0: "where X is this creature's power" / "where X is ~'s power" —
  // Brambleguard Captain family (beginning-of-combat trigger, target gets pump
  // equal to the SOURCE creature's own power). Slice 3/BC.
  // The apostrophe-s is NOT split by the tokenizer, so "creature's" is one token.
  if (
    (slice[afterIs] === 'this' && slice[afterIs + 1] === "creature's" && slice[afterIs + 2] === 'power') ||
    (slice[afterIs] === "~'s" && slice[afterIs + 1] === 'power')
  ) {
    const consumed = slice[afterIs] === 'this' ? afterIs + 3 : afterIs + 2;
    return { amount: { kind: 'TargetPower', target: { kind: 'Source' } }, nextIndex: consumed };

  // Form 0b: "where X is that card's mana value" — Planeswalker's Favor family.
  // "that card's" may be one token (tokenizer kept apostrophe-s) or two tokens.
  } else if (
    slice[afterIs] === 'that' &&
    (slice[afterIs + 1] === "card's" || (slice[afterIs + 1] === 'card' && slice[afterIs + 2] === "'s"))
  ) {
    const afterPossessive = slice[afterIs + 1] === "card's" ? afterIs + 2 : afterIs + 3;
    if (slice[afterPossessive] === 'mana' && slice[afterPossessive + 1] === 'value') {
      return { amount: { kind: 'RevealedRandomCardManaValue' }, nextIndex: afterPossessive + 2 };
    }
  }

  // Form 1: "where X is your life total"
  if (slice[afterIs] === 'your' && slice[afterIs + 1] === 'life' && slice[afterIs + 2] === 'total') {
    return { amount: { kind: 'LifeTotal', controller: 'you' }, nextIndex: afterIs + 3 };
  }

  // Form 1b: "where X is that spell's mana value" — Erratic Cyclops trigger tail.
  // Resolves to EventSpellManaValue (the mana value of the spell that triggered
  // the ability, stored in eventContext.cardInstanceId at execution time).
  if (
    slice[afterIs] === 'that' &&
    (slice[afterIs + 1] === "spell's" || slice[afterIs + 1] === 'spell') &&
    (slice[afterIs + 1] === "spell's"
      ? slice[afterIs + 2] === 'mana' && slice[afterIs + 3] === 'value'
      : slice[afterIs + 2] === "'s" && slice[afterIs + 3] === 'mana' && slice[afterIs + 4] === 'value')
  ) {
    // Normalize: "that spell's mana value" (4 tokens: that spell's mana value)
    // or "that spell 's mana value" (tokenizer splits the apostrophe)
    const consumed = slice[afterIs + 1] === "spell's" ? afterIs + 4 : afterIs + 5;
    return { amount: { kind: 'EventSpellManaValue' }, nextIndex: consumed };
  }

  // Form 1c: "where X is the greatest power among <filter> you control" —
  // Skanos Dragonheart / Heartlash Cinder trigger tail (battlefield only).
  // Accepted controllers: "you control" / "your opponents control" / "on the battlefield"
  // Honest: GreatestPower is already resolved by resolveGreatestPower in executor.ts.
  if (
    slice[afterIs] === 'the' &&
    slice[afterIs + 1] === 'greatest' &&
    slice[afterIs + 2] === 'power' &&
    slice[afterIs + 3] === 'among'
  ) {
    let gi = afterIs + 4;
    // Collect filter words until we hit a controller phrase or end
    const filterWords: string[] = [];
    while (gi < slice.length && !['you', 'your', 'on', '.', ','].includes(slice[gi])) {
      filterWords.push(slice[gi]);
      gi++;
    }
    let controller: 'you' | 'opponent' | 'each' = 'each';
    let zoneOk = false;
    if (slice[gi] === 'you' && slice[gi + 1] === 'control') {
      controller = 'you';
      gi += 2;
      zoneOk = true;
    } else if (
      slice[gi] === 'your' && slice[gi + 1] === 'opponents' && slice[gi + 2] === 'control'
    ) {
      controller = 'opponent';
      gi += 3;
      zoneOk = true;
    } else if (slice[gi] === 'on' && slice[gi + 1] === 'the' && slice[gi + 2] === 'battlefield') {
      controller = 'each';
      gi += 3;
      zoneOk = true;
    }
    if (zoneOk) {
      let filter: import('./ast').CardFilter | undefined;
      // Slice 7: strip "other" prefix — "other Dragons you control" means the same
      // filter as "Dragons you control" but with the source excluded (notSource flag).
      const hasOtherPrefix = filterWords[0] === 'other';
      const baseFilterWords = hasOtherPrefix ? filterWords.slice(1) : filterWords;
      const meaningfulWords = baseFilterWords.filter(w => w !== 'creatures' && w !== 'creature' && w !== 'among');
      if (meaningfulWords.length > 0) {
        const parsed = parseForEachFilterWords(meaningfulWords);
        if (parsed === null) {
          // Unknown filter type — decline honestly
        } else {
          filter = { types: ['creature'], ...(parsed ?? {}) };
        }
      } else {
        filter = { types: ['creature'] };
      }
      if (filter !== undefined) {
        const amount: import('./ast').AmountRef = {
          kind: 'GreatestPower',
          zone: 'battlefield',
          controller,
          filter,
          ...(hasOtherPrefix ? { notSource: true } : {}),
        };
        return { amount, nextIndex: gi };
      }
    }
  }

  // Form 2: "where X is the greatest mana value among [<filter>] in exile"
  // (Ulamog, the Defiler style). Only "in exile" zone is supported here; the
  // battlefield form ("greatest mana value among permanents you control") is
  // handled separately by matchDealDamageGreatestManaValue.
  if (
    slice[afterIs] === 'the' &&
    slice[afterIs + 1] === 'greatest' &&
    slice[afterIs + 2] === 'mana' &&
    slice[afterIs + 3] === 'value' &&
    slice[afterIs + 4] === 'among'
  ) {
    let gi = afterIs + 5;
    // Optional filter words ("cards", "creature cards", etc.) before "in exile"
    const filterWords: string[] = [];
    while (gi < slice.length && slice[gi] !== 'in' && slice[gi] !== '.' && slice[gi] !== ',') {
      filterWords.push(slice[gi]);
      gi++;
    }
    if (slice[gi] === 'in' && slice[gi + 1] === 'exile') {
      gi += 2;
      // Parse optional filter from the collected words (ignore bare "cards")
      let filter: import('./ast').CardFilter | undefined;
      const meaningfulWords = filterWords.filter(w => w !== 'cards' && w !== 'card');
      if (meaningfulWords.length > 0) {
        const parsed = parseForEachFilterWords(meaningfulWords);
        if (parsed === null) return null; // Unknown filter — stay honest
        filter = parsed ?? undefined;
      }
      const amount: import('./ast').AmountRef = {
        kind: 'GreatestManaValue',
        zone: 'exile',
        controller: 'each',
        ...(filter ? { filter } : {}),
      };
      return { amount, nextIndex: gi };
    }
    return null;
  }

  // Form 2b: "where X is the number of [other] spell[s] cast this turn" — Slice 4.
  // Resolves to SpellsCastThisTurn at ETB/resolution time via state.spellsCastThisTurn.
  // "other" sets excludeSelf=true (Storm Entity does not count its own cast).
  if (slice[afterIs] === 'the' && slice[afterIs + 1] === 'number' && slice[afterIs + 2] === 'of') {
    let si = afterIs + 3;
    const excludeSelf = slice[si] === 'other';
    if (excludeSelf) si++;
    if (
      (slice[si] === 'spell' || slice[si] === 'spells') &&
      slice[si + 1] === 'cast' &&
      slice[si + 2] === 'this' &&
      slice[si + 3] === 'turn'
    ) {
      return {
        amount: { kind: 'SpellsCastThisTurn', excludeSelf },
        nextIndex: si + 4,
      };
    }
  }

  // Form 3: "where X is the number of <filter> <place>"
  const forEachResult = parseNumberOfFilterAmount(slice, afterIs);
  if (forEachResult) return forEachResult;

  // Form 4: "where X is the total mana value of <filter> <place>"
  // Example: "where X is the total mana value of instant and sorcery cards in your graveyard"
  // Resolves to MVSumAmount (sum of cmc of all matching cards in zone).
  if (
    slice[afterIs] === 'the' &&
    slice[afterIs + 1] === 'total' &&
    slice[afterIs + 2] === 'mana' &&
    slice[afterIs + 3] === 'value' &&
    slice[afterIs + 4] === 'of'
  ) {
    let mi = afterIs + 5;
    // Collect filter words until we find a zone phrase
    const filterWords: string[] = [];
    let place: ReturnType<typeof readForEachZonePhrase> = null;
    while (mi < slice.length) {
      place = readForEachZonePhrase(slice, mi);
      if (place) break;
      const word = slice[mi];
      if (word === '.' || word === ',' || word === ';' || filterWords.length >= 5) break;
      filterWords.push(word);
      mi++;
    }
    if (place) {
      // Strip bare "cards"/"card" words — they add no filter constraint
      const meaningfulWords = filterWords.filter(w => w !== 'cards' && w !== 'card');
      let filter: import('./ast').CardFilter | undefined;
      if (meaningfulWords.length > 0) {
        const parsed = parseForEachFilterWords(meaningfulWords);
        if (parsed === null) return null; // Unknown filter — stay honest
        filter = parsed ?? undefined;
      }
      const amount: import('./ast').AmountRef = {
        kind: 'MVSum',
        zone: place.zone,
        controller: place.controller as 'you' | 'opponent' | 'each',
        ...(filter ? { filter } : {}),
      };
      return { amount, nextIndex: place.nextIndex };
    }
  }

  return null;
}

// matchGainLifeEqualToNumberOf, matchLoseLifeEqualToNumberOf, matchDrawEqualToNumberOf, matchMillEqualToNumberOf — moved to ./matchers/life-draw-mill.ts

// matchTargetPlayerLoseLifeEqualToNumberOf — moved to ./matchers/life-draw-mill.ts

/**
 * Match: "[target creature | ~ | it | this creature] gets +X/+X|+X/+0|+0/+X
 *         until end of turn, where X is the number of <filter> <place>"
 * (Ghoul's Feast, Elder of Laurels, Vile Deacon). The dynamic component is the
 * executor-backed ForEachAmount; only non-negative spelled-out-X components are
 * accepted because ForEach counts can't be negated.
 */
// matchModifyPTWhereX — moved to ./matchers/pump-grants.ts

/**
 * Match: "<source> deals X damage to <target>, where X is the number of <filter> <place>"
 * Spelled-out-X damage with the count defined in the where-clause (NOT a cast-time
 * {X} cost), so the amount is the executor-backed ForEachAmount.
 */
// matchDealDamageXWhereX moved to matchers/damage.ts

// matchEachOpponentLosesXLifeWhereX, matchGainLifeXWhereX, matchLoseLifeXWhereX, matchDrawXWhereX, matchMillXWhereX — moved to ./matchers/life-draw-mill.ts

// matchGainLife — moved to ./matchers/life-draw-mill.ts

// matchLoseLife — moved to ./matchers/life-draw-mill.ts


// matchEachOpponentLosesLife — moved to ./matchers/life-draw-mill.ts

/** Parse a life/card amount token: digit ("3"), word ("three"), or "a"/"an" (=1). */
export function parsePlayerAmountToken(tok: string | undefined): number {
  if (tok === undefined) return NaN;
  if (tok === 'a' || tok === 'an') return 1;
  const n = parseInt(tok, 10);
  return !isNaN(n) ? n : parseSmallNumberToken(tok);
}

// matchTargetPlayerLoseLife, matchTargetPlayerGainLife, matchEachPlayerGainLife — moved to ./matchers/life-draw-mill.ts

// matchTargetPlayerDiscardAtRandom — moved to ./matchers/players.ts
// matchEachOpponentDiscardsCard — moved to ./matchers/players.ts

// matchDestroyAll — moved to ./matchers/mass-effects.ts

/**
 * Match: "exile target creature"
 * Match: "exile target permanent"
 * Match: "exile target nonland permanent"
 * Match: "exile target card from a graveyard"
 * Match: "exile target card from an opponent's graveyard"
 */
// matchExile — moved to ./matchers/zones.ts

/**
 * Match: "return target creature to its owner's hand"
 * Match: "return target nonland permanent to its owner's hand"
 */
// matchReturnToHand — moved to ./matchers/zones.ts

// matchReturnPermanentYouControlToHand — moved to ./matchers/zones.ts

// matchMill, matchEachPlayerOrOpponentMill — moved to ./matchers/life-draw-mill.ts

export function targetTypeFromSimplePermanentWord(word: string): TargetType | null {
  if (word === 'creature') return 'Creature';
  if (word === 'land') return 'Land';
  if (word === 'artifact') return 'Artifact';
  if (word === 'enchantment') return 'Enchantment';
  if (word === 'permanent') return 'Permanent';
  return null;
}

// matchTap, matchGoad, matchRegenerate, matchUntap — moved to ./matchers/keyword-actions.ts

/**
 * Match: "create a N/N [color] [type] creature token"
 * Match: "create N N/N [color] [type] creature tokens"
 */
// Canonical reminder-text abilities for predefined artifact tokens, so the engine
// actually executes them (Treasure ramp, Clue draw, Food lifegain). The mana-
// production cache + activated-ability parser turn these strings into real abilities.
const PREDEFINED_TOKEN_ABILITIES: Record<string, string[]> = {
  treasure: ['{T}, Sacrifice this token: Add one mana of any color.'],
  gold: ['Sacrifice this token: Add one mana of any color.'],
  clue: ['{2}, Sacrifice this token: Draw a card.'],
  food: ['{2}, {T}, Sacrifice this token: You gain 3 life.'],
  lander: ['{2}, {T}, Sacrifice this token: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.'],
  powerstone: ["{T}: Add {C}. This mana can't be spent to cast a nonartifact spell."],
};

export function predefinedArtifactToken(artifactName: string): TokenDefinition {
  const subtype = artifactName.charAt(0).toUpperCase() + artifactName.slice(1);
  const abilities = PREDEFINED_TOKEN_ABILITIES[artifactName];
  return {
    name: subtype,
    colors: [],
    types: ['artifact'],
    subtypes: [subtype],
    power: 0,
    toughness: 0,
    ...(abilities ? { abilities } : {}),
  };
}

// matchInvestigate, matchExplore, matchAdapt, matchBolster, matchMonstrosity,
// matchFabricate, matchPopulate, matchAmass, matchConnive, matchBecomeMonarch
// — moved to ./matchers/keyword-actions.ts

// matchRevealTopIfMatch — moved to ./matchers/search-dig.ts
/** Sum a mana token like "{1}{g}" to a mana value (generic {N} counts N, each
 *  colored/colorless pip counts 1). Returns null if not a mana token. */
function manaTokenToValue(tok: string): number | null {
  const groups = tok.match(/\{[^}]+\}/g);
  if (!groups) return null;
  let total = 0;
  for (const g of groups) {
    const inner = g.slice(1, -1);
    const n = parseInt(inner, 10);
    total += !isNaN(n) ? n : 1;
  }
  return total;
}

/**
 * Match "[you may] pay <cost>. If you do, <effects>." as a gated OptionalPay effect.
 * Runs after parseEffectClauseInternal strips a leading "you may", so it sees "pay …".
 */
function matchOptionalPay(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice[0] !== 'pay' && slice[0] !== 'sacrifice' && slice[0] !== 'discard') return null;

  let manaCost: number | string | undefined;
  let lifeCost: number | undefined;
  let energyCost: number | undefined;
  let sacrificeFilter: CardFilter | undefined;
  let discardCount: number | undefined;
  let xCost: boolean | undefined;
  let idx = 1;

  if (slice[0] === 'sacrifice') {
    // "sacrifice a/an/another <type>"
    if (slice[idx] === 'a' || slice[idx] === 'an' || slice[idx] === 'another') {
      idx++;
    } else {
      return null;
    }
    const typeMap: Record<string, CardFilter> = {
      creature: { types: ['creature'] }, artifact: { types: ['artifact'] },
      enchantment: { types: ['enchantment'] }, land: { types: ['land'] },
      permanent: {},
    };
    const f = typeMap[slice[idx]];
    if (f === undefined) return null;
    sacrificeFilter = f;
    idx++;
  } else if (slice[0] === 'discard') {
    // "discard a card" | "discard N cards"
    if (slice[idx] === 'a' && slice[idx + 1] === 'card') {
      discardCount = 1; idx += 2;
    } else {
      const n = parseInt(slice[idx], 10);
      const w = parseSmallNumberToken(slice[idx]);
      const c = !isNaN(n) ? n : w;
      if (isNaN(c) || c <= 0) return null;
      if (slice[idx + 1] !== 'cards' && slice[idx + 1] !== 'card') return null;
      discardCount = c; idx += 2;
    }
  } else if (slice[idx] && /^(?:\{[^}]+\})+$/.test(slice[idx])) {
    const pips = slice[idx].match(/\{[^}]+\}/g) ?? [];
    const isGenericPip = (p: string) => /^\{\d+\}$/.test(p);
    const isColoredPip = (p: string) => /^\{[wubrgc](?:\/[wubrgc])?\}$/.test(p);
    const isXPip = (p: string) => /^\{x\}$/i.test(p);
    if (pips.length > 0 && pips.every(p => /^\{e\}$/.test(p))) {
      // "pay {E}{E}" is energy, not mana — paid from the player's energy counters.
      energyCost = pips.length;
    } else if (pips.some(isXPip) && pips.every(p => isXPip(p) || isGenericPip(p) || isColoredPip(p))) {
      // Slice 1: "{X}" or "{X}{R}" costs. The {X} pip is paid by tapping xValue
      // untapped lands (from ctx.xValue at execution time). Non-X colored pips
      // are stored in manaCost so the executor also verifies color availability.
      xCost = true;
      const nonXPips = pips.filter(p => !isXPip(p));
      if (nonXPips.length === 0) {
        // Pure X cost ({X} alone) — no additional colored requirement.
      } else if (nonXPips.some(isColoredPip) && nonXPips.every(p => isGenericPip(p) || isColoredPip(p))) {
        manaCost = nonXPips.map(p => p.toUpperCase()).join('');
      } else {
        // Generic-only non-X pips (unlikely but safe to handle).
        manaCost = nonXPips.reduce((sum, p) => {
          const n = parseInt(p.slice(1, -1), 10);
          return sum + (isNaN(n) ? 1 : n);
        }, 0);
      }
    } else if (pips.some(isColoredPip) && pips.every(p => isGenericPip(p) || isColoredPip(p))) {
      // Colored cost — keep the canonical mana string so the executor can check
      // the controller's lands actually produce the required colors.
      manaCost = pips.map(p => p.toUpperCase()).join('');
    } else {
      const v = manaTokenToValue(slice[idx]);
      if (v === null || v <= 0) return null;
      manaCost = v;
    }
    idx++;
  } else {
    const n = parseInt(slice[idx], 10);
    if (!isNaN(n) && n > 0 && slice[idx + 1] === 'life') {
      lifeCost = n;
      idx += 2;
    } else {
      return null;
    }
  }

  // Require an "if you do" or "when you do" gate so we know exactly what the payment buys.
  // "When you do," is the reflexive variant used in some modern wordings (Slice 7).
  if (slice[idx] === '.' || slice[idx] === ',') idx++;
  const gateWord = slice[idx]; // "if" or "when"
  if (!((gateWord === 'if' || gateWord === 'when') && slice[idx + 1] === 'you' && slice[idx + 2] === 'do')) return null;
  idx += 3;
  if (slice[idx] === ',') idx++;

  const inner = parseMultipleEffects(tokens, startIndex + idx);
  if (!inner || inner.effects.length === 0) return null;

  const effect: Effect = {
    kind: 'OptionalPay',
    ...(manaCost !== undefined ? { manaCost } : {}),
    ...(lifeCost !== undefined ? { lifeCost } : {}),
    ...(energyCost !== undefined ? { energyCost } : {}),
    ...(sacrificeFilter !== undefined ? { sacrificeFilter } : {}),
    ...(discardCount !== undefined ? { discardCount } : {}),
    ...(xCost ? { xCost: true } : {}),
    effects: inner.effects,
  };
  return { effects: [effect], targets: inner.targets, consumed: idx + inner.consumed };
}

// matchProliferate — moved to ./matchers/keyword-actions.ts
// matchCreateToken, matchThatPlayerCreatesToken — moved to ./matchers/tokens.ts

/**
 * Slice 8/12: Match "that player may pay <cost>. If they don't, <downside>."
 * (Umbilicus / Emberwilde Djinn / Illusions of Grandeur family —
 *  each-player-upkeep unless-pay punisher.)
 *
 * "That player" is the event player (the player whose upkeep this is).
 * If they CAN pay (and the AI keeps a life/mana buffer), the cost is
 * deducted and the downside is skipped; otherwise the downside fires.
 *
 * Accepted cost forms:
 *   "that player may pay N life."
 *   "that player may pay {R}{R}."                  (colored mana)
 *   "that player may pay {2}."                     (generic mana)
 *   "that player may pay {R}{R} or N life."        (alt cost, pick cheaper)
 *
 * Gate: "if they don't, <downside>" — downside is parsed via parseMultipleEffects.
 * HONESTY: accepts only when the downside body fully parses into executor-backed
 * effects (consistent with the general honesty bar).
 *
 * Lives in parser.ts because it needs parseMultipleEffects (parser-internal).
 */
function matchEachPlayerUnlessPay(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Head: "that player may pay"
  if (slice[0] !== 'that' || slice[1] !== 'player' || slice[2] !== 'may' || slice[3] !== 'pay') return null;

  let manaCost: number | string | undefined;
  let lifeCost: number | undefined;
  let idx = 4;

  // Cost parsing — handle "{R}{R}", "{2}", "2", "{R}{R} or 2 life"
  const costTok = slice[idx];
  if (costTok && /^(?:\{[^}]+\})+$/.test(costTok)) {
    // Mana cost like {R}{R} or {2}
    const pips = costTok.match(/\{[^}]+\}/g) ?? [];
    const isGenericPip = (p: string) => /^\{\d+\}$/.test(p);
    const isColoredPip = (p: string) => /^\{[wubrgcWUBRGC](?:\/[wubrgcWUBRGC])?\}$/.test(p);
    if (pips.every(p => isGenericPip(p))) {
      // Pure generic: {2} → 2
      const v = manaTokenToValue(costTok);
      if (v === null || v <= 0) return null;
      manaCost = v;
    } else if (pips.every(p => isGenericPip(p) || isColoredPip(p))) {
      // Colored pips — keep canonical mana string
      manaCost = pips.map(p => p.toUpperCase()).join('');
    } else {
      return null;
    }
    idx++;
    // Optional "or N life" alt cost — when both are offered, AI uses whichever is
    // available; for simplicity we record the lifeCost too and the executor uses
    // whichever cost applies to the paying player.
    if (slice[idx] === 'or') {
      const lifeN = parseInt(slice[idx + 1], 10);
      if (!isNaN(lifeN) && lifeN > 0 && slice[idx + 2] === 'life') {
        lifeCost = lifeN;
        idx += 3;
      }
    }
  } else {
    // Life cost only: "2 life"
    const n = parseInt(costTok, 10);
    if (isNaN(n) || n <= 0) return null;
    if (slice[idx + 1] !== 'life') return null;
    lifeCost = n;
    idx += 2;
  }

  // Separator
  if (slice[idx] === '.') idx++;
  if (slice[idx] === ',') idx++;

  // Gate: "if they don't ,"
  if (slice[idx] !== 'if') return null;
  idx++;
  if (slice[idx] === 'the' && slice[idx + 1] === 'player') {
    // "if the player doesn't"
    idx += 2;
  } else if (slice[idx] === 'they') {
    // "if they don't"
    idx++;
  } else {
    return null;
  }
  if (slice[idx] !== "don't" && slice[idx] !== 'do') return null;
  // "don't" or "doesn't" → skip; "do not" → skip two tokens
  if (slice[idx] === "don't" || slice[idx] === "doesn't") {
    idx++;
  } else if (slice[idx] === 'do' && slice[idx + 1] === 'not') {
    idx += 2;
  } else {
    return null;
  }
  if (slice[idx] === ',') idx++;

  // Normalize the downside clause: "they return/discard/sacrifice/..." →
  // "that player returns/discards/sacrifices/..." because Umbilicus-family cards
  // use the base-form pronoun "they" while all body matchers expect third-person
  // "that player <verb-s>" (EventPlayer pronoun + third-person singular verb).
  const downsideAbsoluteStart = startIndex + idx;
  let downsideToks = tokens;
  if (tokens[downsideAbsoluteStart] === 'they') {
    // Third-person singular normalisation of the next verb token (base → -s form).
    // Only handle the common irregular / regular verbs that appear in MTG oracle text.
    const BASE_TO_S: Record<string, string> = {
      return: 'returns', discard: 'discards', sacrifice: 'sacrifices',
      mill: 'mills', lose: 'loses', reveal: 'reveals', exile: 'exiles',
      draw: 'draws', gain: 'gains', put: 'puts', pay: 'pays',
      take: 'takes', give: 'gives', skip: 'skips',
    };
    const verbTok = tokens[downsideAbsoluteStart + 1] ?? '';
    const normVerb = BASE_TO_S[verbTok] ?? verbTok;
    downsideToks = [
      ...tokens.slice(0, downsideAbsoluteStart),
      'that',
      'player',
      normVerb,
      ...tokens.slice(downsideAbsoluteStart + 2),
    ];
  }

  // Parse the downside effects through parseMultipleEffects
  const downside = parseMultipleEffects(downsideToks, downsideAbsoluteStart);
  if (!downside || downside.effects.length === 0) return null;

  const effect: Effect = {
    kind: 'EachPlayerUnlessPay',
    player: { kind: 'EventPlayer' },
    ...(manaCost !== undefined ? { manaCost } : {}),
    ...(lifeCost !== undefined ? { lifeCost } : {}),
    downsideEffects: downside.effects,
  };
  return {
    effects: [effect],
    targets: downside.targets,
    consumed: idx + downside.consumed,
  };
}

/**
 * Match the optional "you may choose" variant of reveal-hand coercion:
 *   "Target opponent reveals their hand. You may choose a nonland card from it.
 *    If you do, that player discards that card."                (Despise variant)
 *   "Target opponent reveals their hand. You may choose a nonland card from it.
 *    If you do, that player discards that card. If you don't, put two +1/+1
 *    counters on ~."                                      (Reckoner Shakedown)
 *
 * AI policy: the engine always picks a card when one is legal. The "if you
 * don't" else-effects are parsed and stored so they execute when the target's
 * hand has no matching cards.
 *
 * This matcher lives in parser.ts (not matchers/players.ts) because parsing the
 * else-effects requires parseMultipleEffects, which is a parser-internal.
 */
function matchRevealHandOptionalChooseCard(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 15) return null;

  // "target opponent/player reveals their hand ."
  if (slice[0] !== 'target') return null;
  if (slice[1] !== 'opponent' && slice[1] !== 'player') return null;
  if (slice[2] !== 'reveals' || slice[3] !== 'their' || slice[4] !== 'hand') return null;
  if (slice[5] !== '.') return null;
  let idx = 6;

  // "you may choose a/an [<filter words>] card from it"
  if (slice[idx] !== 'you' || slice[idx + 1] !== 'may' || slice[idx + 2] !== 'choose') return null;
  idx += 3;
  if (slice[idx] !== 'a' && slice[idx] !== 'an') return null;
  idx++;
  const filterStart = idx;
  while (idx < slice.length && slice[idx] !== 'card' && slice[idx] !== '.') idx++;
  if (slice[idx] !== 'card') return null;
  const filter = parseChosenHandCardFilter(slice.slice(filterStart, idx));
  if (filter === null) return null;
  idx++;
  if (slice[idx] !== 'from' || slice[idx + 1] !== 'it') return null;
  idx += 2;
  if (slice[idx] === '.') idx++;

  // "if you do , <effects> ."
  if (slice[idx] !== 'if' || slice[idx + 1] !== 'you' || slice[idx + 2] !== 'do') return null;
  idx += 3;
  if (slice[idx] === ',') idx++;

  // Parse the "if you do" effects (disposition tail): must start with
  // "that player discards that card" or "exile that card"
  let disposition: 'discard' | 'exile';
  if (slice[idx] === 'that' && slice[idx + 1] === 'player'
      && slice[idx + 2] === 'discards' && slice[idx + 3] === 'that' && slice[idx + 4] === 'card') {
    disposition = 'discard';
    idx += 5;
  } else if (slice[idx] === 'exile' && slice[idx + 1] === 'that' && slice[idx + 2] === 'card') {
    disposition = 'exile';
    idx += 3;
  } else {
    return null;
  }
  if (slice[idx] === '.') idx++;

  // Optional "if you don't , <else-effects> ." branch
  const elseEffects: Effect[] = [];
  const elseTargets: TargetSpec[] = [];
  if (slice[idx] === 'if' && slice[idx + 1] === 'you' && slice[idx + 2] === "don't") {
    idx += 3;
    if (slice[idx] === ',') idx++;
    const elseResult = parseMultipleEffects(tokens, startIndex + idx);
    if (elseResult && elseResult.effects.length > 0) {
      elseEffects.push(...elseResult.effects);
      elseTargets.push(...elseResult.targets);
      idx += elseResult.consumed;
    }
  }

  const spec = makeTargetSpec('Player', slice[1] === 'opponent' ? { opponentControls: true } : undefined);
  const effect: Effect = {
    kind: 'RevealHandChooseCard',
    player: makeChosenRef(spec),
    filter,
    disposition,
    optional: true,
    ...(elseEffects.length > 0 ? { elseEffects } : {}),
  };
  return { effects: [effect], targets: [spec, ...elseTargets], consumed: idx };
}

function parseD20Range(tokens: string[], startIndex: number): { min: number; max: number; nextIndex: number } | null {
  const min = parseInt(tokens[startIndex], 10);
  if (isNaN(min)) return null;
  const dash = tokens[startIndex + 1];
  if (dash !== '-' && dash !== 'â€“' && dash !== 'â€”') return null;
  const max = parseInt(tokens[startIndex + 2], 10);
  if (isNaN(max)) return null;

  let nextIndex = startIndex + 3;
  if (tokens[nextIndex] === '|') nextIndex++;
  return { min, max, nextIndex };
}

function findNextD20Outcome(tokens: string[], startIndex: number): number {
  for (let i = startIndex; i < tokens.length - 3; i++) {
    if (parseD20Range(tokens, i)) return i;
  }
  return -1;
}

function attachSourceToCreatedIfRequested(effects: Effect[], outcomeTokens: string[]): Effect[] {
  const attachIndex = outcomeTokens.indexOf('attach');
  const attachesToIt = attachIndex >= 0 && outcomeTokens.some((token, index) =>
    index > attachIndex && token === 'to' && outcomeTokens[index + 1] === 'it'
  );
  if (!attachesToIt) return effects;

  let attachedFirstToken = false;
  return effects.map(effect => {
    if (!attachedFirstToken && effect.kind === 'CreateToken') {
      attachedFirstToken = true;
      return { ...effect, attachSourceToCreated: true };
    }
    return effect;
  });
}

/**
 * Match dice-table text like:
 * "roll a d20. 1-9 | create a 1/1 red Goblin creature token.
 *  10-20 | create a 1/1 red Goblin creature token, then attach CARD to it."
 */
function matchRollD20(tokens: string[], startIndex: number): PatternResult {
  if (tokens[startIndex] !== 'roll' || tokens[startIndex + 1] !== 'a' || tokens[startIndex + 2] !== 'd20') {
    return null;
  }

  let idx = startIndex + 3;
  while (tokens[idx] === '.' || tokens[idx] === ',') idx++;

  const outcomes: RollD20Outcome[] = [];
  while (idx < tokens.length) {
    while (tokens[idx] === '.' || tokens[idx] === ',') idx++;

    const range = parseD20Range(tokens, idx);
    if (!range) break;

    const outcomeStart = range.nextIndex;
    const nextOutcome = findNextD20Outcome(tokens, outcomeStart);
    const outcomeEnd = nextOutcome === -1 ? tokens.length : nextOutcome;
    const outcomeTokens = tokens.slice(outcomeStart, outcomeEnd);
    const parsed = parseMultipleEffects(outcomeTokens, 0);
    if (parsed && parsed.effects.length > 0) {
      outcomes.push({
        min: range.min,
        max: range.max,
        effects: attachSourceToCreatedIfRequested(parsed.effects, outcomeTokens),
      });
    }

    idx = outcomeEnd;
  }

  if (outcomes.length === 0) return null;

  return {
    effects: [{ kind: 'RollD20', outcomes }],
    targets: [],
    consumed: Math.max(idx - startIndex, 3),
  };
}

/**
 * Slice 8/12: Combat-damage-trigger body "roll a dN. [you] create that many <token-def>"
 *
 * Handles cards like Ancient Gold Dragon:
 *   "Whenever this creature deals combat damage to a player, roll a d20.
 *    You create that many 1/1 blue and red Faerie Dragon creature tokens with flying."
 *
 * Unlike matchRollD20 (which requires a range table "1-9 | effect"), this matcher
 * handles the linear "create that many" form where the token count equals the die
 * roll result. It emits a RollD20Effect with one outcome per face of the die
 * (e.g., 20 outcomes for d20), each creating N tokens where N = face value.
 *
 * Supports d4, d6, d8, d10, d12, d20.
 * Must be placed BEFORE matchRollD20 in the dispatch arrays because this pattern
 * is more specific (ends in "create that many" not a range table).
 */
function matchRollDNCreateThatManyTokens(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice[0] !== 'roll' || slice[1] !== 'a') return null;

  // Supported dice: d4, d6, d8, d10, d12, d20
  const DICE_SIZES: Record<string, number> = {
    d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20,
  };
  const sides = DICE_SIZES[slice[2]];
  if (!sides) return null;

  let idx = 3;
  // Skip optional punctuation after die token
  while (idx < slice.length && (slice[idx] === '.' || slice[idx] === ',')) idx++;

  // Skip optional "you" subject
  if (slice[idx] === 'you') idx++;

  // Must see "create that many"
  if (slice[idx] !== 'create' || slice[idx + 1] !== 'that' || slice[idx + 2] !== 'many') return null;

  // Re-parse the token definition as "create a <rest>"
  // slice[idx] = "create", slice[idx+1] = "that", slice[idx+2] = "many", then the token definition
  const subTokens = ['create', 'a', ...tokens.slice(startIndex + idx + 3)];
  const createResult = matchCreateToken(subTokens, 0);
  if (!createResult) return null;
  const baseEffect = createResult.effects[0];
  if (!baseEffect || baseEffect.kind !== 'CreateToken') return null;

  // Build one outcome per face of the die (1..sides)
  const outcomes: RollD20Outcome[] = [];
  for (let face = 1; face <= sides; face++) {
    outcomes.push({
      min: face,
      max: face,
      effects: [{ ...baseEffect, count: face }],
    });
  }

  // Compute consumed relative to startIndex (i.e., within `slice`).
  // At this point `idx` is the index in `slice` where "create" starts.
  // "create that many" is 3 tokens in `slice`.
  // subTokens = ["create", "a", ...rest], createResult.consumed is in subTokens space.
  // The rest tokens in subTokens (after "create" "a") map 1:1 to slice tokens
  // (after "create" "that" "many"), with an offset of -1 (subTokens has "a", slice has "that" "many" together offset by +1).
  // Net: slice position after consume = idx + 3 + (createResult.consumed - 2)
  const consumed = idx + 3 + (createResult.consumed - 2);

  return {
    effects: [{ kind: 'RollD20', outcomes }],
    targets: [],
    consumed,
  };
}

export function singularizeSubtypeWord(word: string): string {
  const subtypeMap: Record<string, string> = {
    elf: 'elf', elves: 'elf',
    goblin: 'goblin', goblins: 'goblin',
    zombie: 'zombie', zombies: 'zombie',
    dragon: 'dragon', dragons: 'dragon',
    angel: 'angel', angels: 'angel',
    demon: 'demon', demons: 'demon',
    merfolk: 'merfolk',
    soldier: 'soldier', soldiers: 'soldier',
    wizard: 'wizard', wizards: 'wizard',
    knight: 'knight', knights: 'knight',
    warrior: 'warrior', warriors: 'warrior',
    cleric: 'cleric', clerics: 'cleric',
    rogue: 'rogue', rogues: 'rogue',
    shaman: 'shaman', shamans: 'shaman',
    beast: 'beast', beasts: 'beast',
    elemental: 'elemental', elementals: 'elemental',
    vampire: 'vampire', vampires: 'vampire',
    sliver: 'sliver', slivers: 'sliver',
    human: 'human', humans: 'human',
    spirit: 'spirit', spirits: 'spirit',
    bird: 'bird', birds: 'bird',
    cat: 'cat', cats: 'cat',
    dinosaur: 'dinosaur', dinosaurs: 'dinosaur',
    pirate: 'pirate', pirates: 'pirate',
    dwarf: 'dwarf', dwarves: 'dwarf',
    wolf: 'wolf', wolves: 'wolf',
  };
  return subtypeMap[word] || word.replace(/s$/, '');
}

export function parseCreateTokenWhereXCount(
  slice: string[],
  startIndex: number,
): { count: ForEachAmount; consumed: number } | null {
  let idx = startIndex;
  if (slice[idx] === ',') idx++;

  if (
    slice[idx] !== 'where' ||
    slice[idx + 1] !== 'x' ||
    slice[idx + 2] !== 'is' ||
    slice[idx + 3] !== 'the' ||
    slice[idx + 4] !== 'number' ||
    slice[idx + 5] !== 'of'
  ) {
    return null;
  }

  idx += 6;
  const countedWords: string[] = [];
  while (idx < slice.length && !(slice[idx] === 'you' && slice[idx + 1] === 'control')) {
    if (slice[idx] !== ',' && slice[idx] !== '.') countedWords.push(slice[idx]);
    idx++;
  }
  if (slice[idx] !== 'you' || slice[idx + 1] !== 'control' || countedWords.length === 0) {
    return null;
  }
  idx += 2;
  if (slice[idx] === '.') idx++;

  const countedType = countedWords[countedWords.length - 1];
  let filter: CardFilter | undefined;
  if (countedType === 'creatures' || countedType === 'creature') {
    filter = { types: ['creature'] };
  } else if (countedType === 'artifacts' || countedType === 'artifact') {
    filter = { types: ['artifact'] };
  } else if (countedType === 'enchantments' || countedType === 'enchantment') {
    filter = { types: ['enchantment'] };
  } else if (countedType === 'lands' || countedType === 'land') {
    filter = { types: ['land'] };
  } else {
    const subtype = singularizeSubtypeWord(countedType);
    filter = {
      types: ['creature'],
      subtypes: [subtype.charAt(0).toUpperCase() + subtype.slice(1)],
    };
  }

  return {
    count: {
      kind: 'ForEach',
      zone: 'battlefield',
      filter,
      controller: 'you',
    },
    consumed: idx,
  };
}

// matchDiscard — moved to ./matchers/players.ts

// matchScry, matchSurveil — moved to ./matchers/keyword-actions.ts

/**
 * Match: "~ deals X damage to any target"
 */
// matchDealXDamage moved to matchers/damage.ts

// matchDrawX — moved to ./matchers/life-draw-mill.ts

/**
 * Match: "counter target spell"
 * Match: "counter target noncreature spell"
 * Match: "counter target creature spell"
 * Match: "counter target creature or enchantment spell. If that spell is countered this way, exile it instead..."
 */
// matchCounterSpell — moved to ./matchers/pump-grants.ts

/**
 * Match (one-sided "fight"): "target [color] creature you control deals damage
 * equal to its power to target [color] creature [you don't control | an opponent
 * controls]". Unlike Fight this is NOT mutual — only fighterA deals damage to
 * fighterB equal to fighterA's power. Emitted as a DealDamage whose amount is the
 * chosen fighterA's power (executor resolves TargetPower against a Chosen ref).
 *
 * Skips "or planeswalker" variants (no planeswalker target type) to stay honest.
 */
// matchOneSidedDealDamageByPower moved to matchers/damage.ts
// matchDamageToItselfByPower moved to matchers/damage.ts
// matchFight moved to matchers/damage.ts

// GRAVEYARD_NOUN_CARD_TYPES, PERMANENT_CARD_TYPES, GRAVEYARD_NOUN_NON_SUBTYPE_WORDS — moved to ./matchers/zones.ts

// parseGraveyardCardNounPhrase — moved to ./matchers/zones.ts
// matchReturnFromGraveyard — moved to ./matchers/zones.ts
// matchReturnThatCardToHand — moved to ./matchers/zones.ts
// matchPutCreatureCardFromOpponentGraveyardOntoBattlefield — moved to ./matchers/zones.ts

// matchAttachedStaticBuff — moved to ./matchers/static-abilities.ts

// matchSelfMustAttack — moved to ./matchers/static-abilities.ts

// matchEntersTapped — moved to ./matchers/static-abilities.ts
// matchCantBeCountered — moved to ./matchers/static-abilities.ts
// matchSelfCostReduction — moved to ./matchers/static-abilities.ts
// matchLandwalk — moved to ./matchers/static-abilities.ts
// matchProtection — moved to ./matchers/static-abilities.ts
// matchOtherEvasion — moved to ./matchers/static-abilities.ts
// matchBlockOnlyFlying — moved to ./matchers/static-abilities.ts

// ============================================================================
// Shared helpers for static-ability matchers — also used by absorbEngineKeywordLines.
// Exported so ./matchers/static-abilities.ts can import them without a cycle.
// ============================================================================

// Known engine keywords whose function is handled outside parseOracleText (the
// keyword cache). Mirrors the audit harness KNOWN_ENGINE_KEYWORDS bar.
export const CBC_ALLOWED_KEYWORDS = new Set([
  'deathtouch', 'defender', 'double strike', 'first strike', 'flash', 'flying',
  'haste', 'hexproof', 'indestructible', 'intimidate', 'lifelink', 'menace',
  'reach', 'shroud', 'trample', 'vigilance', 'fear', 'infect', 'wither',
  'skulk', 'horsemanship',
]);

export function stripReminderTextForCBC(text: string): string {
  let result = '';
  let depth = 0;
  for (const char of text) {
    if (char === '(') { depth += 1; continue; }
    if (char === ')') { depth = Math.max(0, depth - 1); continue; }
    if (depth === 0) result += char;
  }
  return result;
}

export function isCBCAllowedKeywordSentence(sentence: string): boolean {
  const parts = sentence
    .toLowerCase()
    .split(/\s*,\s*|\s+and\s+/)
    .map(part => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every(part => {
    // "protection from blue", "protection from blue and from black"
    if (/^protection from /.test(part)) return true;
    // "ward {2}", "ward—pay 2 life", "ward {x}"
    if (/^ward(\s*[—-].*|\s*\{[^}]+\})?$/.test(part)) return true;
    // "pay 2 life" tail of a "ward—pay 2 life" split
    if (/^pay \d+ life$/.test(part)) return true;
    // trailing mana-cost suffix (e.g. "ward {2}") already handled; strip any
    // remaining "{...}" suffix from a bare keyword.
    const normalized = part.replace(/\s*\{[^}]+\}\s*$/, '').trim();
    return CBC_ALLOWED_KEYWORDS.has(normalized);
  });
}

export const PROTECTION_ENFORCED_QUALITY_RE = new RegExp(
  '^(?:' +
    // colors (getProtectionColors / COLOR_WORD_TO_MANA)
    'white|blue|black|red|green' +
    // card types (sourceMatchesProtectionClause)
    '|artifacts?|creatures?|enchantments?|planeswalkers?|instants?|sorcery|sorceries' +
    // color categories (sourceMatchesProtectionClause)
    '|monocolored|multicolored|colorless' +
  ')$',
);

/**
 * True iff `sentence` is a "protection from ..." clause naming ONLY enforced
 * qualities. Handles the multi-quality spelling "protection from A and from B"
 * and a trailing "and from C": each quality between the "from" markers must be
 * individually enforced.
 *
 * Slice 5: "the chosen color" is accepted as an enforced quality because
 * keywords.ts getProtectionColors now resolves it via choices.chosenColor on
 * the protecting permanent.
 */
export function isEnforcedProtectionSentence(sentence: string): boolean {
  const lower = sentence.toLowerCase().trim();
  const m = /^protection from (.+)$/.exec(lower);
  if (!m) return false;
  // Split on the connectors used in protection clauses: "and from", "and", ",".
  // Drop any stray "from" tokens (from the "and from X" spelling) and blanks.
  const qualities = m[1]
    .split(/\s*,\s*|\s+and\s+/)
    .map(part => part.replace(/^from\s+/, '').trim())
    .filter(Boolean);
  if (qualities.length === 0) return false;
  return qualities.every(q =>
    PROTECTION_ENFORCED_QUALITY_RE.test(q) || q === 'the chosen color',
  );
}

export const LANDWALK_SENTENCE_RE =
  /^(?:snow\s+)?(?:swamp|forest|island|mountain|plains?|land)walk$/i;

/**
 * Match a dynamic pump: "target creature gets +1/+1 for each <type> you control
 * [until end of turn]" (optionally prefixed "Until end of turn, ..."). The bonus
 * is a ForEach amount the executor resolves by counting matching permanents, so
 * it is genuinely applied. Restricted to ±1 components because ForEachAmount has
 * no multiplier (a "+2/+2 for each" can't be represented yet).
 */
// matchModifyPTForEach — moved to ./matchers/pump-grants.ts

/**
 * Match: "target creature gets +N/+N until end of turn"
 * Match: "target creature gets -N/-N until end of turn"
 * Match: "creatures you control get +N/+N until end of turn"
 */
// matchModifyPT — moved to ./matchers/pump-grants.ts

// matchDiscardSelf — moved to ./matchers/players.ts

// ============================================================================
// Phase 14: New pattern matchers
// ============================================================================

/**
 * Parse a word number like "one", "two", "three", etc. Returns the number or NaN.
 */
export function parseWordNumber(word: string): number {
  const map: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
    sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  };
  return map[word] ?? NaN;
}

// matchForEachAddMana — moved to ./matchers/keyword-actions.ts
// matchForEachDraw — moved to ./matchers/life-draw-mill.ts

// matchCreateTokenEqualTo, matchCreateTokenForEach — moved to ./matchers/tokens.ts

// matchExileFromLibraryTop — moved to ./matchers/search-dig.ts
export const SEARCH_PHRASE_STOPWORDS = new Set([
  'a', 'an', 'the', 'that', 'this', 'it', 'them', 'your', 'their', 'his', 'her',
  'with', 'named', 'then', 'put', 'reveal', 'shuffle', 'into', 'onto', 'from',
  'up', 'to', 'x', 'of', 'number', 'any', 'each', 'target', 'another', 'other',
  'token', 'colorless', 'multicolored', 'monocolored', 'and',
]);

// parseSearchFilterNounPhrase, matchSearchLibraryGeneric, matchSearchThisWayShuffleTail — moved to ./matchers/search-dig.ts
// matchSacrificeAsEffect — moved to ./matchers/players.ts
// matchEachPlayerEffect — moved to ./matchers/players.ts
// matchEachOpponentSacrifice — moved to ./matchers/players.ts
// matchSacrificeSelfUnlessTargetOpponentSacrifices — moved to ./matchers/players.ts
// matchTargetPlayerSacrifice — moved to ./matchers/players.ts
// matchGainControl — moved to ./matchers/players.ts

// matchReturnAllFromGraveyard — moved to ./matchers/mass-effects.ts
// matchReturnAllToHand — moved to ./matchers/mass-effects.ts
// matchExileAll — moved to ./matchers/mass-effects.ts
// BASIC_LAND_PLURALS — moved to ./matchers/mass-effects.ts (exported)
// matchDestroyAllColorCreatures — moved to ./matchers/mass-effects.ts
// matchDestroyAllLandSubtype — moved to ./matchers/mass-effects.ts
// matchExileAllColorCreatures — moved to ./matchers/mass-effects.ts
// matchDestroyAllExpanded — moved to ./matchers/mass-effects.ts

// matchDealDamageForEach moved to matchers/damage.ts
// matchDealDamageGreatestManaValue moved to matchers/damage.ts

// ============================================================================
// Phase 16: Blink/flicker, copy, keyword granting, phasing patterns
// ============================================================================

/**
 * Known keywords for "target creature gains [keyword] until end of turn"
 */
export const GRANTABLE_KEYWORDS: Record<string, string> = {
  'hexproof': 'Hexproof',
  'indestructible': 'Indestructible',
  'flying': 'Flying',
  'trample': 'Trample',
  'lifelink': 'Lifelink',
  'deathtouch': 'Deathtouch',
  'vigilance': 'Vigilance',
  'reach': 'Reach',
  'menace': 'Menace',
  'haste': 'Haste',
  'defender': 'Defender',
  'shroud': 'Shroud',
  'flash': 'Flash',
  'double strike': 'Double Strike',
  'first strike': 'First Strike',
  // Slice 8/11: wither added for BlocksOrBlockedBy trigger bodies (Witherscale Wurm).
  // Wither is stored in grantedKeywords; the engine currently models keyword presence
  // (CBC keyword cache) even though the damage-as-counters rule is not yet enforced
  // in combat resolution. This is consistent with how the keyword line "Wither" is
  // absorbed as a known keyword (CBC_ALLOWED_KEYWORDS includes 'wither').
  'wither': 'Wither',
  // Slice 6 (activated keyword grants): evasion keywords enforced by getEvasionKeywords
  // in keywords.ts (reads grantedKeywords). Dauthi Trapper / Fear Merchant / Dauthi Ghoul
  // families: "{cost}: Target creature gains shadow/fear/intimidate until end of turn."
  // Only these three added here; all are in EVASION_KEYWORDS and checked via
  // grantedKeywords → getEvasionKeywords → canBlock enforcement.
  'shadow': 'Shadow',
  'fear': 'Fear',
  'intimidate': 'Intimidate',
};

export function readGrantableKeyword(tokens: string[], index: number): { keyword: string; consumed: number } | null {
  const twoWordKey = tokens[index] + ' ' + tokens[index + 1];
  if (GRANTABLE_KEYWORDS[twoWordKey]) {
    return { keyword: GRANTABLE_KEYWORDS[twoWordKey], consumed: 2 };
  }
  if (GRANTABLE_KEYWORDS[tokens[index]]) {
    return { keyword: GRANTABLE_KEYWORDS[tokens[index]], consumed: 1 };
  }
  return null;
}

// matchModifyPTAndLoseKeyword — moved to ./matchers/pump-grants.ts

/**
 * Match: "exile target creature, then return it to the battlefield under its owner's control"
 * Match: "exile target creature you control, then return it to the battlefield"
 * Match: "exile target permanent, return it to the battlefield at the beginning of the next end step"
 * Match: "exile target creature. return it to the battlefield under its owner's control"
 */
// matchBlink — moved to ./matchers/zones.ts

// matchCopySpell — moved to ./matchers/pump-grants.ts
// matchCopyThatSpell — moved to ./matchers/pump-grants.ts
// matchCopyCreature — moved to ./matchers/pump-grants.ts
// matchAttachItToTarget — moved to ./matchers/pump-grants.ts
// matchGrantKeywordAll — moved to ./matchers/pump-grants.ts
// matchGrantKeyword — moved to ./matchers/pump-grants.ts
// matchTargetCombatRestriction — moved to ./matchers/pump-grants.ts
// matchGrantKeywordAndDynamicPT — moved to ./matchers/pump-grants.ts
// matchLeadingDurationPumpGrant — moved to ./matchers/pump-grants.ts

// matchPhaseOut, matchPreventGameOutcome, matchWinGame, matchAddMana, matchLoseGame
// — moved to ./matchers/keyword-actions.ts

// ============================================================================
// Phase 15: Static ability and conditional effect pattern matchers
// ============================================================================

export function parseStaticFilterType(word: string): CardFilter | null {
  const colorMap: Record<string, 'W' | 'U' | 'B' | 'R' | 'G'> = {
    white: 'W',
    blue: 'U',
    black: 'B',
    red: 'R',
    green: 'G',
  };
  // Map of plural → singular for creature subtypes
  const subtypeMap: Record<string, string> = {
    'elf': 'elf', 'elves': 'elf',
    'goblin': 'goblin', 'goblins': 'goblin',
    'zombie': 'zombie', 'zombies': 'zombie',
    'dragon': 'dragon', 'dragons': 'dragon',
    'angel': 'angel', 'angels': 'angel',
    'demon': 'demon', 'demons': 'demon',
    'merfolk': 'merfolk',
    'soldier': 'soldier', 'soldiers': 'soldier',
    'wizard': 'wizard', 'wizards': 'wizard',
    'knight': 'knight', 'knights': 'knight',
    'warrior': 'warrior', 'warriors': 'warrior',
    'cleric': 'cleric', 'clerics': 'cleric',
    'rogue': 'rogue', 'rogues': 'rogue',
    'shaman': 'shaman', 'shamans': 'shaman',
    'beast': 'beast', 'beasts': 'beast',
    'elemental': 'elemental', 'elementals': 'elemental',
    'vampire': 'vampire', 'vampires': 'vampire',
    'sliver': 'sliver', 'slivers': 'sliver',
    'human': 'human', 'humans': 'human',
    'spirit': 'spirit', 'spirits': 'spirit',
    'bird': 'bird', 'birds': 'bird',
    'cat': 'cat', 'cats': 'cat',
    'dinosaur': 'dinosaur', 'dinosaurs': 'dinosaur',
    'pirate': 'pirate', 'pirates': 'pirate',
    'dwarf': 'dwarf', 'dwarves': 'dwarf',
    'wolf': 'wolf', 'wolves': 'wolf',
    // Slice 6: Wall subtype needed for "as long as you control a Wall" conditions
    'wall': 'wall', 'walls': 'wall',
    // Slice 4: Additional creature subtypes for "for each other <subtype> you control" ETB counters
    'ooze': 'ooze', 'oozes': 'ooze',
    'hydra': 'hydra', 'hydras': 'hydra',
    'snake': 'snake', 'snakes': 'snake',
    'faerie': 'faerie', 'faeries': 'faerie',
    'troll': 'troll', 'trolls': 'troll',
    'horror': 'horror', 'horrors': 'horror',
    'giant': 'giant', 'giants': 'giant',
    'sphinx': 'sphinx', 'sphinxes': 'sphinx',
    'drake': 'drake', 'drakes': 'drake',
    'bear': 'bear', 'bears': 'bear',
    'monk': 'monk', 'monks': 'monk',
    'noble': 'noble', 'nobles': 'noble',
    'scout': 'scout', 'scouts': 'scout',
    'ranger': 'ranger', 'rangers': 'ranger',
    'advisor': 'advisor', 'advisors': 'advisor',
    'phyrexian': 'phyrexian', 'phyrexians': 'phyrexian',
    'fish': 'fish', 'fishes': 'fish',
    'insect': 'insect', 'insects': 'insect',
    'plant': 'plant', 'plants': 'plant',
    'fungus': 'fungus', 'fungi': 'fungus',
    'rat': 'rat', 'rats': 'rat',
    // Slice 1 (tribal-anthem expansion): additional creature subtypes for typed anthems
    'kobold': 'kobold', 'kobolds': 'kobold',
    'turtle': 'turtle', 'turtles': 'turtle',
    'detective': 'detective', 'detectives': 'detective',
    'villain': 'villain', 'villains': 'villain',
    'minotaur': 'minotaur', 'minotaurs': 'minotaur',
    'pegasus': 'pegasus',
    'spawn': 'spawn', 'spawns': 'spawn',
    'scion': 'scion', 'scions': 'scion',
    'eldrazi': 'eldrazi',
    'rebel': 'rebel', 'rebels': 'rebel',
    'mercenary': 'mercenary', 'mercenaries': 'mercenary',
    'kithkin': 'kithkin', 'kithkins': 'kithkin',
    'ally': 'ally', 'allies': 'ally',
    'shapeshifter': 'shapeshifter', 'shapeshifters': 'shapeshifter',
    'avatar': 'avatar', 'avatars': 'avatar',
    'kor': 'kor',
  };
  const creatureSubtypes = Object.keys(subtypeMap);
  const singular = subtypeMap[word] || word.replace(/s$/, '');
  if (word === 'creatures' || word === 'creature') return { types: ['creature'] };
  if (word === 'artifacts' || word === 'artifact') return { types: ['artifact'] };
  if (word === 'enchantments' || word === 'enchantment') return { types: ['enchantment'] };
  if (word === 'instants' || word === 'instant') return { types: ['instant'] };
  if (word === 'sorceries' || word === 'sorcery') return { types: ['sorcery'] };
  if (word === 'lands' || word === 'land') return { types: ['land'] };
  // Slice 9: basic land subtype plurals/singulars for "the number of Forests/Mountains/..."
  if (word === 'forest' || word === 'forests') return { types: ['land'], subtypes: ['Forest'] };
  if (word === 'island' || word === 'islands') return { types: ['land'], subtypes: ['Island'] };
  if (word === 'swamp' || word === 'swamps') return { types: ['land'], subtypes: ['Swamp'] };
  if (word === 'mountain' || word === 'mountains') return { types: ['land'], subtypes: ['Mountain'] };
  if (word === 'plains') return { types: ['land'], subtypes: ['Plains'] };
  if (word === 'planeswalkers' || word === 'planeswalker') return { types: ['planeswalker'] };
  if (word === 'battles' || word === 'battle') return { types: ['battle'] };
  if (word === 'permanents' || word === 'permanent') return { permanent: true };
  if (word === 'spells' || word === 'spell') return {};
  if (word === 'noncreature' || word === 'noncreatures') return { excludeTypes: ['creature'] };
  if (word === 'nonartifact' || word === 'nonartifacts') return { excludeTypes: ['artifact'] };
  if (word === 'nonland' || word === 'nonlands') return { excludeTypes: ['land'] };
  // Slice 1: negated-color words for "nonwhite", "nonblue", etc.
  // Used by "no nonartifact, nonwhite creatures" (Angelic Voices) condition parsing.
  if (word === 'nonwhite') return { excludeColors: ['W'] };
  if (word === 'nonblue') return { excludeColors: ['U'] };
  if (word === 'nonblack') return { excludeColors: ['B'] };
  if (word === 'nonred') return { excludeColors: ['R'] };
  if (word === 'nongreen') return { excludeColors: ['G'] };
  if (word === 'legendary') return { supertypes: ['Legendary'] };
  if (word === 'basic') return { supertypes: ['Basic'] };
  if (word === 'snow') return { supertypes: ['Snow'] };
  if (word === 'multicolored') return { multicolored: true };
  if (colorMap[word]) return { colors: [colorMap[word]] };
  if (creatureSubtypes.includes(word)) return { types: ['creature'], subtypes: [singular] };
  return null;
}

export function parseManaValueFilterSuffix(
  tokens: string[],
  startIndex: number,
): { filter: Pick<CardFilter, 'cmc'>; nextIndex: number } | null {
  let idx = startIndex;
  if (tokens[idx] === 'with') idx++;
  if (tokens[idx] !== 'mana' || tokens[idx + 1] !== 'value') return null;
  idx += 2;

  const readValue = (token: string | undefined): number => {
    if (!token) return Number.NaN;
    return parseSmallNumberToken(token);
  };

  if (tokens[idx] === 'equal' && tokens[idx + 1] === 'to') {
    const value = readValue(tokens[idx + 2]);
    if (Number.isNaN(value)) return null;
    return { filter: { cmc: { op: 'eq', value } }, nextIndex: idx + 3 };
  }

  if (tokens[idx] === 'less' && tokens[idx + 1] === 'than') {
    let valueIndex = idx + 2;
    let inclusive = false;
    if (tokens[valueIndex] === 'or' && tokens[valueIndex + 1] === 'equal' && tokens[valueIndex + 2] === 'to') {
      inclusive = true;
      valueIndex += 3;
    }
    const value = readValue(tokens[valueIndex]);
    if (Number.isNaN(value)) return null;
    return {
      filter: { cmc: { op: 'lte', value: inclusive ? value : Math.max(0, value - 1) } },
      nextIndex: valueIndex + 1,
    };
  }

  if (tokens[idx] === 'greater' && tokens[idx + 1] === 'than') {
    let valueIndex = idx + 2;
    let inclusive = false;
    if (tokens[valueIndex] === 'or' && tokens[valueIndex + 1] === 'equal' && tokens[valueIndex + 2] === 'to') {
      inclusive = true;
      valueIndex += 3;
    }
    const value = readValue(tokens[valueIndex]);
    if (Number.isNaN(value)) return null;
    return {
      filter: { cmc: { op: 'gte', value: inclusive ? value : value + 1 } },
      nextIndex: valueIndex + 1,
    };
  }

  const value = readValue(tokens[idx]);
  if (Number.isNaN(value)) return null;
  idx++;
  if (tokens[idx] === 'or' && tokens[idx + 1] === 'less') {
    return { filter: { cmc: { op: 'lte', value } }, nextIndex: idx + 2 };
  }
  if (tokens[idx] === 'or' && tokens[idx + 1] === 'greater') {
    return { filter: { cmc: { op: 'gte', value } }, nextIndex: idx + 2 };
  }
  return { filter: { cmc: { op: 'eq', value } }, nextIndex: idx };
}

/**
 * "with mana value X or less" (Green Sun's Zenith). Emits cmc
 * {op:'lte', value:0, x:true}; the SearchLibrary executor substitutes the
 * cast-time X for `value` before filtering, so the search runs honestly
 * (an unresolved X falls back to 0, the wording's floor). Kept separate from
 * parseManaValueFilterSuffix so target-constraint callers (which have no X
 * substitution at check time) never see the x flag.
 */
export function parseManaValueXSuffix(
  tokens: string[],
  startIndex: number,
): { filter: Pick<CardFilter, 'cmc'>; nextIndex: number } | null {
  let idx = startIndex;
  if (tokens[idx] === 'with') idx++;
  if (tokens[idx] !== 'mana' || tokens[idx + 1] !== 'value') return null;
  idx += 2;
  if (tokens[idx] !== 'x') return null;
  if (tokens[idx + 1] === 'or' && tokens[idx + 2] === 'less') {
    return { filter: { cmc: { op: 'lte', value: 0, x: true } }, nextIndex: idx + 3 };
  }
  return null;
}

export function applyManaValueTargetConstraint(
  tokens: string[],
  startIndex: number,
  constraints: TargetSpec['constraints'],
): { constraints: TargetSpec['constraints']; nextIndex: number } | null {
  const parsed = parseManaValueFilterSuffix(tokens, startIndex);
  if (!parsed?.filter.cmc) return null;
  return {
    constraints: {
      ...(constraints || {}),
      cmc: parsed.filter.cmc,
    },
    nextIndex: parsed.nextIndex,
  };
}

export function mergeStaticFilters(a: CardFilter, b: CardFilter): CardFilter {
  const merge = <T,>(left?: T[], right?: T[]): T[] | undefined => {
    const values = [...(left || []), ...(right || [])];
    return values.length > 0 ? [...new Set(values)] : undefined;
  };
  return {
    types: merge(a.types, b.types),
    subtypes: merge(a.subtypes, b.subtypes),
    excludeSubtypes: merge(a.excludeSubtypes, b.excludeSubtypes),
    excludeTypes: merge(a.excludeTypes, b.excludeTypes),
    supertypes: merge(a.supertypes, b.supertypes),
    // Slice 12: excludeSupertypes (nonlegendary tutor filter) was missing — added.
    excludeSupertypes: merge(a.excludeSupertypes, b.excludeSupertypes),
    colors: merge(a.colors, b.colors),
    excludeColors: merge(a.excludeColors, b.excludeColors),
    multicolored: a.multicolored || b.multicolored || undefined,
    cmc: b.cmc || a.cmc,
    power: b.power || a.power,
    permanent: a.permanent || b.permanent || undefined,
    manaValueLessThanSourcePower: a.manaValueLessThanSourcePower || b.manaValueLessThanSourcePower || undefined,
    chosenCreatureTypeFromSource: a.chosenCreatureTypeFromSource || b.chosenCreatureTypeFromSource || undefined,
    chosenCreatureTypeFromCastTime: a.chosenCreatureTypeFromCastTime || b.chosenCreatureTypeFromCastTime || undefined,
    chosenColorFromSource: a.chosenColorFromSource || b.chosenColorFromSource || undefined,
  };
}

// parseStaticSubject — moved to ./matchers/static-abilities.ts
// staticKeywordModifier — moved to ./matchers/static-abilities.ts
// readStaticCombatRestrictions — moved to ./matchers/static-abilities.ts
// hasAsLongAsBeforeSentenceEnd — moved to ./matchers/static-abilities.ts
// matchStaticAbility — moved to ./matchers/static-abilities.ts
// matchConditionalStaticAbility — moved to ./matchers/static-abilities.ts

function matchConditionalEffect(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 6) return null;

  if (slice[0] === 'if' && slice[1] === 'you' && slice[2] === 'control' && slice[3] === 'a') {
    let idx = 4;
    const typeWord = slice[idx];
    if (!typeWord) return null;
    let filter = parseStaticFilterType(typeWord);
    if (!filter) { filter = { types: ['creature'], subtypes: [typeWord.replace(/s$/, '')] }; }
    idx++;
    if (slice[idx] === ',') idx++;
    const effectResult = parseEffectClauseInternal(tokens, startIndex + idx);
    if (!effectResult) return null;
    const condEffect: ConditionalEffect = { kind: 'Conditional', condition: { kind: 'ControlsType', controller: 'you', filter }, effect: effectResult.effects[0] };
    return { effects: [condEffect], targets: effectResult.targets, consumed: idx + effectResult.consumed };
  }

  if (slice[0] === 'if' && slice[1] === 'an' && slice[2] === 'opponent' && slice[3] === 'controls' && slice[4] === 'more') {
    let idx = 5;
    const typeWord = slice[idx];
    if (!typeWord) return null;
    const filter = parseStaticFilterType(typeWord);
    if (!filter) return null;
    idx++;
    if (slice[idx] !== 'than' || slice[idx + 1] !== 'you') return null;
    idx += 2;
    if (slice[idx] === ',') idx++;
    const effectResult = parseEffectClauseInternal(tokens, startIndex + idx);
    if (!effectResult) return null;
    const condEffect: ConditionalEffect = { kind: 'Conditional', condition: { kind: 'ControlsMoreThan', who: 'opponent', what: filter, thanWho: 'you' }, effect: effectResult.effects[0] };
    return { effects: [condEffect], targets: effectResult.targets, consumed: idx + effectResult.consumed };
  }

  // Slice 12: "if that player has more cards in hand than you, <effect>"
  // Anvil of Bogardan family — EventPlayer's hand size > controller's hand size.
  if (
    slice[0] === 'if' && slice[1] === 'that' && slice[2] === 'player' &&
    slice[3] === 'has' && slice[4] === 'more' && slice[5] === 'cards' &&
    slice[6] === 'in' && slice[7] === 'hand' && slice[8] === 'than' && slice[9] === 'you'
  ) {
    let idx = 10;
    if (slice[idx] === ',') idx++;
    const effectResult = parseEffectClauseInternal(tokens, startIndex + idx);
    if (!effectResult) return null;
    const condEffect: ConditionalEffect = {
      kind: 'Conditional',
      condition: { kind: 'EventPlayerHasMoreCardsInHand' },
      effect: effectResult.effects[0],
    };
    return { effects: [condEffect], targets: effectResult.targets, consumed: idx + effectResult.consumed };
  }

  // Slice 2 (werewolf day->night): "if no spells were cast last turn, transform this creature."
  // Matches: "if" "no" "spells" "were" "cast" "last" "turn" "," <effect>
  if (
    slice[0] === 'if' && slice[1] === 'no' && slice[2] === 'spells' &&
    slice[3] === 'were' && slice[4] === 'cast' && slice[5] === 'last' && slice[6] === 'turn'
  ) {
    let idx = 7;
    if (slice[idx] === ',') idx++;
    const effectResult = parseEffectClauseInternal(tokens, startIndex + idx);
    if (!effectResult) return null;
    const condEffect: ConditionalEffect = {
      kind: 'Conditional',
      condition: { kind: 'NoSpellsLastTurn' },
      effect: effectResult.effects[0],
    };
    return { effects: [condEffect], targets: effectResult.targets, consumed: idx + effectResult.consumed };
  }

  // Slice 2 (werewolf night->day): "if a player cast two or more spells last turn, transform this creature."
  // Matches: "if" "a" "player" "cast" "two" "or" "more" "spells" "last" "turn" "," <effect>
  if (
    slice[0] === 'if' && slice[1] === 'a' && slice[2] === 'player' &&
    slice[3] === 'cast' && slice[4] === 'two' && slice[5] === 'or' &&
    slice[6] === 'more' && slice[7] === 'spells' && slice[8] === 'last' && slice[9] === 'turn'
  ) {
    let idx = 10;
    if (slice[idx] === ',') idx++;
    const effectResult = parseEffectClauseInternal(tokens, startIndex + idx);
    if (!effectResult) return null;
    const condEffect: ConditionalEffect = {
      kind: 'Conditional',
      condition: { kind: 'AnyPlayerTwoOrMoreSpellsLastTurn' },
      effect: effectResult.effects[0],
    };
    return { effects: [condEffect], targets: effectResult.targets, consumed: idx + effectResult.consumed };
  }

  // Slice 5 (Transform): "if you control N or more <type>s, <effect>"
  // e.g. "if you control four or more creatures, transform ~"
  // Matches the CardsInZoneAtLeast condition with a numeric threshold.
  if (slice[0] === 'if' && slice[1] === 'you' && slice[2] === 'control') {
    let idx = 3;
    // Parse the count token: digit or word number ("four", "three", etc.)
    const countToken = slice[idx];
    if (!countToken) return null;
    const countNum = !isNaN(parseInt(countToken, 10))
      ? parseInt(countToken, 10)
      : parseWordNumber(countToken);
    if (isNaN(countNum) || countNum <= 1) return null; // "a" → use existing ControlsType branch
    idx++;
    // Expect "or"
    if (slice[idx] !== 'or') return null;
    idx++;
    // Expect "more" or "fewer" — only "or more" supported here.
    if (slice[idx] !== 'more') return null;
    idx++;
    // Expect a type word: "creatures", "lands", "artifacts", etc.
    const typeToken = slice[idx];
    if (!typeToken) return null;
    const filterType = parseStaticFilterType(typeToken);
    if (!filterType) return null;
    idx++;
    if (slice[idx] === ',') idx++;
    const effectResult = parseEffectClauseInternal(tokens, startIndex + idx);
    if (!effectResult) return null;
    const condEffect: ConditionalEffect = {
      kind: 'Conditional',
      condition: { kind: 'CardsInZoneAtLeast', controller: 'you', zone: 'battlefield', count: countNum, filter: filterType },
      effect: effectResult.effects[0],
    };
    return { effects: [condEffect], targets: effectResult.targets, consumed: idx + effectResult.consumed };
  }

  return null;
}

/**
 * Shared helper: parse the quoted dies-trigger body from an already-extracted
 * inner token stream (the part AFTER the "when this creature dies ," prefix).
 *
 * Accepted bodies:
 *   A) "return it to the battlefield [tapped] [under its owner's/your control]"
 *      → ReturnFromGraveyard { target: Source, destination: 'battlefield', tapped? }
 *   B) "return it to its owner's hand"
 *      → ReturnFromGraveyard { target: Source, destination: 'hand' }
 *   C) Any form parseEffectClauseInternal resolves to AddCounters.
 *
 * Returns the Effect[] on success, or null if body is not executor-backed.
 */
function parseQuotedDiesBody(bodyTokens: string[]): Effect[] | null {
  if (bodyTokens.length === 0) return null;

  if (bodyTokens[0] === 'return' && bodyTokens[1] === 'it' && bodyTokens[2] === 'to') {
    // Form A: "return it to the battlefield [tapped] [under its owner's/your control]"
    if (bodyTokens[3] === 'the' && bodyTokens[4] === 'battlefield') {
      // Check for optional "tapped" keyword immediately after "battlefield".
      const hasTapped = bodyTokens[5] === 'tapped';
      return [{
        kind: 'ReturnFromGraveyard',
        target: { kind: 'Source' },
        destination: 'battlefield',
        ...(hasTapped ? { tapped: true } : {}),
      }];
    }
    // Form B: "return it to its owner's hand"
    if (bodyTokens[3] === 'its') {
      const handIdx = bodyTokens.indexOf('hand', 4);
      if (handIdx !== -1) {
        return [{
          kind: 'ReturnFromGraveyard',
          target: { kind: 'Source' },
          destination: 'hand',
        }];
      }
    }
  }

  // Fall back to general parser for other accepted forms (AddCounters etc.).
  // Honesty gate: only accept AddCounters from the general parser.
  // ReturnFromGraveyard forms are handled inline above to avoid polluting
  // matchReturnFromGraveyard with "return it to ..." which would match
  // standalone "Return it to its owner's hand." spells incorrectly.
  const bodyResult = parseEffectClauseInternal(bodyTokens, 0);
  if (!bodyResult || bodyResult.effects.length === 0) return null;
  const acceptedBodyKinds = new Set(['AddCounters']);
  const allAccepted = bodyResult.effects.every(e => acceptedBodyKinds.has(e.kind));
  if (!allAccepted) return null;
  return bodyResult.effects;
}

/**
 * Shared helper: given a token slice whose first token is the `"when` / `"whenever`
 * quoted-ability opener, extract inner tokens and closing-quote index.
 * Returns { innerTokens, closingQuoteIdx } or null if malformed.
 */
function extractQuotedDiesTrigger(
  slice: string[],
  quotedStartIdx: number,
): { innerTokens: string[]; closingQuoteIdx: number } | null {
  const firstQuotedToken = slice[quotedStartIdx];
  if (!firstQuotedToken) return null;
  const innerFirst = firstQuotedToken.startsWith('"') ? firstQuotedToken.slice(1) : null;
  if (innerFirst !== 'when' && innerFirst !== 'whenever') return null;

  const innerTokens: string[] = [innerFirst];
  let closingQuoteIdx = -1;
  for (let i = quotedStartIdx + 1; i < slice.length; i++) {
    if (slice[i] === '"') { closingQuoteIdx = i; break; }
    innerTokens.push(slice[i]);
  }
  if (closingQuoteIdx === -1) return null;
  return { innerTokens, closingQuoteIdx };
}

/**
 * Slice 9 (pump + grant-quoted-dies-ability):
 * Match: "target creature gets +N/+N and gains \"When this creature dies, <effect>\"."
 *        "target creature gets +N/+0 and gains \"When this creature dies, <effect>\"."
 *
 * Slice 6 extension: also handles the leading-duration form:
 *        "Until end of turn, target creature [you control] gets +N/+N and gains \"...\""
 *
 * Demonic Gifts / Supernatural Stamina / Galuf's Final Act family.
 *
 * The tokenizer attaches the leading `"` to the first word of the quoted clause
 * (producing `"when`), and the trailing `"` is a standalone token at the end.
 * We detect this shape, strip the leading quote, re-assemble the inner token stream
 * `[when, this, creature, dies, , <body>, .]`, validate it with matchDiesPrefix,
 * then parse the body with parseQuotedDiesBody. Only ReturnFromGraveyard (including
 * the tapped variant) and AddCounters are executor-backed for the inner body.
 *
 * Emits: [ModifyPT, GrantDiesTrigger]. The GrantDiesTrigger executor adds the
 * Dies trigger to battlefieldAbilities; state-based.ts fires it on death.
 */
function matchPumpGrantQuotedDiesTrigger(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 10) return null;

  // Handle optional leading "until end of turn ," prefix (Supernatural Stamina family).
  let prefixLen = 0;
  if (slice[0] === 'until' && slice[1] === 'end' && slice[2] === 'of'
      && slice[3] === 'turn' && slice[4] === ',') {
    prefixLen = 5;
  }

  // When called at non-zero startIndex from parseMultipleEffects, the leading
  // duration has already been handled (startIndex points past it). Only allow
  // this path when startIndex === 0 (top-level spell body) OR when there is no
  // leading-duration context (tokens[0] !== 'until').
  if (prefixLen === 0 && startIndex > 0 && tokens[0] === 'until') return null;

  const body = slice.slice(prefixLen);
  if (body[0] !== 'target' || body[1] !== 'creature') return null;

  // Optional "you control" / "an opponent controls"
  let idx = 2;
  const constraints: TargetSpec['constraints'] = {};
  if (body[idx] === 'you' && body[idx + 1] === 'control') {
    constraints.controllerControls = true;
    idx += 2;
  } else if (body[idx] === 'an' && body[idx + 1] === 'opponent' && body[idx + 2] === 'controls') {
    constraints.opponentControls = true;
    idx += 3;
  }

  if (body[idx] !== 'gets') return null;
  idx++;

  const ptMatch = body[idx]?.match(/^([+-]\d+)\/([+-]\d+)$/);
  if (!ptMatch) return null;
  const power = parseInt(ptMatch[1], 10);
  const toughness = parseInt(ptMatch[2], 10);
  idx++;

  if (body[idx] !== 'and' || (body[idx + 1] !== 'gains' && body[idx + 1] !== 'gain')) return null;
  idx += 2;

  const extracted = extractQuotedDiesTrigger(body, idx);
  if (!extracted) return null;
  const { innerTokens, closingQuoteIdx: localClosingIdx } = extracted;

  // Validate the dies prefix: "when this creature dies ,"
  const diesEndIdx = matchDiesPrefix(innerTokens);
  if (diesEndIdx < 0) return null;

  // Parse the body
  const bodyEffects = parseQuotedDiesBody(innerTokens.slice(diesEndIdx));
  if (!bodyEffects) return null;

  const spec = makeTargetSpec('Creature', Object.keys(constraints).length > 0 ? constraints : undefined);
  const targetRef = makeChosenRef(spec);

  const modifyPT: Effect = {
    kind: 'ModifyPT',
    target: targetRef,
    power,
    toughness,
    untilEndOfTurn: true,
  };

  // The ReturnFromGraveyard inner effect uses { kind: 'Source' } to refer to the
  // creature that just died (the granting target). The executor for GrantDiesTrigger
  // records the target's instanceId as the sourceInstanceId of the trigger, so
  // 'Source' in the trigger body correctly resolves to the creature that died.
  const grantDies: Effect = {
    kind: 'GrantDiesTrigger',
    target: targetRef,
    dieEffects: bodyEffects,
  };

  // consumed = prefix + body tokens up to and including the closing `"`
  const consumed = prefixLen + localClosingIdx + 1;
  let totalConsumed = consumed;
  if (slice[totalConsumed] === '.') totalConsumed++;

  return { effects: [modifyPT, grantDies], targets: [spec], consumed: totalConsumed };
}

/**
 * Slice 6 (grant-quoted-dies-ability without P/T pump):
 * Match: "target creature [you control] gains \"When this creature dies, <effect>\"."
 * Match: "Until end of turn, target creature [you control] gains \"When this creature dies, <effect>\"."
 *
 * Not Dead After All / Undying Evil family — no P/T modification, just the
 * quoted-dies-trigger grant. Executor-backed inner bodies are the same as the
 * pump variant: ReturnFromGraveyard (including "tapped" spelling) and AddCounters.
 *
 * Emits: [GrantDiesTrigger] (no ModifyPT).
 */
function matchGrantQuotedDiesTriggerNoPT(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 8) return null;

  // Handle optional leading "until end of turn ," prefix.
  let prefixLen = 0;
  if (slice[0] === 'until' && slice[1] === 'end' && slice[2] === 'of'
      && slice[3] === 'turn' && slice[4] === ',') {
    prefixLen = 5;
  }

  // When called at non-zero startIndex, guard against absorbing a partial
  // leading-duration form that should have been handled at startIndex === 0.
  if (prefixLen === 0 && startIndex > 0 && tokens[0] === 'until') return null;

  const body = slice.slice(prefixLen);
  if (body[0] !== 'target' || body[1] !== 'creature') return null;

  let idx = 2;
  const constraints: TargetSpec['constraints'] = {};
  if (body[idx] === 'you' && body[idx + 1] === 'control') {
    constraints.controllerControls = true;
    idx += 2;
  } else if (body[idx] === 'an' && body[idx + 1] === 'opponent' && body[idx + 2] === 'controls') {
    constraints.opponentControls = true;
    idx += 3;
  }

  // Must be "gains" (no "gets" before it — that's the pump variant).
  if (body[idx] !== 'gains' && body[idx] !== 'gain') return null;
  idx++;

  const extracted = extractQuotedDiesTrigger(body, idx);
  if (!extracted) return null;
  const { innerTokens, closingQuoteIdx: localClosingIdx } = extracted;

  const diesEndIdx = matchDiesPrefix(innerTokens);
  if (diesEndIdx < 0) return null;

  const bodyEffects = parseQuotedDiesBody(innerTokens.slice(diesEndIdx));
  if (!bodyEffects) return null;

  const spec = makeTargetSpec('Creature', Object.keys(constraints).length > 0 ? constraints : undefined);
  const targetRef = makeChosenRef(spec);

  const grantDies: Effect = {
    kind: 'GrantDiesTrigger',
    target: targetRef,
    dieEffects: bodyEffects,
  };

  const consumed = prefixLen + localClosingIdx + 1;
  let totalConsumed = consumed;
  if (slice[totalConsumed] === '.') totalConsumed++;

  return { effects: [grantDies], targets: [spec], consumed: totalConsumed };
}

function parseEffectClauseInternal(tokens: string[], startIndex: number): PatternResult {
  let actualStartIndex = startIndex;
  if (tokens[actualStartIndex] === 'you' && tokens[actualStartIndex + 1] === 'may') {
    actualStartIndex += 2;
  }

  const patterns = [
    matchOptionalPay,
    // Slice 8 (choose-type-return): "choose a creature type. return up to N creature cards
    // of the chosen type from your graveyard to your hand." (Haunting Voyage family).
    // Must come before matchChooseNTargetSpell (both start with "choose") — more specific
    // because it requires "a creature type" rather than "N target <type> ...".
    matchChosenTypeReturnFromGraveyard,
    // Slice 10/13: "choose N target creatures … them/those" spells (Run Away Together, Last Night Together, etc.)
    // Must come before matchRevealTopIfMatch / matchRevealHandChooseCard which also start with early pattern words.
    matchChooseNTargetSpell,
    matchRevealTopIfMatchWithElse,  // Slice 3: more specific — "if it's X, put in hand; if you don't, put on bottom" (Traveling Botanist)
    matchRevealTopIfMatch,
    matchPreventGameOutcome, matchWinGame, matchLoseGame, matchForEachAddMana, matchAddManaChosenColor, matchAddManaAnyColorDynamic, matchAddManaAnyColor, matchAddMana,
    // Slice 11: "that player adds {G}{G}{G}" (Shizuko) — EventPlayer mana
    matchThatPlayerAddsMana,
    // Slice 4: "that player adds one mana of any type that land produced" / "any color" — EventPlayer any-color mana
    matchThatPlayerAddsManaAnyType,
    // Slice 10: "your opponents can't cast spells this turn" (Silence family)
    matchOpponentsCantCastSpells,
    // Slice 6: "Until your next turn, spells your opponents cast cost {N} more." (Tax Collector family)
    matchUntilYourNextTurnOpponentSpellCostIncrease,
    matchAttachItToTarget,
    matchEnterAsCopy,
    matchBlink, matchCopyThatSpell, matchCopySpell, matchCopySelfCreature, matchCreateTokenCopy, matchCopyCreature,
    // Slice 7 (becomes-copy): "target/each creature becomes a copy of ... until end of turn"
    // Must come before matchSetBasePT (more specific pattern).
    matchBecomesCopy,
    // Slice 4 (activated type-change): "this creature becomes a [Subtype] until end of turn"
    // (Amoeba Spy family). Must come after matchBecomesCopy (more specific) and before
    // matchGrantKeyword so the "becomes" verb is not swallowed by a less-specific matcher.
    matchBecomeCreatureTypeSelf,
    // Slice 12: "target creature loses <keyword(s)> until end of turn" (Canopy Claws family).
    // Must come BEFORE matchModifyPTAndLoseKeyword (which adds a PT-modifier rider).
    matchTargetCreatureLosesKeyword,
    matchModifyPTAndLoseKeyword, matchGrantKeywordAndDynamicPT,
    // Slice 7 (transient polymorph): "Until end of turn, target creature loses all abilities
    // and becomes a <color> <type> with base power and toughness X/Y [and gains <kw>]."
    // (Turn to Frog / Dance of the Skywise / Turn//Burn / Mordenkainen's Polymorph family).
    // Must come BEFORE matchLeadingDurationPumpGrant (both start with "until end of turn ,")
    // and before matchSetBasePT (more specific — requires "becomes" + "loses all abilities").
    matchTransientPolymorph,
    matchLeadingDurationPumpGrant, matchSetBasePT,
    // Slice 9 (switch P/T): "switch target creature's / its power and toughness until end of turn"
    // (Dwarven Thaumaturgist / Valakut Fireboar family). Must come before matchModifyPT.
    matchSwitchPowerToughness,
    matchMultiTargetCombatRestriction, matchTargetCombatRestriction, matchGrantKeywordAll, matchEnchantedCreatureGrantKeyword,
    // Slice 7: "permanents you control gain hexproof and indestructible until end of turn"
    // (Heroic Intervention family) — must come before matchGrantKeyword (more specific subject).
    matchMassPermanentGrant,
    // Slice 2: "other creatures/subtypes you control gain/get ... until end of turn" — must
    // come before matchGrantKeyword and matchModifyPT (more specific "other" subject).
    matchOtherCreaturesGrantKeyword, matchOtherCreaturesPump,
    // Slice 3: "attacking/blocking creatures [you control] get +N/+M [and gain <kw>] until end of turn"
    // (Army of Allah / Piety / Vampiric Fury family). Must come before matchGrantKeyword and
    // matchModifyPT (more specific combat-status / subtype subject).
    matchAttackingBlockingPump,
    // Slice 6: "choose a creature type. creatures you control of the chosen type get +N/+M [and gain <kw>] until end of turn"
    matchChosenTypePump,
    // Slice 11 (transient protection): "target creature [you control] gains protection from <color>
    // until end of turn" / "[<color>] creatures you control gain protection from <color> until end of turn".
    // Must come BEFORE matchGrantKeyword (more specific — 'protection from' is NOT in GRANTABLE_KEYWORDS).
    matchGrantProtection,
    matchGrantKeyword, matchPhaseOut,
    // Slice 10: "creatures you control get +N/+N and gain all creature types until end of turn"
    // Must come before matchModifyPT (more specific — includes "gain all creature types").
    matchPumpGrantAllCreatureTypes,
    // Slice 5 (Transform): "transform ~" — flip source to back face.
    matchTransformSelf,
    matchCanBlockAdditionalActivated,
    // Slice 6: "this creature can attack this turn as though it didn't have defender"
    matchAttackAsThoughNoDefender,
    // Slice 8: activated self-tails — must come before matchModifyPTWhereX (which also handles
    // Source targets) so the LifeTotal form is tried specifically before the ForEach form.
    matchSelfDynamicPumpLifeTotal,
    // Slice 8: "this creature can't be blocked this turn" — self-evasion activated tail.
    matchSelfCantBeBlockedActivated,
    // Slice 12 (en-Kor redirect): "the next N damage...is dealt to target creature instead"
    // Must come BEFORE matchPreventDamage (both start with "the next N damage" /
    // "prevent" but matchRedirectDamage requires "is dealt to...instead" which is distinct).
    matchRedirectDamage,
    // Slice 12 (Licid): "this creature loses this ability and becomes an Aura enchantment..."
    // Must come before matchBecomesCopy and other becomes matchers (more specific).
    matchLicidBecomeAura,
    matchPreventDamage, matchDealDamageGreatestManaValue, matchDealDamageForEach, matchForEachDraw, matchCreateTokenEqualTo, matchCreateTokenForEach,
    // Slice 11/12 (EachPlayer impulse): "exile the top card of each player's/opponent's library"
    // Must come before matchExileFromLibraryTop (single-player form) so the each-player form
    // is not mistaken for a partial prefix of the single-player form.
    matchExileTopOfEachLibrary,
    // Slice 6 (combat-damage trigger bodies): "exile the top X cards of their library,
    // where X is the amount of damage dealt" (Kotis, the Fangkeeper family).
    // Must come BEFORE matchThatPlayerExilesTopN (fixed N) and matchExileFromLibraryTop (your library).
    matchExileTopXDamageAmountTheirLibrary,
    matchThatPlayerExilesTopN, matchExileFromLibraryTop,
    // Slice 12: nonlegendary/hyphenated-subtype/dual-zone ETB tutor extensions — before matchSearchLibraryGeneric
    matchETBTutorFilterExtensions,
    matchSearchLibraryGeneric, matchSearchThisWayShuffleTail, matchSacrificeSelfUnlessTargetOpponentSacrifices, matchSacrificeSelfUnlessPay, matchEachOpponentSacrifice,
    // Slice 11: "each player loses half their life, rounded up" (Havoc Festival) — before matchEachPlayerEffect
    matchEachPlayerLosesHalfLife,
    matchEachPlayerEffect, matchTargetPlayerSacrifice, matchSacrificeAsEffect,
    matchGainControl,
    // Slice 11: "that player gains control of this enchantment" (Risky Move) — after matchGainControl (generic form)
    matchThatPlayerGainsControl,
    matchReturnAllFromGraveyard, matchReturnAllToHand,
    // Slice 6: "destroy all <Subtype> creatures" / "destroy all non-<Subtype> creatures" — before
    // matchDestroyAllColorCreatures so it tries specific-subtype first.
    matchDestroyAllSubtypeCreatures,
    // Slice 8: "exile all <Subtype>/<non-Subtype> creatures" — after destroy-subtype form.
    matchExileAllSubtypeCreatures,
    matchDestroyAllColorCreatures, matchDestroyAllLandSubtype, matchDestroyAllTappedCreatures, matchExileAllColorCreatures,
    // Slice 8: "destroy/exile all non<color> creatures" (Mass Calcify / Their Name Is Death).
    matchDestroyAllNoncolorCreatures,
    // Slice 8: "destroy/exile all token/nontoken creatures" (Hour of Reckoning / Perplexing Test).
    matchDestroyAllTokenFilter,
    // Slice 8: "return all creature tokens / nontoken creatures to their owners' hands" (Perplexing Test).
    matchReturnAllTokenFilter,
    // Slice 8: "destroy/exile all legendary/nonlegendary creatures" (Invasion of Fiora).
    matchDestroyAllLegendaryFilter,
    // Slice 8: "destroy all blocking/blocked/attacking creatures" (Fight to the Death).
    matchDestroyAllBlockingBlocked,
    matchExileAll, matchDestroyAllExpanded,
    matchTargetPlayerLoseLifeEqualToNumberOf,
    matchTargetPlayerLoseLife, matchTargetPlayerGainLifeX, matchTargetPlayerGainLife, matchEachPlayerGainLife, matchTargetPlayerDiscardAtRandom,
    // Slice 7: "deals X damage to that player, where X is N minus the number of cards in that player's hand"
    // (Wheel of Torture / Storm World / Rackling / Viseling family) — must precede matchDealDamageXWhereX.
    matchDealDamageXBaseMinusCount,
    matchEachOpponentLosesXLifeWhereX, matchDealDamageXWhereX, matchDrawXWhereX, matchMillXWhereX,
    matchGainLifeXWhereX, matchLoseLifeXWhereX, matchEntersWithCountersWhereX, matchEntersWithCountersForEach, matchEntersWithCountersEqualTo, matchAddCountersWhereX, matchModifyPTWhereX,
    matchDealXDamage, matchDrawX, matchEachOpponentLosesLife,
    // Slice 6: "each opponent reveals their hand and discards a [filter] card" — before matchEachOpponentDiscardsCard
    matchEachOpponentRevealsHandDiscardsFilter,
    matchEachOpponentDiscardsCard, matchDestroyAll, matchDistributeCounters, matchDealDamageDivided, matchDealDamageEqualToEventPlayerControls, matchDealDamageEqualTo, matchHaveItDealDamage,
    // Brion Stoutarm family: "~ deals damage equal to the sacrificed creature's power to target player [or planeswalker]"
    matchDealDamageSacrificedCreaturePower,
    // Slice 8: two independent fixed-N damage assignments to two differently-typed targets joined by "and"
    // (Burning Sun's Avatar / Rakdos Firewheeler family). Must come before matchDealDamage (which would
    // match only the first assignment) and after matchDealDamageDivided (more specific).
    matchDealDamageTwoTargets,
    // Slice 8: "it deals N damage to each of up to two targets" — each target takes N independently.
    // Must come before matchDealDamage (more specific: "each of up to N" vs single target).
    matchDealDamageEachUpToNTargets,
    matchDealDamage, matchExactMultiTarget, matchMultiTarget,
    // Slice 10: "destroy target Plains and target white creature" (Reign of Chaos) — paired typed destroy, before matchDestroy.
    matchDestroyPairedTypedTargets,
    matchDestroy,
    // Slice 4/CBC: "draw cards equal to the greatest toughness among creatures you control"
    // (Last March of the Ents sibling clause). Must come before matchDrawEqualToNumberOf
    // (more specific — uses "greatest toughness" rather than "number of").
    matchDrawEqualToGreatestToughness,
    matchDrawEqualToNumberOf, matchMillEqualToNumberOf, matchGainLifeEqualToNumberOf, matchLoseLifeEqualToNumberOf,
    matchRevealHandOptionalChooseCard, matchRevealHandAndTopOfLibraryChooseCard, matchRevealHandGainLife, matchRevealHandDiscardAll,
    // Slice 1: Two-sentence discardAll ("...reveals their hand. That player discards all nonland cards...") — before matchRevealHandChooseCard
    matchRevealHandDiscardAllTwoSentence,
    matchExileAllFromTargetHand, matchRevealHandDiscardAtRandomFiltered, matchRevealHandChooseCardWithLifeGainRider,
    // Slice 8/11: "...reveals their hand. you may cast an instant or sorcery spell...without paying its mana cost" — before matchRevealHandChooseCard (free-cast variant)
    matchCastFromRevealedHand,
    // Round 8: "you choose X cards from it. that opponent discards those cards." — before matchRevealHandChooseCard (single-card form)
    matchRevealHandDiscardXCards,
    // Slice 6: "choose a color" preamble + reveal-hand (Addle / Hint of Insanity) — before matchRevealHandChooseCard
    matchRevealHandChosenColorChooseCard,
    matchRevealHandChosenColorDiscardAll,
    // Slice 6: ETB exile-until-leaves plain-exile subset (Brain Maggot / Kitesail Freebooter) — before matchRevealHandChooseCard
    matchRevealHandChooseCardEtbExileUntil,
    // Slice 4: "target opponent/player reveals a card at random from their hand" (Planeswalker's Favor/Fury/Wand of Ith)
    // Must come before matchRevealHandChooseCard (which requires "reveals their hand") — more specific random-reveal form.
    // Slice 11: conditional-discard variant MUST come before matchRevealRandomCardFromHand (more specific — requires "if it's a <filter>").
    matchRevealRandomCardConditionalDiscard,
    matchRevealRandomCardFromHand,
    // Slice 4a: "target player reveals a number of cards from their hand equal to the number of X you control.
    // You choose one of them. That player discards that card." (Mire's Toll family).
    // Must come before matchRevealHandChooseCard (different head: "reveals a number of cards from their hand").
    matchTargetPlayerPartialRevealChooseCard,
    // Slice 9b: Two-pick form "...choose a [filter] card from it, then choose a [filter] card from their graveyard.
    // Exile the chosen cards." (Dreams of Steel and Oil full form). Must come BEFORE matchRevealHandChooseCard
    // (which would only parse the hand-pick half, missing the graveyard pick).
    matchRevealHandChooseCardAndGraveyardExile,
    // Slice 9b: Comma-then separator "...reveals their hand, then you choose a card [other than a basic land card]
    // from it." (Lobotomy family). Must come BEFORE matchRevealHandChooseCard (different separator).
    matchRevealHandCommaThenChooseCard,
    matchRevealHandChooseCard, matchLookAtHandThenChooseCard, matchLookAtTargetPlayerHand, matchRevealUntilMatchOtherPlayer, matchRevealUntilMatch, matchRevealUntilAllToGraveyard,
    // Slice 2: "put all <type> cards from among them onto the battlefield [tapped]" — before matchRevealTopAnyNumberOntoBattlefield (which handles "any number of")
    matchDigTopPutAllOntoBattlefield,
    // Slice 4: "reveal top X/N, put any number of <type> onto battlefield, rest graveyard" — before matchRevealTopOntoBattlefield (which handles "up to M" form)
    matchRevealTopAnyNumberOntoBattlefield,
    // Slice 8: "any number of land cards and/or legendary permanent cards onto battlefield" — before matchRevealTopOntoBattlefield (single-type form)
    matchLookAtTopAnyNumberMultiTypeOntoBattlefield,
    // Slice 8: "creature card with power N or greater onto battlefield" — before matchRevealTopOntoBattlefield (type-only form)
    matchLookAtTopPowerFilterOntoBattlefield,
    matchRevealTopOntoBattlefield, matchLookAtTopPutOneToBattlefield, matchLookAtTopGreatestPower, matchLookAtTopWhereXForEach, matchRevealTopPutRevealedToHand, matchRevealTopUpToMFilter,
    // Slice 4: multi-type "then put all" (Portent of Calamity) and "all typeA and typeB" (Lair Delve) — before matchRevealTopAllTypesAndAll (single sentence form)
    matchRevealTopMultiTypeThenBranch,
    matchRevealTopAllTypesAndAll,
    // Slice 6/12: "look/reveal top N. you may reveal up to K <type> and/or <type2> cards from among them, then/and put them into your hand. put the rest on bottom/graveyard."
    // — must come before matchRevealTopTakeExtended (different put-into-hand phrasing: "then put them" vs "put from among them")
    matchLookAtTopRevealUpToKFilterToHand,
    matchRevealTopTakeExtended, matchRevealTopSubtypeFilter,
    // Slice 3/13: "put all cards of the chosen type into your hand" — more specific than matchRevealTopTake
    matchRevealTopChosenType,
    // Slice 9: "reveal top N, separate into two piles, opponent chooses a pile"
    // (Steam Augury / Fact-or-Fiction family) — must come BEFORE matchRevealTopDistribute
    // (single-card form) because both start with "reveal the top N cards"; the two-pile
    // form requires "separate them into two piles" + "those piles" as distinguishing gates.
    matchRevealTopSplitTwoPiles,
    // Slice 9: "reveal top N, opponent chooses one, that to graveyard/hand, rest to hand/graveyard"
    // (Murmurs from Beyond family) — more specific than matchRevealTopTake (requires "an opponent chooses one")
    matchRevealTopDistribute,
    matchRevealTopTake, matchRevealTopIfMatchWithElse, matchLookAtTopPutNToGraveyard,
    // Slice 4: "put M of them on bottom, rest into hand" — before matchDigTopTakeRest (inverted take)
    matchLookAtTopPutMOnBottomRestToHand,
    matchDigTopTakeRest, matchDarkConfidantReveal,
    // Slice 6/12: "reveal the top N cards ... put one of them into your hand" (no explicit rest clause)
    // — must come after matchDigTopTakeRest (which handles the "with rest" form) and before matchRevealTopUnconditioned
    matchRevealTopPutOneNoRest,
    // Slice 3/13: unconditional "reveal top card and put it into your hand" — after Dark Confidant (life-loss form) which is more specific
    matchRevealTopUnconditioned,
    // Slice 6/12: "where X is twice the number of <filter> you control, put one into hand" — must come
    // before matchLookAtTopDynamicCountReorderBack (which also handles "where X is <dynamic>")
    matchLookAtTopTwiceNumberOfToHand,
    matchLookAtTopDynamicCountReorderBack,
    // Slice 9/12: "look at the top X cards ..., then put them back in any order" (Soothsaying bare-X form)
    // — must come after matchLookAtTopDynamicCountReorderBack (which handles "where X is <dynamic>") to
    // avoid that form being swallowed here. Must come before matchLookAtTopReorderBack (fixed-N form).
    matchLookAtTopXReorderBack,
    matchLookAtTopOneOnTopRestBottom, matchLookAtTopReorderBack,
    // Slice 6/12: "put those cards / them on the bottom in any order" (Lim-Dûl's Vault style) —
    // after matchLookAtTopReorderBack ("put them back in any order" → top) to avoid collision
    matchLookAtTopAllOnBottom,
    matchLookAtTopTargetExileOneRestBack, matchLookAtTopTargetMayMill, matchLookAtTopOfTargetLibrary,
    // Slice 4: "exile one face down, rest on bottom" — before matchLookAtTopExileOneFromAmong
    matchLookAtTopExileFaceDown,
    // Slice 4 (round-8 dig leftovers): "where X is this creature's power + exile" — more specific than fixed-count exile
    // Slice 2/12 (A): "where X is this creature's power + any number of <type> to hand" — before self-power-exile form
    matchLookAtTopSelfPowerAnyNumberToHand,
    matchLookAtTopWhereXSelfPowerExile,
    // Slice 3/12: "exile N of them at random, then put the rest on top of your library in any order."
    // (Orcish Librarian family) — must come BEFORE matchLookAtTopExileOneFromAmong (singular "exile a card" form)
    // because both start with "look at the top N cards"; the counted-random-exile form is more specific.
    matchLookAtTopExileNRestTop,
    matchLookAtTopExileOneFromAmong,
    // Slice 3/12: "you may exile a [filter] card from among them. put the rest into your hand."
    // — rest-to-hand variant not covered by matchLookAtTopExileOneFromAmong (which handles bottom/graveyard)
    matchLookAtTopExileFilterRestToHand,
    // Slice 2/12 (B): "look at top card, you may play a land from top this turn, if not land → graveyard" (Ziatora's Envoy)
    // — must come before matchLookAtTopPutItToGraveyard (graveyard dest) and matchLookAtTopCardMayExile (exile dest)
    matchLookAtTopCardPlayLandOrGraveyard,
    matchLookAtTopPutItToGraveyard,
    // Slice 4 (round-8 dig leftovers): "look at the top card. you may exile that card." (Puresight Merrow)
    // — must come after matchLookAtTopPutItToGraveyard (graveyard dest) to avoid collision
    matchLookAtTopCardMayExile,
    // Slice 12: "you may put one back on top. put the rest into your graveyard." (Sage of Days)
    // — graveyard-rest variant of matchLookAtTopOneOnTopRestBottom; placed after the bottom-rest form
    matchLookAtTopOneOnTopRestGraveyard,
    // Slice 2: "look at that many" must come before the fixed-N lookAtTop forms
    matchLookAtTopThatMany,
    // Slice 4: "put any number of them into your hand, rest on bottom" — unfiltered form
    matchLookAtTopAnyNumberToHand,
    // Slice 2/13: "put any number of them into your graveyard, rest on top" (Gutless Plunderer)
    matchLookAtTopAnyNumberToGraveyard,
    // Slice 2/13: "you may reveal a <filter> card from among them and put it into your hand" (Nessian Wanderer / Seismic Sense)
    // — must come before matchLookAtTopPutOneIntoHand (which handles SearchLibrary shape)
    matchLookAtTopRevealOneFilterToHand,
    matchLookAtTopPutOneIntoHand,
    // Slice 8/12: "that player may put an artifact, creature, or land card from their hand onto
    // the battlefield" (Braids, Conjurer Adept) — more specific than matchPutLandFromHandOntoBattlefield
    // (which handles only "put a land card from your hand") and must come before it.
    matchThatPlayerPutPermanentFromHandOntoBattlefield,
    matchPutLandFromHandOntoBattlefield,
    // Slice 8/12: "that player may pay <cost>. If they don't, <downside>" (Umbilicus family).
    // Must come BEFORE matchThatPlayerRevealHandCoercion and the plain "that player" matchers
    // because it matches the "that player may pay" head which is more specific.
    matchEachPlayerUnlessPay,
    // Slice 8/12: "that player reveals N cards [at random] from their hand. you choose one. that player discards that card."
    // — EventPlayer hand-reveal coercion (Hollow Specter family); before matchThatPlayerDiscard (more specific head).
    matchThatPlayerRevealHandCoercion,
    // Slice 2: "that player discards that many" before "that player discards N"
    matchThatPlayerDiscardsThatMany,
    // Slice 2: "that player mills that many" before "that player mills N"
    matchThatPlayerMillsThatManyCards,
    matchThatPlayerDiscard, matchThatPlayerDraw, matchTargetPlayerDraw, matchThatPlayerMill, matchThatPlayerUntapsLand,
    // Slice 7/12: "that player loses X life, where X is the number of <filter> they control / in their hand"
    // Must come BEFORE matchThatPlayerLosesLife (fixed-N form) since it's more specific.
    matchThatPlayerLosesLifeXWhereX,
    // Slice 8/12: "that player loses N life" — per-player-upkeep LoseLife tail (EventPlayer).
    // Placed after the "that player" draw/discard family and before matchDefendingPlayerEffect
    // so the "that player" pronoun wins over the "defending player" subject.
    matchThatPlayerLosesLife,
    // Slice 9/12: "that player exiles N cards from their graveyard" (Curse of Oblivion / Oath family)
    // — must come before matchExile (which requires a "target" keyword).
    matchThatPlayerExilesFromGraveyard,
    // Slice 8/12: "that player exiles a card at random from their hand" (Elkin Lair family).
    // Must come after matchThatPlayerExilesFromGraveyard (different zone) and before matchExile.
    matchThatPlayerExilesAtRandom,
    // Slice 9/12: "that player / target opponent puts a card from their hand on top of their library"
    // (Chittering Rats family) — before matchPutLandFromHandOntoBattlefield.
    matchThatPlayerPutsCardOnTopOfLibrary,
    // Slice 6: "defending player discards/mills/sacrifices/loses life" — attack trigger tails
    matchDefendingPlayerEffect,
    // Slice 2: "draw that many cards" before the generic matchDraw (which handles fixed counts)
    matchDrawThatManyCards,
    matchDraw,
    // Slice 5 + Slice 2 (EventDamageAmount family): "that much/that many" effect bodies —
    // must come before matchGainLife / matchDealDamage / matchLoseLife / matchMill so the
    // EventDamageAmount forms win over the generic fixed-N matchers.
    // Slice 9: matchDealDamageToEventCreatureController before matchDealsDamageThatMuchToCreatureController
    // (both target creature's controller, but fixed-N is more common and should be tried first).
    // Slice 2: matchTargetPlayerMillsThatManyCards + matchLoseLifeThatMuch before matchMill/matchLoseLife
    matchDealDamageToEventCreatureController, matchDealsDamageThatMuchToCreatureController,
    // Slice 3: "it deals that much damage to each creature that player controls" (Balefire Dragon)
    // — must come before matchDealsThatMuchDamageToTarget (which handles single targets)
    matchDealsThatMuchDamageToEachCreatureThatPlayerControls,
    matchDealsThatMuchDamageToTarget,
    matchEachPlayerGainsThatMuchLife, matchGainLifeThatMuch, matchLoseLifeThatMuch,
    matchTargetPlayerMillsThatManyCards,
    // Slice 2: "exile that many cards" before matchExileFromLibraryTop (which requires fixed N)
    matchExileThatManyFromTopOfLibrary,
    // Brion Stoutarm family: "you gain life equal to that/the sacrificed creature's power" — before matchGainLife
    matchGainLifeSacrificedCreaturePower,
    matchGainLife, matchLoseLife, matchExile, matchPutCreatureCardFromOpponentGraveyardOntoBattlefield, matchPutGraveyardCardIntoLibrary, matchPutIntoLibrary, matchReturnFromGraveyard, matchReturnThatCardToHand, matchReturnThatCardToBattlefield,
    // Slice 4/12: "that player returns each creature they control [with power > hand count]" (Noetic Scales).
    // Must come BEFORE matchThatPlayerReturnsCreature (single "a creature" form — less specific).
    matchThatPlayerReturnsMassBounce,
    matchThatPlayerReturnsCreature,
    // Slice 1: "return target <type> that player controls to its owner's hand" (Mistblade Shinobi family)
    // — must come before matchReturnUpToOneOtherTargetYouControlToHand and matchReturnToHand
    // so the "that player controls" phrase is consumed before the generic matchers try to parse.
    matchReturnThatPlayerControlsToHand,
    matchReturnUpToOneOtherTargetYouControlToHand, matchReturnPermanentYouControlToHand, matchReturnToHand, matchEachPlayerOrOpponentMill, matchMill, matchGainEnergy, matchAddCountersAttached, matchYouGetCounters,
    // Slice 10: "remove all counters from target creature" (Suncleanser) — more specific than matchRemoveCountersTarget.
    matchRemoveAllCountersFromTarget,
    matchRemoveCountersTarget, matchSupport,
    // Slice 9 (Fynn family): "that player gets N <type> counters" — EventPlayer target;
    // must come before matchAddCounters (which handles fixed-target forms).
    matchThatPlayerGetsCounters,
    // Slice 2: "they get that many <type> counters" — EventPlayer + EventDamageAmount;
    // combat-damage-to-player trigger tails (Infesting Radroach rad counters, etc.).
    // Must come before matchAddCountersThatMany (which requires "put...on it/~" form).
    matchTheyGetThatManyCounters,
    // Slice 2: "put that many counters" before the fixed-N matchAddCounters
    matchAddCountersThatMany,
    // Slice 4 (devotion): "put a number of <type> counters on it equal to your devotion to <color>" — before matchAddCounters.
    matchAddCountersEqualToDevotion,
    // Slice 12: "that player puts a <type> counter on target [non-<Subtype>] land they control"
    // (Quicksilver Fountain family) — more specific than matchAddCounters, before it.
    matchThatPlayerPutsCounterOnLandTheyControl,
    // Slice 9: "put its counters on [up to one] target creature" / "move a +1/+1 counter from this artifact onto target creature"
    // (Star Pupil / Host of the Hereafter / Weapon Rack family) — more specific than matchAddCounters.
    matchMoveCounters,
    // Slice 4: "remove x counters" where-X before fixed-count matchRemoveCounters
    matchRemoveCountersWhereX,
    // Slice 1: "put a <type> counter on target <subtype> for each <subtype> you control"
    // More specific than matchAddCounters (which handles fixed counts only), so placed before it.
    matchAddCountersForEach,
    matchAddCounters, matchRemoveCounters, matchModifyPTForEach, matchMassOpponentDebuff, matchMassKeywordHolderDebuff, matchHaveTargetGetPT, matchMultiTargetPumpGrant,
    // Slice 7: "that creature gets +N/+N until end of turn" — EventCreature target;
    // must come before matchModifyPT (which only handles Source/Chosen/AllCreatures targets).
    matchThatCreatureGetsPT,
    // Slice 8/11: "that creature gains <keyword> until end of turn" — EventCreature target;
    // must come before matchGrantKeyword (more specific "that creature" subject vs generic target).
    matchThatCreatureGainsKeyword,
    // Slice 8/11: "that creature can't be regenerated this turn" — CantBeRegenerated flag via GrantKeyword.
    // Must come before matchGrantKeyword (different subject form).
    matchThatCreatureCantBeRegenerated,
    // Slice 3: "target creature gets +X/+0 / +0/+X until end of turn" — asymmetric cast-time X pump
    // (Howl from Beyond family). Must come before matchModifyPT (which handles only fixed numeric
    // +N/+M values) and after matchModifyPTWhereX (which requires a "where X is ..." clause).
    matchModifyPTAsymmetricX,
    // Slice 4/CBC: "target creature gets -X/-X until end of turn" — negative X-scaled pump
    // (Slice from the Shadows family). Must come after matchModifyPTAsymmetricX (positive-X form)
    // and before matchModifyPT (fixed numeric form). The tokenizer splits "-x/-x" as
    // ["-", "x/", "-", "x"] so this form cannot be claimed by matchModifyPTAsymmetricX.
    matchModifyPTNegativeX,
    // Slice 9: "target creature gets +N/+N and gains \"When this creature dies, <effect>\""
    // (Demonic Gifts / Supernatural Stamina / Galuf's Final Act family).
    // Slice 6 extension: also handles leading-duration form and "tapped" variant.
    // Must come before matchModifyPT (more specific — includes quoted-gains clause).
    matchPumpGrantQuotedDiesTrigger,
    // Slice 6: "target creature [you control] gains \"When this creature dies, <effect>\""
    // (Not Dead After All / Undying Evil family — no P/T pump). Must come before
    // matchGrantKeyword (which doesn't handle quoted abilities) and after
    // matchPumpGrantQuotedDiesTrigger (which requires a P/T pump).
    matchGrantQuotedDiesTriggerNoPT,
    matchModifyPT, matchGoad,
    // Slice 7 (lure): "all creatures able to block target creature [this turn] do so"
    // Must come before matchGoad's handler and after more-specific combat patterns.
    matchLureSpell,
    matchRegenerate, matchRegenerateEnchantedCreature,
    // Slice 4: "tap/untap x target permanents" (Reality Spasm) before single-target matchTap/matchUntap
    matchTapXTargetPermanents, matchUntapXTargetPermanents,
    matchTap,
    matchUntapUpToOneTargetCreature, matchUntap,
    // Slice 8/12: "roll a dN. [you] create that many <tokens>" — before matchRollD20 (more specific)
    matchRollDNCreateThatManyTokens,
    matchRollD20,
    // Slice 2: "that player creates that many" before "that player creates a"
    matchThatPlayerCreatesThatManyTokens,
    matchThatPlayerCreatesToken, matchInvestigate, matchProliferate, matchExplore, matchBecomeMonarch, matchConnive, matchAmass, matchPopulate, matchAdapt, matchBolster, matchMonstrosity, matchFabricate,
    // Slice 2: "create that many" before generic matchCreateToken
    matchCreateTokenThatMany,
    matchCreateToken, matchDiscard, matchDiscardSelf, matchScry,
    matchSurveil, matchCounterSpell, matchGrantCantBeCountered, // Slice 11: "target spell can't be countered [this turn]"
    // Slice 10: "you may choose new targets for target spell or ability" (Deflecting Swat)
    matchChangeSpellTargets,
    matchEnchantedCreatureDealsDamageByPower, matchOneSidedDealDamageByPower, matchMutinyStyle, matchDamageToItselfByPower,
    // Slice 5 (bite family): "each other <Subtype> you control deals damage equal to its power to target creature"
    matchEachSubtypeDealsDamageByPower,
    // Slice 5 (bite family): "~ deals damage equal to twice its power to target <type>"
    matchDealDamageTwiceItsPower,
    matchEnchantedCreatureFight, matchSelfFightUpToOneTarget, matchFight,
  ];
  for (const pattern of patterns) {
    const result = pattern(tokens, actualStartIndex);
    if (result) {
      return {
        ...result,
        consumed: result.consumed + (actualStartIndex - startIndex),
      };
    }
  }
  return null;
}

/**
 * Try to parse an effect clause starting at the given index.
 * Returns the first matching pattern.
 */
function parseEffectClause(tokens: string[], startIndex: number): PatternResult {
  let actualStartIndex = startIndex;
  if (tokens[actualStartIndex] === 'you' && tokens[actualStartIndex + 1] === 'may') {
    actualStartIndex += 2;
  }

  // Try patterns in priority order (specific/complex before general, X patterns first)
  const patterns = [
    matchOptionalPay,             // "[you may] pay <cost>. if you do, <effects>"
    // Slice 8 (choose-type-return): "choose a creature type. return up to N creature cards
    // of the chosen type from your graveyard to your hand." (Haunting Voyage family).
    // Must come before matchChooseNTargetSpell (both start with "choose").
    matchChosenTypeReturnFromGraveyard,
    // Slice 10/13: "choose N target creatures … them/those" spells (Run Away Together, Last Night Together, etc.)
    matchChooseNTargetSpell,
    matchRevealTopIfMatchWithElse, // Slice 3: "if it's X, put in hand; if you don't, on bottom" (Traveling Botanist)
    matchRevealTopIfMatch,
    // Win/lose game effects (simple patterns, high priority)
    matchPreventGameOutcome,      // "players can't lose the game or win the game this turn"
    matchWinGame,                 // "you win the game"
    matchLoseGame,                // "you lose the game" / "target player loses the game"
    matchForEachAddMana,          // "add {R} for each card in target opponent's hand"
    matchAddManaChosenColor,      // "add one mana of the chosen color" (Slice 5: Sol Grail family)
    matchAddManaAnyColorDynamic,  // "add X mana of any one color, where X is..." / "add N mana in any combination of {R} and/or {G}" (Slice 3)
    matchAddManaAnyColor,         // "add one mana of any color" (text form, nonland permanents)
    matchAddMana,                 // "add {R}{R}{R}"
    // Slice 11: "that player adds {G}{G}{G}" (Shizuko) — EventPlayer mana
    matchThatPlayerAddsMana,
    // Slice 4: "that player adds one mana of any type that land produced" / "any color" — EventPlayer any-color mana
    matchThatPlayerAddsManaAnyType,

    // Slice 10: "your opponents can't cast spells this turn" (Silence family)
    matchOpponentsCantCastSpells,

    // Slice 6: "Until your next turn, spells your opponents cast cost {N} more." (Tax Collector family)
    matchUntilYourNextTurnOpponentSpellCostIncrease,

    // Phase 15: Conditional effects (before other patterns)
    matchConditionalEffect,       // "if you control a [type], [effect]"

    // Equipment ETB self-attach ("attach it to target creature you control").
    matchAttachItToTarget,

    // Slice 9: Entry-as-copy (Clone family) — before blink/copy to avoid false-positives.
    matchEnterAsCopy,             // "have this creature enter as a copy of any [Subtype] creature..."

    // Phase 16: Blink, copy, keyword granting, phasing (must come before simpler exile/target patterns)
    matchBlink,                   // "exile target creature, then return it to the battlefield..."
    matchCopyThatSpell,           // "copy that spell"
    matchCopySpell,               // "copy target instant or sorcery spell"
    matchCopySelfCreature,        // Slice 7: "create a token that's a copy of this creature"
    matchCreateTokenCopy,         // Slice 1: "create a/N token(s) that's/that are a copy/copies of <extended target>"
    matchCopyCreature,            // "create a token that's a copy of target creature"
    // Slice 7 (becomes-copy): "target/each creature becomes a copy of ... until end of turn"
    matchBecomesCopy,
    // Slice 4 (activated type-change): "this creature becomes a [Subtype] until end of turn"
    // (Amoeba Spy family). Must come after matchBecomesCopy and before matchGrantKeyword.
    matchBecomeCreatureTypeSelf,
    // Slice 12: "target creature loses <keyword(s)> until end of turn" (Canopy Claws family).
    // Must come BEFORE matchModifyPTAndLoseKeyword (which adds a PT-modifier rider).
    matchTargetCreatureLosesKeyword,
    matchModifyPTAndLoseKeyword,
    matchGrantKeywordAndDynamicPT,
    // Slice 7 (transient polymorph): "Until end of turn, target creature loses all abilities
    // and becomes a <color> <type> with base power and toughness X/Y [and gains <kw>]."
    // (Turn to Frog / Dance of the Skywise / Turn//Burn / Mordenkainen's Polymorph family).
    // Must come BEFORE matchLeadingDurationPumpGrant (both start with "until end of turn ,")
    // and before matchSetBasePT (more specific — requires "becomes" + "loses all abilities").
    matchTransientPolymorph,
    matchLeadingDurationPumpGrant, // "until end of turn, target creature gets +1/+0 and gains indestructible"
    // Slice 1 (base P/T set): "target creature has base power and toughness N/M until end of turn"
    matchSetBasePT,
    // Slice 9 (switch P/T): "switch target creature's / its power and toughness until end of turn"
    // (Dwarven Thaumaturgist / Valakut Fireboar family). Must come before matchModifyPT.
    matchSwitchPowerToughness,
    matchMultiTargetCombatRestriction, // Slice 1: "up to N target creatures can't block this turn"
    matchTargetCombatRestriction, // "target creature can't block this turn"
    matchGrantKeywordAll,         // "all creatures gain trample until end of turn"
    matchEnchantedCreatureGrantKeyword, // Slice 10: "enchanted creature gains hexproof and indestructible until end of turn"
    // Slice 7: "permanents you control gain hexproof and indestructible until end of turn"
    matchMassPermanentGrant,      // Heroic Intervention family — all permanents you control
    // Slice 2: "other creatures/subtypes you control gain/get ... until end of turn"
    matchOtherCreaturesGrantKeyword, // "other Spiders you control gain vigilance, reach, and lifelink"
    matchOtherCreaturesPump,         // "other creatures you control get +2/+2 [and gain trample] until end of turn"
    // Slice 3: "attacking/blocking creatures [you control] get +N/+M [and gain <kw>] until end of turn"
    // (Army of Allah / Piety / Vampiric Fury family). Must come before matchGrantKeyword and
    // matchModifyPT (more specific combat-status / subtype subject).
    matchAttackingBlockingPump,
    // Slice 6: "choose a creature type. creatures you control of the chosen type get +N/+M [and gain <kw>] until end of turn"
    matchChosenTypePump,
    // Slice 11 (transient protection): "target creature [you control] gains protection from <color>
    // until end of turn" / "[<color>] creatures you control gain protection from <color> until end of turn".
    // Must come BEFORE matchGrantKeyword (more specific — 'protection from' is NOT in GRANTABLE_KEYWORDS).
    matchGrantProtection,
    matchGrantKeyword,            // "target creature gains hexproof until end of turn"
    matchPhaseOut,                // "target permanent phases out"
    // Slice 10: "creatures you control get +N/+N and gain all creature types until end of turn"
    // Must come before matchModifyPT (more specific — includes "gain all creature types").
    matchPumpGrantAllCreatureTypes,
    // Slice 5 (Transform): "transform ~" — flip the source to its back face.
    matchTransformSelf,

    // Slice 8: activated "this creature can block an additional creature this turn"
    matchCanBlockAdditionalActivated,

    // Slice 6: activated/triggered "this creature can attack this turn as though it didn't have defender"
    matchAttackAsThoughNoDefender,

    // Slice 8: activated self-tails — LifeTotal pump before ForEach pump (matchModifyPTWhereX).
    matchSelfDynamicPumpLifeTotal,  // "this creature gets +X/+X until end of turn, where X is your life total"
    // Slice 8: self-evasion activated tail.
    matchSelfCantBeBlockedActivated, // "this creature can't be blocked this turn"

    // Slice 12 (en-Kor redirect): "the next N damage...is dealt to target creature instead"
    // Must come before matchPreventDamage (more specific — ends with "instead" not "prevent").
    matchRedirectDamage,
    // Slice 12 (Licid): "this creature loses this ability and becomes an Aura enchantment..."
    // Must come before matchBecomesCopy and other becomes matchers (more specific).
    matchLicidBecomeAura,

    // Phase 14: New complex patterns (must come before simpler versions)
    matchPreventDamage,           // "prevent all combat damage that would be dealt this turn"
    matchDealDamageGreatestManaValue, // "~ deals damage to any target equal to the greatest mana value..."
    matchDealDamageForEach,       // "~ deals damage equal to the number of..."
    matchForEachDraw,             // "draw a card for each creature you control"
    matchCreateTokenEqualTo,
    matchCreateTokenForEach,      // "create a 1/1 ... token for each ..."
    // Slice 11/12 (EachPlayer impulse): "exile the top card of each player's/opponent's library"
    matchExileTopOfEachLibrary,
    // Slice 6 (combat-damage trigger bodies): "exile the top X cards of their library,
    // where X is the amount of damage dealt" (Kotis, the Fangkeeper family).
    // Must come BEFORE matchThatPlayerExilesTopN (fixed N) and matchExileFromLibraryTop (your library).
    matchExileTopXDamageAmountTheirLibrary,
    matchThatPlayerExilesTopN,    // Slice 7: "that player exiles the top N cards of their library"
    matchExileFromLibraryTop,     // "exile the top N cards of your library"
    // Slice 12: nonlegendary/hyphenated-subtype/dual-zone ETB tutor extensions — before matchSearchLibraryGeneric
    matchETBTutorFilterExtensions,
    matchSearchLibraryGeneric,    // "search your library for a card" (generic tutor)
    matchSearchThisWayShuffleTail, // "if you search your library this way, shuffle."
    matchSacrificeSelfUnlessTargetOpponentSacrifices, // "sacrifice it unless target opponent sacrifices a creature"
    matchSacrificeSelfUnlessPay,  // Slice 4: "sacrifice this enchantment unless you pay {1}{U}" (Binding Grasp family)
    matchEachOpponentSacrifice,   // "each opponent sacrifices a creature"
    // Slice 11: "each player loses half their life, rounded up" (Havoc Festival) — before matchEachPlayerEffect
    matchEachPlayerLosesHalfLife,
    matchEachPlayerEffect,        // "each player draws/sacrifices/discards"
    matchTargetPlayerSacrifice,   // "target player sacrifices a creature"
    matchSacrificeAsEffect,       // "sacrifice a creature" (as effect)
    matchGainControl,             // "gain control of target creature"
    // Slice 11: "that player gains control of this enchantment" (Risky Move family) — after generic matchGainControl
    matchThatPlayerGainsControl,
    matchReturnAllFromGraveyard,
    matchReturnAllToHand,         // "return all creatures to their owners' hands"
    // Slice 6: "destroy all [non-]<Subtype> creatures" — before matchDestroyAllColorCreatures
    matchDestroyAllSubtypeCreatures, // "destroy all Dragon creatures" / "destroy all non-Dragon creatures"
    // Slice 8: "exile all [non-]<Subtype> creatures"
    matchExileAllSubtypeCreatures, // "exile all Dragon creatures" / "exile all non-Dragon creatures"
    matchDestroyAllColorCreatures, // "destroy all green creatures"
    matchDestroyAllLandSubtype,    // "destroy all Islands" / "destroy all lands"
    matchDestroyAllTappedCreatures, // Slice 4: "destroy all tapped/untapped creatures" (Split Up)
    matchExileAllColorCreatures,   // "exile all white creatures"
    // Slice 8: "destroy/exile all non<color> creatures" (Mass Calcify / Their Name Is Death)
    matchDestroyAllNoncolorCreatures,
    // Slice 8: "destroy/exile all token/nontoken creatures" (Hour of Reckoning)
    matchDestroyAllTokenFilter,
    // Slice 8: "return all creature tokens / nontoken creatures to owners' hands" (Perplexing Test)
    matchReturnAllTokenFilter,
    // Slice 8: "destroy/exile all legendary/nonlegendary creatures" (Invasion of Fiora)
    matchDestroyAllLegendaryFilter,
    // Slice 8: "destroy all blocking/blocked creatures" (Fight to the Death)
    matchDestroyAllBlockingBlocked,
    matchExileAll,                // "exile all artifacts"
    matchDestroyAllExpanded,      // "destroy all artifacts/enchantments"

    // Player-targeted life/discard (before generic matchGainLife/matchLoseLife/matchDiscard,
    // which would otherwise misattribute the player or drop the "at random" flag).
    matchTargetPlayerLoseLifeEqualToNumberOf, // "target opponent loses life equal to the number of Elves you control"
    matchTargetPlayerLoseLife,
    matchTargetPlayerGainLifeX,  // Slice 4: "target player gains X life" (Alabaster Potion)
    matchTargetPlayerGainLife,
    matchEachPlayerGainLife,
    matchTargetPlayerDiscardAtRandom,

    // Spelled-out-X with a "where X is the number of ..." tail — must run
    // before the cast-time {X} matchers (matchDealXDamage / matchDrawX) so the
    // where-clause defines the amount instead of an unset X value.
    matchEachOpponentLosesXLifeWhereX,
    // Slice 7: "deals X damage to that player, where X is N minus the number of cards in that player's hand"
    // (Wheel of Torture / Storm World / Rackling / Viseling family) — must precede matchDealDamageXWhereX.
    matchDealDamageXBaseMinusCount,
    matchDealDamageXWhereX,
    matchDrawXWhereX,
    matchMillXWhereX,
    matchGainLifeXWhereX,
    matchLoseLifeXWhereX,
    matchEntersWithCountersWhereX,  // Slice 11: ETB "enters with X <type> counters, where X is the number of..."
    matchEntersWithCountersForEach, // Slice 11: ETB "enters with a/N <type> counter on it for each <filter> <zone>"
    matchEntersWithCountersEqualTo, // Slice 5/12: ETB "enters with a number of <type> counters on it equal to the number of..."
    matchAddCountersWhereX,
    matchModifyPTWhereX,

    // Phase 10: X patterns
    matchDealXDamage,
    matchDrawX,

    // Phase 10: Each opponent patterns
    matchEachOpponentLosesLife,
    // Slice 6: "each opponent reveals their hand and discards a [filter] card" — before matchEachOpponentDiscardsCard
    matchEachOpponentRevealsHandDiscardsFilter,
    matchEachOpponentDiscardsCard,
    matchDestroyAll,

    // Core patterns
    // Slice 10: "distribute N +1/+1 counters among one, two, or three target creatures"
    matchDistributeCounters,     // (Armament Dragon family — total divided among chosen targets)
    matchDealDamageDivided,      // "~ deals N|X damage divided as you choose among ..."
    matchDealDamageEqualToEventPlayerControls, // Slice 12: "this enchantment deals damage to that player equal to the number of <filter> they control"
    matchDealDamageEqualTo,
    matchHaveItDealDamage,       // "you may have it deal N/power damage to target creature [that player controls]"
    // Brion Stoutarm family: "~ deals damage equal to the sacrificed creature's power to target player [or planeswalker]"
    matchDealDamageSacrificedCreaturePower,
    // Slice 8: "it deals N damage to target opponent [or planeswalker] and N damage to up to one target creature [or planeswalker]"
    // (Burning Sun's Avatar / Rakdos Firewheeler family). Must come before matchDealDamage.
    matchDealDamageTwoTargets,
    // Slice 8: "it deals N damage to each of up to two targets" — each target takes N independently.
    // Must come before matchDealDamage (more specific: "each of up to N" vs single target).
    matchDealDamageEachUpToNTargets,
    matchDealDamage,
    matchExactMultiTarget,       // "tap/destroy/exile/return two|three target X" (exact N, no "up to")
    matchMultiTarget,            // "tap/destroy/exile/untap/return up to N target creatures" (N >= 2; Slice 1)
    // Slice 10: "destroy target Plains and target white creature" (Reign of Chaos) — paired typed destroy, before matchDestroy.
    matchDestroyPairedTypedTargets,
    matchDestroy,
    matchRevealHandOptionalChooseCard,
    matchRevealHandAndTopOfLibraryChooseCard,
    matchRevealHandGainLife,
    matchRevealHandDiscardAll,              // Slice 3: "reveals their hand and discards all [filter] cards"
    matchRevealHandDiscardAllTwoSentence,   // Slice 1: "reveals their hand. That player discards all [other] nonland cards [with same name...]"
    matchExileAllFromTargetHand,            // Slice 11: "exile all <filter> cards from target opponent's/that player's hand"
    matchRevealHandDiscardAtRandomFiltered, // Slice 11: "reveals their hand and discards a <filter> card at random" (Rag Man)
    matchRevealHandChooseCardWithLifeGainRider, // Slice 12: "...you gain life equal to that creature card's toughness, then that player discards that card" (Talara's Bane)
    // Slice 8/11: "...reveals their hand. you may cast an instant or sorcery spell...without paying its mana cost" — before matchRevealHandChooseCard
    matchCastFromRevealedHand,
    matchRevealHandDiscardXCards,           // Round 8: "You choose X cards from it. That opponent discards those cards." (Abandon Hope family)
    // Slice 6: "choose a color" preamble + reveal-hand (Addle / Hint of Insanity) — before matchRevealHandChooseCard
    matchRevealHandChosenColorChooseCard,
    matchRevealHandChosenColorDiscardAll,
    // Slice 6: ETB exile-until-leaves plain-exile subset (Brain Maggot / Kitesail Freebooter) — before matchRevealHandChooseCard
    matchRevealHandChooseCardEtbExileUntil,
    // Slice 4: "target opponent/player reveals a card at random from their hand" (Planeswalker's Favor/Fury/Wand of Ith)
    // Must come before matchRevealHandChooseCard (which requires "reveals their hand") — more specific random-reveal form.
    // Slice 11: conditional-discard variant MUST come before matchRevealRandomCardFromHand (more specific — requires "if it's a <filter>").
    matchRevealRandomCardConditionalDiscard,
    matchRevealRandomCardFromHand,
    // Slice 4a: "target player reveals a number of cards from their hand equal to the number of X you control.
    // You choose one of them. That player discards that card." (Mire's Toll family).
    // Must come before matchRevealHandChooseCard (different head: "reveals a number of cards from their hand").
    matchTargetPlayerPartialRevealChooseCard,
    // Slice 9b: Two-pick form (Dreams of Steel and Oil full form) — before matchRevealHandChooseCard.
    matchRevealHandChooseCardAndGraveyardExile,
    // Slice 9b: Comma-then separator form (Lobotomy family) — before matchRevealHandChooseCard.
    matchRevealHandCommaThenChooseCard,
    matchRevealHandChooseCard,
    matchLookAtHandThenChooseCard,          // Slice 12: "Look at target opponent's hand. You choose/may exile..." (Venarian Glimmer / Gobakhan) + conjunction form
    matchLookAtTargetPlayerHand,
    matchRevealUntilMatchOtherPlayer,     // Slice 3: "that player reveals ... until they reveal [N] <filter> card[s]" (Mirko Vosk / Bismuth / Bruntar)
    matchRevealUntilMatch,                // Slice 2: reveal-until-match loop (Treasure Hunt / Hermit Druid family)
    matchRevealUntilAllToGraveyard,       // Round-8 carryover: "reveal cards until you reveal X. That card and all other cards revealed this way go to your graveyard." (Old Stickfingers family)
    // Slice 2: "put all <type> cards from among them onto the battlefield [tapped]" — before matchRevealTopAnyNumberOntoBattlefield
    matchDigTopPutAllOntoBattlefield,
    // Slice 4 (round-8 cut c): "reveal top X/N, put any number of <type> onto battlefield, rest graveyard" — before matchRevealTopOntoBattlefield
    matchRevealTopAnyNumberOntoBattlefield,
    // Slice 8: "any number of land cards and/or legendary permanent cards onto battlefield" — before matchRevealTopOntoBattlefield
    matchLookAtTopAnyNumberMultiTypeOntoBattlefield,
    // Slice 8: "creature card with power N or greater onto battlefield" — before matchRevealTopOntoBattlefield
    matchLookAtTopPowerFilterOntoBattlefield,
    matchRevealTopOntoBattlefield,
    matchLookAtTopPutOneToBattlefield,    // Slice 2: "you may put a/an <type> [mv≤K] from among them onto the battlefield [tapped]"
    matchLookAtTopGreatestPower,          // Slice 3: "look at top X, where X is the greatest power among creatures you control" (Keldon Flamesage)
    matchLookAtTopWhereXForEach,          // Slice 5: "look at top X ... where X is the number of <filter> you control"
    matchRevealTopPutRevealedToHand,      // Slice 5: "reveal any number ... put the revealed cards into your hand" (Forging the Anchor / Gift of the Gargantuan)
    matchRevealTopUpToMFilter,            // Slice 1: "you may reveal up to M <filter> cards from among them and put them into your hand"
    // Slice 4 (round-8 cut c): "all typeA and typeB" + ", then put all typeN" multi-type forms — before matchRevealTopAllTypesAndAll
    matchRevealTopMultiTypeThenBranch,
    matchRevealTopAllTypesAndAll,         // Slice 3: "put all <typeA> and all <typeB> cards revealed this way into your hand" (Lair Delve)
    // Slice 6/12: "look/reveal top N. you may reveal up to K <type> and/or <type2> cards from among them, then/and put them into your hand. put the rest on bottom/graveyard."
    // — must come before matchRevealTopTakeExtended (different put-into-hand phrasing: "then put them" vs "put from among them")
    matchLookAtTopRevealUpToKFilterToHand,
    matchRevealTopTakeExtended,
    matchRevealTopSubtypeFilter,          // Slice 2: "put all Goblin/Island/Kavu cards revealed this way into your hand"
    // Slice 3/13: "put all cards of the chosen type into your hand" — more specific than matchRevealTopTake
    matchRevealTopChosenType,
    // Slice 9: "reveal top N, separate into two piles, opponent chooses a pile"
    // (Steam Augury / Fact-or-Fiction family) — must come BEFORE matchRevealTopDistribute
    // (single-card form) because both start with "reveal the top N cards"; the two-pile
    // form requires "separate them into two piles" + "those piles" as distinguishing gates.
    matchRevealTopSplitTwoPiles,
    // Slice 9: "reveal top N, opponent chooses one, that to graveyard/hand, rest to hand/graveyard"
    // (Murmurs from Beyond family) — more specific than matchRevealTopTake (requires "an opponent chooses one")
    matchRevealTopDistribute,
    matchRevealTopTake,
    matchRevealTopIfMatchWithElse,        // Slice 3: "if it's a <type>, put it into hand; if you don't, put it on the bottom" (Traveling Botanist)
    matchLookAtTopPutNToGraveyard,        // Slice 1: "put N of them into your graveyard. put the rest on top."
    // Slice 4 (round-8 cut c): "put M on bottom, rest into hand" — before matchDigTopTakeRest
    matchLookAtTopPutMOnBottomRestToHand,
    matchDigTopTakeRest,
    matchDarkConfidantReveal,
    // Slice 6/12: "reveal the top N cards ... put one of them into your hand" (no explicit rest clause)
    // — after matchDigTopTakeRest (which handles the "with rest" form) and before matchRevealTopUnconditioned
    matchRevealTopPutOneNoRest,
    // Slice 3/13: unconditional "reveal top card and put it into your hand" — after Dark Confidant (life-loss form) which is more specific
    matchRevealTopUnconditioned,
    // Slice 6/12: "where X is twice the number of <filter> you control, put one into hand" — must come
    // before matchLookAtTopDynamicCountReorderBack (which also handles "where X is <dynamic>")
    matchLookAtTopTwiceNumberOfToHand,
    matchLookAtTopDynamicCountReorderBack, // Slice 1: "look at top X where X is <dynamic count>, put them back"
    // Slice 9/12: "look at the top X cards ..., then put them back in any order" (Soothsaying bare-X form)
    // — after matchLookAtTopDynamicCountReorderBack (handles "where X is") and before matchLookAtTopReorderBack (fixed-N)
    matchLookAtTopXReorderBack,
    matchLookAtTopOneOnTopRestBottom,      // Slice 1: "put one of them on top, rest on the bottom" (Gutless Plunderer)
    matchLookAtTopReorderBack,
    // Slice 6/12: "put those cards / them on the bottom in any order" (Lim-Dûl's Vault style) —
    // after matchLookAtTopReorderBack ("put them back in any order" → top) to avoid collision
    matchLookAtTopAllOnBottom,
    matchLookAtTopTargetExileOneRestBack,  // Slice 4: "look at top N of target opponent's library. exile/bin one, rest back on top."
    matchLookAtTopTargetMayMill,           // Slice 4: "look at top N of target opponent's library. you may put that card into their graveyard."
    matchLookAtTopOfTargetLibrary,         // Slice 4: pure look at top N of target player's/opponent's library (Orcish Spy family)
    // Slice 4 (round-8 cut c): "exile one face down, rest on bottom" — before matchLookAtTopExileOneFromAmong
    matchLookAtTopExileFaceDown,
    // Slice 4 (round-8 dig leftovers): "where X is this creature's power + exile" — more specific than fixed-count exile
    // Slice 2/12 (A): "where X is this creature's power + any number of <type> to hand" — before self-power-exile form
    matchLookAtTopSelfPowerAnyNumberToHand,
    matchLookAtTopWhereXSelfPowerExile,
    // Slice 3/12: "exile N of them at random, then put the rest on top of your library in any order."
    // (Orcish Librarian family) — must come BEFORE matchLookAtTopExileOneFromAmong (singular "exile a card" form)
    // because both start with "look at the top N cards"; the counted-random-exile form is more specific.
    matchLookAtTopExileNRestTop,
    matchLookAtTopExileOneFromAmong,       // Slice (trigger dig leftovers): "you may exile a [filter] card from among them. put the rest on the bottom."
    matchLookAtTopExileFilterRestToHand,   // Slice 3/12: "you may exile a [filter] card from among them. put the rest into your hand."
    // Slice 2/12 (B): "look at top card, you may play a land from top this turn, if not land → graveyard" (Ziatora's Envoy)
    // — must come before matchLookAtTopPutItToGraveyard (graveyard dest) and matchLookAtTopCardMayExile (exile dest)
    matchLookAtTopCardPlayLandOrGraveyard,
    matchLookAtTopPutItToGraveyard,        // Slice (trigger dig leftovers): "look at top N. you may put it into your graveyard."
    // Slice 4 (round-8 dig leftovers): "look at the top card. you may exile that card." (Puresight Merrow)
    matchLookAtTopCardMayExile,
    // Slice 12: "you may put one back on top. put the rest into your graveyard." (Sage of Days)
    matchLookAtTopOneOnTopRestGraveyard,
    // Slice 2: "look at that many cards from top" before fixed-N matchLookAtTopPutOneIntoHand
    matchLookAtTopThatMany,
    // Slice 4 (round-8 cut c): "put any number of them into your hand, rest on bottom" — unfiltered form
    matchLookAtTopAnyNumberToHand,
    // Slice 2/13: "put any number of them into your graveyard, rest on top" (Gutless Plunderer)
    matchLookAtTopAnyNumberToGraveyard,
    // Slice 2/13: "you may reveal a <filter> card from among them and put it into your hand" (Nessian Wanderer / Seismic Sense)
    // — must come before matchLookAtTopPutOneIntoHand
    matchLookAtTopRevealOneFilterToHand,
    matchLookAtTopPutOneIntoHand,
    // Slice 8/12: "that player may put an artifact, creature, or land card from their hand onto
    // the battlefield" (Braids) — before matchPutLandFromHandOntoBattlefield (more specific).
    matchThatPlayerPutPermanentFromHandOntoBattlefield,
    matchPutLandFromHandOntoBattlefield,
    // Slice 8/12: "that player may pay <cost>. If they don't, <downside>" (Umbilicus family).
    // Must come BEFORE matchThatPlayerRevealHandCoercion and the plain "that player" matchers
    // because it matches the "that player may pay" head which is more specific.
    matchEachPlayerUnlessPay,
    // Slice 8/12: "that player reveals N cards [at random] from their hand. you choose one. that player discards that card."
    // — EventPlayer hand-reveal coercion (Hollow Specter family); before matchThatPlayerDiscard (more specific head).
    matchThatPlayerRevealHandCoercion,
    // Slice 2: "that player discards that many" before "that player discards N"
    matchThatPlayerDiscardsThatMany,
    // Slice 2: "that player mills that many" before "that player mills N"
    matchThatPlayerMillsThatManyCards,
    matchThatPlayerDiscard,
    matchThatPlayerDraw,
    matchTargetPlayerDraw,
    matchThatPlayerMill,          // "that player mills N cards" / "X cards where X is hand count" (each-player upkeep)
    matchThatPlayerUntapsLand,    // Slice 11: "that player untaps a land they control" (Hokori family)
    // Slice 7/12: "that player loses X life, where X is the number of <filter> they control / in their hand"
    // Must come BEFORE matchThatPlayerLosesLife (fixed-N form) since it's more specific.
    matchThatPlayerLosesLifeXWhereX,
    // Slice 8/12: "that player loses N life" — per-player-upkeep LoseLife tail (EventPlayer).
    matchThatPlayerLosesLife,
    // Slice 9/12: "that player exiles N cards from their graveyard" (Curse of Oblivion / Oath family).
    matchThatPlayerExilesFromGraveyard,
    // Slice 8/12: "that player exiles a card at random from their hand" (Elkin Lair family).
    // Must come after matchThatPlayerExilesFromGraveyard (different zone) and before matchExile.
    matchThatPlayerExilesAtRandom,
    // Slice 9/12: "that player / target opponent puts a card from their hand on top of their library"
    // (Chittering Rats family) — before matchPutLandFromHandOntoBattlefield.
    matchThatPlayerPutsCardOnTopOfLibrary,
    matchDefendingPlayerEffect,   // Slice 6: "defending player discards/mills/sacrifices/loses life" (attack trigger tails)
    // Dynamic "equal to the number of ..." shapes, before the generic matchers
    // whose own "equal to" branches only cover power / battlefield permanent counts.
    // Slice 4/CBC: "draw cards equal to the greatest toughness among creatures you control"
    // — must come before matchDrawEqualToNumberOf (more specific amount kind).
    matchDrawEqualToGreatestToughness,
    matchDrawEqualToNumberOf,
    matchMillEqualToNumberOf,
    matchGainLifeEqualToNumberOf,
    matchLoseLifeEqualToNumberOf,
    // Slice 2: "draw that many cards" before the generic matchDraw (which handles fixed counts)
    matchDrawThatManyCards,
    matchDraw,
    // Slice 5 + Slice 2 (EventDamageAmount family): "that much/that many" effect bodies —
    // before matchGainLife / matchDealDamage / matchLoseLife so EventDamageAmount wins.
    // Slice 9: matchDealDamageToEventCreatureController before matchDealsDamageThatMuchToCreatureController.
    matchDealDamageToEventCreatureController, // Slice 9: "~ deals N damage to that creature's controller"
    matchDealsDamageThatMuchToCreatureController,
    // Slice 3: "it deals that much damage to each creature that player controls" (Balefire Dragon)
    // — must come before matchDealsThatMuchDamageToTarget (which handles single targets)
    matchDealsThatMuchDamageToEachCreatureThatPlayerControls,
    // Slice 2: "it/~ deals that much damage to target opponent / each other opponent / any target ..."
    matchDealsThatMuchDamageToTarget,
    matchEachPlayerGainsThatMuchLife,
    matchGainLifeThatMuch,
    // Slice 2: "you lose that much life"
    matchLoseLifeThatMuch,
    // Slice 2: "target player mills that many cards" before matchMill
    matchTargetPlayerMillsThatManyCards,
    // Slice 2: "exile that many cards from the top of their/your library" before matchExileFromLibraryTop
    matchExileThatManyFromTopOfLibrary,
    // Brion Stoutarm family: "you gain life equal to that/the sacrificed creature's power" — before matchGainLife
    matchGainLifeSacrificedCreaturePower,
    matchGainLife,
    matchLoseLife,
    matchExile,
    matchPutCreatureCardFromOpponentGraveyardOntoBattlefield,
    matchPutGraveyardCardIntoLibrary, // Slice 7: "put target card from [a/your] graveyard on top/bottom of library"
    matchPutIntoLibrary,           // Slice 3: "put target X on top/bottom of its owner's library" (Time Ebb family)
    matchReturnFromGraveyard, // before ReturnToHand — "return target creature card from..."
    matchReturnThatCardToHand,
    matchReturnThatCardToBattlefield, // Slice 9: "return that card to the battlefield under your control"
    // Slice 4/12: "that player returns each creature they control [with power > hand count]" (Noetic Scales).
    // Must come BEFORE matchThatPlayerReturnsCreature (single "a creature" form).
    matchThatPlayerReturnsMassBounce,
    matchThatPlayerReturnsCreature, // "that player returns a creature they control" (Sunken Hope)
    // Slice 1: "return target <type> that player controls to its owner's hand" (Mistblade Shinobi family)
    // — more specific than matchReturnToHand (requires "that player controls"), placed before it.
    matchReturnThatPlayerControlsToHand,
    matchReturnUpToOneOtherTargetYouControlToHand, // Slice 9: "return up to one [other] target <type> [you control] to its owner's hand" (Winter Eladrin family)
    matchReturnPermanentYouControlToHand,
    matchReturnToHand,
    matchEachPlayerOrOpponentMill,
    matchMill,
    matchGainEnergy,
    matchAddCountersAttached,
    matchYouGetCounters,
    // Slice 10: "remove all counters from target creature" (Suncleanser) — more specific than matchRemoveCountersTarget.
    matchRemoveAllCountersFromTarget,
    matchRemoveCountersTarget,
    matchSupport,                  // Slice 4: "Support N" keyword action
    // Slice 9 (Fynn family): "that player gets N <type> counters" — EventPlayer target;
    // must come before matchAddCounters (which handles fixed-target forms).
    matchThatPlayerGetsCounters,
    // Slice 2: "they get that many <type> counters" — EventPlayer + EventDamageAmount;
    // combat-damage-to-player trigger tails (Infesting Radroach rad counters, etc.).
    // Must come before matchAddCountersThatMany (which requires "put...on it/~" form).
    matchTheyGetThatManyCounters,
    // Slice 2: "put that many counters" before fixed-N matchAddCounters
    matchAddCountersThatMany,
    // Slice 4 (devotion): "put a number of <type> counters on it equal to your devotion to <color>" — before matchAddCounters.
    matchAddCountersEqualToDevotion,
    // Slice 12: "that player puts a <type> counter on target [non-<Subtype>] land they control"
    // (Quicksilver Fountain family) — more specific than matchAddCounters, before it.
    matchThatPlayerPutsCounterOnLandTheyControl,
    // Slice 9: "put its counters on [up to one] target creature" / "move a +1/+1 counter from this artifact onto target creature"
    // (Star Pupil / Host of the Hereafter / Weapon Rack family) — more specific than matchAddCounters.
    matchMoveCounters,
    // Slice 1: "put a <type> counter on target <subtype> for each <subtype> you control"
    // More specific than matchAddCounters (which handles fixed counts only), so placed before it.
    matchAddCountersForEach,
    matchAddCounters,
    // Slice 4: "remove x counters where X" before fixed-count matchRemoveCounters
    matchRemoveCountersWhereX,
    matchRemoveCounters,
    matchModifyPTForEach,
    matchMassOpponentDebuff,      // Slice 8: "creatures your opponents control get -2/-0 until end of turn"
    matchMassKeywordHolderDebuff, // Slice 8: "creatures with flying get -N/-N until end of turn"
    matchHaveTargetGetPT,         // Slice 8: "you may have target <filter> get +N/+N until end of turn"
    matchMultiTargetPumpGrant,    // Slice 4: "up to N / N / one or two target creatures each get/gain ..."
    // Slice 7: "that creature gets +N/+N until end of turn" — EventCreature target;
    // must come before matchModifyPT (which does not handle "that creature" subject).
    matchThatCreatureGetsPT,
    // Slice 8/11: "that creature gains <keyword> until end of turn" — EventCreature target;
    // must come before matchGrantKeyword (more specific "that creature" subject).
    matchThatCreatureGainsKeyword,
    // Slice 8/11: "that creature can't be regenerated this turn" — CantBeRegenerated grant.
    matchThatCreatureCantBeRegenerated,
    // Slice 3: "target creature gets +X/+0 / +0/+X until end of turn" — asymmetric cast-time X pump
    // (Howl from Beyond family). Must come before matchModifyPT (fixed numeric values only)
    // and after matchModifyPTWhereX (requires a "where X is ..." clause).
    matchModifyPTAsymmetricX,
    // Slice 4/CBC: "target creature gets -X/-X until end of turn" — negative X-scaled pump
    // (Slice from the Shadows family). After matchModifyPTAsymmetricX, before matchModifyPT.
    matchModifyPTNegativeX,
    // Slice 9: "target creature gets +N/+N and gains \"When this creature dies, <effect>\""
    // (Demonic Gifts / Supernatural Stamina / Galuf's Final Act family).
    // Slice 6 extension: also handles leading-duration form and "tapped" variant.
    // Must come before matchModifyPT (more specific — includes quoted-gains clause).
    matchPumpGrantQuotedDiesTrigger,
    // Slice 6: "target creature [you control] gains \"When this creature dies, <effect>\""
    // (Not Dead After All / Undying Evil family — no P/T pump). Must come before
    // matchGrantKeyword (which doesn't handle quoted abilities) and after
    // matchPumpGrantQuotedDiesTrigger (which requires a P/T pump).
    matchGrantQuotedDiesTriggerNoPT,
    matchModifyPT,
    matchGoad,
    // Slice 7 (lure): "all creatures able to block target creature [this turn] do so"
    // (Taunting Challenge / Goldenhide Ox trigger-body family). Placed after matchGoad.
    matchLureSpell,
    matchRegenerate,
    matchRegenerateEnchantedCreature, // Slice 9: "{cost}: Regenerate enchanted creature"
    // Slice 4: "tap/untap x target permanents" (Reality Spasm) before single-target matchTap/matchUntap
    matchTapXTargetPermanents,
    matchUntapXTargetPermanents,
    matchTap,
    matchUntapUpToOneTargetCreature, // Slice 7: "untap up to one target creature"
    matchUntap,
    // Slice 8/12: "roll a dN. [you] create that many <tokens>" — before matchRollD20 (more specific)
    matchRollDNCreateThatManyTokens,
    matchRollD20,
    // Slice 2: "that player creates that many" before "that player creates a"
    matchThatPlayerCreatesThatManyTokens,
    matchThatPlayerCreatesToken,
    matchInvestigate,
    matchProliferate,
    matchExplore,
    matchBecomeMonarch,
    matchConnive,
    matchAmass,
    matchPopulate,
    matchAdapt,
    matchBolster,
    matchMonstrosity,
    matchFabricate,
    // Slice 2: "create that many" before generic matchCreateToken
    matchCreateTokenThatMany,
    matchCreateToken,
    matchDiscard,
    matchDiscardSelf,
    matchScry,
    matchSurveil,
    matchCounterSpell,
    matchGrantCantBeCountered,   // Slice 11: "target spell can't be countered [this turn]"
    // Slice 10: "you may choose new targets for target spell or ability" (Deflecting Swat)
    matchChangeSpellTargets,
    matchEnchantedCreatureDealsDamageByPower, // Slice 10: "enchanted creature deals damage equal to its power to any other target"
    matchOneSidedDealDamageByPower,
    matchMutinyStyle,              // Slice 5 (bite family): "target creature an opponent controls deals damage equal to its power to another target creature"
    matchDamageToItselfByPower,
    // Slice 5 (bite family): "each other <Subtype> you control deals damage equal to its power to target creature"
    matchEachSubtypeDealsDamageByPower,
    // Slice 5 (bite family): "~ deals damage equal to twice its power to target <type>"
    matchDealDamageTwiceItsPower,
    matchEnchantedCreatureFight, // Slice 10: "enchanted creature fights up to one target creature"
    matchSelfFightUpToOneTarget,  // Slice 1: "it fights up to one target creature you don't control"
    matchFight,
  ];

  for (const pattern of patterns) {
    const result = pattern(tokens, actualStartIndex);
    if (result) {
      return {
        ...result,
        consumed: result.consumed + (actualStartIndex - startIndex),
      };
    }
  }

  return null;
}

// matchETBPrefix, matchDiesPrefix, matchTriggerPrefix, and all trigger-prefix helpers moved to matchers/trigger-prefixes.ts

/**
 * Parse multiple effect clauses from tokens, splitting on "then", "and", and ". " boundaries.
 * Returns combined effects and targets, or null if nothing parsed.
 */
export function parseMultipleEffects(tokens: string[], startIndex: number): PatternResult {
  const allEffects: Effect[] = [];
  const allTargets: TargetSpec[] = [];

  // Split tokens into clauses by "then", "and", or sentence boundaries
  // We process greedily: try to match at current position, then look for separators
  let pos = startIndex;

  while (pos < tokens.length) {
    // Skip separators: "then", "and", ",", "."
    while (pos < tokens.length) {
      const t = tokens[pos];
      if (t === 'then' || t === ',' || t === '.') {
        pos++;
      } else if (t === 'and' && allEffects.length > 0) {
        // Only skip "and" if we already parsed at least one effect
        pos++;
      } else {
        break;
      }
    }

    if (pos >= tokens.length) break;

    if (
      allEffects.length > 0 &&
      tokens[pos] === 'at' &&
      tokens[pos + 1] === 'the' &&
      tokens[pos + 2] === 'beginning'
    ) {
      break;
    }

    const result = parseEffectClause(tokens, pos);
    if (result) {
      allEffects.push(...result.effects);
      allTargets.push(...result.targets);
      pos += result.consumed;
    } else {
      // Can't parse remaining tokens — skip to next separator
      pos++;
    }
  }

  if (allEffects.length === 0) return null;

  return {
    effects: allEffects,
    targets: allTargets,
    consumed: tokens.length - startIndex, // consumed everything we could
  };
}

function isOptionalEffectClause(tokens: string[], startIndex: number): boolean {
  let pos = startIndex;
  while (pos < tokens.length && (tokens[pos] === ',' || tokens[pos] === '.')) {
    pos += 1;
  }
  return tokens[pos] === 'you' && tokens[pos + 1] === 'may';
}

/**
 * Check if mana cost contains X.
 */
export function hasXInCost(manaCost: string): boolean {
  return manaCost.includes('{X}');
}

/**
 * Parse modal spell text.
 * "Choose one —" or "Choose two —"
 */
function formatModalChoiceLabel(tokens: string[], fallback: string): string {
  const text = tokens
    .filter(token => token !== '.' && token !== ',' && token !== ';')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return fallback;
  const normalized = text.length > 80 ? `${text.slice(0, 77)}...` : text;
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

/**
 * Slice 6: Strip a named-mode prefix from bullet tokens.
 * Named modes have the form "• Feed — <effect>" where the mode label is a
 * single Title-Case word (all-lowercase after tokenization) followed by an
 * em-dash. Pattern: tokens[0] is a single lowercase word (only letters) and
 * tokens[1] is '—'. Returns the tokens starting after the dash, or the
 * original array if no prefix is found.
 */
function stripNamedModePrefix(bulletTokens: string[]): string[] {
  if (
    bulletTokens.length >= 3 &&
    /^[a-z]+$/.test(bulletTokens[0]) &&
    (bulletTokens[1] === '—' || bulletTokens[1] === '–')
  ) {
    return bulletTokens.slice(2);
  }
  return bulletTokens;
}

function parseModalSpell(tokens: string[], _manaCost?: string): ModalSpell | null {
  if (tokens.length < 3) return null;
  if (tokens[0] !== 'choose') return null;

  let chooseCount: number;
  let upTo = false;

  let chooseOneOrMore = false;

  if (tokens[1] === 'one' && tokens[2] === 'or' && tokens[3] === 'both') {
    // "choose one or both"
    chooseCount = 2;
    upTo = true;
  } else if (tokens[1] === 'one' && tokens[2] === 'or' && tokens[3] === 'more') {
    chooseCount = 0;
    upTo = true;
    chooseOneOrMore = true;
  } else if (tokens[1] === 'one') {
    chooseCount = 1;
  } else if (tokens[1] === 'two') {
    chooseCount = 2;
  } else {
    return null;
  }

  // Find the dash (—)
  let dashIdx = -1;
  for (let i = 2; i < tokens.length; i++) {
    if (tokens[i] === '—' || tokens[i] === '-' || tokens[i] === '–') {
      dashIdx = i;
      break;
    }
  }
  if (dashIdx === -1) return null;

  // Parse choices (each starts with •)
  // Slice 7: each bullet is parsed with parseMultipleEffects so multi-sentence
  // choices ("Target opponent reveals their hand. You may choose ... That player
  // discards that card.") compose correctly instead of failing at the first
  // sentence boundary.
  //
  // HONESTY GATE (Slice 7): we collect raw bullet token arrays first, then
  // attempt to parse ALL of them. If any bullet fails we return null for the
  // whole modal, rather than silently dropping unparseable modes and claiming
  // the card as Modal. A partial claim would hide printed modes from the engine.
  const rawChoices: { tokens: string[]; label: string }[] = [];
  let currentRaw: { tokens: string[]; label: string } | null = null;

  for (let i = dashIdx + 1; i < tokens.length; i++) {
    if (tokens[i] === '•') {
      if (currentRaw && currentRaw.tokens.length > 0) rawChoices.push(currentRaw);
      currentRaw = { tokens: [], label: `Choice ${rawChoices.length + 1}` };
    } else if (currentRaw) {
      currentRaw.tokens.push(tokens[i]);
    }
  }
  if (currentRaw && currentRaw.tokens.length > 0) rawChoices.push(currentRaw);

  if (rawChoices.length === 0) return null;

  const choices: ModalChoice[] = [];
  for (const raw of rawChoices) {
    // Slice 6: strip named-mode prefix ("Feed —", "Growth —", "Tax —", etc.)
    // before parsing so the mode label does not confuse matchers. The label is
    // kept for display from the original raw.tokens.
    const bulletTokens = stripNamedModePrefix(raw.tokens);
    // Use parseMultipleEffects so multi-sentence bullets (each separated by "."
    // or ",") are composed into a single choice effect list.
    const result = parseMultipleEffects(bulletTokens, 0);
    if (!result || result.effects.length === 0) {
      // HONESTY: at least one bullet is unparseable — decline the whole modal
      // rather than silently dropping the mode. Return null so parseOracleText
      // keeps the card as Unparsed instead of claiming a partial Modal.
      return null;
    }
    choices.push({
      label: formatModalChoiceLabel(raw.tokens, raw.label),
      effects: result.effects,
      targets: result.targets.map(t => ({ id: t.id, type: t.type })),
    });
  }

  if (choices.length === 0) return null;

  return {
    kind: 'Modal',
    chooseCount: chooseOneOrMore ? choices.length : chooseCount,
    upTo: upTo || undefined,
    choices,
  };
}

/**
 * Family: choose-type-etb / choose-color-etb / choose-opponent-etb.
 *
 * Strip a leading "As ~ enters[ the battlefield], choose <X>." declaration
 * and an optional self-identity sentence, then return the REMAINING oracle
 * text. Returns null when the text does not lead with any supported
 * declaration form.
 *
 * Supported forms (Slice 3 expansion):
 *   - "choose a creature type"  → choices.chosenCreatureType
 *   - "choose a color"          → choices.chosenColor
 *   - "choose an opponent"      → choices.chosenOpponent
 *   - "choose a player"         → choices.chosenOpponent (engine-stored)
 *   - "choose two players"      → choices.chosenOpponent (primary player)
 *   - "choose a card name"      → choices.chosenCardName
 *   - "choose a nonland card name" → choices.chosenCardName
 *
 * Stripping the declaration exposes the remaining runnable sentence(s) for
 * the normal parse dispatch. The engine stores each choice via the matching
 * CastSpellOptions.cardChoices field (stack.ts), so absorbing the
 * declaration is honest — it represents a genuine engine-stored decision.
 */
/**
 * Slice 4 (self-reference normalization): Normalise subtype-based self-reference
 * forms to the canonical type forms that existing matchers already handle.
 *
 *   "this Aura"      → "this enchantment"  (Aura is an enchantment subtype)
 *   "this Equipment" → "this artifact"     (Equipment is an artifact subtype)
 *   "this Vehicle"   → "this artifact"     (Vehicle is an artifact subtype)
 *
 * Applied at the RAW TEXT LEVEL before tokenisation so that EVERY matcher
 * family (sacrifice, return-to-hand, attach, trigger-prefix ETB, etc.) benefits
 * without per-matcher changes.
 *
 * SAFE for trigger-prefix matchers: SELF_ETB_SUBJECT_TYPES in trigger-prefixes.ts
 * already lists 'enchantment', 'artifact' (and 'aura', 'equipment', 'vehicle')
 * so the normalised forms continue to match ETB prefix detection.
 *
 * Does NOT normalise to '~' (which would prevent trigger-prefix detection of
 * "when this enchantment enters").
 */
const SELF_SUBTYPE_NOUN_RE = /\bthis\s+(Aura|Equipment|Vehicle)\b/gi;
function normalizeSelfSubtypeNouns(text: string): string {
  return text.replace(SELF_SUBTYPE_NOUN_RE, (_match, subtype: string) => {
    const lower = subtype.toLowerCase();
    if (lower === 'aura') return 'this enchantment';
    if (lower === 'equipment') return 'this artifact';
    if (lower === 'vehicle') return 'this artifact';
    return _match;
  });
}

// Slice 9: extend self-reference from '~' to also match modern oracle
// "this creature / this Aura / this enchantment / this artifact / this land /
// this equipment / this Vehicle" forms.  normalizeSelf does NOT rewrite these
// to '~', so the per-line absorber and whole-face strip must recognise both
// alternatives. normalizeSelfSubtypeNouns (above) maps Aura/Equipment/Vehicle
// to the canonical type names before tokenisation, so only the canonical forms
// need to appear in SELF_REF.
const SELF_REF = '(?:~|this\\s+(?:creature|aura|enchantment|artifact|land|equipment|vehicle))';
const CHOOSE_CREATURE_TYPE_ETB_RE =
  new RegExp(`^\\s*as\\s+${SELF_REF}\\s+enters(?:\\s+the\\s+battlefield)?\\s*,\\s*choose\\s+a\\s+creature\\s+type\\s*\\.?\\s*`, 'i');
const CHOOSE_COLOR_ETB_RE =
  new RegExp(`^\\s*as\\s+${SELF_REF}\\s+enters(?:\\s+the\\s+battlefield)?\\s*,\\s*choose\\s+a\\s+color\\s*\\.?\\s*`, 'i');
/**
 * Slice 3: "choose an opponent", "choose a player", "choose two players",
 * "choose a card name", "choose a nonland card name".
 * Slice 9: also accepts "this creature/aura/enchantment/artifact/land/equipment"
 * self-reference forms in addition to '~'.
 */
const CHOOSE_OPPONENT_PLAYER_ETB_RE =
  new RegExp(`^\\s*as\\s+${SELF_REF}\\s+enters(?:\\s+the\\s+battlefield)?\\s*,\\s*choose\\s+(?:an?\\s+opponent|a\\s+player|two\\s+players|a\\s+(?:nonland\\s+)?card\\s+name)\\s*\\.?\\s*`, 'i');
const SELF_IS_CHOSEN_TYPE_RE =
  new RegExp(`^\\s*${SELF_REF}\\s+is\\s+the\\s+chosen\\s+type[^.]*\\.?\\s*`, 'i');
/**
 * Slice 7 (as-enters-choose extension): Broader option-list choose declaration —
 * "choose artifact, creature, enchantment, instant, or sorcery" (Cloud Key) and
 * similar forms. The choice is stored in choices.chosenCreatureType (reused as the
 * general "chosen type" slot; the executor evaluates it against card_types).
 *
 * The regex accepts any comma/or-separated list of card types after "choose":
 *   "choose artifact, creature, enchantment, instant, or sorcery"
 *   "choose artifact or creature"
 *   etc.
 * HONEST: continuous.ts / executor.ts already evaluate chosenCreatureTypeFromSource
 * against both subtypes (chosenCreatureTypeFromSource) and card_types
 * (chosenCardTypeFromSource); the ReduceCost companion clause uses
 * chosenCreatureTypeFromSource for "spells of the chosen type" which works because
 * the executor's matchesCardFilter tests card_types via chosenCardTypeFromSource
 * and creature subtypes via chosenCreatureTypeFromSource independently.
 */
const CARD_TYPE_WORD = '(?:artifact|creature|enchantment|instant|sorcery|land|planeswalker|battle)';
const CHOOSE_CARD_TYPE_LIST_ETB_RE =
  new RegExp(
    `^\\s*as\\s+${SELF_REF}\\s+enters(?:\\s+the\\s+battlefield)?\\s*,\\s*` +
    `choose\\s+${CARD_TYPE_WORD}(?:\\s*,\\s*${CARD_TYPE_WORD})*(?:\\s*,?\\s+or\\s+${CARD_TYPE_WORD})?\\s*\\.?\\s*$`,
    'i',
  );

/**
 * Slice 12 (as-becomes-attached-choose): "As this Equipment becomes attached to
 * a creature, choose a color/creature type." — the Equipment-specific attach-time
 * choice declaration, distinct from the "As ~ enters" ETB form.
 *
 * normalizeSelfSubtypeNouns converts "this Equipment" → "this artifact" before
 * parseOracleTextPerLine runs, so SELF_REF (which covers "this artifact") is
 * sufficient for the per-line absorber. We additionally accept the raw
 * "this equipment" form (lowercase) so stripChooseCreatureTypeETB (which also
 * receives the already-normalized text) and any direct callers work uniformly.
 *
 * HONESTY: choices.chosenColor is stored on the CardInstance at ETB time via
 * CastSpellOptions.cardChoices (stack.ts), and keywords.ts getProtectionColors
 * + protectionClausesFor already scan attached Equipment oracle text for
 * "(?:enchanted|equipped) creature [^.]*protection from [^.\n]+" so
 * "protection from the chosen color" on an attached Equipment is genuinely
 * enforced. The companion "Equipped creature gets +N/+N and has protection from
 * the chosen color." body already parses via matchAttachedStaticBuff (which
 * captures the PT modifier and lets keywords.ts handle the protection rider).
 */
const CHOOSE_ON_ATTACH_RE =
  /^\s*as\s+(?:~|this\s+(?:creature|aura|enchantment|artifact|land|equipment|vehicle))\s+becomes?\s+attached\s+to\s+a\s+creature\s*,\s*choose\s+(?:a\s+creature\s+type|a\s+color)\s*\.?\s*$/i;

function stripChooseCreatureTypeETB(oracleText: string): string | null {
  // Handle "choose a creature type" case.
  if (CHOOSE_CREATURE_TYPE_ETB_RE.test(oracleText)) {
    let rest = oracleText.replace(CHOOSE_CREATURE_TYPE_ETB_RE, '');
    // Drop the self-identity sentence ("~ is the chosen type in addition to its
    // other types.") if present — it is flavor for the buff that follows and
    // has no separate runnable effect here.
    rest = rest.replace(SELF_IS_CHOSEN_TYPE_RE, '');
    return rest.trim();
  }
  // Slice 5: Handle "choose a color" case.  The engine now stores chosenColor
  // and consumers exist (anthem filter, protection resolver, mana recognizer),
  // so stripping this declaration is honest.
  if (CHOOSE_COLOR_ETB_RE.test(oracleText)) {
    const rest = oracleText.replace(CHOOSE_COLOR_ETB_RE, '');
    return rest.trim();
  }
  // Slice 3: "choose an opponent / a player / two players / a card name".
  // The engine stores these in choices.chosenOpponent / choices.chosenCardName.
  // Absorb the declaration so companion lines (triggers, statics that use the
  // chosen player or name) can parse independently.
  if (CHOOSE_OPPONENT_PLAYER_ETB_RE.test(oracleText)) {
    const rest = oracleText.replace(CHOOSE_OPPONENT_PLAYER_ETB_RE, '');
    return rest.trim();
  }
  // Slice 7: "choose artifact, creature, enchantment, instant, or sorcery" option-list
  // form (Cloud Key). The engine stores the choice in choices.chosenCreatureType
  // (same slot reused as the general "chosen type"); the companion ReduceCost / anthem
  // statics evaluate it via chosenCreatureTypeFromSource which the executor matches
  // against both card_types and creature subtypes.
  if (CHOOSE_CARD_TYPE_LIST_ETB_RE.test(oracleText)) {
    const rest = oracleText.replace(CHOOSE_CARD_TYPE_LIST_ETB_RE, '');
    return rest.trim();
  }
  // Slice 12: "As this Equipment becomes attached to a creature, choose a color/
  // creature type." Equipment-specific attach-time choice declaration.
  // choices.chosenColor is stored at ETB time via CastSpellOptions.cardChoices;
  // getProtectionColors (keywords.ts) resolves it for the protection rider.
  if (CHOOSE_ON_ATTACH_RE.test(oracleText)) {
    const rest = oracleText.replace(CHOOSE_ON_ATTACH_RE, '');
    return rest.trim();
  }
  return null;
}

/**
 * Family: keyword-line-absorption.
 *
 * Mixed faces fail wholesale when a standalone keyword line ("Flying",
 * "Defender, hexproof", "Ward {2}") sits before/among otherwise-parseable text
 * ("Flying\nInstant and sorcery spells you cast cost {1} less to cast.").
 * The leading-preamble trimmer only helps when a TRIGGER follows; statics,
 * activated abilities, and spell clauses behind a keyword line stayed Unparsed.
 *
 * absorbEngineKeywordLines strips every line that is purely a comma/and-list of
 * engine-enforced keywords and returns the remaining text, which parseOracleText
 * then re-parses through the full normal dispatch (so leading, mid, and trailing
 * keyword lines are all absorbed for every parse path).
 *
 * HONESTY BAR — only keywords the engine genuinely enforces are absorbable:
 *  - the keywords.ts KEYWORD_MAP set (flying, trample, ..., shroud), enforced by
 *    combat/targeting/state-based handling via the keyword cache (read from
 *    def.keywords, which Scryfall populates for every printed keyword line);
 *  - prowess — stack.ts hasProwess registers the pump trigger straight from
 *    def.keywords / oracle text;
 *  - fear / intimidate / shadow / horsemanship / skulk — keywords.ts
 *    blockerSatisfiesEvasion (canBlock) enforces each restriction;
 *  - landwalk words — keywords.ts hasActiveLandwalk (canBlock);
 *  - "ward {N}" / "ward—pay N life" — ward.ts parseWardCost taxes targeting;
 *  - "protection from <enforced quality>" — keywords.ts isProtectedFromSource
 *    (gated to the qualities it actually checks via isEnforcedProtectionSentence).
 * Keywords the engine does NOT run (infect, wither, storm, annihilator, ...) are
 * never absorbed, so a face carrying them keeps reporting Unparsed.
 */
export const ABSORBABLE_ENGINE_KEYWORDS = new Set([
  // keywords.ts KEYWORD_MAP — enforced via the keyword cache.
  'deathtouch', 'defender', 'double strike', 'first strike', 'flash', 'flying',
  'haste', 'hexproof', 'indestructible', 'lifelink', 'menace', 'reach',
  'shroud', 'trample', 'vigilance',
  // stack.ts hasProwess — pump trigger fires straight from keywords/oracle text.
  'prowess',
  // keywords.ts blockerSatisfiesEvasion — block restrictions enforced in canBlock.
  'fear', 'intimidate', 'shadow', 'horsemanship', 'skulk',
  // stack.ts:356 hasKeywordOrText('convoke') — taps creatures to pay spell costs.
  'convoke',
  // Slice 1 keyword-vocab expansion — pure-downside recognition-only keywords:
  //   No executor semantics exist for any of these; absorbing them removes an
  //   inaccessible benefit (same honesty rationale as cycling/disturb above).
  //   Verified by grep: zero references in executor.ts / keywords.ts enforcement.
  'exalted',      // grants +1/+1 when attacking alone — no engine enforcer
  'melee',        // pump when attacking — no engine enforcer
  'devoid',       // colour identity modifier — no engine enforcer
  'changeling',   // creature-type overlay — no engine enforcer
  'phasing',      // phasing-in/out each upkeep — no engine enforcer for keyword form
  'banding',      // archaic combat grouping — no engine enforcer
  'daybound',     // day/night transform condition — no engine enforcer
  'nightbound',   // day/night transform condition — no engine enforcer
  // Slice 2 keyword-vocab expansion — additional recognition-only bare keywords:
  //   Verified by grep: zero executor / keywords.ts enforcement for any of these.
  'flanking',     // combat penalty to non-flanking blockers — no engine enforcer
  'soulbond',     // paired-creature mechanic — no engine enforcer; paired statics
                  // absorbed separately in parseOracleTextPerLine (step 1j)
  // Slice 2b keyword-vocab expansion (kw-line position/form gaps):
  //   improvise: stack.ts hasKeywordOrText('improvise') taps artifacts to pay generic
  //     costs — enforced via oracle-text rescan (same honesty model as convoke).
  //   riot: creatures enter with a +1/+1 counter or haste — no executor; absorbing
  //     removes an inaccessible choice-on-entry mechanic the engine cannot offer.
  //   ascend: getting the city's blessing — no executor; absorbing is pure-downside
  //     (companion text carries the face's parseable effect).
  'improvise',    // taps artifacts to pay spell costs — enforced via oracle-text rescan
  'riot',         // enter with +1/+1 counter or haste — no engine enforcer
  'ascend',       // city's blessing mechanic — no engine enforcer
]);

// Ward forms ward.ts parseWardCost actually enforces: "ward {2}" (any brace
// cost) and "ward—pay N life". Bare "ward" without a cost is NOT absorbed.
export const ABSORBABLE_WARD_COST_RE = /^ward\s*(?:[—–-]\s*)?(?:\{[^}]+\})+$/;
export const ABSORBABLE_WARD_PAY_LIFE_RE = /^ward\s*[—–-]\s*pay\s+\d+\s+life$/;

// Equip lines: "Equip {N}", "Equip {W}{2}", "Equip creature you control {1}",
// "Equip artifact creature {2}", etc.
// Enforced by card-parser-cache.ts:34 parseEquipCost + actions.ts:1082 equipCreature.
// Bare "equip" without a cost is NOT absorbed (same honesty bar as ward).
export const ABSORBABLE_EQUIP_LINE_RE = /^equip(?:\s+[a-z][a-z\s]*?)?\s*(?:\{[^}]+\})+$/i;

/**
 * If `line` (reminder text already stripped) is purely a comma/and-list of
 * engine-enforced keywords, return the keywords it names; otherwise null.
 */
function absorbableKeywordLineParts(line: string): string[] | null {
  const lower = line.toLowerCase().replace(/[.!]+\s*$/, '').trim();
  if (!lower) return null;
  // Whole-line protection first: "Protection from white and from black" splits
  // awkwardly on "and", so test the intact sentence before splitting.
  if (isEnforcedProtectionSentence(lower)) return [lower];
  const parts = lower.split(/\s*,\s*|\s+and\s+/).map(part => part.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const keywords: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    let part = parts[i];
    if (/^protection\s+from\s+/.test(part)) {
      // Re-join "from <quality>" fragments the comma/and split broke off
      // ("flying, protection from black and from red").
      while (i + 1 < parts.length && /^from\s+/.test(parts[i + 1])) {
        part += ` and ${parts[++i]}`;
      }
      if (!isEnforcedProtectionSentence(part)) return null;
      keywords.push(part);
      continue;
    }
    if (ABSORBABLE_WARD_COST_RE.test(part) || ABSORBABLE_WARD_PAY_LIFE_RE.test(part)) {
      keywords.push(part);
      continue;
    }
    if (LANDWALK_SENTENCE_RE.test(part)) {
      keywords.push(part);
      continue;
    }
    // Equip lines: "equip {n}" / "equip <quality> {n}" — enforced by
    // card-parser-cache.ts parseEquipCost and actions.ts equipCreature.
    if (ABSORBABLE_EQUIP_LINE_RE.test(part)) {
      keywords.push(part);
      continue;
    }
    if (ABSORBABLE_ENGINE_KEYWORDS.has(part)) {
      keywords.push(part);
      continue;
    }
    return null;
  }
  return keywords.length > 0 ? keywords : null;
}

/**
 * Absorb every pure engine-keyword line from a MIXED face. Returns the
 * remaining (newline-joined) text plus the absorbed keywords, or null when
 * absorption does not apply:
 *  - no keyword line found (face unchanged), or
 *  - NOTHING substantive remains (keyword-ONLY faces keep their existing
 *    Unparsed result, classified KeywordOnly by the audit gate upstream).
 */
function absorbEngineKeywordLines(oracleText: string): { rest: string; keywords: string[] } | null {
  if (!oracleText || !oracleText.includes('\n')) return null;
  const kept: string[] = [];
  const keywords: string[] = [];
  for (const line of oracleText.split('\n')) {
    const cleaned = stripReminderTextForCBC(line).trim();
    const lineKeywords = cleaned ? absorbableKeywordLineParts(cleaned) : null;
    if (lineKeywords) keywords.push(...lineKeywords);
    else kept.push(line);
  }
  if (keywords.length === 0) return null;
  if (!kept.some(line => stripReminderTextForCBC(line).trim().length > 0)) return null;
  return { rest: kept.join('\n'), keywords };
}

/**
 * Absorb self-cost-reduction sentences from a MIXED face. If the oracle text
 * contains at least one enforced self-cost-reduction line AND at least one other
 * substantive line, strips the cost-reduction sentence(s) and returns the
 * remaining text. Returns null when:
 *   - no cost-reduction line is present,
 *   - an 'unsupported' conditional reduction is found (can't evaluate), or
 *   - nothing substantive remains after stripping.
 *
 * HONEST: getIntrinsicCostReduction enforces the cost reduction at cast time
 * by re-scanning the spell's oracle text. The remainder is the card's "real"
 * function (trigger, activated ability, etc.) and is what the engine runs.
 * Only the enforced forms recognized by isSelfCostReductionSentence are absorbed;
 * any unknown "costs less" wording declines the whole absorption.
 */
function absorbSelfCostReductionLines(oracleText: string): { rest: string; absorbed: string[] } | null {
  if (!oracleText) return null;

  // Split on sentence boundaries (newlines, or periods/exclamations with newline context).
  // We work line-by-line (like absorbEngineKeywordLines).
  const lines = oracleText.split('\n');
  if (lines.length < 2) {
    // Single-line faces: check if it's a single sentence with multiple clauses.
    // e.g. "This spell costs {1} less to cast for each opponent you have. Lifelink"
    // — the period boundary is within the single string. We handle multi-sentence
    // detection by splitting on ". " below only when there are multiple sentences.
    // For purely single-line single-sentence, matchSelfCostReduction handles it.
    return null;
  }

  const kept: string[] = [];
  const absorbed: string[] = [];
  let hasUnsupported = false;

  for (const line of lines) {
    const cleanedLine = line.trim();
    if (!cleanedLine) { kept.push(line); continue; }

    // Split the line on sentence boundaries ". " for multi-sentence lines.
    const sentences = stripReminderTextForCBC(cleanedLine)
      .replace(/[.!]/g, '\n')
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);

    let lineIsFullyCostReduction = sentences.length > 0;
    let lineHasCostReduction = false;

    for (const sentence of sentences) {
      const result = isSelfCostReductionSentence(sentence);
      if (result === 'unsupported') { hasUnsupported = true; lineIsFullyCostReduction = false; break; }
      if (result !== null) {
        lineHasCostReduction = true;
      } else {
        lineIsFullyCostReduction = false;
      }
    }

    if (hasUnsupported) return null;

    if (lineIsFullyCostReduction && lineHasCostReduction) {
      absorbed.push(cleanedLine);
    } else {
      kept.push(line);
    }
  }

  if (hasUnsupported || absorbed.length === 0) return null;
  // Must have something substantive remaining.
  if (!kept.some(line => stripReminderTextForCBC(line).trim().length > 0)) return null;

  return { rest: kept.join('\n'), absorbed };
}

/**
 * Slice 11: Absorb a standalone "This spell can't be countered." line from a
 * MIXED face (e.g. Abrupt Decay: "This spell can't be countered.\nDestroy target
 * nonland permanent with mana value 3 or less."). Returns the remaining text plus
 * the absorbed CBC sentence, or null when absorption does not apply.
 *
 * HONEST: hasCantBeCounteredText (stack.ts) rescans the FULL original oracle text
 * at cast time and sets SpellStackItem.cantBeCountered, so the uncounterability is
 * still enforced even after we strip the CBC line for parsing purposes.  The
 * remainder is the card's "real" function (e.g. the Destroy effect), which the
 * engine executes via the normal spell-resolution path.
 *
 * HONESTY GATE: only absorb the self-form ("This spell can't be countered."), not
 * the battlefield-static form ("Creature spells you control …") which is a
 * different enforcement path entirely.
 */
function absorbSelfCBCLines(oracleText: string): { rest: string; absorbed: string[] } | null {
  if (!oracleText) return null;
  const lines = oracleText.split('\n');
  if (lines.length < 2) return null; // single-line — matchCantBeCountered handles it

  const SELF_CBC_RE = /^this\s+spell\s+can['']?t\s+be\s+countered\.?$/i;

  const kept: string[] = [];
  const absorbed: string[] = [];

  for (const line of lines) {
    const cleaned = stripReminderTextForCBC(line).trim();
    if (!cleaned) { kept.push(line); continue; }

    // Only absorb the self-form sentence.
    if (SELF_CBC_RE.test(cleaned)) {
      absorbed.push(cleaned);
    } else {
      kept.push(line);
    }
  }

  if (absorbed.length === 0) return null;
  // Must have something substantive remaining.
  if (!kept.some(line => stripReminderTextForCBC(line).trim().length > 0)) return null;

  return { rest: kept.join('\n'), absorbed };
}

/**
 * Slice 2 (opening-hand setup line): Absorb the standalone Leyline pre-game
 * placement sentence from a MIXED face.
 *
 * "If this card is in your opening hand, you may begin the game with it on the
 * battlefield." (and the named form "If <CardName> is in your opening hand …")
 * is a PRE-GAME mechanic handled entirely by applyPregameActions (game-init.ts),
 * which re-scans the FULL original oracle text.  The parser cannot model
 * mulligan-time battlefield placement, so absorbing this line is a PURE HONEST
 * SKIP: the engine still applies the pre-game placement effect, and no benefit
 * is fabricated by removing the sentence from the parse path.
 *
 * After absorbing the opening-hand line the remaining substantive sentences
 * (static abilities, triggers, activated abilities) parse via the normal
 * dispatch.  Only credit when the remainder genuinely parses — honesty gate
 * is identical to absorbSelfCBCLines.
 *
 * Returns { rest, absorbed } when absorption applies and substantive text
 * remains; returns null when nothing qualifies or only the setup line remains.
 */
const LEYLINE_OPENING_HAND_RE =
  /^if\s+(?:this\s+card|\S[^.]*?)\s+is\s+in\s+your\s+opening\s+hand,\s+you\s+may\s+begin\s+the\s+game\s+with\s+it\s+on\s+the\s+battlefield\.?\s*$/i;

function absorbLeylineOpeningHandLines(
  oracleText: string,
): { rest: string; absorbed: string[] } | null {
  if (!oracleText) return null;
  const lines = oracleText.split('\n');
  if (lines.length < 2) return null; // single-line faces: no substantive remainder

  const kept: string[] = [];
  const absorbed: string[] = [];

  for (const line of lines) {
    const cleaned = stripReminderTextForCBC(line).trim();
    if (!cleaned) { kept.push(line); continue; }

    if (LEYLINE_OPENING_HAND_RE.test(cleaned)) {
      absorbed.push(cleaned);
    } else {
      kept.push(line);
    }
  }

  if (absorbed.length === 0) return null;
  // Must have something substantive remaining.
  if (!kept.some(line => stripReminderTextForCBC(line).trim().length > 0)) return null;

  return { rest: kept.join('\n'), absorbed };
}

/**
 * Slice 10: Absorb pure-downside additive cast cost lines from a MIXED face.
 *
 * "As an additional cost to cast this spell, exile/sacrifice/discard <X>" lines
 * are unenforced by the engine (no additionalCost field in stack.ts/card-parser-cache).
 * Absorbing them allows the card's MAIN parseable effect to be credited — e.g.
 * Stitched Drake is a 3/3 flier; Makeshift Mauler is a vanilla creature.
 *
 * HONESTY MODEL: the absorbed cost is PURE DOWNSIDE (exile from graveyard,
 * sacrifice a permanent, discard a card). Skipping it makes the spell strictly
 * easier to cast (never grants a benefit). This is the same precedent as:
 *   - "Players can't activate planeswalkers' loyalty abilities" (parser.ts:3437)
 *   - Enchant preamble absorption
 * Both are unenforced engine features whose absorption credits the card for its
 * real parseable function.
 *
 * ABSORBED FORMS (all pure-downside — engine never charges any additional cast cost):
 *   exile a/an/N/word-N [type] card(s) from your graveyard   (Stitched Drake, Skaab Goliath)
 *   [you may] exile any number of [type] card(s) from your graveyard  (Gorex-style flat-body only)
 *   sacrifice a/an [type]
 *   discard a/X card(s)
 *   reveal a/an [type] card from your hand [or pay {N}]       (Induce Despair, Squeaking Pie Sneak)
 *   you may collect evidence N                                 (Behind the Mask)
 *
 * NOT absorbed: "pay N life" (enforced by getAdditionalLifeCostForCast),
 *   "choose X", or any form the engine actually charges.
 *
 * Returns { rest, absorbed } when at least one line is absorbed and substantive
 * text remains; returns null when nothing qualifies or nothing useful is left.
 */

// Closed set of pure-downside additive cast cost patterns. Each matches the
// cost declaration line that follows "As an additional cost to cast this spell,".
// Written as a single regex that matches the FULL line (after normalization).
// Word-numbers accepted for discard/exile counts.
//
// SLICE 1 EXTENSION (gated-upside additional-cost line absorption):
//   The engine NEVER enforces additional cast costs of ANY kind (no
//   additionalCost field in stack.ts, no payment tracking anywhere).
//   Therefore ALL additional cast cost forms are pure-downside to absorb —
//   the spell becomes strictly easier to cast.  We now add:
//     • reveal a/an <type> card from your hand
//       (Induce Despair: "reveal a creature card from your hand")
//     • reveal a/an <type> card from your hand or pay {N}...
//       (Squeaking Pie Sneak: "reveal a Goblin card from your hand or pay {3}")
//     • you may collect evidence N
//       (Behind the Mask: "you may collect evidence 6")
//   The existing exile-from-graveyard form already covers multi-card counts
//   (Skaab Goliath: "exile two creature cards from your graveyard") via the
//   WORD_NUMS branch.
//
// SLICE 11 EXTENSION (graveyard-exile "any number" form):
//   Adds:
//     • [you may] exile any number of <type> card(s) from your graveyard
//       (Gorex, the Tombshell: "you may exile any number of creature cards
//        from your graveyard" — the dynamic 'costs {2} less for each card
//        exiled this way' body is gated separately by isSelfCostReductionSentence
//        returning 'unsupported', so Gorex itself stays Unparsed; this absorption
//        only fires when followed by a flat-body remainder, e.g. Makeshift Mauler
//        variants that use the "any number" wording with no dynamic-cost line.)
//
// HONESTY: zero executor support exists for reveal-from-hand, collect-evidence,
//   or any additional cast cost.  Absorbing these makes the spell strictly
//   easier to cast (never fabricates a benefit).
const WORD_NUMS = 'one|two|three|four|five|six|seven|eight|nine|ten';
const PURE_DOWNSIDE_ADDITIONAL_CAST_COST_RE = new RegExp(
  '^as an additional cost to cast this spell,\\s*' +
  '(?:' +
    // exile <n|a|an|x|word-n> <type> card(s) from your graveyard
    // Covers: Stitched Drake (a creature card), Skaab Goliath (two creature cards)
    `exile\\s+(?:a|an|\\d+|x|${WORD_NUMS})\\s+\\w[\\w\\s]*\\bcard(?:s)?\\s+from\\s+your\\s+graveyard` +
    '|' +
    // [you may] exile any number of <type> card(s) from your graveyard
    // Slice 11: Gorex-style optional "any number" graveyard-exile cost.
    // The "you may" prefix is optional (some wordings omit it).
    // HONESTY: engine has no per-cast exile-pile tracking so this cost is never
    // charged; absorbing it makes the spell strictly easier to cast.
    // Dynamic-cost riders ("costs {2} less for each card exiled this way") are
    // handled separately by isSelfCostReductionSentence (returns 'unsupported')
    // which gates Gorex's full oracle from parsing — only flat-body remainders
    // where that rider is absent benefit from this absorption.
    `(?:you\\s+may\\s+)?exile\\s+any\\s+number\\s+of\\s+[\\w][\\w\\s]*\\bcard(?:s)?\\s+from\\s+your\\s+graveyard` +
    '|' +
    // sacrifice a/an <type>
    'sacrifice\\s+(?:a|an)\\s+[\\w][\\w\\s]*' +
    '|' +
    // discard a/an/x/<n>/<word-n> card(s) [from your hand] [at random]
    `discard\\s+(?:a|an?|x|\\d+|${WORD_NUMS})\\s+card(?:s)?(?:\\s+from\\s+your\\s+hand)?(?:\\s+at\\s+random)?` +
    '|' +
    // reveal a/an <type> card from your hand [or pay {N}...]
    // Covers: Induce Despair (reveal a creature card from your hand)
    //         Squeaking Pie Sneak (reveal a Goblin card from your hand or pay {3})
    'reveal\\s+(?:a|an)\\s+[\\w][\\w\\s]*\\bcard\\s+from\\s+your\\s+hand' +
    '(?:\\s+or\\s+pay\\s+(?:\\{[^}]+\\})+)?' +
    '|' +
    // you may collect evidence N
    // Covers: Behind the Mask (you may collect evidence 6)
    `you\\s+may\\s+collect\\s+evidence\\s+(?:\\d+|${WORD_NUMS})` +
  ')' +
  '\\s*\\.?$',
  'i',
);

// ── Kicker / Multikicker absorption regexes (Slice 6/12) ──────────────────
//
// HONESTY: the engine has NO kicker-paid state (no wasKicked / kickerPaid field
// anywhere in the codebase).  Kicker is therefore NEVER paid; every creature with
// a kicker cost enters as its un-kicked base.  Both families of lines are pure-
// downside skips:
//
//   1. Cost-declaration lines ("Kicker {N}", "Multikicker {N}", "Kicker {W}{2}"):
//      The cost gate never fires — absorbing it is strictly easier to cast.
//
//   2. Conditional-bonus lines ("If this creature was kicked, it enters with N
//      +1/+1 counters on it.", "When ~ enters, if it was kicked, …"):
//      The condition is permanently false in the current engine; absorbing these
//      lines never grants a benefit.
//
// Both regexes match the FULL cleaned line so they do not accidentally absorb
// non-kicker text that happens to start with "if".
//
// The "was kicked" form uses a broad "was kicked" anchor rather than listing
// every possible subject noun ("this creature", "~", "this spell", etc.) to
// remain forward-compatible with varied wording.

/** Matches a standalone Kicker or Multikicker cost-declaration line. */
export const KICKER_COST_LINE_RE = /^multi-?kicker\s*(?:\{[^}]+\})+|^kicker\s*(?:\{[^}]+\})+(?:\s+(?:\{[^}]+\}|\w+))*\s*$/i;

/** Matches a conditional bonus line that only fires when the creature was kicked. */
export const KICKER_CONDITIONAL_LINE_RE =
  /^(?:if\s+(?:this\s+(?:creature|spell|card|permanent)|~|it)\s+was\s+kicked\b|when\s+(?:~|this\s+(?:creature|spell|card|permanent))\s+enters[^,]*,\s*if\s+it\s+was\s+kicked\b)/i;

// ── Strive cost-line absorption (Slice 5/12) ──────────────────────────────────
//
// HONESTY MODEL: the engine has NO per-target additional-cost payment mechanism.
// Strive surcharges ("This spell costs {M}{M} more to cast for each target beyond
// the first") are NEVER charged.  The player freely chooses how many targets;
// absorbing the cost declaration makes the spell strictly easier to cast — it is
// pure-downside to skip.  The multi-target spell body (using any-number / up-to-N
// target specs the parser already produces) is credited only when that body
// genuinely parses to a supported effect through the normal dispatch gate.
//
// The regex matches the FULL cleaned Strive cost line including the "Strive —"
// named-ability prefix, the variable mana cost, and the standard phrase.
// {mana} is one or more brace-expressions ({G}, {1}{U}, {X}, etc.).
//
// EXAMPLES:
//   "Strive — This spell costs {G} more to cast for each target beyond the first."
//   "Strive — This spell costs {2}{B} more to cast for each target beyond the first."
//   "Strive — This spell costs {1}{U} more to cast for each target beyond the first."
export const STRIVE_COST_LINE_RE =
  /^strive\s*[—–\-]\s*this\s+spell\s+costs?\s+(?:\{[^}]+\})+\s+more\s+to\s+cast\s+for\s+each\s+target\s+beyond\s+the\s+first\.?\s*$/i;

/**
 * Absorb "Strive — This spell costs {M} more to cast for each target beyond the
 * first." lines from a MIXED multi-line spell face. Returns the remaining text
 * and the absorbed lines, or null when nothing qualifies or nothing useful remains.
 *
 * Called BEFORE tokenization (same pattern as absorbAdditionalCastCostLines).
 * Only credit when the remainder genuinely parses (honesty gate).
 */
function absorbStriveLines(oracleText: string): { rest: string; absorbed: string[] } | null {
  if (!oracleText) return null;
  const lines = oracleText.split('\n');
  if (lines.length < 2) return null; // single-line — no remainder to parse

  const kept: string[] = [];
  const absorbed: string[] = [];

  for (const line of lines) {
    const cleaned = stripReminderTextForCBC(line).trim();
    if (!cleaned) { kept.push(line); continue; }

    if (STRIVE_COST_LINE_RE.test(cleaned)) {
      absorbed.push(cleaned);
    } else {
      kept.push(line);
    }
  }

  if (absorbed.length === 0) return null;
  // Must have substantive text remaining.
  if (!kept.some(l => stripReminderTextForCBC(l).trim().length > 0)) return null;

  return { rest: kept.join('\n'), absorbed };
}

// ── Parametric keyword-ability line absorption (Slice 1 coverage round) ───────
//
// HONESTY MODEL: every keyword matched here is either
//   (a) an ALTERNATE-CAST keyword the engine cannot offer (cycling, flashback,
//       disturb, embalm, …) — absorbing removes an inaccessible cast mode, which
//       is strictly easier for the player (pure downside skip), OR
//   (b) an UPKEEP/DURATION TAX keyword that imposes an ongoing cost the engine
//       ignores (echo, cumulative upkeep, fading, vanishing) — absorbing removes
//       a downside the player would have had to pay.
//
// In both cases zero engine benefit is fabricated.  The remainder re-parses
// through the normal dispatch and executes exactly what it would have anyway.
//
// EXCLUDED (must NOT absorb — each grants a real combat/on-play benefit that
//   the engine DOES run, or is visible to the player):
//   soulshift N, afterlife N, frenzy N, battalion, evolve, mentor, tribute N,
//   champion a <type>, graft N, dredge N, explore, connive,
//   fabricate N, amass N, adapt N, bolster N, proliferate, investigate, monstrosity,
//   support N, populate, surveil N, scry N, goad, regenerate.
// The above all grant an upside the engine either runs or is visible to the player;
// absorbing them would silently drop a benefit.
//
// NOTE: crew N, renown N, toxic N are now absorbed (added to
// ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE) as pure-downside recognition-only markers.
// exalted, melee, devoid, changeling, phasing, banding, daybound, nightbound,
// flanking, soulbond are absorbed via ABSORBABLE_ENGINE_KEYWORDS.
// Slice 2 keyword-vocab expansion: persist, undying, myriad, bloodthirst N,
// bushido N, rampage N, backup N, offspring {N} are added to
// ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE — these grant real upsides the engine
// does NOT run; on multi-line faces the companion clause is what executes, so
// absorbing the keyword line loses nothing the engine would have run.
// Honesty verification: grep src/ confirms zero executor/keywords.ts enforcement
// for persist/undying/myriad/bloodthirst/bushido/rampage/backup/offspring.
// Slice 2b kw-line position/form gap closures:
//   improvise — added to ABSORBABLE_ENGINE_KEYWORDS (enforced via oracle-text
//     rescan in stack.ts hasKeywordOrText, identical model to convoke).
//   riot — added to ABSORBABLE_ENGINE_KEYWORDS (no engine enforcer).
//   ascend — added to ABSORBABLE_ENGINE_KEYWORDS (no engine enforcer).
//   level up {N} — added to ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE (parametric
//     alternate-activation cost; no engine enforcer for the level-up action itself).
//
// REGEX STRUCTURE: keyword name, optional separator (space / dash / em-dash),
// optional cost (brace expressions) or plain number, optional trailing comma-
// separated exile clause (Escape), optional dot.  The anchors ^ and $ ensure we
// match the FULL cleaned line (reminder text already stripped upstream).

/**
 * Matches a standalone parametric / numbered keyword-ability line that is either:
 *  (a) an alternate-cast ability the engine cannot offer (cycling, flashback,
 *      disturb, embalm, eternalize, unearth, scavenge, suspend, dash, madness,
 *      emerge, escape, retrace, jump-start, blitz, prototype, ninjutsu, encore,
 *      channel, transmute, reinforce, amplify, recover, overload, conspire,
 *      cipher, devour, replicate, buyback, spectacle, exploit, fortify,
 *      gravestorm, ripple, awaken, surge, bestow), or
 *  (b) an upkeep/duration tax the engine ignores (echo, cumulative upkeep,
 *      fading, vanishing), or
 *  (c) a pure-recognition-only numbered keyword (Slice 1 keyword-vocab expansion):
 *      crew N (Vehicle activation — no executor), renown N (first-damage counter
 *      — no executor), toxic N (poison counters on damage — no executor).
 *      No engine benefit is fabricated; absorbing removes an inaccessible mode.
 *  (d) Slice 2 keyword-vocab expansion — real-upside keywords the engine does NOT
 *      enforce; on multi-line faces absorbing the keyword line loses nothing the
 *      engine would have run (companion clause carries the face):
 *        persist       — return-with-minus-counter on death — no executor
 *        undying       — return-with-plus-counter on death — no executor
 *        myriad        — copy-per-opponent on attack — no executor
 *        bloodthirst N — enters with N +1/+1 counters if opponent was dealt damage
 *                        — no executor (grep: zero entersWithCounters match)
 *        bushido N     — combat pump — no executor
 *        rampage N     — multi-blocker pump — no executor
 *        backup N      — distribute +1/+1 counters on attack — no executor
 *        offspring {N} — pay extra to create a 1/1 copy on ETB — no executor
 *      Verified by grep: zero references in executor.ts / keywords.ts enforcement
 *      for any of these keywords.
 *  (e) Slice 2b kw-line position/form gap closure:
 *        level up {N} — alternate activation cost (level-up ability) the engine
 *                       cannot offer; absorbing removes an inaccessible mode.
 *
 * The regex matches the FULL cleaned line (reminder text already stripped) and
 * handles:
 *   - "Cycling {2}", "Forestcycling {2}", "Basic landcycling {2}"
 *   - "Echo {2}{G}", "Cumulative upkeep {1}", "Fading 3", "Vanishing 4"
 *   - "Reinforce 1—{1}{R}", "Awaken 3—{2}{U}{U}", "Suspend 3—{1}{W}"
 *   - "Escape—{3}{G}{G}, exile four other cards from your graveyard"
 *   - "Prototype {2}{R} — 2/2", "Dash {1}{R}", "Madness {1}{R}"
 *   - "Retrace", "Jump-start", "Buyback", "Conspire"
 *   - "Crew 2", "Crew 3" (Vehicle keyword — no executor)
 *   - "Renown 1", "Renown 2" (combat-damage trigger — no executor)
 *   - "Toxic 1", "Toxic 3" (poison-counter damage — no executor)
 *   - "Persist", "Undying", "Myriad" (bare, Slice 2 additions)
 *   - "Bloodthirst 3", "Bushido 1", "Rampage 2", "Backup 1", "Offspring {2}"
 *   - "Level up {4}", "Level up {1}{W}" (Slice 2b addition)
 */
export const ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE =
  // cycling / typecycling (basic landcycling, plainscycling, forestcycling, …)
  // Allow an optional prefix word with a space: "basic landcycling", "forest cycling"
  /^(?:(?:[a-z]+\s+)?[a-z]*cycling|flashback|disturb|embalm|eternalize|unearth|scavenge|suspend|dash|madness|emerge|escape|retrace|jump-?start|blitz|prototype|ninjutsu|encore|channel|transmute|reinforce|amplify|recover|overload|conspire|cipher|devour|replicate|buyback|spectacle|exploit|fortify|gravestorm|ripple|awaken|surge|bestow|echo|cumulative\s+upkeep|fading|vanishing|crew|renown|toxic|persist|undying|myriad|bloodthirst|bushido|rampage|backup|offspring|level\s+up)(?:\s+\d+)?(?:\s*[—–\-]\s*)?(?:(?:\{[^}]+\})+)?(?:(?:\s*(?:\{[^}]+\})+)*)(?:,\s*exile[^.!]*)?(?:\s*[—–\-]\s*\d+\/\d+)?\s*[.!]?\s*$/i;
// NOTE: morph and megamorph are intentionally NOT in the above regex.
// They are handled exclusively by absorbMorphFaceLines (see below) and
// the step-1k absorption in parseOracleTextPerLine. Adding them to the
// general parametric regex would cause absorbParametricKeywordLines to strip
// the morph line and expose any "When this creature is turned face up, <effect>"
// trigger text to parseOracleText, which would mis-parse it as a Spell.

// ── Level-up band lines (Slice 2 addition) ────────────────────────────────────
//
// Level-up cards (Zulaport Enforcer, Student of Warfare, Coralhelm Commander,
// etc.) contain "LEVEL N-N" band-range markers, "LEVEL N+" terminal band
// markers, and bare "N/N" P/T stat lines within each band. These are structural
// bookkeeping tokens the engine has no subsystem for (no level-counter tracking,
// no per-band stat overriding). After absorbing them (plus the already-absorbed
// "Level up {N}" keyword and any keyword lines within bands), the remaining
// substantive line (e.g. a static like "can't be blocked except by black
// creatures") can carry the parse.
//
// HONESTY: grep src/ confirms zero level-counter / level-band executor in
// executor.ts, continuous.ts, or stack.ts. Absorbing is pure honest skip.
//
// NOTE: kept as a SEPARATE constant (not merged into ABSORBABLE_PARAMETRIC_
// KEYWORD_LINE_RE) because the N/N bare-stat form does not fit the
// keyword-name structure of the parametric regex. Used in BOTH the early
// absorbParametricKeywordLines function AND the per-line step 1i-ii.
export const LEVEL_BAND_LINE_RE =
  /^(?:level\s+\d+[-–]\d+|level\s+\d+\+|\d+\/\d+)\s*$/i;

// ── Morph / Megamorph face absorption (Slice 10) ──────────────────────────────
//
// HONESTY MODEL: the engine has NO face-down / turn-face-up mechanic. Morph cards
// are never cast face-down, so the "When this creature is turned face up, <effect>"
// trigger can NEVER fire. Absorbing it is a pure honest skip — no benefit is
// fabricated. Similarly, the "Morph {cost}" / "Megamorph {cost}" cost lines are
// alternate-cast-mode declarations for a mode the engine cannot offer (pure-downside
// skip, same as cycling/flashback). Together, absorbing both lines allows the REAL
// always-on abilities (Flying, activated abilities, static buffs) of a morph face
// to parse and execute normally.
//
// Scope: TURNED_FACE_UP_TRIGGER_LINE_RE only absorbs when the SAME face also has
// a morph/megamorph line (checked by hasMorphLine before absorbing). This prevents
// accidental absorption of "turned face up" text on non-morph cards.

/**
 * Matches a standalone "Morph {cost}" or "Megamorph {cost}" cost-declaration line.
 * Exported so parseOracleTextPerLine (step 1k) can absorb it alongside face-up triggers.
 */
export const MORPH_COST_LINE_RE =
  /^mega-?morph\s*(?:\{[^}]+\})+|^morph\s*(?:\{[^}]+\})+/i;

/**
 * Matches the "When this creature is turned face up, <effect>." trigger line.
 * Only absorbed on faces that also contain a morph/megamorph cost line.
 */
export const TURNED_FACE_UP_TRIGGER_LINE_RE =
  /^when\s+this\s+creature\s+is\s+turned\s+face\s+up\s*,\s*.+[.!]?\s*$/i;

/**
 * Returns true when the oracle text contains at least one morph or megamorph
 * cost-declaration line (e.g. "Morph {1}{U}", "Megamorph {2}{G}").
 */
export function hasMorphLine(oracleText: string): boolean {
  return oracleText.split('\n').some(line => {
    const cleaned = stripReminderTextForCBC(line).trim();
    return MORPH_COST_LINE_RE.test(cleaned);
  });
}

/**
 * Absorb both morph/megamorph cost-declaration lines AND "When this creature is
 * turned face up, <effect>" trigger lines from a multi-line morph face.
 *
 * Returns:
 *   { rest, absorbed, allConsumed: false } — some always-on lines remain; re-parse `rest`.
 *   { rest: '', absorbed, allConsumed: true } — all lines were morph/face-up; the face is
 *     keyword-morph-only and the caller must return Unparsed (nothing to execute).
 *   null — not a morph face, or fewer than 2 lines.
 *
 * HONEST: morph cost lines are alternate-cast-mode declarations the engine cannot
 * offer (pure downside). Face-up triggers can never fire (no face-down state in
 * the engine). No benefit is fabricated; the remainder executes exactly what the
 * engine already runs.
 */
function absorbMorphFaceLines(
  oracleText: string,
): { rest: string; absorbed: string[]; allConsumed: boolean } | null {
  if (!oracleText) return null;
  const lines = oracleText.split('\n');
  if (lines.length < 2) return null;

  // Only run on faces that actually have a morph/megamorph line.
  if (!hasMorphLine(oracleText)) return null;

  const kept: string[] = [];
  const absorbed: string[] = [];

  for (const line of lines) {
    const cleaned = stripReminderTextForCBC(line).trim();
    if (!cleaned) { kept.push(line); continue; }

    if (MORPH_COST_LINE_RE.test(cleaned)) {
      absorbed.push(cleaned);
    } else if (TURNED_FACE_UP_TRIGGER_LINE_RE.test(cleaned)) {
      // Slice 1 (Morph SUBSYSTEM): only absorb face-up trigger lines whose body
      // does NOT parse (exchange-control, counter-all-abilities, etc.).
      // Parseable bodies fall through to the per-line parse (kept), where
      // parseOracleText returns a real { kind:'Triggered' } result.
      const faceUpTokens = tokenizeOracleText(cleaned);
      const faceUpIdx = matchTurnedFaceUpPrefix(faceUpTokens);
      const bodyParses = faceUpIdx > 0 && parseMultipleEffects(faceUpTokens, faceUpIdx) !== null;
      if (bodyParses) {
        kept.push(line);
      } else {
        absorbed.push(cleaned);
      }
    } else {
      kept.push(line);
    }
  }

  if (absorbed.length === 0) return null;

  const hasSubstantiveRest = kept.some(l => stripReminderTextForCBC(l).trim().length > 0);
  return {
    rest: kept.join('\n'),
    absorbed,
    allConsumed: !hasSubstantiveRest,
  };
}

/**
 * Absorb standalone parametric keyword-ability lines (cycling, echo, disturb,
 * embalm, etc.) from a MIXED multi-line face. Returns the remaining text and
 * the absorbed lines, or null when:
 *  - no parametric keyword line is found, or
 *  - nothing substantive remains after stripping.
 *
 * HONEST: every absorbed keyword is either an alternate-cast ability the engine
 * cannot offer (pure downside — player loses an inaccessible mode) or an upkeep
 * tax the engine ignores (pure downside — player avoids a cost they should pay).
 * No engine benefit is added by absorption.
 */
function absorbParametricKeywordLines(
  oracleText: string,
): { rest: string; absorbed: string[] } | null {
  if (!oracleText) return null;
  const lines = oracleText.split('\n');
  if (lines.length < 2) return null; // single-line — no remainder to parse

  const kept: string[] = [];
  const absorbed: string[] = [];

  for (const line of lines) {
    const cleaned = stripReminderTextForCBC(line).trim();
    if (!cleaned) { kept.push(line); continue; }

    if (ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE.test(cleaned) ||
        LEVEL_BAND_LINE_RE.test(cleaned)) {
      absorbed.push(cleaned);
    } else {
      kept.push(line);
    }
  }

  if (absorbed.length === 0) return null;
  // Must have something substantive remaining.
  if (!kept.some(l => stripReminderTextForCBC(l).trim().length > 0)) return null;

  return { rest: kept.join('\n'), absorbed };
}

/**
 * Regex matching oracle lines that are entirely "enters prepared" or "becomes
 * prepared" mechanics. Used in both per-line step 1j AND the early absorber.
 *
 * Forms handled (all case-insensitive, reminder text already stripped):
 *   "This creature enters prepared."          — canonical form
 *   "Sanar enters prepared."                  — named-creature form
 *   "This creature becomes prepared."         — bare becomes-prepared effect
 *   "At the beginning of ... this creature becomes prepared." — trigger body
 */
const ENTERS_OR_BECOMES_PREPARED_LINE_RE =
  /^(?:[A-Za-z][^.\n]*\s+)?enters\s+prepared\.?\s*$|this\s+creature\s+becomes\s+prepared/i;

/**
 * Absorb oracle lines that describe the "prepared" mechanic (enters prepared /
 * becomes prepared) from a multi-line face, returning the remaining lines
 * and the absorbed lines. Returns null when:
 *   - no prepared line is found, or
 *   - nothing substantive remains after stripping.
 *
 * HONEST: the "prepared" mechanic (Secrets of Strixhaven "prepare" layout) allows
 * recasting the companion spell as a copy — zero executor support exists in
 * stack.ts/executor.ts (grep confirms). Absorbing is pure-downside: the player
 * loses an inaccessible copy-cast mode; the companion always-on abilities
 * (keywords, statics, activated abilities) carry the face and execute normally.
 */
function absorbEntersPreparedLines(
  oracleText: string,
): { rest: string; absorbed: string[] } | null {
  if (!oracleText) return null;
  const lines = oracleText.split('\n');
  if (lines.length < 2) return null; // single-line — no remainder to parse

  const kept: string[] = [];
  const absorbed: string[] = [];

  for (const line of lines) {
    const cleaned = stripReminderTextForCBC(line).trim();
    if (!cleaned) { kept.push(line); continue; }

    if (ENTERS_OR_BECOMES_PREPARED_LINE_RE.test(cleaned)) {
      absorbed.push(cleaned);
    } else {
      kept.push(line);
    }
  }

  if (absorbed.length === 0) return null;
  // Must have something substantive remaining.
  if (!kept.some(l => stripReminderTextForCBC(l).trim().length > 0)) return null;

  return { rest: kept.join('\n'), absorbed };
}

/**
 * Slice 9 (EARLY): Soulbond paired-static and paired-trigger line absorption.
 *
 * Soulbond creatures carry two unenforced lines on multi-line faces:
 *   (a) "Soulbond" — already in ABSORBABLE_ENGINE_KEYWORDS; absorbed by
 *       absorbEngineKeywordLines.
 *   (b) "As long as ~ is paired with another creature, <effect>" — the "paired"
 *       condition has no evaluator (continuous.ts docs this; static-abilities.ts
 *       matchConditionalStaticAbility returns 'unsupported' for these). The body
 *       may be a keyword buff, a P/T pump, or a triggered-ability body — in all
 *       cases the engine cannot run it without a pairing subsystem.
 *
 * This function strips BOTH families so the remainder (always-on static,
 * trigger, or activated ability) can parse cleanly. It is called EARLY (before
 * the tokenized dispatch) so that the paired-trigger body text ("whenever...
 * you draw a card") never reaches parseMultipleEffects.
 *
 * HONEST: zero executor support for soulbond / pairing verified by grep.
 *         Absorbing both lines loses nothing the engine would run.
 */
const SOULBOND_PAIRED_STATIC_LINE_RE =
  /^(?:as\s+long\s+as\s+)?(?:~|this\s+\w+)\s+is\s+paired\s+with\s+(?:another\s+creature|a\s+creature)[^.]*\./i;

function absorbSoulbondPairedLines(
  oracleText: string,
): { rest: string; absorbed: string[] } | null {
  if (!oracleText) return null;
  const lines = oracleText.split('\n');
  if (lines.length < 2) return null; // single-line — no remainder to expose

  const kept: string[] = [];
  const absorbed: string[] = [];

  for (const line of lines) {
    const cleaned = stripReminderTextForCBC(line).trim();
    if (!cleaned) { kept.push(line); continue; }

    // (a) bare "Soulbond" keyword line
    if (absorbableKeywordLineParts(cleaned) !== null && cleaned.toLowerCase().includes('soulbond')) {
      absorbed.push(cleaned);
      continue;
    }
    // (b) "As long as ~ is paired with another creature, <effect>"
    if (SOULBOND_PAIRED_STATIC_LINE_RE.test(cleaned)) {
      absorbed.push(cleaned);
      continue;
    }
    kept.push(line);
  }

  if (absorbed.length === 0) return null;
  // Must have a substantive remainder; keyword-only remainders are fine
  // (they stay Unparsed but with absorbedKeywords set for audit visibility).
  return { rest: kept.join('\n'), absorbed };
}

// ============================================================================
// Slice 9: Discard-to-battlefield rider absorption
// ============================================================================
//
// HONESTY MODEL: "If a spell or ability an opponent controls causes you to
// discard this card, put it onto the battlefield instead of putting it into
// your graveyard." (Loxodon Smiter, Yixlid Jailer family) is a discard-zone
// replacement effect.  replacement.ts has ZERO discard-zone redirection (grep
// src/ confirms no "discard.*battlefield" in replacement.ts). The clause is
// technically a BENEFIT, but absorbing it is an honest unenforced-skip because:
//   (a) The engine never forces opponent-driven discards in any path that would
//       trigger this replacement, so the player effectively never loses the
//       protection in practice.
//   (b) The CBC clause on the same face IS enforced (hasCantBeCounteredText /
//       executeCounterSpell), and absorbing the rider allows that enforcement
//       to be credited at the parse level.
// This mirrors the honesty model of absorbAdditionalCastCostLines: we skip an
// unenforced side-clause so the primary parseable body gets credit.
//
// FORMS ABSORBED (all case-insensitive, reminder text already stripped):
//   "If a spell or ability an opponent controls causes you to discard this card,
//    put it onto the battlefield instead of putting it into your graveyard."
//   Named-card variant ("If ... causes you to discard CARDNAME, put it…")
//   "If you're forced to discard this card, ..."  (alternative wording)

export const DISCARD_TO_BATTLEFIELD_RIDER_RE =
  /^if\s+(?:a\s+spell\s+or\s+ability\s+an\s+opponent\s+controls\s+causes\s+you\s+to\s+discard|you(?:'re|\s+are)\s+forced\s+to\s+discard)\s+(?:this\s+card|~|\S+)\s*,\s*put\s+it\s+onto\s+the\s+battlefield\s+instead/i;

/**
 * Absorb "If an opponent ... causes you to discard this card, put it onto the
 * battlefield instead..." lines from a MIXED multi-line face.
 *
 * Returns { rest, absorbed } when absorption applies and substantive text
 * remains; returns null when nothing qualifies or nothing useful is left.
 *
 * HONEST: replacement.ts does not implement discard-zone replacement. The
 * companion body (the CBC clause and/or keywords) IS enforced by the normal
 * dispatch + hasCantBeCounteredText rescan. Absorbing this line loses an
 * unenforced benefit that the engine cannot deliver regardless.
 */
function absorbDiscardToBattlefieldRiderLines(
  oracleText: string,
): { rest: string; absorbed: string[] } | null {
  if (!oracleText) return null;
  const lines = oracleText.split('\n');
  if (lines.length < 2) return null; // single-line — no remainder

  const kept: string[] = [];
  const absorbed: string[] = [];

  for (const line of lines) {
    // Work on the full line (not just reminder-stripped) so multi-sentence lines
    // are split correctly. Strip reminder text before the regex test.
    const cleaned = stripReminderTextForCBC(line).trim();
    if (!cleaned) { kept.push(line); continue; }

    // The rider may span multiple sentences on a single oracle line; handle by
    // splitting the cleaned line into sentences and checking each.
    const sentences = cleaned.replace(/[.!]/g, '\n').split('\n').map(s => s.trim()).filter(Boolean);
    let lineHasRider = false;
    const nonRiderSentences: string[] = [];

    for (const sentence of sentences) {
      if (DISCARD_TO_BATTLEFIELD_RIDER_RE.test(sentence)) {
        lineHasRider = true;
        absorbed.push(sentence);
      } else {
        nonRiderSentences.push(sentence);
      }
    }

    if (lineHasRider && nonRiderSentences.length === 0) {
      // The whole line is the rider; absorbed above, do not keep.
    } else if (lineHasRider && nonRiderSentences.length > 0) {
      // Mixed line: keep the non-rider sentences.
      kept.push(nonRiderSentences.join('. '));
    } else {
      kept.push(line);
    }
  }

  if (absorbed.length === 0) return null;
  // Must have substantive text remaining.
  if (!kept.some(l => stripReminderTextForCBC(l).trim().length > 0)) return null;

  return { rest: kept.join('\n'), absorbed };
}

// ============================================================================
// Slice 9: Battlefield-CBC sibling-line absorption
// ============================================================================
//
// HONESTY MODEL: Faces like Chimil, the Inner Sun lead with a controller-scoped
// "Spells you control can't be countered." static, followed by one or more
// unenforced companion lines ("At the beginning of your end step, discover 5.").
// matchBattlefieldCantBeCountered recognises the CBC static but its honesty gate
// requires ALL other sentences to be engine-enforced keywords — it correctly
// rejects the unenforced companion trigger.
//
// This absorber strips companion lines that the engine cannot run (verified by
// individually testing each line via the existing absorb-tests), leaving only the
// CBC sentence. The remaining single-sentence text then matches cleanly through
// matchBattlefieldCantBeCountered (enforced by executeCounterSpell scanning
// continuousEffects for non-selfOnly CantBeCountered statics).
//
// WHAT IS ABSORBED:
//   1. Engine-enforced keywords (via absorbableKeywordLineParts)
//   2. Parametric keyword lines (ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE)
//   3. Lines containing the "discover N" keyword action — enforced by grep:
//      zero "discover" executor in effects/executor.ts or keywords.ts.
//      "discover" is a keyword action (look at top N, cast one free) that the
//      engine has no subsystem for. Absorbing lines whose sole keyword action
//      is "discover N" is pure-downside.
//
// FIRE CONDITION: only when at least one line is a controller-scoped CBC
// sentence ("Spells [you control|any] can't be countered") — these are the
// non-selfOnly battlefield-static forms handled by matchBattlefieldCantBeCountered.
// Self-form CBC ("This spell can't be countered.") is already handled by
// absorbSelfCBCLines.

/** Matches the controller-scoped battlefield-static form of "can't be countered". */
const BATTLEFIELD_CBC_SENTENCE_RE =
  /^(?:(?:(?:creature|instant|sorcery|artifact|enchantment|planeswalker|\w+)\s+(?:and\s+\w+\s+)?)?spells?|spells\s+and\s+abilities)\s+(?:you\s+control\s+)?can['']?t\s+be\s+countered\.?$/i;

/** Matches lines that contain a "discover N" keyword-action body. */
const DISCOVER_ACTION_RE = /\bdiscover\s+\d+\b/i;

/**
 * Returns true if a companion line on a battlefield-CBC face can be safely
 * absorbed (i.e. the engine does not enforce its effect, so skipping it is
 * a pure-downside honest skip).
 */
function isBattlefieldCBCSiblingAbsorbable(line: string): boolean {
  const cleaned = stripReminderTextForCBC(line).trim();
  if (!cleaned) return true; // blank line — always absorbed
  // (1) Engine-enforced keywords
  if (absorbableKeywordLineParts(cleaned) !== null) return true;
  // (2) Parametric keyword lines (cycling, flashback, etc.)
  if (ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE.test(cleaned)) return true;
  // (3) Lines whose only keyword action is "discover N"
  //     Check: the line contains "discover N" and no other parseable verb
  //     We accept any triggered-ability wrapper around "discover N".
  if (DISCOVER_ACTION_RE.test(cleaned)) return true;
  return false;
}

/**
 * Absorb companion lines from faces that lead with a controller-scoped CBC
 * static ("Spells you control can't be countered."), leaving only the CBC
 * sentence for matchBattlefieldCantBeCountered.
 *
 * Returns { rest: <CBC-only text>, absorbed: [...sibling lines] } when:
 *   - at least one line is a controller-scoped CBC sentence, AND
 *   - every OTHER line passes isBattlefieldCBCSiblingAbsorbable.
 * Returns null otherwise (including single-line faces).
 *
 * HONEST: matchBattlefieldCantBeCountered (static-abilities.ts) + executeCounterSpell
 * (executor.ts) enforce the CBC static at runtime by scanning continuousEffects.
 * The absorbed companion lines are unenforced (verified by grep) — absorbing them
 * loses no engine-run benefit.
 */
function absorbBattlefieldCBCSiblingLines(
  oracleText: string,
): { rest: string; absorbed: string[] } | null {
  if (!oracleText) return null;
  const lines = oracleText.split('\n');
  if (lines.length < 2) return null; // single-line — matchBattlefieldCantBeCountered handles it

  const cbcLines: string[] = [];
  const siblingLines: string[] = [];

  for (const line of lines) {
    const cleaned = stripReminderTextForCBC(line).trim();
    if (!cleaned) continue; // skip blank lines

    // Split the line on sentence boundaries to handle multi-sentence lines.
    const sentences = cleaned.replace(/[.!]/g, '\n').split('\n').map(s => s.trim()).filter(Boolean);
    let allCBC = sentences.length > 0;
    for (const sentence of sentences) {
      if (BATTLEFIELD_CBC_SENTENCE_RE.test(sentence)) {
        cbcLines.push(sentence);
      } else {
        allCBC = false;
        siblingLines.push(sentence);
      }
    }
  }

  // Must have at least one CBC sentence to fire.
  if (cbcLines.length === 0) return null;
  // All sibling sentences must be absorbable.
  if (!siblingLines.every(s => isBattlefieldCBCSiblingAbsorbable(s))) return null;
  // Must actually absorb something (otherwise matchBattlefieldCantBeCountered handles it already).
  if (siblingLines.length === 0) return null;

  // Reconstitute rest as just the CBC sentences.
  const rest = cbcLines.join('\n');
  const absorbed = siblingLines;

  return { rest, absorbed };
}

/**
 * Returns true when every non-blank line in `text` is a pure engine-enforced
 * keyword (or comma/and-list of keywords) — i.e. the text would return Unparsed
 * with no substantive effects (the "KeywordOnly" classification).
 *
 * Used by the early additional-cast-cost absorption path to detect remainder
 * texts like "Flying", "Trample", "Fear" so the absorbed cost can be recorded
 * on the Unparsed result for audit visibility.
 */
function isTextKeywordOnly(text: string): boolean {
  if (!text) return true;
  const lines = text.split('\n');
  for (const line of lines) {
    const cleaned = stripReminderTextForCBC(line).trim();
    if (!cleaned) continue; // blank line — skip
    // Must be a pure engine-keyword line, parametric keyword line, or morph cost line.
    // MORPH_COST_LINE_RE is added here (mirroring the audit's isKeywordOnlyOracle fix)
    // so that earlyAdditionalCastCostAbsorption can recognise "Flying\nMorph {3}{W}"
    // remainder text as keyword-only after stripping the additional-cost line.
    // Morph is intentionally excluded from ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE (see
    // the NOTE below that regex) but is safe to recognise as keyword-only here because
    // isTextKeywordOnly is only called when NO substantive effect remains.
    if (
      absorbableKeywordLineParts(cleaned) !== null ||
      ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE.test(cleaned) ||
      LEVEL_BAND_LINE_RE.test(cleaned) ||
      KICKER_COST_LINE_RE.test(cleaned) ||
      MORPH_COST_LINE_RE.test(cleaned)
    ) {
      continue;
    }
    return false; // at least one non-keyword line
  }
  return true;
}

function absorbAdditionalCastCostLines(
  oracleText: string,
): { rest: string; absorbed: string[] } | null {
  if (!oracleText) return null;
  const lines = oracleText.split('\n');
  if (lines.length < 2) return null; // single-line — no remainder to parse

  const kept: string[] = [];
  const absorbed: string[] = [];

  for (const line of lines) {
    const cleaned = stripReminderTextForCBC(line).trim();
    if (!cleaned) { kept.push(line); continue; }

    if (PURE_DOWNSIDE_ADDITIONAL_CAST_COST_RE.test(cleaned)) {
      absorbed.push(cleaned);
    } else {
      kept.push(line);
    }
  }

  if (absorbed.length === 0) return null;
  // Must have substantive text remaining beyond the absorbed cost line(s).
  if (!kept.some(l => stripReminderTextForCBC(l).trim().length > 0)) return null;

  return { rest: kept.join('\n'), absorbed };
}

// ============================================================================
// Per-line union dispatch (Slice 4)
//
// Multi-line permanent faces that fail as a whole because the tokenizer sees
// all lines concatenated — but EVERY individual line is independently parseable
// as a non-Spell oracle kind (ETB/Dies/Triggered/Activated/StaticAbility) OR
// is a pure engine-keyword / self-cost-reduction line that can be absorbed.
//
// HONESTY: execution is already per-line throughout the engine:
//  - executor.ts registerBattlefieldAbilities iterates each line for ETB/Dies/Triggered.
//  - stack.ts registerContinuousAbilitiesForPermanent iterates each line for StaticAbility.
//  - actions.ts parseActivatedAbilities iterates each line for Activated.
// So crediting the FACE is honest precisely when every line passes the same bar
// each of those per-line paths would impose individually.
//
// REJECTION conditions (line-level, any one makes the whole face Unparsed):
//  - A line that parses to 'Spell' (permanent faces never execute Spell lists).
//  - A line that parses to 'Modal'.
//  - A line that is completely unparseable AND cannot be explained by any of the
//    accepted sub-classes (keyword, cost-reduction, sentence-level statics).
//
// SENTENCE-LEVEL STATICS: a single oracle line may carry multiple period-
// separated conditional static sentences ("gets +1/+1 as long as you control a
// Mountain. gets +1/+1 as long as you control a Plains.").  When the line as a
// whole fails to parse, we split on '. ' and attempt each sentence individually
// as a StaticAbility; only if every sentence succeeds do we accept the line.
// ============================================================================

type PerLineKindRank = Record<ParsedOracle['kind'], number>;
const PER_LINE_KIND_RANK: PerLineKindRank = {
  ETB: 5,
  Dies: 4,
  Triggered: 4,
  Activated: 3,
  StaticAbility: 2,
  Spell: 0,
  Modal: 0,
  Unparsed: 0,
};

/**
 * Slice 4: Ability-word em-dash prefix pattern.
 * Matches lines like "Domain — Whenever ...", "Landfall — Whenever ...",
 * "Magecraft — Whenever you cast or copy ...", "Constellation — Whenever ...",
 * "Pack tactics — Whenever ...", "Hellbent — If ...", "Threshold — As long as ..."
 *
 * The ability word is 1–4 capitalized words separated from the body by an em-dash
 * (— U+2014) or en-dash (– U+2013).  The label is pure flavor with no rules
 * meaning — stripping it exposes the body to the existing trigger/static matchers.
 *
 * Capture group 1 = the text after the dash (the parseable body).
 */
const ABILITY_WORD_PREFIX_LINE_RE = /^[A-Z][A-Za-z]*(?:\s+[A-Za-z]+){0,3}\s*[—–]\s*(.+)/s;

/**
 * Keywords that may begin a valid parseable ability body after the ability-word
 * prefix is stripped.  Checked as a fast-path guard so the stripping is applied
 * only when the remainder has a chance of parsing; this avoids mutating lines
 * whose em-dash is part of a different construct (e.g. activated-ability cost
 * lines already handled by step 1m).
 *
 * The list covers trigger starters (when/whenever/at), conditional starters
 * (if/as long as), static starters (this creature gets/has, as long as), and
 * common spell-effect starters (target, you may, deal, draw, destroy, exile,
 * create, put, each opponent, add mana).  Non-exhaustive: any valid body that
 * passes parseOracleText will be accepted; the guard merely avoids pointless
 * re-parsing of lines that clearly have no chance.
 */
const ABILITY_WORD_BODY_RE = /^(?:whenever\b|when\s|at\s+the\s+beginning\b|as\s+long\s+as\b|if\b|this\s+(?:creature|permanent|enchantment|artifact|land|spell)\b|you\s+(?:may|draw|gain|get|deal|can)\b|target\s|deal\s|draw\s+(?:a\s+)?card|destroy\s|exile\s|create\s|put\s+a?\s|each\s+opponent\b|players?\s+(?:can|can'?t)\b|add\s+\{)/i;

/**
 * Try to parse each oracle line independently; if every line is accepted,
 * return the composite (richest real parse + merged absorbedKeywords).
 * Returns null when any line is rejected or no substantive line parses at all.
 *
 * Called from parseOracleText after all whole-face matchers have declined.
 * Recursion terminates: parseOracleText on a single trimmed line never re-enters
 * this branch (it would require another newline) and the sentence-level static
 * path never calls back.
 */
function parseOracleTextPerLine(oracleText: string, manaCost?: string): ParsedOracle | null {
  if (!oracleText || !oracleText.includes('\n')) return null;

  const lines = oracleText.split('\n');
  const allAbsorbed: string[] = [];
  let richestResult: ParsedOracle | null = null;
  let richestRank = 0;
  // Slice 1 (multi-ability rescue): collect ALL accepted per-line results so
  // that faces with more than one real ability (e.g. a static buff + a dies
  // trigger) are correctly credited rather than silently dropping non-richest
  // results. The returned composite is the richest result; all contribute to
  // the face being accepted (not Unparsed).
  const allResults: ParsedOracle[] = [];

  // Pre-check: does this face have a morph/megamorph line? Used by step 1k below
  // to gate absorption of "When this creature is turned face up, ..." triggers.
  const faceHasMorphLine = hasMorphLine(oracleText);

  for (const line of lines) {
    const cleaned = stripReminderTextForCBC(line).trim();
    if (!cleaned) continue;  // blank / whitespace-only line — skip

    // ── 1. Pure engine-keyword line (absorbable) ───────────────────────────
    const lineKeywords = absorbableKeywordLineParts(cleaned);
    if (lineKeywords) {
      allAbsorbed.push(...lineKeywords);
      continue;
    }

    // ── 1b. Enchant preamble line (absorbable) ─────────────────────────────
    //    Aura faces begin with a standalone "Enchant <quality>" line that is
    //    not an engine keyword and has no parseable effects on its own.
    //    Attachment legality is enforced by the targeting/attach system outside
    //    this parser — exactly the same honesty precedent as
    //    trimLeadingKeywordOrEnchantPreamble which strips this from whole-face
    //    token streams.  Absorb it so the remaining lines can parse normally.
    //
    //    Covered forms (Slice 2 / multi-word extension):
    //      Single-word: "Enchant creature", "Enchant permanent", "Enchant player",
    //        "Enchant planeswalker", "Enchant artifact", "Enchant land"
    //      Multi-word:  "Enchant creature with another Aura attached to it",
    //        "Enchant creature or enchantment", "Enchant creature or Vehicle",
    //        "Enchant creature you control", "Enchant artifact or creature",
    //        "Enchant nonland permanent", "Enchant land you control"
    //      Trailing-period variants: "Enchant nonland permanent." etc.
    //    The regex allows an optional trailing period (some older printings use it).
    if (/^enchant\s+[a-z][^.!]*\.?\s*$/i.test(cleaned)) {
      allAbsorbed.push(cleaned);
      continue;
    }

    // ── 1c. As-enters-choice line (absorbable) ─────────────────────────────
    //    "As ~ enters[ the battlefield], choose a creature type." and related
    //    forms ("choose a color.", "choose an opponent.", "choose a player.",
    //    "choose two players.", "choose a card name.", "choose a nonland card
    //    name.") are ETB-choice declarations whose values the engine stores in
    //    CardInstance.choices (chosenCreatureType, chosenColor, chosenOpponent,
    //    chosenCardName).  They have no parseable effect on their own; their
    //    companion lines (static buffs, mana riders, triggers) parse separately.
    //    Absorbing them here allows the per-line dispatch to accept multi-line
    //    permanents whose choose line is NOT the first line (e.g. Auras that
    //    start with "Enchant <X>\nAs ~ enters, choose a color.\n<rider>").
    //    HONESTY: the engine already enforces the companion effects (continuous.ts
    //    chosenCreatureTypeFromSource / chosenColorFromSource, actions.ts
    //    TappedForManaRider chosenColor) — absorbing the declaration line is
    //    consistent with absorbing "Enchant creature" preambles.
    //    Also absorb the self-identity sentence "~ is the chosen type ..." that
    //    sometimes follows the choose declaration on its own line.
    if (
      // Slice 9: '~' extended to also cover 'this creature/aura/enchantment/artifact/land/equipment'
      /^as\s+(?:~|this\s+(?:creature|aura|enchantment|artifact|land|equipment))\s+enters(?:\s+the\s+battlefield)?\s*,\s*choose\s+(?:a\s+creature\s+type|a\s+color|an?\s+opponent|a\s+player|two\s+players|a\s+(?:nonland\s+)?card\s+name)\s*\.?\s*$/i.test(cleaned) ||
      // Slice 7 (as-enters-choose extension): option-list card-type choose form
      // "choose artifact, creature, enchantment, instant, or sorcery" (Cloud Key).
      // The engine stores the choice in choices.chosenCreatureType; companion
      // ReduceCost / anthem statics evaluate it via chosenCreatureTypeFromSource.
      CHOOSE_CARD_TYPE_LIST_ETB_RE.test(cleaned) ||
      /^(?:~|this\s+(?:creature|aura|enchantment|artifact|land|equipment))\s+is\s+the\s+chosen\s+type\b[^.]*\.?\s*$/i.test(cleaned) ||
      // Slice 8 (choose-type-return): bare "Choose a creature type." or "Choose a color."
      // as a standalone line (without the "As ~ enters" frame). These appear as the first
      // line of multi-line permanents (e.g. Kindred tribal enchantments) where the engine
      // stores the choice in choices.chosenCreatureType / choices.chosenColor and the
      // companion lines (anthem statics, prevention triggers) parse independently.
      // HONESTY: the engine already enforces companion effects via chosenCreatureTypeFromSource /
      // chosenColorFromSource; absorbing this declaration is consistent with the "As ~ enters"
      // form already absorbed above.
      /^choose\s+a\s+creature\s+type\s*\.?\s*$/i.test(cleaned) ||
      /^choose\s+a\s+color\s*\.?\s*$/i.test(cleaned) ||
      // Slice 12 (as-becomes-attached-choose): Equipment attach-time choice declaration.
      // "As this Equipment becomes attached to a creature, choose a color/creature type."
      // normalizeSelfSubtypeNouns converts "this Equipment" → "this artifact" before this
      // point, so CHOOSE_ON_ATTACH_RE (which includes "this artifact") covers both forms.
      // choices.chosenColor stored at ETB time; protection from chosen color enforced by
      // keywords.ts getProtectionColors + protectionClausesFor for attached Equipment.
      CHOOSE_ON_ATTACH_RE.test(cleaned)
    ) {
      allAbsorbed.push(cleaned);
      continue;
    }

    // ── 1d. Enters-with-counters line (absorbable) ────────────────────────
    //    "This creature enters with a shield counter on it." / "~ enters
    //    with X +1/+1 counters on it." are ETB counter placements whose
    //    execution is already handled by stack.ts entersWithCounters at
    //    entry time.  They are NOT parseable as a standalone effect line
    //    (they are static entry-replacement semantics, not triggered ETBs),
    //    so they would normally block the per-line dispatch.  Absorb the
    //    unconditional form so the remaining lines (keywords, triggers,
    //    activated abilities) can parse normally.
    //    HONESTY: stack.ts entersWithCounters re-reads the FULL oracle text
    //    at entry, so absorbing this line does not lose the counter placement.
    //    Conditional forms ("if …", "for each …", "where X is …") are NOT
    //    absorbed — they are too complex for the unconditional runtime path
    //    and must parse via matchEntersWithCountersWhereX/ForEach.
    if (isEntersWithCountersLine(cleaned)) {
      allAbsorbed.push(cleaned);
      continue;
    }
    // Slice 2: Conditional enters-with-counters line (Morbid / Raid).
    //    "Morbid — This creature enters with four +1/+1 counters on it if a
    //    creature died this turn." and similar forms are absorbed here so the
    //    remaining lines of a multi-line face parse normally.
    //    HONESTY: stack.ts entersWithCountersConditional re-reads the FULL
    //    oracle text at entry and checks the condition before placing counters.
    if (isEntersWithCountersConditionalLine(cleaned)) {
      allAbsorbed.push(cleaned);
      continue;
    }
    // Slice 5/12: Dynamic "equal to the number of" enters-with-counters line
    //    (Undergrowth Scavenger / Rhizome Lurcher family).
    //    "This creature enters with a number of +1/+1 counters on it equal to
    //    the number of creature cards in all graveyards." is absorbed here so
    //    any other lines of a multi-line face can parse normally.
    //    HONESTY: stack.ts entersWithCountersDynamic Path C re-reads the FULL
    //    oracle text at entry and resolves the count via parseNumberOfFilterAmount.
    if (isEntersWithCountersDynamicLine(cleaned)) {
      allAbsorbed.push(cleaned);
      continue;
    }

    // ── 1e. Planeswalker-loyalty-restriction line (absorbable) ────────────────
    //    "Players can't activate planeswalkers' loyalty abilities." (Immortal Sun)
    //    is an honest skip: the engine has no planeswalker loyalty system, so this
    //    line is unenforced.  Absorbing it allows the other three lines of Immortal
    //    Sun (draw-step trigger, cost-reduction, +1/+1 anthem) to parse normally.
    if (/^players can'?t activate planeswalkers'? loyalty abilities\b/i.test(cleaned)) {
      allAbsorbed.push(cleaned);
      continue;
    }

    // ── 1f. Pure-downside additive cast cost line (absorbable) ───────────────
    //    "As an additional cost to cast this spell, <cost>" lines are unenforced
    //    by the engine (no additionalCost field in stack.ts). Skipping them is
    //    pure-downside: the card becomes strictly easier to cast (no fabricated
    //    benefit). This is the same honest-skip precedent as the planeswalker
    //    loyalty restriction above.
    //    Absorbed forms: exile-from-graveyard, sacrifice, discard, reveal-from-hand
    //    (bare or "or pay {N}"), and "you may collect evidence N".
    //    NOT absorbed: "pay N life" (enforced by getAdditionalLifeCostForCast).
    if (PURE_DOWNSIDE_ADDITIONAL_CAST_COST_RE.test(cleaned)) {
      allAbsorbed.push(cleaned);
      continue;
    }

    // ── 1g. Self-form "can't be countered" line (absorbable) ─────────────────
    //    "This spell can't be countered." is already enforced by
    //    hasCantBeCounteredText (stack.ts) which rescans the FULL original
    //    oracle text at cast time — absorbing this line in the per-line dispatch
    //    loses nothing. Allows the companion clause on the same face (a trigger,
    //    activated ability, or static) to carry the parse. Only the self-form
    //    is absorbed; battlefield-source forms ("Creature spells you control
    //    can't be countered.") are handled by matchBattlefieldCantBeCountered
    //    and are not absorbed here. Decline faces whose companion clause itself
    //    fails the honesty bar — step 5 handles that case.
    if (/^this\s+spell\s+can['']?t\s+be\s+countered\.?$/i.test(cleaned)) {
      allAbsorbed.push(cleaned);
      continue;
    }

    // ── 1h. Kicker / Multikicker lines (absorbable — honest unenforced skip) ─
    //    The engine has NO kicker-paid state (no wasKicked / kickerPaid field).
    //    Kicker is therefore NEVER paid, so two families of lines are always
    //    pure-downside skips:
    //      a) Cost-declaration lines: "Kicker {N}", "Multikicker {N}", etc.
    //         Absorbing them makes the card strictly easier to cast (no gate).
    //      b) Conditional-bonus lines: "If this creature was kicked, it enters
    //         with N +1/+1 counters on it." / "When ~ enters, if it was kicked,"
    //         The condition is permanently false in the current engine; absorbing
    //         these never grants a benefit to the player.
    //    After absorbing both families the REMAINING text (often "This creature
    //    can't be blocked.", a static, or a plain keyword) parses normally.
    if (KICKER_COST_LINE_RE.test(cleaned) || KICKER_CONDITIONAL_LINE_RE.test(cleaned)) {
      allAbsorbed.push(cleaned);
      continue;
    }

    // ── 1i. Parametric keyword-ability lines (honest unenforced skip) ─────────
    //    Standalone numbered/parametric keyword-ability lines such as:
    //      "Cycling {2}", "Echo {2}{G}", "Embalm {3}{U}", "Scavenge {6}{B}",
    //      "Disturb {3}{W}", "Suspend 3—{1}{W}", "Reinforce 1—{1}{R}", etc.
    //    These are either alternate-cast abilities the engine cannot offer
    //    (absorbing them is pure downside — the player loses an inaccessible
    //    mode) or upkeep-tax keywords the engine ignores (absorbing removes a
    //    downside the player should have paid). Verified: no cycling/echo/
    //    embalm/disturb/etc. executor or keyword-cache support exists (grep
    //    confirms zero matches in src/).
    //    Slice 2 additions: persist, undying, myriad, bloodthirst N, bushido N,
    //    rampage N, backup N, offspring {N} are also matched — these grant real
    //    upsides the engine does NOT run; on multi-line faces the companion clause
    //    carries the parse and losing the keyword line loses nothing the engine ran.
    //    crew N, renown N, toxic N ARE matched (pure-downside recognition, Slice 1);
    //    exalted, melee, flanking, soulbond, devoid, changeling, phasing, banding,
    //    daybound, nightbound are absorbed via ABSORBABLE_ENGINE_KEYWORDS (bare line).
    //    Slice 2b additions: level up {N} is also matched — an alternate activation
    //    the engine cannot offer; improvise, riot, ascend are added to
    //    ABSORBABLE_ENGINE_KEYWORDS (bare-keyword forms absorbed in step 1).
    if (ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE.test(cleaned)) {
      allAbsorbed.push(cleaned);
      continue;
    }

    // ── 1i-ii. Level-up band lines (Slice 2 addition — honest unenforced skip) ─
    //    Level-up cards (e.g. Zulaport Enforcer, Student of Warfare) contain:
    //      • "Level up {N}" — already absorbed by ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE (step 1i).
    //      • "LEVEL N-N" band range markers (e.g. "LEVEL 1-2", "LEVEL 2-6")
    //      • "LEVEL N+" terminal band markers (e.g. "LEVEL 3+", "LEVEL 7+")
    //      • "N/N" stat lines within bands (e.g. "3/3", "4/4", "0/6")
    //        These are bare P/T stats for the level band; NOT standalone ability lines.
    //        Keyword lines within bands (Flying, First strike, etc.) are already
    //        absorbed by step 1 (absorbableKeywordLineParts).
    //    HONESTY: The engine has NO level-up subsystem — no level counter tracking,
    //    no stat-overriding based on counter count. Absorbing band lines is a pure
    //    honest skip: the creature always uses its printed base P/T (from the card
    //    definition), never the elevated band stats. The companion line (a static like
    //    "can't be blocked except by black creatures") carries the parse and executes
    //    normally. VERIFIED: grep src/ confirms zero level-counter / level-band
    //    executor in executor.ts, continuous.ts, or stack.ts.
    //    NOTE: "LEVEL N-N" / "LEVEL N+" are uppercase in all Oracle printings.
    //    Uses LEVEL_BAND_LINE_RE (also used in the early absorbParametricKeywordLines
    //    path) for consistency — same patterns absorbed in both code paths.
    if (LEVEL_BAND_LINE_RE.test(cleaned)) {
      allAbsorbed.push(cleaned);
      continue;
    }

    // ── 1j. Slice 2 unenforced-sentence absorption (honest unenforced skip) ──
    //
    // (i) "This creature enters prepared." — the "prepared" mechanic places a
    //     shield counter on the creature as it enters, but stack.ts
    //     entersWithCounters only recognises "enters with a <type> counter" form,
    //     NOT the "enters prepared" shorthand. Absorbing this sentence on a
    //     multi-line face is a pure honest skip: the engine does not grant the
    //     shield counter, so no benefit is fabricated; the companion clause
    //     (spell-side effect, static, or trigger) carries the face. Verified:
    //     grep src/ shows zero "prepared" enforcement in stack.ts / executor.ts.
    //
    // (ii) Soulbond paired-conditional statics — "As long as ~ is paired with
    //     another creature, both creatures have <keyword>." / "each of those
    //     creatures has <keyword>." The "paired" condition has no evaluator in
    //     the engine (static-abilities.ts ~line 2461 documents this explicitly).
    //     matchConditionalStaticAbility returns 'unsupported' for these lines,
    //     causing the whole face to be rejected. On a multi-line permanent face
    //     the companion clause (trigger, activated ability, or static) is what
    //     the engine executes; absorbing the soulbond paired-static is consistent
    //     with the planeswalker-loyalty-restriction absorb (step 1e) — both are
    //     conditions the engine cannot evaluate, so skipping is pure honest.
    // Widened form (Slice 3): "[CardName] enters prepared." (e.g. "Sanar enters prepared.")
    // is the same honest skip — the named-creature form uses the card's own name instead
    // of "this creature", but the mechanic is identical and equally unenforced.
    // Also absorb "...this creature becomes prepared." sentences (trigger-body form where
    // a conditional trigger causes the permanent to become prepared — equally unenforced).
    if (/^(?:[A-Za-z][^.\n]*\s+)?enters\s+prepared\.?\s*$/i.test(cleaned) ||
        /\bthis\s+creature\s+becomes\s+prepared\b/i.test(cleaned)) {
      allAbsorbed.push(cleaned);
      continue;
    }
    if (/^(?:as\s+long\s+as\s+)?(?:~|this\s+\w+)\s+is\s+paired\s+with\s+(?:another\s+creature|a\s+creature)[^.]*\./i.test(cleaned)) {
      allAbsorbed.push(cleaned);
      continue;
    }

    // ── 1j-ii. Bloodrush line absorption (Slice 13, honest unenforced skip) ─────
    //    Bloodrush is an alternate-cast ability (discard to pump an attacking
    //    creature from hand) that the engine cannot execute — no hand-discard as
    //    an alternative-cast cost is wired. Absorbing the Bloodrush line is
    //    pure-downside: the player loses an inaccessible mode; the companion CDA
    //    line (SetBasePTDynamic) carries the face and executes normally.
    //    HONEST: grep src/ confirms zero Bloodrush executor support in engine.
    //    Pattern: "Bloodrush [—–] <cost>, Discard <name>: <effect>"
    if (/^bloodrush\s*[—–\-]/i.test(cleaned)) {
      allAbsorbed.push(cleaned);
      continue;
    }

    // ── 1k. Morph / Megamorph face lines ─────────────────────────────────────
    //    On faces that contain a morph or megamorph cost line:
    //
    //    (a) "Morph {cost}" / "Megamorph {cost}" cost-declaration lines — always
    //        absorbed (pure downside skip). The engine offers the face-down cast
    //        mechanic via tryTurnFaceUp / tryMorphCast actions; the cost-line itself
    //        carries no effect text that parseOracleText can execute.
    //        NOTE: morph is intentionally NOT in ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE
    //        because the parametric-keyword early path would strip the morph line
    //        and expose any face-up trigger to parseOracleText without its sibling.
    //
    //    (b) "When this creature is turned face up, <effect>." trigger lines:
    //        Slice 1 (Morph SUBSYSTEM): if the face-up trigger body parses via
    //        matchTriggerPrefix / parseMultipleEffects, let the line fall through
    //        to the per-line parseOracleText dispatch (step 3) which now returns
    //        { kind:'Triggered', trigger:{ kind:'TurnedFaceUp', who:'self' }, ... }.
    //        If the body does NOT parse (e.g. "change the target" / exchange-control
    //        families), absorb as before (honest skip — engine cannot run the body).
    if (faceHasMorphLine) {
      if (MORPH_COST_LINE_RE.test(cleaned)) {
        allAbsorbed.push(cleaned);
        continue;
      }
      if (TURNED_FACE_UP_TRIGGER_LINE_RE.test(cleaned)) {
        // Try parsing the trigger line; if its body resolves to real effects
        // (matchTriggerPrefix now handles TurnedFaceUp), let it fall through
        // to step 3 for the normal per-line parse path.
        const faceUpTokens = tokenizeOracleText(cleaned);
        const faceUpIdx = matchTurnedFaceUpPrefix(faceUpTokens);
        const bodyParses = faceUpIdx > 0 && parseMultipleEffects(faceUpTokens, faceUpIdx) !== null;
        if (!bodyParses) {
          // Body is unparseable (exchange-control, counter-all-abilities, etc.) —
          // absorb as an honest skip; no reachable effect is dropped.
          allAbsorbed.push(cleaned);
          continue;
        }
        // Body is parseable: fall through to step 3 so parseOracleText returns
        // { kind: 'Triggered', trigger: { kind: 'TurnedFaceUp', who: 'self' }, ... }
      }
    }

    // ── 1l. Play-permission lines (absorbable) ────────────────────────────────
    //    Two static play-permission sentences that block multi-line faces but
    //    are either genuinely enforced or a pure-downside honest skip:
    //
    //    (a) "You may play an additional land on each of your turns."
    //        HONEST-ENFORCED: maxLandsThisTurn (actions.ts:350) re-scans the
    //        oracle text of battlefield permanents at land-play time.  Absorbing
    //        this line does NOT suppress the ability — the engine still grants the
    //        extra land drop.  Precedent: self-cost-reduction absorption (step 2),
    //        which is enforced by getIntrinsicCostReduction re-scanning oracle text.
    //
    //    (b) "You may play lands from your graveyard."
    //        PURE-DOWNSIDE HONEST SKIP: the engine has no land-from-graveyard play
    //        path (grep src/ confirms zero enforcement).  Absorbing is identical in
    //        rationale to morph/kicker/loyalty-restriction absorption (steps 1h–1k):
    //        the player loses an inaccessible ability; no benefit is fabricated.
    //
    //    On a multi-line face these lines are absorbed so the remaining substantive
    //    clause (trigger, activated ability, other static) carries the parse.
    //    Single-line whole faces are handled by matchAdditionalLandDrop and
    //    matchPlayLandsFromGraveyard in the main parseOracleText dispatch.
    if (isPlayPermissionSentence(cleaned)) {
      allAbsorbed.push(cleaned);
      continue;
    }

    // ── 1l-ii. Top-of-library look/reveal/play-permission lines (absorbable) ──
    //    Slice 5: Top-of-library static lines co-occurring with a separately-
    //    parseable trigger, activated ability, or other static:
    //
    //    "Play with the top card of your library revealed."
    //    "You may look at the top card of your library any time."
    //    "You may play lands and cast spells from the top of your library."
    //    "You may play the top card of your library."    (Lunar Whale form)
    //    "As long as <cond>, you may play the top card …" (combat-gated, honest skip)
    //    "You may cast [<filter>] spells from the top of your library."
    //    and related combined / once-per-turn / flash-rider forms.
    //
    //    HONESTY: registerContinuousAbilitiesForPermanent already re-scans every
    //    line of the oracle text and registers PlayFromTopLibrary modifiers, so
    //    absorbing these lines in the full-face dispatcher does NOT lose the play
    //    permission — the engine still grants it (revealed/look forms are free;
    //    play/cast forms are registered independently).
    //
    //    For PLAY_TOP_CARD_CONDITIONAL_RE the condition gate is not tracked, so
    //    absorbing grants the player NO play-from-top ability → pure-downside skip.
    //
    //    Single-line whole faces are handled by matchTopLibraryPlayStatic in the
    //    main parseOracleText dispatch (which runs BEFORE parseOracleTextPerLine).
    if (isTopLibraryStaticSentence(cleaned)) {
      allAbsorbed.push(cleaned);
      continue;
    }

    // ── 1m. Activated-ability lines with unrunnable effect body (honest skip) ─
    //    Activated-ability lines whose cost is parseable but whose effect body
    //    has no matching executor (e.g. "{1}: This creature becomes the creature
    //    type of your choice until end of turn.") are absorbed here so the
    //    remaining sibling lines (static abilities, keywords, triggers, runnable
    //    activated abilities) can carry the face.
    //
    //    HONESTY: the engine's parseActivatedAbilities already drops individual
    //    activated abilities it cannot parse (silently skips them). This absorption
    //    step extends that same skip to the per-line context: a multi-line face
    //    whose one unrunnable activated-ability line caused rejection now succeeds.
    //    The player loses an inaccessible ability they could not use anyway; no
    //    benefit is fabricated.
    //
    //    Gate: the line must (a) have a colon separator outside mana braces,
    //    (b) have a parseable cost (parseCostTokens succeeds on the left side),
    //    and (c) have an effect body that parseMultipleEffects cannot resolve.
    //    Loyalty-ability lines ("±N:") and trigger lines ("when…") are excluded
    //    by the earlier guards at the top of parseActivatedAbilities (already
    //    handled). This step intentionally runs AFTER all explicit absorbers
    //    (1a–1l) so only genuinely-unparseable activated bodies are silently
    //    dropped; lines whose effect IS parseable fall through to step 3 where
    //    the richer Activated parse wins.
    {
      const colonIdx = findAbilityColon(cleaned);
      if (colonIdx > 0 && !/^[+\-−–]?\d+\s*:/.test(cleaned)) {
        const costPart = cleaned.slice(0, colonIdx).trim();
        const effectPart = cleaned.slice(colonIdx + 1).trim();
        if (costPart && effectPart) {
          // Strip ability-word prefix (e.g. "Teleport — {U}{U}") before cost parse
          const abilityWordStripped = costPart.replace(/^[A-Za-z][A-Za-z\s]*[—–]\s*/, '');
          const costToks = tokenizeOracleText(abilityWordStripped);
          const parsedCost = parseCostTokens(costToks);
          if (parsedCost) {
            // Cost is valid — check if the effect body parses
            const effectToks = tokenizeOracleText(effectPart);
            const effectResult = parseMultipleEffects(effectToks, 0);
            if (!effectResult) {
              // Unrunnable body: absorb the line (honest skip)
              allAbsorbed.push(cleaned);
              continue;
            }
          }
        }
      }
    }

    // ── 1n. Leyline opening-hand setup line (absorbable — pure honest skip) ───
    //    "If this card is in your opening hand, you may begin the game with it
    //    on the battlefield." (and the named form "If <CardName> is in your
    //    opening hand …") is a pre-game placement mechanic enforced by
    //    applyPregameActions (game-init.ts) which re-scans the FULL original
    //    oracle text.  The parser cannot model mulligan-time battlefield
    //    placement, so absorbing this line on a multi-line face is a pure honest
    //    skip: the engine still applies the pre-game effect; the remaining
    //    substantive lines (static abilities, triggers, activated abilities)
    //    carry the parse.  Identical precedent to step 1e (planeswalker-loyalty-
    //    restriction) and step 1l (play-permission lines).
    if (LEYLINE_OPENING_HAND_RE.test(cleaned)) {
      allAbsorbed.push(cleaned);
      continue;
    }

    // ── 2. Self-cost-reduction line (enforced by getIntrinsicCostReduction) ─
    //    Treat every sentence in the line; if ALL are either cost-reduction or
    //    known-engine keywords, absorb the line.
    {
      const sentences = cleaned
        .replace(/[.!]+\s*$/, '')
        .split(/\.\s+/)
        .map(s => s.trim())
        .filter(Boolean);
      const allCostReductionOrKeyword = sentences.length > 0 && sentences.every(s => {
        const cr = isSelfCostReductionSentence(s);
        return cr !== null && cr !== 'unsupported';
      });
      if (allCostReductionOrKeyword) {
        allAbsorbed.push(cleaned);
        continue;
      }
    }

    // ── 2b. Trigger-framed lines with unrunnable bodies (honest skip) ────────
    //    When a line begins with a recognised trigger prefix (When/Whenever …,
    //    "At the beginning of …,") AND the body following the prefix cannot be
    //    parsed by parseMultipleEffects, absorb the line as a pure-downside
    //    honest skip.  Rationale: the player loses an ability the engine cannot
    //    execute; no benefit is fabricated.  Precedent: step 1m (activated-
    //    ability lines with unrunnable bodies).
    //
    //    GUARD: only absorb when the trigger prefix IS matched (the body is
    //    known-unrunnable, not just unknown framing).  Unrecognised trigger
    //    framing falls through to step 3/3a where Spell-kind promotion handles
    //    runnable bodies.
    //
    //    HONESTY: all three trigger-prefix dispatchers (matchDiesPrefix,
    //    matchETBPrefix, matchTriggerPrefix) are tried; if ANY matches but
    //    parseMultipleEffects on the body returns null, the trigger is confirmed
    //    unrunnable and the line is absorbed.  If a prefix matches AND the body
    //    IS parseable, step 3a (below) will promote the result — in that path
    //    we do NOT absorb here, so we let it fall through to step 3.
    {
      const lineTokens2b = tokenizeOracleText(cleaned);
      let triggerPrefixIdx2b = -1;

      const dp = matchDiesPrefix(lineTokens2b);
      if (dp > 0) triggerPrefixIdx2b = dp;

      if (triggerPrefixIdx2b < 0) {
        const ep = matchETBPrefix(lineTokens2b);
        if (ep > 0) triggerPrefixIdx2b = ep;
      }

      if (triggerPrefixIdx2b < 0) {
        const tm = matchTriggerPrefix(lineTokens2b);
        if (tm) triggerPrefixIdx2b = tm.effectStart;
      }

      if (triggerPrefixIdx2b > 0) {
        // Trigger prefix was matched.  Check if the body is parseable.
        const bodyParseable = parseMultipleEffects(lineTokens2b, triggerPrefixIdx2b) !== null;
        if (!bodyParseable) {
          // Body is unrunnable: absorb the line (honest skip — pure downside).
          allAbsorbed.push(cleaned);
          continue;
        }
        // Body IS parseable: fall through to step 3 → 3a will promote the line.
      }
    }

    // ── 2c. Ability-word em-dash prefix stripping (Slice 4) ───────────────
    //    Lines like "Domain — Whenever a land you control enters, ..."
    //    "Landfall — Whenever a land you control enters, ..."
    //    "Magecraft — Whenever you cast or copy an instant or sorcery spell, ..."
    //    "Constellation — Whenever this creature or another enchantment enters, ..."
    //    carry a leading ability-word label that is pure flavor with no rules
    //    meaning (CR 207.2c).  The label blocks the trigger/static matchers in
    //    step 3 and step 3a because the tokens start with the ability word, not
    //    "when"/"whenever".  Strip it here so the body is presented to the
    //    existing dispatch unchanged.
    //
    //    HONESTY: the strip is applied only when the remainder starts with a
    //    recognized trigger/static/effect keyword (ABILITY_WORD_BODY_RE), which
    //    guards against stripping non-ability-word em-dashes (e.g. activated-
    //    ability cost/effect separators already handled by steps 1m–2b).
    //    Bodies that remain unparseable after stripping still fail at step 5.
    //    This is a cross-cutting helper — it compounds with every other absorber
    //    on multi-ability faces (removes the prefix as the sole blocker, then
    //    the rest of the per-line dispatch handles it normally).
    let lineForParse = cleaned;
    {
      const awm = ABILITY_WORD_PREFIX_LINE_RE.exec(cleaned);
      if (awm) {
        const remainder = awm[1].trim();
        if (ABILITY_WORD_BODY_RE.test(remainder)) {
          lineForParse = remainder;
        }
      }
    }

    // ── 3. Independent line parse ──────────────────────────────────────────
    //    Try parseOracleText on the (ability-word-stripped if applicable) line.
    //    Accept only non-Spell, non-Modal, non-Unparsed results.
    const lineParsed = parseOracleText(lineForParse, manaCost);
    if (
      lineParsed.kind !== 'Unparsed' &&
      lineParsed.kind !== 'Spell' &&
      lineParsed.kind !== 'Modal'
    ) {
      allResults.push(lineParsed);
      const rank = PER_LINE_KIND_RANK[lineParsed.kind];
      if (rank > richestRank) {
        richestResult = lineParsed;
        richestRank = rank;
      }
      continue;
    }

    // ── 3a. Spell-kind promotion for trigger / activated framing ───────────
    //
    // When a line parses as 'Spell' it means parseOracleText found valid effect
    // clauses but the trigger-prefix dispatch did not fire (either the prefix
    // is not yet in the registry, or parseMultipleEffects greedily skipped the
    // trigger preamble tokens and returned Spell instead of returning Unparsed
    // because the trigger body is parseable).  This is the root cause of the
    // "352 unparsed faces" regression described in the slice 1 design note.
    //
    // Fix: re-run the trigger-prefix matchers on the raw line tokens.  If a
    // known prefix matches AND parseMultipleEffects succeeds on the body
    // following the prefix, promote the result to the correct trigger kind so
    // the line is accepted rather than causing the whole face to be Unparsed.
    //
    // HONESTY: we call parseMultipleEffects starting at the index AFTER the
    // trigger prefix, so the trigger-condition tokens are excluded from the
    // effect list.  The resulting TriggeredAbility / Dies / ETB is structurally
    // identical to what the primary parseOracleText dispatch would have produced
    // had it recognised the trigger prefix.  Only accepted when the body
    // produces at least one concrete effect.
    //
    // Step 5 (reject face) is unchanged — a line that is still Spell after 3a
    // (i.e. starts with "when" but body parses to zero effects) still rejects.
    if (lineParsed.kind === 'Spell' && lineParsed.effects.length > 0) {
      // Use lineForParse (ability-word prefix stripped if applicable) so trigger
      // prefix matchers see "whenever ..." instead of "Domain — whenever ...".
      const lineTokens = tokenizeOracleText(lineForParse);
      let promoted: ParsedOracle | null = null;

      // 3a-i: Check dies prefix (now extended to "is put into a graveyard
      //        from the battlefield" wording via matchDiesPrefix in
      //        trigger-prefixes.ts).
      if (!promoted) {
        const diesIdx = matchDiesPrefix(lineTokens);
        if (diesIdx > 0) {
          const isAttachedCreature =
            lineTokens[1] === 'enchanted' && lineTokens[2] === 'creature';
          const diesTrigger3a: Trigger = isAttachedCreature
            ? { kind: 'AttachedCreatureDies' }
            : { kind: 'Dies', who: 'self' };
          // Slice 10: modal body check before greedy parse.
          const diesModal3a = tryModalTriggerBody(lineTokens, diesIdx);
          if (diesModal3a) {
            promoted = {
              kind: 'Dies',
              ability: {
                kind: 'TriggeredAbility',
                trigger: diesTrigger3a,
                effects: [],
                modal: diesModal3a,
              },
              targets: aggregateModalTargets(diesModal3a).map(t => ({
                id: t.id, type: t.type as TargetType, count: 1,
              })),
            };
          } else {
            const body = parseMultipleEffects(lineTokens, diesIdx);
            if (body && body.effects.length > 0) {
              promoted = {
                kind: 'Dies',
                ability: {
                  kind: 'TriggeredAbility',
                  trigger: diesTrigger3a,
                  effects: body.effects,
                },
                targets: body.targets,
              };
            }
          }
        }
      }

      // 3a-ii: Check ETB prefix.
      if (!promoted) {
        const etbIdx = matchETBPrefix(lineTokens);
        if (etbIdx > 0) {
          // Slice 10: modal body check before greedy parse.
          const etbModal3a = tryModalTriggerBody(lineTokens, etbIdx);
          if (etbModal3a) {
            promoted = {
              kind: 'ETB',
              ability: {
                kind: 'TriggeredAbility',
                trigger: { kind: 'ETB', who: 'self' },
                effects: [],
                modal: etbModal3a,
              },
              targets: aggregateModalTargets(etbModal3a).map(t => ({
                id: t.id, type: t.type as TargetType, count: 1,
              })),
            };
          } else {
            const body = parseMultipleEffects(lineTokens, etbIdx);
            if (body && body.effects.length > 0) {
              promoted = {
                kind: 'ETB',
                ability: {
                  kind: 'TriggeredAbility',
                  trigger: { kind: 'ETB', who: 'self' },
                  effects: body.effects,
                },
                targets: body.targets,
              };
            }
          }
        }
      }

      // 3a-iii: Check generic trigger prefix (Attacks, Upkeep, EndStep, etc.).
      if (!promoted) {
        const trigMatch = matchTriggerPrefix(lineTokens);
        if (trigMatch) {
          // Slice 10: modal body check before greedy parse.
          const trigModal3a = tryModalTriggerBody(lineTokens, trigMatch.effectStart);
          if (trigModal3a) {
            promoted = {
              kind: 'Triggered',
              ability: {
                kind: 'TriggeredAbility',
                trigger: trigMatch.trigger,
                effects: [],
                modal: trigModal3a,
              },
              targets: aggregateModalTargets(trigModal3a).map(t => ({
                id: t.id, type: t.type as TargetType, count: 1,
              })),
            };
          } else {
            const body = parseMultipleEffects(lineTokens, trigMatch.effectStart);
            if (body && body.effects.length > 0) {
              promoted = {
                kind: 'Triggered',
                ability: {
                  kind: 'TriggeredAbility',
                  trigger: trigMatch.trigger,
                  effects: body.effects,
                },
                targets: body.targets,
              };
            }
          }
        }
      }

      if (promoted) {
        allResults.push(promoted);
        const rank = PER_LINE_KIND_RANK[promoted.kind];
        if (rank > richestRank) {
          richestResult = promoted;
          richestRank = rank;
        }
        continue;
      }
    }

    // ── 4. Sentence-level static fallback ─────────────────────────────────
    //    A line like "gets +1/+1 as long as you control a Mountain. gets +1/+1
    //    as long as you control a Plains." fails as a unit but each period-
    //    delimited sentence IS a conditional static.  Only StaticAbility is
    //    accepted here — we never promote a sentence to a trigger this way.
    //    Use lineForParse (ability-word prefix stripped if applicable).
    {
      const sentences = lineForParse
        .replace(/[.!]+\s*$/, '')
        .split(/\.\s+/)
        .map(s => s.trim())
        .filter(Boolean);
      if (sentences.length >= 2) {
        let sentencesAllStatic = true;
        let lastSentenceResult: ParsedOracle | null = null;
        for (const sentence of sentences) {
          const sp = parseOracleText(sentence, manaCost);
          if (sp.kind !== 'StaticAbility') { sentencesAllStatic = false; break; }
          lastSentenceResult = sp;
        }
        if (sentencesAllStatic && lastSentenceResult) {
          // Use StaticAbility rank = 2
          allResults.push(lastSentenceResult);
          if (2 > richestRank) {
            richestResult = lastSentenceResult;
            richestRank = 2;
          }
          continue;
        }
      }
    }

    // ── 5. Line is unacceptable — reject the whole face ───────────────────
    return null;
  }

  // No substantive (non-absorbed) line was parsed.
  // Slice 2/12 (gap a): If every line was absorbed (engine keywords + unenforced
  // skips such as "This creature enters prepared."), return a non-null Unparsed
  // result WITH absorbedKeywords set so the audit counts this face as AbsorbedOnly
  // (credited) rather than a hard miss. The absorbed lines contain no executor-
  // backed effects — returning Unparsed+absorbedKeywords is a pure honest skip
  // identical to the KeywordOnly credit path.
  // Rationale: returning null here causes the caller to return plain
  // { kind: 'Unparsed', reason: 'No recognized pattern' } without absorbedKeywords,
  // so the audit cannot distinguish a hard miss from an absorbed-only face.
  if (!richestResult) {
    if (allAbsorbed.length > 0) {
      return {
        kind: 'Unparsed',
        reason: 'Absorbed-only face (engine keywords + unenforced skips)',
        absorbedKeywords: allAbsorbed,
      };
    }
    return null;
  }

  // Merge absorbed keywords from this dispatch into the result's absorbedKeywords.
  const mergedAbsorbed = [
    ...(richestResult.absorbedKeywords ?? []),
    ...allAbsorbed,
  ];
  return mergedAbsorbed.length > 0
    ? { ...richestResult, absorbedKeywords: mergedAbsorbed }
    : richestResult;
}

/**
 * Slice 1: Outer-parenthesis strip for mana-ability-only land faces.
 *
 * Basic and dual lands (Tundra, Swamp, Snow-Covered Island, etc.) store their
 * mana line wrapped in literal parentheses, e.g. '({T}: Add {W} or {U}.)'.
 * The tokenizer's reminder-text stripper (stripReminderText in tokens.ts)
 * treats the entire face as reminder text, strips it to empty, and returns
 * Unparsed. The IDENTICAL text WITHOUT the parens parses cleanly as Activated.
 *
 * This function detects when the ENTIRE trimmed oracle text is exactly one
 * parenthesized mana ability of the form '({T}: Add <mana>.)' and returns the
 * inner text without the outer parens so parseOracleText can re-parse it.
 * Returns null when the text does not match this pattern.
 */
function stripOuterManaAbilityParens(text: string): string | null {
  const trimmed = text.trim();
  // Must start with '(' and end with ')'
  if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) return null;
  // The entire text must be one balanced parenthesis group.
  // Walk to find the matching ')' for the opening '(' at index 0.
  let depth = 0;
  let closeIdx = -1;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === '(') depth++;
    else if (trimmed[i] === ')') {
      depth--;
      if (depth === 0) { closeIdx = i; break; }
    }
  }
  // The closing paren must be the very last character (no trailing text).
  if (closeIdx !== trimmed.length - 1) return null;
  // Extract the inner text.
  const inner = trimmed.slice(1, -1).trim();
  // Must be a tap mana ability: "{T}: Add <mana symbols>."
  // Allow single or multi-color: "{T}: Add {W}." / "{T}: Add {W} or {U}." /
  // "{T}: Add {R}, {W}, or {B}." etc.
  if (!/^\{T\}: Add \{[WUBRGCS]\}/.test(inner)) return null;
  return inner;
}

/**
 * Slice 10 (MODAL-AS-TRIGGER-BODY): Try to parse a trigger body that starts
 * with "choose one/two —" as a ModalSpell. Returns the ModalSpell on success,
 * or null when the body is not a modal or any mode fails the honesty gate.
 *
 * Called from the ETB, Dies, and generic trigger dispatch paths in
 * parseOracleText, and from step 3a of parseOracleTextPerLine, when the token
 * stream at `effectStart` begins with 'choose'.
 *
 * HONESTY: parseModalSpell already requires ALL modes to parse; if any bullet
 * fails it returns null and we fall through to the normal parseMultipleEffects
 * path (which may greedily parse a partial result or return null).
 */
function tryModalTriggerBody(tokens: string[], effectStart: number): ModalSpell | null {
  // Skip an optional comma after the trigger prefix.
  let idx = effectStart;
  if (tokens[idx] === ',') idx++;
  if (tokens[idx] !== 'choose') return null;
  return parseModalSpell(tokens.slice(idx));
}

/**
 * Aggregate target specs from all choices of a ModalSpell, deduplicated by id.
 * Used to populate the ParsedOracle.targets array for modal triggered abilities
 * so that the pending-trigger target-query phase can present all possible
 * target-choice prompts regardless of which mode the player ultimately picks.
 */
function aggregateModalTargets(modal: ModalSpell): { id: string; type: string }[] {
  const seen = new Set<string>();
  const out: { id: string; type: string }[] = [];
  for (const choice of modal.choices) {
    for (const t of choice.targets) {
      if (!seen.has(t.id)) {
        seen.add(t.id);
        out.push(t);
      }
    }
  }
  return out;
}

/**
 * Parse oracle text into a ParsedOracle result.
 */
export function parseOracleText(oracleText: string, manaCost?: string): ParsedOracle {
  // Reset counter for deterministic IDs in tests
  targetSpecCounter = 0;

  // Slice 1 (VERY EARLY): Strip outer parenthesis from mana-ability-only land faces.
  // Basic lands and dual lands store oracle text as '({T}: Add {W} or {U}.)'.
  // The tokenizer's reminder-text stripper treats the entire text as reminder
  // text and strips it to empty → Unparsed. Detect this pattern and re-parse
  // with the outer parens removed so the mana ability parses correctly.
  // Must run BEFORE normalizeSelfSubtypeNouns so the recursion starts fresh.
  const outerParenStripped = stripOuterManaAbilityParens(oracleText);
  if (outerParenStripped !== null) {
    return parseOracleText(outerParenStripped, manaCost);
  }

  // Apply self-subtype normalization first so that stripChooseCreatureTypeETB
  // and all subsequent paths see canonical type names (enchantment / artifact)
  // instead of subtype names (Aura / Equipment / Vehicle).
  // Note: we normalize the whole oracle text here to handle multi-line faces;
  // each individual path below re-normalizes via normalizedOracleText.
  const oracleTextForParse = normalizeSelfSubtypeNouns(oracleText);

  // Slice 10 (EARLY): Pure-downside additive cast cost line absorption.
  // Must run BEFORE the main spell-clause dispatch because the greedy spell-
  // clause tokenizer (parseMultipleEffects) would otherwise skip the "as an
  // additional cost" preamble tokens and reach the "exile/sacrifice/discard"
  // verb, accidentally matching it as an effect clause. By stripping the cost
  // line from the text BEFORE tokenization, the remaining text parses cleanly.
  //
  // The absorption function itself only runs when there are >=2 lines AND a
  // substantive remainder exists — so single-line cost-only faces stay Unparsed.
  // Only runs on faces with '\n' so single-line faces are never affected.
  //
  // SLICE 1 EXTENSION — keyword-only remainder handling:
  //   When the remainder after stripping the cost line(s) is purely keyword-only
  //   (e.g. Stitched Drake: "exile a creature card...\nFlying"), the recursive
  //   call returns Unparsed. We still record the absorbed cost in absorbedKeywords
  //   on the Unparsed result so the audit can classify the card as KeywordOnly
  //   (the cost was absorbed, leaving only engine-enforced keyword lines).
  //   This does NOT change the kind — keyword-only faces stay Unparsed by design.
  if (oracleTextForParse.includes('\n')) {
    const earlyAdditionalCostAbsorption = absorbAdditionalCastCostLines(oracleTextForParse);
    if (earlyAdditionalCostAbsorption) {
      const restParsed = parseOracleText(earlyAdditionalCostAbsorption.rest, manaCost);
      if (restParsed.kind !== 'Unparsed') {
        const absorbedKeywords = [
          ...(restParsed.absorbedKeywords ?? []),
          ...earlyAdditionalCostAbsorption.absorbed,
        ];
        return { ...restParsed, absorbedKeywords };
      }
      // Keyword-only remainder: rest is Unparsed but consists solely of
      // engine-enforced keywords (e.g. "Flying", "Trample", "Fear").
      // Record the absorbed cost on the Unparsed result for audit visibility.
      // The result kind stays Unparsed — keyword-only faces are intentionally
      // left for the audit's KeywordOnly classification gate.
      if (isTextKeywordOnly(earlyAdditionalCostAbsorption.rest)) {
        const absorbedKeywords = [
          ...(restParsed.absorbedKeywords ?? []),
          ...earlyAdditionalCostAbsorption.absorbed,
        ];
        return { ...restParsed, absorbedKeywords };
      }
    }
  }

  // Slice 12 (EARLY): Self-form CBC line absorption for multi-line faces.
  // "This spell can't be countered." must be stripped BEFORE parseMultipleEffects
  // because the greedy spell-clause tokenizer would otherwise claim the face as
  // Spell (finding the companion trigger/effect while CBC tokens are still present).
  // By stripping CBC lines early, the companion clause (trigger, activated ability,
  // or static) can parse correctly on its own.
  // HONEST: hasCantBeCounteredText (stack.ts) rescans the FULL original oracle
  // text at cast time — absorption here does not suppress the enforcement.
  // Only runs on multi-line faces; single-line CBC faces are handled by
  // matchCantBeCountered (static-abilities.ts). Only adopts when the remainder
  // genuinely parses (declining faces whose companion clause fails the honesty bar).
  // Recursion terminates: the remainder has no CBC line, so the nested call
  // takes a different path.
  if (oracleTextForParse.includes('\n')) {
    const earlyCBCAbsorption = absorbSelfCBCLines(oracleTextForParse);
    if (earlyCBCAbsorption) {
      const restParsed = parseOracleText(earlyCBCAbsorption.rest, manaCost);
      if (restParsed.kind !== 'Unparsed') {
        const absorbedKeywords = [
          ...(restParsed.absorbedKeywords ?? []),
          ...earlyCBCAbsorption.absorbed,
        ];
        return { ...restParsed, absorbedKeywords };
      }
    }
  }

  // Slice 9 (EARLY): Discard-to-battlefield rider absorption for multi-line faces.
  // "If a spell or ability an opponent controls causes you to discard this card, put
  // it onto the battlefield instead of putting it into your graveyard." (Loxodon
  // Smiter, Yixlid family) is an unenforced discard-zone replacement. replacement.ts
  // has NO discard-zone redirection (grep confirmed). Absorbing this line is an
  // honest unenforced-skip — the engine cannot deliver the battlefield placement, so
  // skipping it loses no enforced benefit. The companion body (CBC clause, keywords)
  // is enforced normally after absorption.
  // Must run AFTER absorbSelfCBCLines so that for faces with BOTH a self-CBC line
  // AND a discard rider, the self-CBC is processed first (if the companion after
  // self-CBC absorption is only the discard-rider, this pass absorbs the rider and
  // the resulting single-line "This spell can't be countered." parses correctly).
  // Recursion terminates: remainder has no discard-rider line.
  if (oracleTextForParse.includes('\n')) {
    const earlyDiscardRiderAbsorption = absorbDiscardToBattlefieldRiderLines(oracleTextForParse);
    if (earlyDiscardRiderAbsorption) {
      const restParsed = parseOracleText(earlyDiscardRiderAbsorption.rest, manaCost);
      if (restParsed.kind !== 'Unparsed') {
        const absorbedKeywords = [
          ...(restParsed.absorbedKeywords ?? []),
          ...earlyDiscardRiderAbsorption.absorbed,
        ];
        return { ...restParsed, absorbedKeywords };
      }
    }
  }

  // Slice 9 (EARLY): Battlefield-CBC sibling-line absorption for multi-line faces.
  // Faces like Chimil, the Inner Sun ("Spells you control can't be countered.\n
  // At the beginning of your end step, discover 5.") lead with a controller-scoped
  // CBC static but fail matchBattlefieldCantBeCountered's honesty gate because of
  // the companion unenforced trigger. This absorber strips all companion lines that
  // are provably unenforced (engine keywords, parametric keywords, discover N action)
  // leaving only the CBC sentence, which matchBattlefieldCantBeCountered then handles.
  // HONEST: the CBC static IS enforced by executeCounterSpell scanning
  // continuousEffects. The companion lines absorbed here are all verified unenforced
  // (grep: zero executor for discover N). Recursion terminates: remainder has only
  // the CBC sentence, no companion lines to absorb.
  if (oracleTextForParse.includes('\n')) {
    const earlyBattlefieldCBCAbsorption = absorbBattlefieldCBCSiblingLines(oracleTextForParse);
    if (earlyBattlefieldCBCAbsorption) {
      const restParsed = parseOracleText(earlyBattlefieldCBCAbsorption.rest, manaCost);
      if (restParsed.kind !== 'Unparsed') {
        const absorbedKeywords = [
          ...(restParsed.absorbedKeywords ?? []),
          ...earlyBattlefieldCBCAbsorption.absorbed,
        ];
        return { ...restParsed, absorbedKeywords };
      }
    }
  }

  // Slice 2 (EARLY): Leyline opening-hand setup line absorption for multi-line faces.
  // "If this card is in your opening hand, you may begin the game with it on the
  // battlefield." (and the named form "If <CardName> is in your opening hand …") is
  // a pre-game placement mechanic enforced by applyPregameActions (game-init.ts).
  // The parser cannot model mulligan-time battlefield placement, so absorbing this
  // line is a PURE HONEST SKIP: the pre-game effect is still applied by
  // applyPregameActions which rescans the full original oracle text, and no benefit
  // is fabricated by removing the sentence from the parse path.
  // Must run BEFORE tokenization so "you may begin the game" does not confuse the
  // spell-clause dispatcher (it would otherwise look like a spell-like instruction).
  // Only adopts when the remainder genuinely parses — identical honesty gate to
  // absorbSelfCBCLines. Recursion terminates: the remainder has no opening-hand line.
  if (oracleTextForParse.includes('\n')) {
    const earlyLeylineAbsorption = absorbLeylineOpeningHandLines(oracleTextForParse);
    if (earlyLeylineAbsorption) {
      const restParsed = parseOracleText(earlyLeylineAbsorption.rest, manaCost);
      if (restParsed.kind !== 'Unparsed') {
        const absorbedKeywords = [
          ...(restParsed.absorbedKeywords ?? []),
          ...earlyLeylineAbsorption.absorbed,
        ];
        return { ...restParsed, absorbedKeywords };
      }
    }
  }

  // Slice 10 (EARLY): Morph/megamorph face line absorption for multi-line faces.
  // Strips BOTH the "Morph {cost}" / "Megamorph {cost}" cost-declaration line AND
  // any "When this creature is turned face up, <effect>." trigger line in one pass,
  // then re-parses the remaining always-on abilities (Flying, statics, activated
  // abilities) through the normal dispatch.
  //
  // Must run BEFORE the general parametric-keyword absorption so that the face-up
  // trigger is removed together with the morph cost line — if the morph cost line
  // were stripped first (by the parametric pass) the recursive call would see the
  // face-up trigger without its morph sibling and not know to absorb it.
  //
  // HONEST: morph cost lines are alternate-cast modes the engine cannot offer
  // (pure downside). Face-up triggers can never fire because the engine has no
  // face-down / turn-face-up mechanic (verified: no morph state anywhere in src/).
  // Recursion terminates: the remainder has no morph or face-up trigger line.
  if (oracleTextForParse.includes('\n')) {
    const earlyMorphAbsorption = absorbMorphFaceLines(oracleTextForParse);
    if (earlyMorphAbsorption) {
      if (earlyMorphAbsorption.allConsumed) {
        // All lines were morph/megamorph cost or face-up trigger — nothing real remains.
        // Return Unparsed immediately to prevent the main dispatch from mis-parsing the
        // face-up trigger body as a Spell.
        return {
          kind: 'Unparsed',
          reason: 'morph-only face (morph cost + face-up trigger absorbed; no always-on ability)',
          absorbedKeywords: earlyMorphAbsorption.absorbed,
        };
      }
      const restParsed = parseOracleText(earlyMorphAbsorption.rest, manaCost);
      if (restParsed.kind !== 'Unparsed') {
        const absorbedKeywords = [
          ...(restParsed.absorbedKeywords ?? []),
          ...earlyMorphAbsorption.absorbed,
        ];
        return { ...restParsed, absorbedKeywords };
      }
      // Slice 2 EXTENSION — keyword-only remainder handling for morph faces:
      //   When the remainder after stripping morph/face-up-trigger lines is
      //   purely keyword-only (e.g. "First strike", "Flying"), the recursive
      //   call returns Unparsed. We still record the absorbed morph/trigger
      //   lines in absorbedKeywords on the Unparsed result so the audit can
      //   classify the card as morph-absorbed (keyword-only path) rather than
      //   a mystery Unparsed. Critically, returning HERE prevents the fall-
      //   through to parseMultipleEffects, which would otherwise mis-claim any
      //   face-up trigger body text in the FULL oracle text as a Spell.
      //   Identical pattern to the additional-cast-cost keyword-only handler
      //   (lines above). Recursion terminates: morph/trigger lines are already
      //   stripped from `rest`, so the nested call took a different path.
      if (isTextKeywordOnly(earlyMorphAbsorption.rest)) {
        const absorbedKeywords = [
          ...(restParsed.absorbedKeywords ?? []),
          ...earlyMorphAbsorption.absorbed,
        ];
        return { ...restParsed, absorbedKeywords };
      }
    }
  }

  // Slice 1 (EARLY): Parametric keyword-ability line absorption for multi-line faces.
  // Standalone lines like "Cycling {2}", "Echo {2}{G}", "Embalm {3}{U}",
  // "Disturb {3}{W}", "Reinforce 1—{1}{R}", "Suspend 3—{1}{W}", "Scavenge {6}{B}"
  // must be stripped BEFORE the main spell-clause dispatch (parseMultipleEffects)
  // because the tokenizer may partially match the keyword name or cost as an
  // unrelated verb, producing a spurious Spell parse. By stripping these lines
  // first, the remainder (the real static / trigger / activated ability) parses
  // cleanly through the normal dispatch.
  //
  // HONEST: no cycling/echo/embalm/disturb/etc. executor or keyword-cache support
  // exists anywhere in src/ (verified by grep).  Absorbing these lines is strictly
  // pure-downside: the player loses an inaccessible alternate-cast or upkeep-tax.
  // Recursion terminates: the remainder has no parametric keyword line, so the
  // nested call takes a different path.
  if (oracleTextForParse.includes('\n')) {
    const earlyParametricAbsorption = absorbParametricKeywordLines(oracleTextForParse);
    if (earlyParametricAbsorption) {
      const restParsed = parseOracleText(earlyParametricAbsorption.rest, manaCost);
      if (restParsed.kind !== 'Unparsed') {
        const absorbedKeywords = [
          ...(restParsed.absorbedKeywords ?? []),
          ...earlyParametricAbsorption.absorbed,
        ];
        return { ...restParsed, absorbedKeywords };
      }
    }
  }

  // Slice 3 (EARLY): "Enters / becomes prepared" line absorption for multi-line faces.
  // The "prepared" mechanic (Secrets of Strixhaven "prepare" layout) allows the
  // player to recast the companion spell as a copy — the engine has ZERO executor
  // support for this (grep src/ confirms no prepared/saddle copy-cast in stack.ts or
  // executor.ts). On faces that have one or more "enters prepared" / "becomes
  // prepared" lines PLUS a parseable always-on companion (keywords, static, activated
  // ability, trigger), absorb the prepared line(s) and parse the remainder.
  //
  // Examples absorbed:
  //   "This creature enters prepared. (...)"
  //   "Sanar enters prepared. (...)"      — named-creature variant
  //   "At the beginning of your end step, if ... this creature becomes prepared."
  //
  // HONEST: all absorbed lines are pure-downside — the player loses access to an
  // inaccessible copy-cast mode. The always-on companion executes normally.
  // Recursion terminates: the remainder has no prepared line.
  if (oracleTextForParse.includes('\n')) {
    const earlyPreparedAbsorption = absorbEntersPreparedLines(oracleTextForParse);
    if (earlyPreparedAbsorption) {
      const restParsed = parseOracleText(earlyPreparedAbsorption.rest, manaCost);
      if (restParsed.kind !== 'Unparsed') {
        const absorbedKeywords = [
          ...(restParsed.absorbedKeywords ?? []),
          ...earlyPreparedAbsorption.absorbed,
        ];
        return { ...restParsed, absorbedKeywords };
      }
    }
  }

  // Slice 9 (EARLY): Soulbond paired-static / paired-trigger line absorption.
  // Both the "Soulbond" keyword line and the "As long as ~ is paired with
  // another creature, <effect>" conditional line are absorbed when a parseable
  // always-on companion (trigger, static, activated ability) remains.
  //
  // Must run BEFORE the tokenized dispatch because paired-trigger bodies such as
  // "whenever that creature deals combat damage to a player, you draw a card"
  // contain runnable sub-phrases (draw a card, deals damage) that parseMultipleEffects
  // would mis-claim as Spell effects if the paired line reaches the token stream.
  //
  // When NO companion remains (pure soulbond+paired-static card), the remainder is
  // Unparsed (correct: no executable ability). absorbedKeywords is set on the
  // Unparsed result for audit visibility.
  //
  // HONEST: zero executor support for soulbond / pairing exists in the engine
  // (grep src/ confirms). Absorbing is pure-downside: the player loses only
  // abilities the engine cannot run.
  // Recursion terminates: the remainder has no soulbond or paired lines.
  if (oracleTextForParse.includes('\n')) {
    const earlySoulbondAbsorption = absorbSoulbondPairedLines(oracleTextForParse);
    if (earlySoulbondAbsorption) {
      const restParsed = parseOracleText(earlySoulbondAbsorption.rest, manaCost);
      if (restParsed.kind !== 'Unparsed') {
        const absorbedKeywords = [
          ...(restParsed.absorbedKeywords ?? []),
          ...earlySoulbondAbsorption.absorbed,
        ];
        return { ...restParsed, absorbedKeywords };
      }
      // Remainder is Unparsed (no companion clause): record absorbed on Unparsed
      // result for audit visibility (same pattern as additional-cast-cost path).
      if (isTextKeywordOnly(earlySoulbondAbsorption.rest)) {
        const absorbedKeywords = [
          ...(restParsed.absorbedKeywords ?? []),
          ...earlySoulbondAbsorption.absorbed,
        ];
        return { ...restParsed, absorbedKeywords };
      }
    }
  }

  // Slice 5 (EARLY): Strive cost-line absorption for multi-line spell faces.
  // "Strive — This spell costs {M} more to cast for each target beyond the first."
  // is never charged by the engine (no per-target additional-cost mechanism).
  // Absorbing it allows the multi-target spell body to parse normally.
  // HONEST: the surcharge is pure-downside; skipping it makes the spell strictly
  // easier to cast. Only credit when the body genuinely parses (honesty gate).
  // Recursion terminates: the remainder has no Strive line, so the nested call
  // takes a different path.
  if (oracleTextForParse.includes('\n')) {
    const earlyStriveAbsorption = absorbStriveLines(oracleTextForParse);
    if (earlyStriveAbsorption) {
      const restParsed = parseOracleText(earlyStriveAbsorption.rest, manaCost);
      if (restParsed.kind !== 'Unparsed') {
        const absorbedKeywords = [
          ...(restParsed.absorbedKeywords ?? []),
          ...earlyStriveAbsorption.absorbed,
        ];
        return { ...restParsed, absorbedKeywords };
      }
    }
  }

  // Slice 10 (EARLY): Play-permission line absorption for multi-line faces.
  // "You may play an additional land on each of your turns." (AdditionalLandDrop,
  // enforced by maxLandsThisTurn) and "You may play lands from your graveyard."
  // (PlayLandsFromGraveyard, pure-downside honest skip) can co-occur on the same
  // face as triggers, statics, or activated abilities.  Strip these lines first so
  // the remainder parses cleanly through the normal dispatch.
  //
  // Must run BEFORE the tokenized dispatch (tokenizeOracleText) because "you may
  // play" would otherwise appear in the token stream and the nested-ETB scanner
  // (lines 5255-5306) would claim the "When this creature enters" part without
  // any absorbedKeywords record for the play-permission prefix.
  //
  // HONEST: AdditionalLandDrop — maxLandsThisTurn (actions.ts) rescans the
  // original oracle text of every battlefield permanent at land-play time, so the
  // additional-drop is still enforced even after this absorption.
  // PlayLandsFromGraveyard — pure-downside skip; no land-from-graveyard executor
  // exists in the engine (grep src/ confirms zero enforcement).
  // Recursion terminates: the remainder has no play-permission line, so the
  // nested call takes a different path.
  if (oracleTextForParse.includes('\n')) {
    const playPermLines: string[] = [];
    const keptLines: string[] = [];
    for (const line of oracleTextForParse.split('\n')) {
      const cleaned = stripReminderTextForCBC(line).trim();
      if (cleaned && isPlayPermissionSentence(cleaned)) {
        playPermLines.push(cleaned);
      } else {
        keptLines.push(line);
      }
    }
    if (playPermLines.length > 0 && keptLines.some(l => stripReminderTextForCBC(l).trim().length > 0)) {
      const rest = keptLines.join('\n');
      const restParsed = parseOracleText(rest, manaCost);
      if (restParsed.kind !== 'Unparsed') {
        const absorbedKeywords = [
          ...(restParsed.absorbedKeywords ?? []),
          ...playPermLines,
        ];
        return { ...restParsed, absorbedKeywords };
      }
    }
  }

  // Family choose-type-etb: a card that leads with "As ~ enters, choose a
  // creature type." Its real function is the "of the chosen type" buff that
  // follows. Strip the (engine-supplied) choice declaration and parse the rest;
  // only adopt the result if the remainder genuinely parses (i.e. the card
  // runs). Otherwise fall through so existing behavior is unchanged.
  const chooseTypeRest = stripChooseCreatureTypeETB(oracleTextForParse);
  if (chooseTypeRest !== null && chooseTypeRest.length > 0) {
    const restParsed = parseOracleText(chooseTypeRest, manaCost);
    if (restParsed.kind !== 'Unparsed') {
      return restParsed;
    }
  }

  // Slice 4 (top-library-play): "Play with the top card of your library revealed. /
  // You may play lands and cast spells from the top of your library." family.
  // Operates on raw oracle text (not tokens) because the family sentences can appear
  // in any order and multi-sentence forms need full-text inspection.
  // Must run BEFORE tokenization so the reveal/look sentences don't confuse the spell-
  // clause dispatcher (they would otherwise look like effect clauses).
  const topLibraryPlay = matchTopLibraryPlayStatic(oracleTextForParse);
  if (topLibraryPlay) {
    return { kind: 'StaticAbility', ability: topLibraryPlay };
  }

  // Slice 4 (top-card-conditional anthem): "As long as the top card of your library is
  // <color/type>, <subject> get(s) +P/+T [and have <keyword>]" — Vampire Nocturnus,
  // Crown of Convergence family. Must run AFTER matchTopLibraryPlayStatic (which handles
  // the reveal/play part) so the anthem part is tried only when the pure play form fails.
  // Operates on raw oracle text because it needs to absorb multi-sentence oracle text.
  const topLibraryAnthem = matchTopLibraryConditionalAnthem(oracleTextForParse);
  if (topLibraryAnthem) {
    return { kind: 'StaticAbility', ability: topLibraryAnthem };
  }

  // oracleTextForParse already has subtype self-nouns normalised (above).
  const tokens = trimLeadingKeywordOrEnchantPreamble(tokenizeOracleText(oracleTextForParse));
  const xCost = manaCost ? hasXInCost(manaCost) : false;

  if (tokens.length === 0) {
    return { kind: 'Unparsed', reason: 'Empty oracle text' };
  }

  // Conditional statics — "As long as <condition>, <static>" / "<static> as
  // long as <condition>" (incl. "Threshold —" forms). Must run before
  // matchStaticAbility so the suffix form gets its condition attached instead
  // of being claimed unconditionally.
  const conditionalStatic = matchConditionalStaticAbility(tokens);
  if (conditionalStatic?.kind === 'match') {
    return { kind: 'StaticAbility', ability: conditionalStatic.ability };
  }
  // Unsupported-condition static shapes (see ConditionalStaticMatch) must not
  // be claimed by the loose spell-clause fallback below — it would mis-claim
  // the static fragment as a one-shot effect. Richer parses (triggers,
  // activated abilities) on other lines of the face still get their chance;
  // the hardened matchStaticAbility declines these shapes on its own.
  const unsupportedConditionalStatic = conditionalStatic?.kind === 'unsupported';

  // Slice 5: global keyword-filtered anthem ("Creatures with[out] <keyword> get +N/+N")
  // Controller-agnostic form (no "you control"): affects ALL creatures, not just those
  // the caster controls. Handles both "with" (positive) and "without" (negated) keyword
  // filters. Must run before matchKeywordHolderAnthem (which requires "you control").
  const globalKeywordAnthem = matchGlobalKeywordAnthem(tokens);
  if (globalKeywordAnthem) {
    return { kind: 'StaticAbility', ability: globalKeywordAnthem };
  }

  // Slice 8: keyword-holder anthem ("[Other] creatures you control with <keyword> get +N/+N")
  // Must run before matchStaticAbility so the "with <keyword>" clause is not swallowed
  // by the general subject parser which doesn't understand the "with" predicate.
  const keywordAnthem = matchKeywordHolderAnthem(tokens);
  if (keywordAnthem) {
    return { kind: 'StaticAbility', ability: keywordAnthem };
  }

  // Slice 4: all-subtype anthem ("All Sliver creatures get +1/+1", "All Slivers have flying")
  // Must run before matchStaticAbility; matchStaticAbility's subject parser returns null on
  // "all <subtype>" because "all" is not a known filter word.
  const allSubtypeAnthem = matchAllSubtypeAnthem(tokens);
  if (allSubtypeAnthem) {
    return { kind: 'StaticAbility', ability: allSubtypeAnthem };
  }

  // Tam, Mindful First-Year — "Each other creature you control has hexproof from
  // each of its colors." Must run before matchStaticAbility because the phrase
  // "hexproof from each of its colors" uses a non-fixed color reference that
  // matchStaticAbility / matchOtherTappedUntappedCreaturesHave cannot handle.
  const hexproofFromOwnColors = matchHexproofFromOwnColors(tokens);
  if (hexproofFromOwnColors) {
    return { kind: 'StaticAbility', ability: hexproofFromOwnColors };
  }

  // Slice 8 (Saryth family): tapped/untapped-state conditional keyword grant —
  // "Other tapped creatures you control have deathtouch." /
  // "Other untapped creatures you control have hexproof."
  // Must run before matchStaticAbility because parseStaticFilterType does not
  // understand "tapped"/"untapped" as CardFilter words.
  const tappedUntappedGrant = matchOtherTappedUntappedCreaturesHave(tokens);
  if (tappedUntappedGrant) {
    return { kind: 'StaticAbility', ability: tappedUntappedGrant };
  }

  // Slice 2: combat-status mass statics ("Attacking creatures [you control] get +1/+0",
  // "Attacking creatures you control have lifelink"). Must run before matchStaticAbility
  // because matchStaticAbility's subject parser does not consume "attacking"/"blocking".
  const attackingAnthem = matchAttackingAnthem(tokens);
  if (attackingAnthem) {
    return { kind: 'StaticAbility', ability: attackingAnthem };
  }

  // Slice 3 (engine-gap): Legendary-creatures dynamic anthem (Jodah, the Unifier):
  //   "Legendary creatures you control get +X/+X, where X is the number of
  //    legendary creatures you control."
  // Must run before matchStaticAbility — the "+X/+X where X is ..." form has a
  // different modifier kind (ModifyPTDynamic) and matchStaticAbility would refuse
  // the "+x/+x" token (not a literal +N/+N) anyway.
  const legendaryDynAnthem = matchLegendaryCreaturesDynamicAnthem(tokens);
  if (legendaryDynAnthem) {
    return { kind: 'StaticAbility', ability: legendaryDynAnthem };
  }

  // Slice 4 (engine-gap): Grant-activated-mana-ability static —
  // "Creatures you control have '{T}: Add one mana of any color.'"
  // Must come before matchStaticAbility (which cannot parse the quoted ability form).
  const grantManaAbility = matchGrantActivatedManaAbility(tokens);
  if (grantManaAbility) {
    return { kind: 'StaticAbility', ability: grantManaAbility };
  }

  // Slice 11 cut-b: Grant-land-mana-ability static —
  // "Lands you control have '{T}: Add one mana of any color.'"
  // "All lands have '{T}: Add one mana of any color' and lose all other abilities."
  // Must come before matchStaticAbility and the spell-clause fallback so the
  // "add one mana of any color" portion is not mis-claimed as a one-shot effect.
  const grantLandMana = matchGrantLandManaAbility(tokens);
  if (grantLandMana) {
    return { kind: 'StaticAbility', ability: grantLandMana };
  }

  // Gisela, Blade of Goldnight damage-replacement statics.
  // Must run before matchStaticAbility because the "if a source would deal damage"
  // sentences do not match any general-subject static pattern and would fall
  // through to Unparsed, masking the ability entirely.
  const giselaDamageDoubling = matchGiselaDamageDoubling(tokens);
  if (giselaDamageDoubling) {
    return { kind: 'StaticAbility', ability: giselaDamageDoubling };
  }
  const giselaDamageHalving = matchGiselaDamageHalving(tokens);
  if (giselaDamageHalving) {
    return { kind: 'StaticAbility', ability: giselaDamageHalving };
  }

  // Layer 5 (SetAllColors): "Each nonland permanent you control is all colors."
  // (Leyline of the Guildpact family). Must run before matchStaticAbility because
  // "is all colors" is not a recognised predicate in the generic subject/predicate
  // parser and would fall through to Unparsed there.
  const setAllColors = matchSetAllColors(tokens);
  if (setAllColors) {
    return { kind: 'StaticAbility', ability: setAllColors };
  }

  // Slice 2: Lorwyn Banneret two-subtype spell cost reduction —
  // "<SubtypeA> spells and <SubtypeB> spells you cast cost {N} less [to cast]."
  // Must run before matchStaticAbility because parseStaticSubject only consumes
  // one "spells" word and returns null when "and <SubtypeB> spells" follows.
  const compoundSubtypeCostReduction = matchCompoundSubtypeSpellCostReduction(tokens);
  if (compoundSubtypeCostReduction) {
    return { kind: 'StaticAbility', ability: compoundSubtypeCostReduction };
  }

  // Slice 13 (CDA-companion): "Nontoken creatures you control are Forest lands in
  // addition to their other types." (Ashaya family). Must run before matchStaticAbility
  // because parseStaticSubject cannot parse "nontoken" as a filter word, and the "are
  // Forest lands" predicate is not a recognised modifier verb in matchStaticAbility.
  const grantLandSubtype = matchGrantLandSubtype(tokens);
  if (grantLandSubtype) {
    return { kind: 'StaticAbility', ability: grantLandSubtype };
  }

  // Slice 5: "As long as this creature is equipped/enchanted, it gets +P/+T [and has KW]."
  // Skyhunter Cub / Kitesail Apprentice / Armory Veteran / Thran Golem family.
  // Must run before matchConditionalStaticAbility because that dispatcher calls
  // matchStaticAbility on the body, which does NOT recognise "it" as a subject.
  // Condition SelfIsEquipped / SelfIsEnchanted is evaluated in continuous.ts.
  const selfEquippedEnchantedAnthem = matchSelfEquippedEnchantedAnthem(tokens);
  if (selfEquippedEnchantedAnthem) {
    return { kind: 'StaticAbility', ability: selfEquippedEnchantedAnthem };
  }

  // Slice 11: "During your turn, this creature gets +N/+N." — self conditional
  // anthem gated on active-player (IsActivePlayer condition). Must run before
  // matchStaticAbility because the "During your turn, ..." prefix is not a
  // recognised predicate in the generic subject/predicate parser.
  const selfDuringYourTurnAnthem = matchSelfDuringYourTurnAnthem(tokens);
  if (selfDuringYourTurnAnthem) {
    return { kind: 'StaticAbility', ability: selfDuringYourTurnAnthem };
  }

  // Slice 4/CBC: "Your opponents can't cast spells during your turn." — Dragonlord Dromoka
  // family. A static ability on a battlefield permanent. Must run before matchStaticAbility
  // because "Your opponents can't cast spells during your turn" does not follow the
  // standard subject/predicate layout that matchStaticAbility understands (the subject
  // is "your opponents" but the predicate is a casting prohibition, not a P/T/keyword grant).
  const opponentsCantCastStatic = matchOpponentsCantCastDuringYourTurn(tokens);
  if (opponentsCantCastStatic) {
    return { kind: 'StaticAbility', ability: opponentsCantCastStatic };
  }

  // Phase 15: Check for static ability ("Creatures you control get +1/+1", etc.)
  const staticAbility = matchStaticAbility(tokens);
  if (staticAbility) {
    return { kind: 'StaticAbility', ability: staticAbility };
  }

  // Check for modal spell ("Choose one —" or "Choose two —")
  if (tokens[0] === 'choose') {
    const modal = parseModalSpell(tokens, manaCost);
    if (modal) {
      return { kind: 'Modal', modal, xCost };
    }
  }

  // Check for ETB trigger.
  const etbIndex = matchETBPrefix(tokens);
  if (etbIndex > 0) {
    // Slice 11: intervening-if "if you cast it" — wraps the inner effect in a
    // ConditionalEffect { condition: { kind: 'EnteredByCasting' } } so the
    // engine only executes it when the permanent entered by being cast, not
    // when it was put directly (reanimate, blink, search-to-battlefield, etc.).
    const isIfCast =
      tokens[etbIndex] === 'if' &&
      tokens[etbIndex + 1] === 'you' &&
      tokens[etbIndex + 2] === 'cast' &&
      tokens[etbIndex + 3] === 'it';
    if (isIfCast) {
      // skip "if you cast it" and optional comma
      let innerIdx = etbIndex + 4;
      if (tokens[innerIdx] === ',') innerIdx++;
      const innerResult = parseMultipleEffects(tokens, innerIdx);
      if (innerResult) {
        const condEffect: ConditionalEffect = {
          kind: 'Conditional',
          condition: { kind: 'EnteredByCasting' },
          effect: innerResult.effects.length === 1
            ? innerResult.effects[0]
            : innerResult.effects[0], // multi-effect handled below
        };
        // If multiple effects follow, keep extras as siblings on the ability
        const allEffects: Effect[] = innerResult.effects.length > 1
          ? [condEffect, ...innerResult.effects.slice(1)]
          : [condEffect];
        const ability: TriggeredAbility = {
          kind: 'TriggeredAbility',
          trigger: { kind: 'ETB', who: 'self' },
          effects: allEffects,
        };
        return {
          kind: 'ETB',
          ability,
          targets: innerResult.targets,
        };
      }
      return { kind: 'Unparsed', reason: 'Could not parse ETB if-cast-it effect clause' };
    }

    // Slice 10 (MODAL-AS-TRIGGER-BODY): check if the body is a "choose one/two —" modal.
    const etbModal = tryModalTriggerBody(tokens, etbIndex);
    if (etbModal) {
      const ability: TriggeredAbility = {
        kind: 'TriggeredAbility',
        trigger: { kind: 'ETB', who: 'self' },
        effects: [],
        modal: etbModal,
      };
      return {
        kind: 'ETB',
        ability,
        targets: aggregateModalTargets(etbModal).map(t => ({
          id: t.id, type: t.type as TargetType, count: 1,
        })),
      };
    }

    const optional = isOptionalEffectClause(tokens, etbIndex);
    const effectResult = parseMultipleEffects(tokens, etbIndex);
    if (effectResult) {
      const ability: TriggeredAbility = {
        kind: 'TriggeredAbility',
        trigger: { kind: 'ETB', who: 'self' },
        effects: effectResult.effects,
        ...(optional ? { optional: true } : {}),
      };
      return {
        kind: 'ETB',
        ability,
        targets: effectResult.targets,
      };
    }
    // Slice 1 (multi-ability rescue): same fallthrough pattern as dies/trigger.
    if (!oracleTextForParse.includes('\n')) {
      return { kind: 'Unparsed', reason: 'Could not parse ETB effect clause' };
    }
    // Fall through to parseOracleTextPerLine (multi-line face).
  }

  // Some permanents carry non-trigger entry text before the ETB sentence, e.g.
  // "This land enters tapped. When this land enters...". Only claim ETB if the
  // nested trigger's effect clause is parseable; otherwise let later matchers
  // keep any simpler first-clause coverage instead of downgrading the card.
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i] !== 'when' && tokens[i] !== 'whenever') continue;
    const nestedIndex = matchETBPrefix(tokens.slice(i));
    if (nestedIndex <= 0) continue;
    const effectIndex = i + nestedIndex;

    // Slice 11: "if you cast it" intervening-if in nested ETB position
    const nestedIsIfCast =
      tokens[effectIndex] === 'if' &&
      tokens[effectIndex + 1] === 'you' &&
      tokens[effectIndex + 2] === 'cast' &&
      tokens[effectIndex + 3] === 'it';
    if (nestedIsIfCast) {
      let innerIdx = effectIndex + 4;
      if (tokens[innerIdx] === ',') innerIdx++;
      const innerResult = parseMultipleEffects(tokens, innerIdx);
      if (!innerResult) continue;
      const condEffect: ConditionalEffect = {
        kind: 'Conditional',
        condition: { kind: 'EnteredByCasting' },
        effect: innerResult.effects[0],
      };
      const allEffects: Effect[] = innerResult.effects.length > 1
        ? [condEffect, ...innerResult.effects.slice(1)]
        : [condEffect];
      const ability: TriggeredAbility = {
        kind: 'TriggeredAbility',
        trigger: { kind: 'ETB', who: 'self' },
        effects: allEffects,
      };
      return {
        kind: 'ETB',
        ability,
        targets: innerResult.targets,
      };
    }

    const optional = isOptionalEffectClause(tokens, effectIndex);
    const effectResult = parseMultipleEffects(tokens, effectIndex);
    if (!effectResult) continue;
    const ability: TriggeredAbility = {
      kind: 'TriggeredAbility',
      trigger: { kind: 'ETB', who: 'self' },
      effects: effectResult.effects,
      ...(optional ? { optional: true } : {}),
    };
    return {
      kind: 'ETB',
      ability,
      targets: effectResult.targets,
    };
  }

  // Check for dies trigger
  const diesIndex = matchDiesPrefix(tokens);
  if (diesIndex > 0) {
    // Slice 10 (MODAL-AS-TRIGGER-BODY): check if the body is "choose one/two —" modal.
    const diesTrigger: Trigger = tokens[1] === 'enchanted' && tokens[2] === 'creature'
      ? { kind: 'AttachedCreatureDies' }
      : { kind: 'Dies', who: 'self' };
    const diesModal = tryModalTriggerBody(tokens, diesIndex);
    if (diesModal) {
      const ability: TriggeredAbility = {
        kind: 'TriggeredAbility',
        trigger: diesTrigger,
        effects: [],
        modal: diesModal,
      };
      return {
        kind: 'Dies',
        ability,
        targets: aggregateModalTargets(diesModal).map(t => ({
          id: t.id, type: t.type as TargetType, count: 1,
        })),
      };
    }

    const optional = isOptionalEffectClause(tokens, diesIndex);
    const effectResult = parseMultipleEffects(tokens, diesIndex);
    if (effectResult) {
      const ability: TriggeredAbility = {
        kind: 'TriggeredAbility',
        trigger: diesTrigger,
        effects: effectResult.effects,
        ...(optional ? { optional: true } : {}),
      };
      return {
        kind: 'Dies',
        ability,
        targets: effectResult.targets,
      };
    }
    // Slice 1 (multi-ability rescue): when the trigger prefix matched but the
    // body failed AND the original text has multiple lines, do NOT return Unparsed
    // early — let the per-line dispatch in parseOracleTextPerLine handle each
    // line independently.  For single-line faces, keep the early Unparsed return.
    if (!oracleTextForParse.includes('\n')) {
      return { kind: 'Unparsed', reason: 'Could not parse dies effect clause' };
    }
    // Fall through to parseOracleTextPerLine (multi-line face).
  }

  // Slice 7: Tapped-for-mana rider static (Market Festival / Zhur-Taa Ancient families).
  // Checked BEFORE the generic trigger dispatch so "Whenever enchanted land is tapped for
  // mana" and "Whenever a player taps a land for mana, that player adds <mana>" are parsed
  // as StaticAbilityEffect (modifier: TappedForManaRider) rather than stack triggers.
  // Enforcement is in tapLandForMana (actions.ts), not on the stack.
  const manaRider = matchTappedForManaRider(tokens);
  if (manaRider) {
    return { kind: 'StaticAbility', ability: manaRider };
  }

  // Check for new trigger types (attacks, upkeep, end step, etc.)
  const triggerMatch = matchTriggerPrefix(tokens);
  if (triggerMatch) {
    // Slice 10 (MODAL-AS-TRIGGER-BODY): check if the body is "choose one/two —" modal.
    const trigModal = tryModalTriggerBody(tokens, triggerMatch.effectStart);
    if (trigModal) {
      const ability: TriggeredAbility = {
        kind: 'TriggeredAbility',
        trigger: triggerMatch.trigger,
        effects: [],
        modal: trigModal,
      };
      return {
        kind: 'Triggered',
        ability,
        targets: aggregateModalTargets(trigModal).map(t => ({
          id: t.id, type: t.type as TargetType, count: 1,
        })),
      };
    }

    const optional = isOptionalEffectClause(tokens, triggerMatch.effectStart);
    const effectResult = parseMultipleEffects(tokens, triggerMatch.effectStart);
    if (effectResult) {
      const ability: TriggeredAbility = {
        kind: 'TriggeredAbility',
        trigger: triggerMatch.trigger,
        effects: effectResult.effects,
        ...(optional ? { optional: true } : {}),
      };
      return {
        kind: 'Triggered',
        ability,
        targets: effectResult.targets,
      };
    }
    // Slice 1 (multi-ability rescue): when the trigger prefix matched but the
    // body failed AND the original text has multiple lines, do NOT return Unparsed
    // early — let the per-line dispatch in parseOracleTextPerLine handle each
    // line independently (absorbing the unrunnable trigger line as a downside
    // skip and carrying the remaining parseable lines).
    if (!oracleTextForParse.includes('\n')) {
      return { kind: 'Unparsed', reason: 'Could not parse trigger effect clause' };
    }
    // Fall through to parseOracleTextPerLine (multi-line face).
  }

  const activatedAbilities = parseActivatedAbilities(oracleText);
  if (activatedAbilities.length > 0) {
    return { kind: 'Activated', abilities: activatedAbilities };
  }

  // Slice 9 (ControlEnchanted): "You control enchanted creature/permanent."
  // — theft-Aura family (Control Magic, Mind Control, etc.). Checked BEFORE
  // matchAttachedStaticBuff so the theft clause is recognized even on cards that
  // have an additional "Enchant creature" preamble but no P/T buff. Honest because
  // registerContinuousAbilitiesForPermanent + state-based.ts enforce the control
  // transfer and its revert; see matchControlEnchanted for the honesty gate.
  const controlEnchanted = matchControlEnchanted(oracleText);
  if (controlEnchanted) {
    return { kind: 'StaticAbility', ability: controlEnchanted };
  }

  // Slice 1 (engine-gap): Seedborn Muse static — "Untap all permanents you
  // control during each other player's untap step." Checked here (after
  // matchControlEnchanted, before attachedStaticBuff) so the temporal-rider
  // form is never mis-claimed as an immediate Spell effect. Enforced in
  // performUntapStep (turn-manager.ts). See matchUntapDuringOtherUntapSteps
  // for the honesty gate.
  const untapOtherUntap = matchUntapDuringOtherUntapSteps(oracleText);
  if (untapOtherUntap) {
    return { kind: 'StaticAbility', ability: untapOtherUntap };
  }

  // Slice 10 (play-permission): "You may play an additional land on each of
  // your turns." — enforced by maxLandsThisTurn (actions.ts:350) which rescans
  // oracle text of battlefield permanents. Absorbing as a recognized static
  // credits the ability the engine genuinely runs. Checked before attachedStaticBuff
  // so the play-permission sentence is never mis-routed through the token dispatch.
  const additionalLandDrop = matchAdditionalLandDrop(oracleText);
  if (additionalLandDrop) {
    return { kind: 'StaticAbility', ability: additionalLandDrop };
  }

  // Slice 10 (play-permission): "You may play lands from your graveyard."
  // Pure-downside honest skip (no engine enforcement); credited as a recognized
  // static so the face no longer reports Unparsed.  Same precedent as
  // morph/kicker absorption: the player loses an inaccessible ability, fabricating
  // no benefit.
  const playLandsFromGraveyard = matchPlayLandsFromGraveyard(oracleText);
  if (playLandsFromGraveyard) {
    return { kind: 'StaticAbility', ability: playLandsFromGraveyard };
  }

  // Aura/Equipment static buff on the attached permanent ("Enchanted/Equipped
  // creature gets +N/+N", "Enchanted creature has flying"). Checked LAST among
  // the structured paths so trigger-bearing Auras keep their richer ETB/dies
  // parse and Equipment keeps its "Equip {N}" Activated parse; this catches the
  // pure-buff Auras whose "Enchant X" preamble the keyword trimmer leaves in
  // place (it only strips preambles before a trigger). The actual buff is
  // applied via the equipmentBonus cache.
  const attachedBuff = matchAttachedStaticBuff(tokens);
  if (attachedBuff) {
    return { kind: 'StaticAbility', ability: attachedBuff };
  }

  // Try to parse as a spell effect (with multi-effect support). Skipped for
  // unsupported-condition static shapes — their fragments must stay Unparsed
  // rather than be mis-claimed as one-shot effects.
  const effectResult = unsupportedConditionalStatic ? null : parseMultipleEffects(tokens, 0);
  if (effectResult) {
    return {
      kind: 'Spell',
      effects: effectResult.effects,
      targets: effectResult.targets,
      xCost,
    };
  }

  // Slice 8: "This creature can block an additional creature each combat." static.
  // Checked LAST so any richer trigger/activated/spell parse wins first. Honest
  // because combat.ts (declareBlockers) checks for 'CanBlockAdditional' in the
  // creature's oracle text and grantedKeywords to allow up to 2 block assignments
  // per creature. The marker is recognition-only (selfOnly GrantKeyword); combat.ts
  // is the single enforcement site, mirroring matchSelfMustAttack / combat.ts.
  const canBlockAdditional = matchCanBlockAdditionalStatic(oracleText);
  if (canBlockAdditional) {
    return { kind: 'StaticAbility', ability: canBlockAdditional };
  }

  // Slice 11: "This creature can block any number of creatures [each combat]."
  // Checked right after the +1 form. Honest because combat.ts
  // (maxAttackersCreatureCanBlock) returns 99 when the oracle text matches the
  // CAN_BLOCK_ANY_NUMBER_ORACLE_RE or grantedKeywords includes 'CanBlockAnyNumber'.
  const canBlockAnyNumber = matchCanBlockAnyNumber(oracleText);
  if (canBlockAnyNumber) {
    return { kind: 'StaticAbility', ability: canBlockAnyNumber };
  }

  // Slice 7 (lure): Static "all creatures able to block ~ do so" /
  // "all creatures able to block equipped creature do so" permanent statics.
  // Checked LAST so any richer trigger/activated/spell parse wins first.
  // Honest because combat.ts (declareBlockers) reads LURE_STATIC_SELF_RE /
  // LURE_STATIC_ATTACHED_RE from each attacker's oracle text and adds it to
  // luredCreatureIds before the forced-block check. Enforcement is end-to-end;
  // the marker is recognition-only, mirroring matchSelfMustAttack.
  const lureStatic = matchLureStatic(oracleText);
  if (lureStatic) {
    return { kind: 'StaticAbility', ability: lureStatic };
  }

  // Self must-attack static ("~ attacks each combat if able."). Checked LAST so
  // any richer trigger/spell parse on the same face wins first. Honest because
  // combat.ts (mustAttackIfAble + declareAttackers) already forces the attack
  // straight from the oracle text.
  const selfMustAttack = matchSelfMustAttack(oracleText);
  if (selfMustAttack) {
    return { kind: 'StaticAbility', ability: selfMustAttack };
  }

  // Standalone "This land/permanent enters tapped." static. Checked LAST so any
  // richer trigger/activated/spell parse on the same face wins first. Honest
  // because permanent-entry.ts (entersTheBattlefieldTapped + buildBattlefieldEntryPlan)
  // already taps the permanent on entry straight from the oracle text. Only the
  // unconditional form is claimed (see matchEntersTapped).
  const entersTapped = matchEntersTapped(oracleText);
  if (entersTapped) {
    return { kind: 'StaticAbility', ability: entersTapped };
  }

  // Slice 5: Standalone "This creature/artifact/~ enters with <N|X> <type>
  // counter(s) on it." static. Checked LAST so any richer ETB trigger/spell/
  // activated parse wins first. Honest because stack.ts entersWithCounters
  // already applies fixed and {X}-cost counters at entry, reading the oracle
  // text directly; the marker is recognition-only (selfOnly GrantKeyword).
  // Only the unconditional form is claimed (no trailing "if", "for each",
  // "where X is") — conditional/dynamic forms remain Unparsed or are handled
  // by matchEntersWithCountersWhereX / matchEntersWithCountersForEach.
  const entersWithCounters = matchEntersWithCounters(oracleText);
  if (entersWithCounters) {
    return { kind: 'StaticAbility', ability: entersWithCounters };
  }

  // Slice 2: Conditional enters-with-counters static (Morbid / Raid ability-word
  // forms). Checked after the unconditional form so the unconditional parser wins
  // when the text has no "if" clause.  Honest because stack.ts
  // entersWithCountersConditional re-reads the oracle text at ETB time, checks
  // the condition (CreatureDiedThisTurn / PlayerAttackedThisTurn), and places
  // the counters only when true.
  const entersWithCountersCond = matchEntersWithCountersConditional(oracleText);
  if (entersWithCountersCond) {
    return { kind: 'StaticAbility', ability: entersWithCountersCond };
  }

  // Slice 11: Battlefield-source "can't be countered" statics
  // ("Creature spells you control can't be countered.", "Sliver spells can't be
  // countered.", "Instant and sorcery spells you control can't be countered.").
  // Checked BEFORE the self-form so multi-line faces where the SOLE substantive
  // line is the battlefield CBC sentence are properly recognised as a battlefield
  // static (non-selfOnly). Honest because executeCounterSpell (executor.ts) now
  // scans continuousEffects for non-selfOnly CantBeCountered statics and refuses
  // to counter matching spells.
  const battlefieldCBC = matchBattlefieldCantBeCountered(oracleText);
  if (battlefieldCBC) {
    return { kind: 'StaticAbility', ability: battlefieldCBC };
  }

  // Standalone "This spell can't be countered." spell-self marker. Checked LAST
  // so any richer trigger/activated/spell parse wins first. Honest because
  // stack.ts (hasCantBeCounteredText -> SpellStackItem.cantBeCountered) and
  // executor.ts executeCounterSpell already make the spell uncounterable on
  // cast. Only claimed when the rest of the face is engine-handled keywords (see
  // matchCantBeCountered), so we never mask an unrun granted static or effect.
  const cantBeCountered = matchCantBeCountered(oracleText);
  if (cantBeCountered) {
    return { kind: 'StaticAbility', ability: cantBeCountered };
  }

  // "You may cast this spell as though it had flash [if you pay {N} more]."
  // Checked LAST so any richer trigger/activated/spell parse wins first. Honest
  // because stack.ts hasAsThoughFlash reads the oracle text at cast time and
  // allows instant-speed casting; getAsThoughFlashSurcharge applies the
  // surcharge. Three verified shapes: bare grant, pay-more rider, and Ferocious-
  // style control-condition. Declined when any other unrun sentence is present
  // (see matchAsThoughFlash honesty gate).
  const asThoughFlash = matchAsThoughFlash(oracleText);
  if (asThoughFlash) {
    return { kind: 'StaticAbility', ability: asThoughFlash };
  }

  // Slice 9: "You may cast <type> spells as though they had flash." — battlefield
  // static printed on permanents (Vivien, Prophet of Kruphix, Sigarda's Aid,
  // Quick Sliver…). Checked after matchAsThoughFlash (self-spell form wins first)
  // and before selfCostReduction. Honest because stack.ts hasAsThoughFlash now
  // scans continuousEffects for AsThoughFlash modifiers with typeFilter set.
  const typeFilteredFlash = matchTypeFilteredAsThoughFlash(oracleText);
  if (typeFilteredFlash) {
    return { kind: 'StaticAbility', ability: typeFilteredFlash };
  }

  // Standalone "This spell costs {N} less to cast" spell-self cost reducer.
  // Checked LAST so any richer trigger/activated/spell parse wins first. Honest
  // because continuous.ts getIntrinsicCostReduction reads the spell's own oracle
  // text and stack.ts reduceGenericCost subtracts the reduction from the generic
  // cost at cast time. Only claimed when the rest of the face is engine-handled
  // keywords (see matchSelfCostReduction), so we never mask an unrun ability.
  const selfCostReduction = matchSelfCostReduction(oracleText);
  if (selfCostReduction) {
    return { kind: 'StaticAbility', ability: selfCostReduction };
  }

  // Standalone landwalk keyword line ("Swampwalk", "Forestwalk", ..., or generic
  // "Landwalk"). Checked LAST so any richer parse wins first. Honest because
  // combat.ts (canBlock -> hasActiveLandwalk) already makes the attacker
  // unblockable while the defending player controls a land of the walked type;
  // the marker is recognition-only (see matchLandwalk).
  const landwalk = matchLandwalk(oracleText);
  if (landwalk) {
    return { kind: 'StaticAbility', ability: landwalk };
  }

  // Standalone "Protection from <quality>" keyword line. Checked LAST so any
  // richer trigger/activated/spell parse wins first. Honest because keywords.ts
  // (isProtectedFromSource, read by combat.ts canBlock + the targeting/damage
  // gates) already enforces protection end-to-end straight from the oracle text;
  // the marker is recognition-only (see matchProtection). Only protection from a
  // quality the engine actually enforces (the five colors, the six card types,
  // monocolored/multicolored/colorless) is claimed.
  const protection = matchProtection(oracleText);
  if (protection) {
    return { kind: 'StaticAbility', ability: protection };
  }

  // Slice 5: conditional evasion — "This creature can't be blocked as long as
  // defending player controls <filter>." / "Each creature you control can't be
  // blocked as long as defending player controls <filter>." (Hazy Homunculus /
  // Tanglewalker family). Checked before matchOtherEvasion so the specific
  // conditional form wins over the general can't-be-blocked matcher. Honest
  // because keywords.ts (attackerHasConditionalEvasion, called from canBlock)
  // evaluates the filter against the defending player's board at block-declaration
  // time; the marker is recognition-only (see matchConditionalEvasion). Only
  // filters the engine can actually evaluate are claimed.
  const conditionalEvasion = matchConditionalEvasion(oracleText);
  if (conditionalEvasion) {
    return { kind: 'StaticAbility', ability: conditionalEvasion };
  }

  // Slice 8: attacking-alone evasion — "This creature can't be blocked as long as
  // it's attacking alone." (Dream Prowler family). Checked before matchOtherEvasion
  // so the specific attacker-side conditional form wins. Honest because keywords.ts
  // (attackerHasAttackingAloneEvasion, called from canBlock) gates on
  // state.combat.attackers.length === 1; the marker is recognition-only.
  const attackingAloneEvasion = matchAttackingAloneEvasion(oracleText);
  if (attackingAloneEvasion) {
    return { kind: 'StaticAbility', ability: attackingAloneEvasion };
  }

  // Standalone "other evasion" keyword line (Fear, Intimidate, Shadow,
  // Horsemanship, Skulk) or the explicit "This creature can't be blocked."
  // Checked LAST so any richer parse wins first. Honest because combat.ts
  // (canBlock -> blockerSatisfiesEvasion) now enforces each restriction
  // straight from the oracle text; the marker is recognition-only (see
  // matchOtherEvasion). Only the engine-enforced evasion keywords are claimed.
  const otherEvasion = matchOtherEvasion(oracleText);
  if (otherEvasion) {
    return { kind: 'StaticAbility', ability: otherEvasion };
  }

  // Standalone "This creature can block only creatures with flying." block-
  // restriction static (Welkin Tern family). Checked LAST so any richer parse
  // wins first. Honest because combat.ts (canBlock ->
  // blockerCanBlockOnlyFlyingText in keywords.ts) refuses such a creature as a
  // blocker of any non-flying attacker, straight from the oracle text; the
  // marker is recognition-only (see matchBlockOnlyFlying).
  const blockOnlyFlying = matchBlockOnlyFlying(oracleText);
  if (blockOnlyFlying) {
    return { kind: 'StaticAbility', ability: blockOnlyFlying };
  }

  // Slice 5: Player-level static prohibitions (Ivory Mask / Leyline of Sanctity /
  // Leyline of Punishment family). Checked before wardPayLife so any richer parse
  // wins first. The matchers work on the FULL oracle text (multi-sentence) just
  // like matchLandwalk / matchProtection, allowing mixed faces ("Defender\nYou
  // have hexproof."). Each form is honest — see matchPlayerHexproof et al. for the
  // enforcement sites. Forms without confirmed enforcement are NOT claimed here.
  const playerHexproof = matchPlayerHexproof(oracleText);
  if (playerHexproof) {
    return { kind: 'StaticAbility', ability: playerHexproof };
  }

  const playerShroud = matchPlayerShroud(oracleText);
  if (playerShroud) {
    return { kind: 'StaticAbility', ability: playerShroud };
  }

  const cantGainLife = matchCantGainLife(oracleText);
  if (cantGainLife) {
    return { kind: 'StaticAbility', ability: cantGainLife };
  }

  const damageCantBePrevented = matchDamageCantBePrevented(oracleText);
  if (damageCantBePrevented) {
    return { kind: 'StaticAbility', ability: damageCantBePrevented };
  }

  // Slice 10 (combat statics): "Cast this spell only during the declare blockers step."
  // (Mirror Match family). Checked LAST so any richer trigger/activated/spell parse
  // wins first. Honest because canCastSpell (stack.ts) reads the spell's oracle text
  // at cast time and gates the cast on state.step === 'declare_blockers' when the
  // restriction is present. Recognition-only (selfOnly StaticAbility).
  const castOnlyDuringBlockers = matchCastOnlyDuringDeclareBlockers(oracleText);
  if (castOnlyDuringBlockers) {
    return { kind: 'StaticAbility', ability: castOnlyDuringBlockers };
  }

  // Slice 10 (combat statics): "Creatures with power less than this creature's power
  // can't block it."  (Wandering Wolf family). Checked LAST so any richer parse wins
  // first. Honest because canBlock (keywords.ts) reads the attacker's oracle text at
  // block-declaration time and refuses a blocker whose effective power is strictly
  // less than the attacker's effective power. Recognition-only (selfOnly StaticAbility).
  const powerLessThanCantBlock = matchPowerLessThanCantBlock(oracleText);
  if (powerLessThanCantBlock) {
    return { kind: 'StaticAbility', ability: powerLessThanCantBlock };
  }

  // Standalone "Ward—Pay N life." keyword line (Owlin Shieldmage family). Checked
  // LAST so any richer trigger/activated/spell parse wins first. Honest because
  // ward.ts parseWardCost reads the "ward—pay N life" form and applyWardForStackItem
  // enforces the life-payment cost (deducts life from the targeting player or counters
  // the spell/ability); the marker is recognition-only (see matchWardPayLife).
  // Only claimed when the rest of the face is engine-handled keywords (honesty gate
  // in matchWardPayLife), so we never mask an unrun ability.
  const wardPayLife = matchWardPayLife(oracleText);
  if (wardPayLife) {
    return { kind: 'StaticAbility', ability: wardPayLife };
  }

  // Characteristic-defining P/T ability (layer 7a): "~ power and toughness
  // are each equal to the number of <filter> you control / in your graveyard."
  // Checked LAST so any richer trigger/activated/spell parse wins first.
  // Honest because continuous.ts getDynamicBasePT + countForEachCDA evaluate
  // the count at query time (see matchDynamicCDA for the honesty gate).
  const dynamicCDA = matchDynamicCDA(oracleText);
  if (dynamicCDA) {
    return { kind: 'StaticAbility', ability: dynamicCDA };
  }

  // Slice 11: Spell-self CBC line absorption (Abrupt Decay / Void Rend family):
  // a mixed instant/sorcery face that leads with "This spell can't be countered."
  // and has other substantive text (a Destroy, Exile, or Counter effect). Strip
  // the CBC line and re-parse the remainder; adopt only when the remainder parses.
  // HONEST: hasCantBeCounteredText (stack.ts) rescans the FULL original oracle
  // text at cast time so the uncounterability is still enforced; the remainder's
  // parse is the card's real function. Recursion terminates: the remainder has no
  // CBC line so the nested call returns on a different path.
  const cbcAbsorption = absorbSelfCBCLines(oracleText);
  if (cbcAbsorption) {
    const restParsed = parseOracleText(cbcAbsorption.rest, manaCost);
    if (restParsed.kind !== 'Unparsed') {
      const absorbedKeywords = [
        ...(restParsed.absorbedKeywords ?? []),
        ...cbcAbsorption.absorbed,
      ];
      return { ...restParsed, absorbedKeywords };
    }
  }

  // Self-cost-reduction line absorption (checked before keyword-line absorption):
  // a mixed face where at least one line is an enforced self-cost-reduction
  // ("This spell costs {1} less for each opponent you have.") alongside other
  // substantive text (a trigger, an ETB, an activated ability). Strip the cost
  // line and re-parse the remainder through the FULL normal dispatch; adopt the
  // result only when the remainder genuinely parses.
  // HONEST: getIntrinsicCostReduction re-scans the FULL original oracle text at
  // cast time, so the cost reduction is still applied even after this absorption;
  // the remainder's parse is exactly the card's "real" function the engine runs.
  // Recursion terminates: the remainder contains no cost-reduction line, so the
  // nested call returns on a different path.
  const costReductionAbsorption = absorbSelfCostReductionLines(oracleText);
  if (costReductionAbsorption) {
    const restParsed = parseOracleText(costReductionAbsorption.rest, manaCost);
    if (restParsed.kind !== 'Unparsed') {
      const absorbedKeywords = [
        ...(restParsed.absorbedKeywords ?? []),
        ...costReductionAbsorption.absorbed,
      ];
      return { ...restParsed, absorbedKeywords };
    }
  }

  // Family keyword-line-absorption (checked dead LAST): a mixed face that
  // failed wholesale because standalone engine-known keyword line(s) sit
  // before/among otherwise-parseable text ("Flying\nInstant and sorcery spells
  // you cast cost {1} less to cast.", "Defender\n{T}: ..."). Absorb the
  // keyword lines and re-parse the remainder through the FULL normal dispatch;
  // adopt the result only when the remainder genuinely parses. HONEST: the
  // absorbed keywords are already enforced outside this parser (see
  // absorbEngineKeywordLines), and the remainder's parse is exactly what the
  // runtime paths (registerContinuousAbilitiesForPermanent, trigger
  // registration, parseActivatedAbilities, spell resolution) execute. Because
  // this runs only after every existing matcher declined, no currently-parsing
  // face changes shape. Recursion terminates: the remainder contains no
  // absorbable keyword line, so the nested absorption returns null.
  const keywordAbsorption = absorbEngineKeywordLines(oracleText);
  if (keywordAbsorption) {
    const restParsed = parseOracleText(keywordAbsorption.rest, manaCost);
    // HONESTY: decline 'Spell' adoptions. Standalone keyword lines only occur
    // on PERMANENT faces in practice, and a permanent's resolution never
    // executes a 'Spell' effect list — every remainder that lands in the
    // spell-clause fallback here is a fragment misparse of a permanent's
    // unrun ability (audited: all such adoptions were creatures like
    // Kiki-Jiki / Vigor, whose real abilities the engine does not run).
    // ETB/Dies/Triggered/Activated/Static remainders DO run, via the same
    // per-line registration paths that execute them today.
    if (restParsed.kind !== 'Unparsed' && restParsed.kind !== 'Spell') {
      return { ...restParsed, absorbedKeywords: keywordAbsorption.keywords };
    }
  }

  // Per-line union dispatch (Slice 4): a multi-line face where every line is
  // independently parseable as ETB/Dies/Triggered/Activated/StaticAbility, or
  // is an absorbable engine-keyword / self-cost-reduction line. Checked LAST
  // so every existing whole-face matcher and the absorption fallbacks win first.
  // HONEST: execution is already per-line throughout the engine (executor.ts
  // registerBattlefieldAbilities, stack.ts registerContinuousAbilitiesForPermanent,
  // actions.ts parseActivatedAbilities). Only accepts 'Spell'-free line parses —
  // permanent faces never execute Spell lists. Recursion terminates: each line
  // is parsed without newlines, so parseOracleTextPerLine is not re-entered.
  const perLineParsed = parseOracleTextPerLine(oracleTextForParse, manaCost);
  if (perLineParsed !== null) {
    return perLineParsed;
  }

  // Slice 2/12 (gap a — single-line form): A face whose ENTIRE content, after
  // stripping reminder text, is ONLY an "enters prepared" declaration (e.g.
  // "This creature enters prepared.") has zero non-absorbed content and cannot
  // reach parseOracleTextPerLine (which requires a newline). Detect this single-
  // line case and return Unparsed WITH absorbedKeywords so the audit classifies
  // it as AbsorbedOnly (credited) rather than a hard miss.
  //
  // HONEST: the "prepared" mechanic is unenforced (no shield-counter / copy-cast
  // executor in stack.ts or executor.ts). Returning Unparsed+absorbedKeywords is
  // pure-downside: the player loses an inaccessible copy-cast mode; the creature
  // plays as its printed body. Consistent with how multi-line absorbed-only faces
  // are handled by the parseOracleTextPerLine absorbed-only gate above.
  {
    const cleanedForPrepared = stripReminderTextForCBC(oracleTextForParse).trim();
    if (
      /^(?:[A-Za-z~][^.\n]*\s+)?enters\s+prepared\.?\s*$/i.test(cleanedForPrepared) &&
      !cleanedForPrepared.includes('\n')
    ) {
      return {
        kind: 'Unparsed',
        reason: 'Absorbed-only face: prepared-only (single-line)',
        absorbedKeywords: [cleanedForPrepared],
      };
    }
  }

  return { kind: 'Unparsed', reason: 'No recognized pattern' };
}

/**
 * Convenience: check if oracle text is parseable.
 */
export function canParseOracleText(oracleText: string): boolean {
  const result = parseOracleText(oracleText);
  return result.kind !== 'Unparsed';
}

// ============================================================================
// Activated ability parsing
// ============================================================================

const MANA_SYMBOL_RE = /^\{[^}]+\}(?:\{[^}]+\})*$/;

/**
 * Parse the cost portion of an activated ability (tokens before the colon).
 * Recognizes: {T}, "sacrifice ~", mana symbols like {2}{B}
 */
function parseCostTokens(tokens: string[]): ActivatedAbilityCost | null {
  const cost: ActivatedAbilityCost = {};
  let i = 0;

  while (i < tokens.length) {
    const tok = tokens[i];

    // {t} = tap symbol
    if (tok === '{t}') {
      cost.tap = true;
      i++;
      // skip comma
      if (tokens[i] === ',') i++;
      continue;
    }

    // "sacrifice ~", "sacrifice this", or "sacrifice another creature"
    if (tok === 'sacrifice') {
      i++; // skip "sacrifice"
      // "sacrifice another creature" — Brion Stoutarm family
      if (tokens[i] === 'another' && tokens[i + 1] === 'creature') {
        cost.sacrifice = 'another-creature';
        i += 2;
      } else {
        cost.sacrifice = 'self';
        // Consume the sacrifice target (could be "~", "this", or a card name)
        while (i < tokens.length && tokens[i] !== ',' && !tokens[i].startsWith('{')) {
          i++;
        }
      }
      if (tokens[i] === ',') i++;
      continue;
    }

    // "pay 1 life"
    if (tok === 'pay') {
      const amount = parseInt(tokens[i + 1], 10);
      if (isNaN(amount) || tokens[i + 2] !== 'life') return null;
      cost.payLife = (cost.payLife || 0) + amount;
      i += 3;
      if (tokens[i] === ',') i++;
      continue;
    }

    // Mana symbol(s) like {2}{b}
    if (tok.startsWith('{') && tok.endsWith('}')) {
      cost.mana = tok;
      i++;
      if (tokens[i] === ',') i++;
      continue;
    }

    // Unknown cost token — bail
    return null;
  }

  // Must have at least one cost component
  if (!cost.tap && !cost.sacrifice && !cost.mana && !cost.payLife) return null;

  return cost;
}

// matchSearchLibrary — moved to ./matchers/search-dig.ts
/**
 * Check if a set of effects contains any mana-producing effect.
 */
function containsManaEffect(effects: Effect[]): boolean {
  return effects.some(effect => effect.kind === 'AddMana');
}

/**
 * Parse activated abilities from oracle text.
 * Does NOT modify parseOracleText(). This is a separate function.
 *
 * Splits on newlines, looks for ":" colon separator, parses cost and effect.
 */
export function parseActivatedAbilities(oracleText: string): ActivatedAbility[] {
  if (!oracleText) return [];

  const abilities: ActivatedAbility[] = [];
  const lines = oracleText.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip lines that are clearly not activated abilities
    // (triggered abilities start with "when", "whenever", "at")
    const lower = trimmed.toLowerCase();
    if (lower.startsWith('when ') || lower.startsWith('whenever ') || lower.startsWith('at ')) continue;

    // Skip loyalty abilities (handled by parseLoyaltyAbilities)
    if (/^[+\-−–]?\d+\s*:/.test(trimmed)) continue;

    // Look for colon separator (but not inside mana symbols like {T})
    // An activated ability has the form: <cost> : <effect>
    const colonIdx = findAbilityColon(trimmed);
    if (colonIdx === -1) continue;

    let costPart = trimmed.slice(0, colonIdx).trim();
    const effectPart = trimmed.slice(colonIdx + 1).trim();

    if (!costPart || !effectPart) continue;

    // Slice 8: strip ability-word prefix (e.g. "Teleport — {U}{U}" → "{U}{U}")
    // Ability words like "Teleport", "Landfall", "Battalion" are flavour labels
    // separated by an em-dash (— or –) before the actual cost tokens.
    // Regex: leading word(s) followed by em/en-dash, stripping them so the
    // remaining string is the parseable cost.
    const abilityWordPrefix = /^[A-Za-z][A-Za-z\s]*[—–]\s*/;
    const abilityWordMatch = abilityWordPrefix.exec(costPart);
    if (abilityWordMatch) {
      costPart = costPart.slice(abilityWordMatch[0].length).trim();
    }

    // Slice 7: detect and strip "Activate only as a sorcery." /
    // "Activate only during your turn[, and only before attackers are declared]."
    // riders so they don't poison the effect parse.  When detected, the ability
    // is tagged timing='sorcery' and canActivateAbility enforces sorcery speed.
    const ACTIVATE_ONLY_SORCERY_RE =
      /\.\s*Activate\s+only\s+(?:as\s+a\s+sorcery|during\s+your\s+turn(?:[^.]*)?)\s*\.?\s*$/i;
    const timingRiderMatch = ACTIVATE_ONLY_SORCERY_RE.exec(effectPart);
    const timing: 'sorcery' | undefined = timingRiderMatch ? 'sorcery' : undefined;
    const effectPartClean = timingRiderMatch
      ? effectPart.slice(0, timingRiderMatch.index).trim()
      : effectPart;

    if (!effectPartClean) continue;

    // Tokenize cost and effect parts
    const costTokens = tokenizeOracleText(costPart);
    const effectTokens = tokenizeOracleText(effectPartClean);

    // Parse cost
    const cost = parseCostTokens(costTokens);
    if (!cost) continue;

    // Try to parse effects (SearchLibrary first, then modal spell, then multi-sentence, then single clause).
    // parseMultipleEffects handles "A. B." two-sentence abilities (e.g. Brion Stoutarm:
    // "deals damage... You gain life...") by looping through period-separated clauses.
    // Slice 6: also try parseModalSpell for "{N}: Choose one — • A. • B." activated modals.
    let result = matchSearchLibrary(effectTokens, 0);
    if (!result) {
      // Try modal parse first so that "Choose one — …" is claimed as an ActivatedAbility
      // with a modal rather than falling through to parseMultipleEffects (which skips the
      // modal framing tokens and incorrectly merges all bullet effects into one flat list).
      const modal = parseModalSpell(effectTokens);
      if (modal) {
        const isManaAbility = false; // modal activated abilities are never mana abilities
        abilities.push({
          kind: 'ActivatedAbility',
          cost,
          effects: [],
          isManaAbility,
          targets: [],
          modal,
          ...(timing ? { timing } : {}),
        });
        continue;
      }
      result = parseMultipleEffects(effectTokens, 0);
    }

    if (!result) continue;

    const isManaAbility = containsManaEffect(result.effects);

    abilities.push({
      kind: 'ActivatedAbility',
      cost,
      effects: result.effects,
      isManaAbility,
      targets: result.targets,
      ...(timing ? { timing } : {}),
    });
  }

  return abilities;
}

/**
 * Find the colon that separates cost from effect in an activated ability line.
 * Skips colons inside braces like {T}.
 */
function findAbilityColon(text: string): number {
  let inBrace = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') inBrace = true;
    else if (text[i] === '}') inBrace = false;
    else if (text[i] === ':' && !inBrace) return i;
  }
  return -1;
}

// ============================================================================
// Phase 17: Planeswalker loyalty ability parsing
// ============================================================================

/** Regex to match loyalty ability cost prefix: "+1:", "-3:", "0:", "+2:" */
const LOYALTY_COST_RE = /^([+\-−–]?\d+)\s*:/;

/**
 * Parse planeswalker loyalty abilities from oracle text.
 * Each line starting with "+N:", "-N:", or "0:" is a loyalty ability.
 *
 * Returns an array of LoyaltyAbility AST nodes.
 */
export function parseLoyaltyAbilities(oracleText: string): LoyaltyAbility[] {
  if (!oracleText) return [];

  // Reset counter for deterministic IDs in tests
  targetSpecCounter = 0;

  const abilities: LoyaltyAbility[] = [];
  const lines = oracleText.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = LOYALTY_COST_RE.exec(trimmed);
    if (!match) continue;

    const loyaltyCost = parseInt(match[1], 10);
    const effectPart = trimmed.slice(match[0].length).trim();

    if (!effectPart) continue;

    // Tokenize and parse the effect portion using existing patterns
    const effectTokens = tokenizeOracleText(effectPart);
    const result = parseMultipleEffects(effectTokens, 0);

    if (!result) continue;

    abilities.push({
      kind: 'LoyaltyAbility',
      loyaltyCost,
      effects: result.effects,
      targets: result.targets.map(t => ({ id: t.id, type: t.type })),
    });
  }

  return abilities;
}
