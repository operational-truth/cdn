# Natural Web Browser User Agent (`web-ua`) Components

This directory collects the browser-native helpers, custom elements, and
learning aids that make up the Natural Web UA platform.

## Strategy

- **Lean by default.** Start with semantic HTML and only layer in helpers when
  you need deterministic composition, UA dependency emission, or synthetic
  rendering pipelines (`natural-web-ua/elements.js`).
- **Progressive enhancement.** Each component either upgrades existing markup
  (grid/table upgrades, Markdown blocks) or augments a declarative description
  (XDM) with richer behavior without invalidating the original DOM.
- **Learning-led delivery.** Every module ships with runnable guides and
  fixtures under `support/learn/natural-web-ua/...` so you can follow the exact
  strategy used in production before copying it into your own page.

## Philosophy

- Treat markup as a declarative expression of intent: the Natural HTML helpers
  keep attribute ordering, class/style helpers, and raw/text escape hatches
  transparent so you can reason about the DOM without hidden parsing.
- Keep the custom elements small and observable: Markdown emits
  `rendered`/`error` events, Grid exposes a plugin API and event bus, and XDM
  exposes both a factory and a Web Component so you can inspect, log, and
  validate the parsed model at runtime.
- Favor deterministic tooling for maintenance: plugin CSS is minted through
  ordered stylesheets, virtualization keeps the DOM shallow, and tests
  (`natural-web-ua/elements_test.ts`) prove that helpers like
  `javaScript`/`collectStyleAttributeCss` behave consistently across browsers.

## Modules

### Natural (functional) HTML

`natural-web-ua/elements.js` exports every HTML tag as a function plus helpers
such as `attrs()`, `classNames()`, `each()`, `styleText()`, and the UA
dependency toolkit (`uaDep*`, `browserUserAgentHeadTags`). It flattens `Child`
inputs safely, enforces void-element contracts, and makes raw insertion opt-in
via `trustedRaw()`/`raw()` with a `dev-strict` policy toggle. Style attribute
extraction (`collectStyleAttributeCss`/`emitStyleAttributeCss`) lets you lift
inline `style=""` blocks into predictable CSS rules for head injection or UA
dependency bundles. The Deno tests in `natural-web-ua/elements_test.ts` run the
fixture at `elements_test.html` through Playwright, asserting functionality such
as `render()` trusting string snippets, literal script bodies via `javaScript`,
`raw()` policy enforcement, and UA dependency/style extraction behavior.

### Markdown Custom Element

`natural-web-ua/markdown/markdown.js` defines `<markdown-html>` (configurable
via `style-prefix`, `styled`, `code-meta`, `no-shadow`, `no-auto`, etc.). It
builds a pipeline with `remark`/`rehype`, preserves fenced-code metadata for
CLI-style badges, rewrites relative URLs, hardens `href` targets, and lazily
loads highlight.js, Mermaid, and KaTeX. Content is rendered offscreen and
swapped atomically to prevent FOUC, and structural post-processing adds
deterministic CSS, heading ids, and optional templates/body classes before
firing `rendered`/`markdown-rendered` events so consumers can react to the final
output.

### Grid Web Custom Element

`natural-web-ua/grid/grid.js` powers `<natural-grid>`. It resolves configuration
from inline JSON, external tables, factories, and legacy table markup, then
builds a mutable model (`columns`, `rows`, `sort`, `filters`, `status/error`).
Data provider plugins (`static`, `fetch`, `sse`, or user-registered ones) join a
deterministic presentation/content/functionality pipeline. Styling is injected
via constructable stylesheets plus plugin CSS, and virtualization keeps large
data sets snappy. `grid-plugins-typical.js` ships toolbar/footer helpers
(filter, sort, pagination, tree expansion) that hook into the plugin API, emit
events (`grid:filtered`, `grid:sorted`, `grid:paginated`), and keep icon/fonts
consistent. Consumers can plug in new renderers, toolbar items, or providers
without changing the core.

### Extensible Data Model (XDM)

`natural-web-ua/xdm/omb.js` builds layered object models from DOM/XML, exposing
`.tag` (physical), `.children` (structural), and typed getters (`integer`,
`boolean`, etc.). You can enforce schema logic with `omb:type`, ad-hoc
expressions via `omb:type-as`, `omb:schema` helpers, and
`ObjectModelBuilderElement` options (custom typedValue, ignoring elements/text,
custom element factories). `omb-zod.js` derives Zod schemas from models so you
can reuse the parsed structure for validation or diagnostics, and the learning
fixtures under `support/learn/natural-web-ua/xdm/*` show both the custom element
(`hello-ce.html`) and the factory (`hello-factory.html`) pathways.

## Learning resources (working examples)

- `support/learn/natural-web-ua/elements/index.html` — start with plain HTML,
  insert `natural-web-ua/elements.js`, and step through helpers (`each`,
  `classNames`, `styleText`, `browserUserAgentHeadTags`).
- `support/learn/natural-web-ua/markdown/index.html` — demo the Markdown
  element’s templates, styling options, CLI meta headers, manual rendering,
  event logging, and integrations (highlight.js, Mermaid, KaTeX).
- `support/learn/natural-web-ua/grid/index.html` — tabbed walkthrough of
  HTML-first upgrades, config/theme overrides, plugin packs (filter, sort,
  pagination, tree), and how virtualization/tree behavior behave.
- `support/learn/natural-web-ua/xdm/index.html`, `hello-ce.html`,
  `hello-factory.html` — interactive playground showing live DOM inspection, XML
  source handling, rebuild UX, and JSON/Zod output for both the custom element
  and factory builder flows.
