const { getCinemaAttributes } = require("scripts/cinemas");
const {
  validateRecord,
  validateAll,
  findMissingQuotes,
  VENUE_FIELDS,
} = require("../lib/validate");

const rio = getCinemaAttributes("riocinema.org.uk");
const ACCESS = "https://riocinema.org.uk/access";
const ACCESSABLE = "https://www.accessable.co.uk/venues/rio-cinema";

const unknown = () => ({
  status: "unknown",
  note: null,
  sources: [],
  conflict: null,
  last_found: null,
});

const source = (overrides = {}) => ({
  url: ACCESS,
  tier: 1,
  source_last_updated: null,
  checked_on: "2026-11-20",
  quote: "Step-free access from the street",
  ...overrides,
});

const known = (status, overrides = {}) => ({
  ...unknown(),
  status,
  sources: [source()],
  ...overrides,
});

const screen = (overrides = {}) => ({
  name: "Screen 1",
  step_free: unknown(),
  wheelchair_spaces: { ...unknown(), count: null },
  space_position: { ...unknown(), value: "unknown" },
  transfer_seating: unknown(),
  hearing_assist: unknown(),
  notes: null,
  ...overrides,
});

const record = (overrides = {}) => ({
  id: rio.id,
  access_page_url: ACCESS,
  access_contact: null,
  notes: null,
  ...Object.fromEntries(VENUE_FIELDS.map((key) => [key, unknown()])),
  screens: [],
  ...overrides,
});

describe("validateRecord", () => {
  it("accepts a record that's all unknown", () => {
    expect(validateRecord(record(), rio)).toEqual([]);
  });

  it("accepts sourced facts", () => {
    expect(
      validateRecord(
        record({
          entrance_step_free: known("yes"),
          screens: [
            screen({
              wheelchair_spaces: {
                ...known("yes", {
                  sources: [source({ url: ACCESSABLE, tier: 2 })],
                }),
                count: 2,
              },
            }),
          ],
        }),
        rio,
      ),
    ).toEqual([]);
  });

  it("reports the shape before the rules", () => {
    expect(
      validateRecord(record({ lift: { status: "maybe" } }), rio),
    ).not.toHaveLength(0);
  });

  it("refuses a status no source gave", () => {
    expect(
      validateRecord(record({ lift: { ...unknown(), status: "yes" } }), rio),
    ).toEqual(['lift: status "yes" has no source']);
  });

  it("refuses a source trusted beyond its tier", () => {
    expect(
      validateRecord(
        record({
          lift: known("yes", { sources: [source({ url: ACCESSABLE })] }),
        }),
        rio,
      ),
    ).toEqual(["lift: accessable.co.uk is tier 2 at most, not tier 1"]);
  });

  it("keeps the last report found for fields we don't know", () => {
    const lastFound = {
      claim: "Has a lift",
      url: "https://www.euansguide.com/venues/rio-cinema-1/reviews/a-1",
      tier: 3,
      found_on: "2026-11-20",
    };
    expect(
      validateRecord(
        record({ lift: { ...unknown(), last_found: lastFound } }),
        rio,
      ),
    ).toEqual([]);
    expect(
      validateRecord(
        record({ lift: known("yes", { last_found: lastFound }) }),
        rio,
      ),
    ).toEqual(["lift: last_found is only for a field whose status is unknown"]);
  });

  it("allows a chain-wide policy for the venue but not for a screen", () => {
    const chainWide = [source({ chain_wide: true })];
    expect(
      validateRecord(
        record({ assistance_dogs: known("yes", { sources: chainWide }) }),
        rio,
      ),
    ).toEqual([]);
    expect(
      validateRecord(
        record({
          screens: [
            screen({ step_free: known("yes", { sources: chainWide }) }),
          ],
        }),
        rio,
      ),
    ).toEqual([
      `screens[0] (Screen 1).step_free: a screen fact needs a venue-specific source, not ${ACCESS}`,
    ]);
  });

  it("holds a count to its status", () => {
    const spaces = (status, count) =>
      record({
        screens: [
          screen({
            wheelchair_spaces:
              status === "unknown"
                ? { ...unknown(), count }
                : { ...known(status), count },
          }),
        ],
      });
    const prefix = "screens[0] (Screen 1).wheelchair_spaces";
    expect(validateRecord(spaces("yes", null), rio)).toEqual([]);
    expect(validateRecord(spaces("unknown", 2), rio)).toEqual([
      `${prefix}: count given for an unknown status`,
    ]);
    expect(validateRecord(spaces("no", 2), rio)).toEqual([
      `${prefix}: count 2 contradicts status "no"`,
    ]);
    expect(validateRecord(spaces("yes", 0), rio)).toEqual([
      `${prefix}: count 0 contradicts status "yes"`,
    ]);
  });

  it("refuses a position for an unknown status", () => {
    expect(
      validateRecord(
        record({
          screens: [
            screen({ space_position: { ...unknown(), value: "front" } }),
          ],
        }),
        rio,
      ),
    ).toEqual([
      'screens[0] (Screen 1).space_position: value "front" given for an unknown status',
    ]);
  });

  it("refuses two screens of the same name", () => {
    expect(
      validateRecord(record({ screens: [screen(), screen()] }), rio),
    ).toEqual(["screen names repeated: Screen 1"]);
  });

  it("refuses a record for a venue out of scope", () => {
    const host = { ...rio, programming: "host" };
    expect(validateRecord(record(), host)).toEqual([
      'venue programming is "host", which is out of scope',
    ]);
  });
});

