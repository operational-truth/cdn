/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// natural-web-ua/elements_test.ts
//
// Run:
//   deno test -A natural-web-ua/elements_test.ts
// deno-lint-ignore-file no-window-prefix no-window

import { assert, assertEquals, assertMatch } from "@std/assert";
// deno-lint-ignore no-import-prefix
import { chromium } from "npm:playwright@1";

// deno-lint-ignore no-explicit-any
type Any = any;

type ServerCtl = {
  readonly baseUrl: string;
  close(): void;
};

type PwDiag = {
  console: Array<{ type: string; text: string }>;
  pageErrors: string[];
  requestFailed: Array<{ url: string; errorText: string }>;
  responses: Array<{ url: string; status: number; contentType: string | null }>;
};

const PW_TIMEOUT_MS = 5000;

function normalizeNewlines(s: string): string {
  return s.replaceAll("\r\n", "\n");
}

async function startServer(): Promise<ServerCtl> {
  const domLibUrlPath = "/natural-web-ua/elements.js";

  const fixtureHtmlPath = new URL("./elements_test.html", import.meta.url);
  const fixtureHtml = await Deno.readTextFile(fixtureHtmlPath);

  const domLib = await Deno.readTextFile(
    new URL("./elements.js", import.meta.url),
  );

  const handler = (req: Request): Response => {
    const url = new URL(req.url);

    if (url.pathname === "/") {
      return new Response("ok", { status: 200 });
    }

    if (url.pathname === "/fixture.html") {
      return new Response(fixtureHtml, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (url.pathname === domLibUrlPath) {
      return new Response(domLib, {
        status: 200,
        headers: { "content-type": "text/javascript; charset=utf-8" },
      });
    }

    return new Response("not found", { status: 404 });
  };

  const abort = new AbortController();

  const server = Deno.serve(
    {
      hostname: "127.0.0.1",
      port: 0,
      signal: abort.signal,
      onListen: () => {},
    },
    handler,
  );

  const addr = server.addr as Deno.NetAddr;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    baseUrl,
    close() {
      abort.abort();
    },
  };
}

function setupPlaywrightDiagnostics(page: Any): PwDiag {
  const diag: PwDiag = {
    console: [],
    pageErrors: [],
    requestFailed: [],
    responses: [],
  };

  page.on("console", (msg: Any) => {
    diag.console.push({ type: msg.type(), text: msg.text() });
  });

  page.on("pageerror", (err: Any) => {
    diag.pageErrors.push(String(err?.stack ?? err));
  });

  page.on("requestfailed", (req: Any) => {
    diag.requestFailed.push({
      url: req.url(),
      errorText: String(req.failure()?.errorText ?? "unknown failure"),
    });
  });

  page.on("response", async (res: Any) => {
    try {
      const headers = await res.allHeaders();
      diag.responses.push({
        url: res.url(),
        status: res.status(),
        contentType:
          (headers["content-type"] ?? headers["Content-Type"] ?? null) as
            | string
            | null,
      });
    } catch {
      // ignore
    }
  });

  return diag;
}

async function installInitProbe(page: Any): Promise<void> {
  await page.addInitScript(() => {
    (window as Any).__nh = (window as Any).__nh || {};
    (window as Any).__nh.init = {
      installedAt: Date.now(),
      domContentLoadedAt: null as number | null,
      loadAt: null as number | null,
      errors: [] as Array<Any>,
      rejections: [] as Array<Any>,
      logs: [] as string[],
    };

    window.addEventListener("DOMContentLoaded", () => {
      (window as Any).__nh.init.domContentLoadedAt = Date.now();
    });

    window.addEventListener("load", () => {
      (window as Any).__nh.init.loadAt = Date.now();
    });

    window.addEventListener("error", (e) => {
      (window as Any).__nh.init.errors.push({
        at: Date.now(),
        message: String((e as Any).message ?? e),
        filename: String((e as Any).filename ?? ""),
        lineno: Number((e as Any).lineno ?? 0),
        colno: Number((e as Any).colno ?? 0),
        stack: String(((e as Any).error?.stack ?? (e as Any).error) ?? ""),
      });
    });

    window.addEventListener("unhandledrejection", (e) => {
      (window as Any).__nh.init.rejections.push({
        at: Date.now(),
        reason: String((e as Any).reason?.stack ?? (e as Any).reason ?? e),
      });
    });

    // Inject test config early (NO template literal nesting).
    (window as Any).__NH_TEST_CONFIG__ = {
      domLibUrlPath: "/natural-web-ua/elements.js",
    };
  });
}

async function dumpFixtureState(page: Any): Promise<unknown> {
  return await page.evaluate(() => {
    const nh = (window as Any).__nh || {};
    const init = nh.init ?? null;
    const bootstrap = nh.bootstrap ?? null;
    const hasTestApi = typeof nh.testApi === "object" && nh.testApi != null;
    const importedKeys = Array.isArray(bootstrap?.importedKeys)
      ? bootstrap.importedKeys
      : [];
    const markerText = hasTestApi ? String(nh.testApi.marker?.() ?? "") : "";
    const scriptTags = Array.from(document.querySelectorAll("script")).map((
      s,
    ) => ({
      type: s.type || "",
      src: s.src || "",
      inlineLen: (s.textContent ?? "").length,
    }));

    return {
      readyState: document.readyState,
      init,
      bootstrap,
      importedKeys,
      hasTestApi,
      markerText,
      locationHref: location.href,
      scriptTags,
    };
  });
}

async function waitForBootstrapOrFail(page: Any, diag: PwDiag): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < PW_TIMEOUT_MS) {
    const ok = await page.evaluate(() => {
      const nh = (window as Any).__nh || {};
      return Boolean(nh.bootstrap?.ready) && typeof nh.testApi === "object" &&
        nh.testApi != null;
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 50));
  }

  const state = await dumpFixtureState(page);
  const html = normalizeNewlines((await page.content()).slice(0, 2400));

  throw new Error(
    [
      `fixture: bootstrap never became ready within ${PW_TIMEOUT_MS}ms`,
      ``,
      `bootstrap state:`,
      JSON.stringify(state, null, 2),
      ``,
      `playwright diagnostics:`,
      JSON.stringify(diag, null, 2),
      ``,
      `page.content (trimmed):`,
      html,
    ].join("\n"),
  );
}

