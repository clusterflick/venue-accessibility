# venue-accessibility

> **[Clusterflick](https://clusterflick.com)** is the most complete guide to
> film in London: every listing from 500+ venues, from multiplexes to pub back
> rooms, in one search. Free and open source.
>
> This repository holds what London's cinemas and arts venues offer for access:
> their entrances, lifts, toilets and screens, each fact cited to a trusted
> source. See the [Clusterflick organisation](https://github.com/clusterflick)
> for how the pieces fit together.

This is about the **building and its screens**: is the entrance step-free, how
many wheelchair spaces does Screen 2 have, and where. What each screening offers
(subtitles, audio description, relaxed) is a different question, answered per
performance by the listings in
[scripts](https://github.com/clusterflick/scripts).

## What's here

| Path                   | What it is                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `records/<id>.json`    | One record per venue in scope, named after its id in `scripts`: the reviewed facts |
| `candidates/<id>.json` | Facts nobody has checked yet, waiting to be reviewed into a record                 |
| `sources.json`         | The pages each venue's facts are read from                                         |
| `page-hashes.json`     | What each page's text hashed to when last fetched                                  |
| `lib/`                 | The schema, the rules, the source policy, page text and fetching                   |
| `scripts/`             | The commands below                                                                 |

```bash
npm run build-release # release/venue-accessibility.json, as the site gets it
npm run validate      # records and candidates, and quotes if pages were fetched
npm run fetch-pages   # every page in sources.json, into fetched-pages/
npm test              # includes validating the committed data
npm run write-questions -- picturehouses.com  # what to ask a chain or venue
```

Venue attributes, fetching and the venue list come from `scripts`, installed as
a dependency. CI validates against its latest commit rather than the one the
lockfile pins, because which venues need a record is whatever `scripts` lists
now.

## How a fact gets published

**Merging into `main` is the approval.** Nothing writes to `main` except a
merged pull request, so everything in `records/` has been reviewed, and the diff
of a pull request is the review queue. CI validates the committed data, so a
record that breaks a rule can't be merged.

A fact starts as a **candidate**: from desk research, from extraction, or from a
page that changed. Reviewing it means finding the words on the cited page that
back it, adding them as the source's `quote`, and moving the field into the
venue's record. A candidate's sources may go unquoted; a record's may not.

A record that is all `unknown` is a true record: it says we don't know, which
the page says too.

## The release

Every merge into `main` that changes the records publishes a release with one
asset, `venue-accessibility.json`: `formatVersion`, `generatedAt`, the `commit`
the records came from, and `venues`, keyed by venue id. Only records that say
something are in it: a fact, an access page or a contact. A venue in scope but
missing from the release is one nobody has checked yet; the site knows which
venues are in scope from their `programming`. Candidates are never in it. The
release is validated as it's built, so it can't carry data CI would refuse.

The website takes the latest release when it builds, and refuses a
`formatVersion` it wasn't built for. Raise `FORMAT_VERSION` in
`lib/build-release.js` when a change would break a reader built against the old
shape: a field removed, renamed or changed in meaning. A new optional field
doesn't need it.

## Asking venues

`npm run write-questions -- <venue id or id prefix>` drafts an email to a venue
or chain in `questions/<prefix>.md`: where its pages contradict themselves (each
`conflict`, the same one across several screens asked once), then what they
don't say, grouped by question so a chain answers each once for every site. It
reads only `records/`, so it asks about exactly what the venue pages show as
"Unclear" and "Not published". It is a draft for a person to read and send; who
to send it to isn't in the records.

An answer is a source like any other: a reply quoted into a record needs a tier,
so add the venue's reply as a source in the policy before citing it.

## Scope

A venue is in scope when its `programming` in `scripts` is `cinema` (film is the
programme) or `venue` (film is a regular part of it). `host` venues, which let
other people's screenings in now and then, are out. That is `isInScope` in
`lib/validate.js`, and validation fails when a venue in scope has no record, so
a new cinema can't go without one unnoticed.

That was 153 venues on 21 November 2026.

## Records

Every fact is a field object:

```json
{
  "status": "yes | no | partial | unknown | not_applicable",
  "note": "Short plain-English detail, e.g. 'Ramp from street'",
  "sources": [
    {
      "url": "https://…",
      "tier": 1,
      "source_last_updated": "2026-09-16",
      "checked_on": "2026-11-20",
      "quote": "Exact supporting text from the page",
      "chain_wide": false
    }
  ],
  "conflict": "null, or a description of the disagreement between sources",
  "last_found": {
    "claim": "…",
    "url": "…",
    "tier": 3,
    "found_on": "2026-11-20"
  }
}
```

`wheelchair_spaces` adds `count` (an integer, or `null` if not stated) and
`space_position` adds `value` (`front | middle | rear | mixed | unknown`).
`chain_wide` is optional and marks a policy stated for the whole chain.

Venue fields:

| Field                     | Meaning                                                                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `step_free_access`        | A wheelchair user can get into the building without steps, by whatever route. "The ground floor is accessible to wheelchair users" says this |
| `entrance_step_free`      | The **main** entrance can be used without steps. Only from a page that speaks of the entrance, the street or the whole building              |
| `alt_accessible_entrance` | A separate step-free route (note how, e.g. "ring bell", "staff escort")                                                                      |
| `lift`                    | A lift serves the public areas (`not_applicable` if single level)                                                                            |
| `accessible_toilet`       | An accessible toilet exists; note its location and any steps                                                                                 |
| `changing_places`         | A Changing Places toilet is on site                                                                                                          |
| `assistance_dogs`         | Assistance dogs are welcome                                                                                                                  |
| `quiet_space`             | A quiet or sensory space; note if it's only at relaxed events                                                                                |
| `hearing_assist_counters` | Loops at the box office or counters                                                                                                          |

`step_free_access` is the question a reader asks, and the one the filters use.
The entrance fields say how: a page that only says the ground floor is
accessible tells you someone can get in, not which door, so it gives
`step_free_access` and leaves the entrance unknown.

Beside them: `id`, `access_page_url`, `access_contact` and `notes`. A candidate
may also carry `researched_on` and `origin`.

Screen fields:

| Field               | Meaning                                                                                                                                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`, `aliases`   | The screen's name on the access page, and any other names its listings use where `getScreen` doesn't reduce both to the same                                                                                                                               |
| `step_free`         | A wheelchair user can reach the screen and its wheelchair space without steps                                                                                                                                                                              |
| `wheelchair_spaces` | The screen has wheelchair spaces, with `count`                                                                                                                                                                                                             |
| `space_position`    | Where the spaces are, as `value`                                                                                                                                                                                                                           |
| `transfer_seating`  | Seats a wheelchair user can move across into from their chair: usually on the aisle or beside a wheelchair space, with an armrest that lifts or comes off. "No" means none, not that nobody can sit in a seat: "All seats have immovable armrests" is a no |
| `hearing_assist`    | Listening help in the screen; note the type (induction loop, infrared, Dolby Fidelio, headphones, none)                                                                                                                                                    |
| `notes`             | Anything else about the screen                                                                                                                                                                                                                             |

Records are keyed by venue id, not the website's slug: the slug is derived from
the venue's name and changes when it does. The slug, name and kind are all
derived from the venue's attributes in `scripts`, so they aren't stored.

### Rules

`validateRecord` in `lib/validate.js` holds records and candidates alike to
these:

1. **Never infer.** A status other than `unknown` needs a source. "Unknown" is a
   valid, publishable answer.
2. **A status comes only from tier 1 or 2.** The schema allows nothing else in
   `sources`.
3. **Tier 3 goes in `last_found`**, and only on a field whose status is
   `unknown`. The page shows it as "We don't know. The last report we found
   said…", with its source and date.
4. **Conflicts are kept.** Both sources stay in `sources` and `conflict` says
   how they disagree. Nothing picks one automatically; the page shows "Sources
   disagree" with both.
5. **Chain-wide policies count for the venue, never for a screen.** A screen
   field with a `chain_wide` source fails.
6. **Every fact in a record has a quote**, and every quote must still be on its
   page (`findMissingQuotes`, run by `npm run validate` once pages are fetched).

A count must agree with its status (a count under `unknown`, 2 spaces under
`no`, or 0 under `yes` fails), and so must a position.

## Source policy

| Tier     | Use               | Sources                                                                                                                                                                                                                                                                                |
| -------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | Fact              | The venue's own site (access page, FAQ, access PDFs, visual story guides); the chain's page for that venue                                                                                                                                                                             |
| 2        | Fact, show date   | AccessAble guides; the Changing Places map (changing-places.uk); council Local Offer pages; Nimbus Access Card listings; Euan's Guide venue information (not reviews); Accessible Screenings UK venue information, if it publishes any                                                 |
| 3        | `last_found` only | Euan's Guide reviews; festival or event-organiser access pages (e.g. Open City Docs)                                                                                                                                                                                                   |
| Excluded | Never             | Aggregators and listings: Tagvenue, Hire Space, TripAdvisor, Tripability, accesstolondon, Cinematik, Eventim listings, Grokipedia and other wiki clones, Google-derived listings, third-party event listings, old mirror copies of chain sites (e.g. thetunagroup, www1.picturehouses) |

`lib/source-policy.js` is this table in code, and it **fails closed**: a host it
doesn't list is an error, not a tier. Add a host there before a record uses it.
Tier 1 is the hosts in the venue's `domain` and `url`, plus `OWN_HOSTS` for the
chain sites and help desks that publish for a venue from elsewhere (BFI's
`bfi.org.uk` beside `whatson.bfi.org.uk`, Everyman's Freshdesk, Olympic
Studios). Hosts are compared exactly, never by registrable domain, so
`www1.picturehouses.com` can't pass as the chain's site.

A source may be given a lower tier than the policy allows, never a higher one.
The seed cites a Euan's Guide venue page at tier 3 for something its reviews
said, and that's right.

AccessAble surveys can be years old. Record the survey date in
`source_last_updated` where the guide shows it, and if a newer tier 1 source
disagrees, record the conflict rather than preferring either.

## Where each chain publishes, as found

Measured on 20 November 2026, fetching from a cloud container, not a self-hosted
runner.

| Chain        | Venues | Where                                                            | Found                                                                                                                                                                                                                                                                                               |
| ------------ | ------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Picturehouse | 11     | `<attributes.url>/accessibility`, in `.cinimaAccessibility_div`  | **Not a regular template.** Only Central has the "Physical Access in our Screens" block; the rest are prose that differs per venue (Ealing lists seat numbers, the Ritzy gives counts in a sentence). Greenwich currently says Screen 5 has no step-free access. All 11 fetch with a plain request. |
| Vue          | 15     | `myvue.com/cinema/<slug>/whats-on`                               | 403 to a plain fetch. The listings retrieve already goes through Playwright, so this will too.                                                                                                                                                                                                      |
| ODEON        | 19     | `accessable.co.uk/odeon/access-guides/<slug>`                    | 403 to a plain fetch, as is all of accessable.co.uk                                                                                                                                                                                                                                                 |
| Everyman     | 16     | `everymanmedia.freshdesk.com/…/<id>-<venue>-accessibility-guide` | Freshdesk answers a plain fetch. Article ids still need discovering for 13 venues.                                                                                                                                                                                                                  |
| Curzon       | 10     | `curzon.com/venues/<slug>`                                       | 403 to a plain fetch                                                                                                                                                                                                                                                                                |
| Cineworld    | 12     | `cineworld.co.uk/cinemas/<id>`                                   | Not yet checked                                                                                                                                                                                                                                                                                     |
| Others       | 70     | Their own access pages; AccessAble as backup                     | Close-Up, BFI's whatson pages and the Hackney Local Offer refused a plain fetch; the rest of the seed's sources answered                                                                                                                                                                            |

So the fetch has to run where the listings retrieve runs, with the same
escalation: `getPageEscalating` (in `scripts`, `common/camoufox-escalation.js`)
for the pages that refuse us, which only the self-hosted runners can do.

## Screens and the listings

Whether "this showing is in a step-free screen" is possible depends on the
listings carrying a screen. `performance.screen` is already in `schema.json`,
and in the 20 November release, of the 153 venues:

- 55 gave every performance a screen, and 25 gave some: nearly all of ODEON (18
  of 19), Vue (12 of 15), Curzon and Picturehouse (7 of 10 and 7 of 11), both
  Electrics, Rio, ICA, Barbican, the BFI.
- Cineworld's 12 and Everyman's 16 gave none, though the box-office API they
  share names a screen on every Everyman showtime and many of Cineworld's.
  `scripts` #1009 reads it, so both now carry screens; Cineworld leaves it off
  some showtimes, so its coverage stays partial.

The names mostly line up already, because transforms pass the venue's screen
through `getScreen` (`common/utils.js` in `scripts`), which turns "Screen 1" and
"NFT1" into "1". Applying `getScreen` to a record's screen names matches the
listings for Vue ("Screen 1" and "1", "EPIC 1" on both sides), Picturehouse,
Rio, Lexi, Castle, Chiswick and BFI Southbank. Cases that need an `aliases`
entry: Olympic, whose listings name one screen "Olympic Studios" against three
on the access page; the Phoenix and Regent Street, where the seed has one
"Cinema" but the listings number them; and BFI IMAX ("IMAX" and "BFI IMAX").
Listings also name rooms that aren't screens (Rio's "Ludski", BFI's "Blue
Room"), so a listing screen with no record is unknown, never "no".

The first filter, "has at least one step-free screen with a wheelchair space",
needs none of this, and is the one to build first.

## Fetching and change detection

`npm run fetch-pages` fetches every page in `sources.json`, reduces it to text
(narrowed to the entry's `selector`, where it has one), and compares each page's
hash with `page-hashes.json`. A new or changed page sends its venue back for
review. A failed page is recorded and the rest carry on; the step fails
afterwards, with the pages that did come back already written to
`fetched-pages/`.

The hash is over the text, and only the access copy where a selector is given,
because chain pages wrap that copy in the site template: Picturehouse's carries
the venue's film carousel, which would change the hash every day. A selector
that doesn't match exactly one element throws, since the template has changed.

`npm run validate` then checks every record's quotes against those pages.

## The seed

`npm run import-seed` imported `venue-accessibility-seed.json`, the desk
research done before this repository existed, on 21 November 2026. **Nothing in
it is verified**: the research captured no quotes. So it went in as 39
candidates, one per venue the seed had researched (the other 103 entries said
nothing), and every venue's record started all unknown. None of it reaches the
website until each fact is checked against its page and moved into a record.

The import matched seed entries to venues by exact name (all 142 matched one
venue each), and validating the result caught values filed under the wrong
field, which the import didn't move, since which field was meant is a guess.
Each was reset to unknown with what the seed said kept in the candidate screen's
`notes`:

- Arthouse Crouch End and Close-Up: a wheelchair-space count under `step_free`.
- Genesis Screens 2 and 3: a `front` position under `wheelchair_spaces`.

Conflicts the seed recorded: Rio Screen 1 spaces (2 vs 3), ICA Cinema 1 and 2
spaces, the Phoenix (4 vs 2), the David Lean (3 vs 2), the Genesis lift (none,
stair-climber or platform lift), the Prince Charles (FAQ says no disabled
access, the access page describes a ramp) and BFI Southbank's hearing loops.
Finsbury Park's page conflicts with itself but isn't recorded as a conflict.
Picturehouse Central's does too: Screen 2 has "No. of wheelchair spaces: 2" and
lists three seats.

Time-sensitive: the Garden Cinema's Screen 3 platform lift was out of service
when checked, the Castle's lift planning appeal is pending, and Greenwich
Picturehouse's Screen 5 currently has no step-free access. Vue Piccadilly rests
on an Access Card listing alone.

## Still to build

1. **The fetch job**: a workflow on a self-hosted runner, monthly, running
   `fetch-pages` with Camoufox escalation for the pages that refuse a plain
   fetch, and opening a pull request with the changed hashes and the venues to
   review.
2. **Confirmations**: a log of when each quote was last seen on its page, kept
   apart from the records so re-confirming a fact doesn't change a record every
   month. A fact not confirmed in 12 months is shown as stale.
3. **Extraction**: an LLM reads a page's text against the schema and must return
   a quote for every field it doesn't leave unknown, through `callLlm` in
   `scripts`. Its output is a candidate, checked with `validateRecord` and
   `findMissingQuotes`, and reviewed like any other. Picturehouse goes here
   rather than to a parser, since its pages aren't a template.
4. **Sources**: Everyman's Freshdesk article ids, ODEON's AccessAble slugs,
   Curzon, Cineworld, and the venues with nothing registered.
5. **The website**: the venue page section, then the first filter.

For venues that publish nothing, keep an `access_contact` and ask for the
per-screen details in the schema.
