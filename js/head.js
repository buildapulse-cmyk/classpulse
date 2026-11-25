// js/head.js
// The headmaster's portal: overview of every class with progress circles,
// teacher accounts, class PINs and weekly targets.

import { db } from "./firebase.js";
import { getDocs, getDoc, setDoc, updateDoc, query, where, collection, doc, writeBatch, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { useSchool, schoolCol, schoolDoc, SCHOOL } from "./school.js";
import { createLogin, resetPassword, friendlyError, parentLogin, parentUsername, parentPassword } from "./auth.js";
import { LEVELS, SUBJECTS, levelOf, classOrder } from "./levels.js";
import { average, bandOf, BANDS, resultsFor } from "./results.js";
import { exportButton } from "./export.js";
import { monthlyScores, monthlyAttendance, monthBars, miniBars } from "./charts.js";
import { withTargetDefaults, currentPeriods, classProgress, ring, isoDate } from "./progress.js";
import { hashPin, newPin } from "./pins.js";
import { refreshParentViews, lastParentRefresh, needsRefresh } from "./parent-views.js";
import { drawYear, withYearDefaults, termIsEnding } from "./school-year.js";

await useSchool("headmaster");
const $ = (id) => document.getElementById(id);
$("page").hidden = false;
$("school-name").textContent = SCHOOL.name || "Your school";
$("today-text").textContent = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

const makeId = (text) => text.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
function say(id, text, color) { $(id).textContent = text; $(id).style.color = color; }

let classes = [];
let teachers = [];
let parents = [];
let newChildren = []; // children picked for the parent being added
let targets = withTargetDefaults();
let pins = {};
let profile = { schoolName: "", motto: "", term: "", badge: null };
let latest = null;
let year = withYearDefaults(); // the term's records, kept for refreshing parents' views

// ---------- Tabs ----------
const tabs = ["overview", "teachers", "parents", "pins", "targets", "profile", "year"];
function showTab(name) {
  tabs.forEach((t) => {
    $(`tab-${t}`).setAttribute("aria-selected", t === name);
    $(`panel-${t}`).hidden = t !== name;
  });
}
tabs.forEach((t) => $(`tab-${t}`).addEventListener("click", () => showTab(t)));
document.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => {
  showTab(b.dataset.go);
  if (b.dataset.go === "teachers") $("t-name").focus();
}));
exportButton($("head-export"), $("export-status"));

