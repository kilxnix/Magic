import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Clock, Eye, EyeOff, Loader2, PackageOpen, Swords, Trophy, Users } from 'lucide-react';
import type { ImportedCards, CardDataFromAPI } from '../hooks/useShelectorGame';

interface DraftSetSummary {
  set_code: string;
  set_name: string;
  set_type?: string;
  released_at?: string;
  card_count: number;
  rarities: Record<string, number>;
}

interface DraftCard {
  id: string;
  name: string;
  set: string;
  set_name?: string;
  released_at?: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'mythic' | string;
  type_line: string;
  oracle_text: string;
  mana_cost: string;
  cmc: number;
  colors: string[];
  color_identity: string[];
  keywords: string[];
  power: string | null;
  toughness: string | null;
  is_basic_land?: boolean;
}

interface DraftTournamentProps {
  onBack: () => void;
  onStartMatch: (humanDeck: ImportedCards, aiDecks: ImportedCards[]) => void;
}

const BASIC_BY_COLOR: Record<string, string> = {
  W: 'Plains',
  U: 'Island',
  B: 'Swamp',
  R: 'Mountain',
  G: 'Forest',
};

const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G'];
const PLAYER_COUNTS = [2, 3, 4, 5, 6, 7, 8];
const PACK_COUNT = 3;
const PACK_SIZE = 15;
const PRO_PICK_SECONDS = 40;
const DOUBLE_MASTERS_SET_CODES = new Set(['2xm', '2x2']);

function rarityClass(rarity: string): string {
  if (rarity === 'mythic') return 'border-orange-500/70 bg-orange-950/30 text-orange-100';
  if (rarity === 'rare') return 'border-amber-500/70 bg-amber-950/30 text-amber-100';
  if (rarity === 'uncommon') return 'border-slate-400/70 bg-slate-800/50 text-slate-100';
  return 'border-neutral-700 bg-neutral-900 text-stone-200';
}

function cardToApiData(card: DraftCard): CardDataFromAPI {
  return {
    name: card.name,
    type_line: card.type_line,
    mana_cost: card.mana_cost || '',
    cmc: card.cmc ?? 0,
    oracle_text: card.oracle_text || '',
    power: card.power ?? null,
    toughness: card.toughness ?? null,
    colors: card.colors || [],
    color_identity: card.color_identity || [],
    keywords: card.keywords || [],
  };
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function takeRandom(cards: DraftCard[], count: number, usedIds: Set<string>): DraftCard[] {
  const available = shuffle(cards.filter(card => !usedIds.has(card.id)));
  const picked = available.slice(0, count);
  for (const card of picked) usedIds.add(card.id);
  return picked;
}

function createBooster(pool: DraftCard[], setCode: string): DraftCard[] {
  const setCards = pool.filter(card => card.set.toLowerCase() === setCode.toLowerCase());
  const commons = setCards.filter(card => card.rarity === 'common' && !card.is_basic_land);
  const uncommons = setCards.filter(card => card.rarity === 'uncommon');
  const rares = setCards.filter(card => card.rarity === 'rare');
  const mythics = setCards.filter(card => card.rarity === 'mythic');
  const usedIds = new Set<string>();
  const rarePool = Math.random() < 0.125 && mythics.length > 0 ? mythics : rares.length > 0 ? rares : mythics;

  const booster = [
    ...takeRandom(rarePool, 1, usedIds),
    ...takeRandom(uncommons, 3, usedIds),
    ...takeRandom(commons, 11, usedIds),
  ];

  if (booster.length < PACK_SIZE) {
    booster.push(...takeRandom(setCards, PACK_SIZE - booster.length, usedIds));
  }

  return shuffle(booster).slice(0, PACK_SIZE);
}

function colorCounts(cards: DraftCard[]): Record<string, number> {
  const counts: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const card of cards) {
    const colors = card.color_identity.length > 0 ? card.color_identity : card.colors;
    for (const color of colors) {
      if (counts[color] != null) counts[color] += 1;
    }
  }
  return counts;
}

function preferredColors(cards: DraftCard[], fallback = ['G']): string[] {
  const ranked = Object.entries(colorCounts(cards))
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([color]) => color);
  return ranked.length > 0 ? ranked.slice(0, 2) : fallback;
}

