// js/simulate.js
// ADMIN ONLY. Fills one school with a realistic term of PRACTICE data so you can see every
// page working: students, daily registers (with absences), exercises, homework, class tests,
// a final exam, and topics. Everything it adds is marked  sim: true  so "Remove practice data"
// can take it all out again without touching real records.

import { db } from "./firebase.js";
import { requireRole, logOut } from "./auth.js";
import {
  collection, doc, getDocs, getDoc, query, where, writeBatch, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { LEVELS, levelOf, classOrder } from "./levels.js";
import { isoDate } from "./progress.js";

const me = await requireRole("admin");
const $ = (id) => document.getElementById(id);
$("who").textContent = me.user.email;
$("logout-btn").addEventListener("click", logOut);
$("page").hidden = false;

// The 153 students from "ClassPulse sample students.xlsx"
const SAMPLE_NAMES = {"Creche 1": ["Kwaku Bonsu", "Grace Gyamfi", "Isaac Tetteh", "Faustina Nyarko", "Joshua Fosu", "Esther Boakye", "Kpakpo Afriyie", "Mary Kyei"], "Creche 2": ["Richard Nkansah", "Naa Osei", "Kwame Opoku", "Abena Agyeman", "Nana Tetteh", "Naa Mensah", "Bright Ampofo", "Korkor Ampofo", "Selorm Annan"], "KG 1": ["Nii Amoah", "Afia Dogbe", "Eric Kpodo", "Comfort Gyamfi", "Isaac Addo", "Comfort Danso", "Kwabena Boakye", "Mary Acheampong", "Nana Yeboah", "Yaa Wiredu"], "KG 2": ["Prince Afriyie", "Araba Asante", "Felix Agbeko", "Afia Yeboah", "Kpakpo Quaye", "Dzifa Nkansah", "Samuel Kyei", "Patience Agyeman", "Kpakpo Gyamfi", "Doris Fosu", "Joshua Kyei"], "Primary 1": ["Nii Ansah", "Esi Laryea", "David Amankwah", "Grace Ansah", "Eric Asante", "Abigail Nyarko", "Richard Ofori", "Rita Boateng", "Prince Ansah", "Faustina Asamoah", "Kwaku Opoku", "Enyonam Amankwah"], "Primary 2": ["Yaw Amankwah", "Priscilla Adomako", "Michael Ampofo", "Korkor Owusu-Ansah", "Ebo Boakye", "Dzifa Asamoah", "Nana Boakye", "Doris Wiredu", "Emmanuel Adomako", "Korkor Lamptey", "Kpakpo Frimpong", "Araba Antwi"], "Primary 3": ["Kwame Owusu", "Faustina Fosu", "Michael Ansah", "Hannah Kyei", "Elikem Frimpong", "Esi Adomako", "Daniel Yeboah", "Grace Kyei", "Eric Nartey", "Mary Asamoah", "Caleb Owusu", "Rita Acheampong", "Selorm Yeboah"], "Primary 4": ["Caleb Tetteh", "Naa Adomako", "Prince Gyamfi", "Esi Ocran", "Caleb Sarpong", "Abena Wiredu", "Ebo Kyei", "Afia Tetteh", "Kwasi Laryea", "Yaa Ocran", "Caleb Mensah", "Abena Mensah"], "Primary 5": ["Michael Nkansah", "Mary Quaye", "Joseph Frimpong", "Efua Agyeman", "Joseph Owusu", "Joyce Owusu-Ansah", "Ebo Asamoah", "Joyce Arthur", "Elikem Darko", "Ama Bonsu", "Benjamin Nkansah", "Abigail Kyei", "Prince Ofori"], "Primary 6": ["Samuel Nyarko", "Korkor Nkansah", "Yaw Fosu", "Faustina Adomako", "Emmanuel Acheampong", "Abena Laryea", "Benjamin Appiah", "Hannah Ofori", "Eric Nkansah", "Araba Gyamfi", "Kpakpo Kpodo", "Doris Darko"], "JHS 1": ["Emmanuel Frimpong", "Dzifa Mensah", "Kwaku Kpodo", "Faustina Addo", "Kofi Dogbe", "Priscilla Dogbe", "Caleb Asante", "Ama Gyamfi", "Daniel Bonsu", "Gifty Badu", "Michael Bonsu", "Hannah Agyeman", "David Opoku", "Doris Appiah"], "JHS 2": ["Yaw Nkansah", "Grace Annan", "Kpakpo Opoku", "Adjoa Yeboah", "Joseph Nyarko", "Gifty Addo", "Samuel Lamptey", "Akosua Frimpong", "Isaac Sarpong", "Akosua Wiredu", "Samuel Boateng", "Naa Wiredu", "Kwasi Amankwah"], "JHS 3": ["Prince Ampofo", "Faustina Asante", "Yaw Wiredu", "Doris Ansah", "Joshua Ofori", "Afua Asamoah", "Felix Sarpong", "Dzifa Antwi", "Kpakpo Owusu-Ansah", "Enyonam Quaye", "Nii Badu", "Afua Dogbe", "Kojo Amoah", "Naa Kyei"]};

const SUBJECTS = ["English Language", "Mathematics", "Science", "Social Studies"];
const TOPICS = {
  "English Language": ["Reading comprehension", "Parts of speech", "Letter writing", "Composition"],
  "Mathematics": ["Numbers and counting", "Fractions", "Measurement", "Shapes and space"],
  "Science": ["Living things", "Water", "Plants", "Energy"],
  "Social Studies": ["My family", "Our community", "Culture and festivals", "Our country Ghana"]
};
const TYPES = {
  ex: { label: "Class exercise", max: 10 },
  hw: { label: "Homework", max: 20 },
  ct: { label: "Class test", max: 30 },
  exam: { label: "Examination", max: 100 }
};

const makeId = (text) => text.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Same "random" numbers every run, so results are repeatable
function seeded(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function log(text, color = "#12305A") {
  const p = document.createElement("p");
  p.style.cssText = `margin: 0; color: ${color}`;
  p.textContent = text;
  $("log").appendChild(p);
  p.scrollIntoView({ block: "nearest" });
}

// ---------- Choose a school ----------
const schoolSnap = await getDocs(collection(db, "schools"));
const schools = schoolSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((s) => !s.removed)
  .sort((a, b) => a.name.localeCompare(b.name));
$("school").innerHTML = schools.length
  ? schools.map((s) => `<option value="${s.id}">${s.name}</option>`).join("")
  : '<option value="">No schools yet — add one on the Admin page</option>';

// ---------- Write many records in groups (Firestore allows 500 per group) ----------
async function writeAll(writes, label) {
  for (let i = 0; i < writes.length; i += 400) {
    const batch = writeBatch(db);
    writes.slice(i, i + 400).forEach(([ref, data, merge]) => batch.set(ref, data, merge ? { merge: true } : {}));
    await batch.commit();
    log(`  ${label}: ${Math.min(i + 400, writes.length)} of ${writes.length} saved`);
    await sleep(50);
  }
}

// ---------- Run the simulation ----------
$("run-btn").addEventListener("click", async () => {
  const schoolId = $("school").value;
  if (!schoolId) return;
  const school = schools.find((s) => s.id === schoolId);
  if (!confirm(`Fill ${school.name} with practice data?\n\nIt adds about 7 weeks of registers and scores. You can remove it all later with "Remove practice data".`)) return;

  $("run-btn").disabled = true; $("clear-btn").disabled = true;
  $("log").innerHTML = "";
  const rand = seeded(2026);
  const sc = (name) => collection(db, "schools", schoolId, name);
  const sd = (name, id) => doc(db, "schools", schoolId, name, id);

  try {
    // 1. Classes and students -----------------------------------------
    log("1. Checking classes and students…");
    const classSnap = await getDocs(sc("classes"));
    const classes = {};
    classSnap.docs.forEach((d) => (classes[d.data().className] = { id: d.id, ...d.data() }));
    const usedIds = new Set();
    Object.values(classes).forEach((c) => (c.students || []).forEach((s) => usedIds.add(s.id)));
    (Object.values(classes)).forEach((c) => (c.removedIds || []).forEach((id) => usedIds.add(id)));

    const studentWrites = [];
    for (const [className, list] of Object.entries(SAMPLE_NAMES)) {
      const cls = classes[className] || { id: makeId(className), className, level: levelOf(className), students: [] };
      if ((cls.students || []).length > 0) continue; // class already has students: use them
      cls.students = list.map((name) => {
        let id = makeId(name), n = 2;
        while (usedIds.has(id)) id = `${makeId(name)}-${n++}`;
        usedIds.add(id);
        studentWrites.push([sd("students", id), { id, name, className, sim: true, createdAt: serverTimestamp() }]);
        return { id, name, sim: true };
      }).sort((a, b) => a.name.localeCompare(b.name));
      classes[className] = cls;
      studentWrites.push([sd("classes", cls.id), { className, level: cls.level || levelOf(className), students: cls.students, updatedAt: serverTimestamp() }, true]);
    }
    if (studentWrites.length) await writeAll(studentWrites, "students");
    const classList = Object.values(classes).filter((c) => (c.students || []).length).sort(classOrder);
    log(`   ${classList.length} classes, ${classList.reduce((n, c) => n + c.students.length, 0)} students ✓`, "#157F3B");

    // 2. The term: 7 weeks ago until today, exams last week ---------------
    const today = new Date();
    const mondayThisWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
    const termStart = new Date(mondayThisWeek.getFullYear(), mondayThisWeek.getMonth(), mondayThisWeek.getDate() - 7 * 7);
    const dayOf = (week, weekday) => new Date(termStart.getFullYear(), termStart.getMonth(), termStart.getDate() + week * 7 + weekday);
    const examWeek = 6, currentWeek = 7;
    const todayIso = isoDate(today);
    await setDoc(sd("settings", "targets"), { termStart: isoDate(termStart), examDate: isoDate(dayOf(examWeek, 0)), updatedAt: serverTimestamp() }, { merge: true });
    log(`2. Term set: ${isoDate(termStart)} to today, final exams the week of ${isoDate(dayOf(examWeek, 0))} ✓`, "#157F3B");

    // Each student: an ability level, a trend (improving / dropping), and how often they're absent
    const profile = {};
    classList.forEach((c) => c.students.forEach((s) => {
      const often = rand() < 0.06;
      profile[s.id] = {
        ability: 44 + rand() * 50,              // 44%–94%
        trend: (rand() - 0.45) * 2.4,           // points per week, some up, some down
        absent: often ? 0.22 : 0.035,
        late: 0.05
      };
    }));
    const absentOn = {}; // "studentId|date" -> true

    // 3. Daily registers -------------------------------------------------
    log("3. Taking daily registers…");
    const regWrites = [];
    const skipToday = new Set(classList.slice(-3).map((c) => c.className)); // a few classes haven't taken today's yet
    for (let w = 0; w <= currentWeek; w++) {
      for (let wd = 0; wd < 5; wd++) {
        const d = dayOf(w, wd);
        const date = isoDate(d);
        if (date > todayIso) continue;
        classList.forEach((c) => {
          if (date === todayIso && skipToday.has(c.className)) return;
          const records = {};
          let present = 0, absent = 0, late = 0;
          c.students.forEach((s) => {
            const p = profile[s.id], r = rand();
            const mark = r < p.absent ? "A" : r < p.absent + p.late ? "L" : "P";
            records[s.id] = mark;
            if (mark === "A") { absent++; absentOn[`${s.id}|${date}`] = true; } else if (mark === "L") late++; else present++;
          });
          regWrites.push([sd("attendance", `${makeId(c.className)}_${date}`), { className: c.className, date, records, present, absent, late, sim: true, savedAt: serverTimestamp() }]);
        });
      }
    }
    await writeAll(regWrites, "registers");

    // 4. Topics and scores -------------------------------------------------
    log("4. Recording topics, exercises, homework, class tests and exams…");
    const topicWrites = [], scoreWrites = [];
    const scoreFor = (s, week, max, date, extraNoise = 10) => {
      if (absentOn[`${s.id}|${date}`]) return null; // absent that day: no score
      const p = profile[s.id];
      const pct = Math.max(5, Math.min(100, p.ability + p.trend * week + (rand() - 0.5) * extraNoise * 2));
      return Math.round((pct / 100) * max * 2) / 2;
    };
    const addAssessment = (c, subject, topic, topicId, type, week, weekday, idPart) => {
      const date = isoDate(dayOf(week, weekday));
      if (date > todayIso) return;
      const scores = {};
      c.students.forEach((s) => {
        const v = scoreFor(s, week, TYPES[type].max, date, type === "exam" ? 6 : 10);
        if (v !== null) scores[s.id] = v;
      });
      const got = Object.values(scores);
      const averagePercent = got.length ? Math.round((got.reduce((a, b) => a + b, 0) / got.length / TYPES[type].max) * 100) : 0;
      scoreWrites.push([sd("assessments", `sim-${makeId(c.className)}-${makeId(subject)}-${idPart}`), {
        className: c.className, subject, topic, topicId, type, typeLabel: TYPES[type].label, maxScore: TYPES[type].max,
        date, scores, recorded: got.length, averagePercent, sim: true, savedAt: serverTimestamp()
      }]);
    };

    classList.forEach((c) => {
      SUBJECTS.forEach((subject, si) => {
        // 4 topics, two weeks each (weeks 0–1, 2–3, 4–5, 7); the last one is still in progress
        const topicWeeks = [[0, 1], [2, 3], [4, 5], [7, 7]];
        topicWeeks.forEach(([from, to], k) => {
          const topicName = TOPICS[subject][k];
          const topicId = `sim-${makeId(c.className)}-${makeId(subject)}-t${k}`;
          const inProgress = k === topicWeeks.length - 1;
          topicWrites.push([sd("topics", topicId), {
            className: c.className, subject, name: topicName,
            status: inProgress ? "in-progress" : "completed",
            startDate: isoDate(dayOf(from, 0)), endDate: inProgress ? null : isoDate(dayOf(to, 4)),
            sim: true, createdAt: serverTimestamp()
          }]);
          for (let w = from; w <= to; w++) {
            addAssessment(c, subject, topicName, topicId, "ex", w, si % 5, `ex-w${w}`);
            addAssessment(c, subject, topicName, topicId, "hw", w, (si + 2) % 5, `hw-w${w}`);
            if (w === to && w !== currentWeek) addAssessment(c, subject, topicName, topicId, "ct", w, 4, `ct-w${w}`);
          }
        });
        // Final exam last week (covers the whole term)
        addAssessment(c, subject, "End of term examination", null, "exam", examWeek, si % 5, "exam");
      });
    });
    await writeAll(topicWrites, "topics");
    await writeAll(scoreWrites, "scores");

    log("Done ✓ Practice data is ready. Open the school to look around:", "#157F3B");
    $("done-links").hidden = false;
    sessionStorage.setItem("cp-view-school", schoolId);
  } catch (error) {
    log("Something went wrong: " + error.message, "#B42318");
  } finally {
    $("run-btn").disabled = false; $("clear-btn").disabled = false;
  }
});

// ---------- Remove all practice data ----------
$("clear-btn").addEventListener("click", async () => {
  const schoolId = $("school").value;
  if (!schoolId) return;
  const school = schools.find((s) => s.id === schoolId);
  if (!confirm(`Remove all practice data from ${school.name}?\n\nOnly records made by the simulation are removed. Real records stay.`)) return;
  $("run-btn").disabled = true; $("clear-btn").disabled = true;
  $("log").innerHTML = "";
  try {
    for (const name of ["assessments", "attendance", "topics", "students"]) {
      const snap = await getDocs(query(collection(db, "schools", schoolId, name), where("sim", "==", true)));
      for (let i = 0; i < snap.docs.length; i += 400) {
        const batch = writeBatch(db);
        snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
      log(`${name}: ${snap.docs.length} practice records removed`);
    }
    // Take practice students out of the class lists
    const classSnap = await getDocs(collection(db, "schools", schoolId, "classes"));
    const batch = writeBatch(db);
    classSnap.docs.forEach((d) => {
      const list = d.data().students || [];
      if (list.some((s) => s.sim)) batch.set(d.ref, { students: list.filter((s) => !s.sim) }, { merge: true });
    });
    await batch.commit();
    log("Done ✓ All practice data removed.", "#157F3B");
  } catch (error) {
    log("Something went wrong: " + error.message, "#B42318");
  } finally {
    $("run-btn").disabled = false; $("clear-btn").disabled = false;
  }
});
