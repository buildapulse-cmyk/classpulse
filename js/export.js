// js/export.js
// "Download everything (Excel)": one file with a summary, a ranking sheet and a full marks
// sheet for each class, every score recorded, and every register taken.
// Used by the headmaster portal and the teacher dashboard.
// Scores and registers are cleared at the end of every term, so this file holds the current term.

import { getDocs, getDoc } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { schoolCol, schoolDoc, SCHOOL } from "./school.js";
import { classOrder } from "./levels.js";

export async function exportEverything({ termEnd = false } = {}) {

  // Loaded only when needed, so the dashboard stays quick
  const XLSX = await import("https://cdn.sheetjs.com/xlsx-latest/package/xlsx.mjs");
  const calc = await import("./report-calc.js");
  const yearTools = await import("./school-year.js");

  const [settingsDoc, attendSnap, yearDoc, targetDoc] = await Promise.all([
    getDoc(schoolDoc("settings", "report")),
    getDocs(schoolCol("attendance")),
    getDoc(schoolDoc("settings", "year")),
    getDoc(schoolDoc("settings", "targets"))
  ]);
  const targets = targetDoc.exists() ? targetDoc.data() : {};
  const year = yearTools.withYearDefaults(yearDoc.exists() ? yearDoc.data() : {}, targets);

  const settings = calc.withDefaults(settingsDoc.exists() ? settingsDoc.data() : {});
  const attendance = attendSnap.docs.map((d) => d.data());
  const [classSnap, assessSnap] = await Promise.all([getDocs(schoolCol("classes")), getDocs(schoolCol("assessments"))]);
  const classes = classSnap.docs.map((d) => d.data()).sort(classOrder);
  const assessments = assessSnap.docs.map((d) => d.data());
  const w = settings.weights;

  const wb = XLSX.utils.book_new();
  const addSheet = (name, rows, widths) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = widths.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, name.replace(/[\\/?*[\]:]/g, "-").slice(0, 31));
  };

  // Summary sheet
  const summary = [
    [settings.schoolName || SCHOOL.name || "ClassPulse", "", "", "", ""],
    [`Academic year ${year.academicYear} · Term ${year.term}${termEnd ? " · END OF TERM RECORDS" : ""}`, "", "", "", ""],
    [`Downloaded ${new Date().toLocaleString("en-GB")}`, "", "", "", ""],
    [],
    ["Class", "Students", "Class average (total)", "Top student", "Registers taken"]
  ];
  const built = classes.map((c) => ({ cls: c, ...calc.buildClassReports(c, assessments, attendance, settings) }));
  built.forEach(({ cls, reports }) => {
    const totals = reports.map((r) => r.overall).filter((v) => v !== null);
    const top = reports.find((r) => r.position === 1);
    summary.push([
      cls.className, cls.students.length,
      totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : "",
      top ? `${top.student.name} (${top.overall})` : "",
      attendance.filter((a) => a.className === cls.className).length
    ]);
  });
  addSheet("Summary", summary, [22, 10, 22, 30, 16]);

  // Term summary: every student's overall, position and attendance; each class's subject averages
  const termRows = [["Class", "Position", "Student", "Overall (100)", "Days present", "Days recorded"]];
  const subjectRows = [["Class", "Subject", "Average"]];
  yearTools.termSummaries(classes, assessments, attendance, settings).forEach((c) => {
    c.students.forEach((st) => termRows.push([c.className, st.position ?? "", st.name, st.overall ?? "", st.present, st.days]));
    c.subjects.forEach((sub) => subjectRows.push([c.className, sub.subject, sub.average]));
  });
  addSheet("Term summary", termRows, [12, 10, 26, 13, 12, 14]);
  addSheet("Subject averages", subjectRows, [12, 26, 10]);

  // For each class: a ranking sheet and a full marks sheet
  built.forEach(({ cls, subjects, reports }) => {
    const ranking = [[
      "Position", "Student", "Overall (100)", "Grade", "Remark", "Days present", "Days recorded",
      ...subjects.map((s) => `${s} total`), ...subjects.map((s) => `${s} exam (100)`)
    ]];
    reports.forEach((r) => {
      const g = r.overall === null ? null : calc.gradeFor(settings, r.overall);
      const bySubject = Object.fromEntries(r.rows.map((row) => [row.subject, row]));
      ranking.push([
        r.position ?? "", r.student.name, r.overall ?? "", g ? g.grade : "", g ? g.remark : "",
        r.present, r.daysTotal,
        ...subjects.map((s) => bySubject[s]?.total ?? ""),
        ...subjects.map((s) => bySubject[s]?.exam ?? "")
      ]);
    });
    addSheet(`${cls.className} ranking`, ranking, [9, 24, 13, 7, 18, 12, 14, ...subjects.map(() => 16), ...subjects.map(() => 18)]);

    const marks = [[
      "Student", "Subject", "Exam score (100)", `Class score (${w.classwork})`, `Homework (${w.homework})`,
      `Exam (${w.exam})`, "Total (100)", "Grade", "Remark", "Position in subject", "Note"
    ]];
    reports.forEach((r) => r.rows.forEach((row) => {
      const g = calc.gradeFor(settings, row.total);
      marks.push([r.student.name, row.subject, row.exam ?? "Not written", row.classScore ?? 0, row.hwScore ?? 0,
        row.examScore ?? 0, row.total, g.grade, g.remark, `${row.position} of ${row.outOf}`,
        row.missing.length ? `No ${row.missing.join(", ")} recorded (counted as 0)` : ""]);
    }));
    addSheet(`${cls.className} marks`, marks, [24, 20, 16, 14, 14, 10, 11, 7, 18, 18, 36]);
  });

  // Every score recorded
  const names = Object.fromEntries(classes.flatMap((c) => c.students.map((s) => [s.id, s.name])));
  const scores = [["Term", "Date", "Class", "Subject", "Topic", "Type", "Student", "Score", "Out of", "Percent"]];
  assessments.slice().sort((a, b) => a.date.localeCompare(b.date) || classOrder(a, b))
    .forEach((a) => Object.entries(a.scores).forEach(([id, score]) => {
      scores.push([year.term, a.date, a.className, a.subject, a.topic, a.typeLabel, names[id] || id, score, a.maxScore,
        Math.round((score / a.maxScore) * 100)]);
    }));
  addSheet("All scores", scores, [6, 12, 10, 18, 22, 15, 24, 8, 8, 9]);

  // Every register taken
  const registers = [["Term", "Date", "Class", "Present", "Late", "Absent", "Absent students"]];
  attendance.slice().sort((a, b) => a.date.localeCompare(b.date) || classOrder(a, b))
    .forEach((a) => registers.push([year.term, a.date, a.className, a.present, a.late, a.absent,
      Object.entries(a.records).filter(([, v]) => v === "A").map(([id]) => names[id] || id).join(", ")]));
  addSheet("Attendance", registers, [6, 12, 10, 9, 7, 8, 50]);

  const name = termEnd
    ? `ClassPulse ${SCHOOL.name || "school"} ${year.academicYear.replace("/", "-")} Term ${year.term}.xlsx`
    : `ClassPulse ${SCHOOL.name || "school"} ${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, name);
}

// Connect a button and a status line to the download
export function exportButton(button, statusEl) {
  button.addEventListener("click", async () => {
    button.disabled = true;
    statusEl.style.color = "#12305A";
    statusEl.textContent = "Preparing your Excel file…";
    try {
      await exportEverything();
      statusEl.style.color = "#157F3B";
      statusEl.textContent = "Excel file downloaded ✓ — check your Downloads folder.";
    } catch (error) {
      statusEl.style.color = "#B42318";
      statusEl.textContent = "Could not make the Excel file: " + error.message;
    } finally {
      button.disabled = false;
    }
  });
}
