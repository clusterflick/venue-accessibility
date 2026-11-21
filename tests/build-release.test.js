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
  const checked = record({
    lift: {
      ...unknown(),
      status: "yes",
      sources: [
        {
          url: "https://riocinema.org.uk/access",
          tier: 1,
          source_last_updated: null,
          checked_on: "2026-11-21",
          quote: "There is a lift",
        },
      ],
    },
  });

  it("publishes records by venue id, with its version and provenance", () => {
    expect(buildRelease(options({ records: [checked] }))).toEqual({
      formatVersion: FORMAT_VERSION,
      generatedAt: "2026-11-21T12:00:00.000Z",
      commit: "abc123",
      venues: { [rio.id]: checked },
    });
  });

  it("leaves out a record that is all unknown", () => {
    expect(buildRelease(options()).venues).toEqual({});
  });

  it("keeps a record that only says where the venue's access information is", () => {
    const contact = record({ access_contact: "Ask at the box office" });
    expect(buildRelease(options({ records: [contact] })).venues).toEqual({
      [rio.id]: contact,
    });
  });

  it("leaves candidates out", () => {
    const candidate = record({ origin: "Desk research", lift: checked.lift });
    expect(buildRelease(options({ candidates: [candidate] })).venues).toEqual(
      {},
    );
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
