/**
 * @module natural-web-ua/elements.js
 *
 * Natural HTML (DOM edition) is a tiny, functional HTML authoring library for browser JavaScript.
 * It is “natural” in the sense that developers fluent with functions can write HTML, page chrome,
 * and design-system primitives as composable functions without JSX, template strings, or frameworks.
 *
 * This module produces real DOM Nodes (Elements/Text/Comments/Fragments).
 * Tag functions return Elements. render(...) returns a DocumentFragment.
 *
 * Design goals
 * - Safe-by-default children model (strings/numbers become Text nodes, null/undefined/false/true skipped).
 * - Deterministic output where it matters (attribute key ordering, stable class/style helpers).
 * - No hidden parsing: you must opt into HTML parsing via raw()/trustedRaw().
 * - Helpful escape hatches for design systems (UA dependencies, style extraction).
 *
 * Major features
 * 1) Typed-ish tag API (via named exports)
 * - Full HTML tag set: div(...), head(...), a(...), etc.
 * - customElement("my-tag") helper.
 * - Void element handling: void tags never accept children (error if children are provided).
 *
 * 2) Safe children model
 * - Plain strings and numbers become Text nodes.
 * - null/undefined/false/true are skipped (use boolean attributes for semantics).
 * - Arrays are flattened.
 * - Builder callbacks (ChildBuilder) can emit children during flattening.
 *
 * 3) Raw and trusted content (two distinct use cases)
 *
 * Markup insertion (parsed as HTML):
 * - trustedRaw(html): parses trusted markup into real DOM nodes (template fragment mode).
 * - raw(html): same behavior but can be blocked in dev/test with setRawPolicy({ mode: "dev-strict" }).
 *
 * Literal text blocks (NOT parsed as HTML):
 * - text(value): wraps literal text as a Text node.
 * - trustedRawFriendly`...` (alias: javaScript): dedents a multiline template literal and returns
 *   literal text nodes (not parsed). Intended for inline <script> and <style> bodies and code blocks.
 * - scriptJs(code) and styleCss(cssText) always embed content as textContent (never parse).
 *
 * 4) Composition helpers
 * - attrs(...) to merge attribute objects (later wins).
 * - classNames(...) / cls(...) to build class strings.
 * - styleText(...) / css(...) to build deterministic inline style strings.
 * - each(iterable, fn) to build children from iterables with index support.
 * - children(builder) to author complex child trees with an emitter callback.
 *
 * 5) Style attribute extraction (optional)
 * - collectStyleAttributeCss(nodeOrRawDom, strategy, extraCssText) can remove inline style=""
 *   attributes and return equivalent CSS rules, using a deterministic selector strategy.
 * - emitStyleAttributeCss(...) can either:
 *   - keep styles inline (strategy "inline"),
 *   - emit a <style> before the content (strategy "head"),
 *   - or just return cssText without injecting (strategy "ua-dep").
 *
 * 6) UA Dependencies (design system “user agent dependencies”)
 * A small convention for describing browser resources as data (CSS/JS refs or content).
 * - uaDepCssRef(...), uaDepJsRef(...), uaDepCssContent(...), uaDepJsContent(...).
 * - normalizeUaRoute(dep) computes a normalized classification used for emission.
 * - browserUserAgentHeadTags(deps) emits <link> / <script> / inline <style>/<script> nodes.
 *
 * Notes
 * - This module targets modern browsers (ES2020+).
 * - render(...parts) treats string parts as trusted HTML snippets (parsed) for parity with server usage.
 *
 * Usage sketch
 *
 *   import * as h from "./elements-dom.js";
 *
 *   const deps = [
 *     h.uaDepCssRef("/_natural/app.css", "https://cdn.example/app.css"),
 *     h.uaDepJsRef("/_natural/app.js", "https://cdn.example/app.js", { as: "module" }),
 *     h.uaDepCssContent("/_natural/inline.css", "body{margin:0}", { as: "style" }),
 *   ];
 *
 *   const root = h.div(
 *     { class: "container" },
 *     h.h1("Hello"),
 *     h.browserUserAgentHeadTags(deps),
 *     h.scriptJs(h.javaScript`
 *
 *       console.log("inline script as literal text");
 *
 *     `),
 *   );
 *
 *   document.body.appendChild(root);
 *
 * Style extraction example
 *
 *   const card = h.div({ class: "card", style: "padding:12px" }, "Hello");
 *   const { node, cssText } = h.collectStyleAttributeCss(card, "head");
 *   const out = h.emitStyleAttributeCss(node, "head", cssText);
 *   document.body.appendChild(h.render(out));
 */

