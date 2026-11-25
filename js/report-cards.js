// js/report-cards.js
// End-of-term report cards, filled in automatically from the attendance and scores in the database.
// Pick a class and press "Print all report cards" — every student prints on their own page.
// The calculations live in report-calc.js (shared with the Excel download).

import { db } from "./firebase.js";
import {
  collection, getDocs, query, where, doc, getDoc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { BANDS, bandOf, ordinal } from "./results.js";
import { withDefaults, sortedGrades, gradeFor, buildClassReports, remarkFor, reportCardHtml } from "./report-calc.js";

import { useSchool, schoolCol, schoolDoc, SCHOOL } from "./school.js";
import { classOrder, groupedOptions } from "./levels.js";
import { loadSchoolRecords, downloadRecords } from "./child-record.js";

// Report cards are the headmaster's job (and the admin's)
await useSchool("headmaster");

const $ = (id) => document.getElementById(id);
const classSelect = $("rc-class");
const studentSelect = $("rc-student");
const statusText = $("rc-status");
const reportsBox = $("reports");

let settings = withDefaults();
let classes = [];
let assessments = [];
let attendance = [];

// ---------- Records to keep: each child's report card + every assessment, for the whole class ----------
$("records-btn").addEventListener("click", async () => {
  const cls = currentClass();
  $("records-btn").disabled = true;
  statusText.style.color = "#12305A";
  statusText.textContent = `Preparing records for ${cls.className}…`;
  try {
    const { records, settings: s } = await loadSchoolRecords([cls]);
    await downloadRecords(records, s, `${cls.className} - ${s.term} - ClasPules records`);
    statusText.style.color = "#157F3B";
    statusText.textContent = `Downloaded ${records.length} records for ${cls.className} ✓ Open the file and choose "Save as PDF" to keep a copy.`;
  } catch (error) {
    statusText.style.color = "#B42318";
    statusText.textContent = "Could not make the records: " + error.message;
  } finally {
    $("records-btn").disabled = false;
  }
});

// ---------- Load ----------
async function load() {
  try {
    const [settingsDoc, classSnap, assessSnap] = await Promise.all([
      getDoc(schoolDoc("settings", "report")),
      getDocs(schoolCol("classes")),
      getDocs(schoolCol("assessments"))
    ]);
    settings = withDefaults(settingsDoc.exists() ? settingsDoc.data() : {});
    classes = classSnap.docs.map((d) => d.data()).sort(classOrder);
    assessments = assessSnap.docs.map((d) => d.data());

    fillSettingsForm();
    classSelect.innerHTML = groupedOptions(classes.map((c) => c.className));
    await changeClass();
  } catch (error) {
    statusText.style.color = "#B42318";
    statusText.textContent = "Could not load report data: " + error.message;
  }
}

const currentClass = () => classes.find((c) => c.className === classSelect.value) || { className: "", students: [] };

async function changeClass() {
  const cls = currentClass();
  const snap = await getDocs(query(schoolCol("attendance"), where("className", "==", cls.className)));
  attendance = snap.docs.map((d) => d.data());
  render();
}

// ---------- Draw ----------
let classReports = [];

function render() {
  const cls = currentClass();
  classReports = buildClassReports(cls, assessments, attendance, settings).reports;

  // "Show on screen" list, in order of position
  const keep = studentSelect.value;
  studentSelect.innerHTML = '<option value="all">All students (in order of position)</option>' +
    classReports.map((r) => `<option value="${r.student.id}">${r.position ? ordinal(r.position) + " — " : ""}${r.student.name}</option>`).join("");
  studentSelect.value = [...studentSelect.options].some((o) => o.value === keep) ? keep : "all";

  showOnScreen();
}

function showOnScreen() {
  const list = studentSelect.value === "all" ? classReports : classReports.filter((r) => r.student.id === studentSelect.value);
  reportsBox.innerHTML = list.map(reportHtml).join("") || '<p style="color: #5B6472">No students in this class.</p>';
  statusText.style.color = "#5B6472";
  statusText.textContent = `${classReports.length} report cards ready for ${currentClass().className}.`;
}

// Print every student in the class, whatever is showing on screen
function printAll() {
  reportsBox.innerHTML = classReports.map(reportHtml).join("");
  window.print();
  showOnScreen();
}

const reportHtml = (r) => reportCardHtml(r, settings, SCHOOL.name);

// ---------- Report settings form ----------
const inputStyle = "height: 40px; padding: 0 10px; border: 1px solid #C9D2DF; border-radius: 8px; font-size: 14px; font-family: inherit; box-sizing: border-box";

function fillSettingsForm() {
  $("rc-school").value = settings.schoolName || SCHOOL.name || "";
  $("rc-term").value = settings.term;
  $("w-exam").value = settings.weights.exam;
  $("w-class").value = settings.weights.classwork;
  $("w-hw").value = settings.weights.homework;
  $("best-class").value = settings.bestOf.classwork;
  $("best-hw").value = settings.bestOf.homework;
  showBadge();
  drawGradeRows();
  checkWeights();
}

function showBadge() {
  $("badge-preview").innerHTML = settings.badge
    ? `<img src="${settings.badge}" alt="School badge" style="width: 100%; height: 100%; object-fit: contain">`
    : "No badge";
}

function drawGradeRows() {
  $("grade-rows").innerHTML = sortedGrades(settings).map((g, i) => `
    <div class="grade-row" style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px">
      <label style="font-size: 13px">From <input class="g-min" type="number" min="0" max="100" value="${g.min}" aria-label="Lowest score for grade ${g.grade}" style="${inputStyle}; width: 76px"> %</label>
      <label style="font-size: 13px">Grade <input class="g-grade" type="text" value="${g.grade}" maxlength="3" aria-label="Grade letter" style="${inputStyle}; width: 64px"></label>
      <label style="font-size: 13px; flex: 1 1 200px; display: flex; align-items: center; gap: 6px">Remark <input class="g-remark" type="text" value="${g.remark}" aria-label="Remark for this grade" style="${inputStyle}; flex: 1"></label>
      <button type="button" class="g-remove" data-i="${i}" aria-label="Remove grade ${g.grade}" style="width: 40px; height: 40px; border-radius: 8px; border: 1px solid #C9D2DF; background: #FFFFFF; color: #12305A; font-size: 18px; cursor: pointer">×</button>
    </div>`).join("");
  document.querySelectorAll(".g-remove").forEach((b) => b.addEventListener("click", () => {
    settings.grades = readGradeRows().filter((_, i) => i !== Number(b.dataset.i));
    drawGradeRows();
  }));
}

function readGradeRows() {
  return [...document.querySelectorAll(".grade-row")].map((row) => ({
    min: Number(row.querySelector(".g-min").value),
    grade: row.querySelector(".g-grade").value.trim(),
    remark: row.querySelector(".g-remark").value.trim()
  }));
}

function readWeights() {
  return { exam: Number($("w-exam").value) || 0, classwork: Number($("w-class").value) || 0, homework: Number($("w-hw").value) || 0 };
}

function checkWeights() {
  const w = readWeights();
  const sum = w.exam + w.classwork + w.homework;
  const el = $("w-total");
  el.textContent = sum === 100 ? "Adds up to 100 ✓" : `Adds up to ${sum} — it must be 100`;
  el.style.color = sum === 100 ? "#157F3B" : "#B42318";
  return sum === 100;
}

// Shrink the badge picture so it is small enough to save in the database
function resizeImage(file, maxSize = 240) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("That file isn't a picture we can read."));
    img.src = URL.createObjectURL(file);
  });
}

