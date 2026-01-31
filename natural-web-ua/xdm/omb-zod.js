/**
 * @module omb-zod
 *
 * Generate editable Zod schema code from an OMB-parsed model tree.
 *
 * Export:
 *   toZodSchema(ombModelRoot, options?) -> string (JS code)
 *
 * DX rules:
 * - Schemas are inlined by default.
 * - A named `export const <camelCase>Schema_<hash>` is only emitted when the same
 *   schema-shape is referenced more than once (count > 1).
 * - Objects are strict by default. `.passthrough()` is only emitted when
 *   options.isStrict(node, parents) returns false.
 */

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

const camel = (s) => {
  const parts = String(s ?? "")
    .replace(/[:]/g, "-")
    .split(/[^A-Za-z0-9]+/g)
    .filter(Boolean);

  if (parts.length === 0) return "x";
  const [first, ...rest] = parts;
  return first.toLowerCase() +
    rest.map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase()).join("");
};

const jsStr = (s) => JSON.stringify(String(s));

const hash5 = (s) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36).slice(0, 5);
};

const indentStr = (n) => "  ".repeat(n);
const indentBlock = (s, n) =>
  String(s)
    .split("\n")
    .map((line) => (line.length ? indentStr(n) + line : line))
    .join("\n");

const wrapExpr = (expr, level) => {
  if (!String(expr).includes("\n")) return expr;
  return `(\n${indentBlock(expr, level + 1)}\n${indentStr(level)})`;
};

const formatUnion = (items, level) => {
  if (items.length === 1) return items[0];

  const singleLine = items.every((x) => !String(x).includes("\n"));
  if (singleLine) return `z.union([${items.join(", ")}])`;

  const parts = items
    .map((x) => `${indentStr(level + 2)}${wrapExpr(x, level + 2)},`)
    .join("\n");

  return [
    `z.union([`,
    parts,
    `${indentStr(level + 1)}])`,
  ].join("\n");
};

const infer = (v) => {
  if (v === null) return "z.null()";
  if (v === undefined) return "z.undefined()";

  const t = typeof v;
  if (t === "string") return "z.string()";
  if (t === "number") return "z.number()";
  if (t === "boolean") return "z.boolean()";
  if (t === "bigint") return "z.bigint()";
  if (t === "symbol") return "z.symbol()";
  if (t === "function") return "z.function()";

  if (Array.isArray(v)) {
    const xs = [...new Set(v.map(infer))];
    if (xs.length === 0) return "z.array(z.unknown())";
    if (xs.length === 1) return `z.array(${xs[0]})`;
    return `z.array(z.union([${xs.join(", ")}]))`;
  }

  if (isObj(v)) {
    if ("success" in v && typeof v.success === "boolean") {
      const dataExpr = "data" in v ? infer(v.data) : "z.unknown()";
      return `z.object({ success: z.boolean(), data: ${dataExpr}.optional(), error: z.unknown().optional() })`;
    }

    const keys = Object.keys(v).sort();
    if (keys.length === 0) return "z.object({})";

    const props = keys
      .map((k) => `  ${jsStr(k)}: ${infer(v[k])}.optional(),`)
      .join("\n");

    return `z.object({\n${props}\n})`;
  }

  return "z.unknown()";
};

const tagToken = (n) =>
  n?.[".tag"]?.tagToken || camel(n?.[".tag"]?.tagName || "node");
const tagName = (n) => String(n?.[".tag"]?.tagName || "node");
const attrKeys = (n) => Object.keys(n?.[".tag"]?.attrs || {}).sort();

const childCollections = (n) =>
  Object.keys(n || {})
    .filter((k) => !k.startsWith("."))
    .map((k) => [k, n[k]])
    .filter(([, v]) =>
      Array.isArray(v) &&
      v.every((x) =>
        isObj(x) && isObj(x[".tag"]) && Array.isArray(x[".children"])
      )
    )
    .map(([k, v]) => ({ key: k, children: v }))
    .sort((a, b) => a.key.localeCompare(b.key));

const leafExpr = (n) => {
  if ((n[".children"] || []).length) return null;
  const t = n[".tag"] || {};
  if (typeof t.rawValue !== "string" || t.rawValue.trim().length === 0) {
    return null;
  }
  const sample = t.value !== undefined ? t.value : t.rawValue;
  return infer(sample);
};

const inferAttrExpr = (node, key) => {
  let sample;
  try {
    sample = node[key];
  } catch {
    sample = node?.[".tag"]?.attrs?.[key];
  }
  return `${infer(sample)}.optional()`;
};