/**
 * @typedef {string|number|boolean|null|undefined} AttrValue
 */

/**
 * @typedef {Record<string, AttrValue>} Attrs
 */

/**
 * Optional dev-time raw policy (defaults to permissive).
 * @typedef {{ mode?: "permissive" | "dev-strict" }} RawPolicy
 */

let rawPolicy = { mode: "permissive" };

/**
 * @param {RawPolicy} policy
 * @returns {void}
 */
export function setRawPolicy(policy) {
  rawPolicy = { ...rawPolicy, ...policy };
}

/**
 * A wrapper for pre-built DOM nodes (safe to append).
 * @typedef {{ readonly __nodes: readonly Node[] }} RawDom
 */

/**
 * Builder support (usable anywhere a child can appear).
 * @typedef {(...children: Child[]) => void} ChildAdder
 * @typedef {(e: ChildAdder) => void} ChildBuilder
 */

/**
 * A "Child" is recursive and can include builder functions.
 * @typedef {string|number|boolean|null|undefined|Node|RawDom|Child[]|ChildBuilder} Child
 */

/**
 * Explicit wrapper for readability in call sites.
 * @param {ChildBuilder} builder
 * @returns {ChildBuilder}
 */
export function children(builder) {
  return builder;
}

/**
 * @template T
 * @param {Iterable<T>} items
 * @param {(item: T, index: number) => Child} fn
 * @returns {ChildBuilder}
 */
export function each(items, fn) {
  return (e) => {
    let i = 0;
    for (const it of items) e(fn(it, i++));
  };
}

