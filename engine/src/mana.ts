import { ManaCost, ManaColor, ManaPool, emptyManaPool } from './types';
import type { CardDefinition, CardInstance, ConditionalMana, ConditionalManaEffectKind, Player, RestrictedMana } from './types';

const COLOR_SYMBOLS: ManaColor[] = ['W', 'U', 'B', 'R', 'G', 'C'];

export function parseManaString(manaString: string): ManaCost {
  const cost: ManaCost = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, generic: 0 };
  if (!manaString) return cost;

  const symbols = manaString.match(/\{[^}]+\}/g) || [];
  for (const sym of symbols) {
    const inner = sym.slice(1, -1).toUpperCase();
    if (COLOR_SYMBOLS.includes(inner as ManaColor)) {
      cost[inner as ManaColor]++;
    } else if (/^[WUBRG]\/P$/.test(inner)) {
      cost.phyrexian = [...(cost.phyrexian || []), inner[0] as ManaColor];
    } else if (inner.includes('/')) {
      const options = inner
        .split('/')
        .filter(part => COLOR_SYMBOLS.includes(part as ManaColor)) as ManaColor[];
      if (options.length >= 2) {
        cost.hybrid = [...(cost.hybrid || []), options];
      }
    } else {
      const num = parseInt(inner, 10);
      if (!isNaN(num)) {
        cost.generic += num;
      }
    }
  }
  return cost;
}

export function addMana(pool: ManaPool, color: ManaColor, amount: number): ManaPool {
  return { ...pool, [color]: pool[color] + amount };
}

export function totalMana(pool: ManaPool): number {
  return pool.W + pool.U + pool.B + pool.R + pool.G + pool.C;
}

export function canPayCost(pool: ManaPool, cost: ManaCost): boolean {
  const remainingPool: ManaPool = { ...pool };
  for (const color of COLOR_SYMBOLS) {
    if (remainingPool[color] < cost[color]) return false;
    remainingPool[color] -= cost[color];
  }

  for (const options of cost.hybrid || []) {
    const color = [...options].sort((a, b) => remainingPool[b] - remainingPool[a])
      .find(option => remainingPool[option] > 0);
    if (!color) return false;
    remainingPool[color]--;
  }

  for (const color of cost.phyrexian || []) {
    if (remainingPool[color] <= 0) return false;
    remainingPool[color]--;
  }

  const remaining = COLOR_SYMBOLS.reduce((sum, color) => sum + remainingPool[color], 0);
  return remaining >= cost.generic;
}

export function payManaCost(pool: ManaPool, cost: ManaCost): ManaPool {
  if (!canPayCost(pool, cost)) {
    throw new Error('Cannot pay mana cost');
  }

  const result: ManaPool = { ...pool };

  // Pay colored costs first
  for (const color of COLOR_SYMBOLS) {
    result[color] -= cost[color];
  }

  // Pay hybrid symbols from remaining legal colors, preserving the largest
  // pools for later hybrid/generic symbols where possible.
  for (const options of cost.hybrid || []) {
    const color = [...options].sort((a, b) => result[b] - result[a])
      .find(option => result[option] > 0);
    if (!color) throw new Error('Cannot pay mana cost');
    result[color]--;
  }

  for (const color of cost.phyrexian || []) {
    if (result[color] <= 0) throw new Error('Cannot pay mana cost');
    result[color]--;
  }

  // Pay generic from remaining (largest pools first to preserve options)
  let genericLeft = cost.generic;
  const colorsByPool = [...COLOR_SYMBOLS].sort((a, b) => result[b] - result[a]);
  for (const color of colorsByPool) {
    const take = Math.min(result[color], genericLeft);
    result[color] -= take;
    genericLeft -= take;
    if (genericLeft === 0) break;
  }

  return result;
}

function cloneRestrictedMana(restrictedMana?: RestrictedMana[]): RestrictedMana[] {
  return (restrictedMana || [])
    .filter(m => m.amount > 0)
    .map(m => ({ ...m }));
}

function cloneConditionalMana(conditionalMana?: ConditionalMana[]): ConditionalMana[] {
  return (conditionalMana || [])
    .filter(m => m.amount > 0)
    .map(m => ({ ...m }));
}

export function addRestrictedMana(
  player: Player,
  color: ManaColor,
  amount: number,
  restriction?: RestrictedMana['restriction'],
  options: Pick<RestrictedMana, 'creatureType' | 'sourceInstanceId'> = {},
): Player {
  if (!restriction || amount <= 0) return player;
  return {
    ...player,
    restrictedMana: [
      ...cloneRestrictedMana(player.restrictedMana),
      {
        color,
        amount,
        restriction,
        ...(options.creatureType ? { creatureType: options.creatureType } : {}),
        ...(options.sourceInstanceId ? { sourceInstanceId: options.sourceInstanceId } : {}),
      },
    ],
  };
}

