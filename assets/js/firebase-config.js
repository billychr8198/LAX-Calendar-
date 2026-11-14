/* =============================================================
   LAX MISSION CONTROL — your Firebase project
   -------------------------------------------------------------
   Accounts and cross-device saving switch on as soon as this file
   holds your own Firebase web-app config. Until then the game runs
   exactly as before, saving on this device only.

   Where to find these values:
     Firebase console → ⚙ Project settings → General → Your apps →
     (your web app) → SDK setup and configuration → Config
   Copy the six lines from there over the placeholders below.
   Full walkthrough: SETUP-FIREBASE.md

   These values are NOT secret. Every Firebase web app ships them
   to the browser; your data is protected by Authentication and by
   the rules in firestore.rules, not by hiding this file.
   ============================================================= */
window.LAX_FIREBASE_CONFIG = {
  apiKey: "AIzaSyBwAkFyB1KQzheg4XcoKaL4J5TNIVwP7mg",
  authDomain: "los-angeles-cd047.firebaseapp.com",
  projectId: "los-angeles-cd047",
  storageBucket: "los-angeles-cd047.firebasestorage.app",
  messagingSenderId: "179900264383",
  appId: "1:179900264383:web:0a243e28e0910af9fdfb0a",
  measurementId: "G-3VQLYHFE4L"
};

window.LAX_CLOUD_OPTIONS = {
  google: true        // show "Continue with Google" (turn the Google provider on in Firebase too)
};
