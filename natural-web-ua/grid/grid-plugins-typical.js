const DEFAULT_ICON_LIBRARY = {
  name: "Font Awesome Free",
  cssUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css",
  classes: {
    sort: "fa-solid fa-sort",
    sortAsc: "fa-solid fa-sort-up",
    sortDesc: "fa-solid fa-sort-down",
    filter: "fa-solid fa-filter",
    paginationPrev: "fa-solid fa-chevron-left",
    paginationNext: "fa-solid fa-chevron-right",
    treeExpand: "fa-solid fa-angle-right",
    treeCollapse: "fa-solid fa-angle-down",
  },
};

const SORT_ICON_SVGS = {
  neutral:
    '<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 4H9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M3 8H7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  asc:
    '<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 7H9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M6 3l2.5 3.5H3.5z" fill="currentColor"/></svg>',
  desc:
    '<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 5H9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M3.5 6.5L6 10l2.5-3.5H3.5z" fill="currentColor"/></svg>',
};

const loadedIconStyles = new Set();
let pluginBaseStylesInjected = false;

function createSortIcon(direction) {
  const key = direction === "asc"
    ? "asc"
    : direction === "desc"
    ? "desc"
    : "neutral";
  const wrapper = document.createElement("span");
  wrapper.className = "grid-sort-icon";
  wrapper.innerHTML = SORT_ICON_SVGS[key] || SORT_ICON_SVGS.neutral;
  return wrapper;
}

const EVENT_FILTERED = "grid:filtered";
const EVENT_SORTED = "grid:sorted";
const EVENT_PAGINATED = "grid:paginated";

function ensureIconLibrary(_api, options = {}) {
  const lib = {
    ...DEFAULT_ICON_LIBRARY,
    ...(options.iconLibrary || {}),
    classes: {
      ...DEFAULT_ICON_LIBRARY.classes,
      ...(options.iconLibrary?.classes || {}),
    },
  };
  if (lib.cssUrl && !loadedIconStyles.has(lib.cssUrl)) {
    if (typeof document !== "undefined") {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = lib.cssUrl;
      document.head.appendChild(link);
    }
    loadedIconStyles.add(lib.cssUrl);
  }
  return lib;
}

function injectPluginBaseStyles(api) {
  if (pluginBaseStylesInjected) return;
  pluginBaseStylesInjected = true;
  api.addStyles(
    `
    .grid-page-size {
      order: 0;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      color: rgba(0, 0, 0, 0.6);
    }
    .grid-page-size select {
      border-radius: 4px;
      border: 1px solid rgba(0, 0, 0, 0.15);
      padding: 4px 10px;
      font-size: 13px;
      background: #fff;
      color: inherit;
      min-width: 64px;
      box-shadow: none;
    }
    .grid-page-size-label {
      font-weight: 500;
      color: rgba(0, 0, 0, 0.55);
      white-space: nowrap;
    }
    .grid-filter-toolbar {
      order: 2;
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .grid-filter-label {
      font-size: 13px;
      font-weight: 600;
      color: rgba(0, 0, 0, 0.55);
    }
    .grid-filter-toolbar input {
      border-radius: 4px;
      border: 1px solid rgba(0, 0, 0, 0.15);
      padding: 6px 10px;
      min-width: 220px;
      background: #fff;
      font-size: 13px;
      color: inherit;
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
    }
    .grid-filter-toolbar input:focus {
      outline: none;
      border-color: rgba(15, 99, 255, 0.85);
      box-shadow: 0 0 0 1px rgba(15, 99, 255, 0.35);
    }
    .grid-sort-header {
      background: transparent;
      border: none;
      padding: 0;
      margin: 0;
      font-weight: 600;
      font-size: 14px;
      color: inherit;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
      text-align: left;
    }
    .grid-sort-header:focus-visible {
      outline: 2px solid rgba(15, 99, 255, 0.45);
      border-radius: 4px;
    }
    .grid-sort-icon {
      width: 16px;
      height: 16px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: rgba(0, 0, 0, 0.4);
    }
    .grid-sort-icon svg {
      width: 12px;
      height: 12px;
      display: block;
    }
    .grid-sort-header[data-sort-direction="asc"] .grid-sort-icon,
    .grid-sort-header[data-sort-direction="desc"] .grid-sort-icon {
      color: #0f62f7;
    }
    .grid-pagination-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      width: 100%;
      flex-wrap: wrap;
    }
    .grid-pagination-footer {
      justify-content: flex-start;
      padding-top: 0;
    }
    .grid-pagination-info {
      font-size: 13px;
      font-weight: 500;
      color: rgba(0, 0, 0, 0.6);
      margin-right: auto;
    }
    .grid-pagination-actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .grid-pagination-actions button {
      border-radius: 4px;
      border: 1px solid rgba(0, 0, 0, 0.18);
      padding: 6px 12px;
      background: #fff;
      color: inherit;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s ease, border-color 0.2s ease;
      min-width: 70px;
      min-height: 36px;
    }
    .grid-pagination-actions button:hover:not(:disabled) {
      background: #f1f5ff;
      border-color: rgba(15, 99, 255, 0.4);
    }
    .grid-pagination-actions button:disabled {
      opacity: 0.45;
      cursor: not-allowed;
      background: #fff;
    }
    .grid-tree-toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
    }
    .grid-tree-toolbar button {
      border-radius: 4px;
      border: 1px solid rgba(0, 0, 0, 0.18);
      background: #f8f9ff;
      padding: 6px 10px;
      cursor: pointer;
      font-size: 13px;
      color: inherit;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .grid-tree-toolbar button i {
      font-size: 0.9em;
    }
  `,
    { id: "natural-grid-plugin-base-styles", priority: -1 },
  );
}

