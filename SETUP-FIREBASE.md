# Switching on accounts & cross-device saving (Firebase)

LAX Mission Control has sign-in and cloud saving built in. It switches on as soon as the
site is connected to a **Firebase** project — Google's free backend for apps. This takes
about 15 minutes, once, and costs nothing on the free *Spark* plan.

What players get once it is on:

* **Create account / Sign in** with email + password, or **Continue with Google**
* **Forgot password** emails, **email verification**, change name / password, **delete account**
* Their season saved to the cloud and **synced live** between phone, tablet and computer
* A list of the **devices** they are signed in on, with the last time each was seen
* **Works offline** — changes queue on the device and upload when it reconnects
* Guests can still play without an account; signing in later brings their progress along

---

## 1 · Create the Firebase project

1. Go to <https://console.firebase.google.com> and sign in with your Google account.
2. **Create a project** → name it e.g. `lax-mission-control` → you can switch Google Analytics
   **off** (not needed) → **Create project**.
3. Stay on the free **Spark** plan. No billing account is needed for anything below.

## 2 · Register the website as a Web app

1. On the project's home page click the **`</>` (Web)** icon — *Add an app to get started*.
2. App nickname: `LAX Mission Control`. Leave *Firebase Hosting* **unticked** (you use GitHub Pages).
3. Click **Register app**. Firebase shows a block of code containing `const firebaseConfig = { … }`.
4. Copy the six values into **`assets/js/firebase-config.js`** in this project, replacing the
   placeholders, so it looks like this (your values will differ):

```js
window.LAX_FIREBASE_CONFIG = {
  apiKey: "AIzaSyD…",
  authDomain: "lax-mission-control.firebaseapp.com",
  projectId: "lax-mission-control",
  storageBucket: "lax-mission-control.firebasestorage.app",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abc123def456"
};
```

You can find these again any time: ⚙ **Project settings → General → Your apps → SDK setup and configuration → Config**.

> These values are **not secret** — every Firebase website sends them to the browser. Your
> players' data is protected by sign-in and by the security rules in step 4.

## 3 · Turn on sign-in methods

**Build → Authentication → Get started → Sign-in method**

1. **Email/Password** → Enable (leave *Email link* off) → **Save**.
2. **Google** → Enable → choose a **support email** (yours) → **Save**.
   *(If you'd rather not offer Google, skip it and set `google: false` in `firebase-config.js`.)*
3. **Settings → Authorized domains → Add domain** → `billychr8198.github.io` → Add.
   (`localhost` is already there, for testing on your computer.)

Optional but nice: **Authentication → Templates** lets you edit the verification and
password-reset emails — e.g. set the sender name to *LAX Mission Control*.

## 4 · Create the database and lock it down

**Databases & Storage → Firestore** (older consoles: **Build → Firestore Database**) → **Create database**

1. Edition: **Standard**.
2. Database ID: **leave it as `(default)`** — the site uses the default database, and only the
   default database gets the free daily quota.
3. Location: **`asia-southeast2` (Jakarta)** is closest to you; any location works. It cannot be changed later.
4. Security rules: choose **Production mode** → **Create**.
5. Open the **Rules** tab, delete everything there, paste the whole of **`firestore.rules`**
   from this project, and click **Publish**.

The rules let each player read and write **only their own** save and nothing else.

## 5 · Upload and test

1. Upload the project to GitHub as before (the new files are `firebase-config.js`, `cloud.js`,
   `firebase-lax.v13.1.0.js`, `firestore.rules` and this guide).
2. Open the site. The header now shows **Sign in**. Create an account.
3. Open the site on your phone, sign in with the same account — your season appears.
   Tick a task on one device and watch it arrive on the other a moment later.
4. In the Firebase console you can see players under **Authentication → Users**, and saved
   seasons under **Firestore → Data → users → (user id) → game → season**.

---

## How the saving works

| | |
| --- | --- |
| **Where data lives** | `users/{uid}` (name, email, device list) and `users/{uid}/game/season` (the whole season as one JSON string, plus a small summary: days logged, points, routes, passengers, world rank). |
| **When it saves** | Instantly on the device, then to the cloud about a second after the last change. |
| **Two devices at once** | Every day in the season carries the time it last changed. When copies differ, the newer version of each day wins, so edits made on different devices are combined rather than overwritten. |
| **Guest → account** | Signing in on a device with guest progress: if the account is empty, the guest season moves into it. If both have progress, the player chooses **Combine both** (recommended), **Use my account's season**, or **Replace my account with this device**. |
| **Signing out** | The device returns to guest mode with an empty board. The season stays safe in the account. |
| **Reset / load from file** | Applies to every signed-in device. |
| **Offline** | Firestore keeps a local copy and a queue of changes; they upload when the connection returns. The header dot turns gold while offline. |

**Status dot on the account button:** green = saved · blue blinking = saving · gold = offline · red = not synced (open the account window to see why).

### Free-tier headroom

The Spark plan includes, per day, **50,000 document reads and 20,000 writes**, plus **1 GiB of storage**
(Firestore). A save is one write, debounced so a busy evening of ticking tasks is a few dozen writes;
a season is ~20–60 KB. Thousands of players fit comfortably. Authentication with email/password and
Google is free.

### Troubleshooting

| Message / symptom | Fix |
| --- | --- |
| *Accounts are almost ready* when you click **Guest** | `firebase-config.js` still has the placeholders — paste your config (step 2). |
| *This website is not on the Firebase project's list of authorized domains* | Add `billychr8198.github.io` in Authentication → Settings → Authorized domains (step 3). |
| *This sign-in method is not switched on* | Enable Email/Password or Google (step 3). |
| *The cloud refused the save* (red dot) | The rules weren't published, or were edited. Paste `firestore.rules` again and Publish (step 4). |
| Google pop-up closes or is blocked | Allow pop-ups for the site. On some phones the site falls back to a full-page Google sign-in automatically. |
| Nothing happens on `file://` | Open the site through GitHub Pages or a local server (`python3 -m http.server`), not by double-clicking `index.html`. |

### Files involved

```
assets/js/firebase-config.js           ← your project's keys (edit this)
assets/js/cloud.js                     ← sign-in screens, account window, sync engine
assets/vendor/firebase-lax.v13.1.0.js  ← Firebase JavaScript SDK 13.1.0 (Auth + Firestore), self-hosted
firestore.rules                        ← paste into the Firebase console
```
