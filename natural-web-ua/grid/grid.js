/**
 * @module lib/tabular-ux/grid.js
 *
 * Client-side implementation of the `<natural-grid>` custom element.
 *
 * This module provides an extensible, plugin-driven data grid that renders a table inside an open
 * ShadowRoot and supports multiple configuration sources, multiple data delivery strategies, and a
 * deterministic styling pipeline. The intent is to make the runtime easy to extend by human authors
 * and AI maintainers alike: new data sources, UI behaviors, or themes can be introduced as plugins
 * without forking the core.
 *
 * Key concepts
 *
 * 1) Configuration resolution (NaturalGridSpec)
 * The grid resolves its configuration in a prioritized sequence:
 * - Inline JSON: a `<script type="application/json" data-natural-grid-config>` (or any JSON script)
 *   inside the element is parsed and used as the config.
 * - External JSON: a `<script type="application/json">` elsewhere, referenced by `data-config-id`.
 * - External table upgrade using {@link naturalGridUpgrade}: an external `<table>` elsewhere in the
 *   document is upgraded into a minimal config when referenced by id (for example, via `data-table-id`).
 *   This enables progressive enhancement of legacy pages where the grid wrapper is separate from the
 *   table.
 * - Legacy table upgrade: an inline `<table>` inside the element is upgraded into a minimal config
 *   via {@link gridSpecFromTable}.
 * - Factory function: `data-factory="globalFnName"` calls `globalThis[globalFnName](this)` to obtain
 *   a config object.
 *
 * Authors can force a resolution mode via `data-init="json|table|factory"` (and optionally `external-table`
 * if implemented). When omitted, the grid tries all sources in the order above.
 *
 * Notes on external table upgrade
 * - The external-table strategy should locate `document.getElementById(data-table-id)` and, if it is an
 *   `HTMLTableElement`, call {@link gridSpecFromTable} to generate a {@link NaturalGridSpec}.
 * - The resulting `spec.id` can come from the grid element `id` (preferred) or fall back to a generated id,
 *   while the title can come from `data-title` or be omitted.
 *
 * 2) Data providers (NaturalGridDataProvider)
 * Data loading is abstracted behind “data provider” factories keyed by `config.data.kind`.
 * Built-in providers:
 * - `static`: loads a snapshot embedded in the config.
 * - `fetch`: performs an HTTP fetch (supports method, headers, JSON body), optionally polls, and
 *   expects either `{snapshot: ...}` or a snapshot-like payload.
 * - `sse`: connects to an EventSource and applies incremental updates using `applySseMessage`.
 *
 * Plugins can register new data providers via {@link NaturalGridPluginApi.registerDataProvider}.
 *
 * 3) Plugin pipeline (presentation, content-supplier, grid-functionality)
 * The grid loads and executes plugins (both built-in and external) in a stable order:
 * - Presentation plugins first (theme and styling hooks).
 * - Content-supplier plugins next (data providers, adapters).
 * - Grid-functionality plugins last (toolbar actions, renderers, behaviors).
 *
 * External plugins are loaded by dynamic `import(ref.moduleUrl)` and normalized to a consistent
 * shape. Modules may export a default factory function and optionally metadata (`id`, `nature`,
 * `priority`). Per-config plugin refs can also override metadata.
 *
 * Plugins interact with the grid exclusively through {@link NaturalGridPluginApi}, which provides:
 * - Lifecycle-free “imperative knobs” (set renderers, add toolbar items).
 * - A simple local event bus (`on`/`emit`) for intra-grid communication.
 * - A cascading stylesheet pipeline (`addStyles`) with deterministic ordering.
 * - Data provider registration and snapshot/model mutation helpers.
 *
 * 4) Styling pipeline and theming
 * Styling is applied in a predictable order:
 * - Base structural CSS (layout hooks + tokens) from {@link baseStyles}.
 * - Optional theme CSS reserved for future internal themes (currently empty by default).
 * - Plugin-injected CSS via `api.addStyles(...)` ordered by `(priority, id)`.
 * - Optional user CSS via {@link NaturalGrid#setThemeCss}.
 *
 * Where supported, the grid uses constructable stylesheets (ShadowRoot.adoptedStyleSheets) for
 * performance; otherwise it falls back to injected `<style>` tags. Default styles can be disabled
 * entirely via `data-unstyled`.
 *
 * A built-in presentation plugin injects the default “modern” theme CSS from
 * {@link modernThemeCss}.
 *
 * 5) Rendering model (NaturalGridModel)
 * The grid maintains a single mutable in-memory model:
 * - `columns`, `rows`, `sort`, `filters`
 * - `status`: `"init" | "loading" | "ready" | "error"`
 * - `error`: a human-readable message when status is `"error"`
 *
 * Renderers (per-column) can be installed by plugins or consumers:
 * - Cell renderers: {@link NaturalGridPluginApi.setCellRenderer}
 * - Header renderers: {@link NaturalGridPluginApi.setHeaderRenderer}
 *
 * Tree rendering is supported by flattening hierarchical `row.children` with
 * {@link flattenTreeRows} when `ui.tree.enabled` is true. Zebra striping is opt-in via
 * `ui.zebra`.
 *
 * 6) Virtualization
 * Since grids often need to render thousands of rows and columns, the core exposes a
 * lightweight virtualization system driven by `ui.virtualization`. The renderer keeps
 * the DOM shallow by rendering only the visible slice of flattened rows/columns, and
 * adjusts scrollable spacers so plugins can remain oblivious to virtualized rendering.
 *
 * Attributes and behavior
 *
 * Observed attributes trigger full re-initialization after the first successful init:
 * - `data-init`: force config resolution mode (`json`, `table`, or `factory`)
 * - `data-config-id`: id of an external JSON `<script>` containing NaturalGridSpec
 * - `data-factory`: global function name returning NaturalGridSpec
 * - `data-title`: optional title override used by table upgrade paths
 * - `data-theme`: reserved for future theme selection (theme currently controlled by plugins)
 * - `data-unstyled`: disable all default style injection
 * - `data-table-id`: id of an external `<table>` element to upgrade into a grid (external-table strategy)
 *
 * Events
 *
 * The grid exposes an internal, plugin-facing event bus (not DOM CustomEvents). Providers emit
 * `"data"` events through {@link NaturalGridPluginApi.emit} after producing new snapshots or
 * incremental messages. Consumers can subscribe via {@link NaturalGridPluginApi.on}.
 *
 * Security and rendering notes
 *
 * Cell values are normalized via {@link normalizeCell}. Plain primitives render as text. Objects
 * of the shape `{kind:"html", html:"..."}` render via `innerHTML` inside the shadow DOM. If you use
 * HTML payloads, ensure the content is trusted or sanitized upstream; this module intentionally
 * keeps the core lightweight and does not apply sanitization.
 *
 * Public API surface
 *
 * This module exports:
 * - {@link NaturalGrid}: the custom element class registered as `<natural-grid>`.
 *
 * Helpers and internal functions are module-scoped and are used to support configuration parsing,
 * styling, provider behavior, and rendering.
 *
 * Typical usage
 *
 * 1) Inline JSON config:
 * ```html
 * <natural-grid>
 *   <script type="application/json" data-natural-grid-config>
 *     {
 *       "id": "patients",
 *       "title": "Patients",
 *       "ui": { "zebra": true, "toolbar": { "enabled": true }, "tree": { "enabled": false } },
 *       "columns": [{ "key": "id", "title": "ID" }, { "key": "name", "title": "Name" }],
 *       "data": { "kind": "fetch", "url": "/api/patients" },
 *       "plugins": []
 *     }
 *   </script>
 * </natural-grid>
 * ```
 *
 * 2) External table upgrade:
 * ```html
 * <table id="legacyPatients">
 *   <thead><tr><th>ID</th><th>Name</th></tr></thead>
 *   <tbody><tr><td>1</td><td>Ada</td></tr></tbody>
 * </table>
 *
 * <natural-grid data-init="table" data-table-id="legacyPatients" data-title="Patients"></natural-grid>
 * ```
 *
 * 3) Legacy inline table upgrade:
 * ```html
 * <natural-grid data-init="table" data-title="Upgraded Table">
 *   <table>
 *     <thead><tr><th>ID</th><th>Name</th></tr></thead>
 *     <tbody><tr><td>1</td><td>Ada</td></tr></tbody>
 *   </table>
 * </natural-grid>
 * ```
 *
 * 4) External plugin:
 * Provide `plugins: [{ moduleUrl: "/plugins/my-plugin.js", nature: "grid-functionality" }]`
 * and export a default factory:
 * ```js
 * export default function myPlugin(api, options) {
 *   api.addToolbarItem(() => {
 *     const b = document.createElement("button");
 *     b.textContent = "Refresh";
 *     b.onclick = () => api.requestRender();
 *     return b;
 *   });
 * }
 * ```
 */
