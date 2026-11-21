const { getQuestions } = require("../lib/questions");
const { VENUE_FIELDS } = require("../lib/validate");

const unknown = () => ({
  status: "unknown",
  note: null,
  sources: [],
  conflict: null,
  last_found: null,
});

const PAGE = "https://example.com/access";

const known = (status, overrides = {}) => ({
  ...unknown(),
  status,
  sources: [
    {
      url: PAGE,
      tier: 1,
      source_last_updated: null,
      checked_on: "2026-11-21",
      quote: "Some words from the page",
    },
  ],
  ...overrides,
});

const screen = (name, overrides = {}) => ({
  name,
  step_free: known("yes"),
  wheelchair_spaces: { ...known("yes"), count: 2 },
  space_position: { ...unknown(), value: "unknown" },
  transfer_seating: known("no"),
  hearing_assist: known("yes"),
  notes: null,
  ...overrides,
});

// Everything known, so a test only sees the questions it sets up.
const record = (overrides = {}) => ({
  id: "example.com",
  access_page_url: null,
  access_contact: null,
  notes: null,
  ...Object.fromEntries(VENUE_FIELDS.map((key) => [key, known("yes")])),
  screens: [screen("Screen 1"), screen("Screen 2")],
  ...overrides,
});

const nameOf = () => "Example Cinema";

describe("getQuestions", () => {
  it("asks nothing of a venue whose pages answer everything", () => {
    expect(getQuestions([record()], nameOf)).toEqual({
      conflicts: [],
      gaps: [],
    });
  });

  it("asks about the same contradiction on several screens once", () => {
    const conflict = "The table gives 1; the seat list says 3.";
    const spaces = { ...known("yes"), count: null, conflict };
    const { conflicts } = getQuestions(
      [
        record({
          screens: [
            screen("Screen 1", { wheelchair_spaces: spaces }),
            screen("Screen 2", { wheelchair_spaces: spaces }),
            screen("Screen 3"),
          ],
        }),
      ],
      nameOf,
    );
    expect(conflicts).toEqual([
      {
        venue: "Example Cinema",
        about: "Screen 1 and Screen 2, wheelchair spaces",
        conflict,
        urls: [PAGE],
      },
    ]);
  });

  it("asks once for a gap every screen has", () => {
    const { gaps } = getQuestions(
      [
        record({
          screens: [
            screen("Screen 1", { hearing_assist: unknown() }),
            screen("Screen 2", { hearing_assist: unknown() }),
          ],
        }),
      ],
      nameOf,
    );
    expect(gaps).toEqual([
      expect.objectContaining({
        id: "hearing_assist",
        venues: [{ venue: "Example Cinema", screens: "all screens" }],
      }),
    ]);
  });

  it("asks how many spaces when a page says only that there are some", () => {
    const { gaps } = getQuestions(
      [
        record({
          screens: [
            screen("Screen 1", {
              wheelchair_spaces: { ...known("yes"), count: null },
            }),
            screen("Screen 2"),
          ],
        }),
      ],
      nameOf,
    );
    expect(gaps.map(({ id, venues }) => [id, venues[0].screens])).toEqual([
      ["wheelchair_space_count", "Screen 1"],
    ]);
  });

  it("asks about a separate entrance only when the main one has steps", () => {
    const ids = (overrides) =>
      getQuestions([record(overrides)], nameOf).gaps.map(({ id }) => id);
    expect(ids({ alt_accessible_entrance: unknown() })).toEqual([]);
    expect(
      ids({
        entrance_step_free: known("no"),
        alt_accessible_entrance: unknown(),
      }),
    ).toEqual(["alt_accessible_entrance"]);
  });

  it("doesn't ask as a gap what it asks as a contradiction", () => {
    const { conflicts, gaps } = getQuestions(
      [
        record({
          screens: [
            screen("Screen 1", {
              step_free: {
                ...unknown(),
                sources: known("yes").sources,
                conflict: "One part says the lift is out of order.",
              },
            }),
          ],
        }),
      ],
      nameOf,
    );
    expect(conflicts).toHaveLength(1);
    expect(gaps).toEqual([]);
  });
});
