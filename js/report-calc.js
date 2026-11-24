// js/report-calc.js
// The end-of-term calculations, shared by Report cards and the Excel download,
// so both always give the same totals, grades and positions.

import { average, bandOf, resultsFor } from "./results.js";

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

  // Total out of 100. If something isn't recorded yet, scale up what we have (marked *).
  const have = parts.filter((p) => p.pct !== null && p.weight > 0);
  let total = null, provisional = false;
  if (have.length) {
    const got = have.reduce((n, p) => n + (p.pct / 100) * p.weight, 0);
    const possible = have.reduce((n, p) => n + p.weight, 0);
    total = Math.round((got / possible) * 100);
    provisional = possible < w.exam + w.classwork + w.homework;
    // When everything is recorded, the total is exactly the printed marks added up
    if (!provisional) total = marks.reduce((n, m, i) => n + (parts[i].weight > 0 ? m : 0), 0);
  }
  return { classScore, hwScore, exam, examScore, total, provisional };
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
