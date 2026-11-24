// js/export.js
// "Download everything (Excel)": one file with a summary, a ranking sheet and a full marks
// sheet for each class, every score recorded, and every register taken.
// Used by the headmaster portal and the teacher dashboard.

import { getDocs, getDoc } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { schoolCol, schoolDoc, SCHOOL } from "./school.js";
import { classOrder } from "./levels.js";

export async function exportEverything() {

  // Loaded only when needed, so the dashboard stays quick
  const XLSX = await import("https://cdn.sheetjs.com/xlsx-latest/package/xlsx.mjs");
  const calc = await import("./report-calc.js");

  const [settingsDoc, attendSnap] = await Promise.all([
    getDoc(schoolDoc("settings", "report")),
    getDocs(schoolCol("attendance"))
  ]);
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
    [settings.term, "", "", "", ""],
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
      `Exam (${w.exam})`, "Total (100)", "Grade", "Remark", "Position in subject"
    ]];
    reports.forEach((r) => r.rows.forEach((row) => {
      const g = calc.gradeFor(settings, row.total);
      marks.push([r.student.name, row.subject, row.exam ?? "", row.classScore ?? "", row.hwScore ?? "",
        row.examScore ?? "", row.total, g.grade, g.remark, `${row.position} of ${row.outOf}`]);
    }));
    addSheet(`${cls.className} marks`, marks, [24, 20, 16, 14, 14, 10, 11, 7, 18, 18]);
  });

  // Every score recorded
  const names = Object.fromEntries(classes.flatMap((c) => c.students.map((s) => [s.id, s.name])));
  const scores = [["Date", "Class", "Subject", "Topic", "Type", "Student", "Score", "Out of", "Percent"]];
  assessments.slice().sort((a, b) => a.date.localeCompare(b.date) || classOrder(a, b))
    .forEach((a) => Object.entries(a.scores).forEach(([id, score]) => {
      scores.push([a.date, a.className, a.subject, a.topic, a.typeLabel, names[id] || id, score, a.maxScore,
        Math.round((score / a.maxScore) * 100)]);
    }));
  addSheet("All scores", scores, [12, 10, 18, 22, 15, 24, 8, 8, 9]);

  // Every register taken
  const registers = [["Date", "Class", "Present", "Late", "Absent", "Absent students"]];
  attendance.slice().sort((a, b) => a.date.localeCompare(b.date) || classOrder(a, b))
    .forEach((a) => registers.push([a.date, a.className, a.present, a.late, a.absent,
      Object.entries(a.records).filter(([, v]) => v === "A").map(([id]) => names[id] || id).join(", ")]));
  addSheet("Attendance", registers, [12, 10, 9, 7, 8, 50]);

  XLSX.writeFile(wb, `ClassPulse ${SCHOOL.name || "school"} ${new Date().toISOString().slice(0, 10)}.xlsx`);
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
