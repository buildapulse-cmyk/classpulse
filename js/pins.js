// js/pins.js
// Class PINs. The PIN itself is never stored on the class — only a scrambled
// version (a "hash"). A teacher's typed PIN is scrambled the same way and compared.

export async function hashPin(schoolId, classId, pin) {
  const text = `${schoolId}|${classId}|${String(pin).trim()}`;
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// A random 4-digit PIN that doesn't start with 0
export const newPin = () => String(Math.floor(1000 + Math.random() * 9000));
