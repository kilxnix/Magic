import { ManaCost, ManaColor, ManaPool, emptyManaPool } from './types';
import type { CardDefinition, CardInstance, ConditionalMana, ConditionalManaEffectKind, Player, RestrictedMana } from './types';
import { typeLineHasSubtype, typeLineHasSupertype, typeLineSectionTerms } from './type-line';

const COLOR_SYMBOLS: ManaColor[] = ['W', 'U', 'B', 'R', 'G', 'C'];

export function parseManaString(manaString: string): ManaCost {
  const cost: ManaCost = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, generic: 0 };
  if (!manaString) return cost;

  const symbols = manaString.match(/\{[^}]+\}/g) || [];
  for (const sym of symbols) {
    const inner = sym.slice(1, -1).toUpperCase();
    if (COLOR_SYMBOLS.includes(inner as ManaColor)) {
      cost[inner as ManaColor]++;
    } else if (inner === 'S') {
      cost.snow = (cost.snow || 0) + 1;
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

interface ManaUnit {
  color: ManaColor;
  snow?: boolean;
  restrictedIndex?: number;
  conditionalIndex?: number;
  payLifeForPhyrexianColor?: ManaColor;
}

function cloneManaPool(pool?: ManaPool): ManaPool {
  return pool ? { ...pool } : emptyManaPool();
}

function buildPoolUnits(pool: ManaPool, snowPool?: ManaPool): ManaUnit[] {
  const units: ManaUnit[] = [];
  const snow = cloneManaPool(snowPool);
  for (const color of COLOR_SYMBOLS) {
    const snowCount = Math.min(pool[color], snow[color]);
    for (let i = 0; i < snowCount; i++) units.push({ color, snow: true });
    for (let i = snowCount; i < pool[color]; i++) units.push({ color });
  }
  return units;
}

function choosePoolPaymentUnits(pool: ManaPool, cost: ManaCost, snowPool?: ManaPool): ManaUnit[] | null {
  return choosePaymentFromUnits(buildPoolUnits(pool, snowPool), cost);
}

function choosePaymentFromUnits(units: ManaUnit[], cost: ManaCost): ManaUnit[] | null {
  const available = [...units];
  const used: ManaUnit[] = [];
  const hasSnowCost = (cost.snow || 0) > 0;

  const takeUnit = (predicate: (unit: ManaUnit) => boolean, preferNonSnow = false): ManaUnit | undefined => {
    let idx = preferNonSnow
      ? available.findIndex(unit => predicate(unit) && !unit.snow)
      : -1;
    if (idx === -1) idx = available.findIndex(predicate);
    if (idx === -1) return undefined;
    const [unit] = available.splice(idx, 1);
    used.push(unit);
    return unit;
  };

  for (const color of COLOR_SYMBOLS) {
    for (let i = 0; i < cost[color]; i++) {
      if (!takeUnit(unit => unit.color === color, hasSnowCost)) return null;
    }
  }

  for (const options of cost.hybrid || []) {
    if (!takeUnit(unit => options.includes(unit.color), hasSnowCost)) return null;
  }

  for (const color of cost.phyrexian || []) {
    if (!takeUnit(unit => unit.color === color, hasSnowCost)) return null;
  }

  for (let i = 0; i < (cost.snow || 0); i++) {
    if (!takeUnit(unit => unit.snow === true)) return null;
  }

  for (let i = 0; i < cost.generic; i++) {
    if (!takeUnit(() => true)) return null;
  }

  return used;
}

export function canPayCost(pool: ManaPool, cost: ManaCost): boolean {
  return choosePoolPaymentUnits(pool, cost) !== null;
}

/**
 * Pool-level payability that, unlike canPayCost, lets phyrexian pips be paid
 * with 2 life each (CR 107.4f) when the pool lacks that color — the same
 * semantics as the player-aware choosePaymentUnits. The PayCosts prompt gate
 * must use this so it agrees with the actual spell-payment path; otherwise
 * auto-pay plans for cards like Vault Skirge ({1}{B/P}) are wrongly rejected
 * even though the cast itself would pay the {B/P} with life.
 */
export function canPayCostWithLife(pool: ManaPool, cost: ManaCost, life: number): boolean {
  if (canPayCost(pool, cost)) return true;
  const phyrexian = cost.phyrexian || [];
  if (phyrexian.length === 0) return false;

  const available: ManaUnit[] = [];
  for (const color of COLOR_SYMBOLS) {
    for (let i = 0; i < pool[color]; i++) available.push({ color });
  }

  const take = (predicate: (unit: ManaUnit) => boolean): boolean => {
    const idx = available.findIndex(predicate);
    if (idx === -1) return false;
    available.splice(idx, 1);
    return true;
  };

  for (const color of COLOR_SYMBOLS) {
    for (let i = 0; i < cost[color]; i++) {
      if (!take(unit => unit.color === color)) return false;
    }
  }
  for (const options of cost.hybrid || []) {
    if (!take(unit => options.includes(unit.color))) return false;
  }
  let lifeToPay = 0;
  for (const color of phyrexian) {
    if (take(unit => unit.color === color)) continue;
    lifeToPay += 2;
    if (life < lifeToPay) return false;
  }
  // Pool-only view carries no snow tracking, same as 2-arg canPayCost: a
  // snow pip cannot be satisfied here.
  if ((cost.snow || 0) > 0) return false;
  for (let i = 0; i < cost.generic; i++) {
    if (!take(() => true)) return false;
  }
  return true;
}

export function payManaCost(pool: ManaPool, cost: ManaCost): ManaPool {
  const used = choosePoolPaymentUnits(pool, cost);
  if (!used) {
    throw new Error('Cannot pay mana cost');
  }

  const result: ManaPool = { ...pool };
  for (const unit of used) {
    result[unit.color]--;
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
  options: Pick<RestrictedMana, 'creatureType' | 'sourceInstanceId' | 'snow'> = {},
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
        ...(options.snow ? { snow: true } : {}),
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
  options: Pick<ConditionalMana, 'sourceInstanceId' | 'snow'> = {},
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
        ...(options.snow ? { snow: true } : {}),
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

function unrestrictedSnowManaPool(player: Pick<Player, 'snowManaPool' | 'restrictedMana' | 'conditionalMana'>): ManaPool {
  const pool = cloneManaPool(player.snowManaPool);
  for (const mana of player.restrictedMana || []) {
    if (!mana.snow) continue;
    pool[mana.color] = Math.max(0, pool[mana.color] - mana.amount);
  }
  for (const mana of player.conditionalMana || []) {
    if (!mana.snow) continue;
    pool[mana.color] = Math.max(0, pool[mana.color] - mana.amount);
  }
  return pool;
}

export function canPayUnrestrictedCost(
  player: Pick<Player, 'manaPool' | 'restrictedMana' | 'conditionalMana'> & Partial<Pick<Player, 'snowManaPool'>>,
  cost: ManaCost,
): boolean {
  return choosePoolPaymentUnits(unrestrictedManaPool(player), cost, unrestrictedSnowManaPool(player)) !== null;
}

export function payUnrestrictedManaCost(player: Player, cost: ManaCost): Player {
  const unrestrictedPool = unrestrictedManaPool(player);
  const unrestrictedSnowPool = unrestrictedSnowManaPool(player);
  const used = choosePoolPaymentUnits(unrestrictedPool, cost, unrestrictedSnowPool);
  if (!used) throw new Error('Cannot pay mana cost');

  const newPool = { ...unrestrictedPool };
  const newSnowPool = { ...unrestrictedSnowPool };
  for (const unit of used) {
    newPool[unit.color] -= 1;
    if (unit.snow) newSnowPool[unit.color] = Math.max(0, newSnowPool[unit.color] - 1);
  }

  const restrictedMana = cloneRestrictedMana(player.restrictedMana);
  const conditionalMana = cloneConditionalMana(player.conditionalMana);
  const restoredPool: ManaPool = { ...newPool };
  const restoredSnowPool: ManaPool = { ...newSnowPool };
  for (const mana of restrictedMana) {
    restoredPool[mana.color] += mana.amount;
    if (mana.snow) restoredSnowPool[mana.color] += mana.amount;
  }
  for (const mana of conditionalMana) {
    restoredPool[mana.color] += mana.amount;
    if (mana.snow) restoredSnowPool[mana.color] += mana.amount;
  }
  return { ...player, manaPool: restoredPool, snowManaPool: restoredSnowPool, restrictedMana, conditionalMana };
}

type SpellPaymentPlayer = Pick<Player, 'manaPool' | 'restrictedMana' | 'conditionalMana'> & Partial<Pick<Player, 'life' | 'snowManaPool'>>;

export function getCreatureSubtypes(def: CardDefinition): string[] {
  if (!def.card_types.includes('creature')) return [];
  return typeLineSectionTerms(def.type_line, 'subtypes')
    .map(part => part.trim().replace(/[^A-Za-z0-9 ]/g, ''))
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
      return typeLineHasSubtype(spellDef.type_line, mana.creatureType);
    case 'legendarySpell':
      return typeLineHasSupertype(spellDef.type_line, 'legendary');
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
  const unrestrictedSnowPool = unrestrictedSnowManaPool(player);

  for (let index = 0; index < restrictedMana.length; index++) {
    const mana = restrictedMana[index];
    if (!restrictionAllows(mana, spellDef, spellCard)) continue;
    for (let i = 0; i < mana.amount; i++) units.push({ color: mana.color, snow: mana.snow, restrictedIndex: index });
  }

  for (let index = 0; index < conditionalMana.length; index++) {
    const mana = conditionalMana[index];
    for (let i = 0; i < mana.amount; i++) units.push({ color: mana.color, snow: mana.snow, conditionalIndex: index });
  }

  units.push(...buildPoolUnits(unrestrictedPool, unrestrictedSnowPool));

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
  const hasSnowCost = (cost.snow || 0) > 0;

  const takeUnit = (predicate: (unit: ManaUnit) => boolean, preferNonSnow = false): ManaUnit | undefined => {
    let idx = preferNonSnow
      ? units.findIndex(unit => predicate(unit) && !unit.snow)
      : -1;
    if (idx === -1) idx = units.findIndex(predicate);
    if (idx === -1) return undefined;
    const [unit] = units.splice(idx, 1);
    used.push(unit);
    return unit;
  };

  for (const color of COLOR_SYMBOLS) {
    for (let i = 0; i < cost[color]; i++) {
      if (!takeUnit(unit => unit.color === color, hasSnowCost)) return null;
    }
  }

  for (const options of cost.hybrid || []) {
    if (!takeUnit(unit => options.includes(unit.color), hasSnowCost)) return null;
  }

  let lifeToPay = 0;
  for (const color of cost.phyrexian || []) {
    const paidWithMana = takeUnit(unit => unit.color === color, hasSnowCost);
    if (paidWithMana) continue;
    lifeToPay += 2;
    if ((player.life ?? 0) < lifeToPay) return null;
    used.push({ color, payLifeForPhyrexianColor: color });
  }

  for (let i = 0; i < (cost.snow || 0); i++) {
    if (!takeUnit(unit => unit.snow === true)) return null;
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
  const snowManaPool = cloneManaPool(player.snowManaPool);
  const restrictedMana = cloneRestrictedMana(player.restrictedMana);
  const conditionalMana = cloneConditionalMana(player.conditionalMana);

  for (const unit of used) {
    if (unit.payLifeForPhyrexianColor) continue;
    manaPool[unit.color] -= 1;
    if (unit.snow) snowManaPool[unit.color] = Math.max(0, snowManaPool[unit.color] - 1);
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
    snowManaPool,
    restrictedMana: restrictedMana.filter(m => m.amount > 0),
    conditionalMana: conditionalMana.filter(m => m.amount > 0),
  };
}
