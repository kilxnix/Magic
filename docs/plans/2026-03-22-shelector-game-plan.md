# Shelector Game Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users play Commander games against the Shelector through a chat + visual board UI, with the TypeScript game engine enforcing all rules.

**Architecture:** The game engine runs in-browser (TypeScript). When the AI has priority, the frontend calls the Shelector Python API (`POST /decide`) with the board state and legal actions. The Shelector picks an action and narrates its reasoning. The engine applies the action and updates the board.

**Tech Stack:** React + TypeScript (frontend), FastAPI + Qwen 3B (Shelector API), existing commander-engine package

**Spec:** `docs/plans/2026-03-22-shelector-game-design.md`

---

## File Structure

```
backend/agent/
├── server.py              — MODIFY: add /decide and /spawn-opponent endpoints
├── game_bridge.py         — CREATE: serializes game state for the LLM, formats action selection prompt
└── tests/
    └── test_game_bridge.py — CREATE: tests for state serialization and action parsing

frontend/src/
├── pages/ShelectorGamePage.tsx  — CREATE: split-panel game + chat UI
├── hooks/useShelectorGame.ts    — CREATE: bridges game engine with Shelector API
├── components/
│   ├── GameBoard.tsx            — CREATE: battlefield, hand, phase indicator, life totals
│   └── GameChat.tsx             — CREATE: narration chat panel
└── router.tsx                   — MODIFY: add /shelector/game route
```

---

### Task 1: Game State Bridge (Python)

**Files:**
- Create: `backend/agent/game_bridge.py`
- Create: `backend/agent/tests/test_game_bridge.py`

Converts a JSON game state dump into a readable text summary for the LLM, and parses the LLM's action choice back into a structured action object.

- [ ] **Step 1: Write failing tests**

```python
# backend/agent/tests/test_game_bridge.py
import pytest
from backend.agent.game_bridge import summarize_game_state, format_decide_prompt, parse_action_choice

SAMPLE_STATE = {
    "players": [
        {"id": "human", "name": "Player", "life": 40, "hasLost": False,
         "manaPool": {"W": 0, "U": 0, "B": 0, "R": 0, "G": 0, "C": 0},
         "hasPlayedLand": False, "commanderCastCount": 0},
        {"id": "shelector", "name": "Shelector", "life": 38, "hasLost": False,
         "manaPool": {"W": 0, "U": 0, "B": 0, "R": 0, "G": 0, "C": 0},
         "hasPlayedLand": False, "commanderCastCount": 1},
    ],
    "activePlayerIndex": 1,
    "phase": "main1",
    "turnNumber": 4,
    "stack": [],
}

SAMPLE_CARDS = {
    "card-1": {"instanceId": "card-1", "definitionId": "sol-ring", "ownerId": "shelector",
               "zone": "hand", "tapped": False},
    "card-2": {"instanceId": "card-2", "definitionId": "forest-1", "ownerId": "shelector",
               "zone": "hand", "tapped": False},
    "card-3": {"instanceId": "card-3", "definitionId": "plains-1", "ownerId": "shelector",
               "zone": "battlefield", "tapped": False},
}

SAMPLE_DEFINITIONS = {
    "sol-ring": {"name": "Sol Ring", "type_line": "Artifact", "mana_cost": "{1}", "cmc": 1},
    "forest-1": {"name": "Forest", "type_line": "Basic Land — Forest", "mana_cost": "", "cmc": 0},
    "plains-1": {"name": "Plains", "type_line": "Basic Land — Plains", "mana_cost": "", "cmc": 0},
}

SAMPLE_ACTIONS = [
    {"kind": "PlayLand", "cardInstanceId": "card-2"},
    {"kind": "CastSpell", "cardInstanceId": "card-1", "targets": []},
    {"kind": "PassPriority"},
]


class TestSummarizeGameState:
    def test_includes_life_totals(self):
        summary = summarize_game_state(SAMPLE_STATE, SAMPLE_CARDS, SAMPLE_DEFINITIONS, "shelector")
        assert "40" in summary  # human life
        assert "38" in summary  # shelector life

    def test_includes_turn_info(self):
        summary = summarize_game_state(SAMPLE_STATE, SAMPLE_CARDS, SAMPLE_DEFINITIONS, "shelector")
        assert "Turn 4" in summary

    def test_includes_hand_cards(self):
        summary = summarize_game_state(SAMPLE_STATE, SAMPLE_CARDS, SAMPLE_DEFINITIONS, "shelector")
        assert "Sol Ring" in summary
        assert "Forest" in summary


class TestFormatDecidePrompt:
    def test_includes_actions_numbered(self):
        prompt = format_decide_prompt(
            SAMPLE_STATE, SAMPLE_CARDS, SAMPLE_DEFINITIONS,
            SAMPLE_ACTIONS, "shelector", "Aggressive"
        )
        assert "1." in prompt or "[1]" in prompt
        assert "PlayLand" in prompt or "Play Land" in prompt
        assert "PassPriority" in prompt or "Pass" in prompt

    def test_includes_personality(self):
        prompt = format_decide_prompt(
            SAMPLE_STATE, SAMPLE_CARDS, SAMPLE_DEFINITIONS,
            SAMPLE_ACTIONS, "shelector", "Aggressive"
        )
        assert "Aggressive" in prompt


class TestParseActionChoice:
    def test_parse_number(self):
        action = parse_action_choice("I'll go with action 1", SAMPLE_ACTIONS)
        assert action["kind"] == "PlayLand"

    def test_parse_from_text(self):
        action = parse_action_choice("Let me pass priority here", SAMPLE_ACTIONS)
        assert action["kind"] == "PassPriority"

    def test_fallback_to_pass(self):
        action = parse_action_choice("gibberish nonsense", SAMPLE_ACTIONS)
        assert action["kind"] == "PassPriority"
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `source .venv/Scripts/activate && python -m pytest backend/agent/tests/test_game_bridge.py -v`

- [ ] **Step 3: Implement game_bridge.py**

```python
# backend/agent/game_bridge.py
"""Bridge between TypeScript game state JSON and the Shelector LLM brain."""

