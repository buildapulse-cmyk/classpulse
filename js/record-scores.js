// js/record-scores.js
// Records class exercises, homework, class tests and exams, and saves them to the database.
// Each save is ONE record for the whole class (all students' scores together).

import { db } from "./firebase.js";
import {
  collection, addDoc, updateDoc, deleteDoc, doc, getDoc, query, where, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { fillClassSelect, fillSubjectSelect } from "./classes.js";

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
let editing = null;      // the saved record being fixed, or null when adding new scores
let recent = [];         // recently saved records for this class and subject
const cancelBtn = document.getElementById("cancel-edit");
const recentList = document.getElementById("recent-list");
const recentStatus = document.getElementById("recent-status");

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
  document.querySelectorAll(".class-subject").forEach((s) => (s.textContent = `${classSelect.value} ${subjectSelect.value}`));
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
      <input id="score-${s.id}" class="score-input" data-id="${s.id}" type="number" min="0" step="0.5" inputmode="decimal" enterkeyhint="next"
        style="width: 96px; height: 44px; padding: 0 12px; border: 1px solid #C9D2DF; border-radius: 10px; font-size: 15px; font-family: inherit; text-align: right; box-sizing: border-box">
    </div>`).join("");

  // On a phone keyboard, "Next" (or Enter) jumps to the next student's box
  const boxes = [...list.querySelectorAll(".score-input")];
  boxes.forEach((box, i) => box.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (boxes[i + 1]) boxes[i + 1].focus(); else box.blur();
  }));
  if (boxes.length) boxes[boxes.length - 1].setAttribute("enterkeyhint", "done");
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
    const record = {
      className: classSelect.value,
      subject: subjectSelect.value,
      topicId: topicSelect.value === "none" ? null : topicSelect.value,
      topic: topicName(),
      type: currentType.dataset.type,        // ex, hw, ct or exam
      typeLabel: currentType.dataset.label,  // Class exercise, Homework, ...
      maxScore: max,
      date: dateInput.value,
      scores,                                // { "kwame-asante": 8, ... }
      recorded,
      averagePercent,
      savedAt: serverTimestamp()
    };
    if (editing) {
      await updateDoc(schoolDoc("assessments", editing.id), { ...record, fixedAt: serverTimestamp() });
      stopEditing();
      showStatus(`Changes saved ✓ ${recorded} scores · class average ${averagePercent}%`, "#157F3B");
    } else {
      await addDoc(schoolCol("assessments"), record);
      showStatus(`Saved ✓ ${recorded} scores · class average ${averagePercent}%`, "#157F3B");
    }
    list.querySelectorAll(".score-input").forEach((i) => (i.value = ""));
    loadRecent();
  } catch (error) {
    showStatus("Could not save: " + error.message, "#B42318");
  } finally {
    saveBtn.disabled = false;
  }
});

// ---------- Fixing or deleting saved scores ----------
const fmtDate = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

async function loadRecent() {
  if (!classSelect.value) return;
  recentList.innerHTML = '<p style="color: #5B6472">Loading…</p>';
  try {
    const snap = await getDocs(query(schoolCol("assessments"),
      where("className", "==", classSelect.value), where("subject", "==", subjectSelect.value)));
    recent = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
    drawRecent();
  } catch (error) {
    recentList.innerHTML = `<p style="color: #B42318">Could not load saved scores: ${error.message}</p>`;
  }
}

function drawRecent() {
  if (recent.length === 0) {
    recentList.innerHTML = '<p style="margin: 0; color: #5B6472">Nothing saved yet for this class and subject.</p>';
    return;
  }
  recentList.innerHTML = recent.map((a) => `
    <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 10px 0; border-bottom: 1px solid #EEF1F6${editing && editing.id === a.id ? "; background: #FFF4D6" : ""}">
      <span style="flex: 1 1 260px; display: flex; flex-direction: column; gap: 2px">
        <strong>${a.typeLabel}${a.topic ? ` · ${a.topic}` : ""}</strong>
        <span style="font-size: 13px; color: #5B6472">${fmtDate(a.date)} · ${a.recorded} score${a.recorded === 1 ? "" : "s"} · out of ${a.maxScore} · class average ${a.averagePercent}%</span>
      </span>
      <span style="display: flex; gap: 8px">
        <button type="button" data-fix="${a.id}" style="height: 40px; padding: 0 16px; border-radius: 8px; background: #12305A; color: #FFFFFF; border: none; font-weight: 600; font-size: 13px; font-family: inherit; cursor: pointer">Fix</button>
        <button type="button" data-del="${a.id}" style="height: 40px; padding: 0 16px; border-radius: 8px; background: #FFFFFF; color: #8F1D15; border: 1px solid #F1B8B3; font-weight: 600; font-size: 13px; font-family: inherit; cursor: pointer">Delete</button>
      </span>
    </div>`).join("");
  recentList.querySelectorAll("[data-fix]").forEach((b) => b.addEventListener("click", () => startEditing(b.dataset.fix)));
  recentList.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => deleteRecord(b.dataset.del)));
}

// Put a saved record back into the form so the teacher can correct it
function startEditing(id) {
  const a = recent.find((x) => x.id === id);
  if (!a) return;
  editing = a;
  const btn = [...typeButtons].find((b) => b.dataset.type === a.type) || typeButtons[0];
  pickType(btn);
  maxInput.value = a.maxScore;
  dateInput.value = a.date;
  const value = a.topicId || "none";
  if (![...topicSelect.options].some((o) => o.value === value)) {
    topicSelect.insertAdjacentHTML("afterbegin", `<option value="${value}" data-name="${a.topic || ""}">${a.topic || "No topic (exam)"}</option>`);
  }
  topicSelect.value = value;
  list.querySelectorAll(".score-input").forEach((i) => (i.value = a.scores[i.dataset.id] ?? ""));
  updateLabels();
  saveBtn.textContent = "Save changes";
  cancelBtn.hidden = false;
  showStatus(`Fixing: ${a.typeLabel}, ${fmtDate(a.date)}. Change the scores, then click Save changes.`, "#8A5A00");
  drawRecent();
  document.querySelector("h1").scrollIntoView({ behavior: "smooth" });
}

function stopEditing() {
  editing = null;
  saveBtn.textContent = "Save scores";
  cancelBtn.hidden = true;
  dateInput.value = new Date().toISOString().slice(0, 10);
  drawRecent();
}
cancelBtn.addEventListener("click", () => {
  stopEditing();
  list.querySelectorAll(".score-input").forEach((i) => (i.value = ""));
  showStatus("", "");
});

async function deleteRecord(id) {
  const a = recent.find((x) => x.id === id);
  if (!a || !confirm(`Delete this ${a.typeLabel.toLowerCase()} (${fmtDate(a.date)}, ${a.recorded} scores)?\n\nIt will be removed from every report and chart. This can't be undone.`)) return;
  try {
    await deleteDoc(schoolDoc("assessments", id));
    if (editing && editing.id === id) stopEditing();
    recentStatus.style.color = "#157F3B";
    recentStatus.textContent = "Deleted ✓";
    loadRecent();
  } catch (error) {
    recentStatus.style.color = "#B42318";
    recentStatus.textContent = "Could not delete: " + error.message;
  }
}

typeButtons.forEach((b) => b.addEventListener("click", () => pickType(b)));
maxInput.addEventListener("input", updateLabels);
topicSelect.addEventListener("change", updateLabels);
classSelect.addEventListener("change", () => { if (editing) stopEditing(); loadClass(); loadTopics(); loadRecent(); });
subjectSelect.addEventListener("change", () => { if (editing) stopEditing(); loadTopics(); loadRecent(); });

pickType(typeButtons[0]);
fillSubjectSelect(subjectSelect);
fillClassSelect(classSelect).then(() => { loadClass(); loadTopics(); loadRecent(); });
