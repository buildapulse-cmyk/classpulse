// js/admin.js
// The admin page (Sam): add schools with their headmaster's login, open any school,
// switch schools off and on, and remove or restore schools.

import { db } from "./firebase.js";
import { requireRole, logOut, createLogin, friendlyError } from "./auth.js";
import {
  collection, doc, getDocs, setDoc, updateDoc, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { LEVELS } from "./levels.js";

// "Primary 4" -> "primary-4" (same IDs the class pages use)
const makeId = (text) => text.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const me = await requireRole("admin");
const $ = (id) => document.getElementById(id);

$("who").textContent = me.user.email;
$("logout-btn").addEventListener("click", logOut);
$("page").hidden = false;

let schools = [];

function say(id, text, color) {
  $(id).textContent = text;
  $(id).style.color = color;
}

// An easy-to-read starting password, e.g. "Pulse-4827-kt"
function newPassword() {
  const n = Math.floor(1000 + Math.random() * 9000);
  const letters = "abcdefghjkmnpqrstuvwxyz";
  const two = letters[Math.floor(Math.random() * letters.length)] + letters[Math.floor(Math.random() * letters.length)];
  return `Pulse-${n}-${two}`;
}
$("h-pass").value = newPassword();
$("gen-btn").addEventListener("click", () => ($("h-pass").value = newPassword()));

// ---------- Load and show schools ----------
async function loadSchools() {
  const snap = await getDocs(collection(db, "schools"));
  schools = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name));
  drawTiles();
  drawList();
}

function drawTiles() {
  const live = schools.filter((s) => !s.removed);
  const on = live.filter((s) => s.active !== false).length;
  const tile = (label, value) => `<div class="tile"><span style="font-size: 13px; color: #5B6472">${label}</span><strong>${value}</strong></div>`;
  $("tiles").innerHTML =
    tile("Schools", live.length) +
    tile("Switched on", on) +
    tile("Switched off", live.length - on) +
    tile("Removed", schools.length - live.length);
}

function drawList() {
  const showRemoved = $("show-removed").checked;
  const list = schools.filter((s) => showRemoved || !s.removed);

  if (list.length === 0) {
    $("school-list").innerHTML = '<p style="margin: 0; color: #5B6472">No schools yet. Add the first one above.</p>';
    return;
  }

  $("school-list").innerHTML = list.map((s, i) => {
    const status = s.removed
      ? '<span class="pill" style="background: #EEF1F6; color: #5B6472">Removed</span>'
      : s.active === false
        ? '<span class="pill" style="background: #FDE8E7; color: #8F1D15">Switched off</span>'
        : '<span class="pill" style="background: #E3F4E8; color: #115E2C">Switched on</span>';

    const buttons = s.removed
      ? `<button type="button" class="btn btn-line" data-act="restore" data-id="${s.id}">Restore</button>`
      : `<button type="button" class="btn btn-navy" style="height: 40px; font-size: 13px" data-act="open" data-id="${s.id}">Open school</button>
         <button type="button" class="btn btn-line" data-act="toggle" data-id="${s.id}">${s.active === false ? "Switch on" : "Switch off"}</button>
         <button type="button" class="btn btn-danger" data-act="remove" data-id="${s.id}">Remove</button>`;

    return `
      <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px; padding: 16px 0; ${i < list.length - 1 ? "border-bottom: 1px solid #EEF1F6" : ""}">
        <div style="flex: 1 1 320px; display: flex; flex-direction: column; gap: 4px">
          <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 10px"><strong style="font-size: 17px">${s.name}</strong>${status}</div>
          <span style="font-size: 13px; color: #5B6472">${[s.town, (s.levels || []).join(" · ")].filter(Boolean).join(" — ")}</span>
          <span style="font-size: 13px; color: #5B6472">Headmaster: ${s.headmasterName || "—"} · ${s.headmasterEmail || ""}</span>
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 8px">${buttons}</div>
      </div>`;
  }).join("");

  document.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => act(b.dataset.act, b.dataset.id)));
}

