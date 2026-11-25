// js/class-lists.js
// Add classes and students — one by one, or from an Excel / CSV class list.
// Each class is ONE record holding its whole class list (cheap to read),
// and each student also gets their own record in "students".

import { db } from "./firebase.js";
import {
  collection, getDocs, doc, writeBatch, deleteDoc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import { useSchool, schoolCol, schoolDoc } from "./school.js";
import { loadSchoolRecords, downloadRecords, removeChildrenCompletely } from "./child-record.js";
import { LEVELS, normalizeClassName, withStream, levelOf, classOrder, groupedOptions } from "./levels.js";

// Only logged-in teachers and the headmaster (and the admin) can use this page
await useSchool("headmaster");

const $ = (id) => document.getElementById(id);
const classSelect = $("cl-class");

let classes = {};       // { "JHS 2A": { students: [...] } }
let usedIds = new Set(); // every student ID already taken
let pending = [];       // rows read from an uploaded file, waiting to be added

// "JHS 2A" -> "jhs-2a", "Kwame Asante" -> "kwame-asante"
const makeId = (text) => text.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// Tidy a typed name: "  kwame   ASANTE " -> "Kwame Asante", "ama owusu-ansah" -> "Ama Owusu-Ansah"
const tidyWord = (w) => {
  const part = w === w.toUpperCase() ? w.toLowerCase() : w; // fix ALL-CAPS, keep mixed case like "McDonald"
  return part.charAt(0).toUpperCase() + part.slice(1);
};
const tidyName = (name) => String(name).trim().replace(/\s+/g, " ")
  .split(" ").map((w) => w.split("-").map(tidyWord).join("-")).join(" ");
const tidyClass = (name) => normalizeClassName(name); // "p4" -> "Primary 4", "jhs 2a" -> "JHS 2A"

function say(id, text, color) {
  $(id).textContent = text;
  $(id).style.color = color;
}

// A new ID that no other student has (adds -2, -3 … if needed)
function newStudentId(name) {
  const base = makeId(name) || "student";
  let id = base, n = 2;
  while (usedIds.has(id)) id = `${base}-${n++}`;
  usedIds.add(id);
  return id;
}

// ---------- Load ----------
async function loadAll(selectClass) {
  const snap = await getDocs(schoolCol("classes"));
  classes = {};
  usedIds = new Set();
  snap.docs.forEach((d) => {
    const data = d.data();
    classes[data.className] = { students: data.students || [], removedIds: data.removedIds || [] };
    (data.students || []).forEach((s) => usedIds.add(s.id));
    (data.removedIds || []).forEach((id) => usedIds.add(id)); // never reuse a removed student's ID
  });

  const names = Object.keys(classes).sort(classOrder);
  const keep = selectClass || classSelect.value;
  classSelect.innerHTML = names.length
    ? groupedOptions(names)
    : '<option value="">No classes yet — add one</option>';
  if (names.includes(keep)) classSelect.value = keep;
  drawList();
}

// ---------- Save students (works for one or many, in one or many classes) ----------
// rows: [{ name, className, studentNumber }]
async function saveStudents(rows) {
  let added = 0, skipped = 0;
  const byClass = {};
  rows.forEach((r) => (byClass[r.className] ||= []).push(r));

  const writes = []; // [ref, data]
  for (const [className, list] of Object.entries(byClass)) {
    const roster = (classes[className]?.students || []).slice();
    const existing = new Set(roster.map((s) => s.name.toLowerCase()));

    list.forEach((r) => {
      if (existing.has(r.name.toLowerCase())) { skipped++; return; } // already in this class
      const id = newStudentId(r.name);
      const entry = { id, name: r.name };
      if (r.studentNumber) entry.studentNumber = r.studentNumber;
      roster.push(entry);
      existing.add(r.name.toLowerCase());
      writes.push([schoolDoc("students", id), { ...entry, className, createdAt: serverTimestamp() }]);
      added++;
    });

    roster.sort((a, b) => a.name.localeCompare(b.name));
    writes.push([schoolDoc("classes", makeId(className)), { className, level: levelOf(className), students: roster, updatedAt: serverTimestamp() }, true]);
  }

  // Firestore allows up to 500 writes at once, so send in groups of 400
  for (let i = 0; i < writes.length; i += 400) {
    const batch = writeBatch(db);
    writes.slice(i, i + 400).forEach(([ref, data, merge]) => batch.set(ref, data, merge ? { merge: true } : {}));
    await batch.commit();
  }
  return { added, skipped };
}

// ---------- 1. Add a class ----------
$("new-class-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = withStream($("new-class").value, $("new-stream").value);
  if (!name) return;
  if (classes[name]) {
    classSelect.value = name;
    drawList();
    say("class-status", `${name} already exists — it's now selected.`, "#1E5AA8");
    return;
  }
  say("class-status", "Adding…", "#12305A");
  try {
    await setDoc(schoolDoc("classes", makeId(name)), { className: name, level: levelOf(name), students: [], updatedAt: serverTimestamp() });
    $("new-stream").value = "";
    await loadAll(name);
    say("class-status", `${name} added ✓ Now add its students.`, "#157F3B");
  } catch (error) {
    say("class-status", "Could not add the class: " + error.message, "#B42318");
  }
});

