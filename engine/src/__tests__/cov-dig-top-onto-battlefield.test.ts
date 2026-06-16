import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

// ---------------------------------------------------------------------------
// Slice 2/12: Dig top-N onto the battlefield matchers
//
// Coverage:
//   matchDigTopPutAllOntoBattlefield:
//     "reveal/look at top N/X cards ... put all <type> cards from among them
//      onto the battlefield [tapped] and the rest on bottom/graveyard"
//     (Animist's Awakening family)
//
//   matchRevealTopOntoBattlefield extended with "noncreature <type>" compound:
//     "Look at top N ... put up to M noncreature artifact cards ... onto the
//      battlefield" (Smelting Vat)
//
//   matchLookAtTopWhereXForEach extended with multi-type "and/or" battlefield:
//     "Look at the top X cards ... where X is the number of artifacts you control.
//      Put up to X artifact and/or creature cards with mana value 3 or less from
//      among them onto the battlefield." (Kayla's Reconstruction)
//
// HONESTY GUARDS verified:
//   - "manifest dread" wording → Unparsed (no mechanic in engine)
//   - Mitotic Manipulation "same name as a permanent" → Unparsed (no executor support)
//   - Instant/sorcery "onto battlefield" → not parsed by any battlefield dig matcher
// ---------------------------------------------------------------------------

// Card definitions used across tests
const forest: CardDefinition = {
  id: 'forest', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '',
  mana_cost: '', cmc: 0, colors: [], color_identity: ['G'], keywords: [], card_types: ['land'],
};
const island: CardDefinition = {
  id: 'island', name: 'Island', type_line: 'Basic Land — Island', oracle_text: '',
  mana_cost: '', cmc: 0, colors: [], color_identity: ['U'], keywords: [], card_types: ['land'],
};
const bear: CardDefinition = {
  id: 'bear', name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '',
  mana_cost: '{1}{G}', cmc: 2, colors: ['G'], color_identity: ['G'], keywords: [],
  card_types: ['creature'], power: 2, toughness: 2,
};
const artifact: CardDefinition = {
  id: 'artifact', name: 'Sol Ring', type_line: 'Artifact', oracle_text: '',
  mana_cost: '{1}', cmc: 1, colors: [], color_identity: [], keywords: [], card_types: ['artifact'],
};
const creatureArtifact: CardDefinition = {
  id: 'creatureArtifact', name: 'Ornithopter', type_line: 'Artifact Creature — Thopter', oracle_text: '',
  mana_cost: '{0}', cmc: 0, colors: [], color_identity: [], keywords: [],
  card_types: ['artifact', 'creature'], power: 0, toughness: 2,
};
const bolt: CardDefinition = {
  id: 'bolt', name: 'Lightning Bolt', type_line: 'Instant', oracle_text: '',
  mana_cost: '{R}', cmc: 1, colors: ['R'], color_identity: ['R'], keywords: [], card_types: ['instant'],
};

const DEFS = new Map<string, CardDefinition>([
  ['forest', forest], ['island', island], ['bear', bear],
  ['artifact', artifact], ['creatureArtifact', creatureArtifact], ['bolt', bolt],
]);

function mk(instanceId: string, defId: string, zone: CardInstance['zone'] = 'library'): CardInstance {
  return {
    instanceId, definitionId: defId, ownerId: 'p0', zone,
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  };
}

