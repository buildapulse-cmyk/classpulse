// js/school.js
// Keeps every school's data separate. All classes, students, scores, attendance, topics and
// settings live inside that school:  schools/{schoolId}/classes, schools/{schoolId}/assessments …
//
// Pages call useSchool() first. It checks who is logged in and which school they belong to.
// The admin can open any school (chosen on the admin page).

import { db } from "./firebase.js";
import { requireRole, logOut, ROLE_NAMES } from "./auth.js";
import { collection, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

export const SCHOOL = { id: null, name: "", me: null, allowed: null };

// Teachers: the classes they have unlocked with a PIN this session (closing the browser locks them again)
const unlockKey = (uid) => `cp-unlocked-${uid}`;
export function unlockedClasses(uid) {
  try { return JSON.parse(sessionStorage.getItem(unlockKey(uid)) || "[]"); } catch (e) { return []; }
}
export function saveUnlocked(uid, classNames) {
  try { sessionStorage.setItem(unlockKey(uid), JSON.stringify(classNames)); } catch (e) { /* fine */ }
}
// May this person see this class? (headmaster and admin: every class)
export const isAllowed = (className) => SCHOOL.allowed === null || SCHOOL.allowed.includes(className);

export async function useSchool(...roles) {
  const me = await requireRole(...roles, "admin");
  let id = me.profile.schoolId;

  // The admin looks at whichever school they opened from the admin page
  if (me.profile.role === "admin") {
    try { id = sessionStorage.getItem("cp-view-school"); } catch (e) { id = null; }
    if (!id) { location.replace("admin.html"); return new Promise(() => {}); }
  }

  const school = await getDoc(doc(db, "schools", id));
  SCHOOL.id = id;
  SCHOOL.name = school.exists() ? school.data().name : "";
  SCHOOL.data = school.exists() ? school.data() : {};
  SCHOOL.me = me;

  // A teacher works only in the classes they unlocked on "My classes"
  if (me.profile.role === "teacher") {
    SCHOOL.allowed = unlockedClasses(me.user.uid);
    const onPicker = location.pathname.endsWith("classes.html");
    if (!onPicker && SCHOOL.allowed.length === 0) {
      location.replace("classes.html");
      return new Promise(() => {});
    }
  } else {
    SCHOOL.allowed = null;
  }

  drawUserBox(me);
  fitMenuToRole(me.profile.role);
  return SCHOOL;
}

// The headmaster (and admin) don't take attendance or record scores, so hide those
// links and point the menu back to the headmaster portal instead.
function fitMenuToRole(role) {
  const nav = document.querySelector('nav[aria-label="Main"]');
  if (!nav) return;
  if (role === "teacher") {
    // Teachers: a way back to choose another class; class lists are the headmaster's job
    nav.querySelectorAll('a[href="class-lists.html"]').forEach((a) => a.remove());
    const style = "color: #FFC23D; text-decoration: none; font-size: 14px; font-weight: 700; padding: 10px 12px; border-radius: 8px";
    nav.insertAdjacentHTML("afterbegin", `<a href="classes.html" style="${style}">← My classes</a>`);
    return;
  }
  if (role !== "headmaster" && role !== "admin") return;
  const hide = ["dashboard.html", "attendance.html", "record-scores.html", "topics.html"];
  nav.querySelectorAll("a").forEach((a) => { if (hide.includes(a.getAttribute("href"))) a.remove(); });
  const style = "color: #FFC23D; text-decoration: none; font-size: 14px; font-weight: 700; padding: 10px 12px; border-radius: 8px";
  nav.insertAdjacentHTML("afterbegin", `<a href="head.html" style="${style}">← Headmaster portal</a>`);
  document.querySelectorAll('header a[href="dashboard.html"]').forEach((a) => a.setAttribute("href", "head.html"));
}

// Top-right of the menu bar: school, who is logged in, Log out (and a way back for the admin)
function drawUserBox(me) {
  const box = document.getElementById("user-box");
  if (!box) return;
  const name = me.profile.name || me.user.email;
  const initials = name.replace(/^(mr|mrs|ms|dr|miss)\.?\s+/i, "").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const btn = "height: 36px; padding: 0 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.4); background: transparent; color: #FFFFFF; font-family: inherit; font-size: 13px; font-weight: 600; cursor: pointer";
  box.innerHTML = `
    ${me.profile.role === "admin" ? `<a href="admin.html" style="${btn}; display: flex; align-items: center; text-decoration: none; color: #FFC23D; border-color: #FFC23D">← Admin</a>` : ""}
    <span style="display: flex; flex-direction: column; line-height: 1.2; text-align: right">
      <span style="font-weight: 600">${name}</span>
      <span style="font-size: 12px; color: #D6DEEA">${ROLE_NAMES[me.profile.role]} · ${SCHOOL.name}</span>
    </span>
    <span style="width: 32px; height: 32px; border-radius: 50%; background: #F2A300; color: #12305A; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px">${initials}</span>
    <button type="button" id="logout-btn" style="${btn}">Log out</button>`;
  document.getElementById("logout-btn").addEventListener("click", logOut);
}

// Use these instead of collection(db, …) and doc(db, …) so everything stays inside the school
export const schoolCol = (name) => collection(db, "schools", SCHOOL.id, name);
export const schoolDoc = (name, id) => doc(db, "schools", SCHOOL.id, name, id);
