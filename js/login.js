// js/login.js
// The welcome page: choose Teacher, Headmaster or Parent, then log in.

import { logIn, whoAmI, HOME, parentLogin, resetPassword, friendlyError } from "./auth.js";

const roleButtons = document.querySelectorAll(".role");
const form = document.getElementById("login-form");
const idInput = document.getElementById("login-id");
const passInput = document.getElementById("login-pass");
const goBtn = document.getElementById("go-btn");
const forgotBtn = document.getElementById("forgot-btn");
const msg = document.getElementById("msg");

const NAMES = { teacher: "Teacher", headmaster: "Headmaster", parent: "Parent", admin: "Admin" };
let role = "teacher";

function say(text, color = "#12305A") {
  msg.textContent = text;
  msg.style.color = color;
}

// Show / hide what is being typed in the password (or PIN) box
const eyeBtn = document.getElementById("show-pass");
function setVisible(show) {
  passInput.type = show ? "text" : "password";
  eyeBtn.setAttribute("aria-pressed", show);
  const word = role === "parent" ? "PIN" : "password";
  eyeBtn.setAttribute("aria-label", show ? `Hide ${word}` : `Show ${word}`);
  eyeBtn.querySelector(".eye-open").style.display = show ? "none" : "block";
  eyeBtn.querySelector(".eye-shut").style.display = show ? "block" : "none";
}
eyeBtn.addEventListener("click", () => { setVisible(passInput.type === "password"); passInput.focus(); });

// Switch between Teacher / Headmaster / Parent
function pickRole(newRole) {
  role = newRole;
  roleButtons.forEach((b) => b.setAttribute("aria-pressed", b.dataset.role === role));
  goBtn.textContent = `Log in as ${NAMES[role]}`;
  say("");
  setVisible(false);

  if (role === "parent") {
    document.getElementById("login-label").textContent = "Username (from the school)";
    document.getElementById("pass-label").textContent = "PIN";
    idInput.type = "text";
    idInput.placeholder = "e.g. ama.boateng";
    passInput.inputMode = "numeric";
    passInput.placeholder = "6-digit PIN";
    forgotBtn.textContent = "Forgot your PIN? Please ask the school.";
  } else {
    document.getElementById("login-label").textContent = "Email";
    document.getElementById("pass-label").textContent = "Password";
    idInput.type = "email";
    idInput.placeholder = role === "teacher" ? "e.g. a.mensah@school.edu.gh" : role === "admin" ? "your admin email" : "headmaster@school.edu.gh";
    passInput.inputMode = "text";
    passInput.placeholder = "";
    forgotBtn.textContent = "Forgot your password?";
  }
  idInput.focus();
}

roleButtons.forEach((b) => b.addEventListener("click", () => pickRole(b.dataset.role)));
document.getElementById("admin-link").addEventListener("click", () => pickRole("admin"));

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = idInput.value.trim();
  const pass = passInput.value;
  if (!id || !pass) {
    say(role === "parent" ? "Please type your username and PIN." : "Please type your email and password.", "#B42318");
    return;
  }

  goBtn.disabled = true;
  say("Logging in…");
  try {
    const login = role === "parent" ? parentLogin(id) : id;
    await logIn(role, login, pass);
    say("Welcome! Opening your page…", "#157F3B");
    location.href = HOME[role];
  } catch (error) {
    say(friendlyError(error), "#B42318");
    goBtn.disabled = false;
  }
});

forgotBtn.addEventListener("click", async () => {
  if (role === "parent") {
    say("Please ask the school office or the headmaster for a new PIN.", "#1E5AA8");
    return;
  }
  const email = idInput.value.trim();
  if (!email) {
    say("Type your email above first, then click Forgot your password? again.", "#8A5A00");
    idInput.focus();
    return;
  }
  try {
    await resetPassword(email);
    say(`If ${email} has an account, a reset link has been sent to it. Check your inbox.`, "#157F3B");
  } catch (error) {
    say(friendlyError(error), "#B42318");
  }
});

// Already logged in? Go straight to your page.
whoAmI().then((me) => {
  if (me && me.profile && HOME[me.profile.role]) location.replace(HOME[me.profile.role]);
});

pickRole("teacher");