const DEFAULT_EVENT_NAME = "message";

/** @param {string} id @returns {HTMLElement|null} */
function byId(id) {
  return id ? document.getElementById(id) : null;
}

/**
 * Parse a JSON-bearing <script> element and return its data or null on failure.
 * @param {HTMLElement|null} scriptEl @returns {unknown|null}
 */
function parseJsonScript(scriptEl) {
  if (!scriptEl) return null;
  const text = scriptEl.textContent || "";
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("natural-grid: failed to parse config JSON", e);
    return null;
  }
}

/**
 * Turn a raw cell value into either a string or an HTML payload that can be rendered safely.
 * @param {unknown} v @returns {string|{__html:string}}
 */
function normalizeCell(v) {
  if (v == null) return "";
  if (
    typeof v === "string" || typeof v === "number" || typeof v === "boolean"
  ) {
    return String(v);
  }
  if (typeof v === "object" && v && /** @type {any} */ (v).kind === "text") {
    return String((/** @type {any} */ (v)).text ?? "");
  }
  if (typeof v === "object" && v && /** @type {any} */ (v).kind === "html") {
    return { __html: String((/** @type {any} */ (v)).html ?? "") };
  }
  return String(v);
}

/**
 * Recursively flatten a tree of rows and include their depth while respecting expanded state.
 * @param {Array<any>} rows
 * @param {number} [depth=0]
 * @param {Array<{row:any, depth:number}>} [out=[]]
 * @param {Set<string>} [expanded]
 * @returns {Array<{row:any, depth:number}>}
 */
function flattenTreeRows(rows, depth = 0, out = [], expanded) {
  for (const r of rows || []) {
    out.push({ row: r, depth });
    const hasKids = r && r.children && r.children.length;
    const isExpanded = !expanded || expanded.has(String(r.id));
    if (hasKids && isExpanded) {
      flattenTreeRows(r.children, depth + 1, out, expanded);
    }
  }
  return out;
}
// The renderer consumes the flattened array (depth + row) so tree UI logic can stay
// atomic while the core keeps rendering predictable and virtualizable.

/**
 * Convert an HTML <table> into a minimal NaturalGridSpec so legacy tables can be upgraded automatically.
 * Column headers become grid columns and each body row is assigned an id and cell map.
 * @param {HTMLTableElement} table
 * @param {{ id: string, title?: string }} hints
 * @returns {NaturalGridSpec}
 */
function gridSpecFromTable(table, hints) {
  const headRow = table.tHead?.rows?.[0] ?? null;
  const headCells = headRow ? Array.from(headRow.cells) : [];
  const columns = headCells.map((th, i) => ({
    key: `c${i + 1}`,
    title: (th.textContent || `Col ${i + 1}`).trim(),
  }));

  const bodyRows = table.tBodies?.[0]?.rows
    ? Array.from(table.tBodies[0].rows)
    : [];
  const rows = bodyRows.map((tr, idx) => {
    const rid = tr.getAttribute("data-row-id") || `${hints.id}__r${idx + 1}`;
    const tds = Array.from(tr.cells);
    /** @type {Record<string, unknown>} */
    const cells = {};
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const td = tds[i];
      cells[col.key] = (td?.textContent ?? "").trim();
    }
    return { id: rid, cells };
  });

  return {
    id: hints.id,
    title: hints.title ?? "",
    ui: { zebra: false, toolbar: { enabled: false }, tree: { enabled: false } },
    columns,
    data: { kind: "static", snapshot: { columns, rows } },
    plugins: [],
  };
}
// Helper used by legacy table upgrade flows and `naturalGridUpgrade` so old markup can
// bootstrap a Natural configuration without rewriting the page.

/**
 * Upgrade an existing legacy <table> (located anywhere in the document by id) into a Natural “table”
 * backed by the <natural-grid> runtime and its config model.
 *
 * This replaces the table in-place with a <natural-table> element (if registered) or falls back to
 * <natural-grid>. The generated config comes from {@link gridSpecFromTable}, so after upgrade the
 * rendered result is equivalent to having authored the markup directly as a Natural element.
 *
 * @param {string} id - The id of the <table> element to upgrade.
 * @param {{
 *   /** Optional id for the created Natural element (defaults to `${id}__natural`). *\/
 *   naturalId?: string,
 *   /** Optional title override for the generated spec. *\/
 *   title?: string,
 *   /** Optional theme attribute to apply (e.g. "modern"). *\/
 *   theme?: string,
 *   /** Disable default style injection (sets data-unstyled). *\/
 *   unstyled?: boolean,
 *   /** If true, keeps the original table in DOM but hides it, inserting the Natural element after it. *\/
 *   keepOriginal?: boolean,
 *   /** If true, copies class="" from the original table to the Natural element. *\/
 *   copyClass?: boolean,
 *   /** Optional hook to tweak the generated spec before it is embedded. *\/
 *   mutateSpec?: (spec: NaturalGridSpec) => NaturalGridSpec|void,
 *   /** Optional placement override when keepOriginal is true. *\/
 *   insert?: "before"|"after",
 * }} [options]
 * @returns {HTMLElement|null} The created Natural element, or null if the table was not found/invalid.
 */
export function naturalGridUpgrade(id, options = {}) {
  const el = id ? document.getElementById(id) : null;
  if (!(el instanceof HTMLTableElement)) return null;

  const opts = options || {};
  const naturalTag = customElements.get("natural-grid");
  const naturalId = String(opts.naturalId || `${id}__natural`);
  const title = (typeof opts.title === "string" && opts.title.trim())
    ? opts.title.trim()
    : undefined;

  // Build a spec from the legacy table.
  /** @type {NaturalGridSpec} */
  const spec = gridSpecFromTable(el, {
    id: naturalId,
    title,
  });

  // Allow callers to tweak the spec before it is embedded.
  if (typeof opts.mutateSpec === "function") {
    const out = opts.mutateSpec(spec);
    if (out && typeof out === "object") {
      // If mutateSpec returns a spec, prefer it.
      // (If it returns void, assume it mutated in place.)
      // @ts-ignore - JS runtime, user-provided callback
      Object.assign(spec, out);
    }
  }

  // Create the Natural element and embed config as inline JSON.
  const ng = document.createElement(naturalTag);
  ng.setAttribute("id", naturalId);
  ng.setAttribute("data-init", "json");

  if (opts.theme != null) ng.setAttribute("data-theme", String(opts.theme));
  if (opts.unstyled) ng.setAttribute("data-unstyled", "");
  if (opts.copyClass && el.className) ng.className = el.className;

  const script = document.createElement("script");
  script.type = "application/json";
  script.setAttribute("data-natural-grid-config", "");
  script.textContent = JSON.stringify(spec);
  ng.appendChild(script);

  // Replace or insert, depending on keepOriginal.
  const keepOriginal = !!opts.keepOriginal;
  const insertMode = (opts.insert === "before" || opts.insert === "after")
    ? opts.insert
    : "after";

  if (keepOriginal) {
    el.setAttribute("hidden", "");
    if (insertMode === "before") el.parentNode?.insertBefore(ng, el);
    else el.parentNode?.insertBefore(ng, el.nextSibling);
  } else {
    el.replaceWith(ng);
  }

  return ng;
}
// This helper is intentionally minimal so upgrades stay predictable and the generated
// config can be inspected before being embedded.

/**
 * Determine if the host ShadowRoot can consume constructable stylesheets for faster styling.
 * @param {ShadowRoot} root
 * @returns {boolean}
 */
function canAdoptSheets(root) {
  return !!(root && "adoptedStyleSheets" in root &&
    "replaceSync" in CSSStyleSheet.prototype);
}

/**
 * Create a constructable stylesheet from raw CSS text for adoption by shadow roots.
 * @param {string} cssText
 * @returns {CSSStyleSheet}
 */
function makeSheet(cssText) {
  const s = new CSSStyleSheet();
  s.replaceSync(String(cssText || ""));
  return s;
}

function schedulePaint(fn) {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(fn);
  } else {
    setTimeout(fn, 0);
  }
}

/**
 * Return the minimal base CSS that defines layout hooks, tokens, and structural classes.
 * Presentation plugins append additional styles on top of this pipeline.
 * @returns {string}
 */
