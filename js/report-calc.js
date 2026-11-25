// js/report-calc.js
// The end-of-term calculations, shared by Report cards and the Excel download,
// so both always give the same totals, grades and positions.

import { average, bandOf, resultsFor, BANDS, ordinal } from "./results.js";

// Starting settings (the teacher can change these in Report settings)
export const DEFAULT_SETTINGS = {
  schoolName: "",
  term: "Term 1 · 2026/2027",
  badge: null,                                        // picture of the school badge
  weights: { exam: 50, classwork: 40, homework: 10 }, // must add up to 100
  bestOf: { classwork: 5, homework: 5 },              // count only the best 5 (0 = count all)
  grades: [                                           // from the top score down
    { min: 80, grade: "A", remark: "Excellent" },
    { min: 70, grade: "B", remark: "Very good" },
    { min: 60, grade: "C", remark: "Good" },
    { min: 50, grade: "D", remark: "Credit" },
    { min: 40, grade: "E", remark: "Pass" },
    { min: 0,  grade: "F", remark: "Fail" }
  ]
};

// Mix saved settings with the defaults (so older saved settings still work)
export function withDefaults(saved = {}) {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    ...saved,
    weights: { ...DEFAULT_SETTINGS.weights, ...(saved.weights || {}) },
    bestOf: { ...DEFAULT_SETTINGS.bestOf, ...(saved.bestOf || {}) },
    grades: saved.grades && saved.grades.length ? saved.grades : structuredClone(DEFAULT_SETTINGS.grades)
  };
}

export const sortedGrades = (settings) => settings.grades.slice().sort((a, b) => b.min - a.min);
export const gradeFor = (settings, pct) => {
  const g = sortedGrades(settings);
  return g.find((x) => pct >= x.min) || g[g.length - 1];
};

// One subject for one student. Exam is out of 100; class score and homework use the best N.
export function subjectRow(studentId, list, settings) {
  const mine = list.filter((a) => a.scores[studentId] !== undefined);
  const percentsOf = (type) => mine.filter((a) => a.type === type).map((a) => (a.scores[studentId] / a.maxScore) * 100);
  const best = (l, n) => (n > 0 ? l.slice().sort((a, b) => b - a).slice(0, n) : l);

  const classUsed = best([...percentsOf("ex"), ...percentsOf("ct")], settings.bestOf.classwork);
  const hwUsed = best(percentsOf("hw"), settings.bestOf.homework);
  const examList = percentsOf("exam");

  const classPct = classUsed.length ? average(classUsed) : null;
  const hwPct = hwUsed.length ? average(hwUsed) : null;
  const exam = examList.length ? Math.round(average(examList)) : null; // exam out of 100

  const w = settings.weights;
  const parts = [
    { pct: classPct, weight: w.classwork },
    { pct: hwPct, weight: w.homework },
    { pct: exam, weight: w.exam }
  ];
  const marks = parts.map((p) => (p.pct === null ? null : Math.round((p.pct / 100) * p.weight)));
  const [classScore, hwScore, examScore] = marks;

  // Total out of 100 = exactly the marks shown added up (class score + homework + exam).
  // Anything not recorded counts as 0, so the total always matches what is printed.
  const have = parts.filter((p) => p.pct !== null && p.weight > 0);
  let total = null;
  if (have.length) total = marks.reduce((n, m, i) => n + (parts[i].weight > 0 && m !== null ? m : 0), 0);
  // Which parts are missing (e.g. the student didn't write the exam)
  const missing = [["exam", exam], ["class score", classScore], ["homework", hwScore]]
    .filter(([, v]) => v === null).map(([name]) => name);
  return { classScore, hwScore, exam, examScore, total, missing };
}

