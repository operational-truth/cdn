TODO:

- [ ] add playwright tests to validate custom element
- [ ] resizable columns with cookies to remember by URL, params, ID
- [ ] cookies should remember sort setting
- [ ] per column sorting like in DataTable

---

Most common grid features (as seen across AG Grid, DataTables, TanStack Table,
Handsontable, and the usual “serious grid” ecosystem) cluster into a pretty
repeatable set. You can treat these as plugin-pack candidates and keep core
extremely small.

Typical grid pack (what almost everyone expects)

1. Sorting (single, multi-column). Often type-aware.
2. Filtering: column filters + global search, plus “fuzzy search” as a nicer
   upgrade.
3. Pagination (client and server/manual).
4. Column controls: visibility toggles, reordering, resizing, pinning/sticky.
   (DataTables does this via extensions; TanStack has dedicated features.)

5. Row selection (single/multi), including “select all visible” patterns.

6. Virtualization for large row counts and/or many columns (performance becomes
   table-stakes once you claim “grid”).
7. Export: CSV is “typical”, Excel tends to be “enterprise”.
8. Responsive behavior: collapsing columns or switching to a “row details”
   presentation on small screens.
9. Fixed header/footer and scrolling.

Enterprise grid pack (things that usually justify paid tiers or heavier
engineering)

1. Grouping, aggregation, subtotals, group expand/collapse (and group-aware
   sort/filter).
2. Pivoting (and pivot-aware aggregation). (AG Grid puts this in the “big grid”
   category.)
3. Multiple row models / server-side data model integration patterns
   (client-side vs server-side/infinite).
4. Master-detail rows (row expansion showing nested grids or detail panes). ([AG
   Grid][7])
5. Advanced export: Excel export with fidelity and options like “export selected
   rows”, preserving sort/filter/visibility state.
6. Advanced editing: rich editors, validation, copy/paste, clipboard, fill
   handle, undo/redo. (Handsontable lives here.)
7. Spreadsheet-like capabilities: formulas/calculation engines.

8. Row/column pinning, row pinning, “row details” panels, and stateful UI
   customization.
9. Column faceting and analytics-style helpers (facets, counts, quick filters).

A clean plugin-pack plan for your architecture “Typical Pack”

- sort (client-side, multi-sort)
- filter (global + per-column basic)
- pagination (client + “manual” server mode)
- column tools (visibility toggle + resizing; reordering optional)
- selection
- virtualization (rows first; columns later)
- csv export
- responsive + fixed header (either in one “layout” plugin or separate)

“Enterprise Pack”

- grouping + aggregations
- pivot mode
- server-side row model adapters (cursor/infinite, and “server-side grouping”
  later)
- master-detail
- excel export
- advanced editing + validation + clipboard
- formulas (optional separate “spreadsheet pack”)

Tree/hierarchical data: core vs plugin You already have a simple tree flatten +
indentation and an expander glyph. That’s fine to keep in core if you define
“tree support” as: render nested children with indent, and allow
expand/collapse. It’s also aligned with what many grids treat as a first-class
display mode (tree data and master/detail coexist in enterprise grids).

Up next for AI maintenance:

- Keep hierarchical rendering in core (because it’s mostly a render concern and
  your data model already supports children).
- Make “tree behavior” a grid-functionality plugin: expand/collapse state, click
  handlers, “expand all/collapse all” toolbar items, optional lazy-loading of
  children (which becomes content-supplier integration). That split keeps core
  small but ensures trees feel fully featured without hardwiring interactions
  into the base renderer.

So: core handles nested rows structurally; plugins handle interaction, state
management, and advanced tree features (keyboard nav, lazy child fetch, tree
filtering semantics, “show only matches with ancestors”, etc.).
