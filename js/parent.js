// js/parent.js
// The parent's page: ONLY their own child (or children) — progress in each subject,
// attendance, month-by-month progress, strengths, recent scores, and the report card
// (it fills up during the term and is final after the exams). Parents can download
// their child's full record to keep.

import { getDoc } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { useSchool, schoolCol, schoolDoc, SCHOOL } from "./school.js";
import { BANDS, bandOf, average, shortDate, resultsFor, typeColors } from "./results.js";
import { monthBars } from "./charts.js";
import { withDefaults, reportCardHtml } from "./report-calc.js";
import { viewAsAssessments } from "./parent-views.js";
import { downloadRecords, recordFromView } from "./child-record.js";

await useSchool("parent");
const $ = (id) => document.getElementById(id);
$("page").hidden = false;

const children = SCHOOL.me.profile.children || [];
let settings = withDefaults();


async function start() {
  const reportDoc = await getDoc(schoolDoc("settings", "report"));
  settings = withDefaults(reportDoc.exists() ? reportDoc.data() : {});
  $("school-name").textContent = settings.schoolName || SCHOOL.name || "Your child's school";
  $("school-motto").textContent = settings.motto || "";
  if (settings.badge) { $("crest").src = settings.badge; $("crest").alt = `${settings.schoolName || SCHOOL.name} crest`; }

  if (children.length === 0) {
    $("child").innerHTML = '<div class="card"><p style="margin: 0">No child is linked to this account yet. Please contact the school.</p></div>';
    return;
  }
  $("kids").innerHTML = children.length > 1
    ? children.map((c, i) => `<button type="button" class="kid" data-i="${i}" aria-pressed="${i === 0}">${c.name.split(" ")[0]} · ${c.className}</button>`).join("")
    : "";
  document.querySelectorAll(".kid").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".kid").forEach((x) => x.setAttribute("aria-pressed", x === b));
    showChild(children[Number(b.dataset.i)]);
  }));
  showChild(children[0]);
}

// A kind message for parents, with ways to help at home
function parentMessage(name, r) {
  const first = name.split(" ")[0];
  if (r.average === null) return `No scores have been recorded for ${first} yet this term.`;
  const strong = r.topics[0];
  const lowest = r.topics[r.topics.length - 1];
  const weak = r.topics.length > 1 && lowest.average < strong.average ? lowest : null;
  const lines = [];
  if (r.band === "above") lines.push(`${first} is doing very well — well done!`);
  else if (r.band === "average") lines.push(`${first} is making steady progress.`);
  else lines.push(`${first} needs some extra support at the moment, and your help at home will make a real difference.`);
  if (strong) lines.push(`${first} is strongest in ${strong.name}.`);
  if (weak) lines.push(`Practising ${weak.name} together at home for a few minutes a day will help.`);
  if (r.change >= 5) lines.push(`Scores have gone up recently — please praise ${first} for the effort.`);
  if (r.change <= -8) lines.push(`Scores have dropped a little recently. A short chat with ${first} or the class teacher may help.`);
  return lines.join(" ");
}