// Everything for one class: each student's report, positions and the class order
export function buildClassReports(cls, assessments, attendance, settings) {
  const classList = assessments.filter((a) => a.className === cls.className);
  const subjects = [...new Set(classList.map((a) => a.subject))].sort();
  const lists = Object.fromEntries(subjects.map((s) => [s, classList.filter((a) => a.subject === s)]));

  // Every student's row for every subject
  const table = cls.students.map((s) => ({
    student: s,
    rows: Object.fromEntries(subjects.map((sub) => [sub, subjectRow(s.id, lists[sub], settings)]))
  }));

  const reports = table.map(({ student, rows }) => {
    const subjectRows = subjects.map((sub) => {
      const row = rows[sub];
      if (row.total === null) return null;
      const totals = table.map((t) => t.rows[sub].total).filter((v) => v !== null);
      return { subject: sub, ...row, position: totals.filter((v) => v > row.total).length + 1, outOf: totals.length };
    }).filter(Boolean);

    const overall = subjectRows.length ? Math.round(average(subjectRows.map((r) => r.total))) : null;

    const days = attendance.filter((a) => a.className === cls.className && a.records[student.id] !== undefined);
    const present = days.filter((a) => a.records[student.id] !== "A").length;

    const results = resultsFor(student.id, classList, true);
    const strong = results.topics[0] || null;
    const lowest = results.topics[results.topics.length - 1];
    const weak = results.topics.length > 1 && lowest.average < strong.average ? lowest : null;

    return { student, cls, subjects, rows: subjectRows, overall, daysTotal: days.length, present, strong, weak, results };
  });

  // Position in class by overall total (equal totals share a place)
  const overalls = reports.map((r) => r.overall).filter((v) => v !== null);
  reports.forEach((r) => {
    r.position = r.overall === null ? null : overalls.filter((v) => v > r.overall).length + 1;
    r.outOf = overalls.length;
  });

  // Highest first; students with no scores at the end
  reports.sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1) || a.student.name.localeCompare(b.student.name));
  return { subjects, reports };
}

// A kind, honest remark, written automatically
export function remarkFor(r) {
  const name = r.student.name.split(" ")[0];
  if (r.overall === null) return `${name} has no scores recorded yet this term.`;
  const band = bandOf(r.overall);
  const lines = [];
  if (band === "above") lines.push(`${name} has worked very hard this term and achieved excellent results.`);
  else if (band === "average") lines.push(`${name} has made good progress this term.`);
  else lines.push(`${name} has tried this term and can do much better with steady practice and support.`);
  if (r.strong) lines.push(`${name} is strongest in ${r.strong.name}.`);
  if (r.weak) lines.push(`More practice on ${r.weak.name} will help next term.`);
  if (r.results.change >= 5) lines.push(`Well done on improving through the term — keep it up!`);
  if (r.daysTotal && r.present / r.daysTotal < 0.9) lines.push(`Coming to school every day will help ${name} even more.`);
  return lines.join(" ");
}

// ---------- The report card itself (used by Report cards and the parent page) ----------
function gradeScaleText(settings) {
  const g = sortedGrades(settings);
  return g.map((x, i) => `${x.grade} ${i === 0 ? `${x.min}–100` : `${x.min}–${g[i - 1].min - 1}`} ${x.remark}`).join(" · ");
}

