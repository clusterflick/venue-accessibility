// Turn the desk-research seed into candidates, and give every venue in scope a
// record to review them into.
//
//   npm run import-seed -- <venue-accessibility-seed.json>
//
// A one-off: the seed came from research done before this repository existed.
// It is keyed by the website's venue slug, which is derived from the venue's
// name and changes when the name does; everything here is keyed by venue id.
// Seed entries are matched to venues by exact name, and an entry matching no
// venue, or more than one, fails the import rather than guessing.
//
// What gets written:
//   records/<id>.json     every venue in scope, all unknown - which is true:
//                         nothing has been reviewed yet
//   candidates/<id>.json  each seed entry that says anything, as it said it
//   sources.json          every page the seed cites, per venue, plus the
//                         access page every Picturehouse has
//
// The seed captured no quotes, so none of it can be a record yet. Each fact is
// moved from its candidate into the record once someone has found the words on
// the page that back it.
//
// An existing file is never overwritten, so the import can't undo a review.

const fs = require("node:fs");
const path = require("node:path");
const { getAllCinemaNames, getCinemaAttributes } = require("scripts/cinemas");
const { writeJSON } = require("scripts/common/utils");
const {
  VENUE_FIELDS,
  SCREEN_FIELDS,
  isInScope,
  validateAll,
} = require("../lib/validate");
const {
  RECORDS_DIRECTORY,
  CANDIDATES_DIRECTORY,
  SOURCES_PATH,
  getRecordPath,
} = require("../lib/data");
const { classifySource, hostOf } = require("../lib/source-policy");

// Seed keys derived from the venue's attributes, so a copy would only drift;
// and the seed's own bookkeeping, which merging into main replaces.
const DROPPED_KEYS = [
  "slug",
  "name",
  "kind",
  "clusterflick_url",
  "coverage",
  "verified",
];

// The element holding the access copy on a Picturehouse page; the rest of the
// page is the chain template, film carousel included.
const PICTUREHOUSE_SELECTOR = ".cinimaAccessibility_div";

const unknownField = () => ({
  status: "unknown",
  note: null,
  sources: [],
  conflict: null,
  last_found: null,
});

const stubScreenField = (key) => {
  if (key === "wheelchair_spaces") return { ...unknownField(), count: null };
  if (key === "space_position") return { ...unknownField(), value: "unknown" };
  return unknownField();
};

const stubRecord = (id) => ({
  id,
  access_page_url: null,
  access_contact: null,
  notes: null,
  ...Object.fromEntries(VENUE_FIELDS.map((key) => [key, unknownField()])),
  screens: [],
});

// A field the seed gave a value of another field's kind - a count under
// step_free, a position under wheelchair_spaces - was filed under the wrong
// key, and which key it meant is a guess. So the field is reset to unknown,
// and what the seed said goes in the screen's notes for whoever checks it.
const misfiledKeys = (key, field) => {
  const allowed = Object.keys(stubScreenField(key));
  return Object.keys(field).filter((name) => !allowed.includes(name));
};

const describeMisfiled = (key, field, extra) =>
  `Seed research put ${extra
    .map((name) => `${name} ${JSON.stringify(field[name])}`)
    .join(" and ")} under ${key} (status "${field.status}"${
    field.note ? `, note "${field.note}"` : ""
  }, from ${field.sources.map((source) => source.url).join(", ") || "no source"}); ` +
  "check which field it belongs to.";

// The seed leaves `count` and `value` off fields it found nothing for.
const fromSeedScreen = (screen) => {
  const notes = screen.notes ? [screen.notes] : [];
  const fields = SCREEN_FIELDS.map((key) => {
    const field = screen[key];
    const extra = misfiledKeys(key, field);
    if (extra.length) {
      notes.push(describeMisfiled(key, field, extra));
      return [key, stubScreenField(key)];
    }
    return [key, { ...stubScreenField(key), ...field }];
  });
  return {
    ...screen,
    ...Object.fromEntries(fields),
    notes: notes.length ? notes.join(" ") : null,
  };
};

const fromSeed = (id, entry, origin) => {
  const candidate = { ...entry, id, origin };
  DROPPED_KEYS.forEach((key) => delete candidate[key]);
  if (!candidate.researched_on) delete candidate.researched_on;
  candidate.screens = entry.screens.map(fromSeedScreen);
  return candidate;
};

// Whether a seed entry says anything a reviewer would need to look at. Most of
// the seed is stubs for venues nobody had researched yet.
const saysAnything = (entry) => {
  const fieldSays = (field) =>
    field.status !== "unknown" ||
    field.sources.length > 0 ||
    field.last_found ||
    field.note;
  return (
    entry.access_page_url ||
    entry.access_contact ||
    entry.notes ||
    entry.screens.length > 0 ||
    VENUE_FIELDS.some((key) => fieldSays(entry[key]))
  );
};

