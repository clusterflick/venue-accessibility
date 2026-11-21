const { validateAll, getFields } = require("./validate");

/**
 * The shape the website reads. Raise it when a change would break a reader
 * built against the old shape - a field removed, renamed or changed in
 * meaning. A new optional field doesn't need it. The site refuses a version
 * it wasn't built for rather than rendering facts it may misread.
 */
const FORMAT_VERSION = 1;

/**
 * Whether a record says anything: a fact, or where to find the venue's own
 * access information. A venue that publishes nothing still has a reviewed
 * contact worth showing.
 *
 * @param {object} record
 * @returns {boolean}
 */
const saysAnything = (record) =>
  Boolean(record.access_page_url || record.access_contact) ||
  getFields(record).some(({ field }) => field.status !== "unknown");

/**
 * What gets published: the records that say anything, keyed by venue id, and
 * nothing from candidates/. A record that is all unknown is left out. The site
 * knows which venues are in scope from their `programming`, so a venue missing
 * here is one nobody has checked yet - the empty record would only repeat
 * that, at about a kilobyte a venue.
 *
 * Validated again here, against the venues the build sees, so a release can
 * never carry data the rules would refuse.
 *
 * @param {object} options
 * @param {object[]} options.records
 * @param {object[]} options.candidates
 * @param {object[]} options.venues - Every venue's attributes
 * @param {string} options.generatedAt - ISO timestamp
 * @param {string} options.commit - The commit the records came from
 * @returns {object}
 */
function buildRelease({ records, candidates, venues, generatedAt, commit }) {
  if (!generatedAt) throw new Error("No generatedAt given");
  if (!commit) throw new Error("No commit given");
  const { errors } = validateAll({ records, candidates, venues });
  if (errors.length) {
    throw new Error(
      `Refusing to release data that doesn't validate:\n${errors.join("\n")}`,
    );
  }
  return {
    formatVersion: FORMAT_VERSION,
    generatedAt,
    commit,
    venues: Object.fromEntries(
      records.filter(saysAnything).map((record) => [record.id, record]),
    ),
  };
}

module.exports = { FORMAT_VERSION, buildRelease, saysAnything };