function createFilterPlugin(api, options = {}) {
  injectPluginBaseStyles(api);
  const toolbar = document.createElement("div");
  toolbar.className = "grid-filter-toolbar";
  const label = document.createElement("span");
  label.className = "grid-filter-label";
  label.textContent = options.label || "Search:";
  toolbar.appendChild(label);

  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = options.placeholder || "Filter rows";
  input.addEventListener("input", () => applyFilters(input.value));
  toolbar.appendChild(input);

  api.addToolbarItem(toolbar);

  let baseRows = [];

  const normalizeRow = (row) => {
    const cells = row?.cells || {};
    return Object.values(cells).map((value) => {
      if (value == null) return "";
      if (typeof value === "object") return JSON.stringify(value);
      return String(value);
    }).join(" ").toLowerCase();
  };

  const applyFilters = (term = input.value || "") => {
    const needle = term.trim().toLowerCase();
    const filtered = needle
      ? baseRows.filter((row) => normalizeRow(row).includes(needle))
      : [...baseRows];
    api.setRows(filtered);
    api.emit(EVENT_FILTERED, { rows: filtered, rawRows: baseRows });
    api.requestRender();
    return filtered;
  };

  const refreshBase = () => {
    baseRows = Array.isArray(api.getModel().rows)
      ? [...api.getModel().rows]
      : [];
    applyFilters();
  };

  const unsubData = api.on("data", refreshBase);
  refreshBase();

  return () => {
    unsubData();
    toolbar.remove();
  };
}

