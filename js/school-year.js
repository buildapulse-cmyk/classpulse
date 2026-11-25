// js/school-year.js
// The headmaster's "School year" tab. Records are cleared TERM BY TERM to save space:
//   1. Download the term's records (Excel) and keep the file safe.
//   2. End the term: ClassPulse keeps a short summary of the term (each student's result,
//      position and attendance, and each class's subject averages). This summary REPLACES
//      the previous term's summary. All scores and registers of the term are cleared.
//      Students, classes, PINs, teachers, parents and topics all stay.
//   • Terms 1 and 2 → start the next term.
//   • Term 3        → choose who is promoted or repeats, then start the new academic year.

import { db } from "./firebase.js";
import { getDocs, getDoc, doc, writeBatch, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { schoolCol, schoolDoc } from "./school.js";
import { levelOf, classOrder } from "./levels.js";
import { exportEverything } from "./export.js";
import { withDefaults, buildClassReports } from "./report-calc.js";
import { loadSchoolRecords, downloadRecords, removeChildrenCompletely } from "./child-record.js";

const $ = (id) => document.getElementById(id);
const isoToday = () => new Date().toISOString().slice(0, 10);
const fmt = (iso) => iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "";
const makeId = (text) => text.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// Only the headmaster portal has the School year tab (the Excel download also uses this file)
const on = (id, event, fn) => { const el = $(id); if (el) el.addEventListener(event, fn); };
function say(id, text, color) { $(id).textContent = text; $(id).style.color = color; }

// ---------- Classes in order, and who moves where ----------
const LADDER = ["Creche 1", "Creche 2", "KG 1", "KG 2", "Primary 1", "Primary 2", "Primary 3", "Primary 4",
  "Primary 5", "Primary 6", "JHS 1", "JHS 2", "JHS 3"];

// "JHS 2A" -> "JHS 3A";  "KG 2" -> "Primary 1";  "JHS 3" -> null (leaves school);  unknown -> undefined
export function nextClassName(className) {
  const m = String(className).match(/^(Creche|KG|Primary|JHS) (\d)(.*)$/);
  if (!m) return undefined;
  const i = LADDER.indexOf(`${m[1]} ${m[2]}`);
  if (i === -1) return undefined;
  if (i === LADDER.length - 1) return null;
  return LADDER[i + 1] + m[3];
}

// ---------- Academic year and term ----------
// Sept–Dec belongs to "2026/2027"; Jan–Aug to "2025/2026"
export function guessYear(date = new Date()) {
  const y = date.getFullYear();
  return date.getMonth() >= 8 ? `${y}/${y + 1}` : `${y - 1}/${y}`;
}
const nextYearLabel = (label) => {
  const m = String(label).match(/(\d{4})\D+(\d{4})/);
  return m ? `${Number(m[1]) + 1}/${Number(m[2]) + 1}` : guessYear(new Date(Date.now() + 120 * 86400000));
};

export function withYearDefaults(saved = {}, targets = {}) {
  return {
    academicYear: saved.academicYear || guessYear(),
    term: saved.term || 1,
    termStart: saved.termStart || targets.termStart || ""
  };
}

// Is it time to end the term? (the final exams have started)
export function termIsEnding(targets) {
  return !!targets.examDate && isoToday() >= targets.examDate;
}

// ---------- The short summary kept for each class ----------
export function termSummaries(classes, assessments, attendance, settings) {
  return classes.slice().sort(classOrder).filter((c) => (c.students || []).length).map((c) => {
    const { reports } = buildClassReports(c, assessments, attendance, settings);
    const students = reports.map((r) => ({
      id: r.student.id, name: r.student.name, overall: r.overall, position: r.position ?? null,
      present: r.present, days: r.daysTotal
    })).sort((a, b) => (a.position ?? 9999) - (b.position ?? 9999) || a.name.localeCompare(b.name));
    const totals = {};
    reports.forEach((r) => r.rows.forEach((row) => (totals[row.subject] ||= []).push(row.total)));
    const subjects = Object.entries(totals)
      .map(([subject, list]) => ({ subject, average: Math.round(list.reduce((a, b) => a + b, 0) / list.length) }))
      .sort((a, b) => b.average - a.average);
    const overalls = students.map((s) => s.overall).filter((v) => v !== null);
    const days = students.reduce((n, s) => n + s.days, 0);
    return {
      className: c.className, students, subjects,
      classAverage: overalls.length ? Math.round(overalls.reduce((a, b) => a + b, 0) / overalls.length) : null,
      attendancePercent: days ? Math.round((students.reduce((n, s) => n + s.present, 0) / days) * 100) : null
    };
  });
}

// ---------- The tab ----------
let state = null;   // { classes, parents, targets, year, reload }
let downloaded = false;
let decisions = {}; // studentId -> "promote" | "repeat"

export function drawYear(s) {
  state = s;
  const { year, targets } = s;
  $("year-now").innerHTML = `<strong style="font-size: 18px">Academic year ${year.academicYear} · Term ${year.term}</strong>
    <span style="color: #5B6472">${year.termStart ? `Started ${fmt(year.termStart)}` : "Start date not set"}${targets.examDate ? ` · Final exams ${fmt(targets.examDate)}` : ""}</span>`;
  $("year-end-note").hidden = !termIsEnding(targets);

  const lastTerm = year.term >= 3;
  $("dl-title").textContent = `Step 1 · Download Term ${year.term}'s records`;
  $("term-card").hidden = lastTerm;
  $("year-card").hidden = !lastTerm;
  if (!lastTerm) {
    $("next-term-title").textContent = `Step 2 · End Term ${year.term} and start Term ${year.term + 1}`;
    $("next-term-btn").textContent = `Start Term ${year.term + 1}`;
    if (!$("next-term-date").value) $("next-term-date").value = isoToday();
  } else {
    $("new-year-label").value ||= nextYearLabel(year.academicYear);
    if (!$("new-year-date").value) $("new-year-date").value = isoToday();
    drawPromotion();
  }
  showStepState();
  drawLastSummary();
}

// ---------- Step 1: download the term's records ----------
on("year-download", "click", async () => {
  $("year-download").disabled = true;
  say("year-dl-status", "Preparing the Excel file…", "#12305A");
  try {
    await exportEverything({ termEnd: true });
    downloaded = true;
    say("year-dl-status", "Downloaded ✓ Keep this file safe — save a copy on a flash drive or in Google Drive.", "#157F3B");
  } catch (error) {
    say("year-dl-status", "Could not make the Excel file: " + error.message, "#B42318");
  } finally {
    $("year-download").disabled = false;
    showStepState();
  }
});
on("year-kept", "change", showStepState);

// Every child's record (report card + every assessment) in one file, for the school to keep for families
on("records-all", "click", async () => {
  $("records-all").disabled = true;
  say("records-status", "Preparing every child's record…", "#12305A");
  try {
    const { records, settings } = await loadSchoolRecords(state.classes.slice().sort(classOrder));
    await downloadRecords(records, settings, `All records - ${settings.term} - ClassPulse`);
    say("records-status", `Downloaded ${records.length} records ✓`, "#157F3B");
  } catch (error) {
    say("records-status", "Could not make the records: " + error.message, "#B42318");
  } finally {
    $("records-all").disabled = false;
  }
});

function showStepState() {
  $("year-kept").disabled = !downloaded;
  const ready = downloaded && $("year-kept").checked;
  $("next-term-btn").disabled = !ready;
  $("new-year-btn").disabled = !ready;
  const hint = ready ? "" : "Do Step 1 first (download and tick the box).";
  $("next-term-hint").textContent = hint;
  $("new-year-hint").textContent = hint;
}

// ---------- Ending a term (used by "next term" and "new year") ----------
// Firestore takes up to 500 changes at once; send them in groups of 400
async function commitAll(ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(db);
    ops.slice(i, i + 400).forEach(([kind, ref, data]) => kind === "delete" ? batch.delete(ref) : batch.set(ref, data, { merge: true }));
    await batch.commit();
  }
}