export function clearRestrictedMana(player: Player): Player {
  return { ...player, restrictedMana: [] };
}

export function addConditionalMana(
  player: Player,
  color: ManaColor,
  amount: number,
  effect: ConditionalManaEffectKind,
  options: Pick<ConditionalMana, 'sourceInstanceId'> = {},
): Player {
  if (amount <= 0) return player;
  return {
    ...player,
    conditionalMana: [
      ...cloneConditionalMana(player.conditionalMana),
      {
        color,
        amount,
        effect,
        ...(options.sourceInstanceId ? { sourceInstanceId: options.sourceInstanceId } : {}),
      },
    ],
  };
}

export function clearConditionalMana(player: Player): Player {
  return { ...player, conditionalMana: [] };
}

export function unrestrictedManaPool(player: Pick<Player, 'manaPool' | 'restrictedMana' | 'conditionalMana'>): ManaPool {
  const pool = { ...player.manaPool };
  for (const mana of player.restrictedMana || []) {
    pool[mana.color] = Math.max(0, pool[mana.color] - mana.amount);
  }
  for (const mana of player.conditionalMana || []) {
    pool[mana.color] = Math.max(0, pool[mana.color] - mana.amount);
  }
  return pool;
}

export function canPayUnrestrictedCost(player: Pick<Player, 'manaPool' | 'restrictedMana' | 'conditionalMana'>, cost: ManaCost): boolean {
  return canPayCost(unrestrictedManaPool(player), cost);
}

export function payUnrestrictedManaCost(player: Player, cost: ManaCost): Player {
  const newPool = payManaCost(unrestrictedManaPool(player), cost);
  const restrictedMana = cloneRestrictedMana(player.restrictedMana);
  const conditionalMana = cloneConditionalMana(player.conditionalMana);
  const restoredPool: ManaPool = { ...newPool };
  for (const mana of restrictedMana) {
    restoredPool[mana.color] += mana.amount;
  }
  for (const mana of conditionalMana) {
    restoredPool[mana.color] += mana.amount;
  }
  return { ...player, manaPool: restoredPool, restrictedMana, conditionalMana };
}

type SpellPaymentPlayer = Pick<Player, 'manaPool' | 'restrictedMana' | 'conditionalMana'> & Partial<Pick<Player, 'life'>>;

interface ManaUnit {
  color: ManaColor;
  restrictedIndex?: number;
  conditionalIndex?: number;
  payLifeForPhyrexianColor?: ManaColor;
}

export function getCreatureSubtypes(def: CardDefinition): string[] {
  if (!def.card_types.includes('creature')) return [];
  const typeLine = def.type_line.replace(/[—–]/g, '-');
  const [, subtypePart] = typeLine.split('-');
  if (!subtypePart) return [];
  return subtypePart
    .split(/\s+/)
    .map(part => part.trim().replace(/[^A-Za-z0-9]/g, ''))
    .filter(Boolean);
}

function restrictionAllows(
  mana: RestrictedMana,
  spellDef: CardDefinition,
  spellCard?: CardInstance,
): boolean {
  switch (mana.restriction) {
    case 'creatureSpell':
      return spellDef.card_types.includes('creature');
    case 'creatureTypeSpell':
      if (!mana.creatureType) return false;
      return getCreatureSubtypes(spellDef)
        .some(subtype => subtype.toLowerCase() === mana.creatureType!.toLowerCase());
    case 'legendarySpell':
      return /\blegendary\b/i.test(spellDef.type_line);
    case 'commanderSpell':
      return spellCard?.isCommander === true;
  }
}

function buildSpendableUnits(
  player: SpellPaymentPlayer,
  spellDef: CardDefinition,
  spellCard?: CardInstance,
): ManaUnit[] {
  const units: ManaUnit[] = [];
  const restrictedMana = cloneRestrictedMana(player.restrictedMana);
  const conditionalMana = cloneConditionalMana(player.conditionalMana);
  const unrestrictedPool = unrestrictedManaPool(player);

  for (let index = 0; index < restrictedMana.length; index++) {
    const mana = restrictedMana[index];
    if (!restrictionAllows(mana, spellDef, spellCard)) continue;
    for (let i = 0; i < mana.amount; i++) units.push({ color: mana.color, restrictedIndex: index });
  }

  for (let index = 0; index < conditionalMana.length; index++) {
    const mana = conditionalMana[index];
    for (let i = 0; i < mana.amount; i++) units.push({ color: mana.color, conditionalIndex: index });
  }

  for (const color of COLOR_SYMBOLS) {
    for (let i = 0; i < unrestrictedPool[color]; i++) units.push({ color });
  }

  return units;
}

