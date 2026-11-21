// Check every record and candidate, and every record's quotes against the
// pages last fetched if there are any.
//
//   npm run validate
//
// Records and candidates are checked against the venues they describe and the
// source rules (lib/validate.js), and every venue in scope must have a record.
// When `fetch-pages` has written `fetched-pages/`, each record's quotes are
// checked against those pages too; a quote the page no longer carries is a
// fact that needs looking at again. Candidates' quotes aren't: they haven't
// been reviewed yet, and most have none.

const path = require("node:path");
const { readJSON } = require("scripts/common/utils");
const { getAllCinemaNames, getCinemaAttributes } = require("scripts/cinemas");
const { readRecords, readCandidates } = require("../lib/data");
const { validateAll, findMissingQuotes } = require("../lib/validate");

const PAGES_DIRECTORY = path.join(process.cwd(), "fetched-pages");

async function readFetchedText() {
  let index;
  try {
    index = await readJSON(path.join(PAGES_DIRECTORY, "index.json"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
  const textByUrl = new Map();
  for (const page of index.pages) {
    const { text } = await readJSON(path.join(PAGES_DIRECTORY, page.file));
    textByUrl.set(page.url, text);
  }
  return textByUrl;
}

(async () => {
  const records = await readRecords();
  const candidates = await readCandidates();
  const { errors } = validateAll({
    records,
    candidates,
    venues: getAllCinemaNames().map(getCinemaAttributes),
  });

  const textByUrl = await readFetchedText();
  if (textByUrl) {
    records.forEach((record) =>
      findMissingQuotes(record, (url) => textByUrl.get(url)).forEach(
        (problem) => errors.push(`${record.id}: ${problem}`),
      ),
    );
  }

  console.log(
    `${records.length} records, ${candidates.length} candidates` +
      (textByUrl ? "" : "; quotes not checked, no fetched-pages/"),
  );
  if (errors.length) {
    throw new Error(`${errors.length} problems:\n${errors.join("\n")}`);
  }
})().catch((error) => {
  console.error(`\n❌ ${error.stack || error.message || error}`);
  process.exit(1);
});
