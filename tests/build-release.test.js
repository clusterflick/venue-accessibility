const { getCinemaAttributes } = require("scripts/cinemas");
const { buildRelease, FORMAT_VERSION } = require("../lib/build-release");
const { VENUE_FIELDS } = require("../lib/validate");

const rio = getCinemaAttributes("riocinema.org.uk");

const unknown = () => ({
  status: "unknown",
  note: null,
  sources: [],
  conflict: null,
  last_found: null,
});

const record = (overrides = {}) => ({
  id: rio.id,
  access_page_url: null,
  access_contact: null,
  notes: null,
  ...Object.fromEntries(VENUE_FIELDS.map((key) => [key, unknown()])),
  screens: [],
  ...overrides,
});

const options = (overrides = {}) => ({
  records: [record()],
  candidates: [],
  venues: [rio],
  generatedAt: "2026-11-21T12:00:00.000Z",
  commit: "abc123",
  ...overrides,
});

describe("buildRelease", () => {
  it("publishes every record by venue id, with its version and provenance", () => {
    expect(buildRelease(options())).toEqual({
      formatVersion: FORMAT_VERSION,
      generatedAt: "2026-11-21T12:00:00.000Z",
      commit: "abc123",
      venues: { [rio.id]: record() },
    });
  });

  it("leaves candidates out", () => {
    const candidate = record({ origin: "Desk research" });
    expect(
      Object.keys(buildRelease(options({ candidates: [candidate] })).venues),
    ).toEqual([rio.id]);
  });

  it("refuses to release data that doesn't validate", () => {
    expect(() =>
      buildRelease(
        options({
          records: [record({ lift: { ...unknown(), status: "yes" } })],
        }),
      ),
    ).toThrow('riocinema.org.uk: lift: status "yes" has no source');
  });

  it("needs to say when and from what it was built", () => {
    expect(() => buildRelease(options({ commit: undefined }))).toThrow(
      "No commit given",
    );
    expect(() => buildRelease(options({ generatedAt: undefined }))).toThrow(
      "No generatedAt given",
    );
  });
});
