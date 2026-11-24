// js/students.js
// Ranks students first to last in each class, shows their band, strengths and
// areas to work on, and gives the teacher an encouraging next step for each one.
// Everything is worked out from the scores saved in the database.

import { db } from "./firebase.js";
import { collection, getDocs, setDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { BANDS, typeColors, average, bandOf, shortDate, ordinal, resultsFor, rank } from "./results.js";

import { useSchool, schoolCol, schoolDoc, SCHOOL } from "./school.js";
import { classOrder, groupedOptions } from "./levels.js";

// Only logged-in teachers and the headmaster (and the admin) can use this page
await useSchool("teacher", "headmaster");

const groupsBox = document.getElementById("student-groups");
const countText = document.getElementById("result-count");
const classFilter = document.getElementById("f-class");
const subjectFilter = document.getElementById("f-subject");
const bandFilter = document.getElementById("f-band");
const dialog = document.getElementById("student-dialog");
const searchBox = document.getElementById("f-search");
const canRemove = ["headmaster", "admin"].includes(SCHOOL.me.profile.role);
let openStudentNow = null; // the student shown in the pop-up

let classes = [];      // [{ className, students: [{ id, name }] }]
let assessments = [];  // every saved assessment

const firstName = (name) => name.split(" ")[0];

// ---------- Load data ----------
async function loadData() {
  countText.textContent = "Loading students…";
  try {
    const [classSnap, assessSnap] = await Promise.all([
      getDocs(schoolCol("classes")),
      getDocs(schoolCol("assessments"))
    ]);
    classes = classSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(classOrder);
    assessments = assessSnap.docs.map((d) => d.data());
    classFilter.innerHTML = '<option value="all">All my classes</option>' + groupedOptions(classes.map((c) => c.className));
    // Opened from "View class →"? e.g. students.html?class=JHS%202A
    const wanted = new URLSearchParams(location.search).get("class");
    if (wanted && classes.some((c) => c.className === wanted)) classFilter.value = wanted;
    render();
  } catch (error) {
    countText.style.color = "#B42318";
    countText.textContent = "Could not load students: " + error.message;
  }
}

// ---------- Work out results ----------
// Build one class: results, ranking and movement since the last assessment
function buildClass(cls) {
  const list = assessments
    .filter((a) => a.className === cls.className)
    .filter((a) => subjectFilter.value === "all" || a.subject === subjectFilter.value);

  const students = rank(cls.students.map((s) => ({ ...s, className: cls.className, results: resultsFor(s.id, list, subjectFilter.value === "all") })));

  // Ranking before the most recent assessment date, to show who moved up or down
  const dates = [...new Set(list.map((a) => a.date))].sort();
  if (dates.length >= 2) {
    const before = list.filter((a) => a.date < dates[dates.length - 1]);
    const previous = rank(cls.students.map((s) => ({ ...s, results: resultsFor(s.id, before, subjectFilter.value === "all") })));
    const prevRank = Object.fromEntries(previous.map((p) => [p.id, p.rank]));
    students.forEach((s) => {
      if (s.rank && prevRank[s.id]) s.moved = prevRank[s.id] - s.rank; // + means moved up
    });
  }

  // Class picture: band counts, class average, weakest topic, most improved
  const scored = students.filter((s) => s.results.average !== null);
  const counts = { above: 0, average: 0, below: 0 };
  scored.forEach((s) => counts[s.results.band]++);
  const classAvg = scored.length ? Math.round(average(scored.map((s) => s.results.average))) : null;

  const topicTotals = {};
  list.forEach((a) => {
    if (a.type === "exam") return; // the exam isn't one topic
    const key = subjectFilter.value === "all" ? `${a.subject} · ${a.topic}` : a.topic;
    (topicTotals[key] ||= []).push(a.averagePercent);
  });
  const classTopics = Object.entries(topicTotals)
    .map(([name, l]) => ({ name, average: Math.round(average(l)) }))
    .sort((a, b) => a.average - b.average);

  const improvers = scored.filter((s) => s.results.history.length >= 2 && s.results.change > 0)
    .sort((a, b) => b.results.change - a.results.change);

  return {
    className: cls.className, students, counts, classAvg,
    weakestTopic: classTopics[0] || null,
    strongestTopic: classTopics.length > 1 ? classTopics[classTopics.length - 1] : null,
    mostImproved: improvers[0] || null
  };
}

// ---------- Encouraging feedback for the teacher ----------
function feedback(s) {
  const r = s.results;
  const name = firstName(s.name);
  if (r.average === null) return { title: "No scores yet", text: `Record a few scores for ${name} to see their strengths and where to help.` };

  const strong = r.topics[0];
  const lowest = r.topics[r.topics.length - 1];
  const weak = r.topics.length > 1 && lowest.average < r.topics[0].average ? lowest : null;
  const lines = [];

  if (r.band === "above") {
    lines.push(`${name} is doing very well${strong ? `, especially in ${strong.name} (${strong.average}%)` : ""}. Praise this and keep them stretched with harder questions.`);
    if (weak && weak.average < 75) lines.push(`${weak.name} (${weak.average}%) is the one area where a little extra practice will keep ${name} at the top.`);
  } else if (r.band === "average") {
    lines.push(`${name} is on the right track${strong ? ` and is strongest in ${strong.name} (${strong.average}%)` : ""}.`);
    if (weak) lines.push(`Extra practice on ${weak.name} (${weak.average}%) could lift ${name} into the above-average group.`);
  } else {
    lines.push(`${name} needs some extra support${weak ? `, mostly with ${weak.name} (${weak.average}%)` : ""}.`);
    if (strong && strong !== weak) lines.push(`Start from what ${name} already does well — ${strong.name} (${strong.average}%) — to build confidence.`);
    lines.push(`Short practice, a quick check-in after class, or pairing with a stronger classmate can help.`);
  }

  if (r.change >= 5) lines.push(`Improving by ${r.change} points recently — tell ${name} you've noticed!`);
  if (r.change <= -8) lines.push(`Scores have dropped by ${Math.abs(r.change)} points recently. It may be worth asking ${name} if anything is wrong.`);

  return { title: BANDS[r.band].label, text: lines.join(" ") };
}

// ---------- Draw the page ----------
function render() {
  const chosen = classes.filter((c) => classFilter.value === "all" || c.className === classFilter.value);
  const subjectText = subjectFilter.value === "all" ? "All subjects" : subjectFilter.value;
  groupsBox.innerHTML = "";
  let shown = 0;

  chosen.forEach((cls) => {
    const c = buildClass(cls);
    const words = searchBox.value.trim().toLowerCase();
    const visible = c.students.filter((s) => {
      if (words && !s.name.toLowerCase().includes(words)) return false;
      const f = bandFilter.value;
      if (f === "all") return true;
      if (f === "attention") return s.results.needsAttention;
      return s.results.band === f;
    });
    if (words && visible.length === 0) return; // searching: skip classes with no match
    shown += visible.length;

    const group = document.createElement("section");
    group.style.cssText = "display: flex; flex-direction: column; gap: 16px";
    group.innerHTML = `
      <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 8px">
        <h2 style="margin: 0; font-family: 'Space Grotesk', sans-serif; font-size: 24px">${c.className} ranking · ${subjectText}</h2>
        <span style="font-size: 14px; color: #5B6472">${c.classAvg === null ? "No scores yet" : `Class average ${c.classAvg}%`}</span>
      </div>
      ${summaryHtml(c)}
      <div class="grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px"></div>`;
    const grid = group.querySelector(".grid");

    if (visible.length === 0) grid.innerHTML = '<p style="margin: 0; color: #5B6472">No students in this group.</p>';
    visible.forEach((s) => grid.appendChild(card(s)));
    groupsBox.appendChild(group);
  });

  countText.style.color = "#5B6472";
  countText.textContent = `Showing ${shown} student${shown === 1 ? "" : "s"}`;
}

function summaryHtml(c) {
  if (c.classAvg === null) return "";
  const chip = (key) => `<span style="padding: 6px 12px; border-radius: 999px; background: ${BANDS[key].soft}; color: ${BANDS[key].color}; font-size: 13px; font-weight: 700">${c.counts[key]} ${BANDS[key].label.toLowerCase()}</span>`;
  const tile = (label, value) => `<div style="flex: 1 1 200px; background: #FFFFFF; border: 1px solid #E2E7EF; border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 2px"><span style="font-size: 12px; color: #5B6472">${label}</span><span style="font-weight: 700">${value}</span></div>`;
  return `
    <div style="display: flex; flex-wrap: wrap; gap: 8px">${chip("above")}${chip("average")}${chip("below")}</div>
    <div style="display: flex; flex-wrap: wrap; gap: 12px">
      ${c.mostImproved ? tile("Most improved", `${c.mostImproved.name} ▲ ${c.mostImproved.results.change}`) : ""}
      ${c.strongestTopic ? tile("Class is strongest in", `${c.strongestTopic.name} (${c.strongestTopic.average}%)`) : ""}
      ${c.weakestTopic ? tile("Revise with the whole class", `${c.weakestTopic.name} (${c.weakestTopic.average}%)`) : ""}
    </div>`;
}

function card(s) {
  const r = s.results;
  const band = r.band ? BANDS[r.band] : null;
  const el = document.createElement("button");
  el.type = "button";
  el.className = "student-card band-" + (r.band || "none");

  const move = s.moved > 0 ? `<span style="font-size: 12px; font-weight: 700; color: #157F3B">▲ ${s.moved}</span>`
    : s.moved < 0 ? `<span style="font-size: 12px; font-weight: 700; color: #B42318">▼ ${Math.abs(s.moved)}</span>` : "";
  const rankBadge = s.rank
    ? `<div style="display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 48px"><span style="width: 44px; height: 44px; border-radius: 50%; background: ${s.rank <= 3 ? "#F2A300" : "#12305A"}; color: ${s.rank <= 3 ? "#12305A" : "#FFFFFF"}; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 14px">${ordinal(s.rank)}</span>${move}</div>`
    : `<span style="width: 44px; height: 44px; border-radius: 50%; background: #EEF1F6; color: #5B6472; display: flex; align-items: center; justify-content: center; font-size: 12px">—</span>`;

  const trend = r.history.length < 2 ? { text: "—", color: "#5B6472" }
    : r.change >= 3 ? { text: `▲ Up ${r.change}`, color: "#157F3B" }
    : r.change <= -3 ? { text: `▼ Down ${Math.abs(r.change)}`, color: "#B42318" }
    : { text: "● Steady", color: "#5B6472" };

  const strong = r.topics[0];
  const lowest = r.topics[r.topics.length - 1];
  const weak = r.topics.length > 1 && lowest.average < r.topics[0].average ? lowest : null;

  el.innerHTML = `
    <div style="display: flex; gap: 12px; align-items: flex-start">
      ${rankBadge}
      <div style="flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0">
        <span style="font-weight: 700; font-size: 16px">${s.name}</span>
        ${band ? `<span style="align-self: flex-start; padding: 3px 8px; border-radius: 999px; background: ${band.soft}; color: ${band.color}; font-size: 12px; font-weight: 700">${band.label}</span>` : '<span style="font-size: 13px; color: #5B6472">No scores recorded yet</span>'}
      </div>
    </div>
    ${r.average === null ? "" : `
    <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px">
      <div style="display: flex; flex-direction: column; gap: 2px"><span style="font-size: 12px; color: #5B6472">Average</span><span style="font-weight: 700; font-size: 18px">${r.average}%</span></div>
      <div style="display: flex; flex-direction: column; gap: 2px"><span style="font-size: 12px; color: #5B6472">Latest</span><span style="font-weight: 700; font-size: 18px">${r.latest}%</span></div>
      <div style="display: flex; flex-direction: column; gap: 2px"><span style="font-size: 12px; color: #5B6472">Trend</span><span style="font-weight: 700; font-size: 14px; color: ${trend.color}">${trend.text}</span></div>
    </div>
    <div style="display: flex; flex-direction: column; gap: 4px; font-size: 13px">
      ${strong ? `<span><strong style="color: #115E2C">Strongest:</strong> ${strong.name} (${strong.average}%)</span>` : ""}
      ${weak ? `<span><strong style="color: #8F1D15">Work on:</strong> ${weak.name} (${weak.average}%)</span>` : ""}
    </div>`}`;
  el.addEventListener("click", () => openStudent(s));
  return el;
}

// ---------- Pop-up ----------
function openStudent(s) {
  openStudentNow = s;
  document.getElementById("dlg-remove-box").hidden = !canRemove;
  document.getElementById("dlg-remove-status").textContent = "";
  const r = s.results;
  const subjectText = subjectFilter.value === "all" ? "All subjects" : subjectFilter.value;
  document.getElementById("dlg-name").textContent = s.name;
  document.getElementById("dlg-meta").textContent =
    `${s.className} · ${subjectText}` +
    (s.rank ? ` · ${ordinal(s.rank)} in class` : "") +
    (r.average === null ? "" : ` · Average ${r.average}%`);

  // Encouraging next step for the teacher
  const fb = feedback(s);
  const box = document.getElementById("dlg-feedback");
  const band = r.band ? BANDS[r.band] : { soft: "#EEF1F6", color: "#12305A" };
  box.style.background = band.soft;
  box.innerHTML = `<strong style="color: ${band.color}">${fb.title}</strong><p style="margin: 0; font-size: 14px; line-height: 1.6; color: #12305A">${fb.text}</p>`;

  // Topics strongest to weakest, coloured by band
  document.getElementById("dlg-topics").innerHTML = r.topics.length === 0
    ? '<p style="margin: 0; color: #5B6472; font-size: 14px">No topics scored yet.</p>'
    : r.topics.map((t) => {
        const b = BANDS[bandOf(t.average)];
        return `<div style="display: flex; flex-direction: column; gap: 4px">
          <div style="display: flex; justify-content: space-between; gap: 12px; font-size: 14px"><span>${t.name}</span><span style="font-weight: 700; color: ${b.color}">${t.average}% · ${b.label}</span></div>
          <div style="height: 10px; border-radius: 5px; background: #EEF1F6"><div style="width: ${t.average}%; height: 10px; border-radius: 5px; background: ${b.bar}"></div></div>
        </div>`;
      }).join("");

  // Bar chart of the last 12 scores (each bar's height is set by the score)
  const chart = document.getElementById("dlg-chart");
  const labels = document.getElementById("dlg-labels");
  const rows = document.getElementById("dlg-rows");
  const recent = r.history.slice(-12);

  if (recent.length === 0) {
    chart.innerHTML = '<p style="margin: auto; color: #5B6472">No scores recorded yet.</p>';
    labels.innerHTML = "";
    rows.innerHTML = "";
    chart.setAttribute("aria-label", "No scores yet");
  } else {
    chart.innerHTML = recent.map((h) => `
      <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 6px; height: 100%">
        <span style="font-size: 13px; font-weight: 700">${h.percent}%</span>
        <div style="width: 100%; max-width: 56px; height: ${Math.max(h.percent * 1.8, 2)}px; border-radius: 6px 6px 0 0; background: ${typeColors[h.type] || "#1E5AA8"}"></div>
      </div>`).join("");
    labels.innerHTML = recent.map((h) => `<span style="flex: 1; text-align: center; font-size: 12px; color: #5B6472">${shortDate(h.date)}</span>`).join("");
    chart.setAttribute("aria-label", `Bar chart of ${s.name}'s scores: ` + recent.map((h) => `${shortDate(h.date)} ${h.percent}%`).join(", "));
    rows.innerHTML = r.history.slice().reverse().map((h) => `
      <tr style="border-top: 1px solid #EEF1F6">
        <td style="padding: 10px 8px">${shortDate(h.date)}</td>
        <td style="padding: 10px 8px">${h.typeLabel}</td>
        <td style="padding: 10px 8px">${subjectFilter.value === "all" ? h.subject + " · " : ""}${h.topic}</td>
        <td style="padding: 10px 8px; text-align: right; font-weight: 700">${h.score} / ${h.max} <span style="color: #5B6472; font-weight: 500">(${h.percent}%)</span></td>
      </tr>`).join("");
  }

  dialog.showModal();
}

document.getElementById("dlg-close").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
[classFilter, subjectFilter, bandFilter].forEach((el) => el.addEventListener("change", render));
searchBox.addEventListener("input", render);
document.getElementById("filters").addEventListener("submit", (e) => e.preventDefault());

// ---------- Remove a student from the school (headmaster) ----------
// Their scores stay saved; they just leave the class list. Their ID is never reused.
document.getElementById("dlg-remove").addEventListener("click", async () => {
  const s = openStudentNow;
  if (!s) return;
  if (!confirm(`Remove ${s.name} (${s.className}) from the school?\n\nThey will no longer appear in any class, ranking or report card. Their past scores stay saved.`)) return;
  const status = document.getElementById("dlg-remove-status");
  status.style.color = "#12305A";
  status.textContent = "Removing…";
  try {
    const cls = classes.find((c) => c.className === s.className);
    const roster = (cls.students || []).filter((x) => x.id !== s.id);
    const removedIds = [...(cls.removedIds || []), s.id];
    await setDoc(schoolDoc("classes", cls.id), { students: roster, removedIds, updatedAt: serverTimestamp() }, { merge: true });
    await deleteDoc(schoolDoc("students", s.id));
    dialog.close();
    await loadData();
    countText.style.color = "#157F3B";
    countText.textContent = `${s.name} was removed from the school.`;
  } catch (error) {
    status.style.color = "#B42318";
    status.textContent = "Could not remove: " + error.message;
  }
});

loadData();