// ---------- Load ----------
async function loadAll() {
  const periods = currentPeriods();
  const [classSnap, teacherSnap, targetDoc, pinDoc, reportDoc, parentSnap, yearDoc] = await Promise.all([
    getDocs(schoolCol("classes")),
    getDocs(query(collection(db, "users"), where("schoolId", "==", SCHOOL.id), where("role", "==", "teacher"))),
    getDoc(schoolDoc("settings", "targets")),
    getDoc(schoolDoc("private", "pins")),
    getDoc(schoolDoc("settings", "report")),
    getDocs(query(collection(db, "users"), where("schoolId", "==", SCHOOL.id), where("role", "==", "parent"))),
    getDoc(schoolDoc("settings", "year"))
  ]);
  // (an old login replaced by a PIN reset is hidden)
  parents = parentSnap.docs.map((d) => ({ uid: d.id, ...d.data() })).filter((p) => !p.replacedBy).sort((a, b) => a.name.localeCompare(b.name));
  const report = reportDoc.exists() ? reportDoc.data() : {};
  profile = { schoolName: report.schoolName || "", motto: report.motto || "", term: report.term || "", badge: report.badge || null };
  drawProfile();
  classes = classSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(classOrder);
  teachers = teacherSnap.docs.map((d) => ({ uid: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name));
  targets = withTargetDefaults(targetDoc.exists() ? targetDoc.data() : {});
  pins = pinDoc.exists() ? pinDoc.data() : {};
  year = withYearDefaults(yearDoc.exists() ? yearDoc.data() : {}, targets);

  // Scores, topics and attendance needed for the overview (this term, or the last 3 months)
  const since = targets.termStart || isoDate(new Date(Date.now() - 90 * 86400000));
  const from = since < periods.earliest ? since : periods.earliest;
  const [assessSnap, topicSnap, attendSnap] = await Promise.all([
    getDocs(query(schoolCol("assessments"), where("date", ">=", from))),
    getDocs(query(schoolCol("topics"), where("startDate", ">=", periods.earliest))),
    getDocs(query(schoolCol("attendance"), where("date", ">=", since < periods.earliest ? since : periods.earliest)))
  ]);
  const assessments = assessSnap.docs.map((d) => d.data());
  const topics = topicSnap.docs.map((d) => d.data());
  const termRegisters = attendSnap.docs.map((d) => d.data());
  const cutoff = isoDate(new Date(Date.now() - 30 * 86400000));
  const registers30 = termRegisters.filter((a) => a.date >= cutoff);
  const todayRegisters = registers30.filter((a) => a.date === isoDate(new Date()));

  const termScores = assessments.filter((a) => a.date >= since);
  latest = { scores: termScores, registers: termRegisters.filter((a) => a.date >= since), report };
  drawOverview(termScores, assessments, topics, todayRegisters, periods, registers30);
  $("chart-scores").innerHTML = monthBars(monthlyScores(termScores), { title: "School average score by month" });
  $("chart-attendance").innerHTML = monthBars(monthlyAttendance(termRegisters.filter((a) => a.date >= since)), { kind: "attendance", title: "School attendance by month" });

  // Keep every child's private parent summary fresh (at most every 12 hours, or on request)
  const last = await lastParentRefresh(SCHOOL.id);
  showViewsStatus(last);
  if (needsRefresh(last)) updateParentViews();
  fillClassPickers();
  drawTeachers();
  fillParentPickers();
  drawParents();
  drawPins();
  drawTargets();
  drawYear({ classes, parents, targets, year, reload: loadAll });
}

// ---------- Overview ----------
function drawOverview(termScores, recentScores, topics, todayRegisters, periods, registers30) {
  const students = classes.reduce((n, c) => n + (c.students || []).length, 0);
  const present = todayRegisters.reduce((n, a) => n + a.present + a.late, 0);
  const counted = todayRegisters.reduce((n, a) => n + a.present + a.late + a.absent, 0);
  const takenPct = classes.length ? Math.round((todayRegisters.length / classes.length) * 100) : 0;
  const tile = (label, value, note = "") => `<div class="tile"><span style="font-size: 13px; color: #5B6472">${label}</span><strong>${value}</strong><span style="font-size: 13px; color: #5B6472">${note}</span></div>`;
  $("tiles").innerHTML =
    tile("Classes", classes.length) +
    tile("Students", students) +
    tile("Teachers", teachers.filter((t) => t.active !== false).length) +
    tile("Registers taken today", `${takenPct}%`, `${todayRegisters.length} of ${classes.length} classes`);

  drawAttendanceBox(todayRegisters, present, counted, takenPct);
  drawNeeds(termScores, recentScores, topics, registers30, periods);

  const fmt = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  let weeksLeft = "";
  if (targets.examDate) {
    const weeks = Math.ceil((new Date(targets.examDate + "T00:00:00") - new Date()) / (7 * 86400000));
    weeksLeft = weeks > 0 ? ` · ${weeks} week${weeks === 1 ? "" : "s"} until final exams` : " · Final exams have started";
  }
  $("week-text").textContent = `Progress for this week (${fmt(periods.weekStart)} – ${fmt(periods.weekEnd)}) against your weekly targets${weeksLeft}.`;

  if (classes.length === 0) {
    $("levels").innerHTML = '<p style="color: #5B6472">No classes yet. Add them on <a href="class-lists.html">Class lists</a>.</p>';
    return;
  }

  const groups = {};
  classes.forEach((c) => (groups[c.level || levelOf(c.className)] ||= []).push(c));
  const order = [...LEVELS.map((l) => l.level), "Other"];

  $("levels").innerHTML = order.filter((l) => groups[l]).map((level) => `
    <div style="display: flex; flex-direction: column; gap: 12px">
      <h2 style="font-size: 20px">${level}</h2>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); gap: 14px">
        ${groups[level].map((c) => classCard(c, termScores, recentScores, topics, todayRegisters, periods)).join("")}
      </div>
    </div>`).join("");
}

// Today's attendance: how many classes have taken the register, and which haven't
function drawAttendanceBox(todayRegisters, present, counted, takenPct) {
  const taken = new Set(todayRegisters.map((a) => a.className));
  const missing = classes.filter((c) => !taken.has(c.className));
  const color = takenPct === 100 ? "#157F3B" : takenPct >= 50 ? "#F2A300" : "#B42318";
  $("att-box").innerHTML = `
    <div style="display: flex; align-items: center; gap: 16px">
      ${ring(classes.length ? takenPct : null, 84, "Registers taken today")}
      <div style="display: flex; flex-direction: column; gap: 4px">
        <strong style="font-size: 16px; color: ${color}">${todayRegisters.length} of ${classes.length} classes</strong>
        <span style="font-size: 14px; color: #5B6472">${counted ? `${present} of ${counted} student${counted === 1 ? "" : "s"} in school` : "No registers taken yet today"}</span>
      </div>
    </div>
    ${missing.length === 0 && classes.length
      ? '<p style="margin: 8px 0 0; color: #157F3B; font-weight: 600">Every class has taken today\'s register ✓</p>'
      : `<p style="margin: 10px 0 6px; font-size: 13px; font-weight: 600">Not taken yet:</p><div class="chips">${missing.map((c) => `<span class="chip">${c.className}</span>`).join("")}</div>`}`;
}

// Only real problems: classes without a teacher or PIN, classes behind targets, students who need help
function drawNeeds(termScores, recentScores, topics, registers30, periods) {
  const items = [];
  const list = (arr) => arr.map((c) => `<strong>${c}</strong>`).join(", ");

  if (termIsEnding(targets)) items.push(["gold", `The term's final exams have started. When report cards are done, <a href="#" data-go-link="year">download the term's records and end the term</a>${year.term >= 3 ? " (promotion and new academic year)" : ""}.`]);

  const noTeacher = classes.filter((c) => !c.classTeacherUid).map((c) => c.className);
  if (noTeacher.length) items.push(["red", `${noTeacher.length} class${noTeacher.length === 1 ? " has" : "es have"} no class teacher: ${list(noTeacher)}. <a href="#" data-go-link="teachers">Assign teachers</a>`]);

  const noPin = classes.filter((c) => !pins[c.id]).map((c) => c.className);
  if (noPin.length) items.push(["gold", `${noPin.length} class${noPin.length === 1 ? " has" : "es have"} no PIN yet: ${list(noPin)}. <a href="#" data-go-link="pins">Set PINs</a>`]);

  // Behind this week's targets (checked from Wednesday, so Monday isn't always "behind")
  if (new Date().getDay() >= 3 || new Date().getDay() === 0) {
    const behind = classes.filter((c) => {
      const p = classProgress(c.className, targets, topics, recentScores, periods);
      return p.overall !== null && p.overall < 50;
    }).map((c) => c.className);
    if (behind.length) items.push(["gold", `${behind.length} class${behind.length === 1 ? " is" : "es are"} below 50% of this week's targets: ${list(behind)}.`]);
  }

  // Students: below 50%, scores dropping, or absent 3+ times in 30 days
  const flagged = [];
  classes.forEach((c) => {
    const scores = termScores.filter((a) => a.className === c.className);
    (c.students || []).forEach((s) => {
      const r = resultsFor(s.id, scores, true);
      const reasons = [];
      if (r.average !== null && r.average < 50) reasons.push(`average ${r.average}%`);
      if (r.change <= -8) reasons.push(`down ${Math.abs(r.change)} points`);
      const absent = registers30.filter((a) => a.className === c.className && a.records[s.id] === "A").length;
      if (absent >= 3) reasons.push(`absent ${absent} times this month`);
      if (reasons.length) flagged.push({ name: s.name, cls: c.className, reasons });
    });
  });
  if (flagged.length) {
    flagged.sort((a, b) => b.reasons.length - a.reasons.length);
    const shown = flagged.slice(0, 6).map((f) => `<li><strong>${f.name}</strong> (${f.cls}) — ${f.reasons.join(", ")}</li>`).join("");
    items.push(["red", `${flagged.length} student${flagged.length === 1 ? " needs" : "s need"} attention:<ul style="margin: 6px 0 0; padding-left: 18px">${shown}</ul>${flagged.length > 6 ? `<a href="students.html">See all ${flagged.length} on Students</a>` : ""}`]);
  }

  $("needs-box").innerHTML = items.length === 0
    ? '<p style="margin: 0; color: #157F3B; font-weight: 600">Nothing needs your attention right now ✓</p>'
    : items.map(([tone, html]) => `<div class="need need-${tone}"><span aria-hidden="true" style="font-weight: 800">!</span><div>${html}</div></div>`).join("");
  document.querySelectorAll("[data-go-link]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); showTab(a.dataset.goLink); }));
}

function classCard(c, termScores, recentScores, topics, todayRegisters, periods) {
  const mine = termScores.filter((a) => a.className === c.className);
  const avg = mine.length ? Math.round(average(mine.map((a) => a.averagePercent))) : null;
  const band = avg === null ? null : BANDS[bandOf(avg)];
  const register = todayRegisters.find((a) => a.className === c.className);
  const prog = classProgress(c.className, targets, topics, recentScores, periods);

  return `<div class="class-card">
    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px">
      <div style="display: flex; flex-direction: column; gap: 2px">
        <strong style="font-size: 17px">${c.className}</strong>
        <span style="font-size: 13px; color: #12305A">${c.classTeacherName ? `Class teacher: <strong>${c.classTeacherName}</strong>` : '<span style="color: #8F1D15">No class teacher yet</span>'}</span>
        <span style="font-size: 13px; color: #5B6472">${(c.students || []).length} student${(c.students || []).length === 1 ? "" : "s"} · ${pins[c.id] ? "PIN set" : '<span style="color: #8F1D15">No PIN yet</span>'}</span>
      </div>
      ${band ? `<span class="pill" style="background: ${band.soft}; color: ${band.color}">${avg}%</span>` : '<span class="pill" style="background: #EEF1F6; color: #5B6472">No scores</span>'}
    </div>
    ${mine.length ? `<div style="display: flex; flex-direction: column; gap: 4px"><span style="font-size: 12px; font-weight: 600; color: #5B6472">Average by month</span>${miniBars(monthlyScores(mine))}</div>` : ""}
    <div class="rings">
      ${prog.items.map((i) => `<div class="ring">${ring(i.percent, 58, `${i.label} ${i.note}`)}<span><strong style="color: #12305A">${i.label}</strong><br>${i.target > 0 ? `${i.done} of ${i.target}` : "no target"}</span></div>`).join("")}
    </div>
    <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 13px">
      <span style="color: ${register ? "#115E2C" : "#8A5A00"}; font-weight: 600">${register ? `Register taken · ${register.present + register.late}/${register.present + register.late + register.absent}` : "No register today"}</span>
      <a href="students.html?class=${encodeURIComponent(c.className)}" style="font-weight: 600">View class →</a>
    </div>
  </div>`;
}

// ---------- Teachers ----------
// Class teacher  = one class, opens it with that class's PIN.
// Subject teacher = subjects in several classes (or all), opens them with their own personal PIN.
let editing = null; // the teacher being edited (their uid), or null when adding

function easyPassword() {
  const n = Math.floor(1000 + Math.random() * 9000);
  const letters = "abcdefghjkmnpqrstuvwxyz";
  return `Teach-${n}-${letters[Math.floor(Math.random() * 23)]}${letters[Math.floor(Math.random() * 23)]}`;
}
$("t-pass").value = easyPassword();
$("t-gen").addEventListener("click", () => ($("t-pass").value = easyPassword()));
$("t-pin-gen").addEventListener("click", () => ($("t-pin").value = newPin()));

const CHK = "display: flex; align-items: center; gap: 8px; font-weight: 500; min-height: 32px";
$("t-subjects").innerHTML = SUBJECTS.map((s) => `<label style="${CHK}"><input type="checkbox" name="t-subject" value="${s}"> ${s}</label>`).join("");

const teacherType = () => document.querySelector('input[name="t-type"]:checked').value;
function showTypeBoxes() {
  const subject = teacherType() === "subject";
  $("class-box").hidden = subject;
  $("subject-box").hidden = !subject;
}
document.querySelectorAll('input[name="t-type"]').forEach((r) => r.addEventListener("change", showTypeBoxes));

function lockClassTicks() {
  const all = $("t-all").checked;
  document.querySelectorAll('input[name="t-class"]').forEach((c) => (c.disabled = all));
  $("t-classes").style.opacity = all ? 0.5 : 1;
}
$("t-all").addEventListener("change", lockClassTicks);

const teacherName = (uid) => (teachers.find((t) => t.uid === uid) || {}).name;

// The class drop-down (class teacher) and class ticks (subject teacher), grouped by level
function fillClassPickers() {
  const groups = {};
  classes.forEach((c) => (groups[c.level || levelOf(c.className)] ||= []).push(c));
  const order = [...LEVELS.map((l) => l.level), "Other"].filter((l) => groups[l]);

  const keep = $("t-class").value;
  $("t-class").innerHTML = '<option value="">Choose a class…</option>' + order.map((l) =>
    `<optgroup label="${l}">${groups[l].map((c) => `<option value="${c.id}">${c.className}${c.classTeacherUid && c.classTeacherUid !== editing ? ` — ${c.classTeacherName}` : ""}</option>`).join("")}</optgroup>`).join("");
  $("t-class").value = keep;

  const ticked = new Set([...document.querySelectorAll('input[name="t-class"]:checked')].map((c) => c.value));
  $("t-classes").innerHTML = order.map((l) => `
    <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 4px 18px">
      <span style="width: 110px; font-size: 13px; font-weight: 700; color: #5B6472">${l}</span>
      ${groups[l].map((c) => `<label style="${CHK}"><input type="checkbox" name="t-class" value="${c.id}" ${ticked.has(c.id) ? "checked" : ""}> ${c.className}</label>`).join("")}
    </div>`).join("");
  lockClassTicks();
}

function resetTeacherForm() {
  editing = null;
  $("teacher-form").reset();
  $("t-pass").value = easyPassword();
  document.querySelectorAll(".login-field").forEach((f) => (f.hidden = false));
  $("t-title").textContent = "Add a teacher";
  $("t-add").textContent = "Add teacher";
  $("t-cancel").hidden = true;
  showTypeBoxes();
  fillClassPickers();
}
$("t-cancel").addEventListener("click", () => { resetTeacherForm(); say("t-status", "", ""); });

function startEdit(uid) {
  const t = teachers.find((x) => x.uid === uid);
  resetTeacherForm();
  editing = uid;
  $("t-name").value = t.name;
  document.querySelectorAll(".login-field").forEach((f) => (f.hidden = true));
  document.querySelector(`input[name="t-type"][value="${t.teacherType || "class"}"]`).checked = true;
  showTypeBoxes();
  fillClassPickers();
  if ((t.teacherType || "class") === "class") {
    $("t-class").value = (t.classIds || [])[0] || "";
  } else {
    const subs = t.subjects || [];
    document.querySelectorAll('input[name="t-subject"]').forEach((c) => (c.checked = subs.includes(c.value)));
    $("t-other-subject").value = subs.filter((s) => !SUBJECTS.includes(s)).join(", ");
    $("t-all").checked = !!t.allClasses;
    document.querySelectorAll('input[name="t-class"]').forEach((c) => (c.checked = (t.classIds || []).includes(c.value)));
    lockClassTicks();
    $("t-pin").value = pins[`teacher-${uid}`] || "";
  }
  $("t-title").textContent = `Edit ${t.name}`;
  $("t-add").textContent = "Save changes";
  $("t-cancel").hidden = false;
  showTab("teachers");
  $("t-title").scrollIntoView({ behavior: "smooth", block: "start" });
}

$("teacher-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("t-name").value.trim().replace(/\s+/g, " ");
  const type = teacherType();
  if (!name) return say("t-status", "Please type the teacher's name.", "#B42318");

  let classIds = [], allClasses = false, subjects = [], pin = "";
  if (type === "class") {
    if (!$("t-class").value) return say("t-status", "Choose the teacher's class.", "#B42318");
    classIds = [$("t-class").value];
    const c = classes.find((x) => x.id === classIds[0]);
    if (c.classTeacherUid && c.classTeacherUid !== editing &&
        !confirm(`${c.classTeacherName} is already the class teacher of ${c.className}.\n\nMake ${name} the class teacher instead?`)) return;
  } else {
    subjects = [...document.querySelectorAll('input[name="t-subject"]:checked')].map((c) => c.value)
      .concat($("t-other-subject").value.split(",").map((s) => s.trim()).filter(Boolean));
    if (subjects.length === 0) return say("t-status", "Tick at least one subject.", "#B42318");
    allClasses = $("t-all").checked;
    classIds = allClasses ? [] : [...document.querySelectorAll('input[name="t-class"]:checked')].map((c) => c.value);
    if (!allClasses && classIds.length === 0) return say("t-status", "Tick the classes they teach, or All classes.", "#B42318");
    pin = $("t-pin").value.trim();
    if (!/^\d{4,6}$/.test(pin)) return say("t-status", "Give the subject teacher a PIN of 4 to 6 digits (or click Make one).", "#B42318");
  }

  let email = "", pass = "";
  if (!editing) {
    email = $("t-email").value.trim().toLowerCase();
    pass = $("t-pass").value.trim();
    if (!email || !pass) return say("t-status", "Please fill in the email and starting password.", "#B42318");
    if (pass.length < 6) return say("t-status", "The password must be at least 6 characters.", "#B42318");
  }

  $("t-add").disabled = true;
  say("t-status", editing ? "Saving…" : "Creating the teacher's login…", "#12305A");
  try {
    const uid = editing || (await createLogin(email, pass));
    const profile = { name, teacherType: type, classIds, allClasses, subjects, updatedAt: serverTimestamp() };
    if (!editing) Object.assign(profile, { role: "teacher", email, schoolId: SCHOOL.id, active: true, createdAt: serverTimestamp() });
    profile.pinHash = type === "subject" ? await hashPin(SCHOOL.id, `teacher-${uid}`, pin) : null;
    await setDoc(doc(db, "users", uid), profile, { merge: true });

    const batch = writeBatch(db);
    // The personal PIN, kept where only the headmaster looks
    batch.set(schoolDoc("private", "pins"), { [`teacher-${uid}`]: type === "subject" ? pin : null }, { merge: true });
    // Each class records its class teacher
    classes.forEach((c) => {
      const isTheirClass = type === "class" && c.id === classIds[0];
      if (isTheirClass) {
        batch.set(schoolDoc("classes", c.id), { classTeacherUid: uid, classTeacherName: name, classTeacherSim: false }, { merge: true });
        if (c.classTeacherUid && c.classTeacherUid !== uid && !c.classTeacherSim) batch.set(doc(db, "users", c.classTeacherUid), { classIds: [] }, { merge: true });
      } else if (c.classTeacherUid === uid) {
        batch.set(schoolDoc("classes", c.id), { classTeacherUid: null, classTeacherName: null }, { merge: true });
      }
    });
    await batch.commit();

    if (!editing) {
      $("t-new").hidden = false;
      $("t-new").innerHTML = `
        <strong style="color: #115E2C">${name} added ✓ Give these details to the teacher:</strong>
        <span>Website: <strong>${location.origin}${location.pathname.replace("head.html", "index.html")}</strong> → Teacher</span>
        <span>Email: <strong>${email}</strong> · Password: <strong>${pass}</strong></span>
        <span>${type === "subject" ? `Their personal PIN for their classes: <strong>${pin}</strong>` : `To open ${classes.find((c) => c.id === classIds[0]).className} they need the class PIN (see Class PINs).`}</span>`;
    } else {
      $("t-new").hidden = true;
    }
    say("t-status", editing ? `${name} updated ✓` : "", "#157F3B");
    resetTeacherForm();
    await loadAll();
  } catch (error) {
    say("t-status", friendlyError(error), "#B42318");
  } finally {
    $("t-add").disabled = false;
  }
});

function assignmentText(t) {
  const name = (id) => (classes.find((c) => c.id === id) || {}).className || "(removed class)";
  if ((t.teacherType || "class") === "class") {
    return (t.classIds || []).length ? `Class teacher · <strong>${name(t.classIds[0])}</strong>` : '<span style="color: #8F1D15">Class teacher · no class yet</span>';
  }
  const where = t.allClasses ? "All classes" : (t.classIds || []).map(name).join(", ");
  const pin = pins[`teacher-${t.uid}`];
  return `Subject teacher · <strong>${(t.subjects || []).join(", ")}</strong> · ${where}${pin ? ` · PIN <strong style="letter-spacing: 2px">${pin}</strong>` : ""}`;
}

function drawTeachers() {
  if (teachers.length === 0) {
    $("teacher-list").innerHTML = '<p style="margin: 0; color: #5B6472">No teachers yet. Add your first teacher above.</p>';
    return;
  }
  $("teacher-list").innerHTML = teachers.map((t, i) => `
    <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; padding: 12px 0; ${i < teachers.length - 1 ? "border-bottom: 1px solid #EEF1F6" : ""}">
      <div style="flex: 1 1 320px; display: flex; flex-direction: column; gap: 3px">
        <span style="font-weight: 600">${t.name} ${t.active === false ? '<span class="pill" style="background: #FDE8E7; color: #8F1D15">Switched off</span>' : ""}</span>
        <span style="font-size: 13px; color: #5B6472">${t.email}</span>
        <span style="font-size: 13px">${assignmentText(t)}</span>
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: 8px">
        <button type="button" class="btn btn-navy" style="height: 40px; font-size: 13px" data-edit="${t.uid}">Edit</button>
        <button type="button" class="btn btn-line" data-reset="${t.uid}">Send password reset</button>
        <button type="button" class="btn btn-line" data-toggle="${t.uid}">${t.active === false ? "Switch on" : "Switch off"}</button>
      </div>
    </div>`).join("");

  document.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => startEdit(b.dataset.edit)));
  document.querySelectorAll("[data-reset]").forEach((b) => b.addEventListener("click", async () => {
    const t = teachers.find((x) => x.uid === b.dataset.reset);
    try {
      await resetPassword(t.email);
      say("tl-status", `A password reset link was sent to ${t.email}.`, "#157F3B");
    } catch (error) { say("tl-status", friendlyError(error), "#B42318"); }
  }));
  document.querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("click", async () => {
    const t = teachers.find((x) => x.uid === b.dataset.toggle);
    const off = t.active !== false;
    if (off && !confirm(`Switch off ${t.name}? They won't be able to log in until you switch them back on. Their records stay.`)) return;
    try {
      await updateDoc(doc(db, "users", t.uid), { active: !off });
      say("tl-status", `${t.name} ${off ? "switched off" : "switched on"} ✓`, "#157F3B");
      await loadAll();
    } catch (error) { say("tl-status", "Could not change: " + error.message, "#B42318"); }
  }));
}

