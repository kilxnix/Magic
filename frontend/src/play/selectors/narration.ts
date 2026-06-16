import type { ChatMessage, NarrationEntry, NarrationKind } from '../gameView.types';

/**
 * Classifies a plain-language chat line into a narration kind so the UI can style
 * the self-explaining log (triggers vs. resolutions vs. phase changes vs. plays).
 * Heuristic keyword match — narration is descriptive, not authoritative.
 */
function classify(text: string): NarrationKind {
  const lower = text.toLowerCase();
  if (lower.includes('trigger')) return 'trigger';
  if (lower.includes('resolve')) return 'resolve';
  if (
    lower.includes('phase') ||
    lower.includes('step') ||
    lower.includes('upkeep') ||
    lower.includes('combat begins') ||
    lower.includes('turn ')
  ) {
    return 'phase';
  }
  return 'action';
}

/**
 * Turns the hook's `chatMessages` (the closest thing to plain-language narration)
 * into NarrationEntry[]. Empty/whitespace lines are dropped; each entry gets a
 * stable, unique id derived from its index + timestamp.
 */
export function narration(messages: ChatMessage[] | undefined | null): NarrationEntry[] {
  if (!messages?.length) return [];
  const entries: NarrationEntry[] = [];
  messages.forEach((message, index) => {
    const text = message.text?.trim();
    if (!text) return;
    entries.push({
      id: `narration-${index}-${message.timestamp}`,
      kind: classify(text),
      text: message.text,
    });
  });
  return entries;
}