// Layout and structure are intentionally basic here; themes like {@link modernThemeCss} layer on top.
function baseStyles() {
  return `
    :host {
      display: block;
      background: transparent;
      --ng-font-family: "Helvetica Neue", Arial, "Segoe UI", sans-serif;
      --ng-font-size: 14px;
      --ng-line-height: 1.5;
      --ng-bg: transparent;
      --ng-fg: #111;
      --ng-muted: rgba(0, 0, 0, 0.65);
      --ng-border: rgba(0, 0, 0, 0.15);
      --ng-header-bg: #f2f2f2;
      --ng-header-fg: #151515;
      --ng-row-hover-bg: #f5f5f5;
      --ng-zebra-bg: #fbfbfb;
      --ng-cell-px: 14px;
      --ng-cell-py: 10px;
    }

    .wrap {
      font-family: var(--ng-font-family);
      font-size: var(--ng-font-size);
      line-height: var(--ng-line-height);
      color: var(--ng-fg);
      background: transparent;
      border-radius: 0;
      border: none;
      box-shadow: none;
      padding: 0;
    }

    .toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
      font-size: 13px;
      color: var(--ng-muted);
      background-color: transparent;
      padding: 0;
    }

    .footer {
      margin-top: 12px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      font-size: 13px;
      color: var(--ng-muted);
    }

    .title {
      font-size: 20px;
      margin: 0 0 12px 0;
      font-weight: 600;
    }

    .error {
      color: #b00020;
      font-weight: 600;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      background: #ffffff;
      border-radius: 6px;
      overflow: hidden;
      border: 1px solid var(--ng-border);
    }

    thead th {
      text-align: left;
      font-weight: 600;
      padding: var(--ng-cell-py) var(--ng-cell-px);
      background: var(--ng-header-bg);
      color: var(--ng-header-fg);
      border-bottom: 1px solid rgba(0, 0, 0, 0.08);
      font-size: 14px;
      letter-spacing: 0.02em;
      position: relative;
    }

    tbody td {
      padding: 11px 14px;
      vertical-align: middle;
      border-bottom: 1px solid rgba(0, 0, 0, 0.05);
      background: #ffffff;
      font-size: 13px;
      color: var(--ng-fg);
    }

    tbody tr[data-zebra="1"]:nth-child(even) td {
      background: var(--ng-zebra-bg);
    }

    tbody tr:hover td {
      background: var(--ng-row-hover-bg);
    }

    tbody tr:last-child td {
      border-bottom: none;
    }

    .cell {
      display: flex;
      gap: 8px;
      align-items: flex-start;
    }

    .indent {
      flex: 0 0 auto;
      width: calc(var(--depth, 0) * 16px);
    }

    .expander {
      cursor: pointer;
      user-select: none;
      font-family: "Helvetica Neue", Arial, sans-serif;
      width: 22px;
      height: 22px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      background: transparent;
      transition: background 0.2s ease, color 0.2s ease;
      color: var(--ng-muted);
    }
    .expander:hover {
      background: rgba(15, 99, 255, 0.15);
      color: #0f62f7;
    }
    .expander.expanded {
      color: #0f62f7;
    }
    .expander-glyph {
      font-size: 16px;
      line-height: 1;
    }

    .viewport {
      width: 100%;
      overflow: auto;
      position: relative;
      background: transparent;
    }

    .viewport-track {
      position: absolute;
      top: 0;
      left: 0;
      pointer-events: none;
      opacity: 0;
      z-index: 0;
    }

    .viewport-table {
      position: relative;
      z-index: 1;
    }

    .virtualized-spacer td {
      background: transparent;
      height: 0;
      pointer-events: none;
    }
  `;
}

/**
 * Return CSS text for the default modern theme presentation plugin (tokens + structural part hooks).
 * @returns {string}
 */
// Built-in theme kept minimal so plugins and consumers can override per host or global tokenization.
function modernThemeCss() {
  return `
    :host(:not([data-theme])), :host([data-theme="modern"]) {
      --ng-font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial, "Noto Sans", "Liberation Sans", sans-serif;
      --ng-font-size: 14px;
      --ng-line-height: 1.55;

      --ng-bg: transparent;
      --ng-fg: #111827;
      --ng-muted: rgba(15, 23, 42, 0.6);
      --ng-border: rgba(0, 0, 0, 0.08);

      --ng-header-bg: #f4f6f8;
      --ng-header-fg: #0c1220;

      --ng-zebra-bg: #fafbfc;
      --ng-row-hover-bg: rgba(0, 0, 0, 0.04);

      --ng-cell-px: 14px;
      --ng-cell-py: 10px;

      --ng-radius: 8px;
      --ng-shadow: 0 6px 16px rgba(15, 23, 42, 0.12);
    }

    :host(:not([data-theme])) ::part(table),
    :host([data-theme="modern"]) ::part(table) {
      background: #ffffff;
      border: 1px solid rgba(0, 0, 0, 0.08);
      border-radius: 6px;
      box-shadow: none;
    }

    :host(:not([data-theme])) ::part(td),
    :host([data-theme="modern"]) ::part(td) {
      border-bottom: 1px solid rgba(0, 0, 0, 0.05);
    }
  `;
}

/**
 * @typedef {"grid-functionality"|"content-supplier"|"presentation"} PluginNature
 */

/**
 * @typedef {{
 *   key: string,
 *   title: string,
 *   widthPx?: number,
 *   align?: "left"|"right"|"center"
 * }} NaturalGridColumn
 */

/**
 * @typedef {{
 *   id: string,
 *   cells: Record<string, unknown>,
 *   children?: Array<any>
 * }} NaturalGridRow
 */

/**
 * @typedef {{
 *   enabled?: boolean
 * }} NaturalGridToolbarUi
 */

/**
 * @typedef {{
 *   enabled?: boolean
 * }} NaturalGridTreeUi
 */

/**
 * @typedef {{
 *   zebra?: boolean,
 *   toolbar?: NaturalGridToolbarUi,
 *   tree?: NaturalGridTreeUi
 * }} NaturalGridUi
 */

/**
 * @typedef {{
 *   kind: string,
 *   snapshot?: {
 *     columns?: Array<NaturalGridColumn>,
 *     rows?: Array<NaturalGridRow>,
 *     sort?: Array<any>,
 *     filters?: Array<any>
 *   },
 *   url?: string,
 *   method?: string,
 *   headers?: Record<string, string>,
 *   bodyJson?: unknown,
 *   pollMs?: number,
 *   eventName?: string,
 *   withCredentials?: boolean
 * }} NaturalGridDataSource
 */

/**
 * @typedef {{
 *   id: string,
 *   title?: string,
 *   ui?: NaturalGridUi,
 *   columns?: Array<NaturalGridColumn>,
 *   data?: NaturalGridDataSource,
 *   plugins?: Array<NaturalGridPluginRef>
 * }} NaturalGridSpec
 */

/**
 * @typedef {{
 *   id?: string,
 *   nature?: PluginNature,
 *   moduleUrl?: string,
 *   priority?: number,
 *   options?: Record<string, unknown>
 * }} NaturalGridPluginRef
 */

/**
 * @typedef {{
 *   columns: Array<NaturalGridColumn>,
 *   rows: Array<NaturalGridRow>,
 *   sort: Array<any>,
 *   filters: Array<any>,
 *   status: "init"|"loading"|"ready"|"error",
 *   error: string
 * }} NaturalGridModel
 */

/**
 * @typedef {{
 *   kind: string,
 *   start: (ds: NaturalGridDataSource) => (void|Promise<void>),
 *   stop: () => void
 * }} NaturalGridDataProvider
 */

/**
 * @typedef {{
 *   id: string,
 *   nature: PluginNature,
 *   priority: number,
 *   factory: (api: NaturalGridPluginApi, options?: Record<string, unknown>) => (void|(() => void)|Promise<void|(() => void)>),
 *   ref: NaturalGridPluginRef
 * }} LoadedPlugin
 */

