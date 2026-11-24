// js/classes.js
// Fills a class drop-down with the classes saved in the database,
// so new classes appear on every page automatically.

import { db } from "./firebase.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import { useSchool, schoolCol, schoolDoc } from "./school.js";
import { classOrder, groupedOptions } from "./levels.js";

export async function fillClassSelect(select, { allOption = null } = {}) {
  const keep = select.value;
  const snap = await getDocs(schoolCol("classes"));
  const names = snap.docs.map((d) => d.data().className).sort(classOrder);

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