describe("records and candidates", () => {
  const unquoted = record({
    lift: known("yes", { sources: [source({ quote: null })] }),
  });
  const researched = record({
    researched_on: "2026-11-20",
    origin: "Desk research",
  });

  it("needs a quote for every source in a record", () => {
    expect(validateRecord(unquoted, rio)).toEqual([
      `lift: no quote from ${ACCESS}`,
    ]);
  });

  it("lets a candidate's sources go unquoted", () => {
    expect(validateRecord(unquoted, rio, { kind: "candidate" })).toEqual([]);
  });

  it("keeps a candidate's research notes off a record", () => {
    expect(validateRecord(researched, rio, { kind: "candidate" })).toEqual([]);
    expect(validateRecord(researched, rio)).toEqual([
      "researched_on is for candidates, not records",
      "origin is for candidates, not records",
    ]);
  });

  it("holds a candidate to the same source rules as a record", () => {
    expect(
      validateRecord(record({ lift: { ...unknown(), status: "yes" } }), rio, {
        kind: "candidate",
      }),
    ).toEqual(['lift: status "yes" has no source']);
  });

  it("accepts a record whose sources disagree, since the page shows both", () => {
    expect(
      validateRecord(
        record({
          lift: known("yes", {
            sources: [source(), source({ url: ACCESSABLE, tier: 2 })],
            conflict: "AccessAble says platform lift",
          }),
        }),
        rio,
      ),
    ).toEqual([]);
  });
});

describe("validateAll", () => {
  const other = getCinemaAttributes("actonecinema.co.uk");

  it("asks for a record for every venue in scope", () => {
    expect(
      validateAll({ records: [record()], venues: [rio, other] }).errors,
    ).toEqual(["actonecinema.co.uk: in scope but has no record"]);
  });

  it("refuses a record for a venue that doesn't exist, or two for one", () => {
    expect(
      validateAll({
        records: [record(), record(), record({ id: "nowhere" })],
        venues: [rio],
      }).errors,
    ).toEqual([
      "riocinema.org.uk: more than one record",
      "nowhere: no venue has this id",
    ]);
  });

  it("checks candidates as candidates, and needs a record for each", () => {
    const candidate = record({
      lift: known("yes", { sources: [source({ quote: null })] }),
    });
    expect(
      validateAll({
        records: [record()],
        candidates: [candidate],
        venues: [rio],
      }).errors,
    ).toEqual([]);
    expect(
      validateAll({
        records: [record({ id: other.id })],
        candidates: [candidate, candidate],
        venues: [rio, other],
      }).errors,
    ).toEqual([
      "riocinema.org.uk (candidate): more than one candidate",
      "riocinema.org.uk: in scope but has no record",
      "riocinema.org.uk (candidate): has no record",
    ]);
  });
});

describe("findMissingQuotes", () => {
  const withLift = record({ lift: known("yes") });

  it("passes a quote the page still has", () => {
    expect(
      findMissingQuotes(
        withLift,
        () => "There is Step-free access from the street.",
      ),
    ).toEqual([]);
  });

  it("reports a quote the page no longer has, or a page not fetched", () => {
    expect(findMissingQuotes(withLift, () => "Please call us.")).toEqual([
      `lift: quote not found on ${ACCESS}`,
    ]);
    expect(findMissingQuotes(withLift, () => undefined)).toEqual([
      `lift: ${ACCESS} wasn't fetched`,
    ]);
  });
});