Deno.test(
  "natural HTML: fixture boots and exposes testApi",
  { sanitizeResources: false, sanitizeOps: false },
  async () => {
    const server = await startServer();
    const browser = await chromium.launch();
    const page = await browser.newPage();

    const diag = setupPlaywrightDiagnostics(page);

    try {
      await installInitProbe(page);

      const fixtureUrl = `${server.baseUrl}/fixture.html`;

      // quick sanity fetch
      const res = await fetch(fixtureUrl);
      assertEquals(res.status, 200);

      await page.goto(fixtureUrl, {
        waitUntil: "load",
        timeout: PW_TIMEOUT_MS,
      });

      await waitForBootstrapOrFail(page, diag);

      const marker = await page.evaluate(() =>
        (window as Any).__nh.testApi.marker()
      );
      assertEquals(marker, "Fluent DOM");

      const status = await page.evaluate(() =>
        (window as Any).__nh.testApi.clickAndReadStatus()
      );
      assertEquals(status, "clicked");
    } finally {
      await page.close();
      await browser.close();
      server.close();
    }
  },
);

Deno.test(
  "natural HTML: DOM snapshot of container matches expected structure",
  { sanitizeResources: false, sanitizeOps: false },
  async () => {
    const server = await startServer();
    const browser = await chromium.launch();
    const page = await browser.newPage();

    const diag = setupPlaywrightDiagnostics(page);

    try {
      await installInitProbe(page);
      const fixtureUrl = `${server.baseUrl}/fixture.html`;
      await page.goto(fixtureUrl, {
        waitUntil: "load",
        timeout: PW_TIMEOUT_MS,
      });
      await waitForBootstrapOrFail(page, diag);

      const snap = await page.evaluate(() =>
        (window as Any).__nh.testApi.snapshotContainer()
      );
      assert(snap);

      // A few load-bearing checks (DOM-based, not HTML text).
      assertEquals(snap.t, "div");
      assertEquals(snap.a.class, "container compact");

      const findFirst = (node: Any, tag: string): Any | null => {
        if (!node) return null;
        if (node.t === tag) return node;
        for (const c of node.c ?? []) {
          const f = findFirst(c, tag);
          if (f) return f;
        }
        return null;
      };

      const header = findFirst(snap, "header");
      assert(header);

      const strong = findFirst(snap, "strong");
      assert(strong);
      const strongText = (strong.c ?? []).find((x: Any) =>
        x.t === "#text"
      )?.v ?? "";
      assertEquals(strongText, "Fluent DOM");

      const main = findFirst(snap, "main");
      assert(main);
      assertEquals(main.a.id, "main");

      const btn = findFirst(snap, "button");
      assert(btn);
      assertEquals(btn.a.id, "btn");
      assertEquals(btn.a.type, "button");
    } finally {
      await page.close();
      await browser.close();
      server.close();
    }
  },
);

