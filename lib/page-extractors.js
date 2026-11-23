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

/**
 * The JSON value a page's script assigns to `window.<name>`, read as data: the
 * script itself is never run. Its end is found by matching brackets, skipping
 * strings, since the script carries on with other code after it.
 *
 * @param {string} html - The page
 * @param {string} name - The global the script assigns
 * @returns {unknown}
 */
function readAssignedJson(html, name) {
  const $ = cheerio.load(html);
  const assignment = new RegExp(`window\\.${name}\\s*=\\s*(?=[[{])`);
  const found = [];
  $("script").each((_, element) => {
    const script = $(element).html() ?? "";
    const match = assignment.exec(script);
    if (match) found.push(script.slice(match.index + match[0].length));
  });
  if (found.length !== 1) {
    throw new Error(
      `Expected one window.${name} assignment, found ${found.length}`,
    );
  }
  const source = found[0];
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
    } else if (character === '"') inString = true;
    else if (character === "{" || character === "[") depth++;
    else if ((character === "}" || character === "]") && --depth === 0) {
      try {
        return JSON.parse(source.slice(0, index + 1));
      } catch (error) {
        throw new Error(`window.${name} isn't JSON: ${error.message}`);
      }
    }
  }
  throw new Error(`window.${name} doesn't end`);
}

/**
 * ODEON's venue pages draw their cinema guide in the browser from
 * `window.pageData`, so the markup has none of it. The guide's tabs - "Cinema
 * Info", "Screens" - are the venue's own: the Screens tab gives each screen's
 * seats and wheelchair spaces ("138 Recliner seats\n2 Wheelchair spaces").
 *
 * The page's other tabs, Accessibility among them, are left out. They sit in
 * `extensions.cinemaGuideTabs`, each with the list of cinemas it's shown at
 * (the Accessibility tab is shared by 87), so they're the chain's copy rather
 * than the venue's, and a fact from them would be a chain-wide policy.
 *
 * Text that's plain is escaped and its line breaks kept; text that's HTML is
 * kept as the page would render it.
 *
 * @param {string} html - The page
 * @returns {string} The cinema guide, as HTML
 */
function odeonCinemaGuide(html) {
  const pageData = readAssignedJson(html, "pageData");
  if (!Array.isArray(pageData) || pageData.length !== 1) {
    throw new Error(
      `Expected window.pageData to hold one page, found ${Array.isArray(pageData) ? pageData.length : typeof pageData}`,
    );
  }
  const tabs = pageData[0]?.value?.cinemaGuide;
  if (!Array.isArray(tabs) || tabs.length === 0) {
    throw new Error("Expected the page's cinemaGuide in window.pageData");
  }
  const asHtml = (text) =>
    /<[a-z][^>]*>/i.test(text) ? text : escapeHtml(text).replace(/\n/g, "<br>");
  return tabs
    .map((tab, tabIndex) => {
      if (typeof tab?.tabTitle !== "string" || !Array.isArray(tab.boxes)) {
        throw new Error(`Cinema guide tab ${tabIndex} has no title or boxes`);
      }
      const heading = tab.tabHeading
        ? `<p>${escapeHtml(tab.tabHeading)}</p>`
        : "";
      const boxes = tab.boxes.map((box, boxIndex) => {
        if (typeof box?.boxTitle !== "string" || !Array.isArray(box.content)) {
          throw new Error(
            `Box ${boxIndex} of the "${tab.tabTitle}" tab has no title or content`,
          );
        }
        const items = box.content.map((item) => {
          if (typeof item?.text !== "string") {
            throw new Error(`An item in "${box.boxTitle}" has no text`);
          }
          const title = item.title ? `<h4>${escapeHtml(item.title)}</h4>` : "";
          return `${title}<div>${asHtml(item.text)}</div>`;
        });
        return `<section><h3>${escapeHtml(box.boxTitle)}</h3>${items.join("")}</section>`;
      });
      return `<section><h2>${escapeHtml(tab.tabTitle)}</h2>${heading}${boxes.join("")}</section>`;
    })
    .join("\n");
}

const EXTRACTORS = {
  "odeon-cinema-guide": odeonCinemaGuide,
  "vue-accessibility": vueAccessibility,
};

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

module.exports = {
  extractFrom,
  odeonCinemaGuide,
  readAssignedJson,
  vueAccessibility,
};
