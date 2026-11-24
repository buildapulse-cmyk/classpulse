// js/record-scores.js
// Records class exercises, homework, class tests and exams, and saves them to the database.
// Each save is ONE record for the whole class (all students' scores together).

import { db } from "./firebase.js";
import {
  collection, addDoc, doc, getDoc, query, where, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { fillClassSelect } from "./classes.js";

import { useSchool, schoolCol, schoolDoc } from "./school.js";

// Teachers only (the headmaster sees progress on the headmaster portal instead)
await useSchool("teacher");

const typeButtons = document.querySelectorAll(".type-btn");
const classSelect = document.getElementById("rs-class");
const subjectSelect = document.getElementById("rs-subject");
const topicSelect = document.getElementById("rs-topic");
const maxInput = document.getElementById("rs-max");
const dateInput = document.getElementById("rs-date");
const list = document.getElementById("score-list");
const saveBtn = document.getElementById("save-btn");
const saveStatus = document.getElementById("save-status");

let students = [];       // [{ id, name }]
let currentType = null;  // the selected type button

// Turns "JHS 2A" into "jhs-2a"
const makeId = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-");

// The chosen topic's name, e.g. "Ratio & Proportion"
const topicName = () => topicSelect.selectedOptions[0]?.dataset.name || "";

// Fill the Topic list with this class's topics (current topic first)
async function loadTopics() {
  topicSelect.innerHTML = '<option value="">Loading topics…</option>';
  try {
    const q = query(
      schoolCol("topics"),
      where("className", "==", classSelect.value),
      where("subject", "==", subjectSelect.value)
    );
    const snap = await getDocs(q);
    const topics = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.status === "in-progress" ? -1 : 0) - (b.status === "in-progress" ? -1 : 0) || b.startDate.localeCompare(a.startDate));

    if (topics.length === 0) {
      topicSelect.innerHTML = '<option value="">No topics yet — start one on the Topics page</option>';
    } else {
      topicSelect.innerHTML = topics.map((t) =>
        `<option value="${t.id}" data-name="${t.name}">${t.name} (${t.status === "in-progress" ? "in progress" : "completed"})</option>`
      ).join("");
    }
  } catch (error) {
    topicSelect.innerHTML = '<option value="">Could not load topics</option>';
  }
  updateLabels();
}

dateInput.value = new Date().toISOString().slice(0, 10);

function showStatus(text, color) {
  saveStatus.textContent = text;
  saveStatus.style.color = color;
}

function updateLabels() {
  document.querySelectorAll(".max-out").forEach((s) => (s.textContent = maxInput.value));
  document.querySelectorAll(".type-name").forEach((s) => (s.textContent = currentType.dataset.label));
  document.querySelectorAll(".topic-name").forEach((s) => (s.textContent = topicName()));
  document.getElementById("class-name").textContent = classSelect.value;
}

// Choosing a type sets a usual "marked out of" (the teacher can change it)
function pickType(btn) {
  currentType = btn;
  typeButtons.forEach((b) => {
    b.classList.toggle("on", b === btn);
    b.setAttribute("aria-pressed", b === btn);
  });
  maxInput.value = btn.dataset.max;
  updateLabels();
}

async function loadClass() {
  list.innerHTML = '<p style="color: #5B6472">Loading students…</p>';
  showStatus("", "");
  updateLabels();
  try {
    const classDoc = await getDoc(schoolDoc("classes", makeId(classSelect.value)));
    students = classDoc.exists() ? classDoc.data().students : [];
    drawList();
  } catch (error) {
    list.innerHTML = `<p style="color: #B42318; font-weight: 600">Could not load students: ${error.message}</p>`;
  }
}

function drawList() {
  if (students.length === 0) {
    list.innerHTML = '<p style="color: #5B6472">No students in this class yet.</p>';
    return;
  }
  list.innerHTML = students.map((s) => `
    <div style="display: flex; align-items: center; gap: 16px; padding: 10px 0; border-bottom: 1px solid #EEF1F6">
      <label for="score-${s.id}" style="flex: 1; font-weight: 500">${s.name}</label>
      <input id="score-${s.id}" class="score-input" data-id="${s.id}" type="number" min="0" step="0.5" inputmode="decimal"
        style="width: 96px; height: 44px; padding: 0 12px; border: 1px solid #C9D2DF; border-radius: 10px; font-size: 15px; font-family: inherit; text-align: right; box-sizing: border-box">
    </div>`).join("");
}

saveBtn.addEventListener("click", async () => {
  if (!topicSelect.value) {
    showStatus("Choose a topic first. Start one on the Topics page if the list is empty.", "#B42318");
    topicSelect.focus();
    return;
  }

  const max = Number(maxInput.value);
  if (!max || max <= 0) {
    showStatus("Enter what the work is marked out of.", "#B42318");
    maxInput.focus();
    return;
  }

  // Collect and check every score
  const scores = {};
  for (const input of list.querySelectorAll(".score-input")) {
    input.style.borderColor = "#C9D2DF";
    if (input.value === "") continue; // empty = didn't take it
    const value = Number(input.value);
    if (value < 0 || value > max) {
      input.style.borderColor = "#B42318";
      input.focus();
      showStatus(`Scores must be between 0 and ${max}.`, "#B42318");
      return;
    }
    scores[input.dataset.id] = value;
  }

  const recorded = Object.keys(scores).length;
  if (recorded === 0) {
    showStatus("Enter at least one score.", "#B42318");
    return;
  }

  // Class average as a percentage, so different types can be compared
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  const averagePercent = Math.round((total / recorded / max) * 100);

  saveBtn.disabled = true;
  showStatus("Saving…", "#12305A");
  try {
    await addDoc(schoolCol("assessments"), {
      className: classSelect.value,
      subject: subjectSelect.value,
      topicId: topicSelect.value,
      topic: topicName(),
      type: currentType.dataset.type,        // ex, hw, ct or exam
      typeLabel: currentType.dataset.label,  // Class exercise, Homework, ...
      maxScore: max,
      date: dateInput.value,
      scores,                                // { "kwame-asante": 8, ... }
      recorded,
      averagePercent,
      savedAt: serverTimestamp()
    });
    showStatus(`Saved ✓ ${recorded} scores · class average ${averagePercent}%`, "#157F3B");
    list.querySelectorAll(".score-input").forEach((i) => (i.value = ""));
  } catch (error) {
    showStatus("Could not save: " + error.message, "#B42318");
  } finally {
    saveBtn.disabled = false;
  }
});

typeButtons.forEach((b) => b.addEventListener("click", () => pickType(b)));
maxInput.addEventListener("input", updateLabels);
topicSelect.addEventListener("change", updateLabels);
classSelect.addEventListener("change", () => { loadClass(); loadTopics(); });
subjectSelect.addEventListener("change", loadTopics);

pickType(typeButtons[0]);
fillClassSelect(classSelect).then(() => { loadClass(); loadTopics(); });
