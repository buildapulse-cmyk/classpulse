// js/welcome.js
// Starter page for each side: checks the right person is logged in and shows a Log out button.
// (These pages get their real content in the next steps.)

import { requireRole, logOut } from "./auth.js";

const role = document.body.dataset.role;
const me = await requireRole(role);

document.getElementById("who").textContent = `${me.profile.name || me.user.email} · ${me.user.email}`;
document.getElementById("logout-btn").addEventListener("click", logOut);
document.getElementById("page").hidden = false;
