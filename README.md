# Operational Truth™ Public Assets and Content

Using GitHub Pages as a lightweight server for _Operational Truth™_ assets
allows us to prototype and share browser-focused utilities without a heavy
backend.

## Philosophy

- Treat markup as first-class intent: prefer readable HTML scaffolding, then
  layer in `natural-web-ua/elements.js` helpers to keep DOM creation functional,
  deterministic, and easy to reason about without JSX or templating magic.
- Keep components lightweight, scriptable, and plugin-friendly so new
  capabilities (data models, grids, Markdown views) can be composed without
  forking the core runtime or browser APIs.
- Ship learning resources (`support/learn/natural-web-ua/...`) alongside the
  source code so each module includes a documented, runnable example that
  demonstrates how to build, enhance, and inspect the UI or data model.
- Prefer dependency-free or well-known, light dependencies so typed-ish modern
  JavaScript stays readable for both humans and AI maintainers; minimal reliance
  on external packages keeps the platform stable and easy to validate.

## Web User Agent (`web-ua`) Libraries

- **Natural (functional) HTML**
  - Source: `natural-web-ua/elements.js`
  - Philosophy: safe-by-default children, deterministic helpers (`classNames`,
    `styleText`, `each`, `uaDep*`, `collectStyleAttributeCss`), and explicit
    raw/text escape hatches keep us honest about DOM mutations. The
    `natural-web-ua/elements_test.ts` fixture proves the helpers boot in a real
    browser and enforce policies such as `raw()` blocking under `dev-strict`.
  - Learning: `support/learn/natural-web-ua/elements/index.html` walks through
    incrementally enhancing a static page before inserting DOM built with the
    library.

- **Extensible Data Model (XDM)**
  - Source: `natural-web-ua/xdm/omb.js`, `omb-zod.js` (with `support/learn`
    helpers)
  - Philosophy: Object Model Builder (OMB) parses DOM/XML into layered nodes
    (`.tag`, `.children`, typed getters) so developers can treat markup as data,
    apply schema-driven typing via `omb:type` or `omb:type-as`, and emit
    JSON/Zod schemas without losing the original structure.
  - Learning: `support/learn/natural-web-ua/xdm/index.html` is the interactive
    playground; `support/learn/natural-web-ua/xdm/hello-ce.html` and
    `hello-factory.html` show the custom element and factory flows,
    respectively.

## Web Components

- **Markdown Custom Element**
  - Source: `natural-web-ua/markdown/markdown.js`
  - Philosophy: a self-contained `<markdown-html>` element runs
    unified/remark/rehype from CDN, rewrites relative URLs, hardens links, adds
    deterministic CSS, and ships lazy enhancements (highlight.js, Mermaid,
    KaTeX). It emits `rendered`/`markdown-rendered` events so pages can react to
    content updates.
  - Learning: `support/learn/natural-web-ua/markdown/index.html` demonstrates
    inline markdown, styling helpers, CLI meta, manual render, and sandboxed
    math/rendering support.

- **Grid Web Custom Element**
  - Source: `natural-web-ua/grid/grid.js` + `grid-plugins-typical.js`
  - Philosophy: `<natural-grid>` resolves configs from inline JSON, external
    tables, or factories, loads presentation/content/functionality plugins in a
    predictable order, and keeps styling deterministic via constructable
    stylesheets + plugin CSS. The typical plugin pack ships
    sort/filter/pagination/tree helpers that plug into the toolbar/footer areas.
  - Learning: `support/learn/natural-web-ua/grid/index.html` walks through
    HTML-first upgrades, config overrides, plugin wiring, and tree mode, keeping
    the markup editable while enhancing it with the grid engine.
  - Extra learning: `support/learn/natural-web-ua/xdm/index.html`,
    `support/learn/natural-web-ua/xdm/hello-ce.html`, and
    `support/learn/natural-web-ua/xdm/hello-factory.html` keep the DOM
    inspection, XML source handling, and JSON/Zod serialization perspective alive
    for both the ObjectModelBuilderElement and factory builder flows.

## Testing & learning

- Deno suites (notably `natural-web-ua/elements_test.ts`) spin up lightweight
  HTTP servers and pair them with Playwright-driven browsers so the HTML helpers
  can be validated under dynamic server scenarios. These regression tests follow
  the same praxis as the learning resources, keeping both AI maintainers and
  human learners honest.
- Whenever you add behavior, write a server-backed regression test. The mix of
  Deno HTTP servers, Playwright validation, and runnable learning guides keeps
  the tooling resilient and easy to maintain with typed-ish modern JavaScript.
