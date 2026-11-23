const {
  extractFrom,
  odeonCinemaGuide,
  readAssignedJson,
  vueAccessibility,
} = require("../lib/page-extractors");
const { getPageText } = require("../lib/page-text");

// Shaped like a Vue venue page: the markup has only the section headings, and
// the copy is in __NEXT_DATA__, with the cinema's name left as a placeholder.
const vuePage = (cinema) => `<html><body>
  <h2>Now showing</h2><p>Dune: Part Three</p>
  <button>Location access</button><button>Venue and screen access</button>
  <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { layoutData: { sitecore: { context: { cinema } } } } },
  })}</script>
</body></html>`;

const CINEMA = {
  cinemaName: { value: "London - Islington (Angel Central)" },
  accessibilityInformation: {
    value:
      "<p>Below, you'll find accessibility information for Vue {cinema-name}. We welcome assistance dogs into all our venues.</p>",
  },
  accessibilityFeatures: {
    targetItems: [
      {
        accessibilityFeatureName: { value: "Location access" },
        accessibilityFeatureDescription: {
          value: "<p>Lift access from the street.</p>",
        },
      },
      {
        accessibilityFeatureName: { value: "Venue and screen access" },
        accessibilityFeatureDescription: {
          value:
            "<p>Vue {cinema-name} has step-free access.</p><p>Screen 1: 2 Wheelchair Bays<br>Screen 10: 1 Wheelchair Bay</p>",
        },
      },
    ],
  },
};

describe("vueAccessibility", () => {
  it("takes the access copy from the page's data, leaving the rest out", () => {
    const text = getPageText(vueAccessibility(vuePage(CINEMA)));
    expect(text).toBe(
      "Below, you'll find accessibility information for Vue London - Islington (Angel Central). " +
        "We welcome assistance dogs into all our venues. " +
        "Location access Lift access from the street. " +
        "Venue and screen access Vue London - Islington (Angel Central) has step-free access. " +
        "Screen 1: 2 Wheelchair Bays Screen 10: 1 Wheelchair Bay",
    );
    expect(text).not.toContain("Dune");
  });

  it("throws when the page has no __NEXT_DATA__", () => {
    expect(() => vueAccessibility("<html><body></body></html>")).toThrow(
      "Expected one __NEXT_DATA__ script, found 0",
    );
  });

  it("throws when the data has no accessibility features", () => {
    const cinema = { ...CINEMA, accessibilityFeatures: { targetItems: [] } };
    expect(() => vueAccessibility(vuePage(cinema))).toThrow(
      "Expected the cinema's accessibilityFeatures.targetItems in __NEXT_DATA__",
    );
  });

  it("throws on a feature without a name or description", () => {
    const cinema = {
      ...CINEMA,
      accessibilityFeatures: {
        targetItems: [{ accessibilityFeatureName: { value: "Location" } }],
      },
    };
    expect(() => vueAccessibility(vuePage(cinema))).toThrow(
      "Accessibility feature 0 has no name or description",
    );
  });

  it("throws on a placeholder it can't fill", () => {
    const { cinemaName, ...unnamed } = CINEMA;
    expect(cinemaName).toBeDefined();
    expect(() => vueAccessibility(vuePage(unnamed))).toThrow(
      "Expected a cinemaName to fill {cinema-name} in accessibilityInformation",
    );
    const cinema = {
      ...CINEMA,
      accessibilityInformation: { value: "<p>Call {cinema-phone}.</p>" },
    };
    expect(() => vueAccessibility(vuePage(cinema))).toThrow(
      "Unexpected placeholder {cinema-phone} in accessibilityInformation",
    );
  });
});

describe("extractFrom", () => {
  it("runs the named extractor", () => {
    expect(extractFrom("vue-accessibility", vuePage(CINEMA))).toBe(
      vueAccessibility(vuePage(CINEMA)),
    );
  });

  it("throws on a name it doesn't know", () => {
    expect(() => extractFrom("odeon", "<html></html>")).toThrow(
      'Unknown text_from "odeon"; expected one of odeon-cinema-guide, vue-accessibility',
    );
    expect(() => extractFrom("toString", "<html></html>")).toThrow(
      'Unknown text_from "toString"',
    );
  });
});

// Shaped like an ODEON venue page: the guide is in window.pageData, assigned in
// a script that carries on with more code, beside a shared Accessibility tab.
const odeonPage = (value) => `<html><body>
  <div class="header-container"></div>
  <script>
    window.initialData = {"culture":"en-GB"};
    window.pageData = ${JSON.stringify([{ key: "/cinemas/acton/", value }])};
    (function () { if (window.pageData) { return "}" } })();
  </script>
  <script>var b = window.pageData; if (!b) {}</script>
</body></html>`;

const ACTON = {
  name: "Acton",
  cinemaGuide: [
    {
      tabTitle: "Cinema Info",
      boxes: [
        {
          boxTitle: "ODEON Luxe Acton",
          content: [{ title: "", text: "<p>We have 9 luxury screens.</p>" }],
        },
      ],
    },
    {
      tabTitle: "Screens",
      tabHeading: "ODEON Luxe Acton offers 9 screens",
      boxes: [
        {
          boxTitle: "Screen 1 - iSense",
          content: [
            { title: "Seats", text: "138 Recliner seats\n2 Wheelchair spaces" },
          ],
        },
      ],
    },
  ],
  extensions: {
    cinemaGuideTabs: [
      {
        tabTitle: "Accessibility",
        boxesContent: [
          {
            boxTitle: "Services",
            content: [
              { title: "", text: "<p>Each screen has wheelchair spaces</p>" },
            ],
          },
        ],
        cinemasContent: [{ urlSegment: "acton" }, { urlSegment: "bath" }],
      },
    ],
  },
};

describe("readAssignedJson", () => {
  it("reads the assigned value as JSON, without running the script", () => {
    expect(readAssignedJson(odeonPage(ACTON), "initialData")).toEqual({
      culture: "en-GB",
    });
    expect(readAssignedJson(odeonPage(ACTON), "pageData")[0].key).toBe(
      "/cinemas/acton/",
    );
  });

  it("throws when the page doesn't assign it once", () => {
    expect(() => readAssignedJson("<html></html>", "pageData")).toThrow(
      "Expected one window.pageData assignment, found 0",
    );
  });
});

describe("odeonCinemaGuide", () => {
  it("takes the venue's own guide, leaving out the chain's shared tabs", () => {
    const text = getPageText(odeonCinemaGuide(odeonPage(ACTON)));
    expect(text).toBe(
      "Cinema Info ODEON Luxe Acton We have 9 luxury screens. " +
        "Screens ODEON Luxe Acton offers 9 screens " +
        "Screen 1 - iSense Seats 138 Recliner seats 2 Wheelchair spaces",
    );
    expect(text).not.toContain("Each screen has wheelchair spaces");
  });

  it("throws when the page has no cinema guide", () => {
    expect(() => odeonCinemaGuide(odeonPage({ name: "Acton" }))).toThrow(
      "Expected the page's cinemaGuide in window.pageData",
    );
  });

  it("throws on a box without a title", () => {
    const value = {
      cinemaGuide: [{ tabTitle: "Screens", boxes: [{ content: [] }] }],
    };
    expect(() => odeonCinemaGuide(odeonPage(value))).toThrow(
      'Box 0 of the "Screens" tab has no title or content',
    );
  });
});
