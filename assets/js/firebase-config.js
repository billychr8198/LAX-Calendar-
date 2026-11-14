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
  apiKey: "PASTE-YOUR-API-KEY-HERE",
  authDomain: "your-project-id.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project-id.firebasestorage.app",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:0000000000000000000000"
};

window.LAX_CLOUD_OPTIONS = {
  google: true        // show "Continue with Google" (turn the Google provider on in Firebase too)
};
