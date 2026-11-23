const {
  getPageText,
  getTextBetween,
  hashText,
  normaliseText,
} = require("./page-text");
const { extractFrom } = require("./page-extractors");
const cheerio = require("cheerio");
const {
  fetchWithRetry,
  sanitizePathSegment,
  sleep,
  withJitter,
} = require("scripts/common/utils");

/**
 * The stored page's file name. A URL is too long and too punctuated to be one,
 * so it's the venue and the URL's hash.
 *
 * @param {string} venueId
 * @param {string} url
 * @returns {string}
 */
const getPageFileName = (venueId, url) =>
  `${sanitizePathSegment(venueId)}--${hashText(url).slice(0, 12)}.json`;

/**
 * Whether a response is a PDF: by its content type, or failing that by the
 * "%PDF" every PDF file starts with, since some servers send PDFs as
 * application/octet-stream.
 *
 * @param {Response} response
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
const isPdf = (response, bytes) =>
  (response.headers.get("content-type") ?? "").includes("application/pdf") ||
  Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-";

/**
 * A PDF's text, every page in order, normalised as a page's is. Venues publish
 * access guides as PDFs (the ICA's), and reading those as HTML stored their
 * raw bytes, which no quote could match.
 *
 * The text comes out in PDF.js's reading order, which for a multi-column
 * guide is not always the order a person reads it in; a quote is copied from
 * this text, so it matches however the columns came out.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<string>}
 */
