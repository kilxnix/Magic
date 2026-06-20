import { useState, useEffect, useMemo, useRef, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ClipboardPaste, Download, Loader2, Swords, Link as LinkIcon, History, Trash2, Shield, Trophy, Users, Lightbulb, X, Save, FolderOpen, Database, BookmarkPlus, Rocket, Upload, BarChart3, Target } from 'lucide-react';
import { useShelectorGame, type GameLogEntry, type ImportedCards, type ShelectorGameSaveSnapshot } from '../hooks/useShelectorGame';
import { GameBoard } from '../components/GameBoard';
import { PlayExperience } from '../play/PlayExperience';
import { GameReview } from '../components/GameReview';
import { EndGameModal } from '../components/shelector/EndGameModal';
import { DraftTournament } from '../components/DraftTournament';
import { StandardTournament } from '../components/StandardTournament';
import { cacheSet, cacheGet } from '../lib/cache';
import { importDeckUrlLocally } from '../lib/deckUrlImport';
import { FLOATING_TABLE_LAYOUT } from '../lib/gameBoardLayout';
import { shelectorApiUrl } from '../lib/api';
import {
  BEGINNER_DECKS,
  PRACTICE_DECKS,
  XENAGOS_PRACTICE_COACHING_NOTES,
  XENAGOS_PRACTICE_FOCUS_TAGS,
  XENAGOS_PRACTICE_KEY_CARDS,
  type BeginnerDeck,
} from '../lib/beginnerDecks';
import { auditPlaySaveSnapshot } from '../lib/playSaveAudit';
import { auditCanonicalPlayEngineSave, buildCanonicalPlayEngineSave, restoreCanonicalPlayEngineState } from '../lib/playCanonicalSave';
import { findUnsupportedEngineCards, formatUnsupportedEngineCards } from '../lib/enginePreflight';
import {
  deletePlaySaveSlot,
  getPlaySaveSlots,
  loadCanonicalPlayStateRef,
  loadCanonicalPlaySlotState,
  putPlaySaveSlot,
  type PlayDrillDecisionContext,
  type PlayDrillAttempt,
  type PlayDrillBookmark,
  type PlaySaveSlotRecord,
} from '../lib/playSaveStorage';
import { buildPracticeBranchPreviews } from '../lib/practiceBranchPreview';

interface DeckImportResult {
  commander: string | null;
  cards: string[];
  lands: string[];
  sideboard?: string[];
  card_data: Record<string, any>;
  total: number;
  valid: boolean;
  errors: string[];
  warnings: string[];
  filled_cards: string[];
}

interface DeckHistoryEntry {
  commander: string;
  text: string;
  timestamp: number;
}

interface ImportedDeckEngineReadiness {
  partnerCommanders: string[];
  duplicateRepairApplied: boolean;
  unsupportedCards: ReturnType<typeof findUnsupportedEngineCards>;
  filledCards: string[];
}

function missingCommanderDeckSlots(importResult: DeckImportResult | null): number {
  if (!importResult) return 0;
  return Math.max(0, 100 - (importResult.total || 0));
}

interface SpawnedOpponent {
  commander: string;
  deck_name?: string;
  personality: string;
  colors?: string[];
  deck_id?: string;
  strategy?: string;
}

interface AIDeckResponse {
  commander: string;
  cards: string[];
  lands: string[];
  card_data: DeckImportResult['card_data'];
}

const DECK_HISTORY_MAX = 5;
const GUIDED_PROMPT_CACHE_KEY = 'guided_first_game_prompt_seen';
const SAVE_SLOT_COUNT = 4;
const AUTOSAVE_DELAY_MS = 6000;
const AUTOSAVE_INTERVAL_MS = 30000;

const COLOR_BADGES: Record<string, string> = {
  W: 'bg-amber-100 text-amber-800',
  U: 'bg-blue-100 text-blue-800',
  B: 'bg-gray-300 text-gray-900',
  R: 'bg-red-100 text-red-800',
  G: 'bg-green-100 text-green-800',
};

const PERSONALITIES = ['Balanced', 'Aggressive', 'Greedy', 'Political'] as const;
const PRESET_DECKS = [...PRACTICE_DECKS, ...BEGINNER_DECKS];

type OpponentCount = 1 | 2 | 3;

function getPartnerCommanderNames(imported: DeckImportResult | null): string[] {
  if (!imported?.commander || !imported.commander.includes(' // ')) return [];
  const parts = imported.commander.split(' // ').map(name => name.trim()).filter(Boolean);
  if (parts.length < 2) return [];
  const fullCard = imported.card_data?.[imported.commander];
  const exactSplitCard = Boolean(fullCard && !parts.every(part => imported.card_data?.[part]));
  if (exactSplitCard) return [];
  return parts;
}

const MATCH_SIZES: { label: string; players: number; opponentCount: OpponentCount }[] = [
  { label: '1v1', players: 2, opponentCount: 1 },
  { label: '1v1v1', players: 3, opponentCount: 2 },
  { label: '1v1v1v1', players: 4, opponentCount: 3 },
];

const TRAINING_SCENARIOS = [
  {
    id: 'complex-combat',
    title: 'Complex Combat',
    focus: 'multi-defender combat',
    description: 'Practice attacks, blockers, and damage assignment across several opponents.',
  },
  {
    id: 'storm-grapeshot',
    title: 'Storm Stack',
    focus: 'storm and triggers',
    description: 'Start with Vivi and Grapeshot ready so stack, storm, and magecraft pressure are immediate.',
  },
  {
    id: 'token-stack',
    title: 'Token Board',
    focus: 'token stacking',
    description: 'Open a small token board to inspect stacking, counters, and manual correction flow.',
  },
  {
    id: 'land-entry-fetch',
    title: 'Fetch/Shock Land',
    focus: 'replacement choices',
    description: 'Practice fetchland activation and land-entry choices from a controlled board.',
  },
  {
    id: 'library-manipulation',
    title: 'Scry/Surveil',
    focus: 'library choices',
    description: 'Practice keeping cards on top, bottoming cards, and surveiling to the graveyard.',
  },
  {
    id: 'modal-choice',
    title: 'Modal Choices',
    focus: 'mode selection',
    description: 'Practice choose-one spell modes and make sure each mode targets the right card type.',
  },
  {
    id: 'mulligan-selection',
    title: 'Mulligan Selection',
    focus: 'opening hand',
    description: 'Practice selecting exactly which opening-hand cards to redraw before keeping.',
  },
  {
    id: 'equipment-d20',
    title: 'D20 Equipment',
    focus: 'dice and equip',
    description: 'Open Goblin Morningstar lines for d20 and equipment-action checks.',
  },
  {
    id: 'sisay-activation',
    title: 'Sisay Activation',
    focus: 'five-color activation',
    description: 'Jump into a live Sisay board with mana ready and library choices waiting to be tested.',
  },
] as const;

type TrainingScenarioId = typeof TRAINING_SCENARIOS[number]['id'];

function metricFromAttemptSummary(summary: string, label: string): number | null {
  const match = summary.match(new RegExp(`${label}\\s+(-?\\d+)`, 'i'));
  return match ? Number(match[1]) : null;
}