Deno.test(
  "natural HTML: javaScript template keeps script body literal text",
  { sanitizeResources: false, sanitizeOps: false },
  async () => {
    const server = await startServer();
    const browser = await chromium.launch();
    const page = await browser.newPage();

    const diag = setupPlaywrightDiagnostics(page);

    try {
      await installInitProbe(page);
      const fixtureUrl = `${server.baseUrl}/fixture.html`;
      await page.goto(fixtureUrl, {
        waitUntil: "load",
        timeout: PW_TIMEOUT_MS,
      });
      await waitForBootstrapOrFail(page, diag);

      const r = await page.evaluate(() =>
        (window as Any).__nh.testApi.probeJavaScriptTemplateLiteral()
      );
      assertEquals(r.supported, true);
      assertEquals(r.tag, "script");
      assert(r.childNodes >= 1);

      // should include literal "</script>" text, not get truncated or parsed as HTML
      assertEquals(
        String(r.textContent),
        `console.log("literal <tag> & ok");
const x = "</scr" + "ipt>";`,
      );
    } finally {
      await page.close();
      await browser.close();
      server.close();
    }
  },
);

Deno.test(
  "natural HTML: render() parses string parts as trusted HTML snippets",
  { sanitizeResources: false, sanitizeOps: false },
  async () => {
    const server = await startServer();
    const browser = await chromium.launch();
    const page = await browser.newPage();

    const diag = setupPlaywrightDiagnostics(page);

    try {
      await installInitProbe(page);
      const fixtureUrl = `${server.baseUrl}/fixture.html`;
      await page.goto(fixtureUrl, {
        waitUntil: "load",
        timeout: PW_TIMEOUT_MS,
      });
      await waitForBootstrapOrFail(page, diag);

      const r = await page.evaluate(() =>
        (window as Any).__nh.testApi.probeRenderStringAsTrustedHtml()
      );
      assertEquals(r.supported, true);
      assertEquals(r.els.map((x: Any) => x.tag), ["b", "i"]);
      assertEquals(r.els.map((x: Any) => x.text), ["Hi", "There"]);
    } finally {
      await page.close();
      await browser.close();
      server.close();
    }
  },
);

Deno.test(
  "natural HTML: raw() blocked by dev-strict policy",
  { sanitizeResources: false, sanitizeOps: false },
  async () => {
    const server = await startServer();
    const browser = await chromium.launch();
    const page = await browser.newPage();

    const diag = setupPlaywrightDiagnostics(page);

    try {
      await installInitProbe(page);
      const fixtureUrl = `${server.baseUrl}/fixture.html`;
      await page.goto(fixtureUrl, {
        waitUntil: "load",
        timeout: PW_TIMEOUT_MS,
      });
      await waitForBootstrapOrFail(page, diag);

      const r = await page.evaluate(() =>
        (window as Any).__nh.testApi.probeRawPolicyDevStrict()
      );
      assertEquals(r.supported, true);
      assertEquals(r.threw, true);
      assertMatch(String(r.msg), /dev-strict/);
    } finally {
      await page.close();
      await browser.close();
      server.close();
    }
  },
);