// ---------- Parents ----------
// A parent logs in with a username + PIN and sees only the children linked here.
$("pa-pin-gen").addEventListener("click", () => ($("pa-pin").value = newPin()));
$("pa-name").addEventListener("input", () => {
  if ($("pa-user").dataset.touched) return;
  $("pa-user").value = $("pa-name").value.toLowerCase().replace(/^(mr|mrs|ms|dr|miss|madam)\.?\s+/i, "").trim().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");
});
$("pa-user").addEventListener("input", () => ($("pa-user").dataset.touched = "1"));

function fillParentPickers() {
  const keep = $("pa-class").value;
  $("pa-class").innerHTML = classes.map((c) => `<option value="${c.id}">${c.className}</option>`).join("");
  if (classes.some((c) => c.id === keep)) $("pa-class").value = keep;
  fillStudentPicker();
}
function fillStudentPicker() {
  const c = classes.find((x) => x.id === $("pa-class").value);
  const list = c ? (c.students || []) : [];
  $("pa-student").innerHTML = list.length ? list.map((s) => `<option value="${s.id}">${s.name}</option>`).join("") : '<option value="">No students in this class</option>';
}
$("pa-class").addEventListener("change", fillStudentPicker);

function drawNewChildren() {
  $("pa-children").innerHTML = newChildren.length
    ? newChildren.map((k, i) => `<span class="chip" style="display: inline-flex; align-items: center; gap: 6px">${k.name} · ${k.className}<button type="button" data-drop="${i}" aria-label="Remove ${k.name}" style="border: none; background: none; cursor: pointer; font-size: 16px; color: #6B4E00; min-width: 24px; min-height: 24px">×</button></span>`).join("")
    : '<span style="font-size: 13px; color: #5B6472">No child added yet.</span>';
  document.querySelectorAll("[data-drop]").forEach((b) => b.addEventListener("click", () => { newChildren.splice(Number(b.dataset.drop), 1); drawNewChildren(); }));
}
$("pa-add-child").addEventListener("click", () => {
  const c = classes.find((x) => x.id === $("pa-class").value);
  const s = c && (c.students || []).find((x) => x.id === $("pa-student").value);
  if (!s) return;
  if (!newChildren.some((k) => k.id === s.id)) newChildren.push({ id: s.id, name: s.name, className: c.className });
  drawNewChildren();
});
drawNewChildren();

