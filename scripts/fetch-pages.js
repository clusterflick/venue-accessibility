// Fetch every page in the source registry, store its text, and say which pages
// have changed since the hashes in page-hashes.json.
//
//   npm run fetch-pages
//
// What gets written:
//   fetched-pages/<venue>--<hash>.json  each page's text, as quotes are checked
//   fetched-pages/index.json            what was fetched, changed and failed
//   page-hashes.json                    the hashes, for the next run to compare
//
// A page that fails is recorded and the rest carry on; the run fails at the
// end, once the pages that did come back are written.
//
// Sources with `escalate` go through a Camoufox browser when the site refuses
// a plain fetch: see fetchEscalated in lib/fetch-sources.js.

const path = require("node:path");
const fs = require("node:fs").promises;
const { readJSON, writeJSON } = require("scripts/common/utils");
const { readSources, PAGE_HASHES_PATH } = require("../lib/data");
const { fetchSources } = require("../lib/fetch-sources");
const {
  withCamoufoxSession,
} = require("scripts/common/get-page-with-camoufox");

const PAGES_DIRECTORY = path.join(process.cwd(), "fetched-pages");

(async () => {
  let previousHashes = {};
  try {
    previousHashes = await readJSON(PAGE_HASHES_PATH);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Europe/London",
  });
  const sources = await readSources();
  const total = Object.values(sources).reduce((n, list) => n + list.length, 0);
  console.log(
    `Fetching ${total} sources for ${Object.keys(sources).length} venues`,
  );

  // The browser launches only when a source with `escalate` is first refused,
  // so a run with none launches nothing. The day cache is off: this run is
  // here to notice a page changing, which a cached copy would hide.
  const { pages, hashes, changed, failures } = await withCamoufoxSession(
    (getPage) => fetchSources({ sources, previousHashes, today, getPage }),
    { disableCache: true },
  );

  await fs.mkdir(PAGES_DIRECTORY, { recursive: true });
  for (const page of pages) {
    await writeJSON(path.join(PAGES_DIRECTORY, page.file), {
      url: page.url,
      venueId: page.venueId,
      hash: page.hash,
      text: page.text,
    });
  }
  await writeJSON(path.join(PAGES_DIRECTORY, "index.json"), {
    fetched_on: today,
    pages: pages.map(({ venueId, url, file, hash }) => ({
      venueId,
      url,
      file,
      hash,
    })),
    changed,
    failures,
  });
  await writeJSON(PAGE_HASHES_PATH, hashes);

  console.log(
    `${pages.length} pages fetched, ${changed.length} new or changed, ` +
      `${failures.length} failed. Written to ${path.relative(process.cwd(), PAGES_DIRECTORY)}/`,
  );
  changed.forEach(({ venueId, url, reason }) =>
    console.log(`  ${reason}: ${venueId} ${url}`),
  );
  if (failures.length) {
    throw new Error(
      `${failures.length} pages failed:\n${failures
        .map(({ venueId, url, error }) => `${venueId} ${url}: ${error}`)
        .join("\n")}`,
    );
  }
})().catch((error) => {
  console.error(`\n❌ ${error.stack || error.message || error}`);
  process.exit(1);
});
