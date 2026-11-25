// js/parent-views.js
// Confidential parent views. Each child gets ONE private summary record:
//   schools/{schoolId}/childViews/{studentId}
// holding only that child's own scores, attendance and report card. A parent's page reads
// only this record, so they can never load another child's data. (The database rules make
// sure of it.) The headmaster portal refreshes these summaries; it uses data it has already
// loaded, so refreshing costs writes but no extra reads.

import { db } from "./firebase.js";
import { doc, getDoc, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { withDefaults, buildClassReports } from "./report-calc.js";

const REFRESH_AFTER_HOURS = 12;

// Build one child's private summary from their class's records
function childView(student, cls, assessments, attendance, report) {
  return {
    studentId: student.id,
    name: student.name,
    className: cls.className,
    // Only this child's own score in each assessment
    scores: assessments
      .filter((a) => a.className === cls.className && a.scores[student.id] !== undefined)
      .map((a) => ({ date: a.date, subject: a.subject, topic: a.topic, type: a.type, typeLabel: a.typeLabel, maxScore: a.maxScore, score: a.scores[student.id] })),
    // Only this child's own mark in each register
    attendance: attendance
      .filter((r) => r.className === cls.className && r.records[student.id] !== undefined)
      .map((r) => ({ date: r.date, mark: r.records[student.id] })),
    // The report card, without anyone else's details
    report: report ? {
      student: { id: student.id, name: student.name },
      cls: { className: cls.className },
      rows: report.rows, overall: report.overall, position: report.position, outOf: report.outOf,
      daysTotal: report.daysTotal, present: report.present, strong: report.strong, weak: report.weak,
      results: { change: report.results.change }
    } : null,
    updatedAt: serverTimestamp()
  };
}

// Write every child's summary for the given classes
export async function refreshParentViews(schoolId, classes, assessments, attendance, reportSettings) {
  const settings = withDefaults(reportSettings || {});
  const writes = [];
  classes.forEach((cls) => {
    if (!(cls.students || []).length) return;
    const { reports } = buildClassReports(cls, assessments, attendance, settings);
    cls.students.forEach((s) => {
      const report = reports.find((r) => r.student.id === s.id);
      writes.push([doc(db, "schools", schoolId, "childViews", s.id), childView(s, cls, assessments, attendance, report)]);
    });
  });
  for (let i = 0; i < writes.length; i += 400) {
    const batch = writeBatch(db);
    writes.slice(i, i + 400).forEach(([ref, data]) => batch.set(ref, data));
    await batch.commit();
  }
  const batch = writeBatch(db);
  batch.set(doc(db, "schools", schoolId, "settings", "parentViews"), { updatedAt: new Date().toISOString(), children: writes.length });
  await batch.commit();
  return writes.length;
}

// When were parent views last updated? (ISO text, or null)
export async function lastParentRefresh(schoolId) {
  const snap = await getDoc(doc(db, "schools", schoolId, "settings", "parentViews"));
  return snap.exists() ? snap.data().updatedAt : null;
}

export function needsRefresh(lastIso) {
  return !lastIso || Date.now() - new Date(lastIso).getTime() > REFRESH_AFTER_HOURS * 3600 * 1000;
}

// Turn a child's summary back into the shape the result tools expect
export function viewAsAssessments(view) {
  return (view.scores || []).map((s) => ({
    className: view.className, date: s.date, subject: s.subject, topic: s.topic, type: s.type,
    typeLabel: s.typeLabel, maxScore: s.maxScore, scores: { [view.studentId]: s.score }
  }));
}