const isPlainObject = (value) => {
  if (value == null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/**
 * @param {unknown} v
 * @returns {v is Attrs}
 */
const isAttrs = (v) => {
  if (!isPlainObject(v)) return false;
  if ("__nodes" in /** @type {Record<string, unknown>} */ (v)) return false;
  if ("nodeType" in /** @type {Record<string, unknown>} */ (v)) return false;
  return true;
};

/**
 * Deterministic attrs merge helper (later wins).
 * @param {...(Attrs|null|undefined|false)} parts
 * @returns {Attrs}
 */
export function attrs(...parts) {
  /** @type {Attrs} */
  const out = {};
  for (const p of parts) {
    if (!p) continue;
    for (const [k, v] of Object.entries(p)) out[k] = v;
  }
  return out;
}

/**
 * @typedef {string|null|undefined|false|ClassSpec[]|Record<string, boolean>} ClassSpec
 */

/**
 * @param {...ClassSpec} parts
 * @returns {string}
 */
export function classNames(...parts) {
  /** @type {string[]} */
  const out = [];
  /** @param {ClassSpec} p */
  const visit = (p) => {
    if (!p) return;
    if (Array.isArray(p)) {
      for (const x of p) visit(x);
      return;
    }
    if (typeof p === "object") {
      for (const [k, v] of Object.entries(p)) if (v) out.push(k);
      return;
    }
    const s = String(p).trim();
    if (s) out.push(s);
  };
  for (const p of parts) visit(p);
  return out.join(" ");
}

export const cls = classNames;

/**
 * Deterministic inline style helper.
 * @param {Record<string, string|number|null|undefined|false>} style
 * @returns {string}
 */
export function styleText(style) {
  const toKebab = (s) => s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
  const keys = Object.keys(style).sort();
  let s = "";
  for (const k of keys) {
    const v = style[k];
    if (v == null || v === false) continue;
    s += `${toKebab(k)}:${String(v)};`;
  }
  return s;
}

export const css = styleText;

/* --------------------------------------------------------------------------
 * Raw / trusted content
 * ----------------------------------------------------------------------- */

/**
 * Literal text node wrapper (no parsing).
 * Useful when you want to force “string means text”, not “string means HTML snippet”.
 * @param {string} value
 * @returns {RawDom}
 */
export function text(value) {
  return { __nodes: [document.createTextNode(String(value))] };
}

/**
 * Parse HTML into DOM nodes (template-based).
 * @param {string} html
 * @returns {RawDom}
 */
export function trustedRaw(html) {
  const t = document.createElement("template");
  t.innerHTML = html;
  return { __nodes: Array.from(t.content.childNodes) };
}

/**
 * Escape hatch that can be blocked in dev/test by policy.
 * Use for trusted HTML snippets.
 * @param {string} html
 * @param {string=} hint
 * @returns {RawDom}
 */
export function raw(html, hint) {
  if (rawPolicy.mode === "dev-strict") {
    const msg = hint
      ? `raw() is blocked by dev-strict policy: ${hint}`
      : "raw() is blocked by dev-strict policy";
    throw new Error(msg);
  }
  return trustedRaw(html);
}

/**
 * Template tag for embedding multiline text blocks as literal Text nodes (NOT parsed as HTML).
 *
 * The template literal must start with a blank first line. That line is discarded.
 * The remaining lines are dedented by the minimum common leading indentation.
 *
 * Intended for inline <script> / <style> bodies and code blocks.
 *
 * @param {TemplateStringsArray} strings
 * @param {...unknown} exprs
 * @returns {RawDom}
 */
export function trustedRawFriendly(strings, ...exprs) {
  let full = strings[0] ?? "";
  for (let i = 0; i < exprs.length; i++) {
    full += String(exprs[i]) + (strings[i + 1] ?? "");
  }
  full = full.replaceAll("\r\n", "\n");

  const lines = full.split("\n");
  if (lines.length === 0 || lines[0].trim() !== "") {
    throw new Error("javaScript() template must start with a blank first line");
  }

  lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();

  let minIndent = Infinity;
  for (const line of lines) {
    if (!line.trim()) continue;
    const m = line.match(/^(\s*)/);
    if (m) minIndent = Math.min(minIndent, m[1].length);
  }
  if (!Number.isFinite(minIndent)) minIndent = 0;

  const dedented = lines
    .map((l) => (minIndent > 0 ? l.slice(minIndent) : l))
    .join("\n");

  return text(dedented);
}

export const javaScript = trustedRawFriendly;

/* --------------------------------------------------------------------------
 * Child flattening
 * ----------------------------------------------------------------------- */

/**
 * @param {readonly Child[]} children
 * @returns {Node[]}
 */
export function flattenChildren(children) {
  /** @type {Node[]} */
  const out = [];

  /** @param {Child} c */
  const visit = (c) => {
    if (c == null || c === false) return;

    // Builder callback
    if (typeof c === "function") {
      /** @type {ChildAdder} */
      const emit = (...xs) => {
        for (const x of xs) visit(x);
      };
      /** @type {ChildBuilder} */ (c)(emit);
      return;
    }

    // Nested arrays
    if (Array.isArray(c)) {
      for (const x of c) visit(x);
      return;
    }

    // RawDom passthrough
    if (typeof c === "object" && c && "__nodes" in c) {
      for (const n of /** @type {RawDom} */ (c).__nodes) out.push(n);
      return;
    }

    // Node passthrough
    if (typeof c === "object" && c && "nodeType" in c) {
      out.push(/** @type {Node} */ (c));
      return;
    }

    // Skip boolean true as a child
    if (c === true) return;

    // string/number -> Text
    out.push(document.createTextNode(String(c)));
  };

  for (const c of children) visit(c);
  return out;
}

/* --------------------------------------------------------------------------
 * Elements / tags
 * ----------------------------------------------------------------------- */

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const isVoidElement = (t) => VOID_ELEMENTS.has(String(t).toLowerCase());

/**
 * @param {Element} el
 * @param {Attrs|undefined} a
 * @returns {void}
 */
function applyAttrs(el, a) {
  if (!a) return;
  const keys = Object.keys(a).sort();
  for (const k of keys) {
    const v = a[k];
    if (v == null || v === false) continue;
    if (v === true) {
      el.setAttribute(k, "");
      continue;
    }
    el.setAttribute(k, String(v));
  }
}

/**
 * @typedef {(attrsOrChild?: Attrs|Child, ...children: Child[]) => Element} TagFn
 */

/**
 * Internal primitive.
 * @param {string} tagName
 * @param {...unknown} args
 * @returns {Element}
 */
function el(tagName, ...args) {
  /** @type {Attrs|undefined} */
  let at;
  /** @type {Child[]} */
  let kids;

  if (args.length > 0 && isAttrs(args[0])) {
    at = /** @type {Attrs} */ (args[0]);
    kids = /** @type {Child[]} */ (args.slice(1));
  } else {
    kids = /** @type {Child[]} */ (args);
  }

  const node = document.createElement(tagName);
  applyAttrs(node, at);

  const flat = flattenChildren(kids);

  if (isVoidElement(tagName)) {
    // Void elements never accept children. Enforce this to prevent subtle DOM weirdness.
    if (flat.length > 0) {
      throw new Error(`Void element <${tagName}> cannot have children.`);
    }
    return node;
  }

  for (const c of flat) node.appendChild(c);
  return node;
}

/**
 * @param {string} name
 * @returns {TagFn}
 */
function tag(name) {
  return (...args) => el(name, .../** @type {unknown[]} */ (args));
}

/* --------------------------------------------------------------------------
 * Render helpers
 * ----------------------------------------------------------------------- */

/**
 * Create a DocumentFragment of all parts.
 * For string parts, treat them as trusted HTML snippets and parse them (parity with server render()).
 *
 * @param {...(Node|Element|RawDom|string|null|undefined|false)} parts
 * @returns {DocumentFragment}
 */
export function render(...parts) {
  const frag = document.createDocumentFragment();
  for (const p of parts) {
    if (!p) continue;

    if (typeof p === "string") {
      const rd = trustedRaw(p);
      for (const n of rd.__nodes) frag.appendChild(n.cloneNode(true));
      continue;
    }

    if (typeof p === "object" && "__nodes" in p) {
      for (const n of /** @type {RawDom} */ (p).__nodes) frag.appendChild(n);
      continue;
    }

    frag.appendChild(/** @type {Node} */ (p));
  }
  return frag;
}

// No-op alias for API parity with server-side version.
export const renderPretty = render;

/**
 * @returns {DocumentType}
 */
export function doctype() {
  return document.implementation.createDocumentType("html", "", "");
}

/**
 * @param {string} s
 * @returns {Comment}
 */
export function comment(s) {
  return document.createComment(s);
}

/**
 * Safer script helper: puts code into textContent (never parses as HTML).
 * @param {string} code
 * @param {Attrs=} a
 * @returns {HTMLScriptElement}
 */
export function scriptJs(code, a) {
  const s = /** @type {HTMLScriptElement} */ (script(a ?? {}));
  s.textContent = String(code);
  return s;
}

/**
 * Safer style helper: puts css text into textContent (never parses as HTML).
 * @param {string} cssText
 * @param {Attrs=} a
 * @returns {HTMLStyleElement}
 */
export function styleCss(cssText, a) {
  const s = /** @type {HTMLStyleElement} */ (style(a ?? {}));
  s.textContent = String(cssText);
  return s;
}

/**
 * Type-safe custom element tag helper.
 * @param {`${string}-${string}`} name
 * @returns {TagFn}
 */
export function customElement(name) {
  return tag(name);
}

/**
 * --------------------------------------------------------------------------
 * Style attribute extraction (DOM version)
 * --------------------------------------------------------------------------
 */

/**
 * @typedef {"inline"|"head"|"ua-dep"} StyleAttributeEmitStrategy
 */

/**
 * @typedef {{ readonly html: RawDom, readonly cssText: string }} StyleAttributeCssExtraction
 */

function getElementIdFromDom(el) {
  const id = el.getAttribute("id") || el.getAttribute("ID");
  return id ? String(id) : undefined;
}

function getClassTokensFromDom(el) {
  const cls = el.getAttribute("class") || el.getAttribute("className");
  if (!cls) return [];
  return String(cls).split(/\s+/).filter((t) => t.trim() !== "");
}

function nodeSelectorForDom(el) {
  const tag = el.tagName.toLowerCase();
  const classTokens = getClassTokensFromDom(el);
  return classTokens.length > 0 ? `${tag}.${classTokens.join(".")}` : tag;
}

/**
 * @param {RawDom|Node} nodeOrRaw
 * @returns {RawDom}
 */
function toRawDom(nodeOrRaw) {
  if (nodeOrRaw && typeof nodeOrRaw === "object" && "__nodes" in nodeOrRaw) {
    return /** @type {RawDom} */ (nodeOrRaw);
  }
  return { __nodes: [/** @type {Node} */ (nodeOrRaw)] };
}

/**
 * Extracts inline style="" attributes into CSS rules and removes the style=""
 * attributes from the returned DOM nodes.
 *
 * Strategy:
 * - "inline" or undefined: do nothing (cssText empty).
 * - "head" or "ua-dep": remove style="" attrs and emit CSS in cssText.
 *
 * @param {RawDom|Node} nodeOrRaw
 * @param {StyleAttributeEmitStrategy=} strategy
 * @param {string[]=} baseSelectorPath
 * @param {string=} extraCssText
 * @returns {StyleAttributeCssExtraction}
 */
export function collectStyleAttributeCss(
  nodeOrRaw,
  strategy,
  baseSelectorPath = [],
  extraCssText = "",
) {
  if ((strategy !== "head" && strategy !== "ua-dep") || !nodeOrRaw) {
    return { html: toRawDom(nodeOrRaw), cssText: "" };
  }

  // Work on clones to avoid mutating caller-owned nodes.
  const rawIn = toRawDom(nodeOrRaw);
  const clonedNodes = rawIn.__nodes.map((n) => n.cloneNode(true));
  const raw = { __nodes: clonedNodes };

  /** @type {string[]} */
  const rules = [];
  const seen = new Set();

  /**
   * @param {Node} n
   * @param {string[]} path
   */
  const visit = (n, path) => {
    if (n.nodeType === Node.ELEMENT_NODE) {
      const el = /** @type {Element} */ (n);

      const styleAttr = el.getAttribute("style");
      if (styleAttr && styleAttr.trim() !== "") {
        el.removeAttribute("style");

        const id = getElementIdFromDom(el);
        const nodeSel = nodeSelectorForDom(el);
        const cascadeSel = [...path, nodeSel].filter(Boolean).join(" ");

        /** @type {string[]} */
        const selectors = [];
        if (cascadeSel) selectors.push(cascadeSel);
        if (id) selectors.push(`#${id}`);

        const selectorKey = selectors.join(", ");
        const body = styleAttr.trim().endsWith(";")
          ? styleAttr.trim()
          : `${styleAttr.trim()};`;

        const rule = `${selectorKey} { ${body} }`;
        if (!seen.has(rule)) {
          seen.add(rule);
          rules.push(rule);
        }
      }

      const nextPath = [...path, nodeSelectorForDom(el)];
      for (const c of Array.from(el.childNodes)) visit(c, nextPath);
      return;
    }

    // For non-elements, still traverse children if present (rare, but safe).
    // DocumentFragment etc.
    if (n.childNodes && n.childNodes.length) {
      for (const c of Array.from(n.childNodes)) visit(c, path);
    }
  };

  for (const n of raw.__nodes) visit(n, baseSelectorPath);

  const cssTextParts = [String(extraCssText ?? "").trim(), rules.join("\n")]
    .filter((x) => x !== "");
  return {
    html: raw,
    cssText: cssTextParts.length ? cssTextParts.join("\n") : "",
  };
}

/**
 * Emits extracted CSS based on strategy:
 * - "inline": no change
 * - "ua-dep": only strips style attrs (returns html, cssText ignored)
 * - "head": returns RawDom with a <style> node prepended
 *
 * @param {RawDom|Node} nodeOrRaw
 * @param {StyleAttributeEmitStrategy=} strategy
 * @param {string=} extraCssText
 * @returns {RawDom|Node}
 */
export function emitStyleAttributeCss(nodeOrRaw, strategy, extraCssText = "") {
  const { html, cssText } = collectStyleAttributeCss(
    nodeOrRaw,
    strategy,
    [],
    extraCssText,
  );
  if (!cssText || strategy === "ua-dep") return html;

  const styleEl = document.createElement("style");
  styleEl.textContent = cssText;

  return { __nodes: [styleEl, ...html.__nodes] };
}

/* --------------------------------------------------------------------------
 * UA Dependencies
 * ----------------------------------------------------------------------- */

/**
 * @typedef {"text/css"|"text/javascript"|"application/javascript"|"application/json"|"image/svg+xml"|"font/woff2"|"text/plain"|string} UaDepMimeType
 */

/**
 * @typedef {{
 *   readonly mountPoint: string;
 *   readonly mimeType: UaDepMimeType;
 *   readonly method?: "GET"|"HEAD";
 *   readonly headers?: Readonly<Record<string, string>>;
 *   readonly cache?: { readonly maxAgeSeconds?: number; readonly immutable?: boolean; readonly etag?: "weak"|"strong"|false; };
 *   readonly cors?: { readonly allowOrigin?: string; readonly allowHeaders?: string; readonly allowMethods?: string; };
 * }} UaDependencyBase
 */

/**
 * @typedef {UaDependencyBase & {
 *   readonly nature: "reference";
 *   readonly canonicalSource: string;
 *   readonly as?: "style"|"script"|"module"|"preload"|"other";
 *   readonly integrity?: string;
 *   readonly crossOrigin?: "anonymous"|"use-credentials";
 * }} UaDependencyReference
 */

/**
 * @typedef {UaDependencyBase & {
 *   readonly nature: "content";
 *   readonly canonicalSource: string; // inline payload
 *   readonly emit?: "inline"|"link";
 *   readonly as?: "style"|"script"|"module"|"other";
 * }} UaDependencyContent
 */

/**
 * @typedef {UaDependencyReference|UaDependencyContent} UaDependency
 */

/**
 * @typedef {Partial<Pick<UaDependencyBase, "method"|"headers"|"cache"|"cors">>} UaDepCommonOverrides
 */

/**
 * @typedef {UaDepCommonOverrides & Partial<Pick<UaDependencyReference, "as"|"integrity"|"crossOrigin">>} UaDepRefOverrides
 */

/**
 * @typedef {UaDepCommonOverrides & Partial<Pick<UaDependencyContent, "as"|"emit">>} UaDepContentOverrides
 */

/**
 * @typedef {{ readonly mimeType?: "text/javascript"|"application/javascript" }} UaDepJsMimeOverride
 */

/**
 * @param {string} mountPoint
 * @param {string} canonicalSource
 * @param {UaDepRefOverrides=} overrides
 * @returns {UaDependencyReference}
 */
export function uaDepCssRef(mountPoint, canonicalSource, overrides = {}) {
  return {
    mountPoint,
    canonicalSource,
    nature: "reference",
    mimeType: "text/css",
    ...overrides,
  };
}

/**
 * @param {string} mountPoint
 * @param {string} canonicalSource
 * @param {(UaDepRefOverrides & UaDepJsMimeOverride)=} overrides
 * @returns {UaDependencyReference}
 */
export function uaDepJsRef(mountPoint, canonicalSource, overrides = {}) {
  const { mimeType, ...rest } = overrides || {};
  return {
    mountPoint,
    canonicalSource,
    nature: "reference",
    mimeType: mimeType ?? "application/javascript",
    ...rest,
  };
}

/**
 * @param {string} mountPoint
 * @param {string} content
 * @param {UaDepContentOverrides=} overrides
 * @returns {UaDependencyContent}
 */
export function uaDepCssContent(mountPoint, content, overrides = {}) {
  return {
    mountPoint,
    canonicalSource: content,
    nature: "content",
    mimeType: "text/css",
    ...overrides,
  };
}

/**
 * @param {string} mountPoint
 * @param {string} content
 * @param {(UaDepContentOverrides & UaDepJsMimeOverride)=} overrides
 * @returns {UaDependencyContent}
 */
export function uaDepJsContent(mountPoint, content, overrides = {}) {
  const { mimeType, ...rest } = overrides || {};
  return {
    mountPoint,
    canonicalSource: content,
    nature: "content",
    mimeType: mimeType ?? "application/javascript",
    ...rest,
  };
}

/**
 * @typedef {UaDependency & { readonly normalizedAs: "style"|"script"|"module"|"preload"|"other" }} UaRoute
 */

/**
 * @param {UaDependency} dep
 * @returns {UaRoute}
 */
export function normalizeUaRoute(dep) {
  const as = dep.as ??
    (String(dep.mimeType).includes("css")
      ? "style"
      : String(dep.mimeType).includes("javascript")
      ? "module"
      : "other");

  return { ...dep, normalizedAs: as };
}

/**
 * Emits DOM nodes suitable for placement in <head>.
 * Returns a ChildBuilder so you can use it as a child of head(...) or any container.
 *
 * Rules:
 * - content deps:
 *   - if emit==="link": emit link/script pointing at mountPoint
 *   - else inline <style>/<script> with textContent
 * - reference deps:
 *   - style: <link rel="stylesheet" href=mountPoint ...>
 *   - script: <script src=mountPoint ...></script>
 *   - module: <script type="module" src=mountPoint ...></script>
 *   - preload: <link rel="preload" href=mountPoint as="script" ...>
 *   - other: emits a comment node
 *
 * @param {Iterable<UaDependency>} deps
 * @returns {ChildBuilder}
 */
export function browserUserAgentHeadTags(deps) {
  const routes = Array.from(deps).map(normalizeUaRoute);

  return children((e) => {
    for (const r of routes) {
      if (r.nature === "content") {
        if (r.emit === "link") {
          if (r.normalizedAs === "style") {
            e(link(attrs({ rel: "stylesheet", href: r.mountPoint })));
            continue;
          }
          if (r.normalizedAs === "script") {
            e(script(attrs({ src: r.mountPoint })));
            continue;
          }
          if (r.normalizedAs === "module") {
            e(script(attrs({ src: r.mountPoint, type: "module" })));
            continue;
          }
        }

        if (r.normalizedAs === "style") {
          e(styleCss(r.canonicalSource));
          continue;
        }

        if (r.normalizedAs === "script") {
          e(scriptJs(r.canonicalSource));
          continue;
        }

        if (r.normalizedAs === "module") {
          e(scriptJs(r.canonicalSource, { type: "module" }));
          continue;
        }

        e(comment(`ua dep: ${r.mountPoint}`));
        continue;
      }

      if (r.normalizedAs === "style") {
        e(
          link(
            attrs(
              { rel: "stylesheet", href: r.mountPoint },
              r.integrity ? { integrity: r.integrity } : null,
              r.crossOrigin ? { crossOrigin: r.crossOrigin } : null,
            ),
          ),
        );
        continue;
      }

      if (r.normalizedAs === "script") {
        e(
          script(
            attrs(
              { src: r.mountPoint },
              r.integrity ? { integrity: r.integrity } : null,
              r.crossOrigin ? { crossOrigin: r.crossOrigin } : null,
            ),
          ),
        );
        continue;
      }

      if (r.normalizedAs === "module") {
        e(
          script(
            attrs(
              { src: r.mountPoint, type: "module" },
              r.integrity ? { integrity: r.integrity } : null,
              r.crossOrigin ? { crossOrigin: r.crossOrigin } : null,
            ),
          ),
        );
        continue;
      }

      if (r.normalizedAs === "preload") {
        e(
          link(
            attrs(
              { rel: "preload", href: r.mountPoint, as: "script" },
              r.crossOrigin ? { crossOrigin: r.crossOrigin } : null,
            ),
          ),
        );
        continue;
      }

      e(comment(`ua dep: ${r.mountPoint}`));
    }
  });
}

/* --------------------------------------------------------------------------
 * Full HTML tag set as named exports
 * ----------------------------------------------------------------------- */

export const a = tag("a");
export const abbr = tag("abbr");
export const address = tag("address");
export const area = tag("area");
export const article = tag("article");
export const aside = tag("aside");
export const audio = tag("audio");
export const b = tag("b");
export const base = tag("base");
export const bdi = tag("bdi");
export const bdo = tag("bdo");
export const blockquote = tag("blockquote");
export const body = tag("body");
export const br = tag("br");
export const button = tag("button");
export const canvas = tag("canvas");
export const caption = tag("caption");
export const cite = tag("cite");
export const codeTag = tag("code");
export const col = tag("col");
export const colgroup = tag("colgroup");
export const data = tag("data");
export const datalist = tag("datalist");
export const dd = tag("dd");
export const del = tag("del");
export const details = tag("details");
export const dfn = tag("dfn");
export const dialog = tag("dialog");
export const div = tag("div");
export const dl = tag("dl");
export const dt = tag("dt");
export const em = tag("em");
export const embed = tag("embed");
export const fieldset = tag("fieldset");
export const figcaption = tag("figcaption");
export const figure = tag("figure");
export const footer = tag("footer");
export const form = tag("form");
export const h1 = tag("h1");
export const h2 = tag("h2");
export const h3 = tag("h3");
export const h4 = tag("h4");
export const h5 = tag("h5");
export const h6 = tag("h6");
export const head = tag("head");
export const header = tag("header");
export const hgroup = tag("hgroup");
export const hr = tag("hr");
export const html = tag("html");
export const i = tag("i");
export const iframe = tag("iframe");
export const img = tag("img");
export const input = tag("input");
export const ins = tag("ins");
export const kbd = tag("kbd");
export const label = tag("label");
export const legend = tag("legend");
export const li = tag("li");
export const link = tag("link");
export const main = tag("main");
export const map = tag("map");
export const mark = tag("mark");
export const menu = tag("menu");
export const meta = tag("meta");
export const meter = tag("meter");
export const nav = tag("nav");
export const noscript = tag("noscript");
export const object = tag("object");
export const ol = tag("ol");
export const optgroup = tag("optgroup");
export const option = tag("option");
export const output = tag("output");
export const p = tag("p");
export const param = tag("param");
export const picture = tag("picture");
export const pre = tag("pre");
export const progress = tag("progress");
export const qTag = tag("q");
export const rp = tag("rp");
export const rt = tag("rt");
export const ruby = tag("ruby");
export const s = tag("s");
export const samp = tag("samp");
export const script = tag("script");
export const search = tag("search");
export const section = tag("section");
export const select = tag("select");
export const slot = tag("slot");
export const small = tag("small");
export const source = tag("source");
export const span = tag("span");
export const strong = tag("strong");
export const style = tag("style");
export const sub = tag("sub");
export const summary = tag("summary");
export const sup = tag("sup");
export const table = tag("table");
export const tbody = tag("tbody");
export const td = tag("td");
export const template = tag("template");
export const textarea = tag("textarea");
export const tfoot = tag("tfoot");
export const th = tag("th");
export const thead = tag("thead");
export const time = tag("time");
export const title = tag("title");
export const tr = tag("tr");
export const track = tag("track");
export const u = tag("u");
export const ul = tag("ul");
export const varTag = tag("var");
export const video = tag("video");
export const wbr = tag("wbr");