function settingsStatus(text, color) {
  $("settings-status").textContent = text;
  $("settings-status").style.color = color;
}

$("badge-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    settings.badge = await resizeImage(file);
    showBadge();
    render();
    settingsStatus("Badge added — click Save settings to keep it.", "#8A5A00");
  } catch (error) {
    settingsStatus(error.message, "#B42318");
  }
  e.target.value = "";
});

$("badge-remove").addEventListener("click", () => {
  settings.badge = null;
  showBadge();
  render();
  settingsStatus("Badge removed — click Save settings to keep this.", "#8A5A00");
});

$("grade-add").addEventListener("click", () => {
  settings.grades = [...readGradeRows(), { min: 0, grade: "", remark: "" }];
  drawGradeRows();
});

["w-exam", "w-class", "w-hw"].forEach((id) => $(id).addEventListener("input", checkWeights));

$("settings-save").addEventListener("click", async () => {
  if (!checkWeights()) {
    settingsStatus("The three percentages must add up to 100.", "#B42318");
    return;
  }
  const grades = readGradeRows();
  if (grades.some((g) => !g.grade || isNaN(g.min) || g.min < 0 || g.min > 100)) {
    settingsStatus("Every grade needs a letter and a starting score from 0 to 100.", "#B42318");
    return;
  }
  if (new Set(grades.map((g) => g.min)).size !== grades.length) {
    settingsStatus("Two grades start at the same score. Each one needs a different starting score.", "#B42318");
    return;
  }
  if (!grades.some((g) => g.min === 0)) {
    settingsStatus("The lowest grade must start at 0, so every score gets a grade.", "#B42318");
    return;
  }

  settings.schoolName = $("rc-school").value.trim();
  settings.term = $("rc-term").value.trim();
  settings.weights = readWeights();
  settings.bestOf = {
    classwork: Math.max(0, Math.round(Number($("best-class").value) || 0)),
    homework: Math.max(0, Math.round(Number($("best-hw").value) || 0))
  };
  settings.grades = grades.sort((a, b) => b.min - a.min);

  settingsStatus("Saving…", "#12305A");
  try {
    await setDoc(schoolDoc("settings", "report"), { ...settings, updatedAt: serverTimestamp() });
    drawGradeRows();
    render();
    settingsStatus("Settings saved ✓", "#157F3B");
  } catch (error) {
    settingsStatus("Could not save: " + error.message, "#B42318");
  }
});

// ---------- Events ----------
classSelect.addEventListener("change", changeClass);
studentSelect.addEventListener("change", showOnScreen);
$("print-btn").addEventListener("click", printAll);

load();