async function showChild(child) {
  $("child").innerHTML = '<p style="color: #5B6472">Loading…</p>';
  // Only this child's private summary is read — never anyone else's
  const snap = await getDoc(schoolDoc("childViews", child.id));
  if (!snap.exists()) {
    $("child").innerHTML = `<div class="card"><p style="margin: 0">${child.name.split(" ")[0]}'s progress will appear here once the school updates it. Please check again later.</p></div>`;
    return;
  }
  const view = snap.data();
  const r = resultsFor(child.id, viewAsAssessments(view), true);
  const band = r.band ? BANDS[r.band] : null;

  // Attendance
  const days = (view.attendance || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const absentDays = days.filter((a) => a.mark === "A");
  const lateDays = days.filter((a) => a.mark === "L");
  const present = days.length - absentDays.length;
  const attPct = days.length ? Math.round((present / days.length) * 100) : null;
  const updated = view.updatedAt && view.updatedAt.toDate ? view.updatedAt.toDate() : null;

  // Each subject: average and latest
  const subjects = [...new Set(r.history.map((h) => h.subject))].sort().map((s) => {
    const list = r.history.filter((h) => h.subject === s);
    return { s, avg: Math.round(average(list.map((h) => h.percent))), latest: list[list.length - 1] };
  });

  // Month by month (child's own average)
  const byMonth = {};
  r.history.forEach((h) => (byMonth[h.date.slice(0, 7)] ||= []).push(h.percent));
  const months = Object.keys(byMonth).sort().map((k) => ({ key: k, value: Math.round(average(byMonth[k])) }));

  const tile = (label, value, note = "", color = "#12305A") => `<div class="tile"><span style="font-size: 13px; color: #5B6472">${label}</span><strong style="color: ${color}">${value}</strong><span style="font-size: 13px; color: #5B6472">${note}</span></div>`;
  const trend = r.history.length < 2 ? "—" : r.change >= 3 ? `▲ Up ${r.change}` : r.change <= -3 ? `▼ Down ${Math.abs(r.change)}` : "● Steady";

  // Report card: fills up during the term, final after the exams
  const record = recordFromView(view);
  const reportHtml = `<div class="no-print" style="display: flex; justify-content: flex-end"><button type="button" onclick="window.print()" class="pbtn gold">Print report card</button></div>${reportCardHtml(record.report, settings, SCHOOL.name)}`;

  $("child").innerHTML = `
  <div class="no-print" style="display: flex; flex-direction: column; gap: 20px">
    <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px">
      <h2 style="font-size: 28px">${child.name}</h2>
      <span style="padding: 4px 12px; border-radius: 999px; background: #EEF1F6; font-weight: 700; font-size: 14px">${child.className}</span>
      ${band ? `<span style="padding: 4px 12px; border-radius: 999px; background: ${band.soft}; color: ${band.color}; font-weight: 700; font-size: 14px">${band.label}</span>` : ""}
      ${updated ? `<span style="font-size: 13px; color: #5B6472">Updated ${updated.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>` : ""}
    </div>

    <div style="display: flex; flex-wrap: wrap; gap: 10px">
      <button type="button" id="see-report" class="pbtn gold" aria-expanded="false" aria-controls="report-box">See report card</button>
      <button type="button" id="dl-record" class="pbtn line">Download ${child.name.split(" ")[0]}'s record</button>
      <span style="flex-basis: 100%; font-size: 13px; color: #5B6472">At the end of every term, please download the record and keep it — it has the report card and every assessment.</span>
    </div>

    <div style="display: flex; flex-wrap: wrap; gap: 14px">
      ${tile("Average this term", r.average === null ? "—" : `${r.average}%`, band ? band.label : "No scores yet", band ? band.color : "#12305A")}
      ${tile("Attendance", attPct === null ? "—" : `${attPct}%`, days.length ? `${present} of ${days.length} days in school` : "Not recorded yet", attPct === null ? "#12305A" : attPct >= 90 ? "#157F3B" : attPct >= 80 ? "#8A5A00" : "#B42318")}
      ${tile("Days absent", absentDays.length, lateDays.length ? `Late ${lateDays.length} time${lateDays.length === 1 ? "" : "s"}` : "")}
      ${tile("Recent trend", trend)}
    </div>

    <div class="card" style="background: ${band ? band.soft : "#FFFFFF"}; display: flex; flex-direction: column; gap: 6px">
      <h3 style="font-size: 16px">How ${child.name.split(" ")[0]} is doing</h3>
      <p style="margin: 0; line-height: 1.7">${parentMessage(child.name, r)}</p>
    </div>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px">
      <section class="card" style="display: flex; flex-direction: column; gap: 14px">
        <h3 style="font-size: 17px">Subjects</h3>
        ${subjects.length === 0 ? '<p style="margin: 0; color: #5B6472">No scores yet.</p>' : subjects.map((x) => {
          const b = BANDS[bandOf(x.avg)];
          return `<div style="display: flex; flex-direction: column; gap: 5px">
            <div style="display: flex; justify-content: space-between; gap: 12px; font-size: 14px"><strong>${x.s}</strong><span style="color: ${b.color}; font-weight: 700">${x.avg}% · ${b.label}</span></div>
            <div style="height: 10px; border-radius: 5px; background: #EEF1F6"><div style="width: ${x.avg}%; height: 10px; border-radius: 5px; background: ${b.bar}"></div></div>
            <span style="font-size: 12px; color: #5B6472">Latest: ${x.latest.typeLabel}, ${shortDate(x.latest.date)} — ${x.latest.score} / ${x.latest.max}</span>
          </div>`;
        }).join("")}
      </section>
      <section class="card" style="display: flex; flex-direction: column; gap: 14px">
        <h3 style="font-size: 17px">Progress by month</h3>
        ${monthBars(months, { title: `${child.name} average by month`, height: 170 })}
      </section>
    </div>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px">
      <section class="card" style="display: flex; flex-direction: column; gap: 10px">
        <h3 style="font-size: 17px">Strongest topics</h3>
        ${r.topics.slice(0, 3).map((t) => `<span style="font-size: 14px">★ ${t.name} <strong style="color: ${BANDS[bandOf(t.average)].color}">${t.average}%</strong></span>`).join("") || '<span style="color: #5B6472">—</span>'}
        <h3 style="font-size: 17px; margin-top: 8px">Topics to practise at home</h3>
        ${r.topics.length > 1 ? r.topics.slice(-3).reverse().filter((t) => t.average < r.topics[0].average).map((t) => `<span style="font-size: 14px">→ ${t.name} <strong style="color: ${BANDS[bandOf(t.average)].color}">${t.average}%</strong></span>`).join("") : '<span style="color: #5B6472">—</span>'}
      </section>
      <section class="card" style="display: flex; flex-direction: column; gap: 10px">
        <h3 style="font-size: 17px">Attendance</h3>
        ${absentDays.length === 0 ? '<p style="margin: 0; color: #157F3B; font-weight: 600">Not absent this term ✓</p>'
          : `<p style="margin: 0; font-size: 14px">Absent on:</p><div style="display: flex; flex-wrap: wrap; gap: 6px">${absentDays.map((a) => `<span style="padding: 4px 10px; border-radius: 999px; background: #FDE8E7; color: #8F1D15; font-size: 13px; font-weight: 600">${shortDate(a.date)}</span>`).join("")}</div>`}
      </section>
    </div>

    <section class="card" style="display: flex; flex-direction: column; gap: 10px">
      <h3 style="font-size: 17px">Recent scores</h3>
      <div style="overflow-x: auto"><table style="width: 100%; min-width: 520px; border-collapse: collapse; font-size: 14px">
        <thead><tr style="text-align: left; color: #5B6472; font-size: 13px"><th style="padding: 8px">Date</th><th style="padding: 8px">Subject</th><th style="padding: 8px">Type</th><th style="padding: 8px">Topic</th><th style="padding: 8px; text-align: right">Score</th></tr></thead>
        <tbody>${r.history.slice(-10).reverse().map((h) => `<tr style="border-top: 1px solid #EEF1F6">
          <td style="padding: 8px">${shortDate(h.date)}</td><td style="padding: 8px">${h.subject}</td>
          <td style="padding: 8px"><span style="display: inline-block; width: 10px; height: 10px; border-radius: 2px; background: ${typeColors[h.type]}; margin-right: 6px"></span>${h.typeLabel}</td>
          <td style="padding: 8px">${h.topic}</td>
          <td style="padding: 8px; text-align: right; font-weight: 700; color: ${BANDS[bandOf(h.percent)].color}">${h.score} / ${h.max} (${h.percent}%)</td></tr>`).join("") || '<tr><td colspan="5" style="padding: 8px; color: #5B6472">No scores yet.</td></tr>'}</tbody>
      </table></div>
    </section>

  </div>
  <div id="report-box" hidden style="display: flex; flex-direction: column; gap: 12px">
    <h3 class="no-print" style="font-size: 20px">Report card</h3>
    ${reportHtml}
  </div>`;

  $("see-report").addEventListener("click", () => {
    const box = $("report-box");
    box.hidden = !box.hidden;
    $("see-report").setAttribute("aria-expanded", String(!box.hidden));
    $("see-report").textContent = box.hidden ? "See report card" : "Hide report card";
    if (!box.hidden) box.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("dl-record").addEventListener("click", () => {
    downloadRecords([record], settings, `${child.name} - ${child.className} - ${settings.term} - ClassPulse record`);
  });
}

start().catch((error) => { $("child").innerHTML = `<p style="color: #B42318; font-weight: 600">Could not load: ${error.message}</p>`; });
