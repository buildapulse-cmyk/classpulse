// js/classes.js
// Fills a class drop-down with the classes saved in the database,
// so new classes appear on every page automatically.

import { db } from "./firebase.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import { useSchool, schoolCol, schoolDoc, SCHOOL, isAllowed } from "./school.js";
import { classOrder, groupedOptions, SUBJECTS } from "./levels.js";

export async function fillClassSelect(select, { allOption = null } = {}) {
  const keep = select.value;
  const snap = await getDocs(schoolCol("classes"));
  const names = snap.docs.map((d) => d.data().className).filter(isAllowed).sort(classOrder);

  select.innerHTML =
    (allOption ? `<option value="all">${allOption}</option>` : "") +
    groupedOptions(names);

  // Keep the same choice if it still exists; also allow ?class=JHS%202A in the address
  const wanted = new URLSearchParams(location.search).get("class");
  if (wanted && names.includes(wanted)) select.value = wanted;
  else if ([...select.options].some((o) => o.value === keep)) select.value = keep;

  if (names.length === 0) select.innerHTML = '<option value="">No classes yet — add one on Class lists</option>';
  return names;
}

// Fills a subject drop-down: a subject teacher sees only their subjects, everyone else the standard list
export function fillSubjectSelect(select, { allOption = null } = {}) {
  const p = SCHOOL.me ? SCHOOL.me.profile : {};
  const list = p.role === "teacher" && p.teacherType === "subject" && (p.subjects || []).length ? p.subjects : SUBJECTS;
  const keep = select.value;
  select.innerHTML = (allOption ? `<option value="all">${allOption}</option>` : "") + list.map((s) => `<option>${s}</option>`).join("");
  if ([...select.options].some((o) => o.value === keep)) select.value = keep;
}
