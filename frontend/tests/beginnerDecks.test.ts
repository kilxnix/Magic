import { describe, expect, it } from 'vitest';
import {
  BEGINNER_DECKS,
  CERTIFIED_BLUE_SPELLS,
  PRACTICE_DECKS,
  decklistCardNames,
  hasOnlyLegalBeginnerDuplicates,
} from '../src/lib/beginnerDecks';

describe('beginner starter decks', () => {
  it('provides multiple guided first-game choices', () => {
    expect(BEGINNER_DECKS.length).toBeGreaterThanOrEqual(3);
    expect(BEGINNER_DECKS.map(deck => deck.commander)).toContain('Goreclaw, Terror of Qal Sisma');
    expect(BEGINNER_DECKS.map(deck => deck.commander)).toContain('Krenko, Mob Boss');
    expect(BEGINNER_DECKS.map(deck => deck.commander)).toContain('Talrand, Sky Summoner');
  });

  it('formats each starter deck as commander import text', () => {
    for (const deck of BEGINNER_DECKS) {
      expect(deck.decklist).toContain(`Commander\n1 ${deck.commander}\nDeck\n`);
      expect(deck.bracket).toBe(2);
      expect(deck.plan.length).toBeGreaterThan(10);
    }
  });

  it('keeps nonbasic cards singleton while allowing basic land repeats', () => {
    for (const deck of BEGINNER_DECKS) {
      expect(hasOnlyLegalBeginnerDuplicates(deck)).toBe(true);
      expect(decklistCardNames(deck).length).toBeGreaterThan(45);
    }
  });

  it('makes the Talrand starter meaningfully spell-dense', () => {
    const talrandDeck = BEGINNER_DECKS.find(deck => deck.commander === 'Talrand, Sky Summoner');
    expect(talrandDeck).toBeTruthy();
    const names = decklistCardNames(talrandDeck!);
    const blueSpellCount = CERTIFIED_BLUE_SPELLS.filter(name => names.includes(name)).length;

    expect(blueSpellCount).toBe(CERTIFIED_BLUE_SPELLS.length);
    expect(blueSpellCount).toBeGreaterThanOrEqual(20);
  });

  it('provides the exact Xenagos dragon practice preset', () => {
    const xenagos = PRACTICE_DECKS.find(deck => deck.id === 'practice-xenagos-dragons');
    expect(xenagos).toBeTruthy();
    expect(xenagos?.commander).toBe('Xenagos, God of Revels');
    expect(xenagos?.audience).toBe('practice');
    expect(decklistCardNames(xenagos!).length).toBe(100);
    expect(hasOnlyLegalBeginnerDuplicates(xenagos!)).toBe(true);

    const names = decklistCardNames(xenagos!);
    expect(names).toContain('Dracogenesis');
    expect(names).toContain('Terror of the Peaks');
    expect(names).toContain('Twinflame Tyrant');
    expect(names).toContain('Tooth and Nail');
    expect(names).toContain('Blacker Lotus');
  });
});