$("parent-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("pa-name").value.trim().replace(/\s+/g, " ");
  const username = $("pa-user").value.trim().toLowerCase();
  const pin = $("pa-pin").value.trim();
  if (!name) return say("pa-status", "Please type the parent's name.", "#B42318");
  if (!/^[a-z0-9.]{3,40}$/.test(username)) return say("pa-status", "The username can use letters, numbers and dots (at least 3).", "#B42318");
  if (!/^\d{4,6}$/.test(pin)) return say("pa-status", "The PIN must be 4 to 6 digits (or click Make one).", "#B42318");
  if (newChildren.length === 0) return say("pa-status", "Add at least one child.", "#B42318");

  $("pa-add").disabled = true;
  say("pa-status", "Creating the parent's login…", "#12305A");
  try {
    const uid = await createLogin(parentLogin(username), parentPassword(pin));
    await setDoc(doc(db, "users", uid), {
      role: "parent", name, username, schoolId: SCHOOL.id, children: newChildren, childIds: newChildren.map((k) => k.id), active: true, createdAt: serverTimestamp()
    });
    await setDoc(schoolDoc("private", "pins"), { [`parent-${uid}`]: pin }, { merge: true });
    $("pa-new").hidden = false;
    $("pa-new").innerHTML = `
      <strong style="color: #115E2C">${name} added ✓ Give these details to the parent:</strong>
      <span>Website: <strong>${location.origin}${location.pathname.replace("head.html", "index.html")}</strong> → Parent</span>
      <span>Username: <strong>${username}</strong> · PIN: <strong>${pin}</strong></span>
      <span>Linked to: ${newChildren.map((k) => `${k.name} (${k.className})`).join(", ")}</span>`;
    $("parent-form").reset();
    delete $("pa-user").dataset.touched;
    newChildren = [];
    drawNewChildren();
    say("pa-status", "", "");
    await loadAll();
  } catch (error) {
    say("pa-status", error.code === "auth/email-already-in-use" ? "That username is already taken. Please choose another." : friendlyError(error), "#B42318");
  } finally {
    $("pa-add").disabled = false;
  }
});