/**
 * @typedef {{
 *   host: NaturalGrid,
 *   getConfig: () => NaturalGridSpec|null,
 *   getModel: () => NaturalGridModel,
 *   requestRender: () => void,
 *   setCellRenderer: (columnKey: string, fn: (ctx: {row: NaturalGridRow, column: NaturalGridColumn, value: unknown, grid: NaturalGrid}) => (Node|string|number|boolean|null|undefined)) => void,
 *   setHeaderRenderer: (columnKey: string, fn: (ctx: {column: NaturalGridColumn, grid: NaturalGrid}) => (Node|string|number|boolean|null|undefined)) => void,
 *   addToolbarItem: (nodeOrBuilder: Node | ((grid: NaturalGrid) => (Node|null|undefined))) => void,
 *   on: (eventName: string, handler: (detail: any) => void) => () => void,
 *   emit: (eventName: string, detail: any) => void,
 *   addStyles: (cssText: string, options?: { id?: string, priority?: number }) => () => void,
 *   registerDataProvider: (kind: string, factory: (api: NaturalGridPluginApi, options?: Record<string, unknown>) => NaturalGridDataProvider) => void,
 *   setStatus: (status: NaturalGridModel["status"]) => void,
 *   setError: (message: string) => void,
 *   setSnapshot: (snapshot: { columns?: Array<NaturalGridColumn>, rows?: Array<NaturalGridRow>, sort?: Array<any>, filters?: Array<any> }) => void,
 *   setRows: (rows: Array<NaturalGridRow>) => void,
 *   upsertRows: (rows: Array<NaturalGridRow>) => void
 *   updateTreeExpansion: (updater: (next: Set<string>) => void) => void,
 *   setTreeExpansion: (ids: Array<string>) => void,
 *   getTreeExpansion: () => Set<string>
 * }} NaturalGridPluginApi
 */

/**
 * Update the in-memory model when an SSE message arrives, supporting snapshot, row, or upsert instructions.
 * @param {NaturalGridModel} model
 * @param {unknown} payload
 */
function applySseMessage(model, payload) {
  if (!payload || typeof payload !== "object") return;
  const p = /** @type {any} */ (payload);

  const t = p.type;
  if (t === "setSnapshot" && p.snapshot) {
    const s = p.snapshot;
    model.columns = s.columns || model.columns;
    model.rows = s.rows || [];
    model.sort = s.sort || [];
    model.filters = s.filters || [];
    return;
  }
  if (t === "setRows" && Array.isArray(p.rows)) {
    model.rows = p.rows;
    return;
  }
  if (t === "upsertRows" && Array.isArray(p.rows)) {
    const next = new Map((model.rows || []).map((r) => [r.id, r]));
    for (const r of p.rows) next.set(r.id, r);
    model.rows = Array.from(next.values());
  }
}

/**
 * Built-in presentation plugin: inject modern theme CSS and expose a disposer hook.
 * @param {NaturalGridPluginApi} api
 */
function modernThemePresentationPlugin(api) {
  const dispose = api.addStyles(modernThemeCss(), {
    id: "theme:modern",
    priority: 0,
  });
  return () => dispose();
}

/**
 * Built-in content-supplier plugin that loads a static snapshot defined in the config.
 * @param {NaturalGridPluginApi} api
 * @returns {NaturalGridDataProvider}
 */
function staticDataProvider(api) {
  return {
    kind: "static",
    start: (ds) => {
      const snap = (ds && typeof ds === "object" && ds.snapshot)
        ? ds.snapshot
        : {};
      api.setSnapshot({
        columns: snap?.columns,
        rows: snap?.rows ?? [],
        sort: snap?.sort ?? [],
        filters: snap?.filters ?? [],
      });
      api.setStatus("ready");
      api.emit("data", { kind: "static", payload: snap });
      api.requestRender();
    },
    stop: () => {},
  };
}

/**
 * Built-in fetch data provider handles HTTP requests, polling, and emits snapshots on success.
 * @param {NaturalGridPluginApi} api
 * @returns {NaturalGridDataProvider}
 */
