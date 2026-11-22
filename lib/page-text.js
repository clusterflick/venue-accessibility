const crypto = require("node:crypto");
const cheerio = require("cheerio");

/**
 * The readable text of an access page, as one line of single-spaced text.
 *
 * Quotes are checked against this rather than the HTML, so a quote copied off
 * the rendered page matches however the markup splits it (Picturehouse puts
 * each screen's figures on their own line with <br>, and a quote spans them).
 * Block elements and <br> become spaces before the text is taken, or "Screen 1"
 * and "No. of seats" would run together.
 *
 * A selector narrows it to the part of the page about access. Chain pages wrap
 * the access copy in the same template as everything else - Picturehouse's
 * carries the venue's film carousel - so without it the text, and its hash,
 * would change with the listings every day. A selector that doesn't match
 * exactly one element throws: the template has changed, and hashing whatever
 * is left would hide that.
 *
 * @param {string} html - The page
 * @param {string} [selector] - The element holding the access copy
 * @returns {string}
 */
function getPageText(html, selector) {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, template").remove();
  $(
    "br, p, div, li, td, th, tr, h1, h2, h3, h4, h5, h6, section, article",
  ).each((_, element) => {
    $(element).prepend(" ").append(" ");
  });
  if (selector) {
    const matches = $(selector);
    if (matches.length !== 1) {
      throw new Error(
        `Expected one element for "${selector}", found ${matches.length}`,
      );
    }
    return normaliseText(matches.text());
  }
  return normaliseText($("body").length ? $("body").text() : $.root().text());
}

/**
 * The part of a page's text from one marker up to another: the start marker
 * kept, the end marker left out. For pages whose access copy has no element a
 * selector can hold onto - Cineworld's sit in class names generated anew with
 * each build of the site - but which always open and close it with the same
 * words. Without it the text carries the template around it (Cineworld's has
 * the week's dates), and its hash changes every day.
 *
 * A marker found anything but once throws, as a selector matching anything but
 * one element does: the page has changed, and hashing whatever is left would
 * hide that.
 *
 * @param {string} text - From getPageText or getPdfText
 * @param {[string, string]} markers - The words that open and close the copy
 * @returns {string}
 */
function getTextBetween(text, markers) {
  if (
    !Array.isArray(markers) ||
    markers.length !== 2 ||
    !markers.every((marker) => typeof marker === "string" && marker.trim())
  ) {
    throw new Error(
      `Expected text_between as [start, end], got ${JSON.stringify(markers)}`,
    );
  }
  const [start, end] = markers.map(normaliseText);
  const findOnce = (marker) => {
    const index = text.indexOf(marker);
    if (index === -1 || text.indexOf(marker, index + 1) !== -1) {
      const count = text.split(marker).length - 1;
      throw new Error(`Expected "${marker}" once in the page, found ${count}`);
    }
    return index;
  };
  const from = findOnce(start);
  const to = findOnce(end);
  if (to < from + start.length) {
    throw new Error(`Expected "${end}" after "${start}" in the page`);
  }
  return normaliseText(text.slice(from, to));
}

/**
 * Spacing, quote marks and dashes reduced to one form, so a quote doesn't fail
 * because it was typed with a straight apostrophe and published with a curly
 * one. Case is kept: a quote is meant to be the page's own words.
 *
 * @param {string} value
 * @returns {string}
 */
function normaliseText(value) {
  return value
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201F\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\s\u00A0\u200B]+/g, " ")
    .trim();
}

/**
 * Whether a quote still appears on the page.
 *
 * @param {string} quote - The record's quote
 * @param {string} pageText - From getPageText
 * @returns {boolean}
 */
function quoteAppearsIn(quote, pageText) {
  const needle = normaliseText(quote);
  return needle.length > 0 && normaliseText(pageText).includes(needle);
}

/**
 * The hash change detection compares. Taken over the extracted text rather
 * than the HTML, so a page that only changed its scripts or tracking ids
 * doesn't send its venue back for review.
 *
 * @param {string} pageText
 * @returns {string}
 */
function hashText(pageText) {
  return crypto.createHash("sha256").update(pageText).digest("hex");
}

module.exports = {
  getPageText,
  getTextBetween,
  normaliseText,
  quoteAppearsIn,
  hashText,
};
