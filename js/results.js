// js/results.js
// Shared rules for working out results, used by the Students page, Dashboard and Report cards,
// so every page agrees.

// Score bands: 75%+ above average, 50–74% average, under 50% below average
export const BANDS = {
  above:   { label: "Above average", min: 75, color: "#115E2C", soft: "#E3F4E8", bar: "#157F3B" },
  average: { label: "Average",       min: 50, color: "#1E4C8F", soft: "#E6EEFA", bar: "#1E5AA8" },
  below:   { label: "Below average", min: 0,  color: "#8F1D15", soft: "#FDE8E7", bar: "#B42318" }
};

export const typeColors = { ex: "#1E5AA8", hw: "#5B3BA8", ct: "#F2A300", exam: "#12305A" };

export const average = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
export const bandOf = (pct) => (pct === null ? null : pct >= 75 ? "above" : pct >= 50 ? "average" : "below");

// "2026-11-20" -> "20 Nov"
export const shortDate = (iso) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });

// 1 -> "1st", 2 -> "2nd", 3 -> "3rd", 11 -> "11th"
export function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// Today's date as "2026-11-20" (local time)
export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// One student's results from a list of assessments.
// topicWithSubject: true when several subjects are mixed together (e.g. "Mathematics · Fractions").
export function resultsFor(studentId, list, topicWithSubject = false) {
  const history = list
    .filter((a) => a.scores[studentId] !== undefined)
    .map((a) => ({
      date: a.date, type: a.type, typeLabel: a.typeLabel, topic: a.topic, subject: a.subject,
      score: a.scores[studentId], max: a.maxScore,
      percent: Math.round((a.scores[studentId] / a.maxScore) * 100)
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const percents = history.map((h) => h.percent);
  const avg = percents.length ? Math.round(average(percents)) : null;

  // Trend: later half of scores compared with the earlier half
  let change = 0;
  if (percents.length >= 2) {
    const half = Math.floor(percents.length / 2);
    change = Math.round(average(percents.slice(-half)) - average(percents.slice(0, half)));
  }

  // Average per topic, strongest first
  const byTopic = {};
  history.forEach((h) => {
    if (h.type === "exam") return; // the exam covers the whole term, not one topic
    const key = topicWithSubject ? `${h.subject} · ${h.topic}` : h.topic;
    (byTopic[key] ||= []).push(h.percent);
  });
  const topics = Object.entries(byTopic)
    .map(([name, l]) => ({ name, average: Math.round(average(l)), count: l.length }))
    .sort((a, b) => b.average - a.average);

  return {
    history, average: avg, change, topics,
    latest: percents.length ? percents[percents.length - 1] : null,
    band: bandOf(avg),
    needsAttention: avg !== null && (avg < 50 || change <= -8)
  };
}

// Rank students by average, highest first. Equal averages share a place (1, 2, 2, 4).
// Each student needs a "results" object from resultsFor().
export function rank(students) {
  const scored = students.filter((s) => s.results.average !== null)
    .sort((a, b) => b.results.average - a.results.average || a.name.localeCompare(b.name));
  scored.forEach((s, i) => {
    s.rank = i > 0 && s.results.average === scored[i - 1].results.average ? scored[i - 1].rank : i + 1;
  });
  const unscored = students.filter((s) => s.results.average === null)
    .sort((a, b) => a.name.localeCompare(b.name));
  unscored.forEach((s) => (s.rank = null));
  return [...scored, ...unscored];
}