export function reportCardHtml(r, settings, schoolName = "") {
  const w = settings.weights;
  const school = (settings.schoolName || "").trim() || schoolName || "[SCHOOL NAME]";
  const show = (v) => (v === null ? "—" : v);
  const overallBand = r.overall === null ? null : BANDS[bandOf(r.overall)];
  const overallGrade = r.overall === null ? null : gradeFor(settings, r.overall);
  const badge = settings.badge
    ? `<img src="${settings.badge}" alt="${school} badge" style="width: 72px; height: 72px; object-fit: contain">`
    : `<img src="images/logo-mark.svg" alt="" width="56" height="56">`;

  const tableRows = r.rows.map((row) => {
    const g = gradeFor(settings, row.total);
    const b = BANDS[bandOf(row.total)];
    return `<tr>
      <td style="font-weight: 600">${row.subject}</td>
      <td style="font-weight: 800; font-size: 16px; background: #FFF8E6">${show(row.exam)}</td>
      <td>${show(row.classScore)}</td>
      <td>${show(row.hwScore)}</td>
      <td>${show(row.examScore)}</td>
      <td style="font-weight: 800; color: ${b.color}">${row.total}</td>
      <td style="font-weight: 800">${g.grade}</td>
      <td>${ordinal(row.position)} of ${row.outOf}</td>
      <td style="text-align: left">${g.remark}</td>
    </tr>`;
  }).join("");

  return `
  <article class="report">
    <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 16px; padding-bottom: 18px; border-bottom: 3px solid #12305A">
      <div style="display: flex; align-items: center; gap: 14px">
        ${badge}
        <div style="display: flex; flex-direction: column; gap: 2px">
          <span style="font-family: 'Space Grotesk', sans-serif; font-size: 24px; font-weight: 700">${school}</span>
          ${settings.motto ? `<span style="font-size: 13px; font-style: italic; color: #5B6472">${settings.motto}</span>` : ""}
          <span style="font-size: 13px; color: #5B6472">Student progress report</span>
        </div>
      </div>
      <div style="display: flex; flex-direction: column; gap: 4px; text-align: right">
        <span style="font-size: 13px; letter-spacing: 0.1em; text-transform: uppercase; color: #8A5A00; font-weight: 700">${r.rows.length && r.rows.every((row) => row.exam !== null) ? "Terminal report" : "Report so far"}</span>
        <span style="font-size: 14px">${settings.term}</span>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px">
      <div style="display: flex; flex-direction: column; gap: 2px"><span style="font-size: 12px; color: #5B6472">Student</span><strong>${r.student.name}</strong></div>
      <div style="display: flex; flex-direction: column; gap: 2px"><span style="font-size: 12px; color: #5B6472">Class</span><strong>${r.cls.className}</strong></div>
      <div style="display: flex; flex-direction: column; gap: 2px"><span style="font-size: 12px; color: #5B6472">Attendance</span><strong>${r.daysTotal ? `${r.present} of ${r.daysTotal} days` : "Not recorded"}</strong></div>
      <div style="display: flex; flex-direction: column; gap: 2px"><span style="font-size: 12px; color: #5B6472">Position in class</span><strong>${r.position ? `${ordinal(r.position)} of ${r.outOf}` : "—"}</strong></div>
      <div style="display: flex; flex-direction: column; gap: 2px"><span style="font-size: 12px; color: #5B6472">Overall</span><strong style="color: ${overallBand ? overallBand.color : "#12305A"}">${r.overall === null ? "—" : `${r.overall}% · ${overallGrade.grade} · ${overallGrade.remark}`}</strong></div>
    </div>

    ${r.rows.length === 0 ? '<p style="margin: 0; color: #5B6472">No scores recorded yet.</p>' : `
    <div style="overflow-x: auto">
      <table>
        <thead><tr>
          <th>Subject</th><th>Exam score (100)</th>
          <th>Class score (${w.classwork})</th><th>Homework (${w.homework})</th><th>Exam (${w.exam})</th>
          <th>Total (100)</th><th>Grade</th><th>Position</th><th style="text-align: left">Remark</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>`}
    <p style="margin: 0; font-size: 12px; color: #5B6472">Grades: ${gradeScaleText(settings)}${r.rows.length && r.rows.every((row) => row.exam !== null) ? "" : " · This report fills up during the term and is final after the exams."}</p>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px">
      <div style="display: flex; flex-direction: column; gap: 6px; padding: 14px; border: 1px solid #E2E7EF; border-radius: 8px">
        <span style="font-size: 12px; color: #5B6472; font-weight: 600">Strongest topic</span>
        <span style="font-weight: 600">${r.strong ? `${r.strong.name} (${r.strong.average}%)` : "—"}</span>
        <span style="font-size: 12px; color: #5B6472; font-weight: 600; margin-top: 6px">Needs more practice</span>
        <span style="font-weight: 600">${r.weak ? `${r.weak.name} (${r.weak.average}%)` : "—"}</span>
      </div>
      <div style="display: flex; flex-direction: column; gap: 6px; padding: 14px; border: 1px solid #E2E7EF; border-radius: 8px">
        <span style="font-size: 12px; color: #5B6472; font-weight: 600">Class teacher's remarks</span>
        <p style="margin: 0; font-size: 14px; line-height: 1.6">${remarkFor(r)}</p>
      </div>
    </div>

    <div style="display: flex; flex-wrap: wrap; justify-content: space-between; gap: 24px; padding-top: 20px">
      <span style="flex: 1 1 180px; border-top: 1px solid #12305A; padding-top: 6px; font-size: 13px">Class teacher's signature</span>
      <span style="flex: 1 1 180px; border-top: 1px solid #12305A; padding-top: 6px; font-size: 13px">Head teacher's signature</span>
      <span style="flex: 1 1 180px; border-top: 1px solid #12305A; padding-top: 6px; font-size: 13px">Next term begins: ____________</span>
    </div>
  </article>`;
}