function choosePaymentUnits(
  player: SpellPaymentPlayer,
  cost: ManaCost,
  spellDef: CardDefinition,
  spellCard?: CardInstance,
): ManaUnit[] | null {
  const units = buildSpendableUnits(player, spellDef, spellCard);
  const used: ManaUnit[] = [];

  const takeUnit = (predicate: (unit: ManaUnit) => boolean): ManaUnit | undefined => {
    const idx = units.findIndex(predicate);
    if (idx === -1) return undefined;
    const [unit] = units.splice(idx, 1);
    used.push(unit);
    return unit;
  };

  for (const color of COLOR_SYMBOLS) {
    for (let i = 0; i < cost[color]; i++) {
      if (!takeUnit(unit => unit.color === color)) return null;
    }
  }

  for (const options of cost.hybrid || []) {
    if (!takeUnit(unit => options.includes(unit.color))) return null;
  }

  let lifeToPay = 0;
  for (const color of cost.phyrexian || []) {
    const paidWithMana = takeUnit(unit => unit.color === color);
    if (paidWithMana) continue;
    lifeToPay += 2;
    if ((player.life ?? 0) < lifeToPay) return null;
    used.push({ color, payLifeForPhyrexianColor: color });
  }

  for (let i = 0; i < cost.generic; i++) {
    if (!takeUnit(() => true)) return null;
  }

  return used;
}

export function canPaySpellCost(
  player: SpellPaymentPlayer,
  cost: ManaCost,
  spellDef: CardDefinition,
  spellCard?: CardInstance,
): boolean {
  return choosePaymentUnits(player, cost, spellDef, spellCard) !== null;
}

export function getSpellPaymentRestrictedMana(
  player: SpellPaymentPlayer,
  cost: ManaCost,
  spellDef: CardDefinition,
  spellCard?: CardInstance,
): RestrictedMana[] {
  const used = choosePaymentUnits(player, cost, spellDef, spellCard);
  if (!used) return [];

  const restrictedMana = cloneRestrictedMana(player.restrictedMana);
  const usedIndexes = new Set<number>();
  for (const unit of used) {
    if (unit.restrictedIndex !== undefined) {
      usedIndexes.add(unit.restrictedIndex);
    }
  }

  return [...usedIndexes].map(index => ({ ...restrictedMana[index] }));
}

export function getSpellPaymentConditionalMana(
  player: SpellPaymentPlayer,
  cost: ManaCost,
  spellDef: CardDefinition,
  spellCard?: CardInstance,
): ConditionalMana[] {
  const used = choosePaymentUnits(player, cost, spellDef, spellCard);
  if (!used) return [];

  const conditionalMana = cloneConditionalMana(player.conditionalMana);
  const usedIndexes = new Set<number>();
  for (const unit of used) {
    if (unit.conditionalIndex !== undefined) {
      usedIndexes.add(unit.conditionalIndex);
    }
  }

  return [...usedIndexes].map(index => ({ ...conditionalMana[index] }));
}

export function paySpellCost(
  player: Player,
  cost: ManaCost,
  spellDef: CardDefinition,
  spellCard?: CardInstance,
): Player {
  const used = choosePaymentUnits(player, cost, spellDef, spellCard);
  if (!used) throw new Error('Cannot pay mana cost');

  const manaPool = { ...player.manaPool };
  const restrictedMana = cloneRestrictedMana(player.restrictedMana);
  const conditionalMana = cloneConditionalMana(player.conditionalMana);

  for (const unit of used) {
    if (unit.payLifeForPhyrexianColor) continue;
    manaPool[unit.color] -= 1;
    if (unit.restrictedIndex !== undefined) {
      restrictedMana[unit.restrictedIndex].amount -= 1;
    }
    if (unit.conditionalIndex !== undefined) {
      conditionalMana[unit.conditionalIndex].amount -= 1;
    }
  }

  return {
    ...player,
    life: player.life - used.filter(unit => unit.payLifeForPhyrexianColor).length * 2,
    manaPool,
    restrictedMana: restrictedMana.filter(m => m.amount > 0),
    conditionalMana: conditionalMana.filter(m => m.amount > 0),
  };
}
