// mod_test.ts
//
// CI/CD regression intent
// - Minimal deterministic Playwright regression.
// - Serve a blank HTML, then in page.evaluate():
//    - dynamic import ./omb.js
//    - fetch fixture XML
//    - build model from XML string
//    - return model JSON
// - Compare structural JSON to GOLDEN.
//
// Golden workflow
// - For each fixture `./fixtures/*.omb.xml`, the golden is `./fixtures/*.omb.golden.json`.
// - To re-generate, this writes per-fixture golden JSON:
//     UPDATE_GOLDEN=1 deno test -A mod_test.ts
// - In CI/CD, do NOT set UPDATE_GOLDEN; drift fails the test.
//
// Typechecking note
// - Deno tests do not include DOM lib typings by default, so even mentioning
//   `document` in TypeScript causes type errors.
// - Keep all browser DOM references inside the page.evaluate string.

import { assert, assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";

// deno-lint-ignore no-import-prefix
import { chromium } from "npm:playwright@1";

async function writeGolden(path: string, value: unknown) {
  const txt = JSON.stringify(value, null, 2) + "\n";
  await Deno.writeTextFile(path, txt);
}

function contentTypeFor(pathname: string): string {
  if (pathname.endsWith(".html")) return "text/html; charset=utf-8";
  if (pathname.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (pathname.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (pathname.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
  if (pathname.endsWith(".json")) return "application/json; charset=utf-8";
  if (pathname.endsWith(".xml")) return "application/xml; charset=utf-8";
  return "application/octet-stream";
}

function startTestServer(allowPaths: Record<string, string>, html: string) {
  const controller = new AbortController();

  const server = Deno.serve(
    {
      hostname: "127.0.0.1",
      port: 0,
      signal: controller.signal,
      onListen: () => {},
    },
    async (req) => {
      const url = new URL(req.url);

      if (url.pathname === "/" || url.pathname === "/test.html") {
        return new Response(html, {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      }

      const mapped = allowPaths[url.pathname];
      if (!mapped) return new Response("Not Found", { status: 404 });

      try {
        const bytes = await Deno.readFile(mapped);
        return new Response(bytes, {
          headers: {
            "content-type": contentTypeFor(mapped),
            "cache-control": "no-store",
          },
        });
      } catch {
        return new Response("Not Found", { status: 404 });
      }
    },
  );

  const origin = `http://127.0.0.1:${server.addr.port}`;
  return { origin, close: () => controller.abort() };
}

const BLANK_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>OMB Test</title>
  </head>
  <body>This is an empty body, we're only going to run JavaScript.</body>
</html>
`;

async function readGolden(path: string): Promise<unknown | undefined> {
  try {
    const txt = await Deno.readTextFile(path);
    if (!txt || txt.includes("undefined")) return undefined;
    return JSON.parse(txt);
  } catch {
    return undefined;
  }
}

async function listOmbFixtures(fixturesDir: string): Promise<string[]> {
  const files: string[] = [];
  for await (const e of Deno.readDir(fixturesDir)) {
    if (!e.isFile) continue;
    if (!e.name.endsWith(".omb.xml")) continue;
    files.push(e.name);
  }
  files.sort((a, b) => a.localeCompare(b));
  return files;
}

Deno.test(
  "OMB golden regression: all fixtures/*.omb.xml deep-equal matching *.omb.golden.json",
  async (t) => {
    const here = dirname(fromFileUrl(import.meta.url));
    const fixturesDir = join(here, "fixtures");

    const ombPath = join(here, "omb.js");
    const fixtureNames = await listOmbFixtures(fixturesDir);

    if (fixtureNames.length === 0) {
      throw new Error(`No fixtures found in: ${fixturesDir}`);
    }

    // Map only the files we intend to serve (omb.js + each fixture xml + each golden json).
    const ombJsBrowserPath = "/omb.js";
    const allowPaths: Record<string, string> = {
      [ombJsBrowserPath]: ombPath,
    };

    const cases = fixtureNames.map((xmlName) => {
      const xmlFsPath = join(fixturesDir, xmlName);
      const goldenName = xmlName.replace(/\.omb\.xml$/i, ".omb.golden.json");
      const goldenFsPath = join(fixturesDir, goldenName);

      const xmlUrlPath = `/fixtures/${xmlName}`;
      const goldenUrlPath = `/fixtures/${goldenName}`;

      allowPaths[xmlUrlPath] = xmlFsPath;
      allowPaths[goldenUrlPath] = goldenFsPath;

      return {
        name: xmlName,
        xmlName,
        xmlFsPath,
        xmlUrlPath,
        goldenName,
        goldenFsPath,
      };
    });

    const { origin, close } = startTestServer(allowPaths, BLANK_HTML);

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    page.on("console", (m) => console.log("[browser]", m.type(), m.text()));
    page.on("pageerror", (e) => console.log("[pageerror]", String(e)));
    page.on(
      "requestfailed",
      (r) =>
        console.log(
          "[requestfailed]",
          r.method(),
          r.url(),
          r.failure()?.errorText,
        ),
    );

    const updateGolden = (Deno.env.get("UPDATE_GOLDEN") ?? "").trim() === "1";

    try {
      await page.goto(`${origin}/test.html`, { waitUntil: "domcontentloaded" });

      for (const c of cases) {
        await t.step(c.name, async () => {
          const actual = await page.evaluate(async (args) => {
            // deno-lint-ignore no-explicit-any
            const doc = (globalThis as unknown as { document: any }).document;
            if (!doc?.documentElement) {
              throw new Error("no document in page context");
            }

            const mod = await import(args.ombJsBrowserPath);
            // deno-lint-ignore no-explicit-any
            const { createOmbBuilder } = mod as any;

            const r = await fetch(args.xmlUrlPath, {
              headers: { Accept: "application/xml,text/xml,*/*" },
            });
            if (!r.ok) {
              throw new Error(
                `fixture fetch failed (${r.status}): ${r.statusText}`,
              );
            }
            const xml = await r.text();

            const builder = createOmbBuilder();
            const model = builder.buildFromXmlString(xml, {
              host: doc.documentElement,
            });

            return JSON.parse(JSON.stringify(model.toJSON({ withTags: true })));
          }, { xmlUrlPath: c.xmlUrlPath, ombJsBrowserPath });

          if (updateGolden) {
            await writeGolden(c.goldenFsPath, actual);
            return;
          }

          const golden = await readGolden(c.goldenFsPath);
          assert(
            golden,
            `Golden file missing or invalid for ${c.xmlName}: ${c.goldenName}. Re-run with UPDATE_GOLDEN=1 to generate it.`,
          );
          assertEquals(actual, golden);
        });
      }
    } finally {
      await page.close().catch(() => {});
      await browser.close().catch(() => {});
      close();
    }
  },
);