async function endTerm(progress, leaving = new Set()) {
  const { classes, year } = state;
  progress("Saving the term's summary…");
  const [settingsDoc, assessSnap, attendSnap, oldSummary] = await Promise.all([
    getDoc(schoolDoc("settings", "report")), getDocs(schoolCol("assessments")),
    getDocs(schoolCol("attendance")), getDocs(schoolCol("archive"))
  ]);
  const settings = withDefaults(settingsDoc.exists() ? settingsDoc.data() : {});
  // (students who have finished school are left out: all their information is removed)
  const summaries = termSummaries(classes, assessSnap.docs.map((d) => d.data()), attendSnap.docs.map((d) => d.data()), settings)
    .map((s) => ({ ...s, students: s.students.filter((st) => !leaving.has(st.id)) }));
  const label = `Term ${year.term} · ${year.academicYear}`;

  // The new summary replaces the previous term's summary
  await commitAll(oldSummary.docs.map((d) => ["delete", d.ref]));
  await commitAll(summaries.map((s) => ["set", schoolDoc("archive", makeId(s.className)), { ...s, label, savedAt: serverTimestamp() }]));

  // Clear the term's scores and registers
  progress("Clearing the term's scores and registers…");
  await commitAll([...assessSnap.docs, ...attendSnap.docs].map((d) => ["delete", d.ref]));
}

