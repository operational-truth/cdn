/**
 * @module omb
 *
 * Object Model Builder (OMB)
 *
 * A small Web Components-driven parser that walks an element’s DOM subtree and
 * constructs a JS object model (“builder tree”) that mirrors the markup.
 *
 * Public API:
 * - createOmbBuilder(options?) -> OmbBuilder
 * - OmbBuilder.buildFromDomRoot(rootEl, { host? }?)
 * - OmbBuilder.buildFromHostElement(hostEl) (respects omb:src on host)
 * - OmbBuilder.buildFromXmlSrc(src, { host? }?)
 * - OmbBuilder.buildFromXmlString(xml, { host? }?)
 *
 * Goals
 * 1) Preserve the physical tag details and raw strings under node[".tag"].
 * 2) Expose typed-ish attribute properties directly on each node using camelCase keys.
 * 3) Allow auto-typing for default attribute getters (numbers/booleans/null) while
 *    preserving raw attribute strings in node[".tag"].attrs.
 * 4) Support “child element as attribute” mode where leaf child elements like
 *    <test-boolean>yes</test-boolean> are treated as attributes on the parent,
 *    not structural children.
 * 5) Support schema instructions via <omb:schema>:
 *    - <omb:schema> is ignored structurally (does not contribute to content/children).
 *    - <omb:schema type="my-name">/* javascript *\/</omb:schema> registers a named
 *      OmbTypedValueFn for use by omb:type="my-name".
 *    - The JavaScript content must evaluate to a function (complete function signature + body),
 *      e.g.:
 *        <omb:schema type="my-name">
 *          (raw, tag, parents) => raw.trim().toUpperCase()
 *        </omb:schema>
 *      or:
 *        <omb:schema type="my-name">
 *          function (raw, tag, parents) { return raw.trim().toUpperCase(); }
 *        </omb:schema>
 *
 * External XML source input (omb:src)
 * - Host-only attribute: omb:src="..."
 * - If present, OMB fetches and parses XML, then builds the model from the XML documentElement
 *   (instead of the custom element’s live DOM subtree).
 * - omb:src is NOT stored in node[".tag"].attrs and is not exposed as a normal attribute property.
 * - omb:src can be:
 *    - a relative path beginning with "./" or "../" (resolved against document.baseURI by default), or
 *    - any URL fetch() can acquire (subject to CORS), or
 *    - a URL resolved by an optional host resolver callback (options.resolveSrcUrl).
 * - Parsing uses DOMParser("application/xml"). If parsing fails, rebuild dispatches "omb:error".
 * - When omb:src is absent, behavior is unchanged: OMB walks the custom element’s DOM subtree.
 *
 * Events
 * - "omb:built" fires after a successful build: detail: { model }
 * - "omb:error" fires if fetch/parse/build fails (e.g., network, non-OK status, XML parse error):
 *   detail: { error }
 *
 * omb:type (safer, named typing)
 * - Special attribute: omb:type="name"
 * - Not stored in node[".tag"].attrs and not exposed as a normal attribute property.
 * - Instructs OMB to type an element’s leaf text value via a named typed-value function.
 * - Raw leaf string is always preserved at node[".tag"].rawValue.
 * - Typed output is stored at node[".tag"].value.
 * - If an element is treated as a parent attribute (child-element-as-attribute),
 *   the parent’s node[".tag"].attrs[key] ALWAYS stores the raw leaf string, even
 *   when the child had omb:type.
 *
 * omb:type-as (flexible, less safe)
 * - Special attribute: omb:type-as="EXPR"
 * - Treated as an inline typed-value expression and evaluated at runtime.
 * - Expression is executed as: return (EXPR)
 * - Variables available inside EXPR:
 *    - raw: the raw leaf string (untrimmed original leaf aggregation, then trimmed for leaf finalize)
 *    - tag: the OmbTag for that element
 *    - parents: OmbTag[] from root to the element (inclusive)
 *    - z: the imported Zod module (zod@4.x)
 *    - splitCsv: helper (comma-separated -> string[])
 * - Precedence: if both omb:type and omb:type-as exist, omb:type wins.
 * - Security note: omb:type-as executes arbitrary JavaScript. Only use with trusted markup.
 *
 * Example (equivalent intent):
 *   <test-string-array omb:type="text-list-safe">item1, item2, item3</test-string-array>
 *   <test-string-array omb:type-as="z.string().transform(splitCsv).safeParse(raw)">item1, item2, item3</test-string-array>
 *
 * Node JSON shape (conceptual)
 * {
 *   ".tag": {
 *     "tagName": "nested11",
 *     "tagToken": "nested11",
 *     "attrs": { "integer": "11", "text": "TestText11" }, // raw strings (never typed)
 *     "content": [],                                       // raw PCDATA segments
 *     "rawValue": "...",                                   // leaf value as raw string
 *     "value": "..."                                       // leaf/simple value (typed if omb:type or omb:type-as)
 *   },
 *   ".children": [ ... ],
 *   "integer": 11,          // typed getter (default: auto-typed from raw string)
 *   "text": "TestText11"    // typed getter (default: string)
 * }
 *
 * Using in HTML
 * <script type="module">
 *   import { ObjectModelBuilderElement, OmbNode } from "./omb.js";
 *
 *   class MyElement extends ObjectModelBuilderElement {
 *     constructor() {
 *       super({
 *         // optional: custom global typing
 *         typedValue: (raw, tag, parents) => raw.trim().toLowerCase() === "yes" ? true : raw,
 *
 *         // optional: provide named typings (omb:type)
 *         typedValueByName: (name) => defaultTypedValues()[name],
 *
 *         // optional: override how omb:src is resolved to a URL
 *         // resolveSrcUrl: (src, host) => new URL(src, import.meta.url).toString(),
 *       });
 *     }
 *   }
 *   customElements.define("my-element", MyElement);
 *
 *   const el = document.querySelector("my-element");
 *   el.addEventListener("omb:built", (e) => {
 *     console.log("model:", e.detail.model);
 *     console.log("json:", JSON.stringify(e.detail.model, null, 2));
 *   });
 *   el.addEventListener("omb:error", (e) => {
 *     console.error("OMB error:", e.detail.error);
 *   });
 * </script>
 */