function drawParents() {
  if (parents.length === 0) {
    $("parent-list").innerHTML = '<p style="margin: 0; color: #5B6472">No parents yet.</p>';
    return;
  }
  $("parent-list").innerHTML = parents.map((p, i) => `
    <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; padding: 12px 0; ${i < parents.length - 1 ? "border-bottom: 1px solid #EEF1F6" : ""}">
      <div style="flex: 1 1 320px; display: flex; flex-direction: column; gap: 3px">
        <span style="font-weight: 600">${p.name} ${p.active === false ? '<span class="pill" style="background: #FDE8E7; color: #8F1D15">Switched off</span>' : ""}</span>
        <span style="font-size: 13px; color: #5B6472">Username <strong>${p.username}</strong>${pins[`parent-${p.uid}`] ? ` · PIN <strong style="letter-spacing: 2px">${pins[`parent-${p.uid}`]}</strong>` : ""}</span>
        <span style="font-size: 13px">${(p.children || []).map((k) => `${k.name} (${k.className})`).join(", ")}</span>
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: 8px">
        <button type="button" class="btn btn-line" data-preset="${p.uid}" aria-expanded="false" aria-controls="reset-${p.uid}">Reset PIN</button>
        <button type="button" class="btn btn-line" data-ptoggle="${p.uid}">${p.active === false ? "Switch on" : "Switch off"}</button>
      </div>
      <div id="reset-${p.uid}" hidden style="flex: 1 1 100%; display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px; padding: 12px; border-radius: 10px; background: #FFF4D6">
        <div class="field" style="flex: 0 1 180px"><label for="newpin-${p.uid}">New PIN for ${p.name}</label><input id="newpin-${p.uid}" type="text" inputmode="numeric" maxlength="6" placeholder="4–6 digits"></div>
        <button type="button" class="btn btn-line" data-pmake="${p.uid}">Make one</button>
        <button type="button" class="btn btn-navy" style="height: 40px; font-size: 13px" data-psave="${p.uid}">Save new PIN</button>
        <span style="flex: 1 1 100%; font-size: 13px; color: #6B4E00">The old PIN stops working straight away. The username stays the same.</span>
      </div>
    </div>`).join("");
  document.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => {
    const box = $(`reset-${b.dataset.preset}`);
    box.hidden = !box.hidden;
    b.setAttribute("aria-expanded", String(!box.hidden));
    if (!box.hidden) $(`newpin-${b.dataset.preset}`).focus();
  }));
  document.querySelectorAll("[data-pmake]").forEach((b) => b.addEventListener("click", () => ($(`newpin-${b.dataset.pmake}`).value = newPin())));
  document.querySelectorAll("[data-psave]").forEach((b) => b.addEventListener("click", () => resetParentPin(b.dataset.psave, b)));
  document.querySelectorAll("[data-ptoggle]").forEach((b) => b.addEventListener("click", async () => {
    const p = parents.find((x) => x.uid === b.dataset.ptoggle);
    const off = p.active !== false;
    try {
      await updateDoc(doc(db, "users", p.uid), { active: !off });
      say("pl-status", `${p.name} ${off ? "switched off" : "switched on"} ✓`, "#157F3B");
      await loadAll();
    } catch (error) { say("pl-status", "Could not change: " + error.message, "#B42318"); }
  }));
}

