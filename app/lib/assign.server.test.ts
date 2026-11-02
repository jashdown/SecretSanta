import { describe, expect, it, vi } from "vitest";
import { DrawError, drawPairs, MIN_PARTICIPANTS, pairKey, type Pair } from "./assign.server";

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
    expect(drawPairs([1, 2, 3], { attempts: 1, random: alwaysZero })).toEqual([
      { giverId: 1, receiverId: 2 },
      { giverId: 2, receiverId: 3 },
      { giverId: 3, receiverId: 1 },
    ]);
  });

  it("stops looking as soon as it finds a loop with no repeats", () => {
    const random = vi.fn(() => 0);
    drawPairs(ids(5), { random });
    // One shuffle of 5 people asks for 4 random numbers.
    expect(random).toHaveBeenCalledTimes(4);
  });

  it("avoids last time's pairings when it can", () => {
    for (let run = 0; run < 20; run++) {
      const lastYear = keysOf(drawPairs(ids(6)));
      expect(repeatsOf(drawPairs(ids(6), { avoid: lastYear }), lastYear)).toBe(0);
    }
  });

  it("finds the only other loop when there are 3 people", () => {
    // 3 people can only form 1→2→3→1 or 1→3→2→1.
    const avoid = keysOf([
      { giverId: 1, receiverId: 2 },
      { giverId: 2, receiverId: 3 },
      { giverId: 3, receiverId: 1 },
    ]);
    expect(drawPairs([1, 2, 3], { avoid })).toEqual([
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
      const pairs = drawPairs(ids(4), { avoid });
      expect(loopLength(pairs)).toBe(4);
      expect(repeatsOf(pairs, avoid)).toBe(1);
    }
  });
});

describe("drawPairs with restrictions", () => {
  const usesAny = (pairs: Pair[], blocked: Set<string>) => repeatsOf(pairs, blocked) > 0;

  it("never draws a restricted pair", () => {
    // Couples who can't draw each other, plus a few one-way restrictions.
    const blocked = new Set([
      pairKey(1, 2), pairKey(2, 1),
      pairKey(3, 4), pairKey(4, 3),
      pairKey(5, 6), pairKey(6, 5),
      pairKey(1, 3), pairKey(2, 4), pairKey(5, 1),
    ]);
    for (let run = 0; run < 50; run++) {
      const pairs = drawPairs(ids(6), { blocked });
      expect(loopLength(pairs)).toBe(6);
      expect(usesAny(pairs, blocked)).toBe(false);
    }
  });

  it("follows restrictions even if that means repeating last time's pairings", () => {
    // Only 1→3→2→1 is allowed, and it's exactly last year's draw.
    const blocked = new Set([pairKey(1, 2)]);
    const avoid = new Set([pairKey(1, 3), pairKey(3, 2), pairKey(2, 1)]);
    expect(drawPairs([1, 2, 3], { blocked, avoid })).toEqual([
      { giverId: 1, receiverId: 3 },
      { giverId: 2, receiverId: 1 },
      { giverId: 3, receiverId: 2 },
    ]);
  });

  it("explains when no draw fits the restrictions", () => {
    // A couple in a group of 3: either loop has one of them giving to the other.
    const blocked = new Set([pairKey(1, 2), pairKey(2, 1)]);
    expect(() => drawPairs([1, 2, 3], { blocked })).toThrow(
      new DrawError(
        "Couldn't find a way to draw names that fits everyone's restrictions. Try removing one.",
      ),
    );
  });

  it("gives up when nobody is allowed to give to someone", () => {
    // Everyone else has ruled out person 1.
    const blocked = new Set(ids(10).slice(1).map((giver) => pairKey(giver, 1)));
    expect(() => drawPairs(ids(10), { blocked })).toThrow(DrawError);
  });

  it("searches step by step when random tries find nothing", () => {
    // No random tries at all, so the step-by-step search has to do the work.
    const blocked = new Set([pairKey(1, 2), pairKey(2, 3), pairKey(3, 4), pairKey(4, 1)]);
    for (let run = 0; run < 20; run++) {
      const pairs = drawPairs(ids(5), { blocked, attempts: 0 });
      expect(loopLength(pairs)).toBe(5);
      expect(usesAny(pairs, blocked)).toBe(false);
    }
  });

  it("finds the only allowed loop", () => {
    // Everyone has ruled out both people other than the one after them.
    const blocked = new Set([
      pairKey(1, 3), pairKey(1, 4),
      pairKey(2, 1), pairKey(2, 4),
      pairKey(3, 1), pairKey(3, 2),
      pairKey(4, 2), pairKey(4, 3),
    ]);
    expect(drawPairs(ids(4), { blocked, attempts: 0 })).toEqual([
      { giverId: 1, receiverId: 2 },
      { giverId: 2, receiverId: 3 },
      { giverId: 3, receiverId: 4 },
      { giverId: 4, receiverId: 1 },
    ]);
  });

  it("finds a loop that random tries would almost always miss", () => {
    // Only people 1 and 2 may give to 39 and 40, who can't give to each other.
    // About 1 random loop in 740 fits.
    const people = ids(40);
    const blocked = new Set([pairKey(39, 40), pairKey(40, 39)]);
    for (const giver of people.slice(2, 38)) {
      blocked.add(pairKey(giver, 39));
      blocked.add(pairKey(giver, 40));
    }
    for (let run = 0; run < 10; run++) {
      const pairs = drawPairs(people, { blocked, attempts: 0 });
      expect(loopLength(pairs)).toBe(40);
      expect(usesAny(pairs, blocked)).toBe(false);
    }
  });
});

describe("pairKey", () => {
  it("cares about direction", () => {
    expect(pairKey(1, 2)).not.toBe(pairKey(2, 1));
  });
});