async function getPdfText(bytes) {
  // unpdf loads PDF.js as an ES module, which Jest only allows with
  // --experimental-vm-modules (set in the test script).
  const { extractText, getDocumentProxy } = require("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return normaliseText(text);
}

/**
 * How the bot challenges we've met begin. They answer 200, so without this one
 * would be hashed and stored as if it were the page. Cloudflare's two, the one
 * the Clapham Grand's host gives `fetch-pages` but not every client, and
 * Imperva's (Incapsula), which the Royal Albert Hall gives.
 */
const CHALLENGE_OPENINGS = [
  "Just a moment...",
  "Attention Required!",
  "Please wait while your request is being verified...",
  "Request unsuccessful. Incapsula incident ID",
];

/**
 * The opening of a bot challenge the page's title or text starts with, or
 * null. Cloudflare's says so only in its title, which the page's text leaves
 * out.
 *
 * @param {string} html - The whole page
 * @returns {string|null}
 */
const findChallenge = (html) => {
  const title = normaliseText(
    cheerio.load(html)("head > title").first().text(),
  );
  const text = getPageText(html);
  return (
    CHALLENGE_OPENINGS.find(
      (opening) => title.startsWith(opening) || text.startsWith(opening),
    ) ?? null
  );
};

/**
 * Fetch one source page and reduce it to the text facts are checked against.
 * A selector or `text_from` only makes sense for an HTML page, so one given
 * for a PDF fails, and they can't be given together, since each picks the
 * part of the page that holds the access copy; `text_between` narrows the
 * text any of them gives.
 *
 * A source with `escalate` is fetched through `getPage`, a Camoufox session
 * (`withCamoufoxSession` in scripts), for a site that answers a plain fetch
 * with a bot challenge. See fetchEscalated.
 *
 * @param {{ url: string, selector?: string, text_from?: string, text_between?: [string, string], escalate?: string }} source
 * @param {{ getPage?: Function, pace?: () => Promise<void> }} [session] -
 *   `pace` is the pause before each page the session fetches, by default
 *   paceEscalated
 * @returns {Promise<string>}
 */
async function fetchSourceText(
  {
    url,
    selector,
    text_from: textFrom,
    text_between: textBetween,
    escalate,
    click,
  },
  { getPage, pace = paceEscalated } = {},
) {
  if (selector && textFrom) {
    throw new Error(`${url} has both a selector and text_from`);
  }
  if (click && !escalate) {
    throw new Error(`${url} has click without escalate, which it needs`);
  }
  const session = { getPage, pace };
  const text = click
    ? await fetchClicked(url, { escalate, click }, session, selector)
    : escalate
      ? await fetchEscalated(url, escalate, session, selector, textFrom)
      : await fetchWholeText(url, selector, textFrom);
  return textBetween ? getTextBetween(text, textBetween) : text;
}

// Sites that challenge a plain fetch tend to challenge a crawl that arrives
// back to back too, so each page the browser loads is spaced out, jittered as
// the listings retrieve's are.
const ESCALATED_PAGE_DELAY_MS = 5_000;
const paceEscalated = () => sleep(withJitter(ESCALATED_PAGE_DELAY_MS));

/**
 * Fetch a page that a plain request can't get, with `getPageEscalating` from
 * scripts: a plain fetch first, and the browser from the first refusal on, for
 * the rest of the session. `escalate` is a selector only the real page carries,
 * which is how a challenge served with a 200 is told apart from it, and what
 * the browser waits for while one clears. Escalating is opted into per source,
 * in sources.json, never done for a page that didn't ask for it.
 *
 * The page is still checked for a challenge afterwards, so one the browser
 * couldn't clear fails rather than being hashed.
 *
 * @param {string} url
 * @param {string} escalate - The selector only the real page carries
 * @param {{ getPage?: Function, pace: () => Promise<void> }} session - A
 *   `withCamoufoxSession` getPage, and the pause before each page
 * @param {string} [selector]
 * @param {string} [textFrom]
 * @returns {Promise<string>}
 */
async function fetchEscalated(
  url,
  escalate,
  { getPage, pace },
  selector,
  textFrom,
) {
  if (!getPage) {
    throw new Error(`${url} escalates, so needs a browser session's getPage`);
  }
  const { getPageEscalating } = require("scripts/common/camoufox-escalation");
  const html = await getPageEscalating(
    getPage,
    url,
    `venue-accessibility-${hashText(url).slice(0, 16)}`,
    { selector: escalate, pace },
  );
  if (typeof html !== "string") {
    throw new Error(`${url} gave no page through the browser`);
  }
  return getHtmlText(url, html, selector, textFrom);
}

/**
 * Fetch a page whose access copy only appears once a visitor clicks something,
 * such as a tab drawn in the browser (Curzon's venue pages keep theirs under
 * "Information"). It always goes through the browser, since a plain fetch
 * can't click. The browser waits for `click` to show (which is also how a
 * challenge in front of the page clears), clicks it, then waits for
 * `escalate`, the selector only the clicked-open page carries.
 *
 * @param {string} url
 * @param {{ escalate: string, click: string }} selectors
 * @param {{ getPage?: Function, pace: () => Promise<void> }} session
 * @param {string} [selector]
 * @returns {Promise<string>}
 */
async function fetchClicked(
  url,
  { escalate, click },
  { getPage, pace },
  selector,
) {
  if (!getPage) {
    throw new Error(`${url} escalates, so needs a browser session's getPage`);
  }
  const html = await getPage(
    url,
    `venue-accessibility-${hashText(url).slice(0, 16)}`,
    async (page) => {
      const target = page.locator(click).first();
      await target.waitFor({ state: "visible" });
      await target.click();
      await page.waitForSelector(escalate, { state: "attached" });
      await page.waitForLoadState("load");
      const content = await page.content();
      await pace();
      return content;
    },
  );
  if (typeof html !== "string") {
    throw new Error(`${url} gave no page through the browser`);
  }
  return getHtmlText(url, html, selector);
}

/**
 * @param {string} url
 * @param {string} [selector]
 * @param {string} [textFrom]
 * @returns {Promise<string>}
 */
async function fetchWholeText(url, selector, textFrom) {
  const response = await fetchWithRetry(url);
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (isPdf(response, bytes)) {
    if (selector) throw new Error(`${url} is a PDF, so can't take a selector`);
    if (textFrom) throw new Error(`${url} is a PDF, so can't take text_from`);
    return getPdfText(bytes);
  }
  return getHtmlText(url, new TextDecoder().decode(bytes), selector, textFrom);
}

/**
 * @param {string} url
 * @param {string} html
 * @param {string} [selector]
 * @param {string} [textFrom]
 * @returns {string}
 */
function getHtmlText(url, html, selector, textFrom) {
  const challenge = findChallenge(html);
  if (challenge) {
    throw new Error(`${url} answered a bot challenge ("${challenge}")`);
  }
  if (textFrom) return getPageText(extractFrom(textFrom, html));
  return getPageText(html, selector);
}

/**
 * The key a source's hash is kept under: its address, and the part of the page
 * it reads where it reads only part. Venues that share a page can each read
 * their own part of it (Olympic's three cinemas), and each part is hashed and
 * fetched separately.
 *
 * @param {{ url: string, selector?: string, text_from?: string, text_between?: [string, string] }} source
 * @returns {string}
 */
function getHashKey({ url, selector, text_from, text_between }) {
  const narrowing = Object.fromEntries(
    Object.entries({ selector, text_from, text_between }).filter(
      ([, value]) => value !== undefined,
    ),
  );
  return Object.keys(narrowing).length
    ? `${url} ${JSON.stringify(narrowing)}`
    : url;
}

/**
 * Fetch every page in the source registry and say which have changed since the
 * hashes last recorded.
 *
 * A page that fails is recorded as failed and the rest carry on: one venue's
 * site being down says nothing about the others, and the pages that did come
 * back are worth keeping. The caller fails the run afterwards if any did.
 *
 * A changed page sends its venue back for review, since any fact taken from it
 * may no longer hold. A page seen for the first time does too - nothing from it
 * has been checked yet.
 *
 * @param {object} options
 * @param {Record<string, Array<{ url: string, tier: number, selector?: string, text_from?: string, text_between?: [string, string] }>>} options.sources
 *   The source registry
 * @param {Record<string, { hash: string, fetched_on: string }>} [options.previousHashes]
 *   getHashKey(source) -> what the last run saw
 * @param {string} options.today - YYYY-MM-DD, London time
 * @param {Function} [options.getPage] - A Camoufox session's getPage, for the
 *   sources that escalate
 * @param {(source: object, session: object) => Promise<string>} [options.fetchText] - For tests
 * @returns {Promise<{
 *   pages: Array<{ venueId: string, url: string, file: string, hash: string, text: string }>,
 *   hashes: Record<string, { hash: string, fetched_on: string }>,
 *   changed: Array<{ venueId: string, url: string, reason: "new" | "changed" }>,
 *   failures: Array<{ venueId: string, url: string, error: string }>,
 * }>}
 */
async function fetchSources({
  sources,
  previousHashes = {},
  today,
  getPage,
  fetchText = fetchSourceText,
}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today ?? "")) {
    throw new Error(`Expected today as YYYY-MM-DD, got ${today}`);
  }
  const pages = [];
  const changed = [];
  const failures = [];
  // A failed fetch keeps the last hash, so the next run compares against what
  // was last actually seen rather than treating the page as new.
  const hashes = { ...previousHashes };
  // A page cited by two venues is fetched once.
  const fetched = new Map();

  for (const [venueId, entries] of Object.entries(sources).sort()) {
    for (const source of entries) {
      const key = getHashKey(source);
      if (!fetched.has(key)) {
        fetched.set(
          key,
          fetchText(source, { getPage }).then(
            (text) => ({ text }),
            (error) => ({ error: error.message || String(error) }),
          ),
        );
      }
      const result = await fetched.get(key);
      if (result.error) {
        failures.push({ venueId, url: source.url, error: result.error });
        continue;
      }
      const hash = hashText(result.text);
      const previous = previousHashes[key];
      if (!previous) changed.push({ venueId, url: source.url, reason: "new" });
      else if (previous.hash !== hash) {
        changed.push({ venueId, url: source.url, reason: "changed" });
      }
      hashes[key] = { hash, fetched_on: today };
      pages.push({
        venueId,
        url: source.url,
        file: getPageFileName(venueId, source.url),
        hash,
        text: result.text,
      });
    }
  }
  return { pages, hashes, changed, failures };
}

module.exports = {
  getHashKey,
  fetchSources,
  fetchSourceText,
  getPageFileName,
  getPdfText,
};