// ---------- Actions on a school ----------
async function act(action, id) {
  const s = schools.find((x) => x.id === id);
  try {
    if (action === "open") {
      // Look inside this school as the admin
      sessionStorage.setItem("cp-view-school", id);
      location.href = "dashboard.html";
      return;
    }
    if (action === "toggle") {
      const turningOff = s.active !== false;
      if (turningOff && !confirm(`Switch off ${s.name}?\n\nNobody at this school will be able to log in until you switch it back on. Nothing is deleted.`)) return;
      await updateDoc(doc(db, "schools", id), { active: !turningOff, updatedAt: serverTimestamp() });
      say("list-status", `${s.name} ${turningOff ? "switched off" : "switched on"} ✓`, "#157F3B");
    }
    if (action === "remove") {
      const typed = prompt(`Remove ${s.name}?\n\nThe school disappears from your list and nobody there can log in. Its records are kept, so you can restore it later.\n\nTo confirm, type the school's name:`);
      if (typed === null) return;
      if (typed.trim().toLowerCase() !== s.name.toLowerCase()) {
        say("list-status", "The name didn't match, so nothing was removed.", "#8A5A00");
        return;
      }
      await updateDoc(doc(db, "schools", id), { removed: true, active: false, updatedAt: serverTimestamp() });
      say("list-status", `${s.name} removed. Tick "Show removed schools" to restore it.`, "#157F3B");
    }
    if (action === "restore") {
      await updateDoc(doc(db, "schools", id), { removed: false, active: true, updatedAt: serverTimestamp() });
      say("list-status", `${s.name} restored and switched on ✓`, "#157F3B");
    }
    await loadSchools();
  } catch (error) {
    say("list-status", "Something went wrong: " + error.message, "#B42318");
  }
}

$("show-removed").addEventListener("change", drawList);

// ---------- Add a school (and its headmaster's login) ----------
$("add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("s-name").value.trim().replace(/\s+/g, " ");
  const town = $("s-town").value.trim();
  const levels = [...document.querySelectorAll('input[name="level"]:checked')].map((c) => c.value);
  const hName = $("h-name").value.trim();
  const hEmail = $("h-email").value.trim().toLowerCase();
  const hPass = $("h-pass").value.trim();

  if (!name || !hName || !hEmail || !hPass) return say("add-status", "Please fill in the school name and the headmaster's name, email and password.", "#B42318");
  if (levels.length === 0) return say("add-status", "Tick at least one level.", "#B42318");
  if (hPass.length < 6) return say("add-status", "The password must be at least 6 characters.", "#B42318");
  if (schools.some((s) => !s.removed && s.name.toLowerCase() === name.toLowerCase())) return say("add-status", "A school with that name already exists.", "#B42318");

  $("add-btn").disabled = true;
  say("add-status", "Creating the school and the headmaster's login…", "#12305A");
  try {
    // 1. The headmaster's login
    const uid = await createLogin(hEmail, hPass);

    // 2. The school
    const schoolRef = doc(collection(db, "schools"));
    await setDoc(schoolRef, {
      name, town, levels,
      headmasterUid: uid, headmasterName: hName, headmasterEmail: hEmail,
      active: true, removed: false, createdAt: serverTimestamp()
    });

    // 3. The headmaster's profile, linked to the school
    await setDoc(doc(db, "users", uid), {
      role: "headmaster", name: hName, email: hEmail, schoolId: schoolRef.id, active: true, createdAt: serverTimestamp()
    });

    // 4. The standard classes for the chosen levels (Creche 1 … JHS 3)
    let classCount = 0;
    if ($("make-classes").checked) {
      const batch = writeBatch(db);
      LEVELS.filter((l) => levels.includes(l.level)).forEach((l) => l.classes.forEach((className) => {
        batch.set(doc(db, "schools", schoolRef.id, "classes", makeId(className)),
          { className, level: l.level, students: [], updatedAt: serverTimestamp() });
        classCount++;
      }));
      await batch.commit();
    }

    // Show the login details to pass on
    $("new-login").hidden = false;
    $("new-login").innerHTML = `
      <strong style="color: #115E2C">${name} added ✓${classCount ? ` ${classCount} classes created.` : ""} Give these login details to the headmaster:</strong>
      <span>Website: <strong>${location.origin}${location.pathname.replace("admin.html", "index.html")}</strong> → Headmaster</span>
      <span>Email: <strong>${hEmail}</strong></span>
      <span>Password: <strong>${hPass}</strong></span>
      <span style="font-size: 13px; color: #115E2C">They can change the password later with "Forgot your password?".</span>`;

    $("add-form").reset();
    $("h-pass").value = newPassword();
    say("add-status", "", "");
    await loadSchools();
  } catch (error) {
    say("add-status", friendlyError(error), "#B42318");
  } finally {
    $("add-btn").disabled = false;
  }
});

loadSchools().catch((error) => say("list-status", "Could not load schools: " + error.message, "#B42318"));