// A parent forgot their PIN: only the headmaster (or the admin) can give a new one.
// Firebase can't change another person's password from a website on the free plan, so the parent
// gets a fresh login behind the scenes (same username, new PIN) and the old one is switched off.
async function resetParentPin(uid, button) {
  const p = parents.find((x) => x.uid === uid);
  const pin = $(`newpin-${uid}`).value.trim();
  if (!/^\d{4,6}$/.test(pin)) return say("pl-status", "The new PIN must be 4 to 6 digits (or click Make one).", "#B42318");
  if (!confirm(`Give ${p.name} the new PIN ${pin}?\n\nTheir old PIN will stop working.`)) return;
  button.disabled = true;
  say("pl-status", `Making ${p.name}'s new login…`, "#12305A");
  try {
    const username = parentUsername(p.username);
    let version = (p.loginVersion || 0) + 1, newUid = null;
    while (!newUid) {
      try {
        newUid = await createLogin(parentLogin(username, version), parentPassword(pin));
      } catch (error) {
        if (error.code !== "auth/email-already-in-use" || version > (p.loginVersion || 0) + 5) throw error;
        version++; // a login with this number was left over from an earlier try
      }
    }
    const { uid: _old, ...profile } = p;
    await setDoc(doc(db, "users", newUid), { ...profile, loginVersion: version, active: true, replaces: uid, createdAt: serverTimestamp() });
    await setDoc(doc(db, "parentLogins", username), { version, schoolId: SCHOOL.id, updatedAt: serverTimestamp() });
    await updateDoc(doc(db, "users", uid), { active: false, replacedBy: newUid });
    await setDoc(schoolDoc("private", "pins"), { [`parent-${newUid}`]: pin, [`parent-${uid}`]: null }, { merge: true });
    say("pl-status", `New PIN for ${p.name}: ${pin} ✓ Username stays ${username}.`, "#157F3B");
    await loadAll();
  } catch (error) {
    say("pl-status", "Could not reset the PIN: " + friendlyError(error), "#B42318");
    button.disabled = false;
  }
}

