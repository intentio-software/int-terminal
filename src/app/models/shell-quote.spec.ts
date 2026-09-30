import { quoteForShell, quotePaths } from "./shell-quote";

describe("quoteForShell", () => {
  it("leaves an ordinary path alone, so the prompt stays readable", () => {
    expect(quoteForShell("/Users/max/work/shot.png")).toBe("/Users/max/work/shot.png");
  });

  it("quotes a path with spaces, which is the whole point", () => {
    expect(quoteForShell("/Users/max/My Photos/shot 1.png")).toBe(
      "'/Users/max/My Photos/shot 1.png'"
    );
  });

  it("survives a single quote in the name", () => {
    // The close-escape-reopen dance: '...'\''...'
    expect(quoteForShell("/tmp/max's file.png")).toBe(`'/tmp/max'\\''s file.png'`);
  });

  it("quotes characters a shell would otherwise act on", () => {
    for (const nasty of ["/tmp/a;rm -rf b.png", "/tmp/$(whoami).png", "/tmp/a|b.png", "/tmp/a*.png"]) {
      const quoted = quoteForShell(nasty);
      expect(quoted.startsWith("'")).toBe(true);
      expect(quoted.endsWith("'")).toBe(true);
    }
  });

  it("joins several files as several arguments", () => {
    expect(quotePaths(["/tmp/a.png", "/tmp/b c.png"])).toBe("/tmp/a.png '/tmp/b c.png'");
  });

  it("handles nothing dropped", () => {
    expect(quotePaths([])).toBe("");
  });
});
