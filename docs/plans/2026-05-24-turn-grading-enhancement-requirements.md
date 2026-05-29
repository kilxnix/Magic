# Deck Training And Play-By-Play Review Requirements

## Product Goal

Magic Brains is a training platform for a player's own MTG decks. The core loop is:

1. Import the deck the player wants to practice with.
2. Play a full practice game against local AI opponents.
3. After the game is over, open a play-by-play review that reconstructs the important turns, grades decisions, and explains better lines when available.

Deck generation is not part of the launch promise for this workflow. Any generated or curated AI decks should support the training table, not become the product surface.

## Current State

The web game review currently grades moves in `frontend/src/components/GameReview.tsx` with client-side heuristics. It reads each `GameLogEntry`, checks broad signals such as mana spent, board creature counts, life totals, attacks, and likely counterplay, then assigns `excellent`, `good`, `okay`, `bad`, or `blunder`.

That is useful for launch visibility, but it is not yet a strategic evaluator or a complete post-game play-by-play. The next enhancement should record each decision during gameplay, then produce a post-game review that compares the chosen action against the other legal choices available at that exact game state.

## Functional Requirements

1. Capture a full before-and-after snapshot for every meaningful decision:
   - active player, priority holder, phase and step
   - life totals, commander damage, poison, initiative/monarch if supported
   - battlefield, hand size, graveyard, exile, command zone, library count
   - mana pools, available mana sources, lands played, spells cast this turn
   - stack contents, targets, selected modes, costs paid, triggers pending
   - legal actions available to the player at that moment

2. Assign stable action metadata:
   - action id
   - action type such as cast, activate, attack, block, pass, mulligan, discard, tutor, target, mode choice
   - chosen card or object ids
   - declared targets
   - randomness seed and engine version

3. Generate legal alternatives for each decision:
   - all castable spells and activated abilities
   - legal attack and block sets
   - possible target choices
   - pass priority and hold interaction lines
   - mulligan, discard, tutor, and modal choices

4. Score alternatives against a board evaluator:
   - win probability or board equity estimate
   - material/resource delta
   - tempo and mana efficiency
   - threat answered or created
   - protection against known and inferred interaction
   - bracket-aware risk tolerance

5. Support short simulation:
   - evaluate immediate result
   - optionally simulate 1-3 plies with AI responses
   - use deterministic seeds for repeatable reviews
   - cap runtime for browser responsiveness

6. Produce explainable grades:
   - letter or rating for each action
   - confidence level
   - best available alternative when the chosen move was weak
   - concise reason grounded in game state diffs
   - per-turn aggregate grade
   - game-level accuracy score
   - a play-by-play sentence that describes what happened and why it mattered

7. Handle imperfect card coverage:
   - include parser confidence in the score
   - mark grades as low-confidence when a card is using fallback behavior
   - add manual overrides for high-impact cards that distort grading

## Data And API Requirements

1. Extend game logs to persist rich `DecisionRecord` objects rather than only display strings.
2. Add an engine-side grading module so grading can run consistently outside React.
3. Expose a review API or shared TypeScript function that accepts a serialized game plus decision records.
4. Version the grading schema and evaluator weights.
5. Store generated reviews with saved games so users can reopen the same grade later.

## Calibration Requirements

1. Build golden test games with known best moves and known mistakes.
2. Label a small set of real games manually to tune grades.
3. Track agreement between evaluator grades and expert labels.
4. Add regression tests for:
   - attacks into profitable/unprofitable blocks
   - holding removal versus tapping out
   - playing on curve
   - counterspell baiting
   - tutor target quality
   - lethal and missed lethal

## UX Requirements

1. Keep the review as a post-game surface:
   - show it automatically when the game ends
   - keep any live coach optional and visually separate from final grading
   - allow reopening the finished game review from saved games

2. Keep the current timeline, but add:
   - per-turn grade summary
   - "best line" callout for bad moves and blunders
   - confidence badge
   - board delta view
   - filter for mistakes only
   - full play-by-play mode for reading the game in chronological order

3. Avoid overclaiming:
   - label heuristic grades clearly
   - label low-confidence parser states
   - explain when hidden information limits certainty

## Performance Requirements

1. Immediate heuristic review should render in under 500 ms for normal games.
2. Deep alternative analysis can run in a background job or worker.
3. Long games should stream or progressively fill review details.
4. The evaluator must not block the active game loop.

## Launch Acceptance Criteria

1. A player can import their own deck and complete a practice game without relying on deck generation.
2. The post-game review opens after game over and shows a chronological play-by-play.
3. Each reviewed human action has a grade, reason, and confidence.
4. At least one better legal alternative is shown for weak moves when available.
5. Reviews are deterministic for the same saved game and evaluator version.
6. Golden tests cover the main decision types.
7. The UI clearly separates current heuristic grading from enhanced alternative-based grading.