// ---------- Parents' view (each child's private summary) ----------
function showViewsStatus(lastIso) {
  $("views-status").textContent = lastIso
    ? `Parents' view last updated ${new Date(lastIso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}. It updates by itself at least twice a day when you open this portal.`
    : "Parents' view hasn't been made yet.";
}
async function updateParentViews() {
  if (!latest) return;
  $("views-refresh").disabled = true;
  $("views-status").textContent = "Updating parents' view…";
  try {
    const n = await refreshParentViews(SCHOOL.id, classes, latest.scores, latest.registers, latest.report);
    showViewsStatus(new Date().toISOString());
    $("views-status").textContent += ` (${n} children)`;
  } catch (error) {
    $("views-status").textContent = "Could not update parents' view: " + error.message;
  } finally {
    $("views-refresh").disabled = false;
  }
}
$("views-refresh").addEventListener("click", updateParentViews);

// ---------- Class PINs ----------
function drawPins() {
  if (classes.length === 0) {
    $("pin-list").innerHTML = '<p style="margin: 0; color: #5B6472">No classes yet.</p>';
    return;
  }
  $("pin-list").innerHTML = classes.map((c, i) => `
    <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; padding: 10px 0; ${i < classes.length - 1 ? "border-bottom: 1px solid #EEF1F6" : ""}">
      <span style="flex: 1 1 200px; display: flex; flex-direction: column"><strong>${c.className}</strong><span style="font-size: 13px; color: #5B6472">${c.classTeacherName ? `Class teacher: ${c.classTeacherName}` : "No class teacher yet"}</span></span>
      <span style="flex: 1 1 140px; font-size: 15px">${pins[c.id] ? `PIN: <strong style="letter-spacing: 2px">${pins[c.id]}</strong>` : '<span style="color: #8F1D15">No PIN yet</span>'}</span>
      <label class="sr" for="pin-${c.id}" style="position: absolute; left: -9999px">New PIN for ${c.className}</label>
      <input id="pin-${c.id}" type="text" inputmode="numeric" maxlength="6" placeholder="4–6 digits" style="width: 130px; height: 40px; padding: 0 10px; border: 1px solid #C9D2DF; border-radius: 8px; font-size: 15px; font-family: inherit">
      <button type="button" class="btn btn-line" data-auto="${c.id}">Make one</button>
      <button type="button" class="btn btn-navy" style="height: 40px; font-size: 13px" data-save="${c.id}">Save PIN</button>
    </div>`).join("");

  document.querySelectorAll("[data-auto]").forEach((b) => b.addEventListener("click", () => ($(`pin-${b.dataset.auto}`).value = newPin())));
  document.querySelectorAll("[data-save]").forEach((b) => b.addEventListener("click", () => savePin(b.dataset.save)));
}

