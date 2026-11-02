import { randomInt } from "node:crypto";

export const MIN_PARTICIPANTS = 3;

export type Pair = { giverId: number; receiverId: number };

export const pairKey = (giverId: number, receiverId: number) =>
  `${giverId}->${receiverId}`;

/**
 * Puts everyone in one random gift-giving loop (A→B→C→…→A), so nobody draws
 * themselves and no two people draw each other. Tries many loops and keeps
 * the one that repeats the fewest pairs from `avoid` (e.g. last year's draw).
 */
export function drawPairs(
  ids: number[],
  avoid: ReadonlySet<string> = new Set(),
  attempts = 2000,
  random: (max: number) => number = randomInt,
): Pair[] {
  if (ids.length < MIN_PARTICIPANTS) {
    throw new Error(`Need at least ${MIN_PARTICIPANTS} participants.`);
  }

  let best: Pair[] = [];
  let bestRepeats = Infinity;

  for (let i = 0; i < attempts && bestRepeats > 0; i++) {
    const loop = shuffle(ids, random);
    const pairs = loop.map((giverId, index) => ({
      giverId,
      receiverId: loop[(index + 1) % loop.length],
    }));
    const repeats = pairs.filter((p) => avoid.has(pairKey(p.giverId, p.receiverId))).length;
    if (repeats < bestRepeats) {
      best = pairs;
      bestRepeats = repeats;
    }
  }

  // Sort so the stored order doesn't reveal the loop.
  return best.sort((a, b) => a.giverId - b.giverId);
}

function shuffle<T>(items: T[], random: (max: number) => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