function createSortPlugin(api, _options = {}) {
  injectPluginBaseStyles(api);
  let sortState = [];
  let filteredRows = [];

  const getDirection = (key) => sortState.find((s) => s.key === key)?.direction;

  const compareValues = (a, b) => {
    if (a === b) return 0;
    if (a == null) return -1;
    if (b == null) return 1;
    if (typeof a === "number" && typeof b === "number") return a - b;
    return String(a).localeCompare(String(b), undefined, { numeric: true });
  };

  const getBaseRows = () => {
    return Array.isArray(filteredRows) ? filteredRows : [];
  };

  const sortRows = (rows) => {
    const sorted = [...rows].sort((a, b) => {
      for (const entry of sortState) {
        const delta = compareValues(
          a?.cells?.[entry.key],
          b?.cells?.[entry.key],
        );
        if (delta !== 0) {
          return entry.direction === "asc" ? delta : -delta;
        }
      }
      return 0;
    });
    return sorted;
  };

  const applySort = () => {
    const base = getBaseRows();
    const rowsToRender = sortState.length ? sortRows(base) : base;
    api.setRows(rowsToRender);
    api.emit(EVENT_SORTED, { rows: rowsToRender, sourceRows: base });
    api.requestRender();
    return rowsToRender;
  };

  const toggleSort = (columnKey, multi) => {
    const next = sortState.filter((entry) => entry.key !== columnKey);
    const current = sortState.find((entry) => entry.key === columnKey);
    const nextDirection = !current
      ? "asc"
      : current.direction === "asc"
      ? "desc"
      : null;
    if (!multi) next.length = 0;
    if (nextDirection) {
      next.unshift({ key: columnKey, direction: nextDirection });
    }
    sortState = next;
    applySort();
  };

  const createHeader = (column) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "grid-sort-header";
    button.addEventListener("click", (ev) => {
      toggleSort(column.key, ev.shiftKey);
    });
    const direction = getDirection(column.key);
    const icon = createSortIcon(direction);
    const label = document.createElement("span");
    label.textContent = column.title;
    button.append(label, icon);
    if (direction) {
      button.dataset.sortDirection = direction;
    } else {
      button.removeAttribute("data-sort-direction");
    }
    return button;
  };

  const cfgColumns = api.getConfig()?.columns || [];
  for (const column of cfgColumns) {
    api.setHeaderRenderer(column.key, () => createHeader(column));
  }

  const onFiltered = (detail) => {
    filteredRows = Array.isArray(detail.rows) ? [...detail.rows] : [];
    applySort();
  };

  const onDataSnapshot = (detail) => {
    if (Array.isArray(detail?.payload?.rows)) {
      filteredRows = [...detail.payload.rows];
    } else if (Array.isArray(api.getModel().rows)) {
      filteredRows = [...api.getModel().rows];
    }
    applySort();
  };

  const unsubFiltered = api.on(EVENT_FILTERED, onFiltered);
  const unsubData = api.on("data", onDataSnapshot);

  onDataSnapshot({ payload: { rows: api.getModel().rows } });

  return () => {
    unsubFiltered();
    unsubData();
  };
}