async function savePin(classId) {
  const c = classes.find((x) => x.id === classId);
  const pin = $(`pin-${classId}`).value.trim();
  if (!/^\d{4,6}$/.test(pin)) return say("pin-status", "A PIN must be 4 to 6 digits.", "#B42318");
  try {
    await setDoc(schoolDoc("classes", classId), { pinHash: await hashPin(SCHOOL.id, classId, pin), pinUpdatedAt: serverTimestamp() }, { merge: true });
    await setDoc(schoolDoc("private", "pins"), { [classId]: pin }, { merge: true });
    say("pin-status", `PIN for ${c.className} saved ✓`, "#157F3B");
    await loadAll();
  } catch (error) {
    say("pin-status", "Could not save the PIN: " + error.message, "#B42318");
  }
}

// ---------- Weekly targets ----------
function drawTargets() {
  $("term-start").value = targets.termStart || "";
  $("exam-date").value = targets.examDate || "";
  const cell = (level, key) => `<td style="padding: 8px"><label style="position: absolute; left: -9999px" for="tg-${level}-${key}">${level} ${key}</label><input id="tg-${level}-${key}" type="number" min="0" max="20" value="${targets.byLevel[level][key]}" style="max-width: 120px"></td>`;
  $("target-rows").innerHTML = LEVELS.map((l) => `
    <tr style="border-top: 1px solid #EEF1F6">
      <td style="padding: 8px; font-weight: 700">${l.level}</td>
      ${cell(l.level, "topics")}${cell(l.level, "exercises")}${cell(l.level, "homework")}${cell(l.level, "testsPerMonth")}
    </tr>`).join("");
}

$("targets-save").addEventListener("click", async () => {
  const byLevel = {};
  LEVELS.forEach((l) => {
    byLevel[l.level] = {};
    ["topics", "exercises", "homework", "testsPerMonth"].forEach((k) => {
      byLevel[l.level][k] = Math.max(0, Math.round(Number($(`tg-${l.level}-${k}`).value) || 0));
    });
  });
  const termStart = $("term-start").value, examDate = $("exam-date").value;
  if (termStart && examDate && examDate <= termStart) return say("targets-status", "The exam date must be after the term starts.", "#B42318");
  try {
    await setDoc(schoolDoc("settings", "targets"), { termStart, examDate, byLevel, updatedAt: serverTimestamp() });
    say("targets-status", "Targets saved ✓ Every class's circles now use them.", "#157F3B");
    await loadAll();
  } catch (error) {
    say("targets-status", "Could not save: " + error.message, "#B42318");
  }
});

// ---------- School profile (crest, name, motto, term) ----------
// Saved with the report card settings, so every report card uses them.
function showCrest() {
  $("crest-preview").innerHTML = profile.badge
    ? `<img src="${profile.badge}" alt="School crest" style="width: 100%; height: 100%; object-fit: contain">`
    : "No crest yet";
  $("school-crest").src = profile.badge || "images/logo-mark.svg";
  $("school-crest").alt = profile.badge ? `${profile.schoolName || SCHOOL.name} crest` : "";
}

function drawProfile() {
  $("p-name").value = profile.schoolName || SCHOOL.name || "";
  $("p-motto").value = profile.motto || "";
  $("p-term").value = profile.term || "";
  $("school-name").textContent = profile.schoolName || SCHOOL.name || "Your school";
  $("school-motto").textContent = profile.motto || "";
  showCrest();
}

// Shrink the picture so it is small enough to save in the database
function resizeImage(file, maxSize = 300) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("That file isn't a picture we can read."));
    img.src = URL.createObjectURL(file);
  });
}

$("crest-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    profile.badge = await resizeImage(file);
    showCrest();
    say("profile-status", "Crest added — click Save school profile to keep it.", "#8A5A00");
  } catch (error) {
    say("profile-status", error.message, "#B42318");
  }
  e.target.value = "";
});

$("crest-remove").addEventListener("click", () => {
  profile.badge = null;
  showCrest();
  say("profile-status", "Crest removed — click Save school profile to keep this.", "#8A5A00");
});

$("profile-save").addEventListener("click", async () => {
  profile.schoolName = $("p-name").value.trim();
  profile.motto = $("p-motto").value.trim();
  profile.term = $("p-term").value.trim();
  if (!profile.schoolName) return say("profile-status", "Please type the school name.", "#B42318");
  try {
    await setDoc(schoolDoc("settings", "report"), { ...profile, updatedAt: serverTimestamp() }, { merge: true });
    drawProfile();
    say("profile-status", "School profile saved ✓ Report cards now use it.", "#157F3B");
    if (latest) { latest.report = { ...latest.report, ...profile }; updateParentViews(); }
  } catch (error) {
    say("profile-status", "Could not save: " + error.message, "#B42318");
  }
});

loadAll().catch((error) => {
  $("levels").innerHTML = `<p style="color: #B42318; font-weight: 600">Could not load the school: ${error.message}</p>`;
});