// deno-lint-ignore no-import-prefix
import * as z from "https://esm.sh/zod@4.3.6";

const OMB_NS = "http://www.netspective.com/labs/agentx";

/**
 * Convert kebab-case (and namespace-ish names like xdm:include) to camelCase.
 * @param {string} input
 * @returns {string}
 */
export function toCamelCaseIdentifier(input) {
  const normalized = String(input).replace(/[:]/g, "-");
  const parts = normalized.split(/[^A-Za-z0-9]+/g).filter(Boolean);
  if (parts.length === 0) return "x";
  const [first, ...rest] = parts;
  return first.toLowerCase() +
    rest.map((p) => upperFirst(p.toLowerCase())).join("");
}

function upperFirst(s) {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

/**
 * Return the tag text as it appears logically in markup:
 * - HTML documents: uses localName (lowercase), not tagName (often uppercase)
 * - Namespaced elements: prefix:localName if prefix exists
 * @param {Element} el
 * @returns {string}
 */
export function domTagText(el) {
  const prefix = el.prefix;
  const local = el.localName ?? el.tagName;
  return prefix ? `${prefix}:${local}` : local;
}

/**
 * Build add<Element>() name for a tag.
 * @param {string} tagName
 * @returns {string}
 */
export function addMethodName(tagName) {
  const token = toCamelCaseIdentifier(tagName);
  return "add" + upperFirst(token);
}

/**
 * Split comma-separated text into trimmed, non-empty parts.
 * Exported so omb:type-as expressions can reference it.
 * @param {string} raw
 * @returns {string[]}
 */
export function splitCsv(raw) {
  return String(raw).split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * True if el is an <omb:schema> element (namespace aware).
 * @param {Element} el
 * @returns {boolean}
 */
function isOmbSchemaElement(el) {
  const local = String(el.localName ?? el.tagName).toLowerCase();
  const ns = el.namespaceURI ?? null;

  if (ns === OMB_NS && local === "schema") return true;

  // fallback
  return String(domTagText(el)).toLowerCase() === "omb:schema";
}

/**
 * Namespace-aware lookup for OMB special attributes.
 * @param {Element} el
 * @param {"type"|"type-as"|"src"} local
 * @returns {string | null}
 */
function getOmbAttr(el, local) {
  const nsVal = el.getAttributeNS?.(OMB_NS, local);
  if (nsVal != null) return nsVal;
  return el.getAttribute?.(`omb:${local}`);
}

/**
 * Robust checks for OMB attributes in XML/HTML DOMs.
 * @param {Attr} attr
 * @returns {boolean}
 */
function isOmbAttrType(attr) {
  return (
    (attr.namespaceURI === OMB_NS && attr.localName === "type") ||
    (attr.prefix === "omb" && attr.localName === "type") ||
    attr.name === "omb:type"
  );
}
function isOmbAttrTypeAs(attr) {
  return (
    (attr.namespaceURI === OMB_NS && attr.localName === "type-as") ||
    (attr.prefix === "omb" && attr.localName === "type-as") ||
    attr.name === "omb:type-as"
  );
}
function isOmbAttrSrc(attr) {
  return (
    (attr.namespaceURI === OMB_NS && attr.localName === "src") ||
    (attr.prefix === "omb" && attr.localName === "src") ||
    attr.name === "omb:src"
  );
}

/**
 * @typedef {Object} OmbTextContext
 * @property {Element} host
 * @property {Element} domParent
 * @property {OmbNode} modelParent
 * @property {boolean} isRootText
 */

/**
 * A node constructor used by OMB.
 * @typedef {new (tagName: string) => OmbNode} OmbNodeConstructor
 */

/**
 * A typed-value function.
 * @typedef {(raw: string, tag: OmbTag, parents: OmbTag[]) => unknown} OmbTypedValueFn
 */

/**
 * @typedef {Object} ObjectModelBuilderElementOptions
 * @property {boolean=} ignoreWhitespaceText Defaults to true
 * @property {boolean=} ignoreComments Defaults to true
 * @property {(el: Element) => boolean=} ignoreElement If true, subtree is skipped
 *
 * Called when a new tag class is needed for a DOM element.
 * Return:
 * - false to let OMB generate a class for this tag (default)
 * - a constructor to use that class for this tag
 *
 * @property {(tagName: string, el: Element) => (false | OmbNodeConstructor)=} createElement
 *
 * Called by default attribute getters (unless overridden) to convert raw string
 * values from .tag.attrs[key] into a typed value (number/boolean/null/etc).
 * If not provided, defaultTypedValue() is used.
 *
 * @property {OmbTypedValueFn=} typedValue
 *
 * Lookup a named typedValue function by name (for omb:type).
 * Return a typedValue function or null/undefined.
 *
 * @property {(name: string) => (OmbTypedValueFn | null | undefined)=} typedValueByName
 *
 * Decide whether a child element should be treated as an “attribute element” of
 * its parent rather than as a structural child node.
 *
 * If true:
 * - The child is NOT appended to parent[".children"]
 * - The child tag’s token becomes the parent attribute key
 * - The child’s raw leaf value becomes the parent raw attribute string
 * - Typed leaf value (via omb:type or omb:type-as) is available from the parent property getter
 * - Raw is stored in parent[".tag"].attrs[key] (always the raw string)
 *
 * parents is an array of parent tags from root to the immediate parent (inclusive),
 * useful for context-aware decisions.
 *
 * @property {(childTag: OmbTag, parents: OmbTag[]) => boolean=} isChildElemAttr
 *
 * Optional: resolve a URL for omb:src (defaults to new URL(src, document.baseURI)).
 * @property {(src: string, host: Element) => string=} resolveSrcUrl
 */

/**
 * Named typed-values shipped by default (for omb:type).
 * @returns {Record<string, OmbTypedValueFn>}
 */
export function defaultTypedValues() {
  return {
    "text-list": (raw, _tag, _parents) => {
      const r = z.string().transform(splitCsv).safeParse(raw);
      return r.success ? r.data : undefined;
    },

    "text-list-safe": (raw, _tag, _parents) => {
      return z.string().transform(splitCsv).safeParse(raw);
    },
  };
}

/**
 * Default auto-typing for attribute values.
 * Heuristics (in order):
 * - trimmed empty => "" (keep empty as raw)
 * - "null"/"nil"/"none"/"undefined" => null
 * - boolean-ish: true/false/yes/no/on/off/1/0 => boolean
 * - integer => number (only if safe integer)
 * - float/scientific => number
 * - otherwise => original string
 *
 * @param {string} raw
 * @param {OmbTag} tag
 * @param {OmbTag[]} parents
 * @returns {unknown}
 */
export function defaultTypedValue(raw, _tag, _parents) {
  const s = String(raw);
  const t = s.trim();

  if (t.length === 0) return s;

  const lower = t.toLowerCase();
  if (
    lower === "null" || lower === "nil" || lower === "none" ||
    lower === "undefined"
  ) {
    return null;
  }

  if (lower === "true" || lower === "yes" || lower === "on" || lower === "1") {
    return true;
  }
  if (lower === "false" || lower === "no" || lower === "off" || lower === "0") {
    return false;
  }

  if (/^[+-]?\d+$/.test(t)) {
    const n = Number(t);
    return Number.isSafeInteger(n) ? n : t;
  }

  if (/^[+-]?(?:\d+\.\d*|\d*\.\d+|\d+)(?:[eE][+-]?\d+)?$/.test(t)) {
    const n = Number(t);
    if (Number.isFinite(n)) return n;
  }

  return s;
}

/**
 * Default rule for child-element-as-attribute:
 * returns true iff the element is “simple”:
 * - no attributes (excluding omb:type and omb:type-as), and
 * - has some non-whitespace leaf text content, and
 * - has no element children
 *
 * Note: uses childNode[".tag"].rawValue so typed leaf values don't affect the rule.
 *
 * @param {OmbNode} childNode
 * @param {OmbTag[]} parents
 * @returns {boolean}
 */
export function defaultIsChildElemAttr(childNode, _parents) {
  const tag = childNode[".tag"];
  const hasAttrs = Object.keys(tag.attrs).length > 0;
  if (hasAttrs) return false;

  if (childNode[".children"].length > 0) return false;

  const v = tag.rawValue;
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Tag metadata container placed at node[".tag"].
 * Holds ONLY raw physical info, raw attrs, raw content, and leaf raw/typed values.
 */
export class OmbTag {
  /**
   * @param {string} tagName
   */
  constructor(tagName) {
    /** @readonly */ this.tagName = tagName;
    /** @readonly */ this.tagToken = toCamelCaseIdentifier(tagName);

    /** @type {Record<string, string>} */
    this.attrs = Object.create(null);

    /** @type {string[]} */
    this.content = [];

    /**
     * Optional omb:type value (special attribute, not part of attrs).
     * @type {string | undefined}
     */
    this.ombType = undefined;

    /**
     * Optional omb:type-as expression (special attribute, not part of attrs).
     * Expression is evaluated at runtime with variables raw, tag, parents, z, splitCsv.
     * @type {string | undefined}
     */
    this.ombTypeAs = undefined;

    /**
     * Leaf value as raw string (always preserved when computed).
     * @type {string | undefined}
     */
    this.rawValue = undefined;

    /**
     * Leaf value (typed if omb:type or omb:type-as is present, else same as rawValue).
     * @type {unknown}
     */
    this.value = undefined;
  }

  /** @returns {unknown} */
  toJSON() {
    return {
      tagName: this.tagName,
      tagToken: this.tagToken,
      attrs: this.attrs,
      content: this.content,
      rawValue: this.rawValue,
      value: this.value,
      ombType: this.ombType,
      ombTypeAs: this.ombTypeAs,
    };
  }
}

/**
 * Model node shape:
 * - node[".tag"] has physical + raw strings
 * - node[".children"] has child nodes
 * - node[".parents"] has OmbTag[] from root to this node (inclusive)
 * - every key in node[".tag"].attrs is also available as a property on the node
 *   (same camelCase key). Default getter auto-types using host typedValue/defaultTypedValue.
 *   Subclasses can override properties for custom typing.
 */
export class OmbNode {
  /**
   * @param {string} tagName
   */
  constructor(tagName) {
    /** @type {OmbTag} */
    this[".tag"] = new OmbTag(tagName);

    /** @type {OmbNode[]} */
    this[".children"] = [];

    /**
     * Parents chain (root..self), set by the builder.
     * @type {OmbTag[]}
     */
    this[".parents"] = [];

    /**
     * Optional host pointer used by attribute getters for typedValue().
     * In generalized usage, the builder sets this to the supplied host (or root element).
     * @type {Element | undefined}
     */
    this[".host"] = undefined;
  }

  /**
   * JSON shape:
   * - emits ".tag" and ".children" unless options.withTags === false
   * - emits every attribute key from ".tag.attrs" at the top-level using the node property
   * - emits any other enumerable keys (like per-tag navigation arrays), without overwriting
   * @param {{ withTags?: boolean }=} options
   * @returns {unknown}
   */
  toJSON(options = { withTags: true }) {
    const withTags = options?.withTags ?? true;

    /** @type {Record<string, unknown>} */
    const out = withTags
      ? {
        ".tag": this[".tag"].toJSON(),
        ".children": this[".children"].map((c) => c.toJSON(options)),
      }
      : {};

    for (const key of Object.keys(this[".tag"].attrs)) {
      out[key] = this[key];
    }

    for (const key of Object.keys(this)) {
      if (
        key === ".tag" || key === ".children" || key === ".host" ||
        key === ".parents"
      ) {
        continue;
      }
      if (key in out) continue;
      out[key] = this[key];
    }

    return out;
  }
}

/**
 * General-purpose builder.
 * Use via createOmbBuilder(options).
 */
export class OmbBuilder {
  /**
   * @param {ObjectModelBuilderElementOptions=} options
   */
  constructor(options = {}) {
    /** @type {Required<Pick<ObjectModelBuilderElementOptions, "ignoreWhitespaceText"|"ignoreComments">> & Pick<ObjectModelBuilderElementOptions,"ignoreElement"|"createElement"|"typedValue"|"typedValueByName"|"isChildElemAttr"|"resolveSrcUrl">} */
    this.options = {
      ignoreWhitespaceText: options.ignoreWhitespaceText ?? true,
      ignoreComments: options.ignoreComments ?? true,
      ignoreElement: options.ignoreElement,
      createElement: options.createElement,
      typedValue: options.typedValue,
      typedValueByName: options.typedValueByName,
      isChildElemAttr: options.isChildElemAttr,
      resolveSrcUrl: options.resolveSrcUrl,
    };

    /** @type {Map<string, OmbNodeConstructor>} */
    this.#tagClasses = new Map();

    /** @type {Map<string, OmbTypedValueFn>} */
    this.#typeAsCache = new Map();

    /** @type {Map<string, OmbTypedValueFn>} */
    this.#schemaTypes = new Map();
  }

  /** @type {Map<string, OmbNodeConstructor>} */
  #tagClasses;

  /** @type {Map<string, OmbTypedValueFn>} */
  #typeAsCache;

  /** @type {Map<string, OmbTypedValueFn>} */
  #schemaTypes;

  /**
   * Optional hook: create the root model object for a given build.
   * If not set, builder creates a node class for the root tagName.
   * @type {((host: Element, rootEl: Element) => OmbNode) | undefined}
   */
  createRoot;

  /**
   * Optional hook: receive PCDATA encountered directly under elements.
   * Default behavior stores to node[".tag"].content.
   * @type {((content: string, ctx: OmbTextContext) => void) | undefined}
   */
  collectContent;

  /**
   * Build from a host element:
   * - If host has omb:src, fetch+parse XML and build from documentElement.
   * - Otherwise build from host's live DOM subtree.
   *
   * @param {Element} hostEl
   * @returns {Promise<OmbNode>}
   */
  async buildFromHostElement(hostEl) {
    const src = getOmbAttr(hostEl, "src");
    if (src && String(src).trim().length > 0) {
      return await this.buildFromXmlSrc(String(src), { host: hostEl });
    }
    return this.buildFromDomRoot(hostEl, { host: hostEl });
  }

  /**
   * Build from a DOM root element (walk its subtree).
   * @param {Element} rootEl
   * @param {{ host?: Element }=} ctx
   * @returns {OmbNode}
   */
  buildFromDomRoot(rootEl, ctx = {}) {
    const host = ctx.host ?? rootEl;

    const root = this.createRoot?.(host, rootEl) ??
      this.#makeNodeForElement(rootEl, host, []);

    this.#applyAttributesToNode(rootEl, root);

    // Root parents chain is root tag (inclusive)
    root[".parents"] = [root[".tag"]];

    this.#walkChildNodes(rootEl, root, true, root[".parents"], host);
    this.#finalizeLeafValue(root, root[".parents"]);

    return root;
  }

  /**
   * Fetch+parse XML from src and build from its documentElement.
   * @param {string} src
   * @param {{ host?: Element }=} ctx
   * @returns {Promise<OmbNode>}
   */
  async buildFromXmlSrc(src, ctx = {}) {
    const host = ctx.host ?? document.documentElement;
    const rootEl = await this.#loadXmlRootElement(src, host);
    return this.buildFromDomRoot(rootEl, { host });
  }

  /**
   * Parse XML string and build from its documentElement.
   * @param {string} xml
   * @param {{ host?: Element }=} ctx
   * @returns {OmbNode}
   */
  buildFromXmlString(xml, ctx = {}) {
    const host = ctx.host ?? document.documentElement;
    const doc = new DOMParser().parseFromString(String(xml), "application/xml");
    const parserError = doc.getElementsByTagName("parsererror")?.[0];
    if (parserError) {
      const msg = parserError.textContent?.trim() || "XML parse error";
      throw new Error(`OMB XML parse error: ${msg}`);
    }
    const root = doc.documentElement;
    if (!root) throw new Error("OMB XML has no documentElement");
    return this.buildFromDomRoot(root, { host });
  }

  /**
   * @param {string} src
   * @param {Element} host
   * @returns {Promise<Element>}
   */
  async #loadXmlRootElement(src, host) {
    const url = this.#resolveSrcUrl(src, host);
    const r = await fetch(url, {
      headers: { Accept: "application/xml,text/xml,*/*" },
    });
    if (!r.ok) {
      throw new Error(`omb:src fetch failed (${r.status}): ${r.statusText}`);
    }

    const text = await r.text();
    const doc = new DOMParser().parseFromString(text, "application/xml");
    const parserError = doc.getElementsByTagName("parsererror")?.[0];
    if (parserError) {
      const msg = parserError.textContent?.trim() || "XML parse error";
      throw new Error(`omb:src XML parse error: ${msg}`);
    }

    const root = doc.documentElement;
    if (!root) throw new Error("omb:src XML has no documentElement");
    return root;
  }

  /**
   * @param {string} src
   * @param {Element} host
   * @returns {string}
   */
  #resolveSrcUrl(src, host) {
    const s = String(src).trim();
    const resolver = this.options.resolveSrcUrl;
    if (typeof resolver === "function") return resolver(s, host);

    const doc = host.ownerDocument ?? document;
    const base = doc.baseURI ?? document.baseURI;
    return new URL(s, base).toString();
  }

  /**
   * Compile omb:type-as expression into a typed function.
   * @param {string} expr
   * @returns {OmbTypedValueFn}
   */
  #compileTypeAs(expr) {
    const key = String(expr);
    const cached = this.#typeAsCache.get(key);
    if (cached) return cached;

    /** @type {OmbTypedValueFn} */
    const wrapped = (rawArg, tagArg, parentsArg) => {
      "use strict";

      // deno-lint-ignore no-unused-vars
      const raw = rawArg;
      // deno-lint-ignore no-unused-vars
      const tag = tagArg;
      // deno-lint-ignore no-unused-vars
      const parents = parentsArg;

      try {
        // eslint-disable-next-line no-eval
        return eval(`(${key})`);
      } catch (err) {
        return err;
      }
    };

    this.#typeAsCache.set(key, wrapped);
    return wrapped;
  }

  /**
   * Compile <omb:schema> function content into a typed function.
   * The content must evaluate to a function, e.g.:
   *   (raw, tag, parents) => ...
   * or:
   *   function (raw, tag, parents) { ... }
   *
   * @param {string} js
   * @returns {OmbTypedValueFn}
   */
  #compileSchemaFunction(js) {
    const source = String(js).trim();
    if (source.length === 0) {
      throw new Error("omb:schema has empty JavaScript content");
    }

    let fn;
    try {
      // eslint-disable-next-line no-eval
      fn = eval(`(${source})`);
    } catch (err) {
      throw new Error(
        `omb:schema function compile error: ${
          err?.message ? String(err.message) : String(err)
        }`,
      );
    }

    if (typeof fn !== "function") {
      throw new Error("omb:schema JavaScript did not evaluate to a function");
    }

    /** @type {OmbTypedValueFn} */
    const wrapped = (raw, tag, parents) => fn(raw, tag, parents);
    return wrapped;
  }

  /**
   * Extract raw text content from an element (TEXT + CDATA), in document order.
   * @param {Element} el
   * @returns {string}
   */
  #elementTextContentRaw(el) {
    let out = "";
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === Node.TEXT_NODE) out += n.nodeValue ?? "";
      // CDATA is only relevant in XML docs; treat as text-like.
      if (n.nodeType === 4 /* CDATA_SECTION_NODE */) out += n.nodeValue ?? "";
    }
    return out;
  }

  /**
   * Process <omb:schema> and register its type function.
   * The schema element is ignored structurally (no content/children contribution).
   *
   * @param {Element} el
   */
  #processSchemaElement(el) {
    const typeName = el.getAttribute?.("type") ?? getOmbAttr(el, "type");
    const name = String(typeName ?? "").trim();
    if (!name) {
      throw new Error("omb:schema requires a non-empty type attribute");
    }

    const js = this.#elementTextContentRaw(el);
    const fn = this.#compileSchemaFunction(js);
    this.#schemaTypes.set(name, fn);
  }

  /**
   * Resolve a named typed function.
   * Precedence:
   * - options.typedValueByName(name)
   * - schema-defined <omb:schema type="name">
   * - defaultTypedValues()[name]
   *
   * @param {string} name
   * @returns {OmbTypedValueFn | undefined}
   */
  #resolveTypedFnByName(name) {
    const byName = this.options.typedValueByName;
    const fromCallback = typeof byName === "function"
      ? byName(name)
      : undefined;
    if (typeof fromCallback === "function") return fromCallback;

    const fromSchema = this.#schemaTypes.get(name);
    if (typeof fromSchema === "function") return fromSchema;

    const fromDefaults = defaultTypedValues()[name];
    if (typeof fromDefaults === "function") return fromDefaults;

    return undefined;
  }

  /**
   * @param {Element} domParent
   * @param {OmbNode} modelParent
   * @param {boolean} isRoot
   * @param {OmbTag[]} parents
   * @param {Element} host
   */
  #walkChildNodes(domParent, modelParent, isRoot, parents, host) {
    const childNodes = Array.from(domParent.childNodes);

    for (const node of childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const raw = node.nodeValue ?? "";
        if (this.options.ignoreWhitespaceText && raw.trim().length === 0) {
          continue;
        }

        modelParent[".tag"].content.push(raw);

        this.collectContent?.(raw, {
          host,
          domParent,
          modelParent,
          isRootText: isRoot,
        });

        continue;
      }

      if (node.nodeType === Node.COMMENT_NODE) {
        if (this.options.ignoreComments) continue;
        continue;
      }

      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = /** @type {Element} */ (node);
        if (this.options.ignoreElement?.(el)) continue;

        if (isOmbSchemaElement(el)) {
          this.#processSchemaElement(el);
          continue;
        }

        const childModel = this.#makeNodeForElement(el, host, parents);
        this.#applyAttributesToNode(el, childModel);

        const childParents = parents.concat(childModel[".tag"]);
        childModel[".parents"] = childParents;

        this.#walkChildNodes(el, childModel, false, childParents, host);
        this.#finalizeLeafValue(childModel, childParents);

        const childTag = childModel[".tag"];
        const isAttr = (this.options.isChildElemAttr ??
          ((_childTag, ps) => defaultIsChildElemAttr(childModel, ps)))(
            childTag,
            parents,
          );

        if (isAttr) {
          // treat child as attribute on parent using childTag.tagToken
          const key = childTag.tagToken;

          // raw ALWAYS stored in parent attrs
          const rawValue = childTag.rawValue ?? "";
          modelParent[".tag"].attrs[key] = rawValue;

          // If child had omb:type or omb:type-as, parent property should return the typed value,
          // but raw storage remains the original string.
          if (childTag.ombType || childTag.ombTypeAs) {
            let currentRaw = rawValue;

            /** @type {OmbTypedValueFn | undefined} */
            let fn = undefined;

            // precedence: omb:type wins
            if (childTag.ombType) {
              fn = this.#resolveTypedFnByName(childTag.ombType);
            } else if (childTag.ombTypeAs) {
              fn = this.#compileTypeAs(childTag.ombTypeAs);
            }

            // parents for typing should be the child's parents chain (inclusive)
            const typedParents = childParents;

            Object.defineProperty(modelParent, key, {
              enumerable: true,
              configurable: true,
              get() {
                return typeof fn === "function"
                  ? fn(currentRaw, childTag, typedParents)
                  : currentRaw;
              },
              set(v) {
                currentRaw = String(v);
                modelParent[".tag"].attrs[key] = currentRaw;
              },
            });
          } else {
            // normal attribute behavior (typed getter via host.options.typedValue)
            this.#ensureAttrProperty(modelParent, key);
            modelParent[key] = rawValue;
          }

          continue;
        }

        // normal structural child
        this.#addExistingChildModel(modelParent, childModel);
      }
    }
  }

  /**
   * Add an already-built child model as a structural child and wire collections/methods.
   * @param {OmbNode} parentModel
   * @param {OmbNode} childModel
   */
  #addExistingChildModel(parentModel, childModel) {
    const tagName = childModel[".tag"].tagName;
    const methodName = addMethodName(tagName);

    /** @type {OmbNode & Record<string, unknown>} */ const anyParent =
      parentModel;
    /** @type {((element: Element) => OmbNode) | undefined} */ let adder =
      /** @type {unknown} */ (anyParent[methodName]);

    if (typeof adder !== "function") {
      adder = (element) =>
        this.#makeNodeForElement(
          element,
          childModel[".host"] ?? element,
          parentModel[".parents"] ?? [],
        );
      Object.defineProperty(anyParent, methodName, {
        value: adder,
        enumerable: false,
        configurable: true,
        writable: true,
      });
    }

    parentModel[".children"].push(childModel);
    this.#attachToPerTagCollection(parentModel, childModel);
  }

  /**
   * @param {Element} el
   * @param {Element} host
   * @param {OmbTag[]} parents
   * @returns {OmbNode}
   */
  #makeNodeForElement(el, host, parents) {
    const tagName = domTagText(el);
    const C = this.#getOrCreateTagClass(tagName, el);
    const node = new C(tagName);
    node[".host"] = host;

    // parents chain is set later for root and children, but initialize with provided chain (root..parent)
    node[".parents"] = Array.isArray(parents) ? parents.slice() : [];
    return node;
  }

  /**
   * @param {string} tagName
   * @param {Element} el
   * @returns {OmbNodeConstructor}
   */
  #getOrCreateTagClass(tagName, el) {
    const existing = this.#tagClasses.get(tagName);
    if (existing) return existing;

    /** @type {OmbNodeConstructor | null} */
    let Ctor = null;

    if (typeof this.options.createElement === "function") {
      const result = this.options.createElement(tagName, el);
      if (result && typeof result === "function") Ctor = result;
    }

    if (!Ctor) {
      Ctor = class GeneratedTagNode extends OmbNode {};
    }

    this.#tagClasses.set(tagName, Ctor);
    return Ctor;
  }

  /**
   * Apply DOM attributes:
   * - special `omb:type` is stored at node[".tag"].ombType and not added to attrs
   * - special `omb:type-as` is stored at node[".tag"].ombTypeAs and not added to attrs
   * - special `omb:src` is ignored (host-only control attribute)
   * - raw values stored at node[".tag"].attrs[camelAttrName] (always string)
   * - ensures node[camelAttrName] exists as a property:
   *    - default getter returns auto-typed value via typedValue/defaultTypedValue
   *    - default setter stores String(v) to raw .tag.attrs
   *
   * @param {Element} el
   * @param {OmbNode} model
   */
  #applyAttributesToNode(el, model) {
    // Prefer direct lookups first (this is the reliability fix)
    const ombType = getOmbAttr(el, "type");
    if (ombType != null) model[".tag"].ombType = ombType;

    const ombTypeAs = getOmbAttr(el, "type-as");
    if (ombTypeAs != null) model[".tag"].ombTypeAs = ombTypeAs;

    // omb:src is host-only control attr; ignore structurally
    // (we still skip it in the loop below)

    for (const attr of Array.from(el.attributes)) {
      if (isOmbAttrType(attr)) continue;
      if (isOmbAttrTypeAs(attr)) continue;
      if (isOmbAttrSrc(attr)) continue;

      const key = toCamelCaseIdentifier(attr.name);
      const rawValue = attr.value;

      model[".tag"].attrs[key] = rawValue;
      this.#ensureAttrProperty(model, key);
      model[key] = rawValue;
    }
  }

  /**
   * Default attribute property:
   * - getter: typedValue(raw, tag, parents) if provided, else defaultTypedValue(raw, tag, parents)
   * - setter: stores raw string to .tag.attrs
   * If a subclass defines the property on the prototype, we do NOT override it.
   *
   * @param {OmbNode} model
   * @param {string} key
   */
  #ensureAttrProperty(model, key) {
    if (key in model) return;

    Object.defineProperty(model, key, {
      enumerable: true,
      configurable: true,
      get() {
        const self = /** @type {OmbNode} */ (this);
        const raw = self[".tag"].attrs[key];
        const host = self[".host"];
        const parents = Array.isArray(self[".parents"]) ? self[".parents"] : [];

        // host may or may not be a custom element; typedValue is provided by builder options.
        // If you need host-specific typing, wrap builder options.typedValue accordingly.
        const fn = (/** @type {any} */ (host))?.options?.typedValue ??
          defaultTypedValue;

        return typeof fn === "function"
          ? fn(raw, self[".tag"], parents)
          : defaultTypedValue(raw, self[".tag"], parents);
      },
      set(v) {
        const self = /** @type {OmbNode} */ (this);
        self[".tag"].attrs[key] = String(v);
      },
    });
  }

  /**
   * Attach child into a per-tag array on parent, keyed by child's tagToken.
   * Example: parent.nested11 = [ ... ].
   *
   * @param {OmbNode} parentModel
   * @param {OmbNode} childModel
   */
  #attachToPerTagCollection(parentModel, childModel) {
    const prop = childModel[".tag"].tagToken;
    /** @type {OmbNode & Record<string, unknown>} */ const anyParent =
      parentModel;

    const existing = anyParent[prop];
    if (!Array.isArray(existing)) {
      Object.defineProperty(anyParent, prop, {
        value: [],
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    anyParent[prop].push(childModel);
  }

  /**
   * Compute leaf values:
   * - if no element children and has text content:
   *    - tag.rawValue is set to the leaf string (always)
   *    - tag.value is set to:
   *       - typed value if omb:type resolves to a function
   *       - else typed value if omb:type-as is present (evaluated expression)
   *       - otherwise the raw string
   *
   * Precedence: omb:type wins over omb:type-as if both exist.
   *
   * @param {OmbNode} node
   * @param {OmbTag[]} parents
   */
  #finalizeLeafValue(node, parents) {
    if (node[".children"].length !== 0) return;

    const joined = node[".tag"].content.join("").trim();
    if (joined.length === 0) return;

    const tag = node[".tag"];
    tag.rawValue = joined;

    const typeName = tag.ombType;
    if (typeName) {
      const fn = this.#resolveTypedFnByName(typeName);
      tag.value = typeof fn === "function" ? fn(joined, tag, parents) : joined;
      return;
    }

    const typeAs = tag.ombTypeAs;
    if (typeAs) {
      const fn = this.#compileTypeAs(typeAs);
      tag.value = typeof fn === "function" ? fn(joined, tag, parents) : joined;
      return;
    }

    tag.value = joined;
  }
}