async function newTermSettings(academicYear, term, startDate) {
  await commitAll([
    ["set", schoolDoc("settings", "year"), { academicYear, term, termStart: startDate, updatedAt: serverTimestamp() }],
    ["set", schoolDoc("settings", "targets"), { termStart: startDate, examDate: "" }],
    ["set", schoolDoc("settings", "report"), { term: `Term ${term} · ${academicYear}` }],
    ["set", schoolDoc("settings", "parentViews"), { updatedAt: null }] // parents' view refreshes
  ]);
}

function afterDone() {
  downloaded = false;
  $("year-kept").checked = false;
  say("year-dl-status", "", "");
}

// ---------- Step 2 (Terms 1 and 2): start the next term ----------
on("next-term-btn", "click", async () => {
  const { year } = state;
  const date = $("next-term-date").value;
  const n = year.term + 1;
  if (!date) return say("term-status", "Choose the date the new term starts.", "#B42318");
  if (!confirm(`End Term ${year.term} and start Term ${n} on ${fmt(date)}?\n\n• A short summary of Term ${year.term} is kept (results and attendance). It replaces the previous summary.\n• All scores and registers of Term ${year.term} are CLEARED.\n• Students, classes, PINs, teachers and parents stay.\n\nMake sure you kept the Excel file. This can't be undone.`)) return;
  $("next-term-btn").disabled = true;
  try {
    await endTerm((t) => say("term-status", t, "#12305A"));
    await newTermSettings(year.academicYear, n, date);
    say("term-status", `Term ${n} started ✓ Set the final exam date on Weekly targets.`, "#157F3B");
    afterDone();
    await state.reload();
  } catch (error) {
    say("term-status", "Stopped: " + error.message + ". Please try again.", "#B42318");
  } finally {
    showStepState();
  }
});

// ---------- Step 2 (Term 3): promotion list ----------
function drawPromotion() {
  const classes = state.classes.slice().sort(classOrder);
  const withStudents = classes.filter((c) => (c.students || []).length);
  if (withStudents.length === 0) {
    $("promo-list").innerHTML = '<p style="margin: 0; color: #5B6472">No students yet.</p>';
    return;
  }
  $("promo-list").innerHTML = withStudents.map((c) => {
    const next = nextClassName(c.className);
    const goLabel = next === null ? "Completes JHS (leaves)" : `Promote to ${next}`;
    return `<details style="border: 1px solid #E2E7EF; border-radius: 12px; padding: 4px 14px">
      <summary style="cursor: pointer; min-height: 44px; display: flex; align-items: center; justify-content: space-between; gap: 10px; font-weight: 700">
        <span>${c.className} <span style="font-weight: 500; color: #5B6472">→ ${next === null ? "leaves school" : next || "stays"}</span></span>
        <span class="promo-count" data-class="${c.id}" style="font-size: 13px; font-weight: 600; color: #5B6472"></span>
      </summary>
      <div style="display: flex; flex-direction: column; padding: 4px 0 10px">
        ${c.students.map((s) => {
          const d = decisions[s.id] || (next === undefined ? "repeat" : "promote");
          decisions[s.id] = d;
          return `<div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; padding: 6px 0; border-bottom: 1px solid #EEF1F6">
            <label for="pr-${s.id}" style="font-weight: 500">${s.name}</label>
            <select id="pr-${s.id}" data-student="${s.id}" data-class="${c.id}" style="width: auto; min-width: 220px; height: 40px">
              ${next !== undefined ? `<option value="promote" ${d === "promote" ? "selected" : ""}>${goLabel}</option>` : ""}
              <option value="repeat" ${d === "repeat" ? "selected" : ""}>Repeat ${c.className}</option>
            </select>
          </div>`;
        }).join("")}
      </div>
    </details>`;
  }).join("");
  $("promo-list").querySelectorAll("select[data-student]").forEach((sel) => sel.addEventListener("change", () => {
    decisions[sel.dataset.student] = sel.value;
    countDecisions();
  }));
  countDecisions();
}