from __future__ import annotations
import re
from typing import Any, Dict, List, Optional


def summarize_game_state(
    state: Dict[str, Any],
    cards: Dict[str, Any],
    definitions: Dict[str, Any],
    my_player_id: str,
) -> str:
    """Convert game state JSON into a readable text summary for the LLM."""
    lines = []
    turn = state.get("turnNumber", 1)
    phase = state.get("phase", "unknown")
    lines.append(f"Turn {turn} — Phase: {phase}")
    lines.append("")

    for player in state.get("players", []):
        pid = player["id"]
        tag = "(You)" if pid == my_player_id else "(Opponent)"
        lines.append(f"{player.get('name', pid)} {tag}: {player.get('life', 0)} life")

        # Cards by zone
        hand, battlefield, graveyard = [], [], []
        for cid, card in cards.items():
            if card.get("ownerId") != pid:
                continue
            defn = definitions.get(card.get("definitionId", ""), {})
            name = defn.get("name", "Unknown")
            zone = card.get("zone", "")
            tapped = " (tapped)" if card.get("tapped") else ""
            if zone == "hand" and pid == my_player_id:
                hand.append(f"{name} [{defn.get('mana_cost', '')}]")
            elif zone == "battlefield":
                battlefield.append(f"{name}{tapped}")
            elif zone == "graveyard":
                graveyard.append(name)

        if hand:
            lines.append(f"  Hand: {', '.join(hand)}")
        if battlefield:
            lines.append(f"  Battlefield: {', '.join(battlefield)}")
        if graveyard:
            lines.append(f"  Graveyard: {', '.join(graveyard)}")
        if pid != my_player_id:
            hand_count = sum(1 for c in cards.values()
                           if c.get("ownerId") == pid and c.get("zone") == "hand")
            lines.append(f"  Cards in hand: {hand_count}")
        lines.append("")

    stack = state.get("stack", [])
    if stack:
        lines.append(f"Stack: {len(stack)} items")

    return "\n".join(lines)


