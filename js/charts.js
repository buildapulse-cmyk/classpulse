// js/charts.js
// Month-by-month progress, drawn as simple bar charts with HTML and CSS (no chart library).
// Each bar's height is set by its value; colours follow the ClassPulse bands.

import { average, bandOf, BANDS } from "./results.js";

// "2026-10-14" -> "2026-10"
const monthKey = (iso) => iso.slice(0, 7);

// "2026-10" -> "Oct" (or "Oct 26" when the months cross a new year)
function monthLabel(key, withYear) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString("en-GB", withYear ? { month: "short", year: "2-digit" } : { month: "short" });
}

// Average score (%) per month, from saved assessments (exams included — they are part of progress)
export function monthlyScores(assessments) {
  const byMonth = {};
  assessments.forEach((a) => (byMonth[monthKey(a.date)] ||= []).push(a.averagePercent));
  return Object.keys(byMonth).sort().map((k) => ({ key: k, value: Math.round(average(byMonth[k])) }));
}

// Attendance (% of students present or late) per month, from saved registers
export function monthlyAttendance(registers) {
  const byMonth = {};
  registers.forEach((r) => {
    const m = (byMonth[monthKey(r.date)] ||= { inSchool: 0, total: 0 });
    m.inSchool += r.present + r.late;
    m.total += r.present + r.late + r.absent;
  });
  return Object.keys(byMonth).sort().map((k) => ({
    key: k, value: byMonth[k].total ? Math.round((byMonth[k].inSchool / byMonth[k].total) * 100) : 0
  }));
}

// Attendance colours: 90%+ green, 80–89% gold, under 80% red
const attendanceColor = (v) => (v >= 90 ? "#157F3B" : v >= 80 ? "#F2A300" : "#B42318");

// A month-by-month bar chart. kind = "score" (band colours) or "attendance".
export function monthBars(points, { kind = "score", height = 160, title = "" } = {}) {
  if (points.length === 0) {
    return `<p style="margin: 0; font-size: 14px; color: #5B6472">Nothing recorded yet.</p>`;
  }
  const withYear = new Set(points.map((p) => p.key.slice(0, 4))).size > 1;
  const color = (v) => (kind === "attendance" ? attendanceColor(v) : BANDS[bandOf(v)].bar);
  const label = `${title}: ` + points.map((p) => `${monthLabel(p.key, withYear)} ${p.value}%`).join(", ");

  return `
  <div role="img" aria-label="${label}" style="display: flex; flex-direction: column; gap: 6px">
    <div style="display: flex; align-items: flex-end; gap: 8px; height: ${height}px; border-bottom: 2px solid #E2E7EF; padding: 0 4px">
      ${points.map((p) => `
        <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 4px; height: 100%; min-width: 0">
          <span style="font-size: 12px; font-weight: 700; color: #12305A">${p.value}%</span>
          <div style="width: 100%; max-width: 52px; height: ${Math.max(2, Math.round((p.value / 100) * (height - 24)))}px; border-radius: 6px 6px 0 0; background: ${color(p.value)}"></div>
        </div>`).join("")}
    </div>
    <div style="display: flex; gap: 8px; padding: 0 4px">
      ${points.map((p) => `<span style="flex: 1; text-align: center; font-size: 12px; color: #5B6472; min-width: 0">${monthLabel(p.key, withYear)}</span>`).join("")}
    </div>
  </div>`;
}

// A tiny version for class cards (no labels on the bars)
export function miniBars(points) {
  if (points.length === 0) return "";
  const withYear = new Set(points.map((p) => p.key.slice(0, 4))).size > 1;
  const label = "Average by month: " + points.map((p) => `${monthLabel(p.key, withYear)} ${p.value}%`).join(", ");
  return `
  <div role="img" aria-label="${label}" style="display: flex; flex-direction: column; gap: 3px">
    <div style="display: flex; align-items: flex-end; gap: 4px; height: 40px">
      ${points.map((p) => `<div title="${monthLabel(p.key, withYear)}: ${p.value}%" style="flex: 1; height: ${Math.max(2, Math.round(p.value * 0.4))}px; border-radius: 3px 3px 0 0; background: ${BANDS[bandOf(p.value)].bar}"></div>`).join("")}
    </div>
    <div style="display: flex; gap: 4px">
      ${points.map((p) => `<span style="flex: 1; text-align: center; font-size: 10px; color: #5B6472">${monthLabel(p.key, withYear)}</span>`).join("")}
    </div>
  </div>`;
}