function countDecisions() {
  state.classes.forEach((c) => {
    const el = document.querySelector(`.promo-count[data-class="${c.id}"]`);
    if (!el) return;
    const repeat = (c.students || []).filter((s) => decisions[s.id] === "repeat").length;
    el.textContent = `${c.students.length - repeat} ${nextClassName(c.className) === null ? "leaving" : "moving up"} · ${repeat} repeating`;
  });
}

// ---------- Step 3 (Term 3): start the new academic year ----------
on("new-year-btn", "click", async () => {
  const label = $("new-year-label").value.trim();
  const date = $("new-year-date").value;
  if (!/^\d{4}\/\d{4}$/.test(label)) return say("new-year-status", "Type the new year like 2026/2027.", "#B42318");
  if (!date) return say("new-year-status", "Choose the date the new year (Term 1) starts.", "#B42318");
  if (label === state.year.academicYear) return say("new-year-status", `${label} is the year that is ending. Type the NEW year, e.g. ${nextYearLabel(label)}.`, "#B42318");
  const leaving = state.classes.reduce((n, c) => n + (c.students || []).filter((s) => nextClassName(c.className) === null && decisions[s.id] === "promote").length, 0);
  if (!confirm(`End Term 3 and start the ${label} academic year?\n\n• A short summary of Term 3 is kept (results and attendance). It replaces the previous summary.\n• All scores and registers of Term 3 are CLEARED.\n• Students move to their new classes. ${leaving} finish JHS 3: their records download first, then ALL their information (and their parent's login and PIN, if no other child is here) is removed.\n• Classes, PINs, teachers and parents stay.\n\nMake sure you kept the Excel file. This can't be undone.`)) return;

  $("new-year-btn").disabled = true;
  try {
    const progress = (t) => say("new-year-status", t, "#12305A");
    // Students finishing JHS 3: download their records for the school first
    const leavers = [];
    state.classes.forEach((c) => (c.students || []).forEach((s) => {
      if (nextClassName(c.className) === null && decisions[s.id] === "promote") leavers.push({ id: s.id, name: s.name, className: c.className });
    }));
    if (leavers.length) {
      progress("Downloading the records of students who are leaving…");
      const { records, settings } = await loadSchoolRecords(state.classes, new Set(leavers.map((l) => l.id)));
      await downloadRecords(records, settings, `Leavers ${state.year.academicYear.replace("/", "-")} - ClassPulse records`);
    }
    await endTerm(progress, new Set(leavers.map((l) => l.id)));
    progress("Moving students to their new classes…");
    await promoteStudents();
    if (leavers.length) {
      progress("Removing the information of students who have finished…");
      await removeChildrenCompletely(leavers, { keepClassLists: true });
    }
    await newTermSettings(label, 1, date);
    say("new-year-status", `Welcome to ${label} ✓ Students have been moved to their new classes.`, "#157F3B");
    afterDone();
    decisions = {};
    $("new-year-label").value = "";
    await state.reload();
  } catch (error) {
    say("new-year-status", "Stopped: " + error.message + ". Please try again.", "#B42318");
  } finally {
    showStepState();
  }
});

