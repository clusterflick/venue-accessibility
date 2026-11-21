const { getFields } = require("./validate");

/**
 * What to ask a venue: where its own pages contradict themselves, and what
 * they don't say. Built from the records, so it is exactly what the venue
 * page shows as "Sources disagree", "Unclear" and "Not published".
 *
 * Asked rather than guessed. A page giving 55 wheelchair spaces in a 115-seat
 * screen almost certainly means 5, but the record leaves the count empty until
 * the venue says so.
 */

const SCREEN_LABELS = {
  step_free: "step-free access",
  wheelchair_spaces: "wheelchair spaces",
  space_position: "where the wheelchair spaces are",
  transfer_seating: "transfer seating",
  hearing_assist: "hearing assistance",
};

const VENUE_LABELS = {
  step_free_access: "step-free access into the building",
  entrance_step_free: "a step-free main entrance",
  alt_accessible_entrance: "a separate step-free entrance",
  lift: "the lift",
  accessible_toilet: "the accessible toilet",
  changing_places: "a Changing Places toilet",
  assistance_dogs: "assistance dogs",
  quiet_space: "a quiet space",
  hearing_assist_counters: "hearing loops at the counters",
};

/**
 * The questions for what a venue's pages leave unknown, in the order they
 * matter to a visit. Each is asked of a venue only when its record doesn't
 * know the answer, and some only when an earlier answer makes them matter: a
 * separate entrance only when the main one isn't step-free.
 */
const GAPS = [
  {
    id: "step_free_access",
    question: "Can a wheelchair user get into the building without steps?",
    applies: (record) => record.step_free_access.status === "unknown",
  },
  {
    id: "entrance_step_free",
    question:
      "Is the main entrance step-free? If not, is there another step-free entrance, and how is it reached (a bell, a member of staff)?",
    applies: (record) => record.entrance_step_free.status === "unknown",
  },
  {
    id: "alt_accessible_entrance",
    question:
      "The main entrance has steps. Is there a separate step-free entrance, and how is it reached?",
    applies: (record) =>
      record.entrance_step_free.status === "no" &&
      record.alt_accessible_entrance.status === "unknown",
  },
  {
    id: "lift",
    question: "Is there a lift to the screens and facilities upstairs?",
    applies: (record) => record.lift.status === "unknown",
  },
  {
    id: "screens",
    question: "Which screens are there, and can each be reached without steps?",
    applies: (record) => record.screens.length === 0,
  },
  {
    id: "screen_step_free",
    question: "Can these screens be reached without steps?",
    screens: (record) =>
      record.screens.filter(
        (screen) =>
          screen.step_free.status === "unknown" && !screen.step_free.conflict,
      ),
  },
  {
    id: "wheelchair_spaces",
    question: "How many wheelchair spaces do these screens have, and where?",
    screens: (record) =>
      record.screens.filter(
        (screen) =>
          screen.wheelchair_spaces.status === "unknown" &&
          !screen.wheelchair_spaces.conflict,
      ),
  },
  {
    id: "wheelchair_space_count",
    question: "These screens have wheelchair spaces: how many?",
    screens: (record) =>
      record.screens.filter(
        (screen) =>
          screen.wheelchair_spaces.status === "yes" &&
          screen.wheelchair_spaces.count === null &&
          !screen.wheelchair_spaces.conflict,
      ),
  },
  {
    id: "accessible_toilet",
    question: "Is there an accessible toilet, and where?",
    applies: (record) => record.accessible_toilet.status === "unknown",
  },
  {
    id: "changing_places",
    question: "Is there a Changing Places toilet?",
    applies: (record) => record.changing_places.status === "unknown",
  },
  {
    id: "hearing_assist_counters",
    question: "Are there hearing loops at the box office or counters?",
    applies: (record) => record.hearing_assist_counters.status === "unknown",
  },
  {
    id: "hearing_assist",
    question:
      "Which screens have hearing assistance, and of what kind (an induction loop, infrared, headphones)?",
    screens: (record) =>
      record.screens.filter(
        (screen) => screen.hearing_assist.status === "unknown",
      ),
  },
  {
    id: "transfer_seating",
    question:
      "Do any screens have transfer seats, with an armrest that lifts or comes off so a wheelchair user can move across?",
    screens: (record) =>
      record.screens.filter(
        (screen) => screen.transfer_seating.status === "unknown",
      ),
  },
  {
    id: "quiet_space",
    question:
      "Is there a quiet or sensory space, and is it open at every screening or only at relaxed ones?",
    applies: (record) => record.quiet_space.status === "unknown",
  },
  {
    id: "assistance_dogs",
    question: "Are assistance dogs welcome?",
    applies: (record) => record.assistance_dogs.status === "unknown",
  },
];

/**
 * @param {object[]} records - The venues to ask about
 * @param {(id: string) => string} nameOf - A venue's name
 * @returns {{
 *   conflicts: Array<{ venue: string, about: string, conflict: string, urls: string[] }>,
 *   gaps: Array<{ id: string, question: string, venues: Array<{ venue: string, screens: string[] | null }> }>,
 * }}
 */
/**
 * A list of screen names as prose, or "all screens" when it is every one, so a
 * question about a whole venue doesn't list its eight screens one by one.
 */
function describeScreens(names, record) {
  if (names.length === record.screens.length && names.length > 1) {
    return "all screens";
  }
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * @param {object[]} records - The venues to ask about
 * @param {(id: string) => string} nameOf - A venue's name
 * @returns {{
 *   conflicts: Array<{ venue: string, about: string, conflict: string, urls: string[] }>,
 *   gaps: Array<{ id: string, question: string, venues: Array<{ venue: string, screens: string | null }> }>,
 * }}
 */
function getQuestions(records, nameOf) {
  const conflicts = [];
  records.forEach((record) => {
    // The same contradiction on several screens - Finsbury Park's table and
    // seat list disagree the same way on five - is one thing to ask about.
    const grouped = new Map();
    getFields(record).forEach(({ key, screen, field }) => {
      if (!field.conflict) return;
      const groupKey = `${key} ${screen ? field.conflict : `venue ${field.conflict}`}`;
      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, { key, screens: [], field });
      }
      if (screen) grouped.get(groupKey).screens.push(screen.name);
    });
    grouped.forEach(({ key, screens, field }) => {
      conflicts.push({
        venue: nameOf(record.id),
        about: screens.length
          ? `${describeScreens(screens, record)}, ${SCREEN_LABELS[key]}`
          : VENUE_LABELS[key],
        conflict: field.conflict,
        urls: [...new Set(field.sources.map(({ url }) => url))],
      });
    });
  });

  const gaps = GAPS.map((gap) => ({
    id: gap.id,
    question: gap.question,
    venues: records.flatMap((record) => {
      if (gap.screens) {
        const names = gap.screens(record).map(({ name }) => name);
        return names.length
          ? [
              {
                venue: nameOf(record.id),
                screens: describeScreens(names, record),
              },
            ]
          : [];
      }
      return gap.applies(record)
        ? [{ venue: nameOf(record.id), screens: null }]
        : [];
    }),
  })).filter(({ venues }) => venues.length > 0);

  return { conflicts, gaps };
}

module.exports = { getQuestions };
