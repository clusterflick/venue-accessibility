// Write the file the website reads: every record, validated.
//
//   npm run build-release
//
// Writes release/venue-accessibility.json. The release workflow publishes it;
// run it locally to see what the site would get. The commit is taken from
// GITHUB_SHA in a workflow, and from git otherwise.

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { writeJSON } = require("scripts/common/utils");
const { getAllCinemaNames, getCinemaAttributes } = require("scripts/cinemas");
const { readRecords, readCandidates } = require("../lib/data");
const { buildRelease } = require("../lib/build-release");
const { getFields } = require("../lib/validate");

const OUT_PATH = path.join(
  process.cwd(),
  "release",
  "venue-accessibility.json",
);

(async () => {
  const commit =
    process.env.GITHUB_SHA ||
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const release = buildRelease({
    records: await readRecords(),
    candidates: await readCandidates(),
    venues: getAllCinemaNames().map(getCinemaAttributes),
    generatedAt: new Date().toISOString(),
    commit,
  });
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  await writeJSON(OUT_PATH, release);
  const reviewed = Object.values(release.venues).filter((record) =>
    getFields(record).some(({ field }) => field.status !== "unknown"),
  ).length;
  console.log(
    `${Object.keys(release.venues).length} venues (${reviewed} with reviewed facts) ` +
      `written to ${path.relative(process.cwd(), OUT_PATH)}`,
  );
})().catch((error) => {
  console.error(`\n❌ ${error.stack || error.message || error}`);
  process.exit(1);
});
