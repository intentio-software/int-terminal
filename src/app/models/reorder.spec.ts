import { Extent, indexAt, move } from "./reorder";

describe("move", () => {
  const tabs = ["a", "b", "c", "d"];

  it("moves an item forwards", () => {
    expect(move(tabs, 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves an item backwards", () => {
    expect(move(tabs, 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("moving somewhere to itself changes nothing", () => {
    expect(move(tabs, 2, 2)).toEqual(tabs);
  });

  it("leaves the original alone", () => {
    const original = [...tabs];
    move(tabs, 0, 3);
    expect(tabs).toEqual(original);
  });

  it("refuses an index that is not there", () => {
    // A stale index during a drag must not drop a tab or duplicate one.
    expect(move(tabs, -1, 2)).toEqual(tabs);
    expect(move(tabs, 1, 9)).toEqual(tabs);
  });
});

describe("indexAt", () => {
  // Four tabs, 100 wide, starting at 0.
  const extents: Extent[] = [0, 100, 200, 300].map((left) => ({ left, width: 100 }));

  it("is the tab the cursor is in the first half of", () => {
    expect(indexAt(extents, 10)).toBe(0);
    expect(indexAt(extents, 149)).toBe(1);
  });

  it("swaps once the cursor passes a middle, not before", () => {
    expect(indexAt(extents, 49)).toBe(0);
    expect(indexAt(extents, 51)).toBe(1);
  });

  it("past the last tab is the end of the strip", () => {
    expect(indexAt(extents, 5000)).toBe(3);
  });

  it("before the first tab is the start", () => {
    expect(indexAt(extents, -40)).toBe(0);
  });

  it("an empty strip has nowhere to land", () => {
    expect(indexAt([], 10)).toBe(0);
  });
});