classSelect.addEventListener("change", drawList);

// The standard classes to choose from when adding a class
$("new-class").innerHTML = LEVELS.map((l) =>
  `<optgroup label="${l.level}">${l.classes.map((c) => `<option>${c}</option>`).join("")}</optgroup>`).join("");

// ---------- 2. Add one student ----------
$("add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const className = classSelect.value;
  if (!className) { say("add-status", "Add a class first.", "#B42318"); return; }
  const name = tidyName($("st-name").value);
  if (name.split(" ").length < 2) { say("add-status", "Please type the student's full name (first and last name).", "#B42318"); return; }

  say("add-status", "Adding…", "#12305A");
  try {
    const { added } = await saveStudents([{ name, className, studentNumber: $("st-number").value.trim() }]);
    if (added === 0) {
      say("add-status", `${name} is already in ${className}.`, "#8A5A00");
    } else {
      say("add-status", `${name} added to ${className} ✓`, "#157F3B");
      $("st-name").value = "";
      $("st-number").value = "";
      $("st-name").focus();
    }
    await loadAll(className);
  } catch (error) {
    say("add-status", "Could not add: " + error.message, "#B42318");
  }
});

// ---------- 3. Upload from Excel / CSV ----------
$("upload-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  $("upload-name").textContent = file.name;
  say("upload-status", "Reading the file…", "#12305A");
  $("upload-save").hidden = true;
  $("upload-preview").innerHTML = "";

  try {
    const XLSX = await import("https://cdn.sheetjs.com/xlsx-latest/package/xlsx.mjs");
    const wb = XLSX.read(await file.arrayBuffer());
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" })
      .filter((row) => row.some((cell) => String(cell).trim() !== ""));
    if (grid.length === 0) throw new Error("The first sheet is empty.");

    // Find the columns by their headings (Name / Class / Student number)
    const head = grid[0].map((h) => String(h).toLowerCase().trim());
    let nameCol = head.findIndex((h) => /^(full\s*)?name$|student.?name|^names?$/.test(h));
    const firstCol = head.findIndex((h) => /first.?name/.test(h));
    const lastCol = head.findIndex((h) => /(last|sur).?name/.test(h));
    const classCol = head.findIndex((h) => /^class|form|grade/.test(h));
    const numberCol = head.findIndex((h) => /number|^no\.?$|^id$|admission/.test(h));
    const hasHeadings = nameCol >= 0 || (firstCol >= 0 && lastCol >= 0);
    if (!hasHeadings) nameCol = 0; // no headings: use the first column as names
    const body = hasHeadings ? grid.slice(1) : grid;

    const chosenClass = classSelect.value;
    pending = body.map((row) => {
      const rawName = nameCol >= 0 ? row[nameCol] : `${row[firstCol]} ${row[lastCol]}`;
      const name = tidyName(rawName);
      const className = classCol >= 0 && String(row[classCol]).trim() ? tidyClass(row[classCol]) : chosenClass;
      const studentNumber = numberCol >= 0 ? String(row[numberCol]).trim() : "";
      return { name, className, studentNumber };
    }).filter((r) => r.name);

    if (pending.some((r) => !r.className)) throw new Error("Some students have no class. Choose a class above, or add a Class column.");
    if (pending.length === 0) throw new Error("No names found in the file.");

    // Preview before adding
    const already = (r) => (classes[r.className]?.students || []).some((s) => s.name.toLowerCase() === r.name.toLowerCase());
    const newCount = pending.filter((r) => !already(r)).length;
    const newClasses = [...new Set(pending.map((r) => r.className))].filter((c) => !classes[c]);

    $("upload-preview").innerHTML = `
      <div style="overflow-x: auto; max-height: 360px; overflow-y: auto; border: 1px solid #E2E7EF; border-radius: 10px">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px">
          <thead style="position: sticky; top: 0; background: #F6F8FB"><tr style="text-align: left">
            <th style="padding: 10px">#</th><th style="padding: 10px">Name</th><th style="padding: 10px">Class</th><th style="padding: 10px">Student number</th><th style="padding: 10px">Status</th>
          </tr></thead>
          <tbody>${pending.map((r, i) => `<tr style="border-top: 1px solid #EEF1F6">
            <td style="padding: 8px 10px; color: #5B6472">${i + 1}</td>
            <td style="padding: 8px 10px; font-weight: 600">${r.name}</td>
            <td style="padding: 8px 10px">${r.className}${classes[r.className] ? "" : ' <span style="color: #1E5AA8; font-size: 12px">(new class)</span>'}</td>
            <td style="padding: 8px 10px">${r.studentNumber || "—"}</td>
            <td style="padding: 8px 10px">${already(r) ? '<span style="color: #8A5A00">Already added — will skip</span>' : '<span style="color: #157F3B">New</span>'}</td>
          </tr>`).join("")}</tbody>
        </table>
      </div>`;
    say("upload-status",
      `${newCount} new student${newCount === 1 ? "" : "s"} found` + (newClasses.length ? `, and ${newClasses.length} new class${newClasses.length === 1 ? "" : "es"} (${newClasses.join(", ")})` : "") + ". Check the list, then click Add these students.",
      "#12305A");
    $("upload-save").hidden = newCount === 0;
  } catch (error) {
    pending = [];
    say("upload-status", "Could not read the file: " + error.message, "#B42318");
  }
  e.target.value = "";
});

