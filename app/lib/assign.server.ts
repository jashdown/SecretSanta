import { randomInt } from "node:crypto";

export const MIN_PARTICIPANTS = 3;

// The step-by-step search restarts from scratch now and then, because an early
// bad choice can leave it digging through dead ends for a long time. The
// limits keep an impossible set of restrictions from tying up the server, and
// one run is still enough to try every loop for groups of up to 7.
const SEARCH_RESTARTS = 20;
const SEARCH_STEPS = 2000;

export type Pair = { giverId: number; receiverId: number };

export const pairKey = (giverId: number, receiverId: number) =>
  `${giverId}->${receiverId}`;

/** Names can't be drawn. The message is meant for the organizer. */
export class DrawError extends Error {
  name = "DrawError";
}

export type DrawOptions = {
  /** Pairs that must never be drawn, from pairKey (the organizer's restrictions). */
  blocked?: ReadonlySet<string>;
  /** Pairs to steer clear of when possible, from pairKey (e.g. last year's draw). */
  avoid?: ReadonlySet<string>;
  attempts?: number;
  random?: (max: number) => number;
};

/**
 * Puts everyone in one random gift-giving loop (A→B→C→…→A), so nobody draws
 * themselves and no two people draw each other. Never uses a `blocked` pair.
 * Tries many loops and keeps the one that repeats the fewest pairs from
 * `avoid`.
 */
export function drawPairs(
  ids: number[],
  { blocked = new Set(), avoid = new Set(), attempts = 2000, random = randomInt }: DrawOptions = {},
): Pair[] {
  if (ids.length < MIN_PARTICIPANTS) {
    throw new DrawError(`Need at least ${MIN_PARTICIPANTS} participants.`);
  }

  let best: Pair[] | null = null;
  let bestRepeats = Infinity;

  for (let i = 0; i < attempts && bestRepeats > 0; i++) {
    const pairs = toPairs(shuffle(ids, random));
    if (pairs.some(isIn(blocked))) continue;
    const repeats = pairs.filter(isIn(avoid)).length;
    if (repeats < bestRepeats) {
      best = pairs;
      bestRepeats = repeats;
    }
  }

  // Restrictions can make allowed loops too rare for random tries to hit, and
  // last time's pairings can do the same to loops that repeat none of them.
  // So search step by step: first for a loop with no repeats at all...
  if (bestRepeats > 0 && avoid.size > 0) {
    const fresh = searchLoops(ids, new Set([...blocked, ...avoid]), new Set(), random);
    if (fresh) best = toPairs(fresh);
  }
  // ...then for any allowed loop, with as few repeats as it can find.
  if (!best) {
    const loop = searchLoops(ids, blocked, avoid, random);
    if (loop) best = toPairs(loop);
  }

  if (!best) {
    throw new DrawError(
      "Couldn't find a way to draw names that fits everyone's restrictions. Try removing one.",
    );
  }

  // Sort so the stored order doesn't reveal the loop.
  return best.sort((a, b) => a.giverId - b.giverId);
}

const isIn = (keys: ReadonlySet<string>) => (pair: Pair) =>
  keys.has(pairKey(pair.giverId, pair.receiverId));

const toPairs = (loop: number[]): Pair[] =>
  loop.map((giverId, index) => ({ giverId, receiverId: loop[(index + 1) % loop.length] }));

/**
 * Runs the step-by-step search from several fresh starts and returns the loop
 * that repeats the fewest pairs from `avoid`, or null if it found none.
 */
function searchLoops(
  ids: number[],
  blocked: ReadonlySet<string>,
  avoid: ReadonlySet<string>,
  random: (max: number) => number,
): number[] | null {
  let best: number[] | null = null;
  let bestRepeats = Infinity;
  for (let i = 0; i < SEARCH_RESTARTS && bestRepeats > 0; i++) {
    const loop = searchLoop(ids, blocked, avoid, random);
    if (!loop) continue;
    const repeats = toPairs(loop).filter(isIn(avoid)).length;
    if (repeats < bestRepeats) {
      best = loop;
      bestRepeats = repeats;
    }
  }
  return best;
}

/**
 * Builds a loop one person at a time, backing up when it gets stuck, and
 * returns null if it runs out of steps first. Slower than random tries, but it
 * finds the loops that restrictions have made rare. Tries fresh pairings
 * before ones in `avoid`.
 */
function searchLoop(
  ids: number[],
  blocked: ReadonlySet<string>,
  avoid: ReadonlySet<string>,
  random: (max: number) => number,
): number[] | null {
  const allowed = (giver: number, receiver: number) =>
    giver !== receiver && !blocked.has(pairKey(giver, receiver));
  const giversOf = new Map(ids.map((id) => [id, ids.filter((giver) => allowed(giver, id))]));

  const [first, ...rest] = shuffle(ids, random);
  const loop = [first];
  const left = new Set(rest);
  let steps = 0;

  // Once `next` joins the loop, everyone not yet in it still needs someone
  // left who can give to them, and so does the first person, to close the loop.
  const stillPossible = (next: number) =>
    [...left, first].every((id) =>
      giversOf.get(id)!.some((giver) => giver === next || left.has(giver)),
    );

  const extend = (current: number): boolean => {
    if (left.size === 0) return true;
    // Hardest to place first: people that few of those left could give to.
    // Then fresh pairings before last time's. Shuffling first breaks ties.
    const options = shuffle(
      [...left].filter((id) => allowed(current, id)),
      random,
    )
      .map((id) => ({
        id,
        givers: giversOf.get(id)!.filter((giver) => left.has(giver)).length,
        repeat: Number(avoid.has(pairKey(current, id))),
      }))
      .sort((a, b) => a.givers - b.givers || a.repeat - b.repeat)
      .map((option) => option.id);

    for (const next of options) {
      if (++steps > SEARCH_STEPS) return false;
      left.delete(next);
      loop.push(next);
      if (stillPossible(next) && extend(next)) return true;
      left.add(next);
      loop.pop();
    }
    return false;
  };

  return extend(first) ? loop : null;
}

function shuffle<T>(items: T[], random: (max: number) => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