async function promoteStudents() {
  const { classes, parents } = state;
  const rosters = Object.fromEntries(classes.map((c) => [c.className, []]));
  const moved = {}; // studentId -> new class name, or null if leaving
  classes.forEach((c) => (c.students || []).forEach((s) => {
    const next = nextClassName(c.className);
    const target = decisions[s.id] === "promote" && next !== undefined ? next : c.className;
    moved[s.id] = target;
    if (target !== null) (rosters[target] ||= []).push(s);
  }));
  const ops = [];
  Object.entries(rosters).forEach(([className, roster]) => {
    const existing = classes.find((c) => c.className === className);
    const data = { students: roster.sort((a, b) => a.name.localeCompare(b.name)), updatedAt: serverTimestamp() };
    if (!existing) Object.assign(data, { className, level: levelOf(className) });
    ops.push(["set", schoolDoc("classes", existing ? existing.id : makeId(className)), data]);
  });
  Object.entries(moved).forEach(([id, target]) => { if (target !== null) ops.push(["set", schoolDoc("students", id), { className: target }]); });
  // Parents: their children's new class (children who are leaving are removed afterwards)
  parents.forEach((p) => {
    if (!(p.children || []).some((k) => moved[k.id])) return;
    const children = (p.children || []).map((k) => ({ ...k, className: moved[k.id] || k.className }));
    ops.push(["set", doc(db, "users", p.uid), { children }]);
  });
  await commitAll(ops);
}

// ---------- Last term's summary ----------
async function drawLastSummary() {
  try {
    const snap = await getDocs(schoolCol("archive"));
    const all = snap.docs.map((d) => d.data()).sort(classOrder);
    if (all.length === 0) {
      $("summary-title").textContent = "Last term's summary";
      $("past-years").innerHTML = '<p style="margin: 0; color: #5B6472">Nothing yet. When a term ends, its short summary appears here until the next term ends.</p>';
      return;
    }
    $("summary-title").textContent = `Summary of ${all[0].label}`;
    $("past-years").innerHTML = all.map((a) => `
      <details style="border: 1px solid #E2E7EF; border-radius: 12px; padding: 4px 14px">
        <summary style="cursor: pointer; min-height: 44px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 10px; font-weight: 700">
          <span>${a.className}</span><span style="font-size: 13px; color: #5B6472">${a.students.length} students${a.classAverage !== null ? ` · average ${a.classAverage}` : ""}${a.attendancePercent !== null ? ` · attendance ${a.attendancePercent}%` : ""}</span>
        </summary>
        <div style="display: flex; flex-wrap: wrap; gap: 20px; padding: 6px 0 12px; overflow-x: auto">
          <table style="flex: 2 1 320px; border-collapse: collapse; font-size: 14px">
            <thead><tr style="text-align: left; color: #5B6472; font-size: 12px"><th style="padding: 4px">Pos.</th><th style="padding: 4px">Student</th><th style="padding: 4px">Overall</th><th style="padding: 4px">Attendance</th></tr></thead>
            <tbody>${a.students.map((s) => `<tr style="border-top: 1px solid #EEF1F6"><td style="padding: 4px">${s.position ?? "–"}</td><td style="padding: 4px">${s.name}</td><td style="padding: 4px; font-weight: 700">${s.overall ?? "–"}</td><td style="padding: 4px">${s.days ? `${s.present} of ${s.days} days` : "–"}</td></tr>`).join("")}</tbody>
          </table>
          <table style="flex: 1 1 200px; border-collapse: collapse; font-size: 14px; align-self: flex-start">
            <thead><tr style="text-align: left; color: #5B6472; font-size: 12px"><th style="padding: 4px">Subject</th><th style="padding: 4px">Average</th></tr></thead>
            <tbody>${a.subjects.map((s) => `<tr style="border-top: 1px solid #EEF1F6"><td style="padding: 4px">${s.subject}</td><td style="padding: 4px">${s.average}</td></tr>`).join("") || '<tr><td style="padding: 4px; color: #5B6472">No scores</td></tr>'}</tbody>
          </table>
        </div>
      </details>`).join("");
  } catch (error) {
    $("past-years").innerHTML = `<p style="margin: 0; color: #B42318">Could not load the summary: ${error.message}</p>`;
  }
}
