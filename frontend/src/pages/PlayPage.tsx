import { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ClipboardPaste, Loader2, Swords, Link as LinkIcon, History, Trash2, Shield, Trophy, Users, Lightbulb, X, Save, FolderOpen, Database, BookmarkPlus, Rocket } from 'lucide-react';
import { useShelectorGame, type ImportedCards, type ShelectorGameSaveSnapshot } from '../hooks/useShelectorGame';
import { GameBoard } from '../components/GameBoard';
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

const MATCH_SIZES: { label: string; players: number; opponentCount: OpponentCount }[] = [
  { label: '1v1', players: 2, opponentCount: 1 },
  { label: '1v1v1', players: 3, opponentCount: 2 },
  { label: '1v1v1v1', players: 4, opponentCount: 3 },
];

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
    libraryChoice,
    optionalTriggerChoice,
    taxPaymentChoice,
    wardPaymentChoice,
    damageAssignmentChoice,
    triggerOrderChoice,
    gameLog,
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
  const [activeSaveSlot, setActiveSaveSlot] = useState(1);
  const [savePanelOpen, setSavePanelOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activeDrillRun, setActiveDrillRun] = useState<{
    slot: number;
    bookmarkId: string;
    label: string;
    startedAt: number;
  } | null>(null);
  const qaScenarioLoadedRef = useRef(false);

  // Load saved deck data
  useEffect(() => {
    const savedText = cacheGet<string>('last_deck_text');
    if (savedText) setDeckText(savedText);
    const savedResult = cacheGet<DeckImportResult>('last_deck_result');
    if (savedResult) setImportResult(savedResult);
    const savedHistory = cacheGet<DeckHistoryEntry[]>('deck_history');
    if (savedHistory) setDeckHistory(savedHistory);
    if (!cacheGet<boolean>(GUIDED_PROMPT_CACHE_KEY)) {
      setShowGuidedPrompt(true);
    }
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
  };

  const applySaveSlotRecord = (record: PlaySaveSlotRecord | null, slot: number) => {
    const next = [...saveSlotsRef.current];
    next[slot - 1] = record;
    saveSlotsRef.current = next;
    setSaveSlots(next);
  };

  useEffect(() => {
    refreshSaveSlots().catch(() => {
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
      && qaScenario !== 'modal-choice'
    ) return;

    let cancelled = false;
    import('../lib/qaGameScenarios')
      .then(({
        createDeclareBlockersQaState,
        createLandEntryFetchQaState,
        createLibraryManipulationQaState,
        createModalChoiceQaState,
        createSisayActivationQaState,
        createSisayRawLandsQaState,
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
          : qaScenario === 'modal-choice'
          ? createModalChoiceQaState()
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
            : qaScenario === 'library-manipulation'
            ? 'Talrand, Sky Summoner'
            : 'Sisay, Weatherlight Captain',
          aiCommanderNames: {
            'ai-1': qaScenario === 'declare-blockers'
              ? 'Marchesa, Dealer of Death'
              : qaScenario === 'library-manipulation'
              ? 'Library QA Opponent'
              : qaScenario === 'modal-choice'
              ? 'Modal QA Opponent'
              : 'QA Opponent',
          },
          humanId: 'human',
          aiIds: ['ai-1'],
          opponentInfo: null,
          chatMessages: [],
          gameLog: [],
          authorityUpdates: [],
          engineEventLog: [],
          engineEventLogSeeds: {},
          engineEventLogInitialState: null,
          lastStateUpdate: null,
          currentPrompt: null,
          lastPlayedCard: null,
          mulliganPhase: false,
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
              : qaScenario === 'modal-choice'
              ? 'modal choice'
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
    drillBookmarks = saveSlotsRef.current[slot - 1]?.drillBookmarks || [],
  ): PlaySaveSlotRecord => {
    const savedAt = Date.now();
    const commander = gameState?.humanCommander || importResult?.commander || snapshot.humanCommander || 'Practice Game';
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
      practice: resolvePracticeMetadata(),
      audit: {
        schema: 'engine-event-log-v1',
        engineEventCount: engineEventLog.length,
        hasInitialState: Boolean(engineEventLogInitialState),
        seedCount: Object.keys(engineEventLogSeeds || {}).length,
        updatedAt: savedAt,
      },
      drillBookmarks,
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

  const loadDrillBookmark = async (record: PlaySaveSlotRecord, bookmark: PlayDrillBookmark) => {
    setSaveError(null);
    const snapshot = record.snapshot as ShelectorGameSaveSnapshot;
    const engine = bookmark.engine || await loadCanonicalPlayStateRef(bookmark.canonicalState);
    if (!engine) {
      setSaveError(`Drill bookmark "${bookmark.label}" is missing its authoritative engine state.`);
      return;
    }
    const drillSnapshot: ShelectorGameSaveSnapshot = {
      ...snapshot,
      savedAt: Date.now(),
      engine,
      authorityUpdates: [],
      engineEventLog: [],
      engineEventLogSeeds: {},
      engineEventLogInitialState: engine,
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
      tutorSourceName: 'Drill Bookmark',
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
    const drillSnapshot: ShelectorGameSaveSnapshot = {
      ...snapshot,
      savedAt: Date.now(),
      engine,
      authorityUpdates: [],
      engineEventLog: [],
      engineEventLogSeeds: {},
      engineEventLogInitialState: engine,
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
      tutorSourceName: 'Drill Attempt',
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
      summary: summarizeDrillAttempt(),
      engine: snapshot.engine,
    };

    const drillBookmarks = record.drillBookmarks.map(bookmark => (
      bookmark.id === activeDrillRun.bookmarkId
        ? { ...bookmark, attempts: [...(bookmark.attempts || []), attempt].slice(-12) }
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
      note: currentPrompt?.title || lastPlayedCard?.card.name || 'Manual drill bookmark',
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

  const renderSaveSlots = (compact = false) => (
    <div className={`rounded-xl border border-stone-700 bg-stone-900/95 ${compact ? 'p-3' : 'p-4'} shadow-xl shadow-black/20`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-amber-300" />
          <h2 className="text-sm font-black uppercase tracking-wider text-stone-200">Game Saves</h2>
        </div>
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
      {(saveStatus || saveError) && (
        <div className={`mb-3 rounded border px-3 py-2 text-xs ${
          saveError ? 'border-red-500/40 bg-red-950/40 text-red-100' : 'border-emerald-500/40 bg-emerald-950/40 text-emerald-100'
        }`}>
          {saveError || saveStatus}
        </div>
      )}
      <div className="grid gap-2">
        {saveSlots.map((record, index) => {
          const slot = index + 1;
          const active = activeSaveSlot === slot;
          const audit = record ? auditPlaySaveSnapshot(record.snapshot) : null;
          const canonicalAudit = record?.canonicalEngineSave ? auditCanonicalPlayEngineSave(record.canonicalEngineSave) : null;
          const checkpointSequence = record ? latestCheckpointSequence(record) : null;
          const managerStatus = record?.canonicalManager?.status;
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
              className={`rounded-lg border p-3 ${
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
                  {(audit || canonicalAudit || record?.canonicalManager) && (
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
                      {audit && (
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
                  {(canonicalAudit?.ok && canonicalAudit.fingerprint) || checkpointSequence !== null ? (
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
                {record?.drillBookmarks && record.drillBookmarks.length > 0 && (
                  <div className="basis-full rounded-lg border border-fuchsia-500/25 bg-fuchsia-950/20 p-2">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <div className="text-[10px] font-black uppercase tracking-wider text-fuchsia-200">Drill Lab</div>
                      <div className="text-[10px] text-fuchsia-100/70">{record.drillBookmarks.length} bookmark{record.drillBookmarks.length === 1 ? '' : 's'}</div>
                    </div>
                    <div className="grid gap-1 sm:grid-cols-2">
                      {record.drillBookmarks.slice(-6).reverse().map(bookmark => (
                        <div key={bookmark.id} className="rounded border border-fuchsia-500/20 bg-neutral-950/50 p-1.5">
                          <button
                            type="button"
                            onClick={() => loadDrillBookmark(record, bookmark)}
                            className="flex min-h-8 w-full items-center gap-1 rounded border border-fuchsia-500/40 px-2 text-left text-xs font-bold text-fuchsia-100 hover:bg-fuchsia-950/40"
                            title={bookmark.note || bookmark.label}
                          >
                            <BookmarkPlus className="h-3.5 w-3.5 shrink-0" />
                            <span className="min-w-0 flex-1 truncate">{bookmark.label}</span>
                            {bookmark.attempts?.length ? <span className="shrink-0 text-[10px] text-fuchsia-100/70">{bookmark.attempts.length}</span> : null}
                          </button>
                          {bookmark.note && (
                            <div className="mt-1 truncate text-[10px] text-fuchsia-100/65">{bookmark.note}</div>
                          )}
                          {bookmark.attempts?.slice(-1).map(attempt => (
                            <button
                              key={attempt.id}
                              type="button"
                              onClick={() => loadDrillAttempt(record, bookmark, attempt)}
                              className="mt-1 min-h-7 rounded border border-sky-500/40 px-2 text-[10px] font-bold text-sky-100 hover:bg-sky-950/40"
                              title={attempt.summary}
                            >
                              Latest attempt
                            </button>
                          ))}
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
        lines.push(`1 ${parsed.commander}`);
        lines.push('Deck');
      }
      for (const card of parsed.cards) lines.push(`1 ${card}`);
      const listText = lines.join('\n');

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

  const handleStartFocusedXenagosRep = async () => {
    const deck = PRACTICE_DECKS.find(candidate => candidate.id === 'practice-xenagos-dragons');
    if (!deck) return;

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
    setSpawnProgress('Loading Xenagos practice deck...');

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
      setSaveStatus('Started clean Xenagos rep: Aggressive Shelector, coach mode on, focus tags visible.');
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
        aiDecks
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

  const branchPreviews = useMemo(() => {
    if (step !== 'game' || !gameState) return [];
    const snapshot = exportGameSave();
    return buildPracticeBranchPreviews({
      serializedState: snapshot?.engine,
      playerId: snapshot?.humanId || gameState.humanPlayer.id,
      legalActions,
      max: 4,
    });
  }, [step, gameState, legalActions, exportGameSave]);

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
            coachMode={coachMode}
            onToggleCoach={setCoachMode}
            newPlayerMode={newPlayerMode}
            onToggleNewPlayerMode={setNewPlayerMode}
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
            onBookmarkDrill={bookmarkCurrentDrill}
            drillBookmarkLabel="Bookmark This Moment"
            practiceFocusTags={activePracticeFocusTags}
            branchPreviews={branchPreviews}
            activeDrillLabel={activeDrillRun?.label || null}
            onSaveDrillAttempt={activeDrillRun ? saveCurrentDrillAttempt : undefined}
            onExitDrillAttempt={activeDrillRun ? exitCurrentDrillAttempt : undefined}
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
            ]}
          />
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

      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Link to="/" className="text-stone-400 hover:text-stone-200">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-2xl font-bold">Play Practice Game</h1>
        </div>

        <div className="mb-6">
          {renderSaveSlots(false)}
        </div>

        {/* Step 1: Import */}
        <div className="bg-stone-800 rounded-xl border border-stone-700 p-6 mb-6">
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

          <div className="mb-4 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setStep('standard')}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-red-700/50 bg-red-950/30 px-4 py-2.5 text-sm font-bold text-red-100 transition-colors hover:bg-red-900/40"
            >
              <Trophy className="h-4 w-4" />
              Standard Tournament
            </button>
            <button
              type="button"
              onClick={() => setStep('draft')}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-amber-700/50 bg-amber-950/30 px-4 py-2.5 text-sm font-bold text-amber-200 transition-colors hover:bg-amber-900/40"
            >
              <Users className="h-4 w-4" />
              Draft Tournament
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
              <button
                type="button"
                onClick={handleStartFocusedXenagosRep}
                disabled={isImporting || isSpawning || isGeneratingAIDeck}
                className="flex w-full min-h-[52px] items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-3 text-sm font-black text-stone-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-stone-700 disabled:text-stone-400"
              >
                {isImporting || isSpawning || isGeneratingAIDeck ? (
                  <><Loader2 className="h-4 w-4 animate-spin" />Starting Focused Rep</>
                ) : (
                  <><Rocket className="h-4 w-4" />Start Clean Xenagos Rep</>
                )}
              </button>
              <p className="mt-2 text-[11px] leading-5 text-amber-100/65">
                Loads Xenagos, clears the current table, sets Aggressive Shelector, enables coach mode, and opens the practice focus HUD.
              </p>
            </div>
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
              {importResult.warnings.length > 0 && (
                <div className="text-xs text-amber-400 space-y-1">
                  {importResult.warnings.map((w, i) => <div key={i}>{w}</div>)}
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
                  className="mt-3 px-6 py-2.5 bg-green-600 hover:bg-green-500 rounded-lg font-medium transition-colors flex items-center gap-2"
                >
                  <Swords className="w-4 h-4" />
                  Choose Opponent
                </button>
              )}
            </div>
          )}
        </div>

        {/* Step 2: Opponent Setup */}
        {step === 'opponent' && importResult?.valid && (
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
                  onClick={() => setStep('standard')}
                  className="min-h-[48px] rounded-lg bg-stone-700 px-4 py-2.5 text-left text-stone-300 transition-colors hover:bg-stone-600"
                >
                  <span className="flex items-center gap-2 font-bold">
                    <Trophy className="h-4 w-4" />
                    Standard Tournament
                  </span>
                  <span className="block text-xs opacity-75">Swiss, 4+ players</span>
                </button>
                <button
                  type="button"
                  onClick={() => setStep('draft')}
                  className="min-h-[48px] rounded-lg bg-stone-700 px-4 py-2.5 text-left text-stone-300 transition-colors hover:bg-stone-600"
                >
                  <span className="flex items-center gap-2 font-bold">
                    <Trophy className="h-4 w-4" />
                    Draft Tournament
                  </span>
                  <span className="block text-xs opacity-75">2-8 players</span>
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
    </div>
  );
}