/**
 * Factory: create a generalized builder.
 * @param {ObjectModelBuilderElementOptions=} options
 * @returns {OmbBuilder}
 */
export function createOmbBuilder(options = {}) {
  return new OmbBuilder(options);
}

/**
 * Web Component wrapper around the generalized OmbBuilder.
 */
export class ObjectModelBuilderElement extends HTMLElement {
  /** @type {OmbNode | undefined} */
  model;

  /** @type {ObjectModelBuilderElementOptions & { ignoreWhitespaceText: boolean, ignoreComments: boolean }} */
  options;

  /** @type {OmbBuilder} */
  #builder;

  /**
   * @param {ObjectModelBuilderElementOptions=} options
   */
  constructor(options = {}) {
    super();

    this.options = {
      ignoreWhitespaceText: options.ignoreWhitespaceText ?? true,
      ignoreComments: options.ignoreComments ?? true,
      ignoreElement: options.ignoreElement,
      createElement: options.createElement,
      typedValue: options.typedValue,
      typedValueByName: options.typedValueByName,
      isChildElemAttr: options.isChildElemAttr,
      resolveSrcUrl: options.resolveSrcUrl,
    };

    this.#builder = createOmbBuilder(this.options);

    this.#builder.collectContent = (content, ctx) =>
      this.collectContent?.(content, ctx);
    this.#builder.createRoot = (host, _rootEl) =>
      this.createRoot?.(host) ?? undefined;
  }

