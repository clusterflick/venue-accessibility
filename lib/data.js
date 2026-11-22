const fs = require("node:fs").promises;
const path = require("node:path");
const { readJSON } = require("scripts/common/utils");

const ROOT = path.join(__dirname, "..");

/**
 * The approved data: one record per venue in scope. Everything here was
 * merged through a pull request, so everything here has been reviewed.
 */
const RECORDS_DIRECTORY = path.join(ROOT, "records");

/**
 * Unreviewed facts waiting to be checked against their sources and moved into
 * a record: the desk-research seed, and later what extraction proposes.
 * Nothing here is published.
 */
const CANDIDATES_DIRECTORY = path.join(ROOT, "candidates");

/** The pages each venue's facts are read from. */
const SOURCES_PATH = path.join(ROOT, "sources.json");

/** What each page's text hashed to when it was last fetched. */
const PAGE_HASHES_PATH = path.join(ROOT, "page-hashes.json");

const getRecordPath = (id, directory = RECORDS_DIRECTORY) =>
  path.join(directory, `${id}.json`);

/**
 * Every file in a directory of records or candidates, in id order. A file must
 * hold the venue it's named after.
 *
 * @param {string} directory
 * @returns {Promise<object[]>}
 */
async function readDirectory(directory) {
  let files;
  try {
    files = await fs.readdir(directory);
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  return Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map(async (file) => {
        const item = await readJSON(path.join(directory, file));
        const expected = path.basename(file, ".json");
        if (item.id !== expected) {
          throw new Error(`${file} holds the venue "${item.id}"`);
        }
        return item;
      }),
  );
}

const readRecords = (directory = RECORDS_DIRECTORY) => readDirectory(directory);
const readCandidates = (directory = CANDIDATES_DIRECTORY) =>
  readDirectory(directory);

const SOURCE_KEYS = new Set([
  "url",
  "tier",
  "selector",
  "text_from",
  "text_between",
]);

/**
 * The source registry. A key it doesn't know throws, so a misspelt
 * `text_between` can't quietly leave a page unnarrowed.
 *
 * @param {string} [filePath]
 * @returns {Promise<Record<string, Array<{ url: string, tier: number, selector?: string, text_from?: string, text_between?: [string, string] }>>>}
 */
const readSources = async (filePath = SOURCES_PATH) => {
  const sources = await readJSON(filePath);
  for (const [venueId, entries] of Object.entries(sources)) {
    for (const entry of entries) {
      const unknown = Object.keys(entry).filter((key) => !SOURCE_KEYS.has(key));
      if (unknown.length) {
        throw new Error(
          `${venueId} ${entry.url}: unknown source keys ${unknown.join(", ")}`,
        );
      }
    }
  }
  return sources;
};

module.exports = {
  RECORDS_DIRECTORY,
  CANDIDATES_DIRECTORY,
  SOURCES_PATH,
  PAGE_HASHES_PATH,
  getRecordPath,
  readRecords,
  readCandidates,
  readSources,
};
