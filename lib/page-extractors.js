const cheerio = require("cheerio");

/**
 * Where a page keeps its access copy in data rather than in its markup, an
 * extractor takes that copy out as HTML, which getPageText then reduces to
 * text as it would any page. A source names one with `text_from`.
 *
 * Each extractor throws when the data isn't where it expects, or isn't shaped
 * as it expects: the site has changed, and hashing whatever was left would
 * hide that.
 */

/**
 * Vue's venue pages are built with Next.js, which sends the page's data in a
 * <script id="__NEXT_DATA__"> block and draws the Accessibility section from
 * it in the browser. The markup carries only the section headings ("Location
 * access", "Venue and screen access"…), so without this the access copy is
 * lost with the scripts getPageText removes.
 *
 * The section opens with the chain's introduction, a template the browser
 * fills with the cinema's name, then each feature as a heading and its
 * description, in the order the page shows them. The name is filled in
 * wherever the copy leaves a {cinema-name} placeholder, as the browser does, so
 * the text reads as the page does.
 *
 * @param {string} html - The page
 * @returns {string} The access copy, as HTML
 */
function vueAccessibility(html) {
  const $ = cheerio.load(html);
  const scripts = $("script#__NEXT_DATA__");
  if (scripts.length !== 1) {
    throw new Error(
      `Expected one __NEXT_DATA__ script, found ${scripts.length}`,
    );
  }
  let data;
  try {
    data = JSON.parse(scripts.html());
  } catch (error) {
    throw new Error(`__NEXT_DATA__ isn't JSON: ${error.message}`);
  }
  const cinema = data?.props?.pageProps?.layoutData?.sitecore?.context?.cinema;
  const features = cinema?.accessibilityFeatures?.targetItems;
  if (!Array.isArray(features) || features.length === 0) {
    throw new Error(
      "Expected the cinema's accessibilityFeatures.targetItems in __NEXT_DATA__",
    );
  }
  const introduction = cinema.accessibilityInformation?.value;
  if (typeof introduction !== "string") {
    throw new Error("Expected the cinema's accessibilityInformation");
  }
  const cinemaName = cinema.cinemaName?.value;
  const fill = (value, where) => {
    if (value.includes("{cinema-name}") && typeof cinemaName !== "string") {
      throw new Error(
        `Expected a cinemaName to fill {cinema-name} in ${where}`,
      );
    }
    const filled = value.replaceAll("{cinema-name}", cinemaName);
    const placeholder = filled.match(/\{[a-z-]+\}/);
    if (placeholder) {
      throw new Error(`Unexpected placeholder ${placeholder[0]} in ${where}`);
    }
    return filled;
  };
  const opening = fill(introduction, "accessibilityInformation");
  const sections = features.map((feature, index) => {
    const name = feature?.accessibilityFeatureName?.value;
    const description = feature?.accessibilityFeatureDescription?.value;
    if (typeof name !== "string" || typeof description !== "string") {
      throw new Error(
        `Accessibility feature ${index} has no name or description`,
      );
    }
    return `<section><h2>${escapeHtml(name)}</h2>${fill(description, name)}</section>`;
  });
  return [`<section>${opening}</section>`, ...sections].join("\n");
}

/**
 * @param {string} value
 * @returns {string}
 */
const escapeHtml = (value) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const EXTRACTORS = { "vue-accessibility": vueAccessibility };

/**
 * The HTML a named extractor takes from a page. A name it doesn't know throws.
 *
 * @param {string} name - The source's `text_from`
 * @param {string} html - The page
 * @returns {string}
 */
function extractFrom(name, html) {
  const extractor = Object.hasOwn(EXTRACTORS, name) ? EXTRACTORS[name] : null;
  if (!extractor) {
    throw new Error(
      `Unknown text_from "${name}"; expected one of ${Object.keys(EXTRACTORS).join(", ")}`,
    );
  }
  return extractor(html);
}

module.exports = { extractFrom, vueAccessibility };
