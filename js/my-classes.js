// js/my-classes.js
// The teacher's first page. Every class is shown, grouped Creche → JHS.
//   Class teacher  : opens THEIR class with that class's PIN.
//   Subject teacher: opens ALL their classes with their own personal PIN.
// Every other class stays locked. Unlocked classes stay open until the browser is closed.

import { getDocs } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { useSchool, schoolCol, SCHOOL, unlockedClasses, saveUnlocked } from "./school.js";
import { LEVELS, levelOf, classOrder } from "./levels.js";
import { hashPin } from "./pins.js";

await useSchool("teacher");
const $ = (id) => document.getElementById(id);
$("page").hidden = false;

const me = SCHOOL.me;
const profile = me.profile;
const isSubject = profile.teacherType === "subject";
let classes = [];
let unlocked = unlockedClasses(me.user.uid);
let wrongTries = 0, waitUntil = 0;

// Which classes are this teacher's?
const isMine = (c) => (isSubject && profile.allClasses) || (profile.classIds || []).includes(c.id);

async function load() {
  const snap = await getDocs(schoolCol("classes"));
  classes = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(classOrder);
  const mine = classes.filter(isMine);

  $("intro").textContent = mine.length === 0
    ? "You haven't been given a class yet. Please ask the headmaster."
    : isSubject
      ? `You teach ${profile.subjects.join(", ")} in ${profile.allClasses ? "every class" : mine.map((c) => c.className).join(", ")}. Enter your PIN once to open all of them.`
      : `Your class is ${mine.map((c) => c.className).join(", ")}. Enter the class PIN to open it. Other classes are locked.`;

  if (isSubject && mine.length) {
    $("subject-box").hidden = false;
    $("subject-text").textContent = `Your personal PIN opens ${profile.allClasses ? "all classes" : mine.length + " class" + (mine.length === 1 ? "" : "es")}.`;
  }
  draw();
}

function draw() {
  const groups = {};
  classes.forEach((c) => (groups[c.level || levelOf(c.className)] ||= []).push(c));
  const order = [...LEVELS.map((l) => l.level), "Other"].filter((l) => groups[l]);

  $("levels").innerHTML = order.map((level) => `
    <section style="display: flex; flex-direction: column; gap: 12px" aria-label="${level}">
      <h2 style="font-size: 20px">${level}</h2>
      <div class="grid">${groups[level].map(card).join("")}</div>
    </section>`).join("");

  document.querySelectorAll("form[data-class]").forEach((f) => f.addEventListener("submit", (e) => {
    e.preventDefault();
    openClass(f.dataset.class, f.querySelector("input").value.trim());
  }));
}

function card(c) {
  const count = (c.students || []).length;
  const info = `<span style="font-size: 13px">${count} student${count === 1 ? "" : "s"}${c.classTeacherName ? ` · ${c.classTeacherName}` : ""}</span>`;
  const lockIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg>`;

  if (unlocked.includes(c.className)) {
    return `<div class="cls open">
      <div style="display: flex; justify-content: space-between; gap: 8px"><strong style="font-size: 18px">${c.className}</strong><span style="color: #157F3B; font-size: 13px; font-weight: 700">Open ✓</span></div>
      ${info}
      <a class="btn btn-green" href="dashboard.html">Go to ${c.className} →</a>
    </div>`;
  }
  if (!isMine(c)) {
    return `<div class="cls locked" aria-label="${c.className} — locked, not your class">
      <div style="display: flex; justify-content: space-between; gap: 8px"><strong style="font-size: 18px">${c.className}</strong><span style="display: flex; align-items: center; gap: 4px; font-size: 13px">${lockIcon} Locked</span></div>
      ${info}
      <span style="font-size: 13px">Not your class</span>
    </div>`;
  }
  // Their class
  if (isSubject) {
    return `<div class="cls mine">
      <div style="display: flex; justify-content: space-between; gap: 8px"><strong style="font-size: 18px">${c.className}</strong><span style="color: #8A5A00; font-size: 13px; font-weight: 700">Your class</span></div>
      ${info}
      <span style="font-size: 13px; color: #5B6472">Use your PIN above to open it.</span>
    </div>`;
  }
  return `<div class="cls mine">
    <div style="display: flex; justify-content: space-between; gap: 8px"><strong style="font-size: 18px">${c.className}</strong><span style="color: #8A5A00; font-size: 13px; font-weight: 700">Your class</span></div>
    ${info}
    ${c.pinHash
      ? `<form class="pin-row" data-class="${c.id}"><label for="pin-${c.id}" style="position: absolute; left: -9999px">PIN for ${c.className}</label><input id="pin-${c.id}" type="password" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="Class PIN"><button type="submit" class="btn btn-gold">Open</button></form>
         <p id="msg-${c.id}" class="msg" role="status"></p>`
      : `<span style="font-size: 13px; color: #8F1D15; font-weight: 600">The headmaster hasn't set a PIN for this class yet.</span>`}
  </div>`;
}

function tooManyTries(msgEl) {
  if (Date.now() < waitUntil) {
    msgEl.style.color = "#B42318";
    msgEl.textContent = `Too many wrong tries. Please wait ${Math.ceil((waitUntil - Date.now()) / 1000)} seconds.`;
    return true;
  }
  return false;
}
function wrong(msgEl) {
  wrongTries++;
  if (wrongTries >= 5) { waitUntil = Date.now() + 60000; wrongTries = 0; }
  msgEl.style.color = "#B42318";
  msgEl.textContent = "That PIN isn't right. Please try again.";
}
function unlock(names) {
  unlocked = [...new Set([...unlocked, ...names])];
  saveUnlocked(me.user.uid, unlocked);
  location.href = "dashboard.html";
}

// Class teacher: the class PIN
async function openClass(classId, pin) {
  const c = classes.find((x) => x.id === classId);
  const msg = $(`msg-${classId}`);
  if (tooManyTries(msg)) return;
  if (!pin) { msg.style.color = "#B42318"; msg.textContent = "Type the class PIN."; return; }
  if ((await hashPin(SCHOOL.id, classId, pin)) === c.pinHash) unlock([c.className]);
  else wrong(msg);
}

// Subject teacher: their own PIN opens all their classes
$("subject-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("subject-msg");
  if (tooManyTries(msg)) return;
  const pin = $("subject-pin").value.trim();
  if (!pin) { msg.style.color = "#B42318"; msg.textContent = "Type your PIN."; return; }
  if (profile.pinHash && (await hashPin(SCHOOL.id, `teacher-${me.user.uid}`, pin)) === profile.pinHash) {
    unlock(classes.filter(isMine).map((c) => c.className));
  } else {
    wrong(msg);
  }
});

load().catch((error) => { $("levels").innerHTML = `<p style="color: #B42318; font-weight: 600">Could not load classes: ${error.message}</p>`; });