function isRemoval(card: DraftCard): boolean {
  const text = card.oracle_text.toLowerCase();
  return /\bdestroy\b|\bexile\b|deals? \d+ damage|fight target|gets -\d+\/-\d+/.test(text);
}

function isCreature(card: DraftCard): boolean {
  return card.type_line.toLowerCase().includes('creature');
}

function scoreDraftCard(card: DraftCard, picks: DraftCard[]): number {
  const colors = preferredColors(picks, COLOR_ORDER);
  const cardColors = card.color_identity.length > 0 ? card.color_identity : card.colors;
  let score = 0;

  score += card.rarity === 'mythic' ? 7 : card.rarity === 'rare' ? 5 : card.rarity === 'uncommon' ? 2 : 0;
  if (cardColors.length === 0 || cardColors.some(color => colors.includes(color))) score += picks.length < 5 ? 2 : 5;
  if (cardColors.length > 0 && !cardColors.some(color => colors.includes(color)) && picks.length >= 6) score -= 4;
  if (isCreature(card)) score += 2;
  if (isRemoval(card)) score += 3;
  if (card.cmc >= 2 && card.cmc <= 4) score += 2;
  if (card.cmc >= 7) score -= 2;

  return score + Math.random();
}

function chooseDraftCard(pack: DraftCard[], picks: DraftCard[]): DraftCard | undefined {
  return [...pack].sort((a, b) => scoreDraftCard(b, picks) - scoreDraftCard(a, picks))[0];
}

function chooseDraftCards(pack: DraftCard[], picks: DraftCard[], count: number): DraftCard[] {
  const selected: DraftCard[] = [];
  let remaining = [...pack];
  for (let i = 0; i < count && remaining.length > 0; i++) {
    const pick = chooseDraftCard(remaining, [...picks, ...selected]);
    if (!pick) break;
    selected.push(pick);
    remaining = remaining.filter(card => card.id !== pick.id);
  }
  return selected;
}

function isDoubleMastersSet(setCode: string, setName = ''): boolean {
  return DOUBLE_MASTERS_SET_CODES.has(setCode.toLowerCase()) || /\bdouble masters\b/i.test(setName);
}

function buildLimitedDeck(playerName: string, pickedCards: DraftCard[]): ImportedCards {
  const colors = preferredColors(pickedCards);
  const nonlands = pickedCards.filter(card => !card.type_line.toLowerCase().includes('land'));
  const ranked = [...nonlands].sort((a, b) => scoreDraftCard(b, pickedCards) - scoreDraftCard(a, pickedCards));
  const spells = ranked.slice(0, 23);
  const landTotal = Math.max(40 - spells.length, 17);
  const colorWeights = colors.map(color => Math.max(1, colorCounts(spells)[color] || 0));
  const lands: string[] = [];

  for (let i = 0; i < landTotal; i++) {
    const totalWeight = colorWeights.reduce((sum, weight) => sum + weight, 0);
    let roll = i % totalWeight;
    let colorIndex = 0;
    for (let j = 0; j < colorWeights.length; j++) {
      roll -= colorWeights[j];
      if (roll < 0) {
        colorIndex = j;
        break;
      }
    }
    lands.push(BASIC_BY_COLOR[colors[colorIndex]] || 'Forest');
  }

  const cardData: Record<string, CardDataFromAPI> = {};
  for (const card of spells) cardData[card.name] = cardToApiData(card);

  return {
    commander: playerName,
    cards: spells.map(card => card.name),
    lands,
    cardData,
  };
}

function passPacks(packs: DraftCard[][], direction: 'left' | 'right'): DraftCard[][] {
  const next = Array.from({ length: packs.length }, () => [] as DraftCard[]);
  for (let i = 0; i < packs.length; i++) {
    const target = direction === 'left'
      ? (i + 1) % packs.length
      : (i - 1 + packs.length) % packs.length;
    next[target] = packs[i];
  }
  return next;
}

