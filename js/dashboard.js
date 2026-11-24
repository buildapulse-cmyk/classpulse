// js/dashboard.js
// The teacher's home page: today's attendance, class averages, hardest topics,
// top students in each class and students who need attention — all from the database.

import { db } from "./firebase.js";
import { collection, getDocs, query, where, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { BANDS, average, bandOf, shortDate, ordinal, todayIso, resultsFor, rank } from "./results.js";

import { useSchool, schoolCol, schoolDoc } from "./school.js";
import { classOrder, groupedOptions } from "./levels.js";
import { exportButton } from "./export.js";

// Teachers only (the headmaster sees progress on the headmaster portal instead)
await useSchool("teacher");

const typeBadge = {
  ex:   { label: "Class exercise", bg: "#E6EEFA", fg: "#1E4C8F" },
  hw:   { label: "Homework",       bg: "#EFE9FB", fg: "#5B3BA8" },
  ct:   { label: "Class test",     bg: "#FFF4D6", fg: "#6B4E00" },
  exam: { label: "Examination",    bg: "#E2E7EF", fg: "#12305A" }
};

// Turns "JHS 2A" into "jhs-2a"
const makeId = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-");

// ---------- Greeting ----------
const hour = new Date().getHours();
document.getElementById("greeting").textContent =
  hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
document.getElementById("today-text").textContent =
  new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

let loaded = { classes: [], assessments: [] };

// ---------- Load everything ----------
async function loadDashboard() {
  const status = document.getElementById("load-status");
  try {
    // Attendance from the last 30 days only (keeps reads low)
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const [classSnap, assessSnap, topicSnap, attendSnap] = await Promise.all([
      getDocs(schoolCol("classes")),
      getDocs(schoolCol("assessments")),
      getDocs(schoolCol("topics")),
      getDocs(query(schoolCol("attendance"), where("date", ">=", since)))
    ]);

    const classes = classSnap.docs.map((d) => d.data()).sort(classOrder);
    const assessments = assessSnap.docs.map((d) => d.data());
    const topics = topicSnap.docs.map((d) => d.data());
    const attendance = attendSnap.docs.map((d) => d.data());

    loaded = { classes, assessments };
    status.hidden = true;
    drawTiles(classes, assessments, attendance);
    drawTodayClasses(classes, topics, attendance);
    drawHardTopics(assessments);
    drawLeaders(classes, assessments);
    drawRecent(assessments);
    drawAttention(classes, assessments, attendance);
  } catch (error) {
    status.style.color = "#B42318";
    status.textContent = "Could not load the dashboard: " + error.message;
  }
}

// Results for every student in a class (all subjects together)
function classResults(cls, assessments) {
  const list = assessments.filter((a) => a.className === cls.className);
  return rank(cls.students.map((s) => ({ ...s, className: cls.className, results: resultsFor(s.id, list, true) })));
}

// ---------- Top tiles ----------
function drawTiles(classes, assessments, attendance) {
  const today = todayIso();
  const totalStudents = classes.reduce((n, c) => n + c.students.length, 0);
  const todays = attendance.filter((a) => a.date === today);
  const present = todays.reduce((n, a) => n + a.present + a.late, 0);
  const counted = todays.reduce((n, a) => n + a.present + a.absent + a.late, 0);
  const notTaken = classes.length - todays.length;

  const termAvg = assessments.length ? Math.round(average(assessments.map((a) => a.averagePercent))) : null;
  const band = termAvg === null ? null : BANDS[bandOf(termAvg)];

  const attentionCount = classes.flatMap((c) => classResults(c, assessments)).filter((s) => s.results.needsAttention).length;

  const tile = (label, value, note, style = "background: #FFFFFF; border: 1px solid #E2E7EF") => `
    <div style="${style}; border-radius: 16px; padding: 20px; display: flex; flex-direction: column; gap: 6px">
      <span style="font-size: 13px; color: #5B6472">${label}</span>
      <span style="font-family: 'Space Grotesk', sans-serif; font-size: 30px; font-weight: 700">${value}</span>
      <span style="font-size: 13px; color: #5B6472">${note}</span>
    </div>`;

  document.getElementById("tiles").innerHTML =
    tile("My classes", classes.length, `${totalStudents} students`) +
    tile("In class today", counted ? `${present} <span style="font-size: 18px; color: #5B6472">/ ${counted}</span>` : "—",
      notTaken > 0 ? `${notTaken} register${notTaken === 1 ? "" : "s"} not taken yet` : "All registers taken ✓") +
    tile("Average of all scores", termAvg === null ? "—" : `${termAvg}%`,
      band ? `<span style="color: ${band.color}; font-weight: 600">${band.label}</span>` : "No scores yet",
      band ? `background: ${band.soft}; border: 1px solid ${band.soft}` : undefined) +
    tile("Need attention", `${attentionCount} student${attentionCount === 1 ? "" : "s"}`,
      "Below 50% or scores dropping", "background: #FFF4D6; border: 1px solid #F5D98A");
}

// ---------- Today's classes ----------
function drawTodayClasses(classes, topics, attendance) {
  const today = todayIso();
  document.getElementById("today-classes").innerHTML = classes.map((c, i) => {
    const register = attendance.find((a) => a.className === c.className && a.date === today);
    const current = topics.filter((t) => t.className === c.className && t.status === "in-progress").map((t) => `${t.subject}: ${t.name}`);
    const right = register
      ? `<span style="padding: 6px 10px; border-radius: 999px; background: #E3F4E8; color: #115E2C; font-size: 13px; font-weight: 600">Register taken · ${register.present + register.late}/${register.present + register.absent + register.late} in class</span>`
      : `<a href="attendance.html?class=${encodeURIComponent(c.className)}" style="padding: 10px 14px; border-radius: 8px; background: #12305A; color: #FFFFFF; font-size: 13px; font-weight: 600; text-decoration: none">Take attendance</a>`;
    return `
      <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px; padding: 14px 0; ${i < classes.length - 1 ? "border-bottom: 1px solid #EEF1F6" : ""}">
        <div style="flex: 1 1 240px; display: flex; flex-direction: column; gap: 2px">
          <span style="font-weight: 600">${c.className} · ${c.students.length} student${c.students.length === 1 ? "" : "s"}</span>
          <span style="font-size: 13px; color: #5B6472">${current.length ? "Current topic — " + current.join(" · ") : "No topic in progress"}</span>
        </div>
        ${right}
      </div>`;
  }).join("") || '<p style="color: #5B6472">No classes yet.</p>';
}

// ---------- Hardest topics ----------
function drawHardTopics(assessments) {
  const byTopic = {};
  assessments.forEach((a) => {
    if (a.type === "exam") return; // the exam isn't one topic
    const key = `${a.topic}|${a.className}|${a.subject}`;
    (byTopic[key] ||= []).push(a.averagePercent);
  });
  const list = Object.entries(byTopic)
    .map(([key, l]) => { const [topic, cls, subject] = key.split("|"); return { topic, cls, subject, avg: Math.round(average(l)) }; })
    .sort((a, b) => a.avg - b.avg)
    .slice(0, 4);

  document.getElementById("hard-topics").innerHTML = list.length === 0
    ? '<p style="margin: 0; color: #5B6472">No scores recorded yet.</p>'
    : list.map((t) => {
        const b = BANDS[bandOf(t.avg)];
        return `<div style="display: flex; flex-direction: column; gap: 6px">
          <div style="display: flex; justify-content: space-between; gap: 12px; font-size: 14px"><span>${t.topic} · ${t.cls}</span><span style="font-weight: 700; color: ${b.color}">${t.avg}%</span></div>
          <div style="height: 10px; border-radius: 5px; background: #EEF1F6"><div style="width: ${t.avg}%; height: 10px; border-radius: 5px; background: ${b.bar}"></div></div>
        </div>`;
      }).join("");
}

// ---------- Top 3 in each class + most improved ----------
function drawLeaders(classes, assessments) {
  const boxes = classes.map((c) => {
    const ranked = classResults(c, assessments).filter((s) => s.rank);
    if (ranked.length === 0) {
      return `<div style="border: 1px solid #E2E7EF; border-radius: 12px; padding: 16px"><strong>${c.className}</strong><p style="margin: 8px 0 0; font-size: 14px; color: #5B6472">No scores yet.</p></div>`;
    }
    const top = ranked.slice(0, 3).map((s) => `
      <li style="display: flex; align-items: center; gap: 10px; padding: 6px 0">
        <span style="width: 34px; height: 34px; border-radius: 50%; background: #F2A300; color: #12305A; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800">${ordinal(s.rank)}</span>
        <span style="flex: 1">${s.name}</span><strong>${s.results.average}%</strong>
      </li>`).join("");
    const improved = ranked.filter((s) => s.results.history.length >= 2 && s.results.change > 0)
      .sort((a, b) => b.results.change - a.results.change)[0];
    return `<div style="border: 1px solid #E2E7EF; border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 6px">
      <strong>${c.className}</strong>
      <ol style="list-style: none; margin: 0; padding: 0">${top}</ol>
      ${improved ? `<p style="margin: 4px 0 0; font-size: 13px; color: #157F3B; font-weight: 600">Most improved: ${improved.name} ▲ ${improved.results.change}</p>` : ""}
    </div>`;
  });
  document.getElementById("leaders").innerHTML = boxes.join("") || '<p style="color: #5B6472">No classes yet.</p>';
}

// ---------- Last 5 assessments saved ----------
function drawRecent(assessments) {
  const recent = assessments.slice()
    .sort((a, b) => b.date.localeCompare(a.date) || (b.savedAt?.seconds || 0) - (a.savedAt?.seconds || 0))
    .slice(0, 5);
  document.getElementById("recent-rows").innerHTML = recent.length === 0
    ? '<tr><td colspan="5" style="padding: 12px 8px; color: #5B6472">Nothing recorded yet.</td></tr>'
    : recent.map((a) => {
        const t = typeBadge[a.type] || typeBadge.ex;
        const b = BANDS[bandOf(a.averagePercent)];
        return `<tr style="border-top: 1px solid #EEF1F6">
          <td style="padding: 12px 8px">${shortDate(a.date)}</td>
          <td style="padding: 12px 8px">${a.className}</td>
          <td style="padding: 12px 8px"><span style="padding: 4px 10px; border-radius: 999px; background: ${t.bg}; color: ${t.fg}; font-size: 12px; font-weight: 600">${t.label}</span></td>
          <td style="padding: 12px 8px">${a.topic}</td>
          <td style="padding: 12px 8px; text-align: right; font-weight: 700; color: ${b.color}">${a.averagePercent}%</td>
        </tr>`;
      }).join("");
}

// ---------- Students who need attention ----------
function drawAttention(classes, assessments, attendance) {
  const items = [];
  classes.forEach((c) => {
    classResults(c, assessments).forEach((s) => {
      const reasons = [];
      if (s.results.average !== null && s.results.average < 50) reasons.push(`Average ${s.results.average}%`);
      if (s.results.change <= -8) reasons.push(`Scores down ${Math.abs(s.results.change)} points`);
      const absences = attendance.filter((a) => a.className === c.className && a.records[s.id] === "A").length;
      if (absences >= 3) reasons.push(`Absent ${absences} times in 30 days`);
      if (reasons.length) items.push({ name: s.name, cls: c.className, reasons, weight: reasons.length });
    });
  });
  items.sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name));

  document.getElementById("attention-list").innerHTML = items.length === 0
    ? '<p style="margin: 0; color: #157F3B; font-weight: 600">Everyone is on track ✓</p>'
    : items.slice(0, 6).map((it, i) => `
        <div style="display: flex; flex-direction: column; gap: 2px; ${i < Math.min(items.length, 6) - 1 ? "padding-bottom: 12px; border-bottom: 1px solid #EEF1F6" : ""}">
          <span style="font-weight: 600">${it.name} · ${it.cls}</span>
          <span style="font-size: 13px; color: #B42318">${it.reasons.join(" · ")}</span>
        </div>`).join("") +
      (items.length > 6 ? `<p style="margin: 0; font-size: 13px; color: #5B6472">and ${items.length - 6} more</p>` : "");
}

// ---------- Download everything to Excel ----------
exportButton(document.getElementById("export-btn"), document.getElementById("export-status"));

loadDashboard();
