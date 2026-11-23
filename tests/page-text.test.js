const {
  getPageText,
  getTextBetween,
  quoteAppearsIn,
  hashText,
} = require("../lib/page-text");

// Shaped like a Picturehouse access page: the access copy in its own element,
// the chain's film carousel beside it, each screen's figures split by <br>.
const PAGE = `<html><head><style>.x{}</style><script>var a = 1;</script></head>
<body>
  <div class="carousel"><h3>Dune: Part Three</h3></div>
  <div class="cinimaAccessibility_div">
    <h2>ACCESSIBILITY AT PICTUREHOUSE CENTRAL</h2>
    <p>Screen 1 <br>No. of seats: 341 <br>No. of wheelchair spaces: 6</p>
    <p>Guide dogs and assistance dogs are welcome&nbsp;&ndash; it&rsquo;s fine.</p>
  </div>
</body></html>`;

describe("getPageText", () => {
  it("keeps the words and drops scripts and styles", () => {
    const text = getPageText(PAGE);
    expect(text).toContain("No. of wheelchair spaces: 6");
    expect(text).not.toContain("var a");
    expect(text).not.toContain(".x{}");
  });

  it("leaves out a Gravity Forms honeypot, whose label changes on each load", () => {
    const form = (label) => `<html><body><p>Level access</p><form>
      <div class="gfield gfield--type-honeypot gform_validation_container">
        <label>${label}</label><input type="text">
        <div>This field is for validation purposes and should be left unchanged.</div>
      </div><label>Email*</label></form></body></html>`;
    expect(getPageText(form("URL"))).toBe("Level access Email*");
    expect(getPageText(form("Comments"))).toBe(getPageText(form("URL")));
  });

  it("separates text that block elements and <br> kept apart", () => {
    expect(getPageText(PAGE)).toContain(
      "Screen 1 No. of seats: 341 No. of wheelchair spaces: 6",
    );
  });

  it("narrows to the selector, leaving the rest of the template out", () => {
    const text = getPageText(PAGE, ".cinimaAccessibility_div");
    expect(text).toContain("ACCESSIBILITY AT PICTUREHOUSE CENTRAL");
    expect(text).not.toContain("Dune");
  });

  it("throws when the selector matches anything but one element", () => {
    expect(() => getPageText(PAGE, ".missing")).toThrow(
      'Expected one element for ".missing", found 0',
    );
    expect(() => getPageText(PAGE, "p")).toThrow(
      'Expected one element for "p", found 2',
    );
  });
});

describe("getTextBetween", () => {
  // Shaped like a Cineworld venue page: the week's dates before the FAQ, the
  // footer after it, and no element around the FAQ a selector could hold.
  const TEXT =
    "Now playing Sun 22 Mon 23 Tue 24 Frequently asked questions " +
    "Does it have wheelchair access? Disabled Access Available " +
    "Cineworld About us © 2026 Cineworld Cinemas";
  const MARKERS = ["Frequently asked questions", "Cineworld About us"];

  it("keeps the start marker and what follows, up to the end marker", () => {
    expect(getTextBetween(TEXT, MARKERS)).toBe(
      "Frequently asked questions Does it have wheelchair access? " +
        "Disabled Access Available",
    );
  });

  it("hashes the same whatever the dates around it say", () => {
    const nextWeek = TEXT.replace("Sun 22 Mon 23 Tue 24", "Sun 29 Mon 30");
    expect(hashText(getTextBetween(nextWeek, MARKERS))).toBe(
      hashText(getTextBetween(TEXT, MARKERS)),
    );
  });

  it("matches markers however their quotes and spacing were typed", () => {
    expect(getTextBetween("a It's here b", ["It\u2019s  here", "b"])).toBe(
      "It's here",
    );
  });

  it("throws when a marker is missing or found more than once", () => {
    expect(() => getTextBetween(TEXT, ["Opening times", "Cineworld"])).toThrow(
      'Expected "Opening times" once in the page, found 0',
    );
    expect(() => getTextBetween(TEXT, ["Cineworld", "©"])).toThrow(
      'Expected "Cineworld" once in the page, found 2',
    );
  });

  it("throws when the end marker comes before the start", () => {
    expect(() =>
      getTextBetween(TEXT, [
        "Cineworld About us",
        "Frequently asked questions",
      ]),
    ).toThrow(
      'Expected "Frequently asked questions" after "Cineworld About us" in the page',
    );
  });

  it("throws on markers that aren't a pair of words", () => {
    expect(() => getTextBetween(TEXT, ["Frequently asked questions"])).toThrow(
      'Expected text_between as [start, end], got ["Frequently asked questions"]',
    );
    expect(() => getTextBetween(TEXT, ["", "Cineworld About us"])).toThrow(
      "Expected text_between as [start, end]",
    );
  });
});

describe("quoteAppearsIn", () => {
  const text = getPageText(PAGE);

  it("finds a quote across a line break", () => {
    expect(
      quoteAppearsIn("No. of seats: 341 No. of wheelchair spaces: 6", text),
    ).toBe(true);
  });

  it("treats curly and straight quote marks, dashes and spaces alike", () => {
    expect(
      quoteAppearsIn("assistance dogs are welcome - it's   fine.", text),
    ).toBe(true);
  });

  it("doesn't find words the page doesn't say", () => {
    expect(quoteAppearsIn("No. of wheelchair spaces: 7", text)).toBe(false);
  });

  it("keeps case, since a quote is the page's own words", () => {
    expect(quoteAppearsIn("guide dogs and assistance dogs", text)).toBe(false);
  });

  it("never matches an empty quote", () => {
    expect(quoteAppearsIn("  ", text)).toBe(false);
  });
});

describe("hashText", () => {
  it("changes with the text and only with the text", () => {
    expect(hashText("a")).toBe(hashText("a"));
    expect(hashText("a")).not.toBe(hashText("b"));
  });
});