export function DraftTournament({ onBack, onStartMatch }: DraftTournamentProps) {
  const [sets, setSets] = useState<DraftSetSummary[]>([]);
  const [playerCount, setPlayerCount] = useState(8);
  const [packSets, setPackSets] = useState<string[]>(['', '', '']);
  const [cardPool, setCardPool] = useState<DraftCard[]>([]);
  const [phase, setPhase] = useState<'setup' | 'drafting' | 'complete'>('setup');
  const [packNumber, setPackNumber] = useState(0);
  const [pickNumber, setPickNumber] = useState(0);
  const [packs, setPacks] = useState<DraftCard[][]>([]);
  const [picks, setPicks] = useState<DraftCard[][]>([]);
  const [pendingDoubleMastersPicks, setPendingDoubleMastersPicks] = useState<DraftCard[]>([]);
  const [proMode, setProMode] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(PRO_PICK_SECONDS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pickLockRef = useRef(false);
  const pendingDoubleMastersPicksRef = useRef<DraftCard[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/draft/sets')
      .then(res => {
        if (!res.ok) throw new Error(`Failed to load sets (${res.status})`);
        return res.json();
      })
      .then((data: DraftSetSummary[]) => {
        if (cancelled) return;
        setSets(data);
        const defaultSet = data[0];
        if (defaultSet) setPackSets([defaultSet.set_code, defaultSet.set_code, defaultSet.set_code]);
      })
      .catch(err => {
        if (!cancelled) setError(err.message || 'Failed to load draft sets');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const humanPack = packs[0] || [];
  const humanPicks = picks[0] || [];
  const direction = packNumber % 2 === 0 ? 'left' : 'right';
  const setByCode = useMemo(
    () => new Map(sets.map(set => [set.set_code.toLowerCase(), set])),
    [sets],
  );
  const uniqueSetCodes = useMemo(
    () => [...new Set(packSets.map(code => code.toLowerCase()).filter(Boolean))],
    [packSets],
  );
  const currentPackSetCode = packSets[packNumber] || '';
  const currentPackSet = setByCode.get(currentPackSetCode.toLowerCase());
  const isDoubleMastersFirstPick = pickNumber === 0 && isDoubleMastersSet(currentPackSetCode, currentPackSet?.set_name);
  const requiredPicksForSelection = isDoubleMastersFirstPick ? 2 : 1;
  const pickRoundCount = PACK_SIZE - (isDoubleMastersSet(currentPackSetCode, currentPackSet?.set_name) ? 1 : 0);
  const pendingPickIds = new Set(pendingDoubleMastersPicks.map(card => card.id));
  const builtDeck = phase === 'complete' ? buildLimitedDeck('You', humanPicks) : null;

  useEffect(() => {
    pendingDoubleMastersPicksRef.current = pendingDoubleMastersPicks;
  }, [pendingDoubleMastersPicks]);

  useEffect(() => {
    setPendingDoubleMastersPicks([]);
  }, [packNumber, pickNumber, phase]);

  const startDraft = async () => {
    setError(null);
    if (uniqueSetCodes.length === 0) {
      setError('Choose a set for the draft packs.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/draft/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ set_codes: uniqueSetCodes }),
      });
      if (!res.ok) throw new Error(`Failed to load draft cards (${res.status})`);
      const data: { cards: DraftCard[] } = await res.json();
      setCardPool(data.cards);
      const firstPacks = Array.from(
        { length: playerCount },
        () => createBooster(data.cards, packSets[0]),
      );
      setPacks(firstPacks);
      setPicks(Array.from({ length: playerCount }, () => [] as DraftCard[]));
      setPendingDoubleMastersPicks([]);
      setPackNumber(0);
      setPickNumber(0);
      setPhase('drafting');
    } catch (err: any) {
      setError(err.message || 'Failed to start draft');
    } finally {
      setLoading(false);
    }
  };

  const advanceAfterHumanPick = useCallback((selectedCards: DraftCard[]) => {
    if (selectedCards.length === 0) return;
    if (pickLockRef.current) return;
    pickLockRef.current = true;
    const releasePickLock = () => {
      window.setTimeout(() => {
        pickLockRef.current = false;
      }, 0);
    };

    const nextPicks = picks.map(row => [...row]);
    const nextPacks = packs.map(row => [...row]);
    const selectedIds = new Set(selectedCards.map(card => card.id));
    nextPicks[0].push(...selectedCards);
    nextPacks[0] = nextPacks[0].filter(item => !selectedIds.has(item.id));

    for (let seat = 1; seat < playerCount; seat++) {
      const pack = nextPacks[seat];
      if (pack.length === 0) continue;
      const aiPickCount = isDoubleMastersFirstPick ? Math.min(2, pack.length) : 1;
      const aiPicks = chooseDraftCards(pack, nextPicks[seat], aiPickCount);
      if (aiPicks.length === 0) continue;
      const aiPickIds = new Set(aiPicks.map(pick => pick.id));
      nextPicks[seat].push(...aiPicks);
      nextPacks[seat] = pack.filter(item => !aiPickIds.has(item.id));
    }

    if (nextPacks.every(pack => pack.length === 0)) {
      if (packNumber + 1 >= PACK_COUNT) {
        setPicks(nextPicks);
        setPacks(nextPacks);
        setPhase('complete');
        releasePickLock();
        return;
      }

      const nextPackNumber = packNumber + 1;
      setPicks(nextPicks);
      setPacks(Array.from(
        { length: playerCount },
        () => createBooster(cardPool, packSets[nextPackNumber]),
      ));
      setPackNumber(nextPackNumber);
      setPickNumber(0);
      releasePickLock();
      return;
    }

    setPicks(nextPicks);
    setPacks(passPacks(nextPacks, direction));
    setPickNumber(prev => prev + 1);
    releasePickLock();
  }, [cardPool, direction, isDoubleMastersFirstPick, packNumber, packSets, packs, picks, playerCount]);

  const handleHumanCardClick = (card: DraftCard) => {
    if (requiredPicksForSelection === 1) {
      advanceAfterHumanPick([card]);
      return;
    }

    if (pendingDoubleMastersPicks.some(pick => pick.id === card.id)) return;
    const next = [...pendingDoubleMastersPicks, card];
    if (next.length >= requiredPicksForSelection) {
      setPendingDoubleMastersPicks([]);
      advanceAfterHumanPick(next.slice(0, requiredPicksForSelection));
      return;
    }
    setPendingDoubleMastersPicks(next);
  };

  useEffect(() => {
    if (!proMode || phase !== 'drafting' || humanPack.length === 0) {
      setSecondsRemaining(PRO_PICK_SECONDS);
      return;
    }

    setSecondsRemaining(PRO_PICK_SECONDS);
    const deadline = Date.now() + PRO_PICK_SECONDS * 1000;
    const timer = window.setInterval(() => {
      const nextSeconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSecondsRemaining(nextSeconds);

      if (nextSeconds <= 0) {
        window.clearInterval(timer);
        const pendingPicks = pendingDoubleMastersPicksRef.current;
        const pendingIds = new Set(pendingPicks.map(card => card.id));
        const remainingPack = (packs[0] || []).filter(card => !pendingIds.has(card.id));
        const autoPicksNeeded = Math.max(1, requiredPicksForSelection - pendingPicks.length);
        const autoPicks = chooseDraftCards(remainingPack, [...humanPicks, ...pendingPicks], autoPicksNeeded);
        const selectedCards = [...pendingPicks, ...autoPicks].slice(0, requiredPicksForSelection);
        setPendingDoubleMastersPicks([]);
        if (selectedCards.length > 0) advanceAfterHumanPick(selectedCards);
      }
    }, 250);

    return () => window.clearInterval(timer);
  }, [advanceAfterHumanPick, humanPack.length, humanPicks, packs, phase, pickNumber, packNumber, proMode, requiredPicksForSelection]);

  const startMatch = () => {
    const humanDeck = buildLimitedDeck('You', humanPicks);
    const aiDecks = picks.slice(1).map((pool, index) => buildLimitedDeck(`AI Drafter ${index + 1}`, pool));
    onStartMatch(humanDeck, [aiDecks[0]]);
  };

  return (
    <div className="rounded-xl border border-stone-700 bg-stone-800 p-4 md:p-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-bold text-stone-100">
            <Trophy className="h-5 w-5 text-amber-400" />
            Draft Tournament
          </h2>
          <div className="text-xs text-stone-500">Booster draft, 3 packs, 40-card Limited deck</div>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="flex min-h-[40px] items-center gap-2 rounded-lg bg-stone-700 px-3 py-2 text-sm text-stone-200 hover:bg-stone-600"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-700/50 bg-red-950/40 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {phase === 'setup' && (
        <div className="space-y-5">
          <div>
            <label className="mb-2 block text-sm text-stone-400">Draft Table</label>
            <div className="flex flex-wrap gap-2">
              {PLAYER_COUNTS.map(count => (
                <button
                  key={count}
                  type="button"
                  onClick={() => setPlayerCount(count)}
                  className={`min-h-[42px] rounded-lg px-3 py-2 text-sm font-bold ${
                    playerCount === count
                      ? 'bg-amber-600 text-white'
                      : 'bg-stone-700 text-stone-300 hover:bg-stone-600'
                  }`}
                >
                  <Users className="mr-1 inline h-4 w-4" />
                  {count}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm text-stone-400">Draft Rules</label>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setProMode(false)}
                className={`min-h-[58px] rounded-lg px-4 py-3 text-left transition-colors ${
                  !proMode
                    ? 'bg-amber-600 text-white'
                    : 'bg-stone-700 text-stone-300 hover:bg-stone-600'
                }`}
              >
                <span className="flex items-center gap-2 font-bold">
                  <Eye className="h-4 w-4" />
                  Casual Draft
                </span>
                <span className="block text-xs opacity-75">Untimed, pool review on</span>
              </button>
              <button
                type="button"
                onClick={() => setProMode(true)}
                className={`min-h-[58px] rounded-lg px-4 py-3 text-left transition-colors ${
                  proMode
                    ? 'bg-red-600 text-white'
                    : 'bg-stone-700 text-stone-300 hover:bg-stone-600'
                }`}
              >
                <span className="flex items-center gap-2 font-bold">
                  <EyeOff className="h-4 w-4" />
                  PRO Draft
                </span>
                <span className="block text-xs opacity-75">40s picks, pool locked</span>
              </button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {packSets.map((setCode, index) => (
              <label key={index} className="block">
                <span className="mb-2 block text-sm text-stone-400">Pack {index + 1}</span>
                <select
                  value={setCode}
                  onChange={event => {
                    const next = [...packSets];
                    next[index] = event.target.value;
                    setPackSets(next);
                  }}
                  className="min-h-[44px] w-full rounded-lg border border-stone-600 bg-stone-700 px-3 py-2 text-sm text-stone-100 focus:border-amber-500 focus:outline-none"
                >
                  {sets.slice(0, 120).map(set => (
                    <option key={`${index}-${set.set_code}`} value={set.set_code}>
                      {set.set_code.toUpperCase()} - {set.set_name}{set.released_at ? ` (${set.released_at.slice(0, 4)})` : ''}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <button
            type="button"
            onClick={startDraft}
            disabled={loading || packSets.some(code => !code)}
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-3 text-lg font-bold text-white transition-colors hover:bg-red-500 disabled:bg-stone-600 disabled:text-stone-400"
          >
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <PackageOpen className="h-5 w-5" />}
            Start Draft
          </button>
        </div>
      )}

      {phase === 'drafting' && (
        <div>
          <div className={`mb-4 grid gap-2 text-sm ${proMode ? 'sm:grid-cols-5' : 'sm:grid-cols-4'}`}>
            <div className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2">
              Pack <span className="font-bold text-amber-300">{packNumber + 1}/3</span>
            </div>
            <div className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2">
              Pick <span className="font-bold text-amber-300">{pickNumber + 1}/{pickRoundCount}</span>
            </div>
            <div className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2">
              Pass <span className="font-bold text-amber-300">{direction}</span>
            </div>
            <div className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2">
              Pool <span className="font-bold text-amber-300">{proMode ? 'locked' : humanPicks.length}</span>
            </div>
            {proMode && (
              <div className={`rounded border px-3 py-2 ${
                secondsRemaining <= 10
                  ? 'border-red-700 bg-red-950/40 text-red-100'
                  : 'border-neutral-700 bg-neutral-900 text-stone-200'
              }`}>
                <Clock className="mr-1 inline h-4 w-4" />
                <span className="font-bold">{secondsRemaining}s</span>
              </div>
            )}
          </div>

          {isDoubleMastersFirstPick && (
            <div className="mb-4 rounded-lg border border-amber-700/50 bg-amber-950/25 p-3 text-sm text-amber-100">
              Double Masters rule: choose {requiredPicksForSelection} cards before this pack passes.
              <span className="ml-2 font-bold">
                {pendingDoubleMastersPicks.length}/{requiredPicksForSelection} selected
              </span>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {humanPack.map(card => {
              const isPending = pendingPickIds.has(card.id);
              return (
              <button
                key={card.id}
                type="button"
                onClick={() => handleHumanCardClick(card)}
                disabled={isPending}
                className={`min-h-[9.5rem] rounded-lg border p-3 text-left transition-transform hover:-translate-y-0.5 disabled:cursor-default disabled:hover:translate-y-0 ${
                  isPending ? 'ring-2 ring-amber-300 ring-offset-2 ring-offset-stone-800' : ''
                } ${rarityClass(card.rarity)}`}
              >
                <div className="mb-1 flex items-start justify-between gap-2">
                  <div className="min-w-0 truncate text-sm font-black">{card.name}</div>
                  <div className="shrink-0 text-xs text-stone-400">{card.mana_cost}</div>
                </div>
                <div className="mb-2 truncate text-xs text-stone-400">{card.type_line}</div>
                <div className="line-clamp-4 text-xs leading-relaxed text-stone-300">{card.oracle_text || 'No rules text.'}</div>
                {card.power && card.toughness && (
                  <div className="mt-2 text-right text-sm font-black">{card.power}/{card.toughness}</div>
                )}
                {isPending && (
                  <div className="mt-2 rounded bg-amber-500/20 px-2 py-1 text-center text-xs font-bold text-amber-100">
                    Selected
                  </div>
                )}
              </button>
              );
            })}
          </div>

          {!proMode && humanPicks.length > 0 && (
            <div className="mt-4 rounded-lg border border-neutral-700 bg-neutral-900 p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-400">
                <Eye className="h-4 w-4" />
                Draft Pool
              </div>
              <div className="grid max-h-44 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
                {humanPicks.map((card, index) => (
                  <div key={`${card.id}-${index}`} className="min-w-0 rounded border border-neutral-800 bg-stone-800 px-2 py-1 text-xs">
                    <div className="truncate font-bold text-stone-200">{card.name}</div>
                    <div className="truncate capitalize text-stone-500">{card.rarity} - {card.type_line}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {proMode && (
            <div className="mt-4 rounded-lg border border-red-900/50 bg-red-950/20 p-3 text-sm text-red-100">
              <EyeOff className="mr-2 inline h-4 w-4" />
              Previous picks unlock when the draft is complete.
            </div>
          )}
        </div>
      )}

      {phase === 'complete' && builtDeck && (
        <div className="space-y-4">
          <div className="rounded-lg border border-green-700/50 bg-green-950/30 p-4">
            <div className="text-lg font-bold text-green-200">Draft Complete</div>
            <div className="mt-1 text-sm text-stone-400">
              {humanPicks.length} picks. Deck: {builtDeck.cards.length} spells, {builtDeck.lands.length} lands.
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-neutral-700 bg-neutral-900 p-3">
              <div className="mb-2 text-xs font-bold uppercase tracking-wider text-amber-400">Main Deck</div>
              <div className="max-h-72 space-y-1 overflow-y-auto text-sm">
                {[...builtDeck.cards, ...builtDeck.lands].map((name, index) => (
                  <div key={`${name}-${index}`} className="flex justify-between gap-3 border-b border-neutral-800 py-1 last:border-0">
                    <span className="truncate text-stone-200">{name}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-neutral-700 bg-neutral-900 p-3">
              <div className="mb-2 text-xs font-bold uppercase tracking-wider text-stone-500">Draft Pool</div>
              <div className="max-h-72 space-y-1 overflow-y-auto text-sm">
                {humanPicks.map((card, index) => (
                  <div key={`${card.id}-${index}`} className="flex justify-between gap-3 border-b border-neutral-800 py-1 last:border-0">
                    <span className="truncate text-stone-300">{card.name}</span>
                    <span className="shrink-0 text-xs capitalize text-stone-500">{card.rarity}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={startMatch}
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-green-700 px-4 py-3 text-lg font-bold text-white transition-colors hover:bg-green-600"
          >
            <Swords className="h-5 w-5" />
            Start Round 1 Match
          </button>
        </div>
      )}
    </div>
  );
}
