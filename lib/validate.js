const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const schema = require("./schema.json");
const { checkSourceTier } = require("./source-policy");
const { quoteAppearsIn } = require("./page-text");

const VENUE_FIELDS = [
  "entrance_step_free",
  "alt_accessible_entrance",
  "lift",
  "accessible_toilet",
  "changing_places",
  "assistance_dogs",
  "quiet_space",
  "hearing_assist_counters",
];

const SCREEN_FIELDS = [
  "step_free",
  "wheelchair_spaces",
  "space_position",
  "transfer_seating",
  "hearing_assist",
];

/**
 * The venues that get an accessibility record: those where film is the
 * programme (`cinema`) or a regular part of it (`venue`). A `host` venue only
 * lets other people's screenings in now and then, and is out of scope.
 *
 * @param {object} attributes - A venue's attributes
 * @returns {boolean}
 */
const isInScope = (attributes) =>
  attributes.programming === "cinema" || attributes.programming === "venue";

let compiled;
const getSchemaValidator = () => {
  if (!compiled) {
    const ajv = new Ajv({ allErrors: true });
    addFormats(ajv);
    compiled = ajv.compile(schema);
  }
  return compiled;
};

/**
 * Every field object in a record, with where it sits, for the rule checks.
 *
 * @param {object} record
 * @returns {Array<{ path: string, key: string, screen: object|null, field: object }>}
 */
function getFields(record) {
  const fields = VENUE_FIELDS.map((key) => ({
    path: key,
    key,
    screen: null,
    field: record[key],
  }));
  record.screens.forEach((screen, index) => {
    SCREEN_FIELDS.forEach((key) => {
      fields.push({
        path: `screens[${index}] (${screen.name}).${key}`,
        key,
        screen,
        field: screen[key],
      });
    });
  });
  return fields;
}

function checkField({ path, key, screen, field }, attributes, errors) {
  const fail = (message) => errors.push(`${path}: ${message}`);
  const known = field.status !== "unknown";

  // Rule 1: never infer. A status other than unknown is a claim a source made.
  if (known && field.sources.length === 0) {
    fail(`status "${field.status}" has no source`);
  }

  // Rule 3: the last report found only stands in for a status we don't have.
  if (field.last_found && known) {
    fail("last_found is only for a field whose status is unknown");
  }

  // Rule 2 and the source policy: each source at a tier its host allows.
  field.sources.forEach((source) => {
    const problem = checkSourceTier(source.url, source.tier, attributes);
    if (problem) fail(problem);
    // Rule 5: a chain-wide policy can't say anything about one screen.
    if (screen && source.chain_wide) {
      fail(`a screen fact needs a venue-specific source, not ${source.url}`);
    }
  });
  if (field.last_found) {
    const problem = checkSourceTier(
      field.last_found.url,
      field.last_found.tier,
      attributes,
    );
    if (problem) fail(`last_found: ${problem}`);
  }

  if (key === "wheelchair_spaces") {
    if (field.count !== null && !known) {
      fail("count given for an unknown status");
    }
    if (field.count > 0 && field.status === "no") {
      fail(`count ${field.count} contradicts status "no"`);
    }
    if (field.count === 0 && field.status === "yes") {
      fail('count 0 contradicts status "yes"');
    }
  }
  if (key === "space_position" && !known && field.value !== "unknown") {
    fail(`value "${field.value}" given for an unknown status`);
  }
}

/**
 * The keys only a candidate may carry: they describe research, and a record
 * is past that.
 */
const CANDIDATE_ONLY_KEYS = ["researched_on", "origin"];

/**
 * Whether a record or candidate is well formed and keeps the source rules.
 *
 * Both are held to the same rules about statuses, tiers and conflicts - a
 * candidate that breaks them is wrong already, not just unreviewed. What sets
 * a record apart is that it's on main, and so approved: every source must
 * carry the quote that backs it (rule 6), and nothing about how it was
 * researched is left on it.
 *
 * @param {object} record - A venue accessibility record or candidate
 * @param {object} attributes - The venue's attributes
 * @param {{ kind?: "record" | "candidate" }} [options]
 * @returns {string[]} What's wrong, empty if nothing
 */