export function toZodSchema(ombModelRoot, options = {}) {
  const { isStrict = () => true } = options;
  const root = ombModelRoot;

  if (
    !isObj(root) || !isObj(root[".tag"]) || !Array.isArray(root[".children"])
  ) {
    throw new Error("toZodSchema: expected an OMB model root (OmbNode-like).");
  }

  const sigMemo = new Map();

  const computeSig = (node) => {
    if (sigMemo.has(node)) return sigMemo.get(node);

    sigMemo.set(node, "PENDING");

    const attr = attrKeys(node)
      .map((k) => `${k}:${inferAttrExpr(node, k)}`)
      .join("|");

    const leaf = leafExpr(node) ? `leaf:${leafExpr(node)}` : "leaf:∅";

    const kids = childCollections(node)
      .map((col) => {
        const byTag = new Map();
        for (const c of col.children) {
          const t = tagToken(c);
          if (!byTag.has(t)) byTag.set(t, []);
          byTag.get(t).push(c);
        }
        const childSigs = [...byTag.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([, examples]) => computeSig(examples[0]));
        return `${col.key}:[${childSigs.join(",")}]`;
      })
      .join("|");

    const sig = `A{${attr}};${leaf};C{${kids}}`;
    sigMemo.set(node, sig);
    return sig;
  };

  const counts = new Map();
  const firstExampleBySig = new Map();

  const walk = (node) => {
    const sig = computeSig(node);
    counts.set(sig, (counts.get(sig) || 0) + 1);
    if (!firstExampleBySig.has(sig)) firstExampleBySig.set(sig, node);
    for (const col of childCollections(node)) {
      for (const c of col.children) walk(c);
    }
  };
  walk(root);

  const hoistedNameBySig = new Map();
  for (const [sig, n] of counts.entries()) {
    if (n > 1) {
      const ex = firstExampleBySig.get(sig);
      hoistedNameBySig.set(sig, `${camel(tagName(ex))}Schema_${hash5(sig)}`);
    }
  }

  const emitted = new Set();
  const decls = [];

  const schemaExprForNode = (node, parents, level) => {
    const lines = [];

    for (const k of attrKeys(node)) {
      lines.push(
        `${indentStr(level + 1)}${jsStr(k)}: ${inferAttrExpr(node, k)},`,
      );
    }

    const leaf = leafExpr(node);
    if (leaf) {
      lines.push(
        `${indentStr(level + 1)}".value": ${leaf}.optional(),`,
      );
    }

    for (const col of childCollections(node)) {
      const byTag = new Map();
      for (const c of col.children) {
        const t = tagToken(c);
        if (!byTag.has(t)) byTag.set(t, []);
        byTag.get(t).push(c);
      }

      const itemExprs = [...byTag.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([, examples]) =>
          childExprBySig(examples[0], parents.concat(node), level + 2)
        );

      const itemExpr = formatUnion(itemExprs, level + 1);
      const arrayExpr = `z.array(${wrapExpr(itemExpr, level + 1)})`;

      lines.push(
        `${indentStr(level + 1)}${jsStr(col.key)}: ${arrayExpr}.optional(),`,
      );
    }

    const strict = isStrict(node, parents);
    const tail = strict ? "" : ".passthrough()";

    return [
      `z.object({`,
      lines.length ? lines.join("\n") : `${indentStr(level + 1)}`,
      `${indentStr(level)}})${tail}`,
    ].join("\n");
  };

  const childExprBySig = (node, parents, level) => {
    const sig = computeSig(node);
    const name = hoistedNameBySig.get(sig);

    if (!name) {
      return schemaExprForNode(node, parents, level);
    }

    if (!emitted.has(sig)) {
      emitted.add(sig);

      for (const col of childCollections(node)) {
        for (const c of col.children) {
          childExprBySig(c, parents.concat(node), level);
        }
      }

      decls.push(
        [
          `// <${tagName(node)}> (token: ${tagToken(node)})`,
          `export const ${name} = ${schemaExprForNode(node, [], 0)};`,
          ``,
        ].join("\n"),
      );
    }

    return name;
  };

  const rootSig = computeSig(root);
  const rootName = hoistedNameBySig.get(rootSig);

  let rootExpr;
  if (rootName) {
    rootExpr = childExprBySig(root, [], 0);
  } else {
    childExprBySig(root, [], 0);
    rootExpr = schemaExprForNode(root, [], 0);
  }

  return [
    `/** Generated by omb-zod.js toZodSchema(). Edit and tighten as needed. */`,
    `import { z } from "zod";`,
    ``,
    decls.join(""),
    `export const ombRootSchema = ${rootExpr};`,
    ``,
  ].join("\n");
}
