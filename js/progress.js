// js/progress.js
// Weekly targets and progress circles, shared by the headmaster and teacher pages.

import { levelOf } from "./levels.js";

// Starting targets for each level (the headmaster can change them)
export const DEFAULT_TARGETS = {
  termStart: "",
  examDate: "",
  byLevel: {
    Creche:       { topics: 1, exercises: 2, homework: 0, testsPerMonth: 0 },
    Kindergarten: { topics: 1, exercises: 3, homework: 1, testsPerMonth: 0 },
    Primary:      { topics: 2, exercises: 3, homework: 2, testsPerMonth: 1 },
    JHS:          { topics: 2, exercises: 3, homework: 2, testsPerMonth: 1 }
  }
};

export function withTargetDefaults(saved = {}) {
  const byLevel = {};
  Object.keys(DEFAULT_TARGETS.byLevel).forEach((l) => {
    byLevel[l] = { ...DEFAULT_TARGETS.byLevel[l], ...((saved.byLevel || {})[l] || {}) };
  });
  return { ...DEFAULT_TARGETS, ...saved, byLevel };
}

// "2026-11-24" style date in local time
export const isoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// This week (Monday to Sunday) and this month
export function currentPeriods(today = new Date()) {
  const day = (today.getDay() + 6) % 7; // Monday = 0
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - day);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return {
    weekStart: isoDate(monday), weekEnd: isoDate(sunday),
    monthStart: isoDate(monthStart), monthEnd: isoDate(monthEnd),
    earliest: isoDate(monthStart < monday ? monthStart : monday)
  };
}

// How far one class is with this week's (and this month's) targets
export function classProgress(className, targets, topics, assessments, periods = currentPeriods()) {
  const t = targets.byLevel[levelOf(className)] || { topics: 0, exercises: 0, homework: 0, testsPerMonth: 0 };
  const inWeek = (date) => date >= periods.weekStart && date <= periods.weekEnd;
  const inMonth = (date) => date >= periods.monthStart && date <= periods.monthEnd;
  const mine = assessments.filter((a) => a.className === className);

  const items = [
    { key: "topics", label: "Topics", note: "this week", target: t.topics,
      done: topics.filter((x) => x.className === className && inWeek(x.startDate)).length },
    { key: "exercises", label: "Exercises", note: "this week", target: t.exercises,
      done: mine.filter((a) => a.type === "ex" && inWeek(a.date)).length },
    { key: "homework", label: "Homework", note: "this week", target: t.homework,
      done: mine.filter((a) => a.type === "hw" && inWeek(a.date)).length },
    { key: "tests", label: "Class tests", note: "this month", target: t.testsPerMonth,
      done: mine.filter((a) => a.type === "ct" && inMonth(a.date)).length }
  ].map((i) => ({ ...i, percent: i.target > 0 ? Math.min(100, Math.round((i.done / i.target) * 100)) : null }));

  const counted = items.filter((i) => i.percent !== null);
  const overall = counted.length ? Math.round(counted.reduce((n, i) => n + i.percent, 0) / counted.length) : null;
  return { items, overall };
}

// A progress circle (SVG). Green at 100%, gold from 50%, red below 50%.
export function ring(percent, size = 64, label = "") {
  const r = (size - 8) / 2, c = 2 * Math.PI * r;
  const p = percent === null ? 0 : percent;
  const color = percent === null ? "#C9D2DF" : p >= 100 ? "#157F3B" : p >= 50 ? "#F2A300" : "#B42318";
  const text = percent === null ? "—" : `${p}%`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${label ? label + ": " : ""}${percent === null ? "no target" : p + "% done"}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#EEF1F6" stroke-width="7"></circle>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round"
      stroke-dasharray="${(c * p) / 100} ${c}" transform="rotate(-90 ${size / 2} ${size / 2})"></circle>
    <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" font-family="Inter, sans-serif" font-size="${Math.round(size / 4.6)}" font-weight="700" fill="#12305A">${text}</text>
  </svg>`;
}