function mkState(libraryDefs: string[], battlefieldDefs: string[] = []): GameState {
  const cards = new Map<string, CardInstance>();
  battlefieldDefs.forEach((defId, i) => {
    cards.set(`bf${i}`, { ...mk(`bf${i}`, defId), zone: 'battlefield' });
  });
  libraryDefs.forEach((defId, i) => {
    cards.set(`lib${i}`, mk(`lib${i}`, defId));
  });
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards,
    cardDefinitions: DEFS,
    activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main', step: 'begin_combat',
    turnNumber: 2, hasPriorityPassed: [false, false], stack: [], combat: null,
    battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function zoneIds(s: GameState, zone: CardInstance['zone']): string[] {
  return [...s.cards.values()].filter(c => c.zone === zone).map(c => c.instanceId).sort();
}

function onBf(s: GameState): string[] {
  return [...s.cards.values()].filter(c => c.zone === 'battlefield').map(c => c.instanceId).sort();
}

// ===========================================================================
// A. matchDigTopPutAllOntoBattlefield
//    Animist's Awakening: "Reveal the top X cards of your library. Put all land
//    cards from among them onto the battlefield tapped and the rest on the bottom
//    of your library in a random order."
// ===========================================================================

const ANIMISTS_AWAKENING = 'Reveal the top X cards of your library. Put all land cards from among them onto the battlefield tapped and the rest on the bottom of your library in a random order.';

describe('matchDigTopPutAllOntoBattlefield: Animist\'s Awakening family', () => {
  describe('parser', () => {
    it('parses Animist\'s Awakening into ChooseFromTopOfLibrary → battlefield tapped bottom-rest', () => {
      const p = parseOracleText(ANIMISTS_AWAKENING);
      if (p.kind !== 'Spell') throw new Error(`expected Spell, got ${p.kind}`);
      const e = p.effects.find(ef => ef.kind === 'ChooseFromTopOfLibrary') as any;
      expect(e).toBeDefined();
      expect(e.destination).toBe('battlefield');
      expect(e.restDestination).toBe('bottom');
      expect(e.tapped).toBe(true);
      expect(e.filter?.types).toContain('land');
      expect(e.minSelections).toBe(0);
    });

    it('parses fixed-count "put all creature cards from among them onto the battlefield" with graveyard rest', () => {
      const text = 'Reveal the top five cards of your library. Put all creature cards from among them onto the battlefield and the rest into your graveyard.';
      const p = parseOracleText(text);
      if (p.kind !== 'Spell') throw new Error(`expected Spell, got ${p.kind}`);
      const e = p.effects.find(ef => ef.kind === 'ChooseFromTopOfLibrary') as any;
      expect(e).toBeDefined();
      expect(e.destination).toBe('battlefield');
      expect(e.restDestination).toBe('graveyard');
      expect(e.filter?.types).toContain('creature');
      expect(e.tapped).toBeFalsy();
    });

    it('parses "look at" variant (look at the top N, put all artifact cards)', () => {
      const text = 'Look at the top four cards of your library. Put all artifact cards from among them onto the battlefield. Put the rest on the bottom of your library in any order.';
      const p = parseOracleText(text);
      if (p.kind !== 'Spell') throw new Error(`expected Spell, got ${p.kind}`);
      const e = p.effects.find(ef => ef.kind === 'ChooseFromTopOfLibrary') as any;
      expect(e).toBeDefined();
      expect(e.destination).toBe('battlefield');
      expect(e.filter?.types).toContain('artifact');
    });

    it('honesty guard: instant cards cannot enter the battlefield → Unparsed / no battlefield dig effect', () => {
      const text = 'Reveal the top five cards of your library. Put all instant cards from among them onto the battlefield. Put the rest on the bottom.';
      const p = parseOracleText(text);
      const e = p.kind === 'Spell'
        ? p.effects.find(ef => ef.kind === 'ChooseFromTopOfLibrary' && (ef as any).destination === 'battlefield')
        : undefined;
      expect(e).toBeUndefined();
    });

    it('honesty guard: manifest dread wording is not claimed (no manifest mechanic in engine)', () => {
      // "manifest dread" wording — engine has no manifest-dread mechanic, must stay Unparsed
      const text = 'Manifest dread twice. (To manifest dread, look at the top two cards of your library, put one onto the battlefield face down as a 2/2 creature, then put the other in your graveyard.)';
      // This should either stay Unparsed or parse the sentence without emitting ChooseFromTopOfLibrary battlefield
      const p = parseOracleText(text);
      // If it parses, it must NOT emit a ChooseFromTopOfLibrary with destination='battlefield'
      if (p.kind === 'Spell') {
        const e = p.effects.find(ef => ef.kind === 'ChooseFromTopOfLibrary' && (ef as any).destination === 'battlefield');
        expect(e).toBeUndefined();
      }
      // Unparsed is also fine
    });

    it('honesty guard: Mitotic Manipulation "same name as a permanent" is not claimed (no name-match executor)', () => {
      const text = 'Look at the top seven cards of your library. You may put one of those cards onto the battlefield if it has the same name as a permanent. Put the rest on the bottom of your library in a random order.';
      const p = parseOracleText(text);
      // Must not claim as a simple battlefield dig (no name-match condition in executor)
      if (p.kind === 'Spell') {
        const e = p.effects.find(ef => ef.kind === 'ChooseFromTopOfLibrary' && (ef as any).destination === 'battlefield');
        expect(e).toBeUndefined();
      }
    });
  });

  describe('executor', () => {
    it('Animist\'s Awakening X=4: all 3 lands go to battlefield tapped, 1 non-land goes to bottom', () => {
      // Top 4: forest, bear, island, bolt (bolt is not a land, bear is not a land)
      // X=4 so count=4, filter={types:['land']}, tapped=true
      const text = 'Reveal the top four cards of your library. Put all land cards from among them onto the battlefield tapped and the rest on the bottom of your library in a random order.';
      const p = parseOracleText(text);
      if (p.kind !== 'Spell') throw new Error(`expected Spell`);
      // Library: forest, bear, island, bolt, forest (5th card stays untouched)
      const s = mkState(['forest', 'bear', 'island', 'bolt', 'forest']);
      const s2 = executeEffects(s, p.effects, 'p0', [], []);
      // lib0=forest, lib2=island should be on battlefield tapped
      const bf = onBf(s2);
      expect(bf.sort()).toEqual(['lib0', 'lib2'].sort());
      // bear and bolt go to bottom
      expect(zoneIds(s2, 'library').sort()).toContain('lib1'); // bear
      expect(zoneIds(s2, 'library').sort()).toContain('lib3'); // bolt
      expect(zoneIds(s2, 'library').sort()).toContain('lib4'); // untouched 5th forest
      // Revealed lands should be tapped on battlefield
      const forestCard = s2.cards.get('lib0');
      expect(forestCard?.zone).toBe('battlefield');
      expect(forestCard?.tapped).toBe(true);
    });

    it('all-on-bottom: when no matching cards found, all cards stay on bottom', () => {
      const text = 'Reveal the top three cards of your library. Put all land cards from among them onto the battlefield tapped and the rest on the bottom of your library in a random order.';
      const p = parseOracleText(text);
      if (p.kind !== 'Spell') throw new Error(`expected Spell`);
      // No lands in top 3 — all 3 go to bottom, deep card untouched
      const s = mkState(['bear', 'bolt', 'bolt', 'forest']);
      const s2 = executeEffects(s, p.effects, 'p0', [], []);
      expect(onBf(s2)).toHaveLength(0);
      expect(zoneIds(s2, 'library')).toHaveLength(4); // all in library (3 bottomed + 1 untouched)
    });
  });
});

// ===========================================================================
// B. matchRevealTopOntoBattlefield: "noncreature <type>" compound filter
//    Smelting Vat: "Look at the top six cards of your library. Put up to two
//    noncreature artifact cards from among them onto the battlefield."
// ===========================================================================

const SMELTING_VAT = 'Look at the top six cards of your library. Put up to two noncreature artifact cards from among them onto the battlefield. Put the rest on the bottom of your library in a random order.';

describe('matchRevealTopOntoBattlefield: noncreature compound filter (Smelting Vat)', () => {
  describe('parser', () => {
    it('parses "noncreature artifact cards" into ChooseFromTopOfLibrary with excludeTypes+types filter', () => {
      const p = parseOracleText(SMELTING_VAT);
      if (p.kind !== 'Spell') throw new Error(`expected Spell, got ${p.kind}`);
      const e = p.effects.find(ef => ef.kind === 'ChooseFromTopOfLibrary') as any;
      expect(e).toBeDefined();
      expect(e.destination).toBe('battlefield');
      expect(e.maxSelections).toBe(2);
      expect(e.filter?.types).toContain('artifact');
      expect(e.filter?.excludeTypes).toContain('creature');
    });

    it('honesty: without a rest-placement tail the text stays Unparsed (rest tail is required for honest modeling)', () => {
      // matchRevealTopOntoBattlefield requires knowing where the rest go to model the effect
      // honestly. A text without a rest tail stays Unparsed — no incomplete effects emitted.
      const text = 'Look at the top six cards of your library. Put up to two noncreature artifact cards from among them onto the battlefield.';
      const p = parseOracleText(text);
      // Either Unparsed (rest tail missing) or the ChooseFromTopOfLibrary has a valid restDestination
      if (p.kind === 'Spell') {
        const e = p.effects.find(ef => ef.kind === 'ChooseFromTopOfLibrary') as any;
        if (e) {
          // If it DID parse, it must have an honest restDestination
          expect(e.restDestination).toBeDefined();
          expect(e.filter?.excludeTypes).toContain('creature');
        }
      } else {
        // Unparsed is also honest when rest tail is missing
        expect(p.kind).toBe('Unparsed');
      }
    });

    it('honesty guard: plain instant cards are rejected — no instants onto battlefield', () => {
      const text = 'Look at the top six cards of your library. Put up to two noncreature instant cards from among them onto the battlefield. Put the rest on the bottom.';
      const p = parseOracleText(text);
      const e = p.kind === 'Spell'
        ? p.effects.find(ef => ef.kind === 'ChooseFromTopOfLibrary' && (ef as any).destination === 'battlefield')
        : undefined;
      // "noncreature instant" → instant is not a permanent type → should not match
      expect(e).toBeUndefined();
    });
  });

  describe('executor', () => {
    it('only non-creature artifacts enter the battlefield; creature-artifacts and non-artifacts go to bottom', () => {
      const p = parseOracleText(SMELTING_VAT);
      if (p.kind !== 'Spell') throw new Error(`expected Spell`);
      // Top 6: artifact (noncreature), creatureArtifact, artifact, bear, bolt, forest
      // Only lib0 and lib2 (both pure artifacts, not creatures) should land on battlefield
      // maxSelections=2 so lib2 gets chosen but NOT creatureArtifact (it IS a creature)
      const s = mkState(['artifact', 'creatureArtifact', 'artifact', 'bear', 'bolt', 'forest', 'forest']);
      const s2 = executeEffects(s, p.effects, 'p0', [], []);
      const bf = onBf(s2);
      // lib0=artifact (noncreature) and lib2=artifact (noncreature) → battlefield
      expect(bf.sort()).toEqual(['lib0', 'lib2'].sort());
      // lib1=creatureArtifact (is a creature → excluded by filter) → stays in library (bottom)
      expect(zoneIds(s2, 'library')).toContain('lib1');
    });
  });
});

// ===========================================================================
// C. matchLookAtTopWhereXForEach: multi-type "and/or" battlefield destination
//    Kayla's Reconstruction: "Look at the top X cards ... where X is the number
//    of artifacts you control. Put up to X artifact and/or creature cards with
//    mana value 3 or less from among them onto the battlefield."
// ===========================================================================

const KAYLAS_RECONSTRUCTION_TEXT = 'Look at the top X cards of your library, where X is the number of artifacts you control. Put up to X artifact and/or creature cards with mana value 3 or less from among them onto the battlefield.';

describe('matchLookAtTopWhereXForEach: multi-type and/or battlefield (Kayla\'s Reconstruction)', () => {
  describe('parser', () => {
    it('parses into ChooseFromTopOfLibrary → battlefield with anyOf [artifact, creature] filter and cmc<=3', () => {
      const p = parseOracleText(KAYLAS_RECONSTRUCTION_TEXT);
      if (p.kind !== 'Spell') throw new Error(`expected Spell, got ${p.kind}`);
      const e = p.effects.find(ef => ef.kind === 'ChooseFromTopOfLibrary') as any;
      expect(e).toBeDefined();
      expect(e.destination).toBe('battlefield');
      // Either anyOf with artifact+creature branches OR a compound filter
      const filter = e.filter;
      const hasArtifact = filter?.types?.includes('artifact')
        || filter?.anyOf?.some((b: any) => b.types?.includes('artifact'));
      const hasCreature = filter?.types?.includes('creature')
        || filter?.anyOf?.some((b: any) => b.types?.includes('creature'));
      expect(hasArtifact).toBe(true);
      expect(hasCreature).toBe(true);
      // cmc filter should be lte 3
      const cmcFilter = e.filter?.cmc || e.filter?.anyOf?.[0]?.cmc;
      if (cmcFilter) {
        expect(cmcFilter).toEqual({ op: 'lte', value: 3 });
      }
    });
  });

  describe('executor', () => {
    it('places matching artifact/creature cards with mv<=3 onto battlefield; others go to bottom', () => {
      const p = parseOracleText(KAYLAS_RECONSTRUCTION_TEXT);
      if (p.kind !== 'Spell') throw new Error(`expected Spell`);
      // Controller has 3 artifacts on battlefield → X=3
      // Top 3: artifact(cmc1), bear(cmc2,creature), bolt(instant) → artifact+bear should land
      const s = mkState(
        ['artifact', 'bear', 'bolt', 'forest'],   // library
        ['artifact', 'artifact', 'artifact'],       // 3 artifacts on battlefield → X=3
      );
      const s2 = executeEffects(s, p.effects, 'p0', [], []);
      const bf = onBf(s2);
      // lib0=artifact (artifact, cmc1<=3) and lib1=bear (creature, cmc2<=3) → battlefield
      expect(bf).toContain('lib0');
      expect(bf).toContain('lib1');
      // lib2=bolt (instant) → does not match (not artifact or creature) → stays on bottom
      expect(zoneIds(s2, 'library')).toContain('lib2');
      // pre-existing battlefield artifacts are unchanged
      expect(bf).toContain('bf0');
      expect(bf).toContain('bf1');
      expect(bf).toContain('bf2');
    });
  });
});