function validateRecord(record, attributes, { kind = "record" } = {}) {
  if (kind !== "record" && kind !== "candidate") {
    throw new Error(`Unknown kind "${kind}"`);
  }
  const validateSchema = getSchemaValidator();
  if (!validateSchema(record)) {
    return validateSchema.errors.map(
      (error) => `${error.instancePath || "/"} ${error.message}`,
    );
  }
  const errors = [];
  if (record.id !== attributes.id) {
    errors.push(`id "${record.id}" is not the venue's id "${attributes.id}"`);
  }
  if (!isInScope(attributes)) {
    errors.push(
      `venue programming is "${attributes.programming}", which is out of scope`,
    );
  }
  const names = record.screens.map((screen) => screen.name);
  const repeated = names.filter((name, i) => names.indexOf(name) !== i);
  if (repeated.length) {
    errors.push(`screen names repeated: ${[...new Set(repeated)].join(", ")}`);
  }
  const fields = getFields(record);
  fields.forEach((entry) => checkField(entry, attributes, errors));

  if (kind === "record") {
    CANDIDATE_ONLY_KEYS.filter((key) => key in record).forEach((key) =>
      errors.push(`${key} is for candidates, not records`),
    );
    fields.forEach(({ path, field }) => {
      field.sources.forEach((source) => {
        // Rule 6: every fact needs a quote.
        if (!source.quote) errors.push(`${path}: no quote from ${source.url}`);
      });
    });
  }
  return errors;
}

/**
 * The quotes that no longer appear on the page they cite.
 *
 * @param {object} record
 * @param {(url: string) => string|undefined} getText - A fetched page's text,
 *   or undefined if it wasn't fetched
 * @returns {string[]}
 */
function findMissingQuotes(record, getText) {
  const missing = [];
  getFields(record).forEach(({ path, field }) => {
    field.sources.forEach((source) => {
      if (!source.quote) return;
      const text = getText(source.url);
      if (text === undefined) {
        missing.push(`${path}: ${source.url} wasn't fetched`);
      } else if (!quoteAppearsIn(source.quote, text)) {
        missing.push(`${path}: quote not found on ${source.url}`);
      }
    });
  });
  return missing;
}

/**
 * Check every record and candidate against the venues they describe, and that
 * every venue in scope has a record. A venue added to the listings with no
 * record would otherwise show no accessibility section without anyone deciding
 * that. A candidate needs a record to become part of, and there is at most one
 * of each per venue.
 *
 * @param {object} options
 * @param {object[]} options.records - Every record
 * @param {object[]} [options.candidates] - Every candidate
 * @param {object[]} options.venues - Every venue's attributes
 * @returns {{ errors: string[] }}
 */
function validateAll({ records, candidates = [], venues }) {
  const byId = new Map(venues.map((venue) => [venue.id, venue]));
  const errors = [];
  const check = (items, kind) => {
    const seen = new Set();
    items.forEach((item) => {
      const label = kind === "record" ? item.id : `${item.id} (candidate)`;
      const attributes = byId.get(item.id);
      if (!attributes) {
        errors.push(`${label}: no venue has this id`);
        return;
      }
      if (seen.has(item.id)) errors.push(`${label}: more than one ${kind}`);
      seen.add(item.id);
      validateRecord(item, attributes, { kind }).forEach((error) =>
        errors.push(`${label}: ${error}`),
      );
    });
    return seen;
  };

  const withRecord = check(records, "record");
  const withCandidate = check(candidates, "candidate");
  venues
    .filter((venue) => isInScope(venue) && !withRecord.has(venue.id))
    .forEach((venue) => errors.push(`${venue.id}: in scope but has no record`));
  [...withCandidate]
    .filter((id) => !withRecord.has(id))
    .forEach((id) => errors.push(`${id} (candidate): has no record`));
  return { errors };
}

module.exports = {
  VENUE_FIELDS,
  SCREEN_FIELDS,
  isInScope,
  getFields,
  validateRecord,
  validateAll,
  findMissingQuotes,
};