  /**
   * Optional hook: create the root model object.
   * NOTE: called only for live-DOM builds (no omb:src), same as before.
   * @type {((host: Element) => OmbNode) | undefined}
   */
  createRoot;

  /**
   * Optional hook: receive PCDATA encountered directly under elements.
   * @type {((content: string, ctx: OmbTextContext) => void) | undefined}
   */
  collectContent;

  connectedCallback() {
    void this.rebuild();
  }

  /**
   * Rebuild the model tree and store in this.model.
   * Dispatches:
   * - "omb:built" with { model }
   * - "omb:error" with { error }
   *
   * @returns {Promise<OmbNode>}
   */
  async rebuild() {
    try {
      // Ensure builder options stay synced in case caller mutated this.options
      this.#builder = createOmbBuilder(this.options);
      this.#builder.collectContent = (content, ctx) =>
        this.collectContent?.(content, ctx);
      this.#builder.createRoot = (_host, _rootEl) =>
        this.createRoot?.(this) ?? undefined;

      const model = await this.#builder.buildFromHostElement(this);
      this.model = model;

      this.dispatchEvent(new CustomEvent("omb:built", { detail: { model } }));
      return model;
    } catch (error) {
      this.dispatchEvent(new CustomEvent("omb:error", { detail: { error } }));
      throw error;
    }
  }
}
