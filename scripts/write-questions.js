// Draft what to ask a chain or venue about its access information.
//
//   npm run write-questions -- <venue id or id prefix>
//   npm run write-questions -- picturehouses.com
//
// Writes questions/<prefix>.md: where the venues' own pages contradict
// themselves, then what they don't say, grouped by question so the venue
// answers each once for all its sites. It's a draft for a person to read,
// edit and send: who to send it to isn't in the records.
//
// Only reviewed records are asked about. A candidate's facts haven't been
// checked against the page yet, so a gap in one may just be unread.

const fs = require("node:fs");
const path = require("node:path");
const { getCinemaAttributes } = require("scripts/cinemas");
const { readRecords } = require("../lib/data");
const { getQuestions } = require("../lib/questions");

const OUT_DIRECTORY = path.join(process.cwd(), "questions");

const describeVenues = (venues) =>
  venues
    .map(({ venue, screens }) => (screens ? `${venue} (${screens})` : venue))
    .join("; ");

function toMarkdown({ title, records, questions, nameOf }) {
  const lines = [
    `# Access information: ${title}`,
    "",
    `Drafted ${new Date().toISOString().slice(0, 10)} from the reviewed records of ${records.length} venue${records.length === 1 ? "" : "s"}: ${records.map(({ id }) => nameOf(id)).join(", ")}.`,
    "",
    "---",
    "",
    "Hello,",
    "",
    "Clusterflick lists every film showing in London, and we're adding each cinema's access information to its page: getting in, the screens and the facilities, each fact quoted from your own access pages and linked back to them.",
    "",
    "While reading your pages we found some places where they contradict themselves, and some things they don't say. We'd rather ask than guess, so until we hear from you we show these as unclear or not published.",
    "",
  ];

  if (questions.conflicts.length) {
    lines.push("## Where the pages disagree with themselves", "");
    questions.conflicts.forEach(({ venue, about, conflict, urls }) => {
      lines.push(`- **${venue}, ${about}.** ${conflict} (${urls.join(", ")})`);
    });
    lines.push("");
  }

  if (questions.gaps.length) {
    lines.push("## What the pages don't say", "");
    questions.gaps.forEach(({ question, venues }) => {
      lines.push(`- **${question}** ${describeVenues(venues)}`);
    });
    lines.push("");
  }

  lines.push(
    "Any answers you can give, or a link to where we can read them, would help people plan a visit. If something we've quoted is out of date, we'd like to know that too.",
    "",
    "Thank you,",
    "Clusterflick",
    "",
  );
  return lines.join("\n");
}

(async () => {
  const [prefix] = process.argv.slice(2);
  if (!prefix) throw new Error("No venue id or id prefix given");

  const records = (await readRecords()).filter(
    ({ id }) => id === prefix || id.startsWith(`${prefix}-`),
  );
  if (!records.length) throw new Error(`No records match "${prefix}"`);

  const nameOf = (id) => getCinemaAttributes(id).name;
  const groupNames = new Set(
    records.map(({ id }) => getCinemaAttributes(id).groupName),
  );
  const title =
    records.length === 1
      ? nameOf(records[0].id)
      : groupNames.size === 1 && [...groupNames][0]
        ? [...groupNames][0]
        : prefix;

  const questions = getQuestions(records, nameOf);
  fs.mkdirSync(OUT_DIRECTORY, { recursive: true });
  const outPath = path.join(OUT_DIRECTORY, `${prefix}.md`);
  fs.writeFileSync(outPath, toMarkdown({ title, records, questions, nameOf }));
  console.log(
    `${records.length} venues: ${questions.conflicts.length} contradictions and ${questions.gaps.length} questions, written to ${path.relative(process.cwd(), outPath)}`,
  );
})().catch((error) => {
  console.error(`\n❌ ${error.stack || error.message || error}`);
  process.exit(1);
});
