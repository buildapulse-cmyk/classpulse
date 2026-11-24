// js/attendance.js
// Loads students from the database and saves each day's attendance.

import { db } from "./firebase.js";
import {
  doc, getDoc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { fillClassSelect } from "./classes.js";

import { useSchool, schoolCol, schoolDoc } from "./school.js";

// Teachers only (the headmaster sees progress on the headmaster portal instead)
await useSchool("teacher");

const classSelect = document.getElementById("att-class");
const dateInput = document.getElementById("att-date");
const list = document.getElementById("student-list");
const saveBtn = document.getElementById("save-btn");
const saveStatus = document.getElementById("save-status");

let students = [];   // [{ id, name }]
let marks = {};      // { studentId: "P" | "A" | "L" }

// Start on today's date
dateInput.value = new Date().toISOString().slice(0, 10);


// Turns "JHS 2A" into "jhs-2a"
const makeId = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-");

// One record per class per day, e.g. "jhs-2a_2026-11-20"
function attendanceId() {
  return `${makeId(classSelect.value)}_${dateInput.value}`;
}

function showStatus(text, color) {
  saveStatus.textContent = text;
  saveStatus.style.color = color;
}

// Load the class list, and any attendance already saved for that day
async function loadClass() {
  list.innerHTML = '<p style="color: #5B6472">Loading students…</p>';
  showStatus("", "");

  try {
    // The class record holds the whole class list, so this is just 1 read
    const classDoc = await getDoc(schoolDoc("classes", makeId(classSelect.value)));
    students = classDoc.exists() ? classDoc.data().students : [];

    const saved = await getDoc(schoolDoc("attendance", attendanceId()));
    marks = saved.exists() ? saved.data().records : {};
    if (saved.exists()) showStatus("Showing attendance already saved for this day.", "#1E5AA8");

    drawList();
  } catch (error) {
    list.innerHTML = `<p style="color: #B42318; font-weight: 600">Could not load students: ${error.message}</p>`;
  }
}

function drawList() {
  if (students.length === 0) {
    list.innerHTML = '<p style="color: #5B6472">No students in this class yet.</p>';
    updateCounts();
    return;
  }

  list.innerHTML = students.map((s) => {
    const initials = s.name.split(" ").map((w) => w[0]).join("");
    const buttons = [["P", "Present"], ["A", "Absent"], ["L", "Late"]]
      .map(([v, label]) => `<button type="button" class="att-btn" data-id="${s.id}" data-v="${v}">${label}</button>`)
      .join("");
    return `
      <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; padding: 12px 0; border-bottom: 1px solid #EEF1F6">
        <span style="width: 36px; height: 36px; border-radius: 50%; background: #E6EEFA; color: #1E4C8F; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700">${initials}</span>
        <span style="flex: 1 1 200px; font-weight: 600">${s.name}</span>
        <div role="group" aria-label="Attendance for ${s.name}" style="display: flex; gap: 6px">${buttons}</div>
      </div>`;
  }).join("");

  list.querySelectorAll(".att-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      marks[btn.dataset.id] = btn.dataset.v;
      showStatus("Not saved yet", "#8A5A00");
      updateButtons();
    });
  });

  updateButtons();
}

function updateButtons() {
  list.querySelectorAll(".att-btn").forEach((btn) => {
    const on = (marks[btn.dataset.id] || "P") === btn.dataset.v;
    btn.className = "att-btn" + (on ? " on-" + btn.dataset.v : "");
    btn.setAttribute("aria-pressed", on);
  });
  updateCounts();
}

function updateCounts() {
  const counts = { P: 0, A: 0, L: 0 };
  students.forEach((s) => counts[marks[s.id] || "P"]++);
  document.getElementById("count-present").textContent = counts.P;
  document.getElementById("count-absent").textContent = counts.A;
  document.getElementById("count-late").textContent = counts.L;
  return counts;
}

// Save the whole register for this class and day
saveBtn.addEventListener("click", async () => {
  if (students.length === 0) return;
  saveBtn.disabled = true;
  showStatus("Saving…", "#12305A");

  const records = {};
  students.forEach((s) => (records[s.id] = marks[s.id] || "P"));
  const counts = updateCounts();

  try {
    await setDoc(schoolDoc("attendance", attendanceId()), {
      className: classSelect.value,
      date: dateInput.value,
      records,
      present: counts.P,
      absent: counts.A,
      late: counts.L,
      savedAt: serverTimestamp()
    });
    showStatus("Attendance saved ✓", "#157F3B");
  } catch (error) {
    showStatus("Could not save: " + error.message, "#B42318");
  } finally {
    saveBtn.disabled = false;
  }
});

document.getElementById("all-present").addEventListener("click", () => {
  marks = {};
  showStatus("Not saved yet", "#8A5A00");
  updateButtons();
});

classSelect.addEventListener("change", loadClass);
dateInput.addEventListener("change", loadClass);

// Fill the class list from the database (also opens ?class=… from the Dashboard), then load
fillClassSelect(classSelect).then(loadClass);
