const {
  fetchSources,
  getHashKey,
  getPageFileName,
} = require("../lib/fetch-sources");
const { hashText } = require("../lib/page-text");

const A = "https://a.example/access";
const B = "https://b.example/access";
const C = "https://c.example/access";
const TODAY = "2026-11-20";

const pageTexts = { [A]: "Ramp at the door", [B]: "Lift to screen 2" };
const fetchText = jest.fn(async ({ url }) => {
  if (!(url in pageTexts)) throw new Error(`${url} answered 403`);
  return pageTexts[url];
});

beforeEach(() => fetchText.mockClear());

describe("fetchSources", () => {
  it("reports every page as new on the first run", async () => {
    const result = await fetchSources({
      sources: { "a.com": [{ url: A, tier: 1 }] },
      today: TODAY,
      fetchText,
    });
    expect(result.changed).toEqual([
      { venueId: "a.com", url: A, reason: "new" },
    ]);
    expect(result.hashes).toEqual({
      [A]: { hash: hashText(pageTexts[A]), fetched_on: TODAY },
    });
    expect(result.pages).toEqual([
      {
        venueId: "a.com",
        url: A,
        file: getPageFileName("a.com", A),
        hash: hashText(pageTexts[A]),
        text: pageTexts[A],
      },
    ]);
  });

  it("reports only the pages whose text changed", async () => {
    const result = await fetchSources({
      sources: {
        "a.com": [
          { url: A, tier: 1 },
          { url: B, tier: 2 },
        ],
      },
      previousHashes: {
        [A]: { hash: hashText(pageTexts[A]), fetched_on: "2026-10-20" },
        [B]: { hash: hashText("No lift"), fetched_on: "2026-10-20" },
      },
      today: TODAY,
      fetchText,
    });
    expect(result.changed).toEqual([
      { venueId: "a.com", url: B, reason: "changed" },
    ]);
  });

  it("records a failure, keeps going, and keeps the failed page's last hash", async () => {
    const previous = { hash: "abc", fetched_on: "2026-10-20" };
    const result = await fetchSources({
      sources: {
        "a.com": [
          { url: C, tier: 1 },
          { url: A, tier: 1 },
        ],
      },
      previousHashes: { [C]: previous },
      today: TODAY,
      fetchText,
    });
    expect(result.failures).toEqual([
      { venueId: "a.com", url: C, error: `${C} answered 403` },
    ]);
    expect(result.pages.map(({ url }) => url)).toEqual([A]);
    expect(result.hashes[C]).toEqual(previous);
  });

  it("fetches a page cited by two venues once", async () => {
    const result = await fetchSources({
      sources: {
        "a.com": [{ url: A, tier: 2 }],
        "b.com": [{ url: A, tier: 2 }],
      },
      today: TODAY,
      fetchText,
    });
    expect(fetchText).toHaveBeenCalledTimes(1);
    expect(result.pages.map(({ venueId }) => venueId)).toEqual([
      "a.com",
      "b.com",
    ]);
  });

  it("hashes each venue's part of a shared page separately", async () => {
    const page = "Barnes Lift to screens Selfridges Lift from Duke Street End";
    const between = (start, end) => {
      const from = page.indexOf(start);
      return page.slice(from, page.indexOf(end, from));
    };
    const fetchPart = jest.fn(async ({ text_between: [start, end] }) =>
      between(start, end),
    );
    const barnes = { url: A, tier: 1, text_between: ["Barnes", "Selfridges"] };
    const selfridges = { url: A, tier: 1, text_between: ["Selfridges", "End"] };
    const first = await fetchSources({
      sources: { "barnes.com": [barnes], "selfridges.com": [selfridges] },
      today: TODAY,
      fetchText: fetchPart,
    });
    expect(fetchPart).toHaveBeenCalledTimes(2);
    expect(first.hashes).toEqual({
      [getHashKey(barnes)]: {
        hash: hashText(between("Barnes", "Selfridges")),
        fetched_on: TODAY,
      },
      [getHashKey(selfridges)]: {
        hash: hashText(between("Selfridges", "End")),
        fetched_on: TODAY,
      },
    });

    const second = await fetchSources({
      sources: { "barnes.com": [barnes], "selfridges.com": [selfridges] },
      previousHashes: first.hashes,
      today: TODAY,
      fetchText: fetchPart,
    });
    expect(second.changed).toEqual([]);
  });

  it("keys a whole page's hash by its address alone", () => {
    expect(getHashKey({ url: A, tier: 1 })).toBe(A);
    expect(getHashKey({ url: A, tier: 1, selector: "main" })).toBe(
      `${A} {"selector":"main"}`,
    );
  });

  it("needs today's date to stamp the hashes with", async () => {
    await expect(
      fetchSources({ sources: {}, today: undefined, fetchText }),
    ).rejects.toThrow("Expected today as YYYY-MM-DD, got undefined");
  });
});
