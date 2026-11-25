// js/firebase.js
// Connects ClasPules to the Firebase database (Firestore)

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyB9gsk246-z8iGxicTDZpJ6evagayLMkvA",
  authDomain: "classpulse-80991.firebaseapp.com",
  projectId: "classpulse-80991",
  storageBucket: "classpulse-80991.firebasestorage.app",
  messagingSenderId: "620607948698",
  appId: "1:620607948698:web:1bf7371f9a1f9da254dc23"
};

export const app = initializeApp(firebaseConfig);

// "db" is your database. Other files will import it from here.
export const db = getFirestore(app);
