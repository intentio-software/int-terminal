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
  // Four tabs, 100 wide, 32 tall, all on one row.
  const extents: Extent[] = [0, 100, 200, 300].map((left) => ({ left, width: 100, top: 0, height: 32 }));

  it("is the tab the cursor is in the first half of", () => {
    expect(indexAt(extents, 10, 16)).toBe(0);
    expect(indexAt(extents, 149, 16)).toBe(1);
  });

  it("swaps once the cursor passes a middle, not before", () => {
    expect(indexAt(extents, 49, 16)).toBe(0);
    expect(indexAt(extents, 51, 16)).toBe(1);
  });

  it("past the last tab is the end of the strip", () => {
    expect(indexAt(extents, 5000, 16)).toBe(3);
  });

  it("before the first tab is the start", () => {
    expect(indexAt(extents, -40, 16)).toBe(0);
  });

  it("an empty strip has nowhere to land", () => {
    expect(indexAt([], 10, 10)).toBe(0);
  });
});

describe("indexAt, once the strip has wrapped", () => {
  // Six tabs, 100 wide, three to a row: 0,1,2 on top; 3,4,5 below.
  const wrapped: Extent[] = [
    { left: 0, width: 100, top: 0, height: 32 },
    { left: 100, width: 100, top: 0, height: 32 },
    { left: 200, width: 100, top: 0, height: 32 },
    { left: 0, width: 100, top: 34, height: 32 },
    { left: 100, width: 100, top: 34, height: 32 },
    { left: 200, width: 100, top: 34, height: 32 }
  ];

  it("picks by row before it picks by column", () => {
    // The same x on each row. Without the row, both would answer 0.
    expect(indexAt(wrapped, 10, 16)).toBe(0);
    expect(indexAt(wrapped, 10, 50)).toBe(3);
  });

  it("applies the midpoint rule inside the row the cursor is on", () => {
    // Tab 4 spans 100 to 200 on the second row, so its middle is 150.
    expect(indexAt(wrapped, 149, 50)).toBe(4);
    expect(indexAt(wrapped, 151, 50)).toBe(5);
    expect(indexAt(wrapped, 249, 50)).toBe(5);
  });

  it("past the end of a row stays on that row", () => {
    // Not the end of the strip: dragging off the right of the first row means
    // the end of the first row, which is where it looks like it will land.
    expect(indexAt(wrapped, 5000, 16)).toBe(2);
    expect(indexAt(wrapped, 5000, 50)).toBe(5);
  });

  it("below the last row lands on the last row", () => {
    expect(indexAt(wrapped, 10, 400)).toBe(3);
  });

  it("above the first row lands on the first row", () => {
    expect(indexAt(wrapped, 250, -40)).toBe(2);
  });

  it("does not split a row over a pixel of rounding", () => {
    // Sub-pixel layout: tops on one row rarely agree to the decimal.
    const jittery: Extent[] = [
      { left: 0, width: 100, top: 0, height: 32 },
      { left: 100, width: 100, top: 0.4, height: 32 },
      { left: 200, width: 100, top: -0.3, height: 32 }
    ];
    expect(indexAt(jittery, 250, 16)).toBe(2);
  });
});
