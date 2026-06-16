import { describe, expect, it } from 'vitest';
import { opponentGlance } from '../../../src/play/selectors/opponentGlance';
import { makePlayer, makeCreature, makeLand, makeCard } from '../fixtures/simpleState';

describe('opponentGlance', () => {
  it('carries player identity (id / name / life / handCount)', () => {
    const ai = makePlayer({ id: 'ai1', name: 'Atraxa', life: 33, handCount: 4 });
    const glance = opponentGlance({ player: ai, battlefield: [] });
    expect(glance.playerId).toBe('ai1');
    expect(glance.name).toBe('Atraxa');
    expect(glance.life).toBe(33);
    expect(glance.handCount).toBe(4);
  });

  it('counts creatures and sums their effective power', () => {
    const battlefield = [
      makeCreature({ power: 2, toughness: 2 }),
      makeCreature({ power: 5, toughness: 5 }),
      makeLand(),
    ];
    const glance = opponentGlance({ player: makePlayer({ id: 'ai1' }), battlefield });
    expect(glance.creatureCount).toBe(2);
    expect(glance.totalPower).toBe(7);
  });

  it('treats a missing power as zero in totalPower', () => {
    const battlefield = [
      makeCreature({ power: undefined }),
      makeCreature({ power: 3 }),
    ];
    const glance = opponentGlance({ player: makePlayer({ id: 'ai1' }), battlefield });
    expect(glance.creatureCount).toBe(2);
    expect(glance.totalPower).toBe(3);
  });

  it('counts untapped lands as open mana', () => {
    const battlefield = [
      makeLand({ tapped: false }),
      makeLand({ tapped: false }),
      makeLand({ tapped: true }), // tapped -> not open
    ];
    const glance = opponentGlance({ player: makePlayer({ id: 'ai1' }), battlefield });
    expect(glance.openMana).toBe(2);
  });

  it('counts untapped non-land mana rocks/dorks as open mana', () => {
    const battlefield = [
      makeLand({ tapped: false }),
      // Sol Ring: untapped artifact that adds mana
      makeCard({
        name: 'Sol Ring',
        typeLine: 'Artifact',
        cardTypes: ['artifact'],
        oracleText: '{T}: Add {C}{C}.',
        tapped: false,
      }),
      // Tapped rock does not count
      makeCard({
        name: 'Mind Stone',
        typeLine: 'Artifact',
        cardTypes: ['artifact'],
        oracleText: '{T}: Add {C}.',
        tapped: true,
      }),
    ];
    const glance = opponentGlance({ player: makePlayer({ id: 'ai1' }), battlefield });
    expect(glance.openMana).toBe(2);
  });

  it('does not count non-mana permanents as open mana', () => {
    const battlefield = [
      makeCreature({ tapped: false }), // vanilla creature, no mana text
      makeCard({
        name: 'Worn Powerstone',
        typeLine: 'Artifact',
        cardTypes: ['artifact'],
        oracleText: 'Worn Powerstone enters tapped. {T}: Add {C}{C}.',
        tapped: false,
      }),
    ];
    const glance = opponentGlance({ player: makePlayer({ id: 'ai1' }), battlefield });
    expect(glance.openMana).toBe(1);
  });

  it('flags commander-out when a commander permanent is on the battlefield', () => {
    const battlefield = [makeCreature({ isCommander: true }), makeLand()];
    const glance = opponentGlance({ player: makePlayer({ id: 'ai1' }), battlefield });
    expect(glance.flags).toContain('commander-out');
  });

  it('does not flag commander-out when no commander is on the battlefield', () => {
    const glance = opponentGlance({
      player: makePlayer({ id: 'ai1' }),
      battlefield: [makeCreature(), makeLand()],
    });
    expect(glance.flags).not.toContain('commander-out');
  });

  it('flags table-threat when total power crosses the threat threshold', () => {
    const battlefield = [
      makeCreature({ power: 7 }),
      makeCreature({ power: 6 }),
    ];
    const glance = opponentGlance({ player: makePlayer({ id: 'ai1' }), battlefield });
    expect(glance.flags).toContain('table-threat');
  });

  it('maps commander damage dealt to the human via the commander instance id', () => {
    const ai = makePlayer({ id: 'ai1' });
    // commander instance "cmd-1" controlled by ai1 has dealt 7 to the human
    const glance = opponentGlance({
      player: ai,
      battlefield: [makeCreature({ instanceId: 'cmd-1', isCommander: true })],
      humanCommanderDamage: { 'cmd-1': 7, 'other-cmd': 4 },
    });
    expect(glance.commanderDamageToYou).toBe(7);
  });
});