def format_decide_prompt(
    state: Dict[str, Any],
    cards: Dict[str, Any],
    definitions: Dict[str, Any],
    legal_actions: List[Dict[str, Any]],
    my_player_id: str,
    personality: str = "Balanced",
) -> str:
    """Build the full prompt for the LLM to pick an action."""
    board = summarize_game_state(state, cards, definitions, my_player_id)

    action_lines = []
    for i, action in enumerate(legal_actions, 1):
        kind = action.get("kind", "Unknown")
        detail = ""
        if kind == "PlayLand" or kind == "CastSpell" or kind == "ActivateManaAbility":
            cid = action.get("cardInstanceId", "")
            card = cards.get(cid, {})
            defn = definitions.get(card.get("definitionId", ""), {})
            detail = f" — {defn.get('name', 'Unknown')}"
            if kind == "CastSpell":
                targets = action.get("targets", [])
                if targets:
                    target_names = []
                    for tid in targets:
                        tc = cards.get(tid, {})
                        td = definitions.get(tc.get("definitionId", ""), {})
                        target_names.append(td.get("name", tid))
                    detail += f" targeting {', '.join(target_names)}"
        elif kind == "DeclareAttackers":
            attacks = action.get("attacks", [])
            detail = f" — {len(attacks)} creatures"
        action_lines.append(f"[{i}] {kind}{detail}")

    actions_text = "\n".join(action_lines)

    return f"""You are playing Commander as a {personality} player. It's your turn to act.

BOARD STATE:
{board}

LEGAL ACTIONS (pick one by number):
{actions_text}

Pick the best action for a {personality} strategy. Reply with the action number and a brief
one-sentence explanation of why, in character. Example: "2 — Sol Ring is too good to pass up."
"""