function createPaginationPlugin(api, options = {}) {
  const initialPageSize = Math.max(1, Number(options.pageSize ?? 10));
  injectPluginBaseStyles(api);
  const manualMode = options.mode === "manual";
  let currentPage = 0;
  let sourceRows = [];
  let totalRowsCount = 0;
  let currentPageSize = initialPageSize;
  const infoSuffix = options.infoSuffix || "entries";

  const topToolbar = document.createElement("div");
  topToolbar.className = "grid-page-size";
  const select = document.createElement("select");
  const selectId = `grid-page-size-${Math.random().toString(36).slice(2)}`;
  select.id = selectId;
  const sizes = Array.isArray(options.pageSizes)
    ? options.pageSizes.map((n) => Number(n)).filter((n) =>
      Number.isFinite(n) && n > 0
    )
    : [];
  const normalizedSizes = sizes.length ? Array.from(new Set(sizes)) : [];
  if (!normalizedSizes.length) normalizedSizes.push(initialPageSize);
  if (!normalizedSizes.includes(initialPageSize)) {
    normalizedSizes.push(initialPageSize);
  }
  normalizedSizes.forEach((n) => {
    const opt = document.createElement("option");
    opt.value = String(n);
    opt.textContent = String(n);
    select.appendChild(opt);
  });
  currentPageSize = normalizedSizes.includes(initialPageSize)
    ? initialPageSize
    : normalizedSizes[0];
  select.value = String(currentPageSize);
  const label = document.createElement("label");
  label.className = "grid-page-size-label";
  label.setAttribute("for", selectId);
  label.textContent = options.pageSizeLabel || "entries per page";
  topToolbar.append(select, label);
  api.addToolbarItem(topToolbar);

  const footer = document.createElement("div");
  footer.className = "grid-pagination-toolbar grid-pagination-footer";
  const info = document.createElement("span");
  info.className = "grid-pagination-info";
  const prev = document.createElement("button");
  prev.type = "button";
  prev.textContent = options.prevText || "Prev";
  const next = document.createElement("button");
  next.type = "button";
  next.textContent = options.nextText || "Next";
  const actions = document.createElement("div");
  actions.className = "grid-pagination-actions";
  actions.append(prev, next);
  footer.append(info, actions);
  api.addFooterItem(() => footer);

  const clampPage = () => {
    if (!totalRowsCount || !currentPageSize) {
      currentPage = 0;
      return;
    }
    const totalPages = Math.max(1, Math.ceil(totalRowsCount / currentPageSize));
    if (currentPage >= totalPages) {
      currentPage = totalPages - 1;
    }
  };

  select.addEventListener("change", () => {
    const nextSize = Number(select.value);
    if (!Number.isFinite(nextSize) || nextSize <= 0) return;
    currentPageSize = nextSize;
    currentPage = 0;
    clampPage();
    applyPagination();
  });

  const setSourceRows = (list) => {
    sourceRows = Array.isArray(list) ? [...list] : [];
    totalRowsCount = sourceRows.length;
    clampPage();
  };

  const refreshButtons = () => {
    const totalRows = totalRowsCount;
    const totalPages = Math.max(1, Math.ceil(totalRows / currentPageSize));
    prev.disabled = currentPage <= 0;
    next.disabled = currentPage >= totalPages - 1;
    const start = totalRows ? currentPage * currentPageSize + 1 : 0;
    const end = Math.min(totalRows, (currentPage + 1) * currentPageSize);
    info.textContent = totalRows
      ? `${
        options.infoPrefix || "Showing"
      } ${start} to ${end} of ${totalRows} ${infoSuffix}`
      : options.emptyText || "No rows";
  };

  const applyPagination = () => {
    refreshButtons();
    if (manualMode) {
      api.emit(EVENT_PAGINATED, {
        rows: sourceRows,
        pageIndex: currentPage,
        pageSize: currentPageSize,
        totalRows: totalRowsCount,
        manual: true,
      });
      api.requestRender();
      return;
    }
    const start = currentPage * currentPageSize;
    const pageRows = sourceRows.slice(start, start + currentPageSize);
    api.setRows(pageRows);
    api.emit(EVENT_PAGINATED, {
      rows: pageRows,
      pageIndex: currentPage,
      pageSize: currentPageSize,
      totalRows: totalRowsCount,
    });
    api.requestRender();
  };

  prev.addEventListener("click", () => {
    if (currentPage > 0) {
      currentPage -= 1;
      applyPagination();
    }
  });

  next.addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil(totalRowsCount / currentPageSize));
    if (currentPage < totalPages - 1) {
      currentPage += 1;
      applyPagination();
    }
  });

  const resolveDetailRows = (detail) => {
    if (!detail) return [];
    if (Array.isArray(detail.rows) && detail.rows.length) {
      return detail.rows;
    }
    if (Array.isArray(detail.sourceRows) && detail.sourceRows.length) {
      return detail.sourceRows;
    }
    return [];
  };

  const onSorted = (detail) => {
    const next = resolveDetailRows(detail);
    setSourceRows(next);
    currentPage = 0;
    applyPagination();
  };

  const onFiltered = (detail) => {
    const next = Array.isArray(detail.rows) ? detail.rows : [];
    setSourceRows(next);
    currentPage = 0;
    applyPagination();
  };

  const onDataSnapshot = (detail) => {
    const payloadRows = detail?.payload?.rows;
    const next = Array.isArray(payloadRows)
      ? payloadRows
      : Array.isArray(api.getModel().rows)
      ? api.getModel().rows
      : [];
    setSourceRows(next);
    currentPage = 0;
    applyPagination();
  };

  const unsub = api.on(EVENT_SORTED, onSorted);
  const unsubData = api.on("data", onDataSnapshot);
  const unsubFiltered = api.on(EVENT_FILTERED, onFiltered);
  onDataSnapshot({ payload: { rows: api.getModel().rows } });
  onSorted({ rows: api.getModel().rows });

  return () => {
    unsub();
    unsubFiltered();
    unsubData();
    topToolbar.remove();
    footer.remove();
  };
}
function createTreePlugin(api, options = {}) {
  const iconLibrary = ensureIconLibrary(api, options);
  injectPluginBaseStyles(api);
  const expanded = new Set((options.initiallyExpanded || []).map(String));
  const lazyName =
    typeof options.lazyLoadFn === "string" && options.lazyLoadFn.trim()
      ? options.lazyLoadFn.trim()
      : null;
  const lazyLoader = typeof options.lazyLoad === "function"
    ? options.lazyLoad
    : lazyName && typeof globalThis[lazyName] === "function"
    ? globalThis[lazyName]
    : null;
  const autoExpandDepth = Math.max(
    0,
    Number(options.autoExpandDepth ?? 1),
  );
  const gatherAutoExpandIds = (list, level = 0, out = []) => {
    if (!list || !list.length) return out;
    for (const row of list) {
      if (!row || !row.id) continue;
      out.push(String(row.id));
      if (
        autoExpandDepth > 0 &&
        level < autoExpandDepth &&
        Array.isArray(row.children)
      ) {
        gatherAutoExpandIds(row.children, level + 1, out);
      }
    }
    return out;
  };

  const gatherIds = (list, out = []) => {
    for (const row of list || []) {
      if (!row || !row.id) continue;
      out.push(String(row.id));
      if (row.children) gatherIds(row.children, out);
    }
    return out;
  };

  const ensureRow = (id, list) => {
    for (const row of list || []) {
      if (String(row.id) === id) return row;
      const match = ensureRow(id, row.children);
      if (match) return match;
    }
    return null;
  };

  const toolbar = document.createElement("div");
  toolbar.className = "grid-tree-toolbar";
  if (options.toolbar !== false) {
    const expandAll = document.createElement("button");
    expandAll.type = "button";
    expandAll.textContent = options.expandAllText || "Expand all";
    const collapseAll = document.createElement("button");
    collapseAll.type = "button";
    collapseAll.textContent = options.collapseAllText || "Collapse all";
    const expandIcon = document.createElement("i");
    expandIcon.className = iconLibrary.classes.treeExpand || "";
    const collapseIcon = document.createElement("i");
    collapseIcon.className = iconLibrary.classes.treeCollapse || "";
    expandAll.prepend(expandIcon);
    collapseAll.prepend(collapseIcon);
    toolbar.append(expandAll, collapseAll);
    api.addToolbarItem(toolbar);
    expandAll.addEventListener("click", () => {
      api.setTreeExpansion(gatherIds(api.getModel().rows));
      api.requestRender();
    });
    collapseAll.addEventListener("click", () => {
      api.setTreeExpansion([]);
      api.requestRender();
    });
  }

  if (expanded.size) {
    api.setTreeExpansion([...expanded]);
  }

  const toggleRow = async (id) => {
    api.updateTreeExpansion((next) => {
      if (next.has(id)) next.delete(id);
      else next.add(id);
    });
    const row = ensureRow(id, api.getModel().rows);
    if (row && lazyLoader && (!row.children || !row.children.length)) {
      try {
        const children = await lazyLoader(row);
        row.children = Array.isArray(children) ? children : [];
      } catch (_) {
        // ignore lazy-load errors
      }
    }
    api.requestRender();
  };

  const handleClick = (event) => {
    const button = event.target.closest(".expander");
    if (!button) return;
    const rowId = button.closest("tr")?.getAttribute("data-row-id");
    if (rowId) toggleRow(rowId);
  };

  const ensureAutoExpand = (rows) => {
    if (!autoExpandDepth || !Array.isArray(rows) || !rows.length) {
      return false;
    }
    const ids = gatherAutoExpandIds(rows);
    if (!ids.length) return false;
    let mutated = false;
    for (const id of ids) {
      if (!expanded.has(id)) {
        expanded.add(id);
        mutated = true;
      }
    }
    if (mutated) {
      api.setTreeExpansion([...expanded]);
    }
    return mutated;
  };

  const handleData = (detail) => {
    const rows = Array.isArray(detail?.payload?.rows)
      ? detail.payload.rows
      : Array.isArray(api.getModel().rows)
      ? api.getModel().rows
      : [];
    if (ensureAutoExpand(rows)) {
      api.requestRender();
    }
  };

  const root = api.host.shadowRoot;
  if (root) {
    root.addEventListener("click", handleClick);
  }
  const unsubData = api.on("data", handleData);
  handleData({ payload: { rows: api.getModel().rows } });

  return () => {
    if (root) root.removeEventListener("click", handleClick);
    unsubData();
    toolbar.remove();
  };
}

const pluginBuilders = {
  filter: createFilterPlugin,
  sort: createSortPlugin,
  pagination: createPaginationPlugin,
  tree: createTreePlugin,
};

export const typicalPluginKinds = Object.keys(pluginBuilders);

export default function typicalPluginFactory(api, options = {}) {
  const kind = String(options.kind || "sort").trim();
  const builder = pluginBuilders[kind];
  if (!builder) {
    console.warn("natural-grid: unknown typical plugin kind", kind);
    return;
  }
  return builder(api, options);
}
