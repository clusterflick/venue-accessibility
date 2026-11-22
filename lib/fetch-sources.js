const {
  getPageText,
  getTextBetween,
  hashText,
  normaliseText,
} = require("./page-text");
const { extractFrom } = require("./page-extractors");
const cheerio = require("cheerio");
const { fetchWithRetry, sanitizePathSegment } = require("scripts/common/utils");

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
 * would be hashed and stored as if it were the page. Cloudflare's two, and the
 * one the Clapham Grand's host gives `fetch-pages` but not every client.
 */
const CHALLENGE_OPENINGS = [
  "Just a moment...",
  "Attention Required!",
  "Please wait while your request is being verified...",
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
 * @param {{ url: string, selector?: string, text_from?: string, text_between?: [string, string] }} source
 * @returns {Promise<string>}
 */
async function fetchSourceText({
  url,
  selector,
  text_from: textFrom,
  text_between: textBetween,
}) {
  if (selector && textFrom) {
    throw new Error(`${url} has both a selector and text_from`);
  }
  const text = await fetchWholeText(url, selector, textFrom);
  return textBetween ? getTextBetween(text, textBetween) : text;
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
  const html = new TextDecoder().decode(bytes);
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
 * @param {(source: object) => Promise<string>} [options.fetchText] - For tests
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
          fetchText(source).then(
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