$("upload-save").addEventListener("click", async () => {
  if (pending.length === 0) return;
  $("upload-save").disabled = true;
  say("upload-status", "Adding students…", "#12305A");
  try {
    const { added, skipped } = await saveStudents(pending);
    pending = [];
    $("upload-preview").innerHTML = "";
    $("upload-save").hidden = true;
    $("upload-name").textContent = "No file chosen";
    await loadAll();
    say("upload-status", `${added} student${added === 1 ? "" : "s"} added ✓` + (skipped ? ` (${skipped} already there, skipped)` : ""), "#157F3B");
  } catch (error) {
    say("upload-status", "Could not add students: " + error.message, "#B42318");
  } finally {
    $("upload-save").disabled = false;
  }
});

// ---------- The class list ----------
function drawList() {
  const className = classSelect.value;
  const roster = classes[className]?.students || [];
  $("list-class").textContent = className || "this class";
  $("list-count").textContent = `${roster.length} student${roster.length === 1 ? "" : "s"}`;

  $("student-list").innerHTML = roster.length === 0
    ? '<p style="margin: 0; color: #5B6472">No students in this class yet.</p>'
    : roster.map((s, i) => `
      <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 10px 0; ${i < roster.length - 1 ? "border-bottom: 1px solid #EEF1F6" : ""}">
        <span style="width: 32px; color: #5B6472; font-size: 14px">${i + 1}.</span>
        <span style="flex: 1 1 220px; font-weight: 600">${s.name}${s.studentNumber ? ` <span style="font-weight: 400; color: #5B6472; font-size: 13px">· ${s.studentNumber}</span>` : ""}</span>
        <button type="button" class="remove-btn" data-id="${s.id}" aria-label="Remove ${s.name}" style="height: 40px; padding: 0 14px; border-radius: 8px; border: 1px solid #C9D2DF; background: #FFFFFF; color: #8F1D15; font-size: 13px; font-weight: 600; font-family: inherit; cursor: pointer">Remove</button>
      </div>`).join("");

  document.querySelectorAll(".remove-btn").forEach((b) => b.addEventListener("click", () => removeStudent(b.dataset.id)));
}

async function removeStudent(id) {
  const className = classSelect.value;
  const student = classes[className].students.find((s) => s.id === id);
  if (!confirm(`Remove ${student.name} from the school?\n\n1. Their full record (report card, every assessment and attendance) downloads for you to keep.\n2. Then ALL their information is removed: scores, registers, and their parent's login and PIN (unless the parent has another child here).\n\nThis can't be undone.`)) return;

  say("list-status", "Downloading their record…", "#12305A");
  try {
    const cls = { className, students: classes[className].students };
    const { records, settings } = await loadSchoolRecords([cls], new Set([id]));
    await downloadRecords(records, settings, `${student.name} - ${className} - ClasPules record`);
    say("list-status", "Removing…", "#12305A");
    await removeChildrenCompletely([{ id, name: student.name, className }]);
    await loadAll(className);
    say("list-status", `${student.name} removed. Their record was downloaded — keep it safe.`, "#157F3B");
  } catch (error) {
    say("list-status", "Could not remove: " + error.message, "#B42318");
  }
}

loadAll().catch((error) => say("list-status", "Could not load classes: " + error.message, "#B42318"));
