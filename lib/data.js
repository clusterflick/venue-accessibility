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

/**
 * @param {string} [filePath]
 * @returns {Promise<Record<string, Array<{ url: string, tier: number, selector?: string }>>>}
 */
const readSources = (filePath = SOURCES_PATH) => readJSON(filePath);

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
