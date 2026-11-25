// js/auth.js
// Logins for ClasPules. There are four kinds of account (roles):
//   admin      – the owner of ClasPules (Sam). Adds and removes schools.
//   headmaster – runs one school. Creates teacher and parent accounts.
//   teacher    – works with their classes in one school.
//   parent     – sees only their own child.
// Every account has a record in "users" with its role (and its school, except the admin).

import { app, db, firebaseConfig } from "./firebase.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

export const auth = getAuth(app);

// Where each role goes after logging in
export const HOME = { admin: "admin.html", headmaster: "head.html", teacher: "classes.html", parent: "parent.html" };
export const ROLE_NAMES = { admin: "Admin", headmaster: "Headmaster", teacher: "Teacher", parent: "Parent" };

// Parents log in with a username + PIN from the school (no email needed).
// Behind the scenes the username becomes a login like "ama.boateng@parent.classpulse.app".
export const PARENT_DOMAIN = "parent.classpulse.app";
export const parentUsername = (username) => username.trim().toLowerCase().replace(/\s+/g, ".");
// After a PIN reset the parent gets a fresh login ("ama.boateng.v2@…"); version 0 is the first one.
export const parentLogin = (username, version = 0) => `${parentUsername(username)}${version ? `.v${version}` : ""}@${PARENT_DOMAIN}`;

// Which login a parent's username uses now (only the version number is stored; no PIN, no child)
export async function currentParentLogin(username) {
  try {
    const snap = await getDoc(doc(db, "parentLogins", parentUsername(username)));
    return parentLogin(username, snap.exists() ? snap.data().version || 0 : 0);
  } catch (error) {
    return parentLogin(username);
  }
}
// Firebase passwords need 6+ characters, so a parent's short PIN (e.g. 12345) gets a fixed prefix
export const parentPassword = (pin) => `cpp-${String(pin).trim()}`;

// Wait until Firebase knows whether someone is logged in, then return them and their profile
export function whoAmI() {
  return new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, async (user) => {
      stop();
      if (!user) return resolve(null);
      const snap = await getDoc(doc(db, "users", user.uid));
      resolve({ user, profile: snap.exists() ? snap.data() : null });
    });
  });
}

// Put this at the top of a page: anyone not logged in with one of these roles goes to the login page
export async function requireRole(...roles) {
  const me = await whoAmI();
  if (!me || !me.profile || !roles.includes(me.profile.role) || me.profile.active === false) {
    location.replace("index.html");
    return new Promise(() => {}); // stop the page here
  }
  return me;
}

export function logOut() {
  try { sessionStorage.removeItem("cp-view-school"); } catch (e) { /* fine */ }
  return signOut(auth).then(() => location.replace("index.html"));
}

// Log in, and check the person chose the right login and their school is switched on
export async function logIn(role, login, password) {
  const { user } = await signInWithEmailAndPassword(auth, login, password);
  const ref = doc(db, "users", user.uid);
  let snap = await getDoc(ref);

  // The very first admin: the account made in the Firebase console has no profile yet.
  // If ClasPules has no admin on record, this person becomes the admin. After that, nobody else can.
  if (!snap.exists() && role === "admin") {
    const platform = await getDoc(doc(db, "platform", "main"));
    if (!platform.exists() || !platform.data().adminUid) {
      await setDoc(ref, { role: "admin", name: "Admin", email: user.email, active: true, createdAt: serverTimestamp() });
      await setDoc(doc(db, "platform", "main"), { adminUid: user.uid, createdAt: serverTimestamp() }, { merge: true });
      snap = await getDoc(ref);
    }
  }

  const fail = async (message) => { await signOut(auth); throw new Error(message); };

  if (!snap.exists()) return fail("This account hasn't been set up yet. Please ask your headmaster.");
  const profile = snap.data();
  if (profile.active === false) return fail("This account has been switched off. Please ask your headmaster.");
  if (profile.role !== role) {
    return fail(`This is a ${ROLE_NAMES[profile.role]} account. Please use the ${ROLE_NAMES[profile.role]} login.`);
  }

  // Everyone except the admin belongs to a school, which must be switched on
  if (profile.role !== "admin") {
    const school = await getDoc(doc(db, "schools", profile.schoolId));
    if (!school.exists() || school.data().active === false) {
      return fail("Your school's ClasPules account is switched off. Please contact the school.");
    }
  }
  return profile;
}

export const resetPassword = (email) => sendPasswordResetEmail(auth, email);

// Make a new login WITHOUT logging out the person who is making it.
// (Uses a second, temporary copy of Firebase just for creating the account.)
export async function createLogin(email, password) {
  const temp = initializeApp(firebaseConfig, "account-maker-" + Date.now());
  try {
    const tempAuth = getAuth(temp);
    const { user } = await createUserWithEmailAndPassword(tempAuth, email, password);
    await signOut(tempAuth);
    return user.uid;
  } finally {
    await deleteApp(temp);
  }
}

// Like createLogin, but if the login already exists (e.g. practice data made before),
// sign in to it with the known password and reuse it.
export async function getOrCreateLogin(email, password) {
  try {
    return await createLogin(email, password);
  } catch (error) {
    if (error.code !== "auth/email-already-in-use") throw error;
    const temp = initializeApp(firebaseConfig, "account-finder-" + Date.now());
    try {
      const tempAuth = getAuth(temp);
      const { user } = await signInWithEmailAndPassword(tempAuth, email, password);
      await signOut(tempAuth);
      return user.uid;
    } finally {
      await deleteApp(temp);
    }
  }
}

// Turn Firebase's error codes into plain words
export function friendlyError(error) {
  const code = error.code || "";
  if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found", "auth/invalid-email"].includes(code))
    return "That login or password isn't right. Please check and try again.";
  if (code === "auth/email-already-in-use") return "That email already has a ClasPules account. Use a different email.";
  if (code === "auth/weak-password") return "The password must be at least 6 characters.";
  if (code === "auth/too-many-requests") return "Too many tries. Please wait a few minutes and try again.";
  if (code === "auth/network-request-failed") return "No internet connection. Please check and try again.";
  if (code === "auth/operation-not-allowed") return "Logins aren't switched on yet in Firebase (Authentication → Email/Password).";
  return error.message;
}