function opponentLifeAverageFromSummary(summary: string): number | null {
  const opponentSegment = summary
    .split('/')
    .map(part => part.trim())
    .find(part => part.toLowerCase().startsWith('opponents '));
  if (!opponentSegment) return null;
  const values = [...opponentSegment.matchAll(/\b(-?\d+)\b/g)].map(match => Number(match[1]));
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function scorePracticeAttemptSummary(summary: string): { score: number; label: string } {
  const life = metricFromAttemptSummary(summary, 'You') ?? 0;
  const hand = metricFromAttemptSummary(summary, 'hand') ?? 0;
  const board = metricFromAttemptSummary(summary, 'board') ?? 0;
  const graveyard = metricFromAttemptSummary(summary, 'graveyard') ?? 0;
  const stack = metricFromAttemptSummary(summary, 'stack') ?? 0;
  const averageOpponentLife = opponentLifeAverageFromSummary(summary) ?? 40;
  const score = (life * 1.2) + (board * 3) + (hand * 0.8) + (graveyard * 0.15) - (averageOpponentLife * 0.45) - (stack * 0.5);
  return {
    score,
    label: [
      `score ${score.toFixed(1)}`,
      `life ${life}`,
      `board ${board}`,
      `hand ${hand}`,
      `opp avg ${averageOpponentLife.toFixed(1)}`,
    ].join(' / '),
  };
}

export function PlayPage() {
  const {
    gameState,
    legalActions,
    isLoading,
    isHumanTurn,
    isGameOver,
    winner,
    error,
    mulliganPhase,
    mulliganCount,
    mulliganBottomCount,
    selectedMulliganCardIds,
    selectedMulliganBottomIds,
    discardPhase,
    discardCount,
    tutorPhase,
    tutorCards,
    tutorTitle,
    targetingPrompt,
    libraryChoice,
    optionalTriggerChoice,
    taxPaymentChoice,
    wardPaymentChoice,
    damageAssignmentChoice,
    triggerOrderChoice,
    gameLog,
    chatMessages,
    authorityUpdates,
    engineEventLog,
    engineEventLogSeeds,
    engineEventLogInitialState,
    lastStateUpdate,
    currentPrompt,
    actionError,
    lastPlayedCard,
    startGame,
    exportGameSave,
    restoreGameSave,
    submitAction,
    keepHand,
    mulligan,
    toggleMulliganCard,
    toggleMulliganBottomCard,
    discardCard,
    resolveTutor,
    cancelTutor,
    cancelTargeting,
    resolveLibraryChoice,
    resolveOptionalTriggerChoice,
    resolveTaxPaymentChoice,
    resolveWardPaymentChoice,
    resolveDamageAssignmentChoice,
    resolveTriggerOrderChoice,
    undosRemaining,
    undoAction,
    coachMode,
    setCoachMode,
    newPlayerMode,
    setNewPlayerMode,
    holdPriority,
    setHoldPriority,
    priorityStops,
    setPriorityStop,
    setAllPriorityStops,
    untapManaSource,
    adjustCounters,
    adjustPlayerCounter,
    adjustCommanderDamage,
    moveCardManually,
    adjustDamage,
    createManualToken,
    attachCardManually,
    setPhaseStepManually,
    clearActionError,
    untappableCardIds,
    endGame,
    closeEndGame,
    newGame,
    declareDraw,
    concedeGame,
    playItOut,
    reviewLog,
  } = useShelectorGame();

  // Feature flag: opt into the rebuilt play UI (PlayExperience) with ?newui=1.
  // Defaults off — the existing <GameBoard> stays the default board.
  const useNewPlayUi = useMemo(
    () =>
      typeof window !== 'undefined' &&
      (new URLSearchParams(window.location.search).get('newui') === '1' ||
        new URLSearchParams(window.location.search).get('ui') === 'v2'),
    [],
  );

  // Pre-game state
  const [step, setStep] = useState<'import' | 'opponent' | 'draft' | 'standard' | 'game'>('import');
  const [importTab, setImportTab] = useState<'url' | 'text'>('url');
  const [deckUrl, setDeckUrl] = useState('');
  const [deckText, setDeckText] = useState('');
  const [importResult, setImportResult] = useState<DeckImportResult | null>(null);
  const [fillMissingCards, setFillMissingCards] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [standardDeckText, setStandardDeckText] = useState('');
  const [starterDeckLoadingId, setStarterDeckLoadingId] = useState<string | null>(null);
  const [showGuidedPrompt, setShowGuidedPrompt] = useState(false);
  const [starterDeckSpotlight, setStarterDeckSpotlight] = useState(false);
  const [selectedPracticePresetId, setSelectedPracticePresetId] = useState<string | null>(null);
  const starterDecksRef = useRef<HTMLDivElement | null>(null);

  // Opponent config
  const [opponentCount, setOpponentCount] = useState<OpponentCount>(1);
  const [spawnMode, setSpawnMode] = useState<'random' | 'counter' | 'pool'>('random');
  const [spawnBracket, setSpawnBracket] = useState(3);
  const [colorFilter, setColorFilter] = useState<Record<string, boolean>>({
    W: false, U: false, B: false, R: false, G: false,
  });
  const [personality, setPersonality] = useState<string>('Balanced');
  // Starting life for the practice match. 40 = standard Commander; lower values
  // make for faster, punchier games.
  const [startingLife, setStartingLife] = useState<number>(40);
  const [spawnedOpponents, setSpawnedOpponents] = useState<SpawnedOpponent[]>([]);
  const [spawnProgress, setSpawnProgress] = useState('');
  const [isSpawning, setIsSpawning] = useState(false);
  const [isGeneratingAIDeck, setIsGeneratingAIDeck] = useState(false);

  // Deck history
  const [deckHistory, setDeckHistory] = useState<DeckHistoryEntry[]>([]);
  const [showDeckHistory, setShowDeckHistory] = useState(false);

  // Review modal
  const [showReview, setShowReview] = useState(false);
  const [saveSlots, setSaveSlots] = useState<(PlaySaveSlotRecord | null)[]>(() => Array.from({ length: SAVE_SLOT_COUNT }, () => null));
  const saveSlotsRef = useRef(saveSlots);
  const [saveSlotsReady, setSaveSlotsReady] = useState(false);
  const [activeSaveSlot, setActiveSaveSlot] = useState(1);
  const [savePanelOpen, setSavePanelOpen] = useState(false);
  const [showAllSaveSlots, setShowAllSaveSlots] = useState(false);
  const [showPracticeTools, setShowPracticeTools] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activeDrillRun, setActiveDrillRun] = useState<{
    slot: number;
    bookmarkId: string;
    label: string;
    startedAt: number;
  } | null>(null);
  const qaScenarioLoadedRef = useRef(false);
  const playDeepLoadHandledRef = useRef(false);
  const practiceHistory = useMemo(() => {
    const records = saveSlots.filter((record): record is PlaySaveSlotRecord => Boolean(record));
    const attempts = records.flatMap(record => (
      record.drillBookmarks || []
    ).flatMap(bookmark => (
      bookmark.attempts || []
    ).map(attempt => {
      const scored = scorePracticeAttemptSummary(attempt.summary || '');
      return { record, bookmark, attempt, score: scored.score, scoreLabel: scored.label };
    })));
    const focusCounts = new Map<string, number>();
    const archetypeCounts = new Map<string, number>();
    for (const record of records) {
      if (record.practice?.archetype) {
        archetypeCounts.set(record.practice.archetype, (archetypeCounts.get(record.practice.archetype) || 0) + 1);
      }
      for (const tag of record.practice?.focusTags || []) {
        focusCounts.set(tag, (focusCounts.get(tag) || 0) + 1);
      }
    }
    return {
      records,
      attempts,
      bookmarkCount: records.reduce((sum, record) => sum + (record.drillBookmarks?.length || 0), 0),
      topFocusTags: [...focusCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
      archetypes: [...archetypeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4),
      recentAttempts: [...attempts].sort((a, b) => b.attempt.savedAt - a.attempt.savedAt).slice(0, 3),
      bestAttempts: [...attempts].sort((a, b) => (b.score - a.score) || (b.attempt.savedAt - a.attempt.savedAt)).slice(0, 3),
    };
  }, [saveSlots]);

  const importEngineReadiness = useMemo<ImportedDeckEngineReadiness | null>(() => {
    if (!importResult) return null;
    const unsupportedCards = findUnsupportedEngineCards([{
      label: 'Imported deck',
      commander: importResult.commander || undefined,
      cards: importResult.cards,
      lands: importResult.lands,
      sideboard: importResult.sideboard || [],
    }]);
    return {
      partnerCommanders: getPartnerCommanderNames(importResult),
      duplicateRepairApplied: importResult.warnings.some(warning => /duplicate non-basic/i.test(warning)),
      unsupportedCards,
      filledCards: importResult.filled_cards || [],
    };
  }, [importResult]);
  const missingImportedDeckSlots = missingCommanderDeckSlots(importResult);
  const importedDeckReadyForPractice = Boolean(importResult?.valid && missingImportedDeckSlots === 0);

  // Load saved deck data
  useEffect(() => {
    const savedText = cacheGet<string>('last_deck_text');
    if (savedText) setDeckText(savedText);
    const savedResult = cacheGet<DeckImportResult>('last_deck_result');
    if (savedResult) setImportResult(savedResult);
    const savedHistory = cacheGet<DeckHistoryEntry[]>('deck_history');
    if (savedHistory) setDeckHistory(savedHistory);
  }, []);

  // Show review when game ends
  useEffect(() => {
    if (isGameOver) setShowReview(true);
  }, [isGameOver]);

  useEffect(() => {
    document.body.dataset.deckrepsPlaySurface = step === 'game' ? 'active' : 'setup';
    window.dispatchEvent(new CustomEvent('deckreps-play-surface-change'));
    return () => {
      delete document.body.dataset.deckrepsPlaySurface;
      window.dispatchEvent(new CustomEvent('deckreps-play-surface-change'));
    };
  }, [step]);

  const refreshSaveSlots = async () => {
    const slots = await getPlaySaveSlots();
    saveSlotsRef.current = slots;
    setSaveSlots(slots);
    setSaveSlotsReady(true);
  };

  const applySaveSlotRecord = (record: PlaySaveSlotRecord | null, slot: number) => {
    const next = [...saveSlotsRef.current];
    next[slot - 1] = record;
    saveSlotsRef.current = next;
    setSaveSlots(next);
  };

  useEffect(() => {
    refreshSaveSlots().catch(() => {
      setSaveSlotsReady(true);
      setSaveError('Could not load browser save slots.');
    });
  }, []);

  useEffect(() => {
    const qaScenariosEnabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_QA_SCENARIOS === 'true';
    if (!qaScenariosEnabled || qaScenarioLoadedRef.current || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const qaScenario = params.get('qa');
    if (
      qaScenario !== 'sisay-activation'
      && qaScenario !== 'sisay-raw-lands'
      && qaScenario !== 'declare-blockers'
      && qaScenario !== 'land-entry-fetch'
      && qaScenario !== 'library-manipulation'
      && qaScenario !== 'see-beyond'
      && qaScenario !== 'mulligan-selection'
      && qaScenario !== 'cost-reduction'
      && qaScenario !== 'brain-gorgers-sacrifice'
      && qaScenario !== 'equipment-d20'
      && qaScenario !== 'equipment-equip'
      && qaScenario !== 'token-stack'
      && qaScenario !== 'creature-mana-sickness'
      && qaScenario !== 'storm-grapeshot'
      && qaScenario !== 'spell-copy'
      && qaScenario !== 'magecraft-triggers'
      && qaScenario !== 'complex-combat'
      && qaScenario !== 'modal-choice'
      && qaScenario !== 'generous-gift'
      && qaScenario !== 'restricted-mana-cast'
      && qaScenario !== 'krenko-skirk'
    ) return;

    let cancelled = false;
    import('../lib/qaGameScenarios')
      .then(({
        createDeclareBlockersQaState,
        createBrainGorgersSacrificeQaState,
        createComplexCombatQaState,
        createCostReductionQaState,
        createCreatureManaSicknessQaState,
        createEquipmentD20QaState,
        createEquipmentEquipQaState,
        createGenerousGiftQaState,
        createKrenkoSkirkQaState,
        createLandEntryFetchQaState,
        createLibraryManipulationQaState,
        createMagecraftTriggersQaState,
        createMulliganSelectionQaState,
        createModalChoiceQaState,
        createSeeBeyondQaState,
        createRestrictedManaCastQaState,
        createSisayActivationQaState,
        createSisayRawLandsQaState,
        createSpellCopyQaState,
        createStormGrapeshotQaState,
        createTokenStackQaState,
      }) => {
        if (cancelled || qaScenarioLoadedRef.current) return;
        const engine = qaScenario === 'sisay-raw-lands'
          ? createSisayRawLandsQaState()
          : qaScenario === 'declare-blockers'
          ? createDeclareBlockersQaState()
          : qaScenario === 'land-entry-fetch'
          ? createLandEntryFetchQaState()
          : qaScenario === 'library-manipulation'
          ? createLibraryManipulationQaState()
          : qaScenario === 'see-beyond'
          ? createSeeBeyondQaState()
          : qaScenario === 'mulligan-selection'
          ? createMulliganSelectionQaState()
          : qaScenario === 'cost-reduction'
          ? createCostReductionQaState()
          : qaScenario === 'brain-gorgers-sacrifice'
          ? createBrainGorgersSacrificeQaState()
          : qaScenario === 'equipment-d20'
          ? createEquipmentD20QaState()
          : qaScenario === 'equipment-equip'
          ? createEquipmentEquipQaState()
          : qaScenario === 'token-stack'
          ? createTokenStackQaState()
          : qaScenario === 'creature-mana-sickness'
          ? createCreatureManaSicknessQaState()
          : qaScenario === 'storm-grapeshot'
          ? createStormGrapeshotQaState()
          : qaScenario === 'spell-copy'
          ? createSpellCopyQaState()
          : qaScenario === 'magecraft-triggers'
          ? createMagecraftTriggersQaState()
          : qaScenario === 'complex-combat'
          ? createComplexCombatQaState()
          : qaScenario === 'modal-choice'
          ? createModalChoiceQaState()
          : qaScenario === 'generous-gift'
          ? createGenerousGiftQaState()
          : qaScenario === 'restricted-mana-cast'
          ? createRestrictedManaCastQaState()
          : qaScenario === 'krenko-skirk'
          ? createKrenkoSkirkQaState()
          : createSisayActivationQaState();
        const now = Date.now();
        const snapshot: ShelectorGameSaveSnapshot = {
          version: 1,
          savedAt: now,
          engine,
          humanDeck: null,
          aiDecks: [],
          humanCommander: qaScenario === 'modal-choice'
            ? 'Krenko, Mob Boss'
            : qaScenario === 'krenko-skirk'
            ? 'Krenko, Mob Boss'
            : qaScenario === 'library-manipulation'
            ? 'Talrand, Sky Summoner'
            : qaScenario === 'see-beyond'
            ? 'Talrand, Sky Summoner'
            : qaScenario === 'mulligan-selection'
            ? 'Talrand, Sky Summoner'
            : qaScenario === 'cost-reduction'
            ? 'Stormcatch Mentor'
            : qaScenario === 'brain-gorgers-sacrifice'
            ? 'Doomed Bear'
            : qaScenario === 'equipment-d20'
              || qaScenario === 'equipment-equip'
            ? 'Goblin Morningstar'
            : qaScenario === 'token-stack'
            ? 'Goblin'
            : qaScenario === 'creature-mana-sickness'
            ? 'Elvish Mystic'
            : qaScenario === 'storm-grapeshot' || qaScenario === 'spell-copy'
            ? 'Vivi Ornitier'
            : qaScenario === 'magecraft-triggers'
            ? 'Vivi Ornitier'
            : qaScenario === 'complex-combat'
            ? 'Trampling Commander'
            : qaScenario === 'generous-gift'
            ? 'Training Cleric'
            : qaScenario === 'restricted-mana-cast'
            ? 'Bird Trainer'
            : 'Sisay, Weatherlight Captain',
          aiCommanderNames: qaScenario === 'complex-combat'
            ? {
                'ai-1': 'Left Defender',
                'ai-2': 'Middle Defender',
                'ai-3': 'Right Defender',
              }
            : {
                'ai-1': qaScenario === 'declare-blockers'
                  ? 'Marchesa, Dealer of Death'
                  : qaScenario === 'library-manipulation'
                  ? 'Library QA Opponent'
                  : qaScenario === 'see-beyond'
                  ? 'See Beyond QA Opponent'
                  : qaScenario === 'brain-gorgers-sacrifice'
                  ? 'Brain Gorgers QA Opponent'
                  : qaScenario === 'equipment-d20'
                    || qaScenario === 'equipment-equip'
                  ? 'Equipment QA Opponent'
                  : qaScenario === 'token-stack'
                  ? 'Token QA Opponent'
                  : qaScenario === 'creature-mana-sickness'
                  ? 'Creature Mana QA Opponent'
                  : qaScenario === 'storm-grapeshot'
                  ? 'Storm QA Opponent'
                  : qaScenario === 'spell-copy'
                  ? 'Spell Copy QA Opponent'
                  : qaScenario === 'magecraft-triggers'
                  ? 'Magecraft QA Opponent'
                  : qaScenario === 'modal-choice'
                  ? 'Modal QA Opponent'
                  : qaScenario === 'generous-gift'
                  ? 'Removal QA Opponent'
                  : qaScenario === 'restricted-mana-cast'
                  ? 'Restricted Mana QA Opponent'
                  : qaScenario === 'krenko-skirk'
                  ? 'Krenko QA Opponent'
                  : 'QA Opponent',
              },
          humanId: 'human',
          aiIds: qaScenario === 'complex-combat' ? ['ai-1', 'ai-2', 'ai-3'] : ['ai-1'],
          opponentInfo: null,
          chatMessages: [],
          gameLog: [],
          authorityUpdates: [],
          engineEventLog: [],
          engineEventLogSeeds: {},
          engineEventLogInitialState: engine,
          lastStateUpdate: null,
          currentPrompt: null,
          lastPlayedCard: null,
          mulliganPhase: qaScenario === 'mulligan-selection',
          mulliganCount: 0,
          selectedMulliganCardIds: [],
          selectedMulliganBottomIds: [],
          discardPhase: false,
          discardCount: 0,
          tutorPhase: false,
          tutorCards: [],
          tutorTitle: '',
          libraryChoice: null,
          optionalTriggerChoice: null,
          taxPaymentChoice: null,
          wardPaymentChoice: null,
          damageAssignmentChoice: null,
          triggerOrderChoice: null,
          undosRemaining: 10,
          coachMode: false,
          newPlayerMode: false,
          holdPriority: false,
          priorityStops,
          actionError: null,
          lastEvents: [],
          endGame: { open: false, kind: 'loss' },
        };
        if (restoreGameSave(snapshot)) {
          qaScenarioLoadedRef.current = true;
          setImportResult(null);
          setSelectedPracticePresetId(null);
          setStep('game');
          setSavePanelOpen(false);
          setSaveStatus(`Loaded ${
            qaScenario === 'sisay-raw-lands'
              ? 'Sisay raw lands'
              : qaScenario === 'declare-blockers'
              ? 'declare blockers'
              : qaScenario === 'land-entry-fetch'
              ? 'land entry/fetch'
              : qaScenario === 'library-manipulation'
              ? 'library manipulation'
              : qaScenario === 'see-beyond'
              ? 'See Beyond'
              : qaScenario === 'mulligan-selection'
              ? 'mulligan selection'
              : qaScenario === 'cost-reduction'
              ? 'cost reduction'
              : qaScenario === 'brain-gorgers-sacrifice'
              ? 'Brain Gorgers sacrifice'
              : qaScenario === 'equipment-d20'
                || qaScenario === 'equipment-equip'
              ? 'equipment and d20'
              : qaScenario === 'token-stack'
              ? 'token stack'
              : qaScenario === 'creature-mana-sickness'
              ? 'creature mana sickness'
              : qaScenario === 'storm-grapeshot'
              ? 'storm Grapeshot'
              : qaScenario === 'spell-copy'
              ? 'spell copy'
              : qaScenario === 'magecraft-triggers'
              ? 'magecraft triggers'
              : qaScenario === 'complex-combat'
              ? 'complex combat'
              : qaScenario === 'modal-choice'
              ? 'modal choice'
              : qaScenario === 'generous-gift'
              ? 'Generous Gift'
              : qaScenario === 'restricted-mana-cast'
              ? 'restricted mana'
              : qaScenario === 'krenko-skirk'
              ? 'Krenko/Skirk'
              : 'Sisay activation'
          } QA scenario.`);
          setSaveError(null);
        }
      })
      .catch(error => {
        setSaveError(error instanceof Error ? error.message : 'Could not load QA scenario.');
      });

    return () => {
      cancelled = true;
    };
  }, [priorityStops, restoreGameSave]);

  const resolvePracticeMetadata = () => {
    const preset = PRESET_DECKS.find(deck => deck.id === selectedPracticePresetId);
    if (preset) {
      return {
        presetId: preset.id,
        archetype: preset.name,
        commander: preset.commander,
        focusTags: preset.focusTags || [],
        keyCards: preset.keyCards || [],
        coachingNotes: preset.coachingNotes || [],
      };
    }

    const commanderName = gameState?.humanCommander || importResult?.commander || '';
    if (/xenagos,\s*god of revels/i.test(commanderName)) {
      return {
        archetype: 'Xenagos Dragon Lines',
        commander: 'Xenagos, God of Revels',
        focusTags: [...XENAGOS_PRACTICE_FOCUS_TAGS],
        keyCards: [...XENAGOS_PRACTICE_KEY_CARDS],
        coachingNotes: [...XENAGOS_PRACTICE_COACHING_NOTES],
      };
    }

    return undefined;
  };

  const buildSaveRecord = (
    slot: number,
    snapshot: ShelectorGameSaveSnapshot,
    autosaved: boolean,
    drillBookmarks?: PlayDrillBookmark[],
  ): PlaySaveSlotRecord => {
    const savedAt = Date.now();
    const commander = gameState?.humanCommander || importResult?.commander || snapshot.humanCommander || 'Practice Game';
    const practice = resolvePracticeMetadata();
    const existing = saveSlotsRef.current[slot - 1];
    const existingPracticeId = existing?.practice?.presetId || null;
    const nextPracticeId = practice?.presetId || null;
    const shouldCarryExistingDrills = Boolean(
      existing
      && existing.commander === commander
      && existingPracticeId === nextPracticeId
    );
    const effectiveDrillBookmarks = drillBookmarks
      ?? (shouldCarryExistingDrills ? existing?.drillBookmarks || [] : []);
    const canonicalEngineSave = snapshot.engine
      ? buildCanonicalPlayEngineSave({
          slot,
          name: `Slot ${slot} - ${commander}`,
          humanPlayerId: snapshot.humanId || 'human',
          serializedState: snapshot.engine,
          createdAt: savedAt,
        })
      : undefined;

    return {
      schema: 'deckreps-play-slot-v2',
      slot,
      name: `Slot ${slot}`,
      commander,
      turnNumber: gameState?.turnNumber || 1,
      phase: gameState?.phase || 'setup',
      savedAt,
      autosaved,
      practice,
      audit: {
        schema: 'engine-event-log-v1',
        engineEventCount: engineEventLog.length,
        hasInitialState: Boolean(engineEventLogInitialState),
        seedCount: Object.keys(engineEventLogSeeds || {}).length,
        updatedAt: savedAt,
      },
      drillBookmarks: effectiveDrillBookmarks,
      canonicalEngineSave,
      snapshot,
      ui: {
        step,
        importTab,
        deckUrl,
        deckText,
        importResult,
        standardDeckText,
        opponentCount,
        spawnMode,
        spawnBracket,
        colorFilter,
        personality,
        spawnedOpponents,
        selectedPracticePresetId,
      },
    };
  };

  const restoreSlotUi = (record: PlaySaveSlotRecord) => {
    setActiveSaveSlot(record.slot);
    setImportTab(record.ui.importTab);
    setDeckUrl(record.ui.deckUrl);
    setDeckText(record.ui.deckText);
    setImportResult(record.ui.importResult as DeckImportResult | null);
    setStandardDeckText(record.ui.standardDeckText);
    setOpponentCount(record.ui.opponentCount);
    setSpawnMode(record.ui.spawnMode);
    setSpawnBracket(record.ui.spawnBracket);
    setColorFilter(record.ui.colorFilter);
    setPersonality(record.ui.personality);
    setSpawnedOpponents(record.ui.spawnedOpponents as SpawnedOpponent[]);
    setSelectedPracticePresetId(record.ui.selectedPracticePresetId || record.practice?.presetId || null);
    setStep('game');
    setShowReview(false);
    setSavePanelOpen(false);
  };

  const saveCurrentGame = async (slot = activeSaveSlot, autosaved = false) => {
    const snapshot = exportGameSave();
    if (!snapshot) {
      setSaveError('No active game to save yet.');
      return false;
    }
    try {
      const record = buildSaveRecord(slot, snapshot, autosaved);
      await putPlaySaveSlot(record);
      applySaveSlotRecord(record, slot);
      await refreshSaveSlots();
      setSaveError(null);
      setSaveStatus(`${autosaved ? 'Autosaved' : 'Saved'} slot ${slot} at ${new Date(record.savedAt).toLocaleTimeString()}`);
      return true;
    } catch (err: any) {
      setSaveError(err.message || 'Could not save this game.');
      return false;
    }
  };

  const loadSaveSlot = async (record: PlaySaveSlotRecord) => {
    setSaveError(null);
    const snapshot = record.snapshot as ShelectorGameSaveSnapshot;
    const canonicalAudit = record.canonicalEngineSave ? auditCanonicalPlayEngineSave(record.canonicalEngineSave) : null;
    if (canonicalAudit && !canonicalAudit.ok) {
      setSaveError(`Slot ${record.slot} engine save is not authoritative: ${canonicalAudit.message}`);
      return;
    }
    const managerEngine = await loadCanonicalPlaySlotState(record.slot);
    const canonicalEngine = managerEngine || (record.canonicalEngineSave ? restoreCanonicalPlayEngineState(record.canonicalEngineSave) : null);
    const snapshotToRestore: ShelectorGameSaveSnapshot = canonicalEngine
      ? { ...snapshot, engine: canonicalEngine }
      : snapshot;
    if (!snapshotToRestore.engine) {
      setSaveError(`Slot ${record.slot} is missing its authoritative engine save.`);
      return;
    }

    const audit = auditPlaySaveSnapshot(snapshotToRestore);
    if (!managerEngine && !record.canonicalManager && !canonicalAudit && audit.status === 'failed') {
      setSaveError(`Slot ${record.slot} replay audit failed. Open Admin Console for event-level diagnostics or overwrite this slot.`);
      return;
    }

    const restored = restoreGameSave(snapshotToRestore);
    if (!restored) {
      setSaveError('That save could not be restored.');
      return;
    }
    restoreSlotUi(record);
    setActiveDrillRun(null);
    setSaveStatus(`Loaded slot ${record.slot}${managerEngine ? ' from canonical engine save' : ''}.`);
  };

  const latestCheckpointSequence = (record: PlaySaveSlotRecord): number | null => {
    const snapshot = record.snapshot as Partial<ShelectorGameSaveSnapshot>;
    const seeds = snapshot.engineEventLogSeeds || {};
    const sequences = Object.keys(seeds)
      .map(key => Number(key))
      .filter(sequence => Number.isFinite(sequence));
    return sequences.length > 0 ? Math.max(...sequences) : null;
  };

  const loadLatestCheckpoint = async (record: PlaySaveSlotRecord) => {
    setSaveError(null);
    const snapshot = record.snapshot as ShelectorGameSaveSnapshot;
    const sequence = latestCheckpointSequence(record);
    const seed = sequence === null ? null : snapshot.engineEventLogSeeds?.[sequence];
    if (sequence === null || !seed) {
      setSaveError('That save does not have a drill checkpoint yet.');
      return;
    }

    const checkpointRecord = snapshot.engineEventLog?.find(entry => entry.sequence === sequence);
    const cutoff = checkpointRecord?.timestamp;
    const checkpointSnapshot: ShelectorGameSaveSnapshot = {
      ...snapshot,
      savedAt: Date.now(),
      engine: seed,
      gameLog: typeof cutoff === 'number'
        ? snapshot.gameLog.filter(entry => entry.timestamp < cutoff)
        : snapshot.gameLog,
      authorityUpdates: [],
      engineEventLog: [],
      engineEventLogSeeds: {},
      engineEventLogInitialState: seed,
      lastStateUpdate: null,
      currentPrompt: null,
      lastPlayedCard: null,
      tutorPhase: false,
      tutorCards: [],
      tutorTitle: '',
      tutorPromptRequest: null,
      tutorRemaining: 0,
      tutorFilter: undefined,
      tutorFilterSpec: undefined,
      tutorTapped: false,
      tutorShuffle: true,
      tutorDestination: 'hand',
      tutorSourceName: 'Checkpoint',
      tutorSourceInstanceId: undefined,
      pendingSearchEntryChoice: null,
      pendingTargetChoice: null,
      libraryChoice: null,
      libraryManipulationPromptRequest: null,
      optionalTriggerChoice: null,
      taxPaymentChoice: null,
      wardPaymentChoice: null,
      damageAssignmentChoice: null,
      triggerOrderChoice: null,
      discardPhase: false,
      discardCount: 0,
      selectedMulliganCardIds: [],
      selectedMulliganBottomIds: [],
      actionError: null,
      lastEvents: [],
    };

    const restored = restoreGameSave(checkpointSnapshot);
    if (!restored) {
      setSaveError(`Checkpoint ${sequence} could not be restored.`);
      return;
    }

    restoreSlotUi(record);
    setActiveDrillRun(null);
    setSaveStatus(`Loaded slot ${record.slot} at drill checkpoint ${sequence}.`);
  };

  const currentDrillDecisionContext = (snapshot?: ShelectorGameSaveSnapshot | null): PlayDrillDecisionContext => ({
    currentPrompt: snapshot?.currentPrompt ?? currentPrompt,
    mulliganPhase: snapshot?.mulliganPhase ?? mulliganPhase,
    mulliganCount: snapshot?.mulliganCount ?? mulliganCount,
    mulliganBottomSelectionActive: snapshot?.mulliganBottomSelectionActive ?? false,
    tutorPhase: snapshot?.tutorPhase ?? tutorPhase,
    tutorCards: snapshot?.tutorCards ?? tutorCards,
    tutorTitle: snapshot?.tutorTitle ?? tutorTitle,
    tutorPromptRequest: snapshot?.tutorPromptRequest ?? null,
    tutorRemaining: snapshot?.tutorRemaining ?? 0,
    tutorFilter: snapshot?.tutorFilter,
    tutorFilterSpec: snapshot?.tutorFilterSpec,
    tutorTapped: snapshot?.tutorTapped ?? false,
    tutorShuffle: snapshot?.tutorShuffle ?? true,
    tutorDestination: snapshot?.tutorDestination ?? 'hand',
    tutorSourceName: snapshot?.tutorSourceName || snapshot?.currentPrompt?.title || currentPrompt?.title || 'Practice Drill',
    tutorSourceInstanceId: snapshot?.tutorSourceInstanceId,
    pendingSearchEntryChoice: snapshot?.pendingSearchEntryChoice ?? null,
    pendingTargetChoice: snapshot?.pendingTargetChoice ?? null,
    libraryChoice: snapshot?.libraryChoice ?? libraryChoice,
    libraryManipulationPromptRequest: snapshot?.libraryManipulationPromptRequest ?? null,
    optionalTriggerChoice: snapshot?.optionalTriggerChoice ?? optionalTriggerChoice,
    taxPaymentChoice: snapshot?.taxPaymentChoice ?? taxPaymentChoice,
    wardPaymentChoice: snapshot?.wardPaymentChoice ?? wardPaymentChoice,
    damageAssignmentChoice: snapshot?.damageAssignmentChoice ?? damageAssignmentChoice,
    triggerOrderChoice: snapshot?.triggerOrderChoice ?? triggerOrderChoice,
    discardPhase: snapshot?.discardPhase ?? discardPhase,
    discardCount: snapshot?.discardCount ?? discardCount,
    selectedMulliganCardIds: snapshot?.selectedMulliganCardIds ?? selectedMulliganCardIds,
    selectedMulliganBottomIds: snapshot?.selectedMulliganBottomIds ?? selectedMulliganBottomIds,
  });

  const buildDrillRestoreSnapshot = (
    snapshot: ShelectorGameSaveSnapshot,
    engine: ShelectorGameSaveSnapshot['engine'],
    sourceName: string,
    decisionContext?: PlayDrillDecisionContext,
  ): ShelectorGameSaveSnapshot => ({
    ...snapshot,
    savedAt: Date.now(),
    engine,
    authorityUpdates: [],
    engineEventLog: [],
    engineEventLogSeeds: {},
    engineEventLogInitialState: engine,
    lastStateUpdate: null,
    currentPrompt: (decisionContext?.currentPrompt ?? null) as ShelectorGameSaveSnapshot['currentPrompt'],
    lastPlayedCard: null,
    mulliganPhase: decisionContext?.mulliganPhase ?? false,
    mulliganCount: decisionContext?.mulliganCount ?? 0,
    mulliganBottomSelectionActive: decisionContext?.mulliganBottomSelectionActive ?? false,
    tutorPhase: Boolean(decisionContext?.tutorPhase),
    tutorCards: (decisionContext?.tutorCards || []) as ShelectorGameSaveSnapshot['tutorCards'],
    tutorTitle: decisionContext?.tutorTitle || '',
    tutorPromptRequest: (decisionContext?.tutorPromptRequest ?? null) as ShelectorGameSaveSnapshot['tutorPromptRequest'],
    tutorRemaining: decisionContext?.tutorRemaining ?? 0,
    tutorFilter: decisionContext?.tutorFilter,
    tutorFilterSpec: decisionContext?.tutorFilterSpec as ShelectorGameSaveSnapshot['tutorFilterSpec'],
    tutorTapped: decisionContext?.tutorTapped ?? false,
    tutorShuffle: decisionContext?.tutorShuffle ?? true,
    tutorDestination: (decisionContext?.tutorDestination || 'hand') as ShelectorGameSaveSnapshot['tutorDestination'],
    tutorSourceName: decisionContext?.tutorSourceName || sourceName,
    tutorSourceInstanceId: decisionContext?.tutorSourceInstanceId,
    pendingSearchEntryChoice: (decisionContext?.pendingSearchEntryChoice ?? null) as ShelectorGameSaveSnapshot['pendingSearchEntryChoice'],
    pendingTargetChoice: (decisionContext?.pendingTargetChoice ?? null) as ShelectorGameSaveSnapshot['pendingTargetChoice'],
    libraryChoice: (decisionContext?.libraryChoice ?? null) as ShelectorGameSaveSnapshot['libraryChoice'],
    libraryManipulationPromptRequest: (decisionContext?.libraryManipulationPromptRequest ?? null) as ShelectorGameSaveSnapshot['libraryManipulationPromptRequest'],
    optionalTriggerChoice: (decisionContext?.optionalTriggerChoice ?? null) as ShelectorGameSaveSnapshot['optionalTriggerChoice'],
    taxPaymentChoice: (decisionContext?.taxPaymentChoice ?? null) as ShelectorGameSaveSnapshot['taxPaymentChoice'],
    wardPaymentChoice: (decisionContext?.wardPaymentChoice ?? null) as ShelectorGameSaveSnapshot['wardPaymentChoice'],
    damageAssignmentChoice: (decisionContext?.damageAssignmentChoice ?? null) as ShelectorGameSaveSnapshot['damageAssignmentChoice'],
    triggerOrderChoice: (decisionContext?.triggerOrderChoice ?? null) as ShelectorGameSaveSnapshot['triggerOrderChoice'],
    discardPhase: decisionContext?.discardPhase ?? false,
    discardCount: decisionContext?.discardCount ?? 0,
    selectedMulliganCardIds: decisionContext?.selectedMulliganCardIds || [],
    selectedMulliganBottomIds: decisionContext?.selectedMulliganBottomIds || [],
    actionError: null,
    lastEvents: [],
  });

  const loadDrillBookmark = async (record: PlaySaveSlotRecord, bookmark: PlayDrillBookmark) => {
    setSaveError(null);
    const snapshot = record.snapshot as ShelectorGameSaveSnapshot;
    const engine = bookmark.engine || await loadCanonicalPlayStateRef(bookmark.canonicalState);
    if (!engine) {
      setSaveError(`Drill bookmark "${bookmark.label}" is missing its authoritative engine state.`);
      return;
    }
    const drillSnapshot = buildDrillRestoreSnapshot(snapshot, engine, 'Drill Bookmark', bookmark.decisionContext);

    const restored = restoreGameSave(drillSnapshot);
    if (!restored) {
      setSaveError(`Drill bookmark "${bookmark.label}" could not be restored.`);
      return;
    }

    restoreSlotUi(record);
    setActiveDrillRun({
      slot: record.slot,
      bookmarkId: bookmark.id,
      label: bookmark.label,
      startedAt: Date.now(),
    });
    setSaveStatus(`Loaded drill bookmark "${bookmark.label}".`);
  };

  const loadDrillAttempt = async (record: PlaySaveSlotRecord, bookmark: PlayDrillBookmark, attempt: PlayDrillAttempt) => {
    setSaveError(null);
    const snapshot = record.snapshot as ShelectorGameSaveSnapshot;
    const engine = attempt.engine || await loadCanonicalPlayStateRef(attempt.canonicalState);
    if (!engine) {
      setSaveError(`Drill attempt "${attempt.label}" is missing its authoritative engine state.`);
      return;
    }
    const drillSnapshot = buildDrillRestoreSnapshot(snapshot, engine, 'Drill Attempt', attempt.decisionContext);

    const restored = restoreGameSave(drillSnapshot);
    if (!restored) {
      setSaveError(`Drill attempt "${attempt.label}" could not be restored.`);
      return;
    }

    restoreSlotUi(record);
    setActiveDrillRun({
      slot: record.slot,
      bookmarkId: bookmark.id,
      label: `${bookmark.label} / ${attempt.label}`,
      startedAt: Date.now(),
    });
    setSaveStatus(`Loaded drill attempt "${attempt.label}".`);
  };

  const summarizeDrillAttempt = (): string => {
    if (!gameState) return 'No visible board summary.';
    const opponents = gameState.aiPlayers
      .map(player => `${player.name} ${player.life}`)
      .join(', ');
    return [
      `You ${gameState.humanPlayer.life}`,
      opponents ? `Opponents ${opponents}` : null,
      `hand ${gameState.humanHand.length}`,
      `board ${gameState.humanBattlefield.length}`,
      `graveyard ${gameState.humanGraveyard.length}`,
      `stack ${gameState.stack.length}`,
    ].filter(Boolean).join(' / ');
  };

  const summarizePracticeDecisionContext = (): string => {
    if (!gameState) return 'No practice context.';
    const parts = [
      currentPrompt ? `Prompt: ${currentPrompt.title || currentPrompt.type}` : null,
      currentPrompt?.guidance ? `Guidance: ${currentPrompt.guidance}` : null,
      lastPlayedCard ? `Last: ${lastPlayedCard.card.name}` : null,
      gameState.stack.length > 0 ? `Stack: ${gameState.stack.map(item => item.name).slice(-3).join(', ')}` : null,
      branchPreviews.length > 0 ? `Branches: ${branchPreviews.slice(0, 3).map(preview => preview.label).join(' | ')}` : null,
      legalActions.length > 0 ? `Available actions: ${legalActions.length}` : null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' / ') : 'Manual drill bookmark';
  };

  const scoreDrillAttempt = (attempt: PlayDrillAttempt): { score: number; label: string } => {
    return scorePracticeAttemptSummary(attempt.summary || '');
  };

  const rankedDrillAttempts = (attempts: PlayDrillAttempt[] = []): Array<PlayDrillAttempt & { comparisonScore: number; comparisonLabel: string; rank: number }> => (
    attempts
      .map(attempt => {
        const comparison = scoreDrillAttempt(attempt);
        return {
          ...attempt,
          comparisonScore: comparison.score,
          comparisonLabel: comparison.label,
        };
      })
      .sort((a, b) => (b.comparisonScore - a.comparisonScore) || (b.savedAt - a.savedAt))
      .map((attempt, index) => ({ ...attempt, rank: index + 1 }))
  );

  const saveCurrentDrillAttempt = async () => {
    if (!activeDrillRun) {
      setSaveError('Load a drill bookmark before saving an attempt.');
      return false;
    }
    const snapshot = exportGameSave();
    if (!snapshot?.engine || !gameState) {
      setSaveError('No active drill state to save.');
      return false;
    }
    const record = saveSlotsRef.current[activeDrillRun.slot - 1];
    if (!record?.drillBookmarks?.length) {
      setSaveError('The source drill bookmark is missing from this slot.');
      return false;
    }

    const savedAt = Date.now();
    const attempt: PlayDrillAttempt = {
      id: `${savedAt}-${Math.random().toString(36).slice(2, 8)}`,
      label: `Attempt ${new Date(savedAt).toLocaleTimeString()}`,
      startedAt: activeDrillRun.startedAt,
      savedAt,
      turnNumber: gameState.turnNumber,
      phase: gameState.phase,
      step: gameState.step,
      summary: `${summarizeDrillAttempt()} / ${summarizePracticeDecisionContext()}`,
      engine: snapshot.engine,
      decisionContext: currentDrillDecisionContext(snapshot),
    };

    const drillBookmarks = record.drillBookmarks.map(bookmark => (
      bookmark.id === activeDrillRun.bookmarkId
        ? { ...bookmark, attempts: [...(bookmark.attempts || []), attempt].slice(-24) }
        : bookmark
    ));
    try {
      await putPlaySaveSlot({ ...record, drillBookmarks, savedAt });
      applySaveSlotRecord({ ...record, drillBookmarks, savedAt }, activeDrillRun.slot);
      await refreshSaveSlots();
      setSaveError(null);
      setSaveStatus(`Saved ${attempt.label} for ${activeDrillRun.label}.`);
      return true;
    } catch (err: any) {
      setSaveError(err.message || 'Could not save this drill attempt.');
      return false;
    }
  };

  const exitCurrentDrillAttempt = () => {
    setActiveDrillRun(null);
    setSaveStatus('Exited drill run. Continue playing from the loaded branch or reload the bookmark.');
  };

  const bookmarkCurrentDrill = async () => {
    const snapshot = exportGameSave();
    if (!snapshot || !gameState) {
      setSaveError('No active game to bookmark yet.');
      return false;
    }

    const existing = saveSlots[activeSaveSlot - 1];
    const savedAt = Date.now();
    const label = `T${gameState.turnNumber} ${gameState.step || gameState.phase}`;
    const bookmark: PlayDrillBookmark = {
      id: `${savedAt}-${Math.random().toString(36).slice(2, 8)}`,
      label,
      savedAt,
      turnNumber: gameState.turnNumber,
      phase: gameState.phase,
      step: gameState.step,
      engine: snapshot.engine,
      source: 'manual',
      focusTags: resolvePracticeMetadata()?.focusTags || [],
      note: summarizePracticeDecisionContext(),
      decisionContext: currentDrillDecisionContext(snapshot),
    };

    const drillBookmarks = [...(existing?.drillBookmarks || []), bookmark].slice(-16);
    try {
      const record = buildSaveRecord(activeSaveSlot, snapshot, false, drillBookmarks);
      await putPlaySaveSlot(record);
      applySaveSlotRecord(record, activeSaveSlot);
      await refreshSaveSlots();
      setSaveError(null);
      setSaveStatus(`Bookmarked ${label} in slot ${activeSaveSlot}.`);
      return true;
    } catch (err: any) {
      setSaveError(err.message || 'Could not bookmark this drill.');
      return false;
    }
  };

  const deleteSave = async (slot: number) => {
    try {
      await deletePlaySaveSlot(slot);
      applySaveSlotRecord(null, slot);
      await refreshSaveSlots();
      setSaveError(null);
      setSaveStatus(`Deleted slot ${slot}.`);
      if (activeSaveSlot === slot) setActiveSaveSlot(1);
    } catch (err: any) {
      setSaveError(err.message || 'Could not delete save slot.');
    }
  };

  const slugForDownload = (value: string): string => (
    value.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'drill'
  );

  const downloadPortableDrill = (record: PlaySaveSlotRecord, bookmark: PlayDrillBookmark, label: string) => {
    const payload = {
      schema: 'deckreps-practice-drill-v1',
      exportedAt: new Date().toISOString(),
      commander: record.commander,
      slot: record.slot,
      practice: record.practice,
      bookmark,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `deckreps-drill-${slugForDownload(record.commander)}-${slugForDownload(label)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const exportDrillBookmark = async (record: PlaySaveSlotRecord, bookmark: PlayDrillBookmark) => {
    try {
      const engine = bookmark.engine || await loadCanonicalPlayStateRef(bookmark.canonicalState);
      if (!engine) {
        throw new Error(`Drill "${bookmark.label}" is missing its portable engine state.`);
      }
      const portableBookmark: PlayDrillBookmark = {
        ...bookmark,
        engine,
        canonicalState: undefined,
        attempts: [],
      };
      downloadPortableDrill(record, portableBookmark, bookmark.label);
      setSaveError(null);
      setSaveStatus(`Exported drill "${bookmark.label}".`);
    } catch (err: any) {
      setSaveError(err.message || 'Could not export that drill.');
    }
  };

  const exportDrillAttempt = async (record: PlaySaveSlotRecord, bookmark: PlayDrillBookmark, attempt: PlayDrillAttempt) => {
    try {
      const engine = attempt.engine || await loadCanonicalPlayStateRef(attempt.canonicalState);
      if (!engine) {
        throw new Error(`Attempt "${attempt.label}" is missing its portable engine state.`);
      }
      const portableBookmark: PlayDrillBookmark = {
        ...bookmark,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        label: `${bookmark.label} / ${attempt.label}`,
        savedAt: Date.now(),
        turnNumber: attempt.turnNumber,
        phase: attempt.phase,
        step: attempt.step,
        engine,
        canonicalState: undefined,
        source: bookmark.source || 'manual',
        note: attempt.summary,
        decisionContext: attempt.decisionContext || bookmark.decisionContext,
        attempts: [],
      };
      downloadPortableDrill(record, portableBookmark, portableBookmark.label);
      setSaveError(null);
      setSaveStatus(`Exported attempt "${attempt.label}".`);
    } catch (err: any) {
      setSaveError(err.message || 'Could not export that drill attempt.');
    }
  };

  const importDrillBookmark = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;

    try {
      const payload = JSON.parse(await file.text()) as {
        schema?: string;
        bookmark?: PlayDrillBookmark;
      };
      if (payload.schema !== 'deckreps-practice-drill-v1' || !payload.bookmark) {
        throw new Error('That file is not a DeckReps drill export.');
      }
      if (!payload.bookmark.engine) {
        throw new Error('This drill export is missing its portable engine state.');
      }

      const savedAt = Date.now();
      const importedBookmark: PlayDrillBookmark = {
        ...payload.bookmark,
        id: `${savedAt}-${Math.random().toString(36).slice(2, 8)}`,
        label: `${payload.bookmark.label} (imported)`,
        savedAt,
        source: payload.bookmark.source || 'manual',
        note: [
          payload.bookmark.note,
          `Imported from ${file.name}`,
        ].filter(Boolean).join(' / '),
      };
      const existing = saveSlotsRef.current[activeSaveSlot - 1];
      const nextBookmarks = [...(existing?.drillBookmarks || []), importedBookmark].slice(-16);
      const snapshot = exportGameSave();
      const record = snapshot
        ? buildSaveRecord(activeSaveSlot, snapshot, false, nextBookmarks)
        : existing
          ? { ...existing, drillBookmarks: nextBookmarks, savedAt }
          : null;
      if (!record) {
        throw new Error('Start or load a practice game before importing a drill into an empty slot.');
      }

      await putPlaySaveSlot(record);
      applySaveSlotRecord(record, activeSaveSlot);
      await refreshSaveSlots();
      setSaveError(null);
      setSaveStatus(`Imported drill "${importedBookmark.label}" into slot ${activeSaveSlot}.`);
    } catch (err: any) {
      setSaveError(err.message || 'Could not import that drill export.');
    }
  };

  const loadReviewEntryAsDrill = async (entry: GameLogEntry) => {
    const snapshot = exportGameSave();
    if (!snapshot || !gameState) {
      setSaveError('No active reviewed game to drill from.');
      return false;
    }
    if (!entry.drillSeed) {
      setSaveError('That review entry does not have a restorable pre-decision state.');
      return false;
    }

    const existing = saveSlotsRef.current[activeSaveSlot - 1];
    const savedAt = Date.now();
    const bookmarkId = `${savedAt}-${Math.random().toString(36).slice(2, 8)}`;
    const label = `T${entry.turnNumber} review`;
    const noteParts = [
      `Review source: ${entry.action}`,
      entry.decision?.best ? `Best line: ${entry.decision.best.label}` : null,
      entry.decision ? `Selected: ${entry.decision.selected.label}` : null,
      entry.playByPlay || entry.rulesAudit?.reason || null,
    ].filter(Boolean);
    const bookmark: PlayDrillBookmark = {
      id: bookmarkId,
      label,
      savedAt,
      turnNumber: entry.turnNumber,
      phase: entry.phase,
      step: entry.decision?.step || entry.phase,
      engine: entry.drillSeed,
      source: 'review',
      focusTags: resolvePracticeMetadata()?.focusTags || [],
      note: noteParts.join(' / '),
    };
    const drillBookmarks = [...(existing?.drillBookmarks || []), bookmark].slice(-16);

    try {
      const record = buildSaveRecord(activeSaveSlot, snapshot, false, drillBookmarks);
      await putPlaySaveSlot(record);
      applySaveSlotRecord(record, activeSaveSlot);
      await refreshSaveSlots();
      const drillSnapshot = buildDrillRestoreSnapshot(snapshot, entry.drillSeed, `Review Drill: ${entry.action}`);
      const restored = restoreGameSave(drillSnapshot);
      if (!restored) {
        setSaveError(`Review drill "${entry.action}" could not be restored.`);
        return false;
      }
      restoreSlotUi(record);
      setShowReview(false);
      setActiveDrillRun({
        slot: activeSaveSlot,
        bookmarkId,
        label: `${label} / ${entry.action}`,
        startedAt: Date.now(),
      });
      setSaveError(null);
      setSaveStatus(`Loaded review drill "${entry.action}".`);
      return true;
    } catch (err: any) {
      setSaveError(err.message || 'Could not load this review entry as a drill.');
      return false;
    }
  };

  useEffect(() => {
    if (playDeepLoadHandledRef.current || !saveSlotsReady || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const slotParam = params.get('loadSlot');
    if (!slotParam) return;

    const slot = Number(slotParam);
    if (!Number.isInteger(slot) || slot < 1 || slot > SAVE_SLOT_COUNT) {
      playDeepLoadHandledRef.current = true;
      setSaveError(`Cannot load practice slot "${slotParam}".`);
      return;
    }

    const record = saveSlotsRef.current[slot - 1];
    if (!record) {
      playDeepLoadHandledRef.current = true;
      setActiveSaveSlot(slot);
      setSaveError(`Practice slot ${slot} is empty.`);
      return;
    }

    playDeepLoadHandledRef.current = true;
    setActiveSaveSlot(slot);
    const bookmarkId = params.get('drillBookmark');
    const attemptId = params.get('drillAttempt');
    if (bookmarkId) {
      const bookmark = record.drillBookmarks?.find(candidate => candidate.id === bookmarkId);
      if (!bookmark) {
        setSaveError(`Practice slot ${slot} does not contain that drill bookmark.`);
        return;
      }
      if (attemptId) {
        const attempt = bookmark.attempts?.find(candidate => candidate.id === attemptId);
        if (!attempt) {
          setSaveError(`Drill bookmark "${bookmark.label}" does not contain that attempt.`);
          return;
        }
        loadDrillAttempt(record, bookmark, attempt);
        return;
      }
      loadDrillBookmark(record, bookmark);
      return;
    }

    loadSaveSlot(record);
  }, [saveSlotsReady, saveSlots]);

  useEffect(() => {
    if (step !== 'game' || !gameState) return;
    const timeout = window.setTimeout(() => {
      saveCurrentGame(activeSaveSlot, true);
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [step, gameState, activeSaveSlot]);

  useEffect(() => {
    if (step !== 'game' || !gameState) return;
    const interval = window.setInterval(() => {
      saveCurrentGame(activeSaveSlot, true);
    }, AUTOSAVE_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [step, gameState, activeSaveSlot]);

  const renderPracticeHistory = (compact = false) => {
    const hasProgress = practiceHistory.records.length > 0
      || practiceHistory.bookmarkCount > 0
      || practiceHistory.attempts.length > 0;
    const recentRecords = [...practiceHistory.records]
      .sort((a, b) => b.savedAt - a.savedAt)
      .slice(0, compact ? 2 : 4);
    const recentDrills = practiceHistory.records.flatMap(record => (
      record.drillBookmarks || []
    ).map(bookmark => ({ record, bookmark })))
      .sort((a, b) => b.bookmark.savedAt - a.bookmark.savedAt)
      .slice(0, compact ? 2 : 4);
    const latestDrill = recentDrills[0] || null;
    const bestAttempt = practiceHistory.bestAttempts[0] || null;
    const latestAttempt = practiceHistory.recentAttempts[0] || null;
    const attemptTrend = bestAttempt && latestAttempt
      ? {
          best: bestAttempt.score,
          latest: latestAttempt.score,
          delta: latestAttempt.score - bestAttempt.score,
          latestLabel: latestAttempt.attempt.label,
          bestLabel: bestAttempt.attempt.label,
        }
      : null;
    const xenagosFocused = practiceHistory.archetypes.some(([archetype]) => /xenagos|dragon/i.test(archetype))
      || practiceHistory.topFocusTags.some(([tag]) => /xenagos|combat|dragon|terror|tutor|dracogenesis/i.test(tag))
      || selectedPracticePresetId === 'xenagos-dragons';
    const recommendations: {
      key: string;
      title: string;
      body: string;
      actionLabel: string;
      disabled?: boolean;
      onClick: () => void;
      tone: 'emerald' | 'fuchsia' | 'amber' | 'sky';
    }[] = [];

    if (!hasProgress) {
      recommendations.push({
        key: 'first-focused-rep',
        title: 'Start a clean focused rep',
        body: 'Load a known high-pressure practice shell, clear stale state, and let autosave begin tracking the run.',
        actionLabel: 'Start Focused Rep',
        disabled: isImporting || isSpawning || isGeneratingAIDeck,
        onClick: () => handleStartFocusedXenagosRep(),
        tone: 'emerald',
      });
      recommendations.push({
        key: 'first-drill',
        title: 'Open a controlled hard spot',
        body: 'Jump straight into a drillable complex-combat board instead of playing several turns to reach one.',
        actionLabel: 'Open Drill Scenario',
        disabled: isImporting,
        onClick: () => loadTrainingScenario('complex-combat'),
        tone: 'fuchsia',
      });
    } else {
      if (latestDrill) {
        recommendations.push({
          key: 'repeat-latest-drill',
          title: 'Repeat the latest drill',
          body: `${latestDrill.bookmark.label} has ${latestDrill.bookmark.attempts?.length || 0} recorded attempt${latestDrill.bookmark.attempts?.length === 1 ? '' : 's'}. Run it again before moving on.`,
          actionLabel: 'Repeat Latest Drill',
          onClick: () => loadDrillBookmark(latestDrill.record, latestDrill.bookmark),
          tone: 'fuchsia',
        });
      } else {
        recommendations.push({
          key: 'make-first-drill',
          title: 'Bookmark the next hard decision',
          body: 'Your saves exist, but no repeatable drill exists yet. Open a scenario and capture a decision point.',
          actionLabel: 'Open Scenario Lab',
          disabled: isImporting,
          onClick: () => loadTrainingScenario('complex-combat'),
          tone: 'amber',
        });
      }

      if (bestAttempt) {
        recommendations.push({
          key: 'compare-best-attempt',
          title: 'Compare against your best visible line',
          body: `${bestAttempt.bookmark.label} / ${bestAttempt.attempt.label}: ${bestAttempt.scoreLabel}. Reload it and look for what changed.`,
          actionLabel: 'Load Best Attempt',
          onClick: () => loadDrillAttempt(bestAttempt.record, bestAttempt.bookmark, bestAttempt.attempt),
          tone: 'sky',
        });
      } else if (latestDrill) {
        recommendations.push({
          key: 'create-first-attempt',
          title: 'Record an attempt outcome',
          body: 'Run the saved drill, then use Record Drill Attempt so the panel can compare outcomes instead of only listing bookmarks.',
          actionLabel: 'Run Saved Drill',
          onClick: () => loadDrillBookmark(latestDrill.record, latestDrill.bookmark),
          tone: 'sky',
        });
      }

      if (xenagosFocused) {
        recommendations.push({
          key: 'xenagos-pressure-drill',
          title: 'Drill the big combat turn',
          body: 'Rehearse the branch where triggers, combat math, and damage assignment decide whether the dragon turn is lethal or overextended.',
          actionLabel: 'Open Combat Drill',
          disabled: isImporting,
          onClick: () => loadTrainingScenario('complex-combat'),
          tone: 'amber',
        });
      }
    }
    const visibleRecommendations = recommendations.slice(0, compact ? 2 : 3);

    if (
      compact
      && practiceHistory.records.length === 0
      && practiceHistory.bookmarkCount === 0
      && practiceHistory.attempts.length === 0
    ) {
      return null;
    }

    return (
      <div data-testid="practice-progress-panel" className={`mb-3 rounded-lg border border-emerald-500/25 bg-emerald-950/15 ${compact ? 'p-2' : 'p-4'}`}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-emerald-200">
              <BarChart3 className="h-3.5 w-3.5" />
              Practice Progress
            </div>
            <div className="text-xs text-emerald-100/70">
              {practiceHistory.records.length} save{practiceHistory.records.length === 1 ? '' : 's'} / {practiceHistory.bookmarkCount} drill{practiceHistory.bookmarkCount === 1 ? '' : 's'} / {practiceHistory.attempts.length} attempt{practiceHistory.attempts.length === 1 ? '' : 's'}
            </div>
          </div>
          {practiceHistory.archetypes.length > 0 && (
            <div className="flex max-w-full flex-wrap justify-end gap-1">
              {practiceHistory.archetypes.map(([archetype, count]) => (
                <span key={archetype} className="rounded border border-emerald-500/25 bg-neutral-950/55 px-1.5 py-0.5 text-[10px] font-bold text-emerald-100">
                  {archetype} x{count}
                </span>
              ))}
            </div>
          )}
        </div>
        {attemptTrend && (
          <div className="mb-2 rounded border border-sky-500/20 bg-sky-950/20 px-3 py-2 text-xs text-sky-100">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-black uppercase tracking-wider text-sky-200">Attempt Trend</span>
              <span className={`rounded px-2 py-0.5 text-[10px] font-black uppercase ${
                attemptTrend.delta >= 0 ? 'bg-emerald-500/20 text-emerald-100' : 'bg-amber-500/20 text-amber-100'
              }`}>
                latest vs best {attemptTrend.delta >= 0 ? '+' : ''}{attemptTrend.delta.toFixed(1)}
              </span>
            </div>
            <div className="mt-1 leading-5 text-sky-100/75">
              Latest attempt "{attemptTrend.latestLabel}" scored {attemptTrend.latest.toFixed(1)}. Best visible attempt "{attemptTrend.bestLabel}" is {attemptTrend.best.toFixed(1)}.
            </div>
          </div>
        )}
        {!saveSlotsReady && !compact && (
          <div className="flex min-h-[82px] items-center gap-3 rounded border border-emerald-500/20 bg-neutral-950/45 p-3 text-emerald-100/75">
            <Loader2 className="h-4 w-4 animate-spin text-emerald-200" />
            <div>
              <div className="text-sm font-black text-emerald-100">Loading practice progress</div>
              <div className="mt-1 text-xs leading-5 text-emerald-100/65">Checking local save slots, drill bookmarks, and recorded attempts.</div>
            </div>
          </div>
        )}
        {saveSlotsReady && !hasProgress && (
          <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded border border-dashed border-emerald-500/30 bg-neutral-950/45 p-3">
              <div className="flex items-center gap-2 text-sm font-black text-emerald-100">
                <Target className="h-4 w-4" />
                No practice history yet
              </div>
              <p className="mt-2 text-xs leading-5 text-emerald-100/70">
                Start a clean rep or open a Scenario Lab position. Autosave records the session, and Bookmark This Moment turns hard spots into repeatable drills.
              </p>
            </div>
            <div className="grid gap-2">
              <button
                type="button"
                onClick={() => handleStartFocusedXenagosRep()}
                disabled={isImporting || isSpawning || isGeneratingAIDeck}
                className="min-h-[42px] rounded-lg bg-emerald-300 px-3 text-xs font-black text-stone-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Start Focused Rep
              </button>
              <button
                type="button"
                onClick={() => loadTrainingScenario('complex-combat')}
                disabled={isImporting}
                className="min-h-[42px] rounded-lg border border-emerald-500/35 bg-neutral-950 px-3 text-xs font-black text-emerald-100 transition hover:bg-emerald-950/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Open Drill Scenario
              </button>
            </div>
          </div>
        )}
        {saveSlotsReady && visibleRecommendations.length > 0 && (
          <div data-testid="practice-recommendations" className="my-2 rounded border border-amber-500/20 bg-neutral-950/55 p-2">
            <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-amber-200">
              <Lightbulb className="h-3.5 w-3.5" />
              Recommended Next Reps
            </div>
            <div className={`grid gap-2 ${compact ? '' : 'lg:grid-cols-3'}`}>
              {visibleRecommendations.map(recommendation => {
                const toneClass = recommendation.tone === 'emerald'
                  ? 'border-emerald-500/25 text-emerald-100 hover:bg-emerald-950/35'
                  : recommendation.tone === 'fuchsia'
                  ? 'border-fuchsia-500/25 text-fuchsia-100 hover:bg-fuchsia-950/35'
                  : recommendation.tone === 'sky'
                  ? 'border-sky-500/25 text-sky-100 hover:bg-sky-950/35'
                  : 'border-amber-500/25 text-amber-100 hover:bg-amber-950/25';
                return (
                  <button
                    key={recommendation.key}
                    type="button"
                    onClick={recommendation.onClick}
                    disabled={recommendation.disabled}
                    className={`min-h-[92px] rounded-lg border bg-neutral-950/60 p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${toneClass}`}
                  >
                    <span className="block text-xs font-black">{recommendation.title}</span>
                    <span className="mt-1 block text-[10px] leading-4 opacity-75">{recommendation.body}</span>
                    <span className="mt-2 block text-[10px] font-black uppercase tracking-wider opacity-90">{recommendation.actionLabel}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {practiceHistory.topFocusTags.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {practiceHistory.topFocusTags.map(([tag, count]) => (
              <span key={tag} className="rounded border border-amber-500/25 px-1.5 py-0.5 text-[10px] font-bold text-amber-100">
                {tag} x{count}
              </span>
            ))}
          </div>
        )}
        {recentRecords.length > 0 && (
          <div className="mb-2 rounded border border-emerald-500/20 bg-neutral-950/50 p-2">
            <div className="mb-1 text-[10px] font-black uppercase tracking-wider text-emerald-200">Resume Practice</div>
            <div className="grid gap-1 sm:grid-cols-2">
              {recentRecords.map(record => {
                const audit = auditPlaySaveSnapshot(record.snapshot);
                const canonicalAudit = record.canonicalEngineSave ? auditCanonicalPlayEngineSave(record.canonicalEngineSave) : null;
                const loadBlocked = Boolean(
                  (canonicalAudit && !canonicalAudit.ok)
                  || record.canonicalManager?.status === 'missing'
                  || record.canonicalManager?.status === 'mismatch'
                  || (!record.canonicalManager && !canonicalAudit && audit.status === 'failed')
                );
                return (
                  <button
                    key={`resume-${record.slot}`}
                    type="button"
                    onClick={() => loadSaveSlot(record)}
                    disabled={loadBlocked}
                    className="min-h-11 rounded border border-emerald-500/25 px-2 py-1 text-left text-[10px] font-bold text-emerald-100 hover:bg-emerald-950/35 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="block truncate">Slot {record.slot}: {record.commander}</span>
                    <span className="block truncate text-[9px] text-emerald-100/65">
                      Turn {record.turnNumber} / {record.phase} / {new Date(record.savedAt).toLocaleString()}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {recentDrills.length > 0 && (
          <div className="mb-2 rounded border border-fuchsia-500/20 bg-neutral-950/50 p-2">
            <div className="mb-1 text-[10px] font-black uppercase tracking-wider text-fuchsia-200">Open Drill</div>
            <div className="grid gap-1 sm:grid-cols-2">
              {recentDrills.map(({ record, bookmark }) => (
                <button
                  key={`drill-${record.slot}:${bookmark.id}`}
                  type="button"
                  onClick={() => loadDrillBookmark(record, bookmark)}
                  className="min-h-11 rounded border border-fuchsia-500/25 px-2 py-1 text-left text-[10px] font-bold text-fuchsia-100 hover:bg-fuchsia-950/35"
                  title={bookmark.note || bookmark.label}
                >
                  <span className="block truncate">{bookmark.label}</span>
                  <span className="block truncate text-[9px] text-fuchsia-100/65">
                    Slot {record.slot} / {record.commander} / {bookmark.attempts?.length || 0} attempt{bookmark.attempts?.length === 1 ? '' : 's'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        {(practiceHistory.bestAttempts.length > 0 || practiceHistory.recentAttempts.length > 0) && (
          <div className="grid gap-2 lg:grid-cols-2">
            {practiceHistory.bestAttempts.length > 0 && (
              <div className="rounded border border-emerald-500/20 bg-neutral-950/50 p-2">
                <div className="mb-1 text-[10px] font-black uppercase tracking-wider text-emerald-200">Best Visible Outcomes</div>
                <div className="grid gap-1">
                  {practiceHistory.bestAttempts.map(({ record, bookmark, attempt, scoreLabel }) => (
                    <button
                      key={`best-${record.slot}:${bookmark.id}:${attempt.id}`}
                      type="button"
                      onClick={() => loadDrillAttempt(record, bookmark, attempt)}
                      className="min-h-9 rounded border border-emerald-500/25 px-2 py-1 text-left text-[10px] font-bold text-emerald-100 hover:bg-emerald-950/35"
                      title={attempt.summary}
                    >
                      <span className="block truncate">{bookmark.label} / {attempt.label}</span>
                      <span className="block truncate text-[9px] text-emerald-100/65">{scoreLabel}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {practiceHistory.recentAttempts.length > 0 && (
              <div className="rounded border border-sky-500/20 bg-neutral-950/50 p-2">
                <div className="mb-1 text-[10px] font-black uppercase tracking-wider text-sky-200">Recent Attempts</div>
                <div className="grid gap-1">
                  {practiceHistory.recentAttempts.map(({ record, bookmark, attempt, scoreLabel }) => (
                    <button
                      key={`recent-${record.slot}:${bookmark.id}:${attempt.id}`}
                      type="button"
                      onClick={() => loadDrillAttempt(record, bookmark, attempt)}
                      className="min-h-9 rounded border border-sky-500/25 px-2 py-1 text-left text-[10px] font-bold text-sky-100 hover:bg-sky-950/35"
                      title={attempt.summary}
                    >
                      <span className="block truncate">{record.commander} / {attempt.label}</span>
                      <span className="block truncate text-[9px] text-sky-100/65">{scoreLabel}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderScenarioLab = (embedded = false) => (
    <div
      id="scenario-lab-section"
      data-testid={embedded ? 'scenario-lab-panel-embedded' : 'scenario-lab-panel'}
      className={embedded
        ? 'border-b border-amber-500/15 p-3'
        : 'mb-6 rounded-xl border border-emerald-500/30 bg-emerald-950/15 p-4 shadow-xl shadow-black/15'
      }
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-emerald-200">
            <Target className="h-3.5 w-3.5" />
            Scenario Lab
          </div>
          <p className={`${embedded ? 'mt-1 text-[11px] leading-4' : 'mt-1 text-xs leading-5'} text-emerald-100/70`}>
            Jump directly into exact hard spots without importing a deck or playing up to the position.
          </p>
        </div>
        {!embedded && (
          <span className="rounded border border-emerald-500/25 bg-neutral-950/55 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-100">
            Drill-first setup
          </span>
        )}
      </div>
      <div className={`grid gap-2 ${embedded ? 'grid-cols-2' : 'sm:grid-cols-2'}`}>
        {TRAINING_SCENARIOS.map(scenario => (
          <button
            key={scenario.id}
            type="button"
            onClick={() => loadTrainingScenario(scenario.id)}
            disabled={isImporting}
            className={`${embedded ? 'min-h-[44px] px-2 py-2' : 'min-h-[72px] px-3 py-2'} rounded-lg border border-emerald-500/30 bg-neutral-950 text-left transition-colors hover:bg-emerald-950/20 disabled:cursor-not-allowed disabled:opacity-60`}
          >
            <span className="flex flex-wrap items-center gap-1.5">
              <span className={`${embedded ? 'text-xs' : 'text-sm'} font-black text-emerald-100`}>{scenario.title}</span>
              <span className={`${embedded ? 'hidden' : 'inline-flex'} rounded border border-emerald-500/25 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-emerald-200`}>
                {scenario.focus}
              </span>
            </span>
            <span className={`${embedded ? 'sr-only' : 'text-[11px] leading-5'} mt-1 block text-stone-400`}>{scenario.description}</span>
          </button>
        ))}
      </div>
    </div>
  );

  const renderSaveSlots = (compact = false) => {
    const saveSlotEntries = saveSlots.map((record, index) => ({ record, slot: index + 1 }));
    const populatedSaveCount = saveSlotEntries.filter(({ record }) => record).length;
    const visibleSaveSlotEntries = compact || showAllSaveSlots
      ? saveSlotEntries
      : saveSlotEntries
          .filter(({ record, slot }) => Boolean(record) || slot === activeSaveSlot)
          .slice(0, 2);
    const showSaveDiagnostics = compact || showAllSaveSlots || step === 'game';

    return (
      <div className={`rounded-xl border border-stone-700 bg-stone-900/95 ${compact ? 'p-3' : 'p-4'} shadow-xl shadow-black/20`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-amber-300" />
          <div>
            <h2 className="text-sm font-black uppercase tracking-wider text-stone-200">Game Saves</h2>
            {!compact && (
              <p className="mt-0.5 text-[11px] leading-4 text-stone-500">
                Slot {activeSaveSlot} autosaves. {populatedSaveCount} of {SAVE_SLOT_COUNT} slots have practice state.
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {!compact && (
            <button
              type="button"
              onClick={() => setShowAllSaveSlots(value => !value)}
              className="min-h-9 rounded border border-stone-700 px-3 text-xs font-black text-stone-200 hover:bg-stone-800"
            >
              {showAllSaveSlots ? 'Hide Details' : 'Show All'}
            </button>
          )}
          <label className="flex min-h-9 cursor-pointer items-center gap-1.5 rounded border border-sky-500/40 px-3 text-xs font-black text-sky-100 hover:bg-sky-950/40">
            <Upload className="h-3.5 w-3.5" />
            Import Drill
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={importDrillBookmark}
            />
          </label>
          {step === 'game' && (
            <button
              type="button"
              onClick={() => saveCurrentGame(activeSaveSlot, false)}
              className="flex min-h-9 items-center gap-1.5 rounded bg-amber-500 px-3 text-xs font-black text-stone-950 hover:bg-amber-400"
            >
              <Save className="h-3.5 w-3.5" />
              Save
            </button>
          )}
        </div>
      </div>
      {(saveStatus || saveError) && (
        <div className={`mb-3 rounded border px-3 py-2 text-xs ${
          saveError ? 'border-red-500/40 bg-red-950/40 text-red-100' : 'border-emerald-500/40 bg-emerald-950/40 text-emerald-100'
        }`}>
          {saveError || saveStatus}
        </div>
      )}
      {compact && renderPracticeHistory(true)}
      <div className={`grid gap-2 ${showAllSaveSlots && !compact ? 'xl:grid-cols-2' : ''}`}>
        {visibleSaveSlotEntries.map(({ record, slot }) => {
          const active = activeSaveSlot === slot;
          const audit = record ? auditPlaySaveSnapshot(record.snapshot) : null;
          const canonicalAudit = record?.canonicalEngineSave ? auditCanonicalPlayEngineSave(record.canonicalEngineSave) : null;
          const checkpointSequence = record ? latestCheckpointSequence(record) : null;
          const managerStatus = record?.canonicalManager?.status;
          const canonicalManagerVerified = managerStatus === 'ok';
          const showLegacyReplayAudit = Boolean(audit && (!canonicalManagerVerified || audit.ok));
          const loadBlocked = Boolean(
            record && (
              (canonicalAudit && !canonicalAudit.ok)
              || managerStatus === 'missing'
              || managerStatus === 'mismatch'
              || (!record.canonicalManager && !canonicalAudit && audit?.status === 'failed')
            ),
          );
          return (
            <div
              key={slot}
              className={`rounded-lg border ${showSaveDiagnostics ? 'p-3' : 'p-2.5'} ${
                active ? 'border-amber-400 bg-amber-950/20' : 'border-stone-700 bg-stone-950/80'
              }`}
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setActiveSaveSlot(slot)}
                  className="min-w-0 text-left"
                >
                  <span className="block text-xs font-black uppercase tracking-wider text-stone-500">Slot {slot}{active ? ' · Autosave Target' : ''}</span>
                  <span className="block truncate text-sm font-bold text-stone-100">
                    {record?.commander || 'Empty Slot'}
                  </span>
                  {record && (
                    <span className="block text-xs text-stone-400">
                      Turn {record.turnNumber} · {record.phase} · {new Date(record.savedAt).toLocaleString()}
                    </span>
                  )}
                  {record?.practice && (
                    <span className="mt-1 block text-xs text-amber-200">
                      {record.practice.archetype}
                      {record.practice.focusTags.length > 0 ? ` - ${record.practice.focusTags.slice(0, 2).join(', ')}` : ''}
                    </span>
                  )}
                  {showSaveDiagnostics && (showLegacyReplayAudit || canonicalAudit || record?.canonicalManager) && (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {record?.canonicalManager && (
                        <span className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-black uppercase tracking-wide ${
                          record.canonicalManager.status === 'ok'
                            ? 'border-fuchsia-500/40 bg-fuchsia-950/30 text-fuchsia-200'
                            : 'border-red-500/40 bg-red-950/30 text-red-200'
                        }`}>
                          {record.canonicalManager.status === 'ok'
                            ? 'SaveManager verified'
                            : record.canonicalManager.status === 'mismatch'
                            ? 'SaveManager mismatch'
                            : 'SaveManager missing'}
                        </span>
                      )}
                      {record?.engineAuthority && (
                        <span className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-black uppercase tracking-wide ${
                          record.engineAuthority.kind === 'save-manager' && record.engineAuthority.status !== 'missing' && record.engineAuthority.status !== 'mismatch'
                            ? 'border-fuchsia-500/40 bg-fuchsia-950/30 text-fuchsia-200'
                            : record.engineAuthority.kind === 'canonical-json'
                              ? 'border-sky-500/40 bg-sky-950/30 text-sky-200'
                              : 'border-red-500/40 bg-red-950/30 text-red-200'
                        }`}>
                          {record.engineAuthority.kind === 'save-manager'
                            ? 'SaveManager primary'
                            : record.engineAuthority.kind === 'canonical-json'
                            ? 'Canonical fallback'
                            : record.engineAuthority.kind === 'legacy-inline'
                            ? 'Legacy inline'
                            : 'Engine missing'}
                        </span>
                      )}
                      {showLegacyReplayAudit && audit && (
                        <span className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-black uppercase tracking-wide ${
                          audit.ok
                            ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-200'
                            : record?.canonicalManager
                              ? 'border-sky-500/40 bg-sky-950/30 text-sky-100'
                              : 'border-amber-500/40 bg-amber-950/30 text-amber-100'
                        }`}>
                          {audit.ok ? audit.message : record?.canonicalManager ? 'Replay audit warning' : 'Replay audit needs admin review'}
                        </span>
                      )}
                      {canonicalAudit && (
                        <span className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-black uppercase tracking-wide ${
                          canonicalAudit.ok
                            ? 'border-sky-500/40 bg-sky-950/30 text-sky-200'
                            : 'border-red-500/40 bg-red-950/30 text-red-200'
                        }`}>
                          {canonicalAudit.ok ? 'Engine save OK' : canonicalAudit.message}
                        </span>
                      )}
                    </span>
                  )}
                  {showSaveDiagnostics && ((canonicalAudit?.ok && canonicalAudit.fingerprint) || checkpointSequence !== null) ? (
                    <span className="mt-1 block text-[11px] text-stone-500">
                      {record?.canonicalManager?.fingerprint ? `Manager ${record.canonicalManager.fingerprint.slice(0, 10)}` : ''}
                      {record?.canonicalManager?.verifiedFingerprint ? ` / Verified ${record.canonicalManager.verifiedFingerprint.slice(0, 10)}` : ''}
                      {record?.canonicalManager?.fingerprint && canonicalAudit?.ok && canonicalAudit.fingerprint ? ' / ' : ''}
                      {canonicalAudit?.ok && canonicalAudit.fingerprint ? `State ${canonicalAudit.fingerprint.slice(0, 10)}` : ''}
                      {canonicalAudit?.ok && canonicalAudit.fingerprint && checkpointSequence !== null ? ' / ' : ''}
                      {checkpointSequence !== null ? `Drill checkpoint ${checkpointSequence}` : ''}
                    </span>
                  ) : null}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setActiveSaveSlot(slot)}
                  className="min-h-8 rounded border border-stone-700 px-2 text-xs font-bold text-stone-200 hover:bg-stone-800"
                >
                  Use Slot
                </button>
                {record && (
                  <button
                    type="button"
                    onClick={() => loadSaveSlot(record)}
                    disabled={loadBlocked}
                    title={loadBlocked ? 'This save is missing or mismatching its authoritative engine state.' : undefined}
                    className="flex min-h-8 items-center gap-1 rounded border border-blue-500/40 px-2 text-xs font-bold text-blue-100 hover:bg-blue-950/40 disabled:cursor-not-allowed disabled:border-stone-700 disabled:text-stone-500 disabled:hover:bg-transparent"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    Load
                  </button>
                )}
                {record && checkpointSequence !== null && (
                  <button
                    type="button"
                    onClick={() => loadLatestCheckpoint(record)}
                    className="flex min-h-8 items-center gap-1 rounded border border-sky-500/40 px-2 text-xs font-bold text-sky-100 hover:bg-sky-950/40"
                  >
                    <History className="h-3.5 w-3.5" />
                    Drill Latest
                  </button>
                )}
                {showSaveDiagnostics && record?.drillBookmarks && record.drillBookmarks.length > 0 && (
                  <div className="basis-full rounded-lg border border-fuchsia-500/25 bg-fuchsia-950/20 p-2">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <div className="text-[10px] font-black uppercase tracking-wider text-fuchsia-200">Drill Lab</div>
                      <div className="text-[10px] text-fuchsia-100/70">{record.drillBookmarks.length} bookmark{record.drillBookmarks.length === 1 ? '' : 's'}</div>
                    </div>
                    <div className="grid gap-1 sm:grid-cols-2">
                      {record.drillBookmarks.slice(-6).reverse().map(bookmark => (
                        <div key={bookmark.id} className="rounded border border-fuchsia-500/20 bg-neutral-950/50 p-1.5">
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => loadDrillBookmark(record, bookmark)}
                              className="flex min-h-8 min-w-0 flex-1 items-center gap-1 rounded border border-fuchsia-500/40 px-2 text-left text-xs font-bold text-fuchsia-100 hover:bg-fuchsia-950/40"
                              title={bookmark.note || bookmark.label}
                            >
                              <BookmarkPlus className="h-3.5 w-3.5 shrink-0" />
                              <span className="min-w-0 flex-1 truncate">{bookmark.label}</span>
                              {bookmark.attempts?.length ? <span className="shrink-0 text-[10px] text-fuchsia-100/70">{bookmark.attempts.length}</span> : null}
                            </button>
                            <button
                              type="button"
                              onClick={() => exportDrillBookmark(record, bookmark)}
                              className="flex min-h-8 w-8 shrink-0 items-center justify-center rounded border border-sky-500/40 text-sky-100 hover:bg-sky-950/40"
                              aria-label={`Export drill ${bookmark.label}`}
                              title="Export drill JSON"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          {bookmark.note && (
                            <div className="mt-1 truncate text-[10px] text-fuchsia-100/65">{bookmark.note}</div>
                          )}
                          {bookmark.attempts?.length ? (() => {
                            const rankedAttempts = rankedDrillAttempts(bookmark.attempts);
                            const latestAttempt = [...bookmark.attempts].sort((a, b) => b.savedAt - a.savedAt)[0];
                            const bestAttempt = rankedAttempts[0];
                            return (
                              <div className="mt-1 rounded border border-sky-500/20 bg-sky-950/15 p-1">
                                <div className="mb-1 flex items-center justify-between gap-2 text-[9px] font-black uppercase tracking-wider text-sky-200/85">
                                  <span>Compare Attempts</span>
                                  <span>{bookmark.attempts?.length}</span>
                                </div>
                                {bestAttempt && (
                                  <div className="mb-1 rounded border border-emerald-500/25 bg-emerald-950/20 p-1 text-[9px] text-emerald-100">
                                    <div className="font-black uppercase tracking-wide">Best visible outcome</div>
                                    <div className="truncate">{bestAttempt.label} / {bestAttempt.comparisonLabel}</div>
                                    <div className="mt-1 flex gap-1">
                                      <button
                                        type="button"
                                        onClick={() => loadDrillAttempt(record, bookmark, bestAttempt)}
                                        className="min-h-6 flex-1 rounded border border-emerald-500/40 px-1 font-bold text-emerald-50 hover:bg-emerald-950/40"
                                      >
                                        Load Best
                                      </button>
                                      {latestAttempt && latestAttempt.id !== bestAttempt.id && (
                                        <button
                                          type="button"
                                          onClick={() => loadDrillAttempt(record, bookmark, latestAttempt)}
                                          className="min-h-6 flex-1 rounded border border-sky-500/40 px-1 font-bold text-sky-50 hover:bg-sky-950/40"
                                        >
                                          Load Latest
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                )}
                                <div className="max-h-44 overflow-y-auto pr-1">
                                  <div className="grid gap-1">
                                    {rankedAttempts.map(attempt => (
                                      <div
                                        key={attempt.id}
                                        className="rounded border border-sky-500/25 bg-neutral-950/55 p-1"
                                        title={attempt.summary}
                                      >
                                        <div className="flex gap-1">
                                          <button
                                            type="button"
                                            onClick={() => loadDrillAttempt(record, bookmark, attempt)}
                                            className="min-h-7 min-w-0 flex-1 rounded border border-sky-500/40 px-2 text-left text-[10px] font-bold text-sky-100 hover:bg-sky-950/40"
                                          >
                                            <span className="block truncate">
                                              #{attempt.rank} {attempt.label}
                                            </span>
                                            <span className="block truncate text-[9px] font-semibold text-sky-100/60">
                                              T{attempt.turnNumber} {attempt.step || attempt.phase} / {attempt.comparisonLabel}
                                            </span>
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => exportDrillAttempt(record, bookmark, attempt)}
                                            className="flex min-h-7 w-7 shrink-0 items-center justify-center rounded border border-sky-500/40 text-sky-100 hover:bg-sky-950/40"
                                            aria-label={`Export drill attempt ${attempt.label}`}
                                            title="Export this attempt"
                                          >
                                            <Download className="h-3 w-3" />
                                          </button>
                                        </div>
                                        <div className="mt-1 line-clamp-2 text-[9px] text-sky-100/55">{attempt.summary}</div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            );
                          })() : null}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {step === 'game' && (
                  <button
                    type="button"
                    onClick={() => saveCurrentGame(slot, false)}
                    className="flex min-h-8 items-center gap-1 rounded border border-amber-500/40 px-2 text-xs font-bold text-amber-100 hover:bg-amber-950/40"
                  >
                    <Save className="h-3.5 w-3.5" />
                    Save Here
                  </button>
                )}
                {record && (
                  <button
                    type="button"
                    onClick={() => deleteSave(slot)}
                    className="flex min-h-8 items-center gap-1 rounded border border-red-500/40 px-2 text-xs font-bold text-red-100 hover:bg-red-950/40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
    );
  };

  const addToDeckHistory = (commander: string, text: string) => {
    setDeckHistory(prev => {
      const filtered = prev.filter(e => e.commander !== commander);
      const entry: DeckHistoryEntry = { commander, text, timestamp: Date.now() };
      const updated = [entry, ...filtered].slice(0, DECK_HISTORY_MAX);
      cacheSet('deck_history', updated, 30 * 24 * 60 * 60 * 1000);
      return updated;
    });
  };

  const handleImportFromUrl = async () => {
    if (!deckUrl.trim()) return;
    setIsImporting(true);
    setImportError(null);
    setImportResult(null);
    setSelectedPracticePresetId(null);
    try {
      const localDeck = importDeckUrlLocally(deckUrl);
      if (localDeck?.format === 'standard') {
        setStandardDeckText(localDeck.deckText);
        setStep('standard');
        return;
      }

      let listText = localDeck?.format === 'commander' ? localDeck.deckText : '';
      if (!listText) {
        // Step 1: Fetch card list from URL
        const parseRes = await fetch('/api/parse-deck-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: deckUrl }),
        });
        if (!parseRes.ok) {
          const err = await parseRes.json().catch(() => ({}));
          throw new Error(err.detail || `Failed to fetch deck (${parseRes.status})`);
        }
        const parsed = await parseRes.json();

        // Step 2: Build decklist text and run through import-deck for validation
        const lines: string[] = [];
        if (parsed.commander) {
          lines.push('Commander');
          const commanderNames = String(parsed.commander)
            .split(' // ')
            .map(name => name.trim())
            .filter(Boolean);
          for (const commanderName of commanderNames.length > 1 ? commanderNames : [parsed.commander]) {
            lines.push(`1 ${commanderName}`);
          }
          lines.push('Deck');
        }
        for (const card of parsed.cards) lines.push(`1 ${card}`);
        listText = lines.join('\n');
      }

      const importRes = await fetch(shelectorApiUrl('/import-deck'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decklist_text: listText,
          bracket: spawnBracket,
          fill_missing: fillMissingCards,
        }),
      });
      if (!importRes.ok) throw new Error(`Import validation failed (${importRes.status})`);
      const data: DeckImportResult = await importRes.json();
      setImportResult(data);
      setSpawnedOpponents([]);
      setSpawnProgress('');

      if (data.commander) {
        addToDeckHistory(data.commander, listText);
        cacheSet('last_deck_text', listText, 30 * 24 * 60 * 60 * 1000);
        cacheSet('last_deck_result', data, 30 * 24 * 60 * 60 * 1000);
      }
    } catch (err: any) {
      setImportError(err.message || 'Failed to import deck from URL');
    } finally {
      setIsImporting(false);
    }
  };

  const handleImportFromText = async () => {
    if (!deckText.trim()) return;
    setIsImporting(true);
    setImportError(null);
    setImportResult(null);
    setSelectedPracticePresetId(null);
    try {
      const res = await fetch(shelectorApiUrl('/import-deck'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decklist_text: deckText,
          bracket: spawnBracket,
          fill_missing: fillMissingCards,
        }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data: DeckImportResult = await res.json();
      setImportResult(data);
      setSpawnedOpponents([]);
      setSpawnProgress('');

      if (data.commander) {
        addToDeckHistory(data.commander, deckText);
        cacheSet('last_deck_text', deckText, 30 * 24 * 60 * 60 * 1000);
        cacheSet('last_deck_result', data, 30 * 24 * 60 * 60 * 1000);
      }
    } catch (err: any) {
      setImportError(err.message || 'Failed to import deck');
    } finally {
      setIsImporting(false);
    }
  };

  const closeGuidedPrompt = () => {
    cacheSet(GUIDED_PROMPT_CACHE_KEY, true, 365 * 24 * 60 * 60 * 1000);
    setShowGuidedPrompt(false);
  };

  const startGuidedFirstGame = () => {
    cacheSet(GUIDED_PROMPT_CACHE_KEY, true, 365 * 24 * 60 * 60 * 1000);
    setNewPlayerMode(true);
    setCoachMode(true);
    setSpawnBracket(2);
    setOpponentCount(1);
    setSpawnMode('pool');
    setShowGuidedPrompt(false);
    setStarterDeckSpotlight(true);
    setStep('import');
    window.setTimeout(() => {
      starterDecksRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 50);
  };

  const handleSelectBeginnerDeck = async (deck: BeginnerDeck) => {
    setStarterDeckLoadingId(deck.id);
    setIsImporting(true);
    setImportError(null);
    setImportResult(null);
    setSelectedPracticePresetId(deck.id);
    setSpawnedOpponents([]);
    setSpawnProgress('');
    setSpawnBracket(deck.bracket);
    setDeckText(deck.decklist);
    setImportTab('text');
    setNewPlayerMode(deck.audience !== 'practice');
    setCoachMode(true);

    try {
      const res = await fetch(shelectorApiUrl('/import-deck'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decklist_text: deck.decklist,
          bracket: deck.bracket,
          fill_missing: true,
        }),
      });
      if (!res.ok) throw new Error(`Starter deck import failed (${res.status})`);
      const data: DeckImportResult = await res.json();
      setImportResult(data);

      if (data.commander) {
        addToDeckHistory(data.commander, deck.decklist);
        cacheSet('last_deck_text', deck.decklist, 30 * 24 * 60 * 60 * 1000);
        cacheSet('last_deck_result', data, 30 * 24 * 60 * 60 * 1000);
      }

      if (data.valid) {
        setStep('opponent');
        setStarterDeckSpotlight(false);
      } else {
        setStep('import');
      }
    } catch (err: any) {
      setImportError(err.message || 'Failed to load starter deck');
      setStep('import');
    } finally {
      setIsImporting(false);
      setStarterDeckLoadingId(null);
    }
  };

  const handleStartFocusedXenagosRep = async (mode: 'rep' | 'mulligan' = 'rep') => {
    const deck = PRACTICE_DECKS.find(candidate => candidate.id === 'practice-xenagos-dragons');
    if (!deck) return;

    const isMulliganDrill = mode === 'mulligan';
    const focusedPersonality = 'Aggressive';
    const focusedOpponentCount: OpponentCount = 1;
    const focusedSpawnMode: 'counter' = 'counter';
    newGame();
    setStarterDeckLoadingId(deck.id);
    setIsImporting(true);
    setIsSpawning(true);
    setIsGeneratingAIDeck(false);
    setImportError(null);
    setSaveError(null);
    setSaveStatus(null);
    setActiveDrillRun(null);
    setShowReview(false);
    setSelectedPracticePresetId(deck.id);
    setDeckText(deck.decklist);
    setImportTab('text');
    setNewPlayerMode(false);
    setCoachMode(true);
    setOpponentCount(focusedOpponentCount);
    setSpawnMode(focusedSpawnMode);
    setSpawnBracket(deck.bracket);
    setPersonality(focusedPersonality);
    setSpawnedOpponents([]);
    setSpawnProgress(isMulliganDrill ? 'Preparing Xenagos mulligan drill...' : 'Loading Xenagos practice deck...');

    try {
      const importRes = await fetch(shelectorApiUrl('/import-deck'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decklist_text: deck.decklist,
          bracket: deck.bracket,
          fill_missing: true,
        }),
      });
      if (!importRes.ok) throw new Error(`Xenagos preset import failed (${importRes.status})`);
      const data: DeckImportResult = await importRes.json();
      setImportResult(data);
      if (!data.valid) {
        throw new Error(data.errors[0] || 'Xenagos preset did not import as a valid Commander deck.');
      }

      if (data.commander) {
        addToDeckHistory(data.commander, deck.decklist);
        cacheSet('last_deck_text', deck.decklist, 30 * 24 * 60 * 60 * 1000);
        cacheSet('last_deck_result', data, 30 * 24 * 60 * 60 * 1000);
      }

      const humanCommander = data.commander || '';
      const humanCommanderFace = humanCommander.split(' // ')[0]?.trim();
      const humanCommanderData = data.card_data[humanCommander]
        || (humanCommanderFace ? data.card_data[humanCommanderFace] : undefined);

      setSpawnProgress('Picking an aggressive Shelector opponent...');
      const spawnRes = await fetch(shelectorApiUrl('/spawn-opponent'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: focusedSpawnMode,
          bracket: deck.bracket,
          avoid_colors: [],
          human_commander: humanCommander || null,
          human_colors: humanCommanderData?.color_identity || [],
          personality: focusedPersonality,
        }),
      });
      if (!spawnRes.ok) throw new Error(`Failed to spawn practice opponent (${spawnRes.status})`);
      const opponent: SpawnedOpponent = {
        ...(await spawnRes.json()),
        personality: focusedPersonality,
      };
      setSpawnedOpponents([opponent]);

      setIsGeneratingAIDeck(true);
      setSpawnProgress(`Building ${opponent.commander} as ${focusedPersonality}...`);
      const aiRes = await fetch(shelectorApiUrl('/generate-ai-deck'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commander: opponent.commander,
          bracket: deck.bracket,
        }),
      });
      if (!aiRes.ok) throw new Error(`Failed to generate practice opponent (${aiRes.status})`);
      const aiDeck = await aiRes.json() as AIDeckResponse;
      const aiDecks: ImportedCards[] = [{
        commander: aiDeck.commander,
        cards: aiDeck.cards,
        lands: aiDeck.lands,
        cardData: aiDeck.card_data,
      }];

      const unsupported = findUnsupportedEngineCards([
        {
          label: 'Your Xenagos practice deck',
          commander: humanCommander,
          cards: data.cards,
          lands: data.lands,
          sideboard: data.sideboard || [],
        },
        {
          label: 'Shelector Aggressive',
          commander: aiDeck.commander,
          cards: aiDeck.cards,
          lands: aiDeck.lands,
          sideboard: [],
        },
      ]);
      if (unsupported.length > 0) {
        throw new Error(formatUnsupportedEngineCards(unsupported));
      }

      const started = startGame(
        {
          commander: humanCommander,
          cards: data.cards,
          lands: data.lands,
          sideboard: data.sideboard || [],
          cardData: data.card_data,
        },
        aiDecks,
        { aiDifficulty: deck.bracket },
      );
      if (!started) {
        throw new Error('Failed to initialize the focused Xenagos practice game.');
      }

      setStep('game');
      setSaveStatus(isMulliganDrill
        ? 'Started Xenagos mulligan drill: choose keep/mulligan decisions from a fresh opening hand, then bookmark or save promising starts.'
        : 'Started clean Xenagos rep: Aggressive Shelector, coach mode on, focus tags visible.');
    } catch (err: any) {
      setImportError(err.message || 'Failed to start focused Xenagos rep');
      setStep('import');
    } finally {
      setIsImporting(false);
      setIsSpawning(false);
      setIsGeneratingAIDeck(false);
      setStarterDeckLoadingId(null);
      setSpawnProgress('');
    }
  };

  const handleStartXenagosMulliganDrill = () => {
    handleStartFocusedXenagosRep('mulligan');
  };

  const loadTrainingScenario = async (scenarioId: TrainingScenarioId) => {
    const scenario = TRAINING_SCENARIOS.find(candidate => candidate.id === scenarioId);
    if (!scenario) return false;
    setImportError(null);
    setSaveError(null);
    setSaveStatus(null);
    setIsImporting(true);
    try {
      const scenarios = await import('../lib/qaGameScenarios');
      const engine = scenarioId === 'complex-combat'
        ? scenarios.createComplexCombatQaState()
        : scenarioId === 'storm-grapeshot'
        ? scenarios.createStormGrapeshotQaState()
        : scenarioId === 'token-stack'
        ? scenarios.createTokenStackQaState()
        : scenarioId === 'land-entry-fetch'
        ? scenarios.createLandEntryFetchQaState()
        : scenarioId === 'library-manipulation'
        ? scenarios.createLibraryManipulationQaState()
        : scenarioId === 'modal-choice'
        ? scenarios.createModalChoiceQaState()
        : scenarioId === 'mulligan-selection'
        ? scenarios.createMulliganSelectionQaState()
        : scenarioId === 'equipment-d20'
        ? scenarios.createEquipmentD20QaState()
        : scenarios.createSisayActivationQaState();
      const humanCommander = scenarioId === 'complex-combat'
        ? 'Trampling Commander'
        : scenarioId === 'storm-grapeshot'
        ? 'Vivi Ornitier'
        : scenarioId === 'token-stack'
        ? 'Goblin'
        : scenarioId === 'land-entry-fetch'
        ? 'Sisay, Weatherlight Captain'
        : scenarioId === 'library-manipulation'
        ? 'Talrand, Sky Summoner'
        : scenarioId === 'modal-choice'
        ? 'Krenko, Mob Boss'
        : scenarioId === 'mulligan-selection'
        ? 'Talrand, Sky Summoner'
        : scenarioId === 'equipment-d20'
        ? 'Goblin Morningstar'
        : 'Sisay, Weatherlight Captain';
      const aiCommanderNames: Record<string, string> = scenarioId === 'complex-combat'
        ? { 'ai-1': 'Left Defender', 'ai-2': 'Middle Defender', 'ai-3': 'Right Defender' }
        : {
            'ai-1': scenarioId === 'storm-grapeshot'
              ? 'Storm QA Opponent'
              : scenarioId === 'token-stack'
              ? 'Token QA Opponent'
              : scenarioId === 'land-entry-fetch'
              ? 'Fetch QA Opponent'
              : scenarioId === 'library-manipulation'
              ? 'Library QA Opponent'
              : scenarioId === 'modal-choice'
              ? 'Modal QA Opponent'
              : scenarioId === 'mulligan-selection'
              ? 'Mulligan QA Opponent'
              : scenarioId === 'equipment-d20'
              ? 'Equipment QA Opponent'
              : 'QA Opponent',
          };
      const now = Date.now();
      const snapshot: ShelectorGameSaveSnapshot = {
        version: 1,
        savedAt: now,
        engine,
        humanDeck: null,
        aiDecks: [],
        humanCommander,
        aiCommanderNames,
        humanId: 'human',
        aiIds: scenarioId === 'complex-combat' ? ['ai-1', 'ai-2', 'ai-3'] : ['ai-1'],
        opponentInfo: null,
        chatMessages: [],
        gameLog: [],
        authorityUpdates: [],
        engineEventLog: [],
        engineEventLogSeeds: {},
        engineEventLogInitialState: engine,
        lastStateUpdate: null,
        currentPrompt: null,
        lastPlayedCard: null,
        mulliganPhase: scenarioId === 'mulligan-selection',
        mulliganCount: 0,
        mulliganBottomSelectionActive: false,
        selectedMulliganCardIds: [],
        selectedMulliganBottomIds: [],
        discardPhase: false,
        discardCount: 0,
        tutorPhase: false,
        tutorCards: [],
        tutorTitle: '',
        tutorPromptRequest: null,
        tutorRemaining: 0,
        tutorFilter: undefined,
        tutorFilterSpec: undefined,
        tutorTapped: false,
        tutorShuffle: true,
        tutorDestination: 'hand',
        tutorSourceName: scenario.title,
        tutorSourceInstanceId: undefined,
        pendingSearchEntryChoice: null,
        pendingTargetChoice: null,
        libraryChoice: null,
        libraryManipulationPromptRequest: null,
        optionalTriggerChoice: null,
        taxPaymentChoice: null,
        wardPaymentChoice: null,
        damageAssignmentChoice: null,
        triggerOrderChoice: null,
        undosRemaining: 10,
        coachMode: true,
        newPlayerMode: false,
        holdPriority: false,
        priorityStops,
        actionError: null,
        lastEvents: [],
        endGame: { open: false, kind: 'loss' },
      };
      const restored = restoreGameSave(snapshot);
      if (!restored) {
        throw new Error(`Could not restore ${scenario.title}.`);
      }
      setSelectedPracticePresetId(null);
      setImportResult(null);
      setSpawnedOpponents([]);
      setShowReview(false);
      setActiveDrillRun(null);
      setStep('game');
      setSavePanelOpen(false);
      setSaveStatus(`Loaded Scenario Lab: ${scenario.title}. Bookmark the decision or save it into a slot when this is the spot you want to drill.`);
      return true;
    } catch (err: any) {
      setSaveError(err.message || 'Could not load that training scenario.');
      return false;
    } finally {
      setIsImporting(false);
    }
  };

  const handleRestartPresetRep = async (deck: BeginnerDeck) => {
    const restartOpponentCount = opponentCount;
    const restartSpawnMode = spawnMode;
    const restartSpawnBracket = spawnBracket || deck.bracket;
    const restartColorFilter = { ...colorFilter };
    const restartPersonality = personality;

    newGame();
    setStarterDeckLoadingId(deck.id);
    setIsImporting(true);
    setIsSpawning(true);
    setIsGeneratingAIDeck(false);
    setImportError(null);
    setSaveError(null);
    setSaveStatus(null);
    setActiveDrillRun(null);
    setShowReview(false);
    setSelectedPracticePresetId(deck.id);
    setDeckText(deck.decklist);
    setImportTab('text');
    setNewPlayerMode(deck.audience !== 'practice');
    setCoachMode(true);
    setOpponentCount(restartOpponentCount);
    setSpawnMode(restartSpawnMode);
    setSpawnBracket(restartSpawnBracket);
    setColorFilter(restartColorFilter);
    setPersonality(restartPersonality);
    setSpawnedOpponents([]);
    setSpawnProgress(`Reloading ${deck.name}...`);

    try {
      const importRes = await fetch(shelectorApiUrl('/import-deck'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decklist_text: deck.decklist,
          bracket: deck.bracket,
          fill_missing: true,
        }),
      });
      if (!importRes.ok) throw new Error(`Preset import failed (${importRes.status})`);
      const data: DeckImportResult = await importRes.json();
      setImportResult(data);
      if (!data.valid) {
        throw new Error(data.errors[0] || `${deck.name} did not import as a valid Commander deck.`);
      }

      if (data.commander) {
        addToDeckHistory(data.commander, deck.decklist);
        cacheSet('last_deck_text', deck.decklist, 30 * 24 * 60 * 60 * 1000);
        cacheSet('last_deck_result', data, 30 * 24 * 60 * 60 * 1000);
      }

      const humanCommander = data.commander || '';
      const humanCommanderFace = humanCommander.split(' // ')[0]?.trim();
      const humanCommanderData = data.card_data[humanCommander]
        || (humanCommanderFace ? data.card_data[humanCommanderFace] : undefined);
      const avoidColors = Object.entries(restartColorFilter)
        .filter(([, value]) => value)
        .map(([color]) => color);
      const opponents: SpawnedOpponent[] = [];
      const aiDecks: ImportedCards[] = [];
      const usedCommanders = new Set<string>();

      for (let i = 0; i < restartOpponentCount; i++) {
        let opponent: SpawnedOpponent | null = null;
        let aiDeck: AIDeckResponse | null = null;

        for (let attempt = 0; attempt < 6; attempt++) {
          setSpawnProgress(`Picking opponent ${i + 1}/${restartOpponentCount}...`);
          const spawnRes = await fetch(shelectorApiUrl('/spawn-opponent'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mode: restartSpawnMode,
              bracket: restartSpawnBracket,
              avoid_colors: avoidColors,
              human_commander: humanCommander || null,
              human_colors: humanCommanderData?.color_identity || [],
              personality: restartPersonality,
            }),
          });
          if (!spawnRes.ok) throw new Error(`Failed to spawn opponent (${spawnRes.status})`);
          const candidate: SpawnedOpponent = {
            ...(await spawnRes.json()),
            personality: restartPersonality,
          };
          const key = candidate.commander.toLowerCase();
          if (usedCommanders.has(key) && attempt < 5) continue;

          setIsGeneratingAIDeck(true);
          setSpawnProgress(`Building ${candidate.commander} (${i + 1}/${restartOpponentCount})...`);
          const aiRes = await fetch(shelectorApiUrl('/generate-ai-deck'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              commander: candidate.commander,
              bracket: restartSpawnBracket,
            }),
          });
          if (!aiRes.ok) {
            if (attempt === 5) {
              throw new Error(`Failed to generate AI deck (${aiRes.status})`);
            }
            continue;
          }

          opponent = candidate;
          aiDeck = await aiRes.json() as AIDeckResponse;
          usedCommanders.add(key);
          break;
        }

        if (!opponent || !aiDeck) throw new Error('Failed to prepare an opponent');
        opponents.push(opponent);
        setSpawnedOpponents([...opponents]);
        aiDecks.push({
          commander: aiDeck.commander,
          cards: aiDeck.cards,
          lands: aiDeck.lands,
          cardData: aiDeck.card_data,
        });
      }

      const unsupported = findUnsupportedEngineCards([
        {
          label: deck.name,
          commander: humanCommander,
          cards: data.cards,
          lands: data.lands,
          sideboard: data.sideboard || [],
        },
        ...aiDecks.map((aiDeck, index) => ({
          label: `Shelector AI ${index + 1}`,
          commander: aiDeck.commander,
          cards: aiDeck.cards,
          lands: aiDeck.lands,
          sideboard: [],
        })),
      ]);
      if (unsupported.length > 0) {
        throw new Error(formatUnsupportedEngineCards(unsupported));
      }

      const started = startGame(
        {
          commander: humanCommander,
          cards: data.cards,
          lands: data.lands,
          sideboard: data.sideboard || [],
          cardData: data.card_data,
        },
        aiDecks,
        { aiDifficulty: restartSpawnBracket, startingLife },
      );
      if (!started) {
        throw new Error('Failed to initialize the repeated practice game.');
      }

      setStep('game');
      setSaveStatus(`Repeated ${deck.name}: ${restartOpponentCount + 1} players, ${restartPersonality} Shelector, coach mode on.`);
    } catch (err: any) {
      setImportError(err.message || 'Failed to repeat this preset rep.');
      setStep('import');
    } finally {
      setIsImporting(false);
      setIsSpawning(false);
      setIsGeneratingAIDeck(false);
      setStarterDeckLoadingId(null);
      setSpawnProgress('');
    }
  };

  const handleSpawnAndStart = async () => {
    if (!importResult?.valid) return;
    setIsSpawning(true);
    setIsGeneratingAIDeck(false);
    setImportError(null);
    setActiveDrillRun(null);
    setSpawnedOpponents([]);
    setSpawnProgress('');
    try {
      const avoidColors = Object.entries(colorFilter)
        .filter(([, v]) => v)
        .map(([k]) => k);
      const humanCommander = importResult.commander || '';
      const humanCommanderFace = humanCommander.split(' // ')[0]?.trim();
      const humanCommanderData = importResult.card_data[humanCommander]
        || (humanCommanderFace ? importResult.card_data[humanCommanderFace] : undefined);

      const opponents: SpawnedOpponent[] = [];
      const aiDecks: ImportedCards[] = [];
      const usedCommanders = new Set<string>();

      for (let i = 0; i < opponentCount; i++) {
        let opponent: SpawnedOpponent | null = null;
        let aiDeck: AIDeckResponse | null = null;

        for (let attempt = 0; attempt < 6; attempt++) {
          setSpawnProgress(`Picking opponent ${i + 1}/${opponentCount}...`);
          const spawnRes = await fetch(shelectorApiUrl('/spawn-opponent'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mode: spawnMode,
              bracket: spawnBracket,
              avoid_colors: avoidColors,
              human_commander: humanCommander || null,
              human_colors: humanCommanderData?.color_identity || [],
            }),
          });
          if (!spawnRes.ok) throw new Error(`Failed to spawn opponent (${spawnRes.status})`);
          const candidate: SpawnedOpponent = await spawnRes.json();
          const key = candidate.commander.toLowerCase();
          if (usedCommanders.has(key) && attempt < 5) {
            continue;
          }

          setIsGeneratingAIDeck(true);
          setSpawnProgress(`Building ${candidate.commander} (${i + 1}/${opponentCount})...`);
          const aiRes = await fetch(shelectorApiUrl('/generate-ai-deck'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              commander: candidate.commander,
              bracket: spawnBracket,
            }),
          });
          if (!aiRes.ok) {
            if (attempt === 5) {
              throw new Error(`Failed to generate AI deck (${aiRes.status})`);
            }
            continue;
          }

          opponent = candidate;
          aiDeck = await aiRes.json() as AIDeckResponse;
          usedCommanders.add(key);
          break;
        }

        if (!opponent || !aiDeck) throw new Error('Failed to prepare an opponent');
        opponents.push(opponent);
        setSpawnedOpponents([...opponents]);

        aiDecks.push({
          commander: aiDeck.commander,
          cards: aiDeck.cards,
          lands: aiDeck.lands,
          cardData: aiDeck.card_data,
        });
      }

      const unsupported = findUnsupportedEngineCards([
        {
          label: 'Your deck',
          commander: humanCommander,
          cards: importResult.cards,
          lands: importResult.lands,
          sideboard: importResult.sideboard || [],
        },
        ...aiDecks.map((deck, index) => ({
          label: `Shelector AI ${index + 1}`,
          commander: deck.commander,
          cards: deck.cards,
          lands: deck.lands,
          sideboard: [],
        })),
      ]);
      if (unsupported.length > 0) {
        setImportError(formatUnsupportedEngineCards(unsupported));
        return;
      }
      const started = startGame(
        {
          commander: humanCommander,
          cards: importResult.cards,
          lands: importResult.lands,
          sideboard: importResult.sideboard || [],
          cardData: importResult.card_data,
        },
        aiDecks,
        { startingLife }
      );
      if (started) {
        setStep('game');
      } else {
        setImportError('Failed to initialize game. Re-import the deck so commander card data is included.');
      }
    } catch (err: any) {
      setImportError(err.message || 'Failed to start game');
    } finally {
      setIsSpawning(false);
      setIsGeneratingAIDeck(false);
      setSpawnProgress('');
    }
  };

  const handleStartDraftMatch = (humanDeck: ImportedCards, aiDecks: ImportedCards[]) => {
    setActiveDrillRun(null);
    const started = startGame(humanDeck, aiDecks, {
      format: 'limited',
      startingLife: 20,
      startingHandSize: 7,
      aiDifficulty: 2,
    });
    if (started) setStep('game');
  };

  const handleStartStandardMatch = (humanDeck: ImportedCards, aiDecks: ImportedCards[]) => {
    setActiveDrillRun(null);
    const started = startGame(humanDeck, aiDecks, {
      format: 'limited',
      startingLife: 20,
      startingHandSize: 7,
      aiDifficulty: 2,
    });
    if (started) setStep('game');
  };

  const inGameCoachingEnabled = false;
  const branchPreviews = useMemo(() => {
    if (!inGameCoachingEnabled || step !== 'game' || !gameState) return [];
    const snapshot = exportGameSave();
    return buildPracticeBranchPreviews({
      serializedState: snapshot?.engine,
      playerId: snapshot?.humanId || gameState.humanPlayer.id,
      legalActions,
      max: 4,
    });
  }, [step, gameState, legalActions, exportGameSave]);

  const loadBranchPreviewAsDrill = async (actionId: string) => {
    const preview = branchPreviews.find(candidate => candidate.actionId === actionId);
    if (!preview?.resultEngine) {
      setSaveError('That branch preview does not have a restorable engine state.');
      return false;
    }
    const snapshot = exportGameSave();
    if (!snapshot || !gameState) {
      setSaveError('No active game to branch from.');
      return false;
    }
    const existing = saveSlotsRef.current[activeSaveSlot - 1];
    const savedAt = Date.now();
    const bookmarkId = `${savedAt}-${Math.random().toString(36).slice(2, 8)}`;
    const attemptId = `${savedAt + 1}-${Math.random().toString(36).slice(2, 8)}`;
    const label = `T${gameState.turnNumber} ${gameState.step || gameState.phase} branch`;
    const attempt: PlayDrillAttempt = {
      id: attemptId,
      label: `Preview: ${preview.label}`,
      startedAt: savedAt,
      savedAt,
      turnNumber: gameState.turnNumber,
      phase: gameState.phase,
      step: gameState.step,
      summary: `${preview.summary} / ${summarizePracticeDecisionContext()}`,
      engine: preview.resultEngine,
      decisionContext: currentDrillDecisionContext(snapshot),
    };
    const bookmark: PlayDrillBookmark = {
      id: bookmarkId,
      label,
      savedAt,
      turnNumber: gameState.turnNumber,
      phase: gameState.phase,
      step: gameState.step,
      engine: snapshot.engine,
      source: 'branch-preview',
      focusTags: resolvePracticeMetadata()?.focusTags || [],
      note: `Branch source: ${preview.label} / ${summarizePracticeDecisionContext()}`,
      decisionContext: currentDrillDecisionContext(snapshot),
      attempts: [attempt],
    };
    const drillBookmarks = [...(existing?.drillBookmarks || []), bookmark].slice(-16);

    try {
      const record = buildSaveRecord(activeSaveSlot, snapshot, false, drillBookmarks);
      await putPlaySaveSlot(record);
      applySaveSlotRecord(record, activeSaveSlot);
      await refreshSaveSlots();
      const drillSnapshot = buildDrillRestoreSnapshot(snapshot, preview.resultEngine, `Branch Preview: ${preview.label}`);
      const restored = restoreGameSave(drillSnapshot);
      if (!restored) {
        setSaveError(`Branch preview "${preview.label}" could not be restored.`);
        return false;
      }
      restoreSlotUi(record);
      setActiveDrillRun({
        slot: activeSaveSlot,
        bookmarkId,
        label: `${label} / ${attempt.label}`,
        startedAt: Date.now(),
      });
      setSaveError(null);
      setSaveStatus(`Loaded branch drill "${preview.label}".`);
      return true;
    } catch (err: any) {
      setSaveError(err.message || 'Could not load this preview as a drill.');
      return false;
    }
  };

  // ----- RENDER -----

  // Game view: floating-table board with review available as an overlay.
  if (step === 'game' && gameState) {
    const activePracticeDeck = PRESET_DECKS.find(deck => deck.id === selectedPracticePresetId);
    const activePracticeFocusTags = activePracticeDeck?.focusTags || resolvePracticeMetadata()?.focusTags || [];
    return (
      <div className={FLOATING_TABLE_LAYOUT.shell}>
        {savePanelOpen && (
          <>
            <button
              type="button"
              className="fixed inset-0 z-[60] cursor-default bg-black/30"
              aria-label="Close save slots"
              onClick={() => setSavePanelOpen(false)}
            />
            <div className="fixed left-2 right-2 top-14 z-[75] max-h-[calc(100vh-4rem)] overflow-y-auto md:left-auto md:right-4 md:top-16 md:w-[24rem]">
              {renderSaveSlots(true)}
            </div>
          </>
        )}

        <div className={FLOATING_TABLE_LAYOUT.board}>
          {useNewPlayUi ? (
            <PlayExperience
              gameState={gameState}
              legalActions={legalActions}
              isHumanTurn={isHumanTurn}
              winner={winner}
              onAction={submitAction}
              targetingPrompt={targetingPrompt}
              onCancelTargeting={cancelTargeting}
              currentPrompt={currentPrompt}
              chatMessages={chatMessages}
              damageAssignmentChoice={damageAssignmentChoice}
              newPlayerMode={inGameCoachingEnabled ? newPlayerMode : false}
              prompts={{
                mulligan: {
                  phase: mulliganPhase,
                  count: mulliganCount,
                  bottomCount: mulliganBottomCount,
                  selectedCardIds: selectedMulliganCardIds,
                  selectedBottomIds: selectedMulliganBottomIds,
                  onKeep: keepHand,
                  onMulligan: mulligan,
                  onToggleCard: toggleMulliganCard,
                  onToggleBottom: toggleMulliganBottomCard,
                },
                discard: { phase: discardPhase, count: discardCount, onDiscard: discardCard },
                tutor: {
                  phase: tutorPhase,
                  cards: tutorCards,
                  title: tutorTitle,
                  onPick: resolveTutor,
                  onCancel: cancelTutor,
                },
                library: { choice: libraryChoice, onResolve: resolveLibraryChoice },
                optionalTrigger: { choice: optionalTriggerChoice, onResolve: resolveOptionalTriggerChoice },
                tax: { choice: taxPaymentChoice, onResolve: resolveTaxPaymentChoice },
                ward: { choice: wardPaymentChoice, onResolve: resolveWardPaymentChoice },
                damageAssignment: { choice: damageAssignmentChoice, onResolve: resolveDamageAssignmentChoice },
                triggerOrder: { choice: triggerOrderChoice, onResolve: resolveTriggerOrderChoice },
                actionError,
                onClearActionError: clearActionError,
              }}
            />
          ) : (
          <GameBoard
            gameState={gameState}
            legalActions={legalActions}
            isHumanTurn={isHumanTurn}
            isLoading={isLoading}
            onAction={submitAction}
            mulliganPhase={mulliganPhase}
            mulliganCount={mulliganCount}
            mulliganBottomCount={mulliganBottomCount}
            selectedMulliganCardIds={selectedMulliganCardIds}
            selectedMulliganBottomIds={selectedMulliganBottomIds}
            onKeepHand={keepHand}
            onMulligan={mulligan}
            onToggleMulliganCard={toggleMulliganCard}
            onToggleMulliganBottom={toggleMulliganBottomCard}
            discardPhase={discardPhase}
            discardCount={discardCount}
            onDiscardCard={discardCard}
            tutorPhase={tutorPhase}
            tutorCards={tutorCards}
            tutorTitle={tutorTitle}
            onTutorPick={resolveTutor}
            onTutorCancel={cancelTutor}
            targetingPrompt={targetingPrompt}
            onCancelTargeting={cancelTargeting}
            libraryChoice={libraryChoice}
            onResolveLibraryChoice={resolveLibraryChoice}
            optionalTriggerChoice={optionalTriggerChoice}
            onResolveOptionalTrigger={resolveOptionalTriggerChoice}
            taxPaymentChoice={taxPaymentChoice}
            onResolveTaxPayment={resolveTaxPaymentChoice}
            wardPaymentChoice={wardPaymentChoice}
            onResolveWardPayment={resolveWardPaymentChoice}
            damageAssignmentChoice={damageAssignmentChoice}
            onResolveDamageAssignment={resolveDamageAssignmentChoice}
            triggerOrderChoice={triggerOrderChoice}
            onResolveTriggerOrder={resolveTriggerOrderChoice}
            undosRemaining={undosRemaining}
            onUndo={undoAction}
            coachMode={inGameCoachingEnabled ? coachMode : false}
            onToggleCoach={inGameCoachingEnabled ? setCoachMode : undefined}
            newPlayerMode={inGameCoachingEnabled ? newPlayerMode : false}
            onToggleNewPlayerMode={inGameCoachingEnabled ? setNewPlayerMode : undefined}
            holdPriority={holdPriority}
            onToggleHoldPriority={setHoldPriority}
            priorityStops={priorityStops}
            onTogglePriorityStop={setPriorityStop}
            onSetAllPriorityStops={setAllPriorityStops}
            collapseModeControlsOnMobile
            onUntapMana={untapManaSource}
            onAdjustCounters={adjustCounters}
            onAdjustPlayerCounter={adjustPlayerCounter}
            onAdjustCommanderDamage={adjustCommanderDamage}
            onMoveCard={moveCardManually}
            onAdjustDamage={adjustDamage}
            onCreateToken={createManualToken}
            onAttachCard={attachCardManually}
            onSetPhaseStep={setPhaseStepManually}
            untappableCardIds={untappableCardIds}
            lastPlayedCard={lastPlayedCard}
            authorityUpdates={authorityUpdates}
            lastStateUpdate={lastStateUpdate}
            currentPrompt={currentPrompt}
            actionError={actionError}
            onClearActionError={clearActionError}
            onBookmarkDrill={inGameCoachingEnabled ? bookmarkCurrentDrill : undefined}
            drillBookmarkLabel="Bookmark This Moment"
            practiceFocusTags={inGameCoachingEnabled ? activePracticeFocusTags : []}
            branchPreviews={inGameCoachingEnabled ? branchPreviews : []}
            onLoadBranchPreview={inGameCoachingEnabled ? loadBranchPreviewAsDrill : undefined}
            activeDrillLabel={inGameCoachingEnabled ? activeDrillRun?.label || null : null}
            onSaveDrillAttempt={inGameCoachingEnabled && activeDrillRun ? saveCurrentDrillAttempt : undefined}
            onExitDrillAttempt={inGameCoachingEnabled && activeDrillRun ? exitCurrentDrillAttempt : undefined}
            menuActions={[
              {
                id: 'saves',
                label: 'Saves',
                detail: `Slot ${activeSaveSlot}`,
                onSelect: () => setSavePanelOpen(prev => !prev),
              },
              {
                id: 'review',
                label: 'Review',
                onSelect: () => setShowReview(true),
              },
              ...(activePracticeDeck
                ? [{
                    id: 'repeat-current-preset',
                    label: 'Repeat Current Rep',
                    detail: `${activePracticeDeck.name} / ${personality}`,
                    onSelect: () => {
                      setSavePanelOpen(false);
                      handleRestartPresetRep(activePracticeDeck);
                    },
                  }]
                : []),
              ...(activePracticeDeck?.id === 'practice-xenagos-dragons'
                ? [{
                    id: 'restart-focused-xenagos',
                    label: 'Restart Focused Rep',
                    detail: 'Xenagos / Aggressive Shelector',
                    onSelect: () => {
                      setSavePanelOpen(false);
                      handleStartFocusedXenagosRep();
                    },
                  }]
                : []),
            ]}
          />
          )}
        </div>

        {/* Review modal */}
        {showReview && (
          <GameReview
            gameLog={gameLog}
            finalState={gameState}
            winner={winner}
            authorityUpdates={authorityUpdates}
            engineEventLog={engineEventLog}
            engineEventLogSeeds={engineEventLogSeeds}
            engineEventLogInitialState={engineEventLogInitialState}
            onDrillEntry={loadReviewEntryAsDrill}
            onClose={() => setShowReview(false)}
          />
        )}

        {/* End-game modal (win / loss / possible loop) */}
        <EndGameModal
          open={endGame.open}
          kind={endGame.kind}
          reason={endGame.reason}
          loopSources={endGame.loopSources}
          onPlayItOut={playItOut}
          onDeclareDraw={declareDraw}
          onConcede={concedeGame}
          onNewGame={newGame}
          onReviewLog={() => { reviewLog(); setShowReview(true); }}
          onClose={closeEndGame}
        />
      </div>
    );
  }

  if (step === 'draft') {
    return (
      <div className="min-h-screen bg-stone-900 p-4 text-stone-100">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8 flex items-center gap-3">
            <Link to="/" className="text-stone-400 hover:text-stone-200">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-2xl font-bold">Play Practice Game</h1>
          </div>
          <DraftTournament
            onBack={() => setStep(importResult?.valid ? 'opponent' : 'import')}
            onStartMatch={handleStartDraftMatch}
          />
        </div>
      </div>
    );
  }

  if (step === 'standard') {
    return (
      <div className="min-h-screen bg-stone-900 p-4 text-stone-100">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 flex items-center gap-3">
            <Link to="/" className="text-stone-400 hover:text-stone-200">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-2xl font-bold">Play a Game</h1>
          </div>
          <StandardTournament
            initialDeckText={standardDeckText}
            onBack={() => setStep(importResult?.valid ? 'opponent' : 'import')}
            onStartMatch={handleStartStandardMatch}
          />
        </div>
      </div>
    );
  }

  // Pre-game view
  return (
    <div className="min-h-screen bg-stone-900 text-stone-100 p-4">
      {showGuidedPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
          <div
            className="relative mx-auto overflow-hidden rounded-xl border border-amber-500/35 bg-stone-950 p-5 shadow-2xl shadow-black/50"
            style={{ width: 'min(24rem, calc(100vw - 2rem))' }}
          >
            <button
              type="button"
              onClick={closeGuidedPrompt}
              className="absolute right-3 top-3 rounded p-1 text-stone-500 transition-colors hover:bg-stone-800 hover:text-stone-200"
              aria-label="Close guided practice prompt"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500 text-stone-950">
              <Lightbulb className="h-5 w-5" />
            </div>
            <h2 className="mb-2 text-xl font-black text-stone-50">Want a guided practice game?</h2>
            <p className="mb-4 text-sm leading-6 text-stone-300">
              Guide mode suggests one available practice action at a time. Starter decks keep the first match simple.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={startGuidedFirstGame}
                className="min-h-[44px] rounded-lg bg-amber-500 px-4 py-2 text-sm font-black text-stone-950 transition-colors hover:bg-amber-400"
              >
                Use Guide
              </button>
              <button
                type="button"
                onClick={closeGuidedPrompt}
                className="min-h-[44px] rounded-lg border border-stone-700 bg-stone-900 px-4 py-2 text-sm font-bold text-stone-200 transition-colors hover:bg-stone-800"
              >
                Bring My Deck
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Link to="/" className="text-stone-400 hover:text-stone-200">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-2xl font-bold">Play Practice Game</h1>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <div className="min-w-0 space-y-4">

        {/* Step 1: Import */}
        <div className="bg-stone-800 rounded-xl border border-stone-700 p-4 sm:p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <ClipboardPaste className="w-5 h-5 text-amber-400" />
            Import Your Deck
          </h2>

          {/* Tabs */}
          <div className="flex gap-2 mb-4 flex-wrap">
            <button
              onClick={() => setImportTab('url')}
              className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors min-h-[44px] ${
                importTab === 'url'
                  ? 'bg-amber-600 text-white'
                  : 'bg-stone-700 text-stone-300 hover:bg-stone-600'
              }`}
            >
              <LinkIcon className="w-4 h-4 inline mr-1" />
              Paste URL
            </button>
            <button
              onClick={() => setImportTab('text')}
              className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors min-h-[44px] ${
                importTab === 'text'
                  ? 'bg-amber-600 text-white'
                  : 'bg-stone-700 text-stone-300 hover:bg-stone-600'
              }`}
            >
              <ClipboardPaste className="w-4 h-4 inline mr-1" />
              Paste Decklist
            </button>

            {/* Deck history */}
            {deckHistory.length > 0 && (
              <button
                onClick={() => setShowDeckHistory(!showDeckHistory)}
                className="ml-auto px-3 py-2.5 rounded-lg text-sm bg-stone-700 text-stone-300 hover:bg-stone-600 min-h-[44px]"
              >
                <History className="w-4 h-4 inline mr-1" />
                Recent
              </button>
            )}
          </div>

          <div className="mb-4 flex justify-end">
            <button
              type="button"
              onClick={() => setShowPracticeTools(value => !value)}
              className="min-h-10 rounded-lg border border-stone-700 bg-stone-900 px-3 text-xs font-black text-stone-200 transition-colors hover:bg-stone-700"
              aria-expanded={showPracticeTools}
            >
              {showPracticeTools ? 'Hide Drills & Presets' : 'Drills & Presets'}
            </button>
          </div>

          {showPracticeTools && (
            <>
          <div className="mb-4 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              disabled
              title="Events are planned for a future release"
              className="flex min-h-[44px] w-full cursor-not-allowed items-center justify-center gap-2 rounded-lg border border-stone-700 bg-stone-800/60 px-4 py-2.5 text-sm font-bold text-stone-400"
            >
              <Trophy className="h-4 w-4" />
              Standard Event · Future Release
            </button>
            <button
              type="button"
              disabled
              title="Events are planned for a future release"
              className="flex min-h-[44px] w-full cursor-not-allowed items-center justify-center gap-2 rounded-lg border border-stone-700 bg-stone-800/60 px-4 py-2.5 text-sm font-bold text-stone-400"
            >
              <Users className="h-4 w-4" />
              Draft Event · Future Release
            </button>
          </div>

          <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-950/20">
            <div className="border-b border-amber-500/20 px-3 py-2">
              <div className="flex items-center gap-2 text-sm font-bold text-amber-100">
                <Trophy className="h-4 w-4" />
                High-Power Practice Presets
              </div>
              <p className="mt-1 text-xs text-amber-100/70">
                Saved decklists with coaching focus and autosave metadata for repeat reps.
              </p>
            </div>
            <div className="border-b border-amber-500/15 p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => handleStartFocusedXenagosRep()}
                  disabled={isImporting || isSpawning || isGeneratingAIDeck}
                  className="flex w-full min-h-[52px] items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-3 text-sm font-black text-stone-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-stone-700 disabled:text-stone-400"
                >
                  {isImporting || isSpawning || isGeneratingAIDeck ? (
                    <><Loader2 className="h-4 w-4 animate-spin" />Starting Rep</>
                  ) : (
                    <><Rocket className="h-4 w-4" />Start Clean Xenagos Rep</>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleStartXenagosMulliganDrill}
                  disabled={isImporting || isSpawning || isGeneratingAIDeck}
                  className="flex w-full min-h-[52px] items-center justify-center gap-2 rounded-lg border border-amber-500/55 bg-stone-950 px-4 py-3 text-sm font-black text-amber-100 transition-colors hover:bg-amber-950/35 disabled:cursor-not-allowed disabled:border-stone-700 disabled:bg-stone-800 disabled:text-stone-500"
                >
                  {isImporting || isSpawning || isGeneratingAIDeck ? (
                    <><Loader2 className="h-4 w-4 animate-spin" />Starting Drill</>
                  ) : (
                    <><Shield className="h-4 w-4" />Mulligan Drill</>
                  )}
                </button>
              </div>
              <p className="mt-2 text-[11px] leading-5 text-amber-100/65">
                Loads Xenagos, clears the current table, sets Aggressive Shelector, enables coach mode, and opens either a full rep or a focused opening-hand drill.
              </p>
            </div>
            {renderScenarioLab(true)}
            <div className="divide-y divide-amber-500/15">
              {PRACTICE_DECKS.map(deck => (
                <button
                  key={deck.id}
                  type="button"
                  onClick={() => handleSelectBeginnerDeck(deck)}
                  disabled={isImporting}
                  className="flex w-full flex-col gap-3 px-3 py-3 text-left transition-colors hover:bg-amber-900/20 disabled:cursor-not-allowed disabled:opacity-60 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="min-w-0">
                    <span className="mb-1 flex flex-wrap items-center gap-1.5">
                      <span className="font-bold text-stone-100">{deck.name}</span>
                      {deck.colors.map(color => (
                        <span
                          key={color}
                          className={`rounded-full px-2 py-0.5 text-[10px] font-black ${COLOR_BADGES[color]}`}
                        >
                          {color}
                        </span>
                      ))}
                      <span className="rounded bg-amber-400 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-stone-950">
                        Bracket {deck.bracket}
                      </span>
                    </span>
                    <span className="block truncate text-xs font-semibold text-stone-300">
                      {deck.commander}
                    </span>
                    <span className="block text-xs leading-5 text-stone-400">
                      {deck.plan}
                    </span>
                    {deck.focusTags && (
                      <span className="mt-2 flex flex-wrap gap-1">
                        {deck.focusTags.map(tag => (
                          <span key={tag} className="rounded border border-amber-500/30 px-1.5 py-0.5 text-[10px] font-bold text-amber-100">
                            {tag}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                  <span className="flex min-h-8 shrink-0 items-center justify-center rounded bg-amber-500 px-3 py-1 text-xs font-black text-stone-950">
                    {starterDeckLoadingId === deck.id ? (
                      <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Loading</>
                    ) : (
                      'Use Preset'
                    )}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div
            ref={starterDecksRef}
            className={`mb-4 rounded-lg border bg-stone-900/50 transition-colors ${
              starterDeckSpotlight
                ? 'border-amber-400 shadow-lg shadow-amber-950/40'
                : 'border-stone-700'
            }`}
          >
            <div className="flex items-center justify-between gap-3 border-b border-stone-700 px-3 py-2">
              <div className="flex items-center gap-2 text-sm font-bold text-amber-200">
                <Lightbulb className="h-4 w-4" />
                Beginner Starter Decks
              </div>
              {newPlayerMode && (
                <span className="rounded bg-amber-500 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-stone-950">
                  Guide On
                </span>
              )}
            </div>
            <div className="divide-y divide-stone-800">
              {BEGINNER_DECKS.map(deck => (
                <button
                  key={deck.id}
                  type="button"
                  onClick={() => handleSelectBeginnerDeck(deck)}
                  disabled={isImporting}
                  className="flex w-full flex-col gap-2 px-3 py-3 text-left transition-colors hover:bg-stone-800/70 disabled:cursor-not-allowed disabled:opacity-60 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="min-w-0">
                    <span className="mb-1 flex flex-wrap items-center gap-1.5">
                      <span className="font-bold text-stone-100">{deck.name}</span>
                      {deck.colors.map(color => (
                        <span
                          key={color}
                          className={`rounded-full px-2 py-0.5 text-[10px] font-black ${COLOR_BADGES[color]}`}
                        >
                          {color}
                        </span>
                      ))}
                    </span>
                    <span className="block truncate text-xs font-semibold text-stone-400">
                      {deck.commander}
                    </span>
                    <span className="block text-xs leading-5 text-stone-500">
                      {deck.plan}
                    </span>
                  </span>
                  <span className="flex min-h-8 shrink-0 items-center justify-center rounded bg-stone-700 px-3 py-1 text-xs font-black text-stone-100">
                    {starterDeckLoadingId === deck.id ? (
                      <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Loading</>
                    ) : (
                      'Use Deck'
                    )}
                  </span>
                </button>
              ))}
            </div>
          </div>
            </>
          )}

          {/* History dropdown */}
          {showDeckHistory && (
            <div className="mb-4 bg-stone-700/50 rounded-lg p-3 space-y-2">
              {deckHistory.map(entry => (
                <div key={entry.commander} className="flex items-center justify-between">
                  <button
                    onClick={() => {
                      setDeckText(entry.text);
                      setImportTab('text');
                      setSelectedPracticePresetId(null);
                      setShowDeckHistory(false);
                    }}
                    className="text-sm text-stone-200 hover:text-amber-300"
                  >
                    {entry.commander}
                  </button>
                  <button
                    onClick={() => {
                      setDeckHistory(prev => {
                        const updated = prev.filter(e => e.commander !== entry.commander);
                        cacheSet('deck_history', updated, 30 * 24 * 60 * 60 * 1000);
                        return updated;
                      });
                    }}
                    className="text-stone-500 hover:text-red-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* URL input */}
          {importTab === 'url' && (
            <div>
              <input
                type="text"
                value={deckUrl}
                onChange={e => {
                  setDeckUrl(e.target.value);
                  setSelectedPracticePresetId(null);
                }}
                placeholder="https://www.moxfield.com/decks/..."
                className="w-full bg-stone-700 border border-stone-600 rounded-lg px-4 py-3 text-stone-100 placeholder-stone-500 focus:outline-none focus:border-amber-500 mb-3"
              />
              <p className="text-xs text-stone-500 mb-3">
                Supports Moxfield, Archidekt, TappedOut, and MTGGoldfish
              </p>
              <label className="mb-3 flex items-start gap-3 rounded-lg border border-stone-700 bg-stone-900/45 p-3 text-sm text-stone-300">
                <input
                  type="checkbox"
                  checked={fillMissingCards}
                  onChange={e => setFillMissingCards(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-stone-500 bg-stone-800 text-amber-500 focus:ring-amber-500"
                />
                <span>
                  <span className="block font-medium text-stone-100">Fill missing cards with practice-safe suggestions</span>
                  <span className="text-xs text-stone-500">Off keeps imported lists exact. Turn this on only when a source is short and you want a playable practice deck.</span>
                </span>
              </label>
              <button
                onClick={handleImportFromUrl}
                disabled={isImporting || !deckUrl.trim()}
                className="px-6 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:bg-stone-600 disabled:text-stone-400 rounded-lg font-medium transition-colors"
              >
                {isImporting ? (
                  <><Loader2 className="w-4 h-4 inline mr-2 animate-spin" />Importing...</>
                ) : (
                  'Import Deck'
                )}
              </button>
            </div>
          )}

          {/* Text input */}
          {importTab === 'text' && (
            <div>
              <textarea
                value={deckText}
                onChange={e => {
                  setDeckText(e.target.value);
                  setSelectedPracticePresetId(null);
                }}
                placeholder={"1 Atraxa, Praetors' Voice\n1 Sol Ring\n1 Command Tower\n..."}
                rows={8}
                className="w-full bg-stone-700 border border-stone-600 rounded-lg px-4 py-3 text-stone-100 placeholder-stone-500 focus:outline-none focus:border-amber-500 mb-3 font-mono text-sm"
              />
              <label className="mb-3 flex items-start gap-3 rounded-lg border border-stone-700 bg-stone-900/45 p-3 text-sm text-stone-300">
                <input
                  type="checkbox"
                  checked={fillMissingCards}
                  onChange={e => setFillMissingCards(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-stone-500 bg-stone-800 text-amber-500 focus:ring-amber-500"
                />
                <span>
                  <span className="block font-medium text-stone-100">Fill missing cards with practice-safe suggestions</span>
                  <span className="text-xs text-stone-500">Off keeps pasted lists exact. Turn this on only when a source is short and you want a playable practice deck.</span>
                </span>
              </label>
              <button
                onClick={handleImportFromText}
                disabled={isImporting || !deckText.trim()}
                className="px-6 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:bg-stone-600 disabled:text-stone-400 rounded-lg font-medium transition-colors"
              >
                {isImporting ? (
                  <><Loader2 className="w-4 h-4 inline mr-2 animate-spin" />Importing...</>
                ) : (
                  'Import Deck'
                )}
              </button>
            </div>
          )}

          {/* Import errors */}
          {importError && (
            <div className="mt-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">
              {importError}
            </div>
          )}

          {/* Import results */}
          {importResult && (
            <div className="mt-4 p-4 bg-stone-700/50 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-amber-200">
                  {importResult.commander || 'Unknown Commander'}
                </span>
                <span className="text-sm text-stone-400">{importResult.total} cards</span>
              </div>
              {importResult.valid && importEngineReadiness && (
                <div
                  data-testid="partner-engine-readiness"
                  className={`mb-3 rounded-lg border p-3 text-xs ${
                    importEngineReadiness.unsupportedCards.length > 0
                      ? 'border-amber-600/50 bg-amber-950/30 text-amber-100'
                      : 'border-emerald-600/40 bg-emerald-950/30 text-emerald-100'
                  }`}
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2 font-black uppercase tracking-[0.14em]">
                        <Shield className="h-4 w-4" />
                        Engine preflight
                      </div>
                      <div className="mt-1 text-stone-200">
                        {importEngineReadiness.partnerCommanders.length > 1
                          ? `${importEngineReadiness.partnerCommanders.length} commanders detected for the command zone.`
                          : 'Single commander deck detected.'}
                      </div>
                    </div>
                    <div className="rounded bg-black/20 px-2 py-1 font-bold text-stone-100">
                      1v1 Engine Practice
                    </div>
                  </div>
                  {importEngineReadiness.partnerCommanders.length > 1 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {importEngineReadiness.partnerCommanders.map(name => (
                        <span key={name} className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-2 py-1 font-bold text-emerald-50">
                          {name}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 space-y-1 text-stone-300">
                    {importEngineReadiness.duplicateRepairApplied && (
                      <div>Duplicate singleton repair was applied before engine start.</div>
                    )}
                    {importEngineReadiness.filledCards.length > 0 && (
                      <div>Practice fill added {importEngineReadiness.filledCards.length} card{importEngineReadiness.filledCards.length === 1 ? '' : 's'} so the deck can start.</div>
                    )}
                    {importEngineReadiness.unsupportedCards.length === 0 ? (
                      <div>Current preflight did not flag manual-only cards for this import.</div>
                    ) : (
                      <div>{formatUnsupportedEngineCards(importEngineReadiness.unsupportedCards)}</div>
                    )}
                  </div>
                </div>
              )}
              {importResult.warnings.length > 0 && (
                <div className="text-xs text-amber-400 space-y-1">
                  {importResult.warnings.map((w, i) => <div key={i}>{w}</div>)}
                </div>
              )}
              {importResult.valid && missingImportedDeckSlots > 0 && (
                <div
                  data-testid="import-count-gate"
                  className="mt-3 rounded-lg border border-amber-600/50 bg-amber-950/35 p-3 text-xs text-amber-100"
                >
                  <div className="font-black uppercase tracking-[0.12em] text-amber-200">Deck not ready for Commander practice</div>
                  <div className="mt-1">
                    This import is missing {missingImportedDeckSlots} card{missingImportedDeckSlots === 1 ? '' : 's'}.
                    Add the missing card{missingImportedDeckSlots === 1 ? '' : 's'} or enable Fill missing cards before choosing an opponent.
                  </div>
                </div>
              )}
              {(importResult.filled_cards?.length || 0) > 0 && (
                <div className="mt-2 rounded-lg border border-amber-700/50 bg-amber-950/30 p-3 text-xs text-amber-200">
                  <div className="font-semibold text-amber-100">
                    Filled {(importResult.filled_cards || []).length} missing card{(importResult.filled_cards || []).length === 1 ? '' : 's'} for practice.
                  </div>
                  <div className="mt-1 text-amber-300">
                    {(importResult.filled_cards || []).join(', ')}
                  </div>
                </div>
              )}
              {importResult.errors.length > 0 && (
                <div className="text-xs text-red-400 space-y-1 mt-1">
                  {importResult.errors.map((e, i) => <div key={i}>{e}</div>)}
                </div>
              )}
              {importResult.valid && (
                <button
                  onClick={() => setStep('opponent')}
                  disabled={!importedDeckReadyForPractice}
                  className="mt-3 px-6 py-2.5 bg-green-600 hover:bg-green-500 rounded-lg font-medium transition-colors flex items-center gap-2 disabled:cursor-not-allowed disabled:bg-stone-700 disabled:text-stone-400"
                >
                  <Swords className="w-4 h-4" />
                  {importedDeckReadyForPractice ? 'Choose Opponent' : 'Complete Deck First'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Step 2: Opponent Setup */}
        {step === 'opponent' && importedDeckReadyForPractice && (
          <div className="bg-stone-800 rounded-xl border border-stone-700 p-6 mb-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Shield className="w-5 h-5 text-red-400" />
              Opponent Setup
            </h2>

            {/* Match size */}
            <div className="mb-4">
              <label className="text-sm text-stone-400 block mb-2">Number of Players</label>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                {MATCH_SIZES.map(size => (
                  <button
                    key={size.label}
                    onClick={() => setOpponentCount(size.opponentCount)}
                    className={`min-h-[48px] rounded-lg px-4 py-2.5 text-left transition-colors ${
                      opponentCount === size.opponentCount
                        ? 'bg-amber-600 text-white'
                        : 'bg-stone-700 text-stone-300 hover:bg-stone-600'
                    }`}
                  >
                    <span className="flex items-center gap-2 font-bold">
                      <Users className="h-4 w-4" />
                      {size.label}
                    </span>
                    <span className="block text-xs opacity-75">{size.players} players</span>
                  </button>
                ))}
                <button
                  type="button"
                  disabled
                  title="Events are planned for a future release"
                  className="min-h-[48px] cursor-not-allowed rounded-lg bg-stone-800/70 px-4 py-2.5 text-left text-stone-500"
                >
                  <span className="flex items-center gap-2 font-bold">
                    <Trophy className="h-4 w-4" />
                    Standard Event
                  </span>
                  <span className="block text-xs opacity-75">Future release</span>
                </button>
                <button
                  type="button"
                  disabled
                  title="Events are planned for a future release"
                  className="min-h-[48px] cursor-not-allowed rounded-lg bg-stone-800/70 px-4 py-2.5 text-left text-stone-500"
                >
                  <span className="flex items-center gap-2 font-bold">
                    <Trophy className="h-4 w-4" />
                    Draft Event
                  </span>
                  <span className="block text-xs opacity-75">Future release</span>
                </button>
              </div>
            </div>

            {/* Bracket */}
            <div className="mb-4">
              <label className="text-sm text-stone-400 block mb-2">Power Level (Bracket)</label>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map(b => (
                  <button
                    key={b}
                    onClick={() => setSpawnBracket(b)}
                    className={`w-11 h-11 sm:w-10 sm:h-10 rounded-lg font-bold transition-colors ${
                      spawnBracket === b
                        ? 'bg-amber-600 text-white'
                        : 'bg-stone-700 text-stone-300 hover:bg-stone-600'
                    }`}
                  >
                    {b}
                  </button>
                ))}
              </div>
            </div>

            {/* Starting life — lower = faster games */}
            <div className="mb-4">
              <label className="text-sm text-stone-400 block mb-2">
                Starting Life <span className="text-stone-500">(lower = faster game)</span>
              </label>
              <div className="flex gap-2 flex-wrap">
                {[20, 25, 30, 40].map(life => (
                  <button
                    key={life}
                    onClick={() => setStartingLife(life)}
                    className={`min-w-[3rem] h-11 sm:h-10 px-3 rounded-lg font-bold transition-colors ${
                      startingLife === life
                        ? 'bg-amber-600 text-white'
                        : 'bg-stone-700 text-stone-300 hover:bg-stone-600'
                    }`}
                    title={life === 40 ? 'Standard Commander' : `Faster game (${life} life)`}
                  >
                    {life}
                  </button>
                ))}
              </div>
            </div>

            {/* Spawn mode */}
            <div className="mb-4">
              <label className="text-sm text-stone-400 block mb-2">Opponent Selection</label>
              <div className="flex gap-2 flex-wrap">
                {(['random', 'counter', 'pool'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setSpawnMode(mode)}
                    className={`px-4 py-2.5 rounded-lg text-sm font-medium capitalize transition-colors min-h-[44px] ${
                      spawnMode === mode
                        ? 'bg-amber-600 text-white'
                        : 'bg-stone-700 text-stone-300 hover:bg-stone-600'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            {/* Color filter */}
            <div className="mb-4">
              <label className="text-sm text-stone-400 block mb-2">Exclude Colors</label>
              <div className="flex gap-2 flex-wrap">
                {Object.entries(COLOR_BADGES).map(([color, badge]) => (
                  <button
                    key={color}
                    onClick={() => setColorFilter(prev => ({ ...prev, [color]: !prev[color] }))}
                    className={`w-11 h-11 sm:w-9 sm:h-9 rounded-full text-sm font-bold transition-all ${
                      colorFilter[color]
                        ? `${badge} ring-2 ring-offset-2 ring-offset-stone-800 ring-amber-500`
                        : 'bg-stone-700 text-stone-400'
                    }`}
                  >
                    {color}
                  </button>
                ))}
              </div>
            </div>

            {/* Personality */}
            <div className="mb-6">
              <label className="text-sm text-stone-400 block mb-2">AI Personality</label>
              <div className="flex gap-2 flex-wrap">
                {PERSONALITIES.map(p => (
                  <button
                    key={p}
                    onClick={() => setPersonality(p)}
                    className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors min-h-[44px] ${
                      personality === p
                        ? 'bg-amber-600 text-white'
                        : 'bg-stone-700 text-stone-300 hover:bg-stone-600'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Opponent info (during spawn) */}
            {(spawnedOpponents.length > 0 || spawnProgress) && (
              <div className="mb-4 space-y-2 rounded-lg bg-stone-700/50 p-3">
                {spawnProgress && (
                  <div className="flex items-center gap-2 text-sm text-amber-200">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {spawnProgress}
                  </div>
                )}
                {spawnedOpponents.map((opponent, index) => (
                  <div key={`${opponent.commander}-${index}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                    <span className="text-stone-500">AI {index + 1}</span>
                    <span className="font-semibold text-amber-200">{opponent.commander}</span>
                    <span className="text-stone-400">
                      ({opponent.personality} &middot; {opponent.colors?.join('') || 'colorless'})
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Start button */}
            <button
              onClick={handleSpawnAndStart}
              disabled={isSpawning || isGeneratingAIDeck}
              className="w-full py-3 bg-red-600 hover:bg-red-500 disabled:bg-stone-600 disabled:text-stone-400 rounded-lg font-bold text-lg transition-colors flex items-center justify-center gap-2"
            >
              {isSpawning || isGeneratingAIDeck ? (
                <><Loader2 className="w-5 h-5 animate-spin" />Setting up game...</>
              ) : (
                <><Swords className="w-5 h-5" />Start {MATCH_SIZES.find(size => size.opponentCount === opponentCount)?.label || 'Game'}</>
              )}
            </button>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">
            {error}
          </div>
        )}
          </div>

          <aside className="space-y-3 lg:sticky lg:top-4">
            {renderSaveSlots(false)}
            {showPracticeTools && renderPracticeHistory(true)}
          </aside>
        </div>
      </div>
    </div>
  );
}
