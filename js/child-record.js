// js/child-record.js
// A child's full record, laid out like a report card, for families and the school to keep:
//   page 1: the report card (so far, or final after the exams)
//   page 2: every assessment (date, subject, type, topic, score) and the attendance
// It downloads as one web page file; open it and choose Print → "Save as PDF" to keep a PDF.
//
// Also: removing a child COMPLETELY (when they leave the school or finish JHS 3) —
// their scores, registers, private parent summary, and their parent's login and PIN
// (unless that parent has another child still in the school).

import { db } from "./firebase.js";
import { getDocs, getDoc, doc, query, where, collection, writeBatch, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { schoolCol, schoolDoc, SCHOOL } from "./school.js";
import { reportCardHtml, buildClassReports, withDefaults } from "./report-calc.js";
import { BANDS, bandOf, shortDate } from "./results.js";

const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const MARKS = { P: "Present", A: "Absent", L: "Late" };

// ---------- One child's record (two pages) ----------
// rec = { report, scores: [{date, subject, type, typeLabel, topic, score, maxScore}], attendance: [{date, mark}] }
function recordPages(rec, settings, schoolName) {
  const name = rec.report.student.name;
  const scores = rec.scores.slice().sort((a, b) => a.subject.localeCompare(b.subject) || a.date.localeCompare(b.date));
  const days = rec.attendance.slice().sort((a, b) => a.date.localeCompare(b.date));
  const count = (m) => days.filter((d) => d.mark === m).length;
  const absent = days.filter((d) => d.mark !== "P");

  const rows = scores.map((s) => {
    const pct = Math.round((s.score / s.maxScore) * 100);
    return `<tr><td>${shortDate(s.date)}</td><td>${esc(s.subject)}</td><td>${esc(s.typeLabel)}</td><td style="text-align: left">${esc(s.topic || "—")}</td>
      <td style="font-weight: 700">${s.score} / ${s.maxScore}</td><td style="font-weight: 700; color: ${BANDS[bandOf(pct)].color}">${pct}%</td></tr>`;
  }).join("");

  return reportCardHtml(rec.report, settings, schoolName) + `
  <article class="report">
    <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 12px; padding-bottom: 14px; border-bottom: 3px solid #12305A">
      <span style="font-family: 'Space Grotesk', sans-serif; font-size: 22px; font-weight: 700">${esc(name)} · every assessment</span>
      <span style="font-size: 14px">${esc(rec.report.cls.className)} · ${esc(settings.term)}</span>
    </div>
    ${scores.length ? `<div style="overflow-x: auto"><table>
      <thead><tr><th>Date</th><th>Subject</th><th>Type</th><th style="text-align: left">Topic</th><th>Score</th><th>Percent</th></tr></thead>
      <tbody>${rows}</tbody></table></div>` : '<p style="margin: 0; color: #5B6472">No assessments recorded this term.</p>'}
    <div style="display: flex; flex-direction: column; gap: 8px">
      <strong style="font-size: 16px">Attendance</strong>
      <span>${days.length ? `Present ${count("P")} · Late ${count("L")} · Absent ${count("A")} — out of ${days.length} school days` : "Not recorded this term."}</span>
      ${absent.length ? `<span style="font-size: 13px; color: #5B6472">${absent.map((d) => `${shortDate(d.date)} (${MARKS[d.mark]})`).join(" · ")}</span>` : ""}
    </div>
    <p style="margin: 0; font-size: 12px; color: #5B6472">Downloaded from ClassPulse on ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}. Keep this record safe.</p>
  </article>`;
}

// A whole web page holding one or more children's records
function recordDocument(records, settings, title, logo) {
  const body = records.map((rec) => recordPages(rec, settings, SCHOOL.name)).join("").replaceAll('src="images/logo-mark.svg"', `src="${logo}"`);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
body{margin:0;background:#F6F8FB;font-family:Inter,system-ui,Arial,sans-serif;color:#12305A}
main{max-width:920px;margin:0 auto;padding:24px 16px 48px;display:flex;flex-direction:column;gap:24px}
.bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;background:#12305A;color:#FFFFFF;padding:14px 18px;border-radius:12px}
.bar button{height:44px;padding:0 18px;border-radius:10px;border:none;background:#F2A300;color:#12305A;font-weight:700;font-size:15px;cursor:pointer}
.report{max-width:880px;width:100%;margin:0 auto;background:#FFFFFF;border:1px solid #E2E7EF;border-radius:6px;padding:40px;box-sizing:border-box;display:flex;flex-direction:column;gap:22px}
.report table{width:100%;min-width:600px;border-collapse:collapse;font-size:14px}
.report th{background:#12305A;color:#FFFFFF;padding:10px 8px;font-weight:600}
.report td{padding:9px 8px;border-bottom:1px solid #E2E7EF;text-align:center}
.report td:first-child,.report th:first-child{text-align:left}
@media print{
  .bar{display:none}
  body{background:#FFFFFF}
  main{padding:0;max-width:none}
  .report{border:none;border-radius:0;padding:0;page-break-after:always;break-after:page}
  .report:last-child{page-break-after:auto;break-after:auto}
  .report th{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
</style></head>
<body><main>
<div class="bar"><span><strong>${esc(title)}</strong><br><span style="font-size:13px;color:#C9D2DF">To keep a PDF: click the button, then choose "Save as PDF".</span></span><button type="button" onclick="window.print()">Print / Save as PDF</button></div>
${body}
</main></body></html>`;
}

// The ClassPulse logo is put inside the file, so the record looks right even offline
let logoData = null;
async function logoInside() {
  if (logoData) return logoData;
  try {
    const svg = await (await fetch("images/logo-mark.svg")).text();
    logoData = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  } catch (error) {
    logoData = new URL("images/logo-mark.svg", location.href).href;
  }
  return logoData;
}

export async function downloadRecords(records, settings, title) {
  const html = recordDocument(records, settings, title, await logoInside());
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.replace(/[\\/:*?"<>|]+/g, "-")}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---------- Records from the school's data (headmaster) ----------
export async function loadSchoolRecords(classList, onlyIds = null) {
  const [settingsDoc, assessSnap, attendSnap] = await Promise.all([
    getDoc(schoolDoc("settings", "report")), getDocs(schoolCol("assessments")), getDocs(schoolCol("attendance"))
  ]);
  const settings = withDefaults(settingsDoc.exists() ? settingsDoc.data() : {});
  const assessments = assessSnap.docs.map((d) => d.data());
  const attendance = attendSnap.docs.map((d) => d.data());
  const records = [];
  classList.forEach((cls) => {
    if (!(cls.students || []).length) return;
    const { reports } = buildClassReports(cls, assessments, attendance, settings);
    reports.forEach((r) => {
      if (onlyIds && !onlyIds.has(r.student.id)) return;
      records.push({
        report: r,
        scores: assessments.filter((a) => a.className === cls.className && a.scores[r.student.id] !== undefined)
          .map((a) => ({ date: a.date, subject: a.subject, type: a.type, typeLabel: a.typeLabel, topic: a.topic, score: a.scores[r.student.id], maxScore: a.maxScore })),
        attendance: attendance.filter((a) => a.className === cls.className && a.records[r.student.id] !== undefined)
          .map((a) => ({ date: a.date, mark: a.records[r.student.id] }))
      });
    });
  });
  return { records, settings };
}

// ---------- A parent's copy, from their child's private summary ----------
export function recordFromView(view) {
  return {
    report: view.report || { student: { id: view.studentId, name: view.name }, cls: { className: view.className }, rows: [], overall: null, position: null, outOf: 0, daysTotal: 0, present: 0, strong: null, weak: null, results: { change: 0 } },
    scores: view.scores || [],
    attendance: view.attendance || []
  };
}

// ---------- Remove children completely ----------
// students: [{ id, name, className }]. Removes them from their classes, their scores and
// registers, their private parent summary, and unlinks their parents. A parent left with no
// child in the school loses their login and PIN.
export async function removeChildrenCompletely(students, { keepClassLists = false } = {}) {
  if (!students.length) return;
  const ids = new Set(students.map((s) => s.id));
  const ops = [];

  // Class lists
  if (!keepClassLists) {
    const classSnap = await getDocs(schoolCol("classes"));
    classSnap.docs.forEach((d) => {
      const c = d.data();
      if (!(c.students || []).some((s) => ids.has(s.id))) return;
      ops.push(["set", d.ref, { students: c.students.filter((s) => !ids.has(s.id)), removedIds: [...(c.removedIds || []), ...[...ids].filter((id) => c.students.some((s) => s.id === id))], updatedAt: serverTimestamp() }]);
    });
  }

  // Scores and registers: take the child out of each record (and fix the class average)
  const [assessSnap, attendSnap, parentSnap, pinDoc] = await Promise.all([
    getDocs(schoolCol("assessments")), getDocs(schoolCol("attendance")),
    getDocs(query(collection(db, "users"), where("schoolId", "==", SCHOOL.id), where("role", "==", "parent"))),
    getDoc(schoolDoc("private", "pins"))
  ]);
  assessSnap.docs.forEach((d) => {
    const a = d.data();
    if (!Object.keys(a.scores || {}).some((id) => ids.has(id))) return;
    const scores = Object.fromEntries(Object.entries(a.scores).filter(([id]) => !ids.has(id)));
    const vals = Object.values(scores);
    if (vals.length === 0) return ops.push(["delete", d.ref]);
    ops.push(["update", d.ref, { scores, recorded: vals.length, averagePercent: Math.round((vals.reduce((x, y) => x + y, 0) / vals.length / a.maxScore) * 100) }]);
  });
  attendSnap.docs.forEach((d) => {
    const a = d.data();
    if (!Object.keys(a.records || {}).some((id) => ids.has(id))) return;
    const records = Object.fromEntries(Object.entries(a.records).filter(([id]) => !ids.has(id)));
    const marks = Object.values(records);
    if (marks.length === 0) return ops.push(["delete", d.ref]);
    ops.push(["update", d.ref, { records, present: marks.filter((m) => m === "P").length, absent: marks.filter((m) => m === "A").length, late: marks.filter((m) => m === "L").length }]);
  });

  // The child's own records
  ids.forEach((id) => {
    ops.push(["delete", schoolDoc("students", id)]);
    ops.push(["delete", schoolDoc("childViews", id)]);
  });

  // Parents: unlink; remove the login and PIN of a parent with no child left
  const pins = pinDoc.exists() ? pinDoc.data() : {};
  const pinChanges = {};
  for (const d of parentSnap.docs) {
    const p = d.data();
    if (!(p.childIds || []).some((id) => ids.has(id))) continue;
    const children = (p.children || []).filter((k) => !ids.has(k.id));
    if (children.length) {
      ops.push(["update", d.ref, { children, childIds: children.map((k) => k.id) }]);
    } else {
      ops.push(["delete", d.ref]);
      if (p.username && !p.replacedBy) {
        const login = await getDoc(doc(db, "parentLogins", p.username));
        if (login.exists()) ops.push(["delete", login.ref]);
      }
      if (pins[`parent-${d.id}`] !== undefined) pinChanges[`parent-${d.id}`] = null;
    }
  }
  if (Object.keys(pinChanges).length) ops.push(["set", schoolDoc("private", "pins"), pinChanges]);

  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(db);
    ops.slice(i, i + 400).forEach(([kind, ref, data]) =>
      kind === "delete" ? batch.delete(ref) : kind === "update" ? batch.update(ref, data) : batch.set(ref, data, { merge: true }));
    await batch.commit();
  }
}