const citedSources = (candidate) => {
  const byUrl = new Map();
  const add = (url, tier) => {
    const current = byUrl.get(url);
    if (!current || tier < current.tier) byUrl.set(url, { url, tier });
  };
  const visit = (field) => {
    field.sources.forEach((source) => add(source.url, source.tier));
    if (field.last_found) add(field.last_found.url, field.last_found.tier);
  };
  VENUE_FIELDS.forEach((key) => visit(candidate[key]));
  candidate.screens.forEach((screen) =>
    SCREEN_FIELDS.forEach((key) => visit(screen[key])),
  );
  return [...byUrl.values()];
};

const getSources = (venue, candidate) => {
  const entries = candidate ? citedSources(candidate) : [];
  const accessPage = candidate?.access_page_url;
  if (accessPage && !entries.some((entry) => entry.url === accessPage)) {
    const { tier } = classifySource(accessPage, venue);
    if (tier !== 1 && tier !== 2) {
      throw new Error(
        `${venue.id}: access page ${accessPage} isn't a tier 1 or 2 source`,
      );
    }
    entries.push({ url: accessPage, tier });
  }
  if (venue.id.startsWith("picturehouses.com-")) {
    const url = `${venue.url}/accessibility`;
    if (!entries.some((entry) => entry.url === url)) {
      entries.push({ url, tier: 1 });
    }
  }
  entries
    .filter((entry) => hostOf(entry.url) === "picturehouses.com")
    .forEach((entry) => {
      entry.selector = PICTUREHOUSE_SELECTOR;
    });
  return entries;
};

const writeMissing = async (directory, items) => {
  fs.mkdirSync(directory, { recursive: true });
  let written = 0;
  for (const item of items) {
    const filePath = getRecordPath(item.id, directory);
    if (fs.existsSync(filePath)) continue;
    await writeJSON(filePath, item);
    written += 1;
  }
  return written;
};

(async () => {
  const [seedPath] = process.argv.slice(2);
  if (!seedPath) throw new Error("No seed file given");
  const seed = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  if (!seed.generated_on) throw new Error("The seed has no generated_on date");
  const origin = `Desk-research seed of ${seed.generated_on}, unverified: no quotes were captured`;

  const venues = getAllCinemaNames().map(getCinemaAttributes);
  const inScope = venues.filter(isInScope);

  const seedById = new Map();
  for (const entry of seed.venues) {
    const matches = venues.filter((venue) => venue.name === entry.name);
    if (matches.length !== 1) {
      throw new Error(
        `Seed entry "${entry.name}" (${entry.slug}) matches ${matches.length} venues`,
      );
    }
    const [venue] = matches;
    if (!isInScope(venue))
      throw new Error(`Seed entry ${venue.id} is out of scope`);
    if (seedById.has(venue.id))
      throw new Error(`Two seed entries for ${venue.id}`);
    seedById.set(venue.id, entry);
  }

  const records = inScope.map((venue) => stubRecord(venue.id));
  const candidates = [...seedById]
    .filter(([, entry]) => saysAnything(entry))
    .map(([id, entry]) => fromSeed(id, entry, origin))
    .sort((a, b) => a.id.localeCompare(b.id));

  const { errors } = validateAll({ records, candidates, venues });
  if (errors.length) {
    throw new Error(`The import doesn't validate:\n${errors.join("\n")}`);
  }

  const recordsWritten = await writeMissing(RECORDS_DIRECTORY, records);
  const candidatesWritten = await writeMissing(
    CANDIDATES_DIRECTORY,
    candidates,
  );

  const sources = fs.existsSync(SOURCES_PATH)
    ? JSON.parse(fs.readFileSync(SOURCES_PATH, "utf8"))
    : {};
  const candidateById = new Map(candidates.map((c) => [c.id, c]));
  for (const venue of inScope) {
    if (sources[venue.id]) continue;
    const entries = getSources(venue, candidateById.get(venue.id));
    if (entries.length) sources[venue.id] = entries;
  }
  await writeJSON(SOURCES_PATH, sources);

  const relative = (p) => path.relative(process.cwd(), p);
  console.log(
    `${inScope.length} venues in scope. Wrote ${recordsWritten} records to ${relative(RECORDS_DIRECTORY)}/, ` +
      `${candidatesWritten} candidates (of ${seed.venues.length} seed entries) to ${relative(CANDIDATES_DIRECTORY)}/, ` +
      `and sources for ${Object.keys(sources).length} venues to ${relative(SOURCES_PATH)}.`,
  );
})().catch((error) => {
  console.error(`\n❌ ${error.stack || error.message || error}`);
  process.exit(1);
});