Deno.test(
  "natural HTML: trustedRaw parses markup, text() does not",
  { sanitizeResources: false, sanitizeOps: false },
  async () => {
    const server = await startServer();
    const browser = await chromium.launch();
    const page = await browser.newPage();

    const diag = setupPlaywrightDiagnostics(page);

    try {
      await installInitProbe(page);
      const fixtureUrl = `${server.baseUrl}/fixture.html`;
      await page.goto(fixtureUrl, {
        waitUntil: "load",
        timeout: PW_TIMEOUT_MS,
      });
      await waitForBootstrapOrFail(page, diag);

      const r = await page.evaluate(() =>
        (window as Any).__nh.testApi.probeTrustedRawVsText()
      );
      assertEquals(r.supported, true);
      assertEquals(r.firstHasSpan, true);
      assertEquals(r.secondHasSpan, false);
      assertEquals(r.secondText, "<span>ok</span>");
    } finally {
      await page.close();
      await browser.close();
      server.close();
    }
  },
);

Deno.test(
  "natural HTML: UA deps head tags emission (if supported)",
  { sanitizeResources: false, sanitizeOps: false },
  async () => {
    const server = await startServer();
    const browser = await chromium.launch();
    const page = await browser.newPage();

    const diag = setupPlaywrightDiagnostics(page);

    try {
      await installInitProbe(page);
      const fixtureUrl = `${server.baseUrl}/fixture.html`;
      await page.goto(fixtureUrl, {
        waitUntil: "load",
        timeout: PW_TIMEOUT_MS,
      });
      await waitForBootstrapOrFail(page, diag);

      const r = await page.evaluate(() =>
        (window as Any).__nh.testApi.probeUaDepsHeadTags()
      );
      if (!r.supported) return;

      assert(r.styles.includes("/_natural/app.css"));
      assert(
        r.moduleScripts.includes("/_natural/app.js") ||
          r.moduleScripts.includes("<inline>"),
      );
      assert(
        r.classicScripts.includes("/_natural/legacy.js") ||
          r.classicScripts.includes("<inline>"),
      );
      assert(r.inlineStyleCount >= 0);
    } finally {
      await page.close();
      await browser.close();
      server.close();
    }
  },
);

Deno.test(
  "natural HTML: style attribute extraction and emission (if supported)",
  { sanitizeResources: false, sanitizeOps: false },
  async () => {
    const server = await startServer();
    const browser = await chromium.launch();
    const page = await browser.newPage();

    const diag = setupPlaywrightDiagnostics(page);

    try {
      await installInitProbe(page);
      const fixtureUrl = `${server.baseUrl}/fixture.html`;
      await page.goto(fixtureUrl, {
        waitUntil: "load",
        timeout: PW_TIMEOUT_MS,
      });
      await waitForBootstrapOrFail(page, diag);

      const r = await page.evaluate(() =>
        (window as Any).__nh.testApi.probeStyleExtraction()
      );
      if (!r.supported) return;

      assertEquals(r.cardCount, 2);
      assertEquals(r.hasWrap, true);
      assertEquals(r.hasX, true);

      // In head strategy, styles should be extracted (no remaining [style] attrs).
      assertEquals(r.remainingStyleAttrCount, 0);
      assert(r.styleTagCount >= 1);
      assertMatch(String(r.cssText), /#wrap/);
      assertMatch(String(r.cssText), /\.card/);
      assertMatch(String(r.cssText), /#x/);
    } finally {
      await page.close();
      await browser.close();
      server.close();
    }
  },
);
