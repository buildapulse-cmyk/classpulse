// js/levels.js
// The standard classes in a Ghanaian basic school, in order.
// Every page uses this list to group and sort classes the same way.

export const LEVELS = [
  { level: "Creche",       classes: ["Creche 1", "Creche 2"] },
  { level: "Kindergarten", classes: ["KG 1", "KG 2"] },
  { level: "Primary",      classes: ["Primary 1", "Primary 2", "Primary 3", "Primary 4", "Primary 5", "Primary 6"] },
  { level: "JHS",          classes: ["JHS 1", "JHS 2", "JHS 3"] }
];

// Tidy what people type into the standard names:
// "kg1" -> "KG 1", "p4" / "basic 4" / "class 4" -> "Primary 4", "jhs 2a" -> "JHS 2A", "creche 1" -> "Creche 1"
export function normalizeClassName(text) {
  const t = String(text).trim().replace(/\s+/g, " ");
  const patterns = [
    [/^(creche|crèche|cr[eè]ch)\s*(\d)\s*(.*)$/i, "Creche"],
    [/^(kg|k\.g\.?|kindergarten|nursery)\s*(\d)\s*(.*)$/i, "KG"],
    [/^(primary|prim|basic|class|p)\s*(\d)\s*(.*)$/i, "Primary"],
    [/^(jhs|j\.h\.s\.?)\s*(\d)\s*(.*)$/i, "JHS"]
  ];
  for (const [re, base] of patterns) {
    const m = t.match(re);
    if (m) return withStream(`${base} ${m[2]}`, m[3]);
  }
  return t;
}

// "JHS 2" + "a" -> "JHS 2A";  "Primary 4" + "Gold" -> "Primary 4 Gold"
export function withStream(base, stream = "") {
  const s = String(stream).trim();
  if (!s) return base;
  return /^[a-z]$/i.test(s) ? base + s.toUpperCase() : `${base} ${s.charAt(0).toUpperCase()}${s.slice(1)}`;
}

// Which level a class belongs to, e.g. "JHS 2A" -> "JHS"
export function levelOf(className) {
  const n = normalizeClassName(className);
  if (n.startsWith("Creche")) return "Creche";
  if (n.startsWith("KG")) return "Kindergarten";
  if (n.startsWith("Primary")) return "Primary";
  if (n.startsWith("JHS")) return "JHS";
  return "Other";
}

// Sort classes in school order: Creche 1 … KG 2 … Primary 6 … JHS 3, then anything else A–Z
const LEVEL_ORDER = { Creche: 1, Kindergarten: 2, Primary: 3, JHS: 4, Other: 9 };
export function classOrder(a, b) {
  const nameA = typeof a === "string" ? a : a.className;
  const nameB = typeof b === "string" ? b : b.className;
  const la = LEVEL_ORDER[levelOf(nameA)], lb = LEVEL_ORDER[levelOf(nameB)];
  if (la !== lb) return la - lb;
  const na = parseInt((nameA.match(/\d+/) || ["0"])[0], 10), nb = parseInt((nameB.match(/\d+/) || ["0"])[0], 10);
  return na - nb || nameA.localeCompare(nameB);
}

// <option>s grouped by level (Creche, Kindergarten, Primary, JHS) for a drop-down
export function groupedOptions(classNames) {
  const groups = {};
  classNames.slice().sort(classOrder).forEach((n) => (groups[levelOf(n)] ||= []).push(n));
  return Object.entries(groups)
    .map(([level, names]) => `<optgroup label="${level}">${names.map((n) => `<option>${n}</option>`).join("")}</optgroup>`)
    .join("");
}

// Common subjects in Ghanaian basic schools (used when assigning subject teachers)
export const SUBJECTS = [
  "English Language", "Mathematics", "Science", "Social Studies",
  "Religious & Moral Education", "Ghanaian Language", "French", "Computing",
  "Creative Arts", "Career Technology", "Physical Education", "History", "Our World Our People"
];
