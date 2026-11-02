import { describe, expect, it, vi } from "vitest";
import { drawPairs, MIN_PARTICIPANTS, pairKey, type Pair } from "./assign.server";

const ids = (count: number) => Array.from({ length: count }, (_, i) => i + 1);

/** How many steps it takes to get from the first giver back to them. */
function loopLength(pairs: Pair[]) {
  const next = new Map(pairs.map((p) => [p.giverId, p.receiverId]));
  const start = pairs[0].giverId;
  let current = next.get(start);
  let steps = 1;
  while (current !== start && current !== undefined && steps <= pairs.length) {
    current = next.get(current);
    steps++;
  }
  return current === start ? steps : Infinity;
}

const repeatsOf = (pairs: Pair[], avoid: Set<string>) =>
  pairs.filter((p) => avoid.has(pairKey(p.giverId, p.receiverId))).length;

const keysOf = (pairs: Pair[]) => new Set(pairs.map((p) => pairKey(p.giverId, p.receiverId)));

describe("drawPairs", () => {
  it.each([0, 1, 2])("refuses to draw for %i people", (count) => {
    expect(() => drawPairs(ids(count))).toThrow(`Need at least ${MIN_PARTICIPANTS} participants.`);
  });

  it.each([3, 4, 5, 10, 50])("puts all %i people in one loop", (count) => {
    for (let run = 0; run < 20; run++) {
      const pairs = drawPairs(ids(count));

      expect(pairs.map((p) => p.giverId)).toEqual(ids(count));
      expect(pairs.map((p) => p.receiverId).sort((a, b) => a - b)).toEqual(ids(count));
      for (const { giverId, receiverId } of pairs) {
        expect(receiverId).not.toBe(giverId);
        // Nobody is buying for the person buying for them.
        expect(pairs).not.toContainEqual({ giverId: receiverId, receiverId: giverId });
      }
      expect(loopLength(pairs)).toBe(count);
    }
  });

  it("sorts pairs by giver so the stored order doesn't give the loop away", () => {
    const pairs = drawPairs([42, 7, 19, 3]);
    expect(pairs.map((p) => p.giverId)).toEqual([3, 7, 19, 42]);
  });

  it("leaves the list it was given alone", () => {
    const input = [5, 1, 4, 2, 3];
    drawPairs(input);
    expect(input).toEqual([5, 1, 4, 2, 3]);
  });

  it("uses the random source it's given", () => {
    const alwaysZero = () => 0;
    // With j always 0 the shuffle turns [1, 2, 3] into [2, 3, 1]: 2→3→1→2.
    expect(drawPairs([1, 2, 3], new Set(), 1, alwaysZero)).toEqual([
      { giverId: 1, receiverId: 2 },
      { giverId: 2, receiverId: 3 },
      { giverId: 3, receiverId: 1 },
    ]);
  });

  it("stops looking as soon as it finds a loop with no repeats", () => {
    const random = vi.fn(() => 0);
    drawPairs(ids(5), new Set(), 2000, random);
    // One shuffle of 5 people asks for 4 random numbers.
    expect(random).toHaveBeenCalledTimes(4);
  });

  it("avoids last time's pairings when it can", () => {
    for (let run = 0; run < 20; run++) {
      const lastYear = keysOf(drawPairs(ids(6)));
      expect(repeatsOf(drawPairs(ids(6), lastYear), lastYear)).toBe(0);
    }
  });

  it("finds the only other loop when there are 3 people", () => {
    // 3 people can only form 1→2→3→1 or 1→3→2→1.
    const avoid = keysOf([
      { giverId: 1, receiverId: 2 },
      { giverId: 2, receiverId: 3 },
      { giverId: 3, receiverId: 1 },
    ]);
    expect(drawPairs([1, 2, 3], avoid)).toEqual([
      { giverId: 1, receiverId: 3 },
      { giverId: 2, receiverId: 1 },
      { giverId: 3, receiverId: 2 },
    ]);
  });

  it("keeps repeats to a minimum when some can't be avoided", () => {
    // Everything person 1 could give is on the list, so every loop has at
    // least one repeat. Loops that also use 2→3 have two.
    const avoid = new Set([pairKey(1, 2), pairKey(1, 3), pairKey(1, 4), pairKey(2, 3)]);
    for (let run = 0; run < 20; run++) {
      const pairs = drawPairs(ids(4), avoid);
      expect(loopLength(pairs)).toBe(4);
      expect(repeatsOf(pairs, avoid)).toBe(1);
    }
  });
});

describe("pairKey", () => {
  it("cares about direction", () => {
    expect(pairKey(1, 2)).not.toBe(pairKey(2, 1));
  });
});
