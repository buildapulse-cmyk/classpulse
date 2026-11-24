// js/topics.js
// Start and finish topics, and see which topics the class finds difficult.
// The bar chart is worked out from the scores saved on the Record scores page.

import { db } from "./firebase.js";
import {
  collection, query, where, getDocs, addDoc, doc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { fillClassSelect } from "./classes.js";

import { useSchool, schoolCol, schoolDoc } from "./school.js";

// Teachers only (the headmaster sees progress on the headmaster portal instead)
await useSchool("teacher");

const classSelect = document.getElementById("tp-class");
const subjectSelect = document.getElementById("tp-subject");
const currentCard = document.getElementById("current-card");
const startForm = document.getElementById("start-form");
const nameInput = document.getElementById("tp-name");
const startInput = document.getElementById("tp-start");
const startStatus = document.getElementById("start-status");
const chart = document.getElementById("chart");
const chartLabels = document.getElementById("chart-labels");
const rows = document.getElementById("topic-rows");

let topics = [];  // topics for the chosen class and subject, with their results

const today = () => new Date().toISOString().slice(0, 10);
startInput.value = today();

// "2026-11-20" -> "20 Nov"
function shortDate(iso) {
  if (!iso) return "";
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// Blue = doing well, gold = watch, red = difficult
function barColor(avg) {
  if (avg >= 65) return "#1E5AA8";
  if (avg >= 50) return "#F2A300";
  return "#B42318";
}

async function loadTopics() {
  currentCard.innerHTML = '<p style="margin: 0; color: #D6DEEA">Loading…</p>';
  rows.innerHTML = "";
  chart.innerHTML = "";
  chartLabels.innerHTML = "";

  try {
    const byClassAndSubject = (name) => query(
      schoolCol(name),
      where("className", "==", classSelect.value),
      where("subject", "==", subjectSelect.value)
    );

    const [topicSnap, assessSnap] = await Promise.all([
      getDocs(byClassAndSubject("topics")),
      getDocs(byClassAndSubject("assessments"))
    ]);
    const assessments = assessSnap.docs.map((d) => d.data());

    topics = topicSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
      .map((t) => {
        // Scores linked to this topic (older scores were linked by name only)
        const mine = assessments.filter((a) => a.topicId === t.id || (!a.topicId && a.topic === t.name));
        const average = mine.length
          ? Math.round(mine.reduce((sum, a) => sum + a.averagePercent, 0) / mine.length)
          : null;

        // Each student's average on this topic, to count who is below 50%
        const perStudent = {};
        mine.forEach((a) => {
          Object.entries(a.scores).forEach(([id, score]) => {
            (perStudent[id] ||= []).push((score / a.maxScore) * 100);
          });
        });
        const studentAverages = Object.values(perStudent).map((list) => list.reduce((x, y) => x + y, 0) / list.length);
        const below = studentAverages.filter((v) => v < 50).length;

        return { ...t, count: mine.length, average, below, studentsScored: studentAverages.length };
      });

    drawCurrent();
    drawChart();
    drawTable();
  } catch (error) {
    currentCard.innerHTML = `<p style="margin: 0; color: #FFC23D; font-weight: 600">Could not load topics: ${error.message}</p>`;
  }
}

function drawCurrent() {
  const current = topics.find((t) => t.status === "in-progress");
  if (!current) {
    currentCard.innerHTML = `
      <span style="font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; color: #FFC23D; font-weight: 600">Current topic</span>
      <p style="margin: 0; font-size: 18px; font-weight: 600">No topic in progress</p>
      <p style="margin: 0; font-size: 14px; color: #D6DEEA">Start one using the form beside this.</p>`;
    return;
  }
  currentCard.innerHTML = `
    <span style="font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; color: #FFC23D; font-weight: 600">Current topic</span>
    <h2 style="margin: 0; font-family: 'Space Grotesk', sans-serif; font-size: 26px">${current.name}</h2>
    <p style="margin: 0; font-size: 14px; color: #D6DEEA">Started ${shortDate(current.startDate)} · ${current.count} assessment${current.count === 1 ? "" : "s"} recorded</p>
    <button type="button" id="finish-btn" style="align-self: flex-start; height: 44px; padding: 0 18px; border-radius: 10px; background: #F2A300; color: #12305A; border: none; font-weight: 700; font-size: 14px; font-family: inherit; cursor: pointer">Finish topic</button>`;
  document.getElementById("finish-btn").addEventListener("click", () => finishTopic(current));
}

function drawChart() {
  if (topics.length === 0) {
    chart.innerHTML = '<p style="color: #5B6472; align-self: center; margin: auto">No topics yet. Start your first one above.</p>';
    chart.setAttribute("aria-label", "No topics yet");
    return;
  }
  chart.innerHTML = topics.map((t) => {
    // Each bar's height is set by the class average (no chart library)
    const height = t.average === null ? 0 : Math.round(t.average * 2.2);
    const label = t.average === null ? '<span style="font-size: 13px; color: #5B6472">No scores</span>' : `<span style="font-size: 15px; font-weight: 700">${t.average}%</span>`;
    return `
      <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 8px; height: 100%">
        ${label}
        <div style="width: 100%; max-width: 96px; height: ${height}px; border-radius: 8px 8px 0 0; background: ${barColor(t.average)}"></div>
      </div>`;
  }).join("");
  chartLabels.innerHTML = topics.map((t) => `<span style="flex: 1; text-align: center; font-size: 13px; color: #5B6472">${t.name}</span>`).join("");
  chart.setAttribute("aria-label", "Class average by topic: " + topics.map((t) => `${t.name} ${t.average === null ? "no scores" : t.average + "%"}`).join(", "));
}

function drawTable() {
  if (topics.length === 0) {
    rows.innerHTML = '<tr><td colspan="6" style="padding: 12px 8px; color: #5B6472">No topics yet.</td></tr>';
    return;
  }
  rows.innerHTML = topics.map((t) => {
    const status = t.status === "in-progress"
      ? '<span style="padding: 4px 10px; border-radius: 999px; background: #FFF4D6; color: #6B4E00; font-size: 12px; font-weight: 600">In progress</span>'
      : '<span style="padding: 4px 10px; border-radius: 999px; background: #E3F4E8; color: #115E2C; font-size: 12px; font-weight: 600">Completed</span>';
    const dates = t.endDate ? `${shortDate(t.startDate)} – ${shortDate(t.endDate)}` : `Since ${shortDate(t.startDate)}`;
    const avg = t.average === null ? "—" : `<span style="color: ${t.average < 50 ? "#B42318" : "#12305A"}">${t.average}%</span>`;
    const below = t.studentsScored ? `${t.below} of ${t.studentsScored}` : "—";
    return `<tr style="border-top: 1px solid #EEF1F6">
      <td style="padding: 12px 8px; font-weight: 600">${t.name}</td>
      <td style="padding: 12px 8px">${status}</td>
      <td style="padding: 12px 8px; color: #5B6472">${dates}</td>
      <td style="padding: 12px 8px">${t.count}</td>
      <td style="padding: 12px 8px; font-weight: 700">${avg}</td>
      <td style="padding: 12px 8px">${below}</td>
    </tr>`;
  }).join("");
}

async function finishTopic(topic) {
  await updateDoc(schoolDoc("topics", topic.id), { status: "completed", endDate: today() });
  await loadTopics();
}

// Starting a new topic finishes the one in progress (one topic at a time)
startForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();
  if (!name) return;

  if (topics.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
    startStatus.style.color = "#B42318";
    startStatus.textContent = "You already have a topic with that name.";
    return;
  }

  startStatus.style.color = "#12305A";
  startStatus.textContent = "Starting…";
  try {
    const current = topics.find((t) => t.status === "in-progress");
    if (current) {
      await updateDoc(schoolDoc("topics", current.id), { status: "completed", endDate: startInput.value });
    }
    await addDoc(schoolCol("topics"), {
      className: classSelect.value,
      subject: subjectSelect.value,
      name,
      status: "in-progress",
      startDate: startInput.value,
      endDate: null,
      createdAt: serverTimestamp()
    });
    nameInput.value = "";
    startStatus.style.color = "#157F3B";
    startStatus.textContent = current ? `Started ✓ (“${current.name}” was marked as finished)` : "Started ✓";
    await loadTopics();
  } catch (error) {
    startStatus.style.color = "#B42318";
    startStatus.textContent = "Could not start topic: " + error.message;
  }
});

classSelect.addEventListener("change", loadTopics);
subjectSelect.addEventListener("change", loadTopics);

fillClassSelect(classSelect).then(loadTopics);
