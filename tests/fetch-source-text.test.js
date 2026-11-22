const fs = require("node:fs");
const path = require("node:path");
const { fetchSourceText } = require("../lib/fetch-sources");

const PDF = fs.readFileSync(path.join(__dirname, "fixtures", "access.pdf"));

const respond = (body, contentType) =>
  jest.spyOn(global, "fetch").mockResolvedValue(
    new Response(body, {
      status: 200,
      headers: { "content-type": contentType },
    }),
  );

afterEach(() => jest.restoreAllMocks());

describe("fetchSourceText", () => {
  it("reads an HTML page's text", async () => {
    respond("<html><body><p>Level access</p></body></html>", "text/html");
    await expect(
      fetchSourceText({ url: "https://example.com/access" }),
    ).resolves.toBe("Level access");
  });

  it("reads a PDF's text, so quotes from an access guide can be checked", async () => {
    respond(PDF, "application/pdf");
    await expect(
      fetchSourceText({ url: "https://example.com/access.pdf" }),
    ).resolves.toBe("Step-free access to both screens.");
  });

  it("knows a PDF by its first bytes when the server doesn't say", async () => {
    respond(PDF, "application/octet-stream");
    await expect(
      fetchSourceText({ url: "https://example.com/download" }),
    ).resolves.toBe("Step-free access to both screens.");
  });

  it("refuses a selector for a PDF", async () => {
    respond(PDF, "application/pdf");
    await expect(
      fetchSourceText({
        url: "https://example.com/access.pdf",
        selector: "main",
      }),
    ).rejects.toThrow(
      "https://example.com/access.pdf is a PDF, so can't take a selector",
    );
  });

  it("narrows an HTML page's text to text_between", async () => {
    respond(
      "<html><body><p>Sun 22</p><h2>FAQ</h2><p>Level access</p>" +
        "<footer>About us</footer></body></html>",
      "text/html",
    );
    await expect(
      fetchSourceText({
        url: "https://example.com/venue",
        text_between: ["FAQ", "About us"],
      }),
    ).resolves.toBe("FAQ Level access");
  });

  it("narrows a PDF's text too, since it works on the text", async () => {
    respond(PDF, "application/pdf");
    await expect(
      fetchSourceText({
        url: "https://example.com/access.pdf",
        text_between: ["Step-free", "screens."],
      }),
    ).resolves.toBe("Step-free access to both");
  });
});
