import type { SimpleGameState, StackItemView } from '../gameView.types';

type SimpleStack = SimpleGameState['stack'];
type SimpleStackItem = SimpleStack[number];

/** Resolves a player/controller id to a display name for the UI. */
export type NameResolver = (playerId: string) => string;

function describe(item: SimpleStackItem): string {
  const base = item.name;
  if (item.targetNames.length > 0) {
    return `${base} targeting ${item.targetNames.join(', ')}`;
  }
  return base;
}

/**
 * Reshapes the hook's `SimpleGameState.stack` into ordered, self-explaining stack
 * items. The engine stores the stack with the TOP (next to resolve) as the LAST
 * element (LIFO). We reverse so index 0 is the next-to-resolve item and flag it
 * `resolvesNext`. Description is synthesized from name + targetNames (the only
 * plain-language data available).
 */
export function stackView(simpleStack: SimpleStack, nameFor: NameResolver): StackItemView[] {
  // Top of stack resolves first → reverse the engine order so index 0 is next.
  return [...simpleStack]
    .reverse()
    .map((item, index) => ({
      id: item.id,
      controllerName: nameFor(item.casterId),
      title: item.name,
      description: describe(item),
      resolvesNext: index === 0,
    }));
}
