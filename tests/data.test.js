const { getAllCinemaNames, getCinemaAttributes } = require("scripts/cinemas");
const { readRecords, readCandidates, readSources } = require("../lib/data");
const { validateAll, isInScope } = require("../lib/validate");
const { checkSourceTier } = require("../lib/source-policy");

// The committed data is checked like code: a pull request that breaks a rule,
// or a venue coming into scope in scripts without a record here, fails CI.
describe("committed data", () => {
  const venues = getAllCinemaNames().map(getCinemaAttributes);

  it("validates, with a record for every venue in scope", async () => {
    const records = await readRecords();
    const candidates = await readCandidates();
    expect(validateAll({ records, candidates, venues }).errors).toEqual([]);
    expect(records).toHaveLength(venues.filter(isInScope).length);
  });

  it("registers only sources the policy allows, for venues with records", async () => {
    const sources = await readSources();
    const records = new Set((await readRecords()).map(({ id }) => id));
    const problems = Object.entries(sources).flatMap(([id, entries]) => {
      if (!records.has(id)) return [`${id}: no record`];
      const attributes = getCinemaAttributes(id);
      return entries
        .map((entry) => checkSourceTier(entry.url, entry.tier, attributes))
        .filter(Boolean)
        .map((problem) => `${id}: ${problem}`);
    });
    expect(problems).toEqual([]);
  });
});