function fetchDataProvider(api) {
  /** @type {number|null} */
  let pollTimer = null;
  /** @type {AbortController|null} */
  let abort = null;

  const fetchOnce = async (ds) => {
    try {
      api.setStatus("loading");
      api.requestRender();

      abort?.abort();
      abort = new AbortController();

      const method = String(ds.method || "GET").toUpperCase();
      /** @type {{ method: string, headers: Record<string, string>, body?: string, signal: AbortSignal }} */
      const init = {
        method,
        headers: { ...(ds.headers || {}) },
        signal: abort.signal,
      };

      if (method !== "GET" && ds.bodyJson !== undefined) {
        init.headers["content-type"] = init.headers["content-type"] ||
          "application/json";
        init.body = JSON.stringify(ds.bodyJson);
      }

      const res = await fetch(String(ds.url || ""), init);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const payload = await res.json();
      const snap = payload?.snapshot || payload || {};

      api.setSnapshot({
        columns: snap.columns,
        rows: snap.rows ?? [],
        sort: snap.sort ?? [],
        filters: snap.filters ?? [],
      });

      api.setStatus("ready");
      api.emit("data", { kind: "fetch", payload: snap });
      api.requestRender();
    } catch (e) {
      api.setStatus("error");
      api.setError(
        `Fetch failed: ${/** @type {any} */ (e)?.message || String(e)}`,
      );
      api.requestRender();
    }
  };

  return {
    kind: "fetch",
    start: async (ds) => {
      if (!ds || !ds.url) {
        api.setStatus("error");
        api.setError("Fetch data provider missing url.");
        return;
      }
      await fetchOnce(ds);

      const pollMs = Number(ds.pollMs || 0);
      if (pollMs > 0) {
        pollTimer = setInterval(() => {
          fetchOnce(ds);
        }, pollMs);
      }
    },
    stop: () => {
      abort?.abort();
      abort = null;
      if (pollTimer != null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    },
  };
}

/**
 * Built-in SSE data provider listens to server-sent events and updates the model incrementally.
 * @param {NaturalGridPluginApi} api
 * @returns {NaturalGridDataProvider}
 */
function sseDataProvider(api) {
  /** @type {EventSource|null} */
  let es = null;

  return {
    kind: "sse",
    start: (ds) => {
      try {
        if (!ds || !ds.url) {
          api.setStatus("error");
          api.setError("SSE data provider missing url.");
          return;
        }

        api.setStatus("loading");
        api.requestRender();

        es?.close();
        es = new EventSource(String(ds.url), {
          withCredentials: !!ds.withCredentials,
        });

        const onMsg = (ev) => {
          try {
            const payload = JSON.parse(ev.data || "{}");
            // Allow server-side SSE messages to use applySseMessage semantics.
            const model = api.getModel();
            applySseMessage(model, payload);

            // If columns not set by message, keep config columns if available.
            if (!model.columns || model.columns.length === 0) {
              const cfg = api.getConfig();
              model.columns = cfg?.columns || [];
            }

            api.setStatus("ready");
            api.emit("data", { kind: "sse", payload });
            api.requestRender();
          } catch (_) { /* ignore */ }
        };

        const eventName = ds.eventName || DEFAULT_EVENT_NAME;
        if (eventName === "message") es.onmessage = onMsg;
        else es.addEventListener(eventName, onMsg);

        es.onerror = () => {
          api.setStatus("error");
          api.setError("SSE connection error.");
          api.requestRender();
        };
      } catch (e) {
        api.setStatus("error");
        api.setError(
          `SSE failed: ${/** @type {any} */ (e)?.message || String(e)}`,
        );
      }
    },
    stop: () => {
      try {
        es?.close();
      } catch (_) { /* ignore */ }
      es = null;
    },
  };
}

/**
 * Load external plugins (moduleUrl) and normalize their shape before initialization.
 * Modules may export:
 * - default factory function
 * - optional `nature`, `id`, `priority`
 * Aggregates provided metadata with defaults, enabling the plugin pipeline to sort and execute consistently.
 * @param {Array<NaturalGridPluginRef>} pluginRefs
 * @returns {Promise<Array<LoadedPlugin>>}
 */
async function loadExternalPlugins(pluginRefs) {
  const loaded = [];
  let order = 0;
  for (const ref of pluginRefs || []) {
    if (!ref || typeof ref !== "object") continue;
    if (!ref.moduleUrl) continue;

    try {
      const mod = await import(ref.moduleUrl);
      const factory = mod?.default;
      if (typeof factory !== "function") continue;

      /** @type {PluginNature} */
      const nature = ref.nature || mod?.nature || "grid-functionality";
      const id = String(ref.id || mod?.id || ref.moduleUrl);
      const priority = Number(ref.priority ?? mod?.priority ?? 0);

      loaded.push({
        id,
        nature,
        priority,
        factory,
        ref,
        order: order++,
      });
    } catch (e) {
      console.error("natural-grid: failed to import plugin", ref, e);
    }
  }
  return loaded;
}

/**
 * @typedef {{ element: Element, selectionStart?: number, selectionEnd?: number }} FocusCapture
 */

/**
 * Capture the currently focused element inside the ShadowRoot along with its selection range.
 * @param {ShadowRoot|null} root
 * @returns {FocusCapture|null}
 */
// Used at the start of every render so interactive controls (search boxes, buttons) keep focus.
function captureFocusedState(root) {
  if (!root) return null;
  const active = /** @type {Element|null} */ (root.activeElement);
  if (!active) return null;
  const state = { element: active };
  if (
    "selectionStart" in active &&
    typeof active.selectionStart === "number" &&
    "selectionEnd" in active &&
    typeof active.selectionEnd === "number"
  ) {
    state.selectionStart = active.selectionStart;
    state.selectionEnd = active.selectionEnd;
  }
  return state;
}

/**
 * Re-focus the previously captured element if it has been reinserted into the DOM.
 * @param {FocusCapture|null} state
 */
// Deferred to the next paint so re-attached controls re-claim their keyboard focus.
function restoreFocusedState(state) {
  if (!state) return;
  schedulePaint(() => {
    const el = state.element;
    if (!el || !el.isConnected) return;
    try {
      el.focus();
      if (
        typeof state.selectionStart === "number" &&
        typeof state.selectionEnd === "number" &&
        typeof /** @type {any} */ (el).setSelectionRange === "function"
      ) {
        /** @type {HTMLInputElement | HTMLTextAreaElement} */ (el)
          .setSelectionRange(state.selectionStart, state.selectionEnd);
      }
    } catch (_) { /* ignore focus failures */ }
  });
}

export class NaturalGrid extends HTMLElement {
  static get observedAttributes() {
    return [
      "data-init",
      "data-config-id",
      "data-factory",
      "data-title",
      "data-theme",
      "data-unstyled",
    ];
  }

  /** @type {NaturalGridSpec|null} */
  #config = null;

  /** @type {NaturalGridModel} */
  #model = {
    columns: [],
    rows: [],
    sort: [],
    filters: [],
    status: "init",
    error: "",
  };

  /** @type {Map<string, (ctx: {row: NaturalGridRow, column: NaturalGridColumn, value: unknown, grid: NaturalGrid}) => any>} */
  #cellRenderers = new Map();

  /** @type {Map<string, (ctx: {column: NaturalGridColumn, grid: NaturalGrid}) => any>} */
  #headerRenderers = new Map();

  /** @type {Array<Node|((grid: NaturalGrid) => (Node|null|undefined))>} */
  #toolbarItems = [];

  /** @type {Array<Node|((grid: NaturalGrid) => (Node|null|undefined))>} */
  #footerItems = [];

  /** @type {Map<string, Array<(detail: any) => void>>} */
  #events = new Map();

  /** @type {Array<() => void>} */
  #pluginDisposers = [];

  /** @type {Array<LoadedPlugin>} */
  // Sorted list of active plugins covering presentation, data, and grid feature extensions.
  #plugins = [];

  /** @type {Map<string, (api: NaturalGridPluginApi, options?: Record<string, unknown>) => NaturalGridDataProvider>} */
  // Data providers map a kind string (static/fetch/sse or custom) to factory functions.
  #dataProviderFactories = new Map();

  /** @type {NaturalGridDataProvider|null} */
  #activeDataProvider = null;

  /** @type {Array<{id:string, priority:number, cssText:string, sheet: CSSStyleSheet|null}>} */
  #pluginStyleSheets = [];

  /** @type {CSSStyleSheet|null} */
  #sheetBase = null;

  /** @type {CSSStyleSheet|null} */
  #sheetTheme = null;

  /** @type {CSSStyleSheet|null} */
  #sheetUser = null;

  /** @type {string} */
  #userCss = "";

  /** @type {Array<HTMLStyleElement>} */
  #styleFallbackEls = [];

  /** @type {HTMLElement|null} */
  #viewportElement = null;

  /** @type {((ev: Event) => void)|null} */
  #viewportScrollHandler = null;

  /** @type {{rowStart:number, colStart:number}} */
  #virtualizationState = { rowStart: 0, colStart: 0 };

  /** @type {boolean} */
  #virtualizationScrollBlocked = false;

  /** @type {Set<string>} */
  #treeExpandedIds = new Set();

  #initDone = false;
  #reinitQueued = false;

  constructor() {
    super();
    // Keep all DOM within an open shadow root so styles and plugin nodes stay encapsulated.
    this.attachShadow({ mode: "open" });
  }

  async connectedCallback() {
    // Kick off initialization once inserted; config resolution + plugin ecosystem happen inside.
    await this.#initializeIfNeeded();
  }

  disconnectedCallback() {
    // Tear down ongoing data providers and plugin disposers on DOM removal.
    this.#stopDataProvider();
    for (const d of this.#pluginDisposers.splice(0)) {
      try {
        d();
      } catch (_) { /* ignore */ }
    }
    this.#initDone = false;
  }

  attributeChangedCallback() {
    if (!this.isConnected) return;
    if (!this.#initDone) return;

    if (this.#reinitQueued) return;
    this.#reinitQueued = true;
    queueMicrotask(async () => {
      this.#reinitQueued = false;
      // Rebuild everything when observed attributes change after initial render.
      await this.#reinitialize();
    });
  }

  /**
   * Determine whether the host should inject default styles; can be disabled via `data-unstyled`.
   * @returns {boolean}
   */
  #shouldInjectStyles() {
    return !this.hasAttribute("data-unstyled");
  }

  /**
   * Provide extra theme CSS when a future internal theme is required; presentation plugins own the theme today.
   * @returns {string}
   */
  #themeCssText() {
    // Theme selection can be driven by attribute, but default modern is provided via presentation plugin.
    // Keep this empty so theme is controlled by presentation plugins.
    return "";
  }

  #ensureBaseSheet() {
    const root = this.shadowRoot;
    if (!root) return;

    // Manage the constructable stylesheets that back the base/theme/user style pipeline.
    if (!this.#shouldInjectStyles()) {
      this.#sheetBase = null;
      this.#sheetTheme = null;
      this.#sheetUser = null;
      return;
    }

    if (canAdoptSheets(root)) {
      this.#sheetBase = makeSheet(baseStyles());
      // Theme is injected by presentation plugins; reserve #sheetTheme only if future internal themes are used.
      this.#sheetTheme = this.#themeCssText()
        ? makeSheet(this.#themeCssText())
        : null;
      this.#sheetUser = this.#userCss ? makeSheet(this.#userCss) : null;
    } else {
      this.#sheetBase = null;
      this.#sheetTheme = null;
      this.#sheetUser = null;
    }
  }

  #applyStylePipeline() {
    const root = this.shadowRoot;
    if (!root) return;

    // Clean up previously injected <style> tags before re-applying sheet order.
    for (const el of this.#styleFallbackEls.splice(0)) {
      try {
        el.remove();
      } catch (_) { /* ignore */ }
    }

    if (!this.#shouldInjectStyles()) {
      // Skip style injection entirely when host opts out.
      if (canAdoptSheets(root)) root.adoptedStyleSheets = [];
      return;
    }

    const orderedPluginSheets = [...this.#pluginStyleSheets].sort((a, b) =>
      (a.priority - b.priority) || a.id.localeCompare(b.id)
    );

    if (canAdoptSheets(root)) {
      /** @type {Array<CSSStyleSheet>} */
      const sheets = [];
      if (this.#sheetBase) sheets.push(this.#sheetBase);
      if (this.#sheetTheme) sheets.push(this.#sheetTheme);
      for (const p of orderedPluginSheets) {
        if (p.sheet) sheets.push(p.sheet);
      }
      if (this.#sheetUser) sheets.push(this.#sheetUser);
      root.adoptedStyleSheets = sheets;
      return;
    }

    // Fallback for browsers that cannot adopt constructable stylesheets.
    const cssTexts = [
      baseStyles(),
      this.#themeCssText(),
      ...orderedPluginSheets.map((p) => p.cssText),
      this.#userCss || "",
    ].filter((x) => !!x);

    for (const css of cssTexts) {
      const style = document.createElement("style");
      style.textContent = css;
      root.appendChild(style);
      this.#styleFallbackEls.push(style);
    }
  }

  /** @param {string} cssText */
  // Accept externally supplied CSS so runtime themes or user overrides can blend into the pipeline.
  setThemeCss(cssText) {
    this.#userCss = String(cssText || "");
    const root = this.shadowRoot;
    if (root && canAdoptSheets(root)) {
      this.#sheetUser = this.#userCss ? makeSheet(this.#userCss) : null;
    }
    this.#render();
  }

  /**
   * Build the API surface plugins consume to interact with the grid host.
   * @returns {NaturalGridPluginApi}
   */
  // This API keeps plugins sandboxed: they can render headers, emit events, register data
  // providers, and push snapshots without touching the renderer directly.
  #createPluginApi() {
    return {
      host: this,
      getConfig: () => this.#config,
      getModel: () => this.#model,
      requestRender: () => this.#render(),
      // Override how a column cell renders; triggers re-render for immediate effect.
      setCellRenderer: (columnKey, fn) => {
        this.#cellRenderers.set(columnKey, fn);
        this.#render();
      },
      // Customize the column header cell via callback.
      setHeaderRenderer: (columnKey, fn) => {
        this.#headerRenderers.set(columnKey, fn);
        this.#render();
      },
      // Add toolbar nodes (or builder factories) exposed by presentation/functionality plugins.
      addToolbarItem: (nodeOrBuilder) => {
        this.#toolbarItems.push(nodeOrBuilder);
        this.#render();
      },
      addFooterItem: (nodeOrBuilder) => {
        this.#footerItems.push(nodeOrBuilder);
        this.#render();
      },
      on: (eventName, handler) => {
        const list = this.#events.get(eventName) || [];
        list.push(handler);
        this.#events.set(eventName, list);
        return () => {
          const next = (this.#events.get(eventName) || []).filter((h) =>
            h !== handler
          );
          this.#events.set(eventName, next);
        };
      },
      emit: (eventName, detail) => this.#emit(eventName, detail),
      // Register cascading plugin styles; returns disposer for cleanup.
      addStyles: (cssText, options) => {
        const id = String(
          options?.id ||
            (globalThis.crypto?.randomUUID?.() ?? `style_${Date.now()}`),
        );
        const priority = Number(options?.priority ?? 0);
        const css = String(cssText || "");
        const root = this.shadowRoot;

        /** @type {{id:string, priority:number, cssText:string, sheet: CSSStyleSheet|null}} */
        const entry = { id, priority, cssText: css, sheet: null };
        if (css && root && this.#shouldInjectStyles() && canAdoptSheets(root)) {
          entry.sheet = makeSheet(css);
        }

        this.#pluginStyleSheets.push(entry);
        this.#render();

        return () => {
          this.#pluginStyleSheets = this.#pluginStyleSheets.filter((x) =>
            x.id !== id
          );
          this.#render();
        };
      },
      // Extend the set of data-provider factories for custom content plugins.
      registerDataProvider: (kind, factory) => {
        const k = String(kind || "").trim();
        if (!k) return;
        if (typeof factory !== "function") return;
        this.#dataProviderFactories.set(k, factory);
      },
      // Allow plugins to flip the shared status and surface load/error states.
      setStatus: (status) => {
        this.#model.status = status;
      },
      // Allow plugins to push errors into the shared model for UI to display.
      setError: (message) => {
        this.#model.error = String(message || "");
      },
      // Replace the canonical snapshot when plugins fetch fresh data.
      setSnapshot: (snapshot) => {
        const cfgCols = this.#config?.columns || [];
        this.#model.columns = snapshot.columns ||
          (this.#model.columns.length ? this.#model.columns : cfgCols);
        this.#model.rows = snapshot.rows || [];
        this.#model.sort = snapshot.sort || [];
        this.#model.filters = snapshot.filters || [];
      },
      // Replace rows wholesale, useful when a plugin loads a new list.
      setRows: (rows) => {
        this.#model.rows = Array.isArray(rows) ? rows : [];
      },
      // Merge incoming rows with the existing set, keyed by id.
      upsertRows: (rows) => {
        if (!Array.isArray(rows)) return;
        const next = new Map((this.#model.rows || []).map((r) => [r.id, r]));
        for (const r of rows) next.set(r.id, r);
        this.#model.rows = Array.from(next.values());
      },
      updateTreeExpansion: (updater) => {
        if (typeof updater !== "function") return;
        const next = new Set(this.#treeExpandedIds);
        updater(next);
        this.#treeExpandedIds = next;
      },
      setTreeExpansion: (ids) => {
        if (!Array.isArray(ids)) return;
        this.#treeExpandedIds = new Set(ids.map((id) => String(id)));
      },
      getTreeExpansion: () => new Set(this.#treeExpandedIds),
    };
  }

  async #reinitialize() {
    // Reset any running data providers and plugin hooks before a fresh init.
    this.#stopDataProvider();

    for (const d of this.#pluginDisposers.splice(0)) {
      try {
        d();
      } catch (_) { /* ignore */ }
    }

    // Clear renderers, toolbar, events, and style caches before reinitializing.
    this.#cellRenderers.clear();
    this.#headerRenderers.clear();
    this.#toolbarItems.length = 0;
    this.#footerItems.length = 0;
    this.#events.clear();
    this.#pluginStyleSheets.length = 0;
    this.#dataProviderFactories.clear();
    this.#treeExpandedIds.clear();

    this.#plugins = [];
    this.#config = null;
    // Reset the runtime model so content providers start from a clean slate.
    this.#model = {
      columns: [],
      rows: [],
      sort: [],
      filters: [],
      status: "init",
      error: "",
    };

    this.#virtualizationState = { rowStart: 0, colStart: 0 };

    await this.#initializeIfNeeded(true);
  }

  async #initializeIfNeeded(force = false) {
    if (this.#initDone && !force) return;
    this.#initDone = true;

    // Begin load cycle: resolve config, register plugins, and render when ready.
    this.#model.status = "loading";

    const cfg = await this.#resolveConfig();
    if (!cfg) {
      // No valid config, stay in error state so render shows a message.
      this.#model.status = "error";
      this.#model.error = "Missing or invalid grid config.";
      this.#render();
      return;
    }
    this.#config = cfg;

    // Build the shared plugin API so presentation/data plugins can hook into the grid.
    const api = this.#createPluginApi();

    // Register built-in content-suppliers (data providers) and default presentation.
    api.registerDataProvider("static", () => staticDataProvider(api));
    api.registerDataProvider("fetch", () => fetchDataProvider(api));
    api.registerDataProvider("sse", () => sseDataProvider(api));

    /** @type {Array<LoadedPlugin>} */
    // Default presentation plugin that injects the modern look before other plugins run.
    const builtIns = [
      {
        id: "presentation:theme:modern",
        nature: "presentation",
        priority: -1000,
        factory: (a) => modernThemePresentationPlugin(a),
        ref: {
          id: "presentation:theme:modern",
          nature: "presentation",
          priority: -1000,
          options: {},
        },
      },
    ];

    const pluginRefs = Array.isArray(cfg.plugins) ? cfg.plugins : [];
    const externals = await loadExternalPlugins(pluginRefs);

    // Combine and order: presentation first, then content-supplier, then grid-functionality.
    this.#plugins = [...builtIns, ...externals].sort((a, b) => {
      const delta = a.priority - b.priority;
      if (delta !== 0) return delta;
      const orderDelta = Number(a.order ?? 0) - Number(b.order ?? 0);
      if (orderDelta !== 0) return orderDelta;
      return (a.id || "").localeCompare(b.id || "");
    });

    // Initialize presentation + content-supplier + grid-functionality plugins (all can register hooks/providers).
    for (const p of this.#plugins) {
      try {
        const disposer = await p.factory(api, p.ref?.options || {});
        if (typeof disposer === "function") {
          this.#pluginDisposers.push(disposer);
        }
      } catch (e) {
        console.error("natural-grid: plugin init failed", p, e);
      }
    }

    // Ensure base styles exist (variable-driven). Presentation plugins add their own CSS into pipeline.
    this.#ensureBaseSheet();

    // Start data using whichever provider is registered for config.data.kind.
    await this.#startDataProvider();

    this.#render();
  }

  // deno-lint-ignore require-await
  async #resolveConfig() {
    // Try to read config via attribute-specified JSON/table/factory in prioritized order.
    const explicitMode = (this.getAttribute("data-init") || "").trim()
      .toLowerCase();

    // Prefer inline <script type="application/json"> blocks for quick config.
    const tryInternalJson = () => {
      const script = this.querySelector(
        'script[type="application/json"][data-natural-grid-config]',
      ) ||
        this.querySelector('script[type="application/json"]');
      return /** @type {NaturalGridSpec|null} */ (parseJsonScript(script));
    };

    // Next, look for a globally referenced JSON block via data-config-id.
    const tryExternalJson = () => {
      const cfgId = this.getAttribute("data-config-id") || "";
      return /** @type {NaturalGridSpec|null} */ (parseJsonScript(byId(cfgId)));
    };

    // Fall back to converting an inline <table> into a NaturalGridSpec.
    const tryTable = () => {
      const t = this.querySelector("table");
      if (!(t instanceof HTMLTableElement)) return null;
      const id = this.getAttribute("id") ||
        (globalThis.crypto?.randomUUID?.() ?? `grid_${Date.now()}`);
      const title = (this.getAttribute("data-title") || "").trim() || undefined;
      return gridSpecFromTable(t, { id, title });
    };

    // Allow authors to provide a factory function name that returns a config object.
    const tryFactory = () => {
      const fnName = (this.getAttribute("data-factory") || "").trim();
      if (!fnName) return null;
      const fn = /** @type {any} */ (globalThis)[fnName];
      if (typeof fn !== "function") return null;
      try {
        const out = fn(this);
        return out && typeof out === "object"
          ? /** @type {NaturalGridSpec} */ (out)
          : null;
      } catch (e) {
        console.error("natural-grid: factory threw", e);
        return null;
      }
    };

    if (explicitMode === "json") return tryInternalJson() || tryExternalJson();
    if (explicitMode === "table") return tryTable();
    if (explicitMode === "factory") return tryFactory();

    return tryInternalJson() || tryExternalJson() || tryTable() || tryFactory();
  }

  /**
   * Lookup the configured data provider and start it with the current data source blob.
   */
  async #startDataProvider() {
    // Grab the data source descriptor from the resolved config.
    const ds = this.#config?.data;
    if (!ds || typeof ds !== "object") {
      this.#model.status = "error";
      this.#model.error = "No data source configured.";
      return;
    }

    const kind = String(ds.kind || "").trim();
    if (!kind) {
      this.#model.status = "error";
      this.#model.error = "Data source kind missing.";
      return;
    }

    const factory = this.#dataProviderFactories.get(kind);
    if (!factory) {
      // No provider registered for this kind, surface error.
      this.#model.status = "error";
      this.#model.error = `No data provider registered for kind: ${kind}`;
      return;
    }

    // Always stop existing provider before attaching a new one.
    this.#stopDataProvider();
    this.#activeDataProvider = factory(this.#createPluginApi(), {});
    try {
      await this.#activeDataProvider.start(ds);
    } catch (e) {
      this.#model.status = "error";
      this.#model.error = `Data provider failed: ${
        /** @type {any} */ (e)?.message || String(e)
      }`;
    }
  }

  #stopDataProvider() {
    // Safely terminate any running provider before swapping or destroying the grid.
    try {
      this.#activeDataProvider?.stop();
    } catch (_) { /* ignore */ }
    this.#activeDataProvider = null;
  }

  #emit(name, detail) {
    // Dispatch runtime events to registered handlers without halting on errors.
    const list = this.#events.get(name) || [];
    for (const fn of list) {
      try {
        fn(detail);
      } catch (_) { /* ignore */ }
    }
  }

  /**
   * Rebuild the shadow DOM table, toolbar, and supporting UI based on the latest model.
   */
  #render() {
    const root = this.shadowRoot;
    if (!root) return;
    const focusCapture = captureFocusedState(root);

    if (this.#viewportElement && this.#viewportScrollHandler) {
      this.#viewportElement.removeEventListener(
        "scroll",
        this.#viewportScrollHandler,
      );
      this.#viewportScrollHandler = null;
    }

    const cfg = this.#config || /** @type {NaturalGridSpec} */ ({});
    const ui = cfg.ui || /** @type {NaturalGridUi} */ ({});
    const zebra = ui.zebra ? "1" : "0";
    const title = String(cfg.title || "").trim();

    root.innerHTML = "";

    // Stylesheets: base + presentation plugin CSS + optional user CSS.
    this.#ensureBaseSheet();
    this.#applyStylePipeline();

    const wrap = document.createElement("div");
    wrap.className = "wrap";
    wrap.part = "wrap";
    root.appendChild(wrap);

    if (title) {
      const t = document.createElement("div");
      t.className = "title";
      t.part = "title";
      t.textContent = title;
      wrap.appendChild(t);
    }

    if ((ui.toolbar?.enabled !== false) && this.#toolbarItems.length > 0) {
      // Render toolbar items provided by plugins or consumers, honoring builder callbacks.
      const tb = document.createElement("div");
      tb.className = "toolbar";
      tb.part = "toolbar";

      for (const item of this.#toolbarItems) {
        if (!item) continue;
        if (typeof item === "function") {
          const node = item(this);
          if (node) tb.appendChild(node);
        } else if (item instanceof Node) {
          tb.appendChild(item);
        }
      }

      if (tb.childNodes.length) wrap.appendChild(tb);
    }

    if (this.#model.status === "error") {
      // Early exit once an error is displayed so we don't render partial table content.
      const e = document.createElement("div");
      e.className = "error";
      e.part = "error";
      e.textContent = this.#model.error || "Error";
      wrap.appendChild(e);
      return;
    }

    const cols = (this.#model.columns && this.#model.columns.length)
      ? this.#model.columns
      : (cfg.columns || []);

    const rows = this.#model.rows || [];
    const treeEnabled = !!ui.tree?.enabled;

    const flatEntries = treeEnabled
      ? flattenTreeRows(rows, 0, [], this.#treeExpandedIds)
      : rows.map((r) => ({ row: r, depth: 0 }));

    const virtualizationUi = ui.virtualization || {};
    const rowHeight = Math.max(1, Number(virtualizationUi.rowHeightPx ?? 34));
    const viewportHeightPx = Math.max(
      160,
      Number(virtualizationUi.viewportHeightPx ?? 360),
    );
    const bufferRows = Math.max(0, Number(virtualizationUi.bufferRows ?? 5));
    const columnWidthHint = Math.max(
      48,
      Number(virtualizationUi.columnWidthPx ?? 160),
    );
    const columnBuffer = Math.max(
      0,
      Number(virtualizationUi.columnBuffer ?? 2),
    );
    const viewportWidthPx = Math.max(
      200,
      Number(virtualizationUi.viewportWidthPx ?? 760),
    );

    // Decide if virtualization should run: either explicitly enabled, or triggered
    // automatically when row/column counts exceed configured thresholds.
    const virtualizationEnabled = Boolean(
      virtualizationUi.enabled ??
        (flatEntries.length > (virtualizationUi.rowThreshold ?? 200) ||
          cols.length > (virtualizationUi.columnThreshold ?? 16)),
    );

    const totalFlatRows = flatEntries.length;
    const rowStartRaw = this.#virtualizationState.rowStart;
    const rowStart = virtualizationEnabled
      ? Math.min(Math.max(0, rowStartRaw), Math.max(0, totalFlatRows - 1))
      : 0;
    const visibleRowCount = virtualizationEnabled
      ? Math.max(
        1,
        Math.min(
          totalFlatRows,
          Math.ceil(viewportHeightPx / rowHeight) + bufferRows * 2,
        ),
      )
      : totalFlatRows;
    const rowEnd = virtualizationEnabled
      ? Math.min(totalFlatRows, rowStart + visibleRowCount)
      : totalFlatRows;
    const visibleRows = virtualizationEnabled
      ? flatEntries.slice(rowStart, rowEnd)
      : flatEntries;
    const topSpacerHeight = virtualizationEnabled ? rowStart * rowHeight : 0;
    const bottomSpacerHeight = virtualizationEnabled
      ? Math.max(0, (totalFlatRows - rowEnd) * rowHeight)
      : 0;

    const columnWidths = cols.map((c) =>
      Math.max(1, Number(c.widthPx ?? columnWidthHint))
    );
    const columnOffsets = columnWidths.reduce((acc, width) => {
      acc.push(acc[acc.length - 1] + width);
      return acc;
    }, [0]);
    const totalColumnWidth = columnOffsets[columnOffsets.length - 1] || 0;
    const colStartRaw = this.#virtualizationState.colStart;
    const colStart = virtualizationEnabled
      ? Math.min(Math.max(0, colStartRaw), Math.max(0, cols.length - 1))
      : 0;
    let colEnd = colStart;
    if (virtualizationEnabled) {
      const targetWidth = viewportWidthPx + columnBuffer * columnWidthHint;
      let widthAccumulator = 0;
      while (colEnd < cols.length && widthAccumulator < targetWidth) {
        widthAccumulator += columnWidths[colEnd];
        colEnd++;
      }
      if (colEnd === colStart && cols.length > 0) {
        colEnd = Math.min(cols.length, colStart + 1);
      }
    } else {
      colEnd = cols.length;
    }
    const visibleColumns = cols.slice(colStart, colEnd);
    const visibleColumnCount = Math.max(1, visibleColumns.length);
    const visibleColumnsWidth = columnWidths.slice(colStart, colEnd)
      .reduce((sum, w) => sum + w, 0) || 0;
    const leftPadding = virtualizationEnabled
      ? (columnOffsets[colStart] ?? 0)
      : 0;
    const rightPadding = virtualizationEnabled
      ? Math.max(
        0,
        totalColumnWidth - (columnOffsets[colEnd] ?? totalColumnWidth),
      )
      : 0;

    if (!virtualizationEnabled) {
      this.#virtualizationState.rowStart = 0;
      this.#virtualizationState.colStart = 0;
    }

    // Build a scrollable viewport that either virtualizes rows (fixed height) or
    // lets the table grow naturally when virtualization is disabled.
    const viewport = document.createElement("div");
    viewport.className = "viewport";
    viewport.part = "viewport";
    viewport.style.overflow = "auto";
    viewport.style.position = "relative";
    if (virtualizationEnabled) {
      viewport.style.height = `${viewportHeightPx}px`;
    } else {
      viewport.style.height = "";
    }
    wrap.appendChild(viewport);

    const track = document.createElement("div");
    track.className = "viewport-track";
    const trackWidth = virtualizationEnabled
      ? Math.max(1, totalColumnWidth, viewportWidthPx)
      : Math.max(1, viewportWidthPx, totalColumnWidth);
    const trackHeight = virtualizationEnabled
      ? Math.max(1, totalFlatRows * rowHeight, viewportHeightPx)
      : Math.max(1, totalFlatRows * rowHeight, rowHeight);
    track.style.width = `${trackWidth}px`;
    track.style.height = `${trackHeight}px`;
    viewport.appendChild(track);

    const tableHost = document.createElement("div");
    tableHost.className = "viewport-table";
    tableHost.part = "viewport-table";
    tableHost.style.position = virtualizationEnabled ? "relative" : "static";
    tableHost.style.zIndex = "1";
    tableHost.style.paddingLeft = `${leftPadding}px`;
    tableHost.style.paddingRight = `${rightPadding}px`;
    const hostMinWidth = virtualizationEnabled
      ? Math.max(1, totalColumnWidth, visibleColumnsWidth)
      : Math.max(1, visibleColumnsWidth);
    tableHost.style.minWidth = `${hostMinWidth}px`;
    viewport.appendChild(tableHost);

    const table = document.createElement("table");
    table.part = "table";
    table.style.position = "relative";
    tableHost.appendChild(table);

    if (virtualizationEnabled) {
      const clampRowStart = Math.max(0, totalFlatRows - visibleRowCount);
      const clampColumnStart = Math.max(0, cols.length - visibleColumnCount);
      const resolveColumnStart = (offset) => {
        if (!cols.length) return 0;
        for (let i = 0; i < columnOffsets.length - 1; i++) {
          if (offset < columnOffsets[i + 1]) {
            return Math.min(clampColumnStart, Math.max(0, i));
          }
        }
        return clampColumnStart;
      };

      const handleScroll = () => {
        if (this.#virtualizationScrollBlocked) return;
        const nextRowStart = Math.min(
          clampRowStart,
          Math.max(0, Math.floor(viewport.scrollTop / rowHeight)),
        );
        const nextColStart = resolveColumnStart(viewport.scrollLeft);
        if (
          nextRowStart === this.#virtualizationState.rowStart &&
          nextColStart === this.#virtualizationState.colStart
        ) {
          return;
        }
        this.#virtualizationState.rowStart = nextRowStart;
        this.#virtualizationState.colStart = nextColStart;
        this.#virtualizationScrollBlocked = true;
        this.#render();
      };

      viewport.addEventListener("scroll", handleScroll);
      this.#viewportScrollHandler = handleScroll;
      this.#viewportElement = viewport;
      this.#virtualizationScrollBlocked = true;
      viewport.scrollTop = this.#virtualizationState.rowStart * rowHeight;
      const safeColIndex = Math.min(
        this.#virtualizationState.colStart,
        columnOffsets.length - 1,
      );
      viewport.scrollLeft = columnOffsets[safeColIndex] ?? 0;
      this.#virtualizationScrollBlocked = false;
    } else {
      this.#viewportElement = null;
    }

    const thead = document.createElement("thead");
    thead.part = "thead";
    table.appendChild(thead);

    const trh = document.createElement("tr");
    trh.part = "tr";
    thead.appendChild(trh);

    // Build header row, honoring any header renderer hooks for each column.
    for (const c of visibleColumns) {
      const th = document.createElement("th");
      th.part = "th";

      const hdr = this.#headerRenderers.get(c.key);
      if (hdr) {
        const out = hdr({ column: c, grid: this });
        if (out instanceof Node) th.appendChild(out);
        else th.textContent = String(out ?? c.title);
      } else {
        th.textContent = c.title;
      }

      if (c.widthPx) th.style.width = `${c.widthPx}px`;
      if (c.align) th.style.textAlign = c.align;

      trh.appendChild(th);
    }

    const tbody = document.createElement("tbody");
    tbody.part = "tbody";
    table.appendChild(tbody);

    /** @param {number} height */
    const appendSpacerRow = (height) => {
      if (!virtualizationEnabled || height <= 0) return;
      const spacer = document.createElement("tr");
      spacer.className = "virtualized-spacer";
      spacer.setAttribute("aria-hidden", "true");
      const spacerCell = document.createElement("td");
      spacerCell.colSpan = visibleColumnCount;
      spacerCell.style.height = `${height}px`;
      spacerCell.style.padding = "0";
      spacerCell.style.border = "none";
      spacer.appendChild(spacerCell);
      tbody.appendChild(spacer);
    };

    appendSpacerRow(topSpacerHeight);

    for (const entry of visibleRows) {
      const r = entry.row;
      const depth = entry.depth || 0;

      const tr = document.createElement("tr");
      tr.part = "tr";
      tr.setAttribute("data-zebra", zebra);
      tr.setAttribute("data-row-id", String(r.id));
      tbody.appendChild(tr);

      for (let i = 0; i < visibleColumns.length; i++) {
        const col = visibleColumns[i];
        const td = document.createElement("td");
        td.part = "td";
        if (col.align) td.style.textAlign = col.align;

        const cellRenderer = this.#cellRenderers.get(col.key);
        const raw = r?.cells ? r.cells[col.key] : null;
        const val = normalizeCell(raw);

        /** @param {HTMLElement} container */
        const renderValueInto = (container) => {
          if (cellRenderer) {
            const out = cellRenderer({
              row: r,
              column: col,
              value: raw,
              grid: this,
            });
            if (out instanceof Node) container.appendChild(out);
            else {container.textContent = String(
                out ?? (typeof val === "object" ? "" : val),
              );}
            return;
          }
          if (
            typeof val === "object" && val && /** @type {any} */
            (val).__html != null
          ) {
            container.innerHTML = /** @type {any} */ (val).__html;
          } else container.textContent = String(val ?? "");
        };

        if (i === 0 && treeEnabled) {
          // Build the tree indentation/expander container wrapping the first column cell.
          const box = document.createElement("div");
          box.className = "cell";
          box.part = "cell";

          const indent = document.createElement("span");
          indent.className = "indent";
          indent.part = "indent";
          indent.style.setProperty("--depth", String(depth));
          box.appendChild(indent);

          const hasKids = !!(r.children && r.children.length);
          const exp = document.createElement("span");
          exp.className = "expander";
          exp.part = "expander";
          const rowId = String(r.id);
          const isExpanded = hasKids && this.#treeExpandedIds.has(rowId);
          exp.classList.toggle("expanded", isExpanded);
          if (hasKids) {
            const glyph = document.createElement("span");
            glyph.className = "expander-glyph";
            glyph.textContent = isExpanded ? "▾" : "▸";
            exp.appendChild(glyph);
          }
          box.appendChild(exp);

          const content = document.createElement("span");
          content.part = "cell-content";
          renderValueInto(content);
          box.appendChild(content);

          td.appendChild(box);
        } else {
          renderValueInto(td);
        }

        tr.appendChild(td);
      }
    }

    appendSpacerRow(bottomSpacerHeight);

    if (this.#footerItems.length) {
      const footer = document.createElement("div");
      footer.className = "footer";
      footer.part = "footer";
      for (const item of this.#footerItems) {
        if (!item) continue;
        if (typeof item === "function") {
          const node = item(this);
          if (node) footer.appendChild(node);
        } else if (item instanceof Node) {
          footer.appendChild(item);
        }
      }
      if (footer.childNodes.length) wrap.appendChild(footer);
    }
    restoreFocusedState(focusCapture);
  }
}

// Register custom element once to allow multiple script executions without error.
if (!customElements.get("natural-grid")) {
  customElements.define("natural-grid", NaturalGrid);
}