def parse_action_choice(
    response: str,
    legal_actions: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Parse the LLM response to extract the chosen action index."""
    # Try to find a number at the start or after common patterns
    match = re.search(r'\b(\d+)\b', response)
    if match:
        idx = int(match.group(1))
        if 1 <= idx <= len(legal_actions):
            return legal_actions[idx - 1]

    # Fallback: look for action kind keywords
    response_lower = response.lower()
    for action in legal_actions:
        kind = action.get("kind", "").lower()
        if kind.replace("priority", "pass") in response_lower:
            return action

    # Ultimate fallback: pass priority (always safe)
    for action in legal_actions:
        if action.get("kind") == "PassPriority":
            return action

    return legal_actions[-1]  # last action as absolute fallback
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `source .venv/Scripts/activate && python -m pytest backend/agent/tests/test_game_bridge.py -v`

- [ ] **Step 5: Commit**

---

### Task 2: /decide and /spawn-opponent Endpoints (Python)

**Files:**
- Modify: `backend/agent/server.py`

- [ ] **Step 1: Add /spawn-opponent endpoint**

Picks a deck from the AI pool based on bracket and returns opponent info.

```python
# Add to server.py

import json
import random
from pathlib import Path

AI_DECK_POOL = Path(__file__).parent.parent.parent / "data" / "ai_decks" / "deck_pool.json"


class SpawnRequest(BaseModel):
    bracket: int = 3
    avoid_colors: list[str] = []

class SpawnResponse(BaseModel):
    commander: str
    deck_name: str
    personality: str
    colors: list[str]
    deck_id: str


@app.post("/spawn-opponent", response_model=SpawnResponse)
async def spawn_opponent(req: SpawnRequest):
    with open(AI_DECK_POOL, encoding="utf-8") as f:
        pool = json.load(f)

    eligible = [d for d in pool
                if d.get("minBracket", 1) <= req.bracket <= d.get("maxBracket", 5)]
    if req.avoid_colors:
        avoid = set(req.avoid_colors)
        preferred = [d for d in eligible if not set(d.get("colors", [])) & avoid]
        if preferred:
            eligible = preferred

    if not eligible:
        eligible = pool

    deck = random.choice(eligible)
    personalities = ["Aggressive", "Balanced", "Political", "Greedy"]
    return SpawnResponse(
        commander=deck["commander"],
        deck_name=deck.get("name", deck["commander"]),
        personality=random.choice(personalities),
        colors=deck.get("colors", []),
        deck_id=deck.get("id", deck["commander"]),
    )
```

- [ ] **Step 2: Add /decide endpoint**

```python
# Add to server.py

from backend.agent.game_bridge import format_decide_prompt, parse_action_choice


class DecideRequest(BaseModel):
    game_state: dict
    cards: dict
    definitions: dict
    legal_actions: list
    player_id: str = "shelector"
    personality: str = "Balanced"

class DecideResponse(BaseModel):
    action: dict
    narration: str


@app.post("/decide", response_model=DecideResponse)
async def decide(req: DecideRequest):
    prompt = format_decide_prompt(
        req.game_state, req.cards, req.definitions,
        req.legal_actions, req.player_id, req.personality,
    )

    # Use the brain to generate a decision
    messages = [
        {"role": "system", "content": (
            f"You are a {req.personality} MTG Commander player. "
            "Pick the best action from the numbered list. "
            "Reply with ONLY the number and a brief one-sentence narration in character. "
            "Example: '2 — Can't let that threat stick around.'"
        )},
        {"role": "user", "content": prompt},
    ]

    brain._load_model()
    response_text = brain._generate(messages, max_tokens=100)

    action = parse_action_choice(response_text, req.legal_actions)

    # Extract narration (everything after the number)
    narration = response_text.strip()
    dash_idx = narration.find("—")
    if dash_idx == -1:
        dash_idx = narration.find("-")
    if dash_idx > 0:
        narration = narration[dash_idx + 1:].strip()

    return DecideResponse(action=action, narration=narration)
```

- [ ] **Step 3: Test endpoints manually**

```bash
# Test spawn
curl -s -X POST http://localhost:8100/spawn-opponent \
  -H "Content-Type: application/json" \
  -d '{"bracket": 3}'

# Test decide (with minimal state)
curl -s -X POST http://localhost:8100/decide \
  -H "Content-Type: application/json" \
  -d '{"game_state":{"players":[{"id":"human","name":"Player","life":40},{"id":"ai","name":"Shelector","life":40}],"activePlayerIndex":1,"phase":"main1","turnNumber":1,"stack":[]},"cards":{},"definitions":{},"legal_actions":[{"kind":"PassPriority"}],"player_id":"ai","personality":"Balanced"}'
```

- [ ] **Step 4: Commit**

---

### Task 3: useShelectorGame Hook (TypeScript)

**Files:**
- Create: `frontend/src/hooks/useShelectorGame.ts`

- [ ] **Step 1: Implement the hook**

```typescript
// frontend/src/hooks/useShelectorGame.ts
import { useState, useCallback, useRef, useEffect } from 'react';
import {
  GameState,
  initGameFromDecks,
  getLegalActions,
  applyAction,
  advanceStep,
  allPlayersPassed,
} from 'commander-engine';

export interface ChatMessage {
  role: 'shelector' | 'system' | 'player';
  text: string;
  timestamp: number;
}

interface ShelectorGameConfig {
  humanDeckCards: any[];
  humanCommander: string;
  aiDeckCards: any[];
  aiCommander: string;
  aiPersonality: string;
  bracket: number;
  cardLookup: (name: string) => any;
}

interface ShelectorGameState {
  gameState: GameState | null;
  chat: ChatMessage[];
  isLoading: boolean;
  isHumanTurn: boolean;
  isGameOver: boolean;
  winner: string | null;
  legalActions: any[];
}

const SHELECTOR_API = 'http://localhost:8100';

export function useShelectorGame(config: ShelectorGameConfig | null): ShelectorGameState & {
  submitAction: (action: any) => void;
  startGame: () => void;
} {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [legalActions, setLegalActions] = useState<any[]>([]);
  const processingRef = useRef(false);

  const addChat = useCallback((role: ChatMessage['role'], text: string) => {
    setChat(prev => [...prev, { role, text, timestamp: Date.now() }]);
  }, []);

  const getHumanPlayerId = useCallback(() => {
    return gameState?.players?.[0]?.id || 'human';
  }, [gameState]);

  const getAIPlayerId = useCallback(() => {
    return gameState?.players?.[1]?.id || 'ai';
  }, [gameState]);

  const isHumanPriority = useCallback((state: GameState) => {
    if (!state) return false;
    const activePlayer = state.players[state.priorityPlayerIndex];
    return activePlayer && activePlayer.id === state.players[0]?.id;
  }, []);

  const checkGameOver = useCallback((state: GameState) => {
    const alive = state.players.filter(p => !p.hasLost);
    if (alive.length <= 1) {
      return { over: true, winner: alive[0]?.name || 'Nobody' };
    }
    return { over: false, winner: null };
  }, []);

  // Call Shelector API for AI decisions
  const callShelector = useCallback(async (state: GameState, actions: any[]) => {
    // Serialize state for the API
    const cards: Record<string, any> = {};
    const definitions: Record<string, any> = {};

    if (state.cards) {
      state.cards.forEach((card: any, id: string) => {
        cards[id] = card;
        if (card.definitionId && state.cardDefinitions?.get(card.definitionId)) {
          definitions[card.definitionId] = state.cardDefinitions.get(card.definitionId);
        }
      });
    }

    const res = await fetch(`${SHELECTOR_API}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        game_state: {
          players: state.players,
          activePlayerIndex: state.activePlayerIndex,
          priorityPlayerIndex: state.priorityPlayerIndex,
          phase: state.phase,
          step: state.step,
          turnNumber: state.turnNumber,
          stack: state.stack || [],
        },
        cards,
        definitions,
        legal_actions: actions,
        player_id: state.players[1]?.id || 'ai',
        personality: config?.aiPersonality || 'Balanced',
      }),
    });

    if (!res.ok) throw new Error('Shelector API failed');
    return res.json();
  }, [config]);

  // Process AI turn
  const processAITurn = useCallback(async (state: GameState) => {
    if (processingRef.current) return;
    processingRef.current = true;
    setIsLoading(true);

    try {
      let current = state;
      let maxSteps = 20; // safety limit

      while (!isHumanPriority(current) && maxSteps-- > 0) {
        const { over } = checkGameOver(current);
        if (over) break;

        const aiId = current.players[1]?.id;
        if (!aiId) break;

        const actions = getLegalActions(current, aiId);
        if (!actions || actions.length === 0) break;

        // Only PassPriority available — just pass
        if (actions.length === 1 && actions[0].kind === 'PassPriority') {
          current = applyAction(current, aiId, actions[0]);
          if (allPlayersPassed(current)) {
            current = advanceStep(current);
          }
          continue;
        }

        // Call Shelector for non-trivial decisions
        try {
          const decision = await callShelector(current, actions);
          if (decision.narration) {
            addChat('shelector', decision.narration);
          }
          current = applyAction(current, aiId, decision.action);
        } catch {
          // Fallback: pass priority
          current = applyAction(current, aiId, { kind: 'PassPriority' });
        }

        // Small delay for readability
        await new Promise(r => setTimeout(r, 300));
      }

      setGameState(current);

      // Update legal actions for human
      if (isHumanPriority(current)) {
        const humanId = current.players[0]?.id;
        if (humanId) {
          setLegalActions(getLegalActions(current, humanId));
        }
      }
    } finally {
      setIsLoading(false);
      processingRef.current = false;
    }
  }, [callShelector, isHumanPriority, checkGameOver, addChat]);

  // Human submits an action
  const submitAction = useCallback((action: any) => {
    if (!gameState) return;
    const humanId = gameState.players[0]?.id;
    if (!humanId) return;

    let newState = applyAction(gameState, humanId, action);

    if (allPlayersPassed(newState)) {
      newState = advanceStep(newState);
    }

    setGameState(newState);

    // Check if AI gets priority next
    if (!isHumanPriority(newState)) {
      processAITurn(newState);
    } else {
      setLegalActions(getLegalActions(newState, humanId));
    }
  }, [gameState, isHumanPriority, processAITurn]);

  // Start game
  const startGame = useCallback(() => {
    if (!config) return;
    addChat('system', `Game started! You're playing against the Shelector as ${config.aiCommander}.`);
    addChat('shelector', `Let's see what you've got. I'm running ${config.aiCommander} — ${config.aiPersonality} style.`);

    // Initialize via engine
    try {
      const state = initGameFromDecks({
        humanDeck: {
          commander: config.humanCommander,
          cards: config.humanDeckCards,
        },
        aiDecks: [{
          commander: config.aiCommander,
          cards: config.aiDeckCards,
        }],
        aiDifficulty: config.bracket,
        aiPersonalities: [config.aiPersonality as any],
        cardLookup: config.cardLookup,
      });

      setGameState(state);

      const humanId = state.players[0]?.id;
      if (humanId && isHumanPriority(state)) {
        setLegalActions(getLegalActions(state, humanId));
      } else {
        processAITurn(state);
      }
    } catch (err: any) {
      addChat('system', `Failed to start game: ${err.message}`);
    }
  }, [config, addChat, isHumanPriority, processAITurn]);

  const { over, winner } = gameState ? checkGameOver(gameState) : { over: false, winner: null };

  return {
    gameState,
    chat,
    isLoading,
    isHumanTurn: gameState ? isHumanPriority(gameState) : false,
    isGameOver: over,
    winner,
    legalActions,
    submitAction,
    startGame,
  };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit src/hooks/useShelectorGame.ts`
(May have type errors from engine imports — those get resolved in integration)

- [ ] **Step 3: Commit**

---

### Task 4: GameBoard Component (React)

**Files:**
- Create: `frontend/src/components/GameBoard.tsx`

- [ ] **Step 1: Implement GameBoard**

Renders the battlefield, hand, life totals, and phase indicator. Cards are clickable when it's the human's turn.

```typescript
// frontend/src/components/GameBoard.tsx
import { Loader2 } from 'lucide-react';

interface GameBoardProps {
  gameState: any;
  legalActions: any[];
  isHumanTurn: boolean;
  isLoading: boolean;
  onAction: (action: any) => void;
}

export function GameBoard({ gameState, legalActions, isHumanTurn, isLoading, onAction }: GameBoardProps) {
  if (!gameState) {
    return (
      <div className="flex items-center justify-center h-full text-stone-400">
        Waiting for game to start...
      </div>
    );
  }

  const human = gameState.players?.[0];
  const ai = gameState.players?.[1];

  // Get cards by zone for each player
  const getCards = (playerId: string, zone: string) => {
    const cards: any[] = [];
    if (gameState.cards) {
      gameState.cards.forEach((card: any, id: string) => {
        if (card.ownerId === playerId && card.zone === zone) {
          const defn = gameState.cardDefinitions?.get(card.definitionId) || {};
          cards.push({ ...card, ...defn, instanceId: id });
        }
      });
    }
    return cards;
  };

  const humanHand = getCards(human?.id, 'hand');
  const humanBattlefield = getCards(human?.id, 'battlefield');
  const aiBattlefield = getCards(ai?.id, 'battlefield');
  const aiHandCount = gameState.cards
    ? Array.from(gameState.cards.values()).filter(
        (c: any) => c.ownerId === ai?.id && c.zone === 'hand'
      ).length
    : 0;

  // Find actions for a specific card
  const actionsForCard = (instanceId: string) =>
    legalActions.filter(
      (a: any) => a.cardInstanceId === instanceId
    );

  const passAction = legalActions.find((a: any) => a.kind === 'PassPriority');

  return (
    <div className="flex flex-col h-full bg-stone-900 text-stone-100 text-sm">
      {/* Phase bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-stone-800 border-b border-stone-700">
        <span>Turn {gameState.turnNumber} — {gameState.phase || 'unknown'}</span>
        <span className={isHumanTurn ? 'text-green-400' : 'text-amber-400'}>
          {isLoading ? 'Shelector thinking...' : isHumanTurn ? 'Your turn' : 'Opponent\'s turn'}
        </span>
        {isLoading && <Loader2 className="w-4 h-4 animate-spin text-amber-400" />}
      </div>

      {/* AI side */}
      <div className="px-3 py-2 border-b border-stone-700">
        <div className="flex items-center justify-between mb-1">
          <span className="text-stone-400 text-xs">
            {ai?.name || 'Shelector'} — {ai?.life || 0} life
          </span>
          <span className="text-stone-500 text-xs">{aiHandCount} cards in hand</span>
        </div>
        <div className="flex flex-wrap gap-1 min-h-[40px]">
          {aiBattlefield.map((card: any) => (
            <div
              key={card.instanceId}
              className={`px-2 py-1 rounded text-xs border ${
                card.tapped
                  ? 'bg-stone-700 border-stone-600 opacity-60 italic'
                  : 'bg-stone-700 border-stone-600'
              }`}
            >
              {card.name}
              {card.power != null && ` ${card.power}/${card.toughness}`}
            </div>
          ))}
          {aiBattlefield.length === 0 && (
            <span className="text-stone-600 text-xs italic">No permanents</span>
          )}
        </div>
      </div>

      {/* Spacer / stack area */}
      <div className="flex-1 flex items-center justify-center">
        {gameState.stack?.length > 0 && (
          <div className="bg-stone-800 border border-amber-700 rounded-lg px-4 py-2">
            <span className="text-amber-400 text-xs">Stack: {gameState.stack.length} items</span>
          </div>
        )}
      </div>

      {/* Human battlefield */}
      <div className="px-3 py-2 border-t border-stone-700">
        <div className="flex items-center justify-between mb-1">
          <span className="text-stone-400 text-xs">
            {human?.name || 'You'} — {human?.life || 0} life
          </span>
        </div>
        <div className="flex flex-wrap gap-1 min-h-[40px]">
          {humanBattlefield.map((card: any) => {
            const cardActions = actionsForCard(card.instanceId);
            const clickable = isHumanTurn && cardActions.length > 0;
            return (
              <div
                key={card.instanceId}
                onClick={() => clickable && onAction(cardActions[0])}
                className={`px-2 py-1 rounded text-xs border transition-colors ${
                  card.tapped
                    ? 'bg-stone-700 border-stone-600 opacity-60 italic'
                    : clickable
                      ? 'bg-green-900 border-green-700 cursor-pointer hover:bg-green-800'
                      : 'bg-stone-700 border-stone-600'
                }`}
              >
                {card.name}
                {card.power != null && ` ${card.power}/${card.toughness}`}
              </div>
            );
          })}
          {humanBattlefield.length === 0 && (
            <span className="text-stone-600 text-xs italic">No permanents</span>
          )}
        </div>
      </div>

      {/* Human hand */}
      <div className="px-3 py-2 border-t border-stone-700 bg-stone-800">
        <div className="text-stone-400 text-xs mb-1">Hand ({humanHand.length})</div>
        <div className="flex flex-wrap gap-1">
          {humanHand.map((card: any) => {
            const cardActions = actionsForCard(card.instanceId);
            const clickable = isHumanTurn && cardActions.length > 0;
            return (
              <div
                key={card.instanceId}
                onClick={() => clickable && onAction(cardActions[0])}
                className={`px-2 py-1.5 rounded text-xs border transition-colors ${
                  clickable
                    ? 'bg-blue-900 border-blue-700 cursor-pointer hover:bg-blue-800'
                    : 'bg-stone-700 border-stone-600'
                }`}
              >
                {card.name} {card.mana_cost && `[${card.mana_cost}]`}
              </div>
            );
          })}
        </div>
        {/* Pass priority button */}
        {isHumanTurn && passAction && (
          <button
            onClick={() => onAction(passAction)}
            className="mt-2 px-3 py-1 rounded bg-stone-600 text-stone-200 text-xs hover:bg-stone-500"
          >
            Pass Priority
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

---

### Task 5: GameChat Component (React)

**Files:**
- Create: `frontend/src/components/GameChat.tsx`

- [ ] **Step 1: Implement GameChat**

```typescript
// frontend/src/components/GameChat.tsx
import { useRef, useEffect } from 'react';

interface ChatMessage {
  role: 'shelector' | 'system' | 'player';
  text: string;
  timestamp: number;
}

interface GameChatProps {
  messages: ChatMessage[];
  isGameOver: boolean;
  winner: string | null;
}

export function GameChat({ messages, isGameOver, winner }: GameChatProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex flex-col h-full bg-stone-50">
      <div className="px-3 py-2 border-b border-stone-200 bg-white">
        <h3 className="font-serif text-sm font-semibold text-stone-800">
          Shelector Commentary
        </h3>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {messages.map((msg, i) => (
          <div key={i} className={`text-sm ${
            msg.role === 'system'
              ? 'text-stone-400 italic text-center text-xs'
              : msg.role === 'shelector'
                ? 'text-stone-800'
                : 'text-blue-700'
          }`}>
            {msg.role === 'shelector' && (
              <span className="font-semibold text-amber-700">Shelector: </span>
            )}
            {msg.text}
          </div>
        ))}

        {isGameOver && (
          <div className="text-center py-4">
            <div className="text-lg font-serif font-bold text-stone-800">
              Game Over
            </div>
            <div className="text-stone-600">
              {winner} wins!
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

---

### Task 6: ShelectorGamePage + Routing (React)

**Files:**
- Create: `frontend/src/pages/ShelectorGamePage.tsx`
- Modify: `frontend/src/router.tsx`

- [ ] **Step 1: Implement ShelectorGamePage**

Split-panel page: board left (70%), chat right (30%). Starts with a simple "Start Game" button that spawns an opponent and begins.

```typescript
// frontend/src/pages/ShelectorGamePage.tsx
import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Swords } from 'lucide-react';
import { GameBoard } from '../components/GameBoard';
import { GameChat } from '../components/GameChat';
import { useShelectorGame } from '../hooks/useShelectorGame';

const SHELECTOR_API = 'http://localhost:8100';

export function ShelectorGamePage() {
  const [config, setConfig] = useState<any>(null);
  const [opponentInfo, setOpponentInfo] = useState<any>(null);
  const [starting, setStarting] = useState(false);

  const game = useShelectorGame(config);

  const handleStartGame = useCallback(async () => {
    setStarting(true);
    try {
      // Spawn opponent
      const spawnRes = await fetch(`${SHELECTOR_API}/spawn-opponent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bracket: 3 }),
      });
      if (!spawnRes.ok) throw new Error('Failed to spawn opponent');
      const opponent = await spawnRes.json();
      setOpponentInfo(opponent);

      // For now, use placeholder deck data
      // In production, this would load real deck cards from the backend
      setConfig({
        humanDeckCards: [],
        humanCommander: 'Your Commander',
        aiDeckCards: [],
        aiCommander: opponent.commander,
        aiPersonality: opponent.personality,
        bracket: 3,
        cardLookup: (name: string) => null,
      });
    } catch (err: any) {
      console.error('Failed to start:', err);
    } finally {
      setStarting(false);
    }
  }, []);

  // Pre-game screen
  if (!config) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-stone-50">
        <Link to="/shelector" className="absolute top-4 left-4 text-stone-500 hover:text-stone-800">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <Swords className="w-16 h-16 text-stone-300 mb-4" />
        <h1 className="font-serif text-2xl font-bold text-stone-800 mb-2">
          Play Against The Shelector
        </h1>
        <p className="text-stone-500 mb-6 text-center max-w-md">
          The Shelector will pick an opponent and play Commander against you.
          It narrates every decision it makes.
        </p>
        <button
          onClick={handleStartGame}
          disabled={starting}
          className="px-6 py-3 bg-stone-800 text-white rounded-lg font-medium
                     hover:bg-stone-700 disabled:opacity-50 transition-colors"
        >
          {starting ? 'Spawning opponent...' : 'Start Game'}
        </button>
      </div>
    );
  }

  // Game screen — split panel
  return (
    <div className="flex h-screen">
      {/* Board (left 70%) */}
      <div className="w-[70%] border-r border-stone-300">
        <GameBoard
          gameState={game.gameState}
          legalActions={game.legalActions}
          isHumanTurn={game.isHumanTurn}
          isLoading={game.isLoading}
          onAction={game.submitAction}
        />
      </div>

      {/* Chat (right 30%) */}
      <div className="w-[30%]">
        <GameChat
          messages={game.chat}
          isGameOver={game.isGameOver}
          winner={game.winner}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add route**

```typescript
// Add to router.tsx
import { ShelectorGamePage } from './pages/ShelectorGamePage';

// Add to routes array:
{
  path: '/shelector/game',
  element: <ShelectorGamePage />,
},
```

- [ ] **Step 3: Verify frontend compiles**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 4: Commit**

---

### Task 7: Integration Test

- [ ] **Step 1: Start all servers**

```bash
source .venv/Scripts/activate
python -m backend.agent.server &  # port 8100
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 &  # port 8000
cd frontend && npx vite --host 0.0.0.0 &  # port 5173
```

- [ ] **Step 2: Test /spawn-opponent**

```bash
curl -s http://localhost:8100/spawn-opponent \
  -X POST -H "Content-Type: application/json" \
  -d '{"bracket": 3}'
```
Expected: JSON with commander, personality, colors

- [ ] **Step 3: Test /decide**

```bash
curl -s http://localhost:8100/decide \
  -X POST -H "Content-Type: application/json" \
  -d '{"game_state":{"players":[{"id":"h","name":"Human","life":40},{"id":"a","name":"AI","life":40}],"turnNumber":1,"phase":"main1","stack":[]},"cards":{},"definitions":{},"legal_actions":[{"kind":"PassPriority"}],"player_id":"a"}'
```
Expected: JSON with action + narration

- [ ] **Step 4: Open browser**

Navigate to `http://localhost:5173/shelector/game`
Expected: Pre-game screen with "Start Game" button

- [ ] **Step 5: Click Start Game**

Expected: Opponent spawned, game board renders, chat shows Shelector introduction

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: Shelector game integration — play Commander against the AI agent"
```
