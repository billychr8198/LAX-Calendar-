/* =============================================================
   LAX MISSION CONTROL — accounts & cloud sync
   -------------------------------------------------------------
   Firebase Authentication (email + password, Google) and Cloud
   Firestore keep one saved season per player, so the same game
   continues on a phone, a laptop and a tablet.

   How syncing works
     • Guests play exactly as before; the season lives on this device.
     • Signing in loads the account's season. If this device also has
       guest progress, the player chooses: combine, keep the account,
       or replace the account with this device.
     • Every change is saved locally at once and sent to the cloud a
       moment later. Other signed-in devices receive it live.
     • Each day carries the time it last changed, so when two devices
       both edit, the newer copy of every day wins and nothing is lost.
     • Offline? Changes queue on the device and upload on reconnect.
   Firebase must be configured in assets/js/firebase-config.js; until
   then this file only shows a "set up accounts" note.
   ============================================================= */
(function () {
  'use strict';

  var APP = window.LAX_APP;
  if (!APP) return;
  var CFG = window.LAX_FIREBASE_CONFIG || {};
  var OPT = window.LAX_CLOUD_OPTIONS || {};
  var CONFIGURED = !!(CFG.apiKey && !/^PASTE/i.test(CFG.apiKey) && CFG.projectId && !/^your-project/i.test(CFG.projectId));
  var BUNDLE = 'assets/vendor/firebase-lax.v13.1.0.js';
  var DEVICE_KEY = 'lax-mission-control:device';
  var BANNER_KEY = 'lax-mission-control:banner-hidden';

  var be = null, user = null;
  var status = CONFIGURED ? 'connecting' : 'off';
  var errMsg = '', lastSynced = null, lastRemote = null, devices = [];
  var unsubGame = null, unsubProfile = null, pushTimer = null, retryTimer = null, beatTimer = null;
  var lastPushedJSON = null, pendingRemote = null, pendingTimer = null;
  var acctOpen = false, attaching = false;
  var device = getDevice();
  var esc = APP.esc;

  /* ---------------- small helpers ---------------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function stable(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    return '{' + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; })
      .map(function (k) { return JSON.stringify(k) + ':' + stable(v[k]); }).join(',') + '}';
  }
  function parse(json) { try { var d = JSON.parse(json); return d && typeof d === 'object' ? d : null; } catch (e) { return null; } }
  function ago(t) {
    if (!t) return 'never';
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    if (s < 86400 * 7) return Math.round(s / 86400) + ' d ago';
    return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function labelOf() {
    var ua = navigator.userAgent || '', os = 'Computer', br = 'Browser';
    if (/iPhone/.test(ua)) os = 'iPhone';
    else if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) os = 'iPad';
    else if (/Android/.test(ua)) os = /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
    else if (/CrOS/.test(ua)) os = 'Chromebook';
    else if (/Windows/.test(ua)) os = 'Windows';
    else if (/Macintosh|Mac OS X/.test(ua)) os = 'Mac';
    else if (/Linux/.test(ua)) os = 'Linux';
    if (/Edg\//.test(ua)) br = 'Edge';
    else if (/OPR\//.test(ua)) br = 'Opera';
    else if (/SamsungBrowser/.test(ua)) br = 'Samsung Internet';
    else if (/Firefox|FxiOS/.test(ua)) br = 'Firefox';
    else if (/Chrome|CriOS/.test(ua)) br = 'Chrome';
    else if (/Safari/.test(ua)) br = 'Safari';
    return br + ' on ' + os;
  }
  function getDevice() {
    var d = null;
    try { d = JSON.parse(localStorage.getItem(DEVICE_KEY) || 'null'); } catch (e) {}
    if (!d || !d.id) {
      d = { id: 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), first: Date.now() };
      try { localStorage.setItem(DEVICE_KEY, JSON.stringify(d)); } catch (e) {}
    }
    d.label = labelOf();
    return d;
  }
  function setSession(u) { try { localStorage.setItem(APP.SESSION_KEY, JSON.stringify({ uid: u.uid, name: u.name, email: u.email })); } catch (e) {} }
  function clearSession() { try { localStorage.removeItem(APP.SESSION_KEY); } catch (e) {} }
  function firstName(u) {
    if (!u) return '';
    var n = (u.name || '').trim();
    return n ? n.split(/\s+/)[0] : (u.email || 'Player').split('@')[0];
  }
  function initial(u) { return (firstName(u) || '?').charAt(0).toUpperCase(); }
  function loadScript(src) {
    return new Promise(function (res, rej) {
      if (window.LAX_FIREBASE) return res();
      var s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = function () { res(); };
      s.onerror = function () { rej(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
  }

  var AUTH_ERR = {
    'auth/invalid-email': 'That email address does not look right.',
    'auth/missing-email': 'Enter your email address.',
    'auth/missing-password': 'Enter your password.',
    'auth/weak-password': 'Choose a longer password — at least 8 characters.',
    'auth/email-already-in-use': 'There is already an account with this email. Sign in instead.',
    'auth/invalid-credential': 'Email or password is incorrect.',
    'auth/invalid-login-credentials': 'Email or password is incorrect.',
    'auth/wrong-password': 'Email or password is incorrect.',
    'auth/user-not-found': 'Email or password is incorrect.',
    'auth/user-disabled': 'This account has been disabled.',
    'auth/too-many-requests': 'Too many attempts. Wait a minute and try again.',
    'auth/network-request-failed': 'No connection. Check your internet and try again.',
    'auth/unauthorized-domain': 'This website is not on the Firebase project’s list of authorized domains yet (Authentication → Settings → Authorized domains).',
    'auth/operation-not-allowed': 'This sign-in method is not switched on in the Firebase console yet.',
    'auth/popup-blocked': 'The browser blocked the Google window. Allow pop-ups for this site, or try again.',
    'auth/account-exists-with-different-credential': 'This email already has an account with a different sign-in method. Use that one.',
    'auth/requires-recent-login': 'For your safety, sign in again first.',
    'auth/invalid-api-key': 'The Firebase settings in firebase-config.js are not valid.',
    'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'The Firebase settings in firebase-config.js are not valid.',
    'permission-denied': 'The cloud refused the save. Check that firestore.rules has been published in the Firebase console.',
    'unavailable': 'The cloud cannot be reached right now. Your progress is safe on this device and will upload later.'
  };
  function friendly(err) {
    var c = err && (err.code || '');
    return AUTH_ERR[c] || (err && err.message ? err.message.replace(/^Firebase:\s*/, '').replace(/\s*\(.*\)\.?$/, '') : 'Something went wrong.');
  }
  function closeIfAuth() { if ($('#modal-body .au')) APP.closeModal(); }
  function silent(err) { return /popup-closed-by-user|cancelled-popup-request|user-cancelled/.test(err && err.code || ''); }

  /* ---------------- status ---------------- */
  var STATUS = {
    off:        ['off', 'Accounts not set up'],
    guest:      ['guest', 'Guest · saved on this device only'],
    connecting: ['wait', 'Connecting…'],
    saving:     ['wait', 'Saving to the cloud…'],
    synced:     ['ok', 'All progress saved to the cloud'],
    offline:    ['warn', 'Offline · will sync when you reconnect'],
    error:      ['bad', 'Not synced']
  };
  function setStatus(s, msg) {
    status = s;
    if (msg !== undefined) errMsg = msg;
    render();
  }

  /* ---------------- start ---------------- */
  function start() {
    render();
    if (!CONFIGURED) return;
    APP.onSave(function () { if (user && !attaching) schedulePush(1200); });
    window.addEventListener('online', function () { if (user) { setStatus('saving'); schedulePush(300); } });
    window.addEventListener('offline', function () { if (user) setStatus('offline'); });
    window.addEventListener('focus', function () {
      if (user && !user.verified && be) be.reload().then(function (u) { if (u) { user = u; render(); } }).catch(function () {});
    });
    loadScript(BUNDLE).then(function () {
      be = window.LAX_FIREBASE.createBackend(CFG, { emulator: OPT.emulator, memoryCache: OPT.memoryCache });
      if (window.__LAX_DATA_OVERRIDE) Object.assign(be, window.__LAX_DATA_OVERRIDE);
      be.redirectResult().catch(function (e) { if (!silent(e)) APP.toast('Sign-in did not finish', friendly(e), 'mag', '⚠️'); });
      be.onAuth(onAuth);
    }).catch(function () {
      setStatus('error', 'The sign-in system could not load. Check your connection and refresh.');
    });
    setInterval(render, 30000);
  }

  function onAuth(u) {
    if (!u) {
      stopWatching();
      var wasSigned = !!user || APP.storeKey() !== APP.GUEST_KEY;
      user = null;
      clearSession();
      if (wasSigned && APP.storeKey() !== APP.GUEST_KEY) {
        APP.readStore(APP.GUEST_KEY).then(function (g) { APP.switchTo(APP.GUEST_KEY, g || APP.blank()); });
      }
      setStatus('guest', '');
      return;
    }
    var fresh = !user || user.uid !== u.uid;
    user = u;
    setSession(u);
    if (fresh) attach(u); else render();
  }

  /* ---------------- connecting an account ---------------- */
  function attach(u) {
    attaching = true;
    setStatus('connecting', '');
    var ukey = APP.userKey(u.uid);
    var fromGuest = APP.storeKey() === APP.GUEST_KEY;
    var guest = fromGuest ? JSON.parse(JSON.stringify(APP.getState())) : null;
    var cachedP = fromGuest ? APP.readStore(ukey) : Promise.resolve(APP.getState());
    var remoteP = be.getGame(u.uid).then(function (r) { return { ok: true, r: r }; }, function (e) { return { ok: false, e: e }; });

    Promise.all([cachedP, remoteP]).then(function (res) {
      var cached = res[0], got = res[1];
      var remote = got.ok && got.r && got.r.state ? parse(got.r.state) : null;
      if (got.ok) lastRemote = got.r;
      var acct = APP.merge(cached, remote);
      var acctHas = acct && APP.hasProgress(acct);

      if (guest && APP.hasProgress(guest)) {
        if (!acctHas) return finish(ukey, APP.merge(acct, guest) || guest, { clearGuest: true, push: true,
          msg: ['Your season is now in your account', 'Sign in on any device to carry on from here.'] });
        return askWhich(guest, acct, got.ok ? got.r : null).then(function (choice) {
          var pick = choice === 'account' ? acct : choice === 'device' ? takeOver(guest) : APP.merge(acct, guest);
          finish(ukey, pick, { clearGuest: true, push: true,
            msg: choice === 'account' ? ['Account season loaded', 'Guest progress from this device was set aside.']
              : choice === 'device' ? ['This device’s season is now your account’s', 'Your other devices will switch to it.']
              : ['Both seasons combined', 'Every day from this device and your account is kept.'] });
        });
      }
      var needPush = !got.ok ? false : !remote ? APP.hasProgress(acct || {}) : stable(acct) !== stable(APP.merge(remote, null));
      finish(ukey, acct || APP.blank(), { push: needPush, quietWelcome: !fromGuest,
        msg: fromGuest ? ['Welcome back, ' + firstName(u), acctHas ? 'Your season is loaded from the cloud.' : 'You are signed in. Your progress will save to your account.'] : null });
      if (!got.ok) setStatus(navigator.onLine ? 'error' : 'offline', friendly(got.e));
    });
  }

  function takeOver(s) {
    var c = JSON.parse(JSON.stringify(s)), now = Date.now();
    c.resetAt = now;
    Object.keys(c.days || {}).forEach(function (k) { c.days[k].u = now + 1; });
    c.metaU = now + 1;
    return c;
  }

  function finish(ukey, s, o) {
    APP.switchTo(ukey, s);
    if (o.clearGuest) APP.writeStore(APP.GUEST_KEY, APP.blank());
    attaching = false;
    watch(user);
    touchDevice();
    if (o.push) pushNow(); else if (status === 'connecting') setStatus('synced');
    if (o.msg) APP.toast(o.msg[0], o.msg[1], 'gold', '☁️');
    render();
  }

  function askWhich(guest, acct, remoteMeta) {
    return new Promise(function (resolve) {
      var g = APP.summarize(guest), a = APP.summarize(acct);
      function card(t, s, extra) {
        return '<div class="cf__c"><span class="cf__k">' + t + '</span><b>' + s.logged + ' day' + (s.logged === 1 ? '' : 's') + ' logged</b>' +
          '<i>' + s.points.toLocaleString() + ' points · ' + s.routes + ' routes · ' + s.planned + ' days planned</i>' +
          '<small>Last change ' + ago(s.last) + (extra ? ' · ' + esc(extra) : '') + '</small></div>';
      }
      var body = APP.openModal(
        '<div class="cf">' +
          '<div class="cfm__ic">🔀</div><h3>Two seasons found</h3>' +
          '<p class="cfm__t">This device has guest progress, and your account already has a saved season. Which one should continue?</p>' +
          '<div class="cf__grid">' + card('On this device (guest)', g, device.label) +
            card('In your account', a, remoteMeta && remoteMeta.deviceLabel ? 'from ' + remoteMeta.deviceLabel : '') + '</div>' +
          '<div class="cf__opts">' +
            '<button type="button" class="cf__o cf__o--go" data-v="merge"><b>Combine both</b><span>Recommended. Keeps every day from both. Where both changed the same day, the newer one wins.</span></button>' +
            '<button type="button" class="cf__o" data-v="account"><b>Use my account’s season</b><span>The guest progress on this device is set aside.</span></button>' +
            '<button type="button" class="cf__o cf__o--warn" data-v="device"><b>Replace my account with this device</b><span>The cloud season is overwritten on every device.</span></button>' +
          '</div></div>', 'modal__card--sm');
      var done = false;
      function fin(v) { if (done) return; done = true; APP.setModalOnClose(null); APP.closeModal(); resolve(v); }
      APP.setModalOnClose(function () { if (!done) { done = true; resolve('merge'); } });
      body.querySelectorAll('[data-v]').forEach(function (b) { b.addEventListener('click', function () { fin(b.dataset.v); }); });
    });
  }

  /* ---------------- live sync ---------------- */
  function watch(u) {
    stopWatching();
    unsubGame = be.watchGame(u.uid, function (data, meta) {
      if (!user || user.uid !== u.uid) return;
      if (meta.pending) { if (status !== 'offline') setStatus('saving'); return; }
      if (!meta.fromCache) {
        lastSynced = Date.now();
        if (!pushTimer && (status === 'saving' || status === 'connecting' || status === 'offline' || status === 'error')) setStatus('synced', '');
      } else if (!navigator.onLine) setStatus('offline');
      if (!data) {
        lastRemote = null;
        if (!meta.fromCache && APP.hasProgress()) schedulePush(500);
        return;
      }
      lastRemote = data;
      if (data.state === lastPushedJSON) { render(); return; }
      var remote = parse(data.state);
      if (!remote) return;
      var merged = APP.merge(APP.getState(), remote);
      var other = data.updatedBy && data.updatedBy !== device.id;
      applyWhenFree(merged, other);
      if (stable(merged) !== stable(APP.merge(remote, null))) schedulePush(800);
      render();
    }, function (e) { setStatus('error', friendly(e)); });
    unsubProfile = be.watchProfile(u.uid, function (p) { devices = p.devices || []; render(); }, function () {});
    clearInterval(beatTimer);
    beatTimer = setInterval(function () { if (!document.hidden) touchDevice(); }, 5 * 60 * 1000);
  }
  function stopWatching() {
    if (unsubGame) { try { unsubGame(); } catch (e) {} unsubGame = null; }
    if (unsubProfile) { try { unsubProfile(); } catch (e) {} unsubProfile = null; }
    clearTimeout(pushTimer); pushTimer = null;
    clearTimeout(pendingTimer); pendingRemote = null;
    clearInterval(beatTimer);
    devices = []; lastRemote = null; lastPushedJSON = null;
  }
  function applyWhenFree(merged, fromOther) {
    pendingRemote = { s: merged, other: fromOther };
    clearTimeout(pendingTimer);
    (function tryApply() {
      if (!pendingRemote) return;
      if (APP.isBusy()) { pendingTimer = setTimeout(tryApply, 1500); return; }
      var p = pendingRemote; pendingRemote = null;
      APP.apply(p.s, !p.other);
    })();
  }

  function schedulePush(delay) {
    if (!user || !be) return;
    clearTimeout(pushTimer);
    if (status !== 'offline') setStatus('saving');
    pushTimer = setTimeout(pushNow, delay == null ? 1200 : delay);
  }
  function pushNow() {
    clearTimeout(pushTimer); pushTimer = null;
    if (!user || !be) return Promise.resolve();
    var json = stable(APP.getState());
    if (lastRemote && lastRemote.state === json) { setStatus('synced', ''); return Promise.resolve(); }
    lastPushedJSON = json;
    if (!navigator.onLine) setStatus('offline'); else setStatus('saving');
    var uid = user.uid;
    return be.saveGame(uid, { state: json, deviceId: device.id, deviceLabel: device.label, summary: APP.liveSummary() })
      .then(function () {
        if (!user || user.uid !== uid) return;
        lastSynced = Date.now();
        lastRemote = Object.assign({}, lastRemote || {}, { state: json, updatedAt: lastSynced, deviceLabel: device.label, updatedBy: device.id });
        clearTimeout(retryTimer);
        setStatus('synced', '');
      })
      .catch(function (e) {
        setStatus(navigator.onLine ? 'error' : 'offline', friendly(e));
        clearTimeout(retryTimer);
        retryTimer = setTimeout(function () { if (user) pushNow(); }, 20000);
      });
  }
  function touchDevice() {
    if (!user || !be) return;
    be.touchDevice(user.uid, user, device.id, { label: device.label, first: device.first }).catch(function () {});
  }

  /* ---------------- actions ---------------- */
  function doSignOut() {
    var go = pushTimer ? pushNow() : Promise.resolve();
    var t = new Promise(function (r) { setTimeout(r, 2500); });
    Promise.race([go, t]).then(function () {
      return be.signOut();
    }).then(function () {
      APP.closeModal();
      APP.toast('Signed out', 'Your season is safe in your account. This device is back to guest mode.', null, '👋');
    });
  }

  function doDelete() {
    acctOpen = false;
    APP.confirmBox({
      title: 'Delete your account?', icon: '🗑️', kind: 'warn',
      text: 'This permanently deletes your login and the season saved in the cloud, on every device. Type <b>DELETE</b> to confirm.',
      extra: '<input class="field au__del" type="text" autocomplete="off" placeholder="DELETE" aria-label="Type DELETE to confirm">',
      ok: 'Delete my account', okCls: 'btn--danger-solid', no: 'Keep it',
      read: function (b) { return (b.querySelector('.au__del').value || '').trim().toUpperCase() === 'DELETE'; }
    }).then(function (ok) {
      if (!ok) return;
      var uid = user.uid;
      stopWatching();
      return be.deleteAccount().then(function () {
        try { localStorage.removeItem(APP.userKey(uid)); } catch (e) {}
        APP.toast('Account deleted', 'Your cloud season and login are gone. You are playing as a guest.', null, '🗑️');
      }).catch(function (e) {
        if (e && e.code === 'auth/requires-recent-login') return reauthThen(doDelete);
        APP.toast('Could not delete the account', friendly(e), 'mag', '⚠️');
        if (user) watch(user);
      });
    });
  }

  function reauthThen(next) {
    var usesPassword = user && user.providers.indexOf('password') >= 0;
    if (!usesPassword) {
      return be.reauth().then(next).catch(function (e) { if (!silent(e)) APP.toast('Could not confirm it’s you', friendly(e), 'mag', '⚠️'); });
    }
    return APP.confirmBox({
      title: 'Confirm it’s you', icon: '🔐', text: 'Enter your password to continue.',
      extra: '<input class="field au__re" type="password" autocomplete="current-password" aria-label="Password">',
      ok: 'Continue', read: function (b) { return b.querySelector('.au__re').value || false; }
    }).then(function (pw) {
      if (!pw) return;
      return be.reauth(pw).then(next).catch(function (e) { APP.toast('That did not work', friendly(e), 'mag', '⚠️'); });
    });
  }

  /* ---------------- the account window ---------------- */
  function open(tab) {
    acctOpen = true;
    if (!CONFIGURED) return openSetupNote();
    if (user) return renderAccount(true);
    renderAuth(tab || 'in');
  }

  function openSetupNote() {
    APP.openModal(
      '<div class="au">' +
        '<div class="au__head"><div class="au__logo">☁️</div><h3>Accounts are almost ready</h3>' +
        '<p>Sign-in and cross-device saving are built in. They switch on once this site is connected to a free Firebase project.</p></div>' +
        '<ol class="au__steps">' +
          '<li>Create a Firebase project and add a <b>Web app</b>.</li>' +
          '<li>Paste its config into <code>assets/js/firebase-config.js</code>.</li>' +
          '<li>Turn on <b>Email/Password</b> and <b>Google</b> sign-in.</li>' +
          '<li>Create a <b>Firestore</b> database and publish <code>firestore.rules</code>.</li>' +
          '<li>Add your GitHub Pages domain to <b>Authorized domains</b>.</li>' +
        '</ol>' +
        '<p class="au__fine">The full walkthrough is in <a href="SETUP-FIREBASE.md" target="_blank" rel="noopener">SETUP-FIREBASE.md</a>. Until then everything keeps saving on this device.</p>' +
        '<div class="au__acts"><button class="btn btn--go" data-close type="button">Got it</button></div>' +
      '</div>', 'modal__card--sm');
  }

  function renderAuth(tab) {
    var google = OPT.google !== false;
    var html =
      '<div class="au">' +
        '<div class="au__head"><img class="au__img" src="assets/img/LAX_blue_logo.webp" alt="">' +
        '<h3>' + (tab === 'up' ? 'Create your LAX account' : tab === 'reset' ? 'Reset your password' : 'Sign in to LAX') + '</h3>' +
        '<p>' + (tab === 'reset' ? 'We will email you a link to choose a new password.' : 'Save your season to the cloud and carry on from any phone, tablet or computer.') + '</p></div>' +
        (tab !== 'reset' ? '<div class="seg au__tabs" role="tablist">' +
          '<button type="button" data-tab="in" aria-pressed="' + (tab === 'in') + '">Sign in</button>' +
          '<button type="button" data-tab="up" aria-pressed="' + (tab === 'up') + '">Create account</button></div>' : '') +
        '<form class="au__form" novalidate data-form="' + tab + '">' +
          (tab === 'up' ? '<label class="au__f"><span>Your name</span><input class="field" name="name" type="text" autocomplete="name" maxlength="60" placeholder="Shown on the Tower screen"></label>' : '') +
          '<label class="au__f"><span>Email</span><input class="field" name="email" type="email" autocomplete="email" inputmode="email" required placeholder="you@example.com"></label>' +
          (tab !== 'reset' ? '<label class="au__f"><span>Password</span><span class="au__pw"><input class="field" name="password" type="password" ' +
            'autocomplete="' + (tab === 'up' ? 'new-password' : 'current-password') + '" required minlength="' + (tab === 'up' ? 8 : 1) + '" placeholder="' + (tab === 'up' ? 'At least 8 characters' : 'Your password') + '">' +
            '<button type="button" class="au__eye" aria-label="Show password">👁</button></span></label>' : '') +
          (tab === 'up' ? '<div class="au__str"><i></i></div><p class="au__hint">Use 8+ characters. A short phrase is easiest to remember.</p>' : '') +
          '<p class="au__err" role="alert" hidden></p><p class="au__ok" role="status" hidden></p>' +
          '<button class="btn btn--go btn--wide au__go" type="submit">' + (tab === 'up' ? 'Create account' : tab === 'reset' ? 'Send reset link' : 'Sign in') + '</button>' +
          (tab === 'in' ? '<button type="button" class="au__link" data-tab="reset">Forgot your password?</button>' : '') +
          (tab === 'reset' ? '<button type="button" class="au__link" data-tab="in">← Back to sign in</button>' : '') +
        '</form>' +
        (google && tab !== 'reset' ? '<div class="au__or"><span>or</span></div><button type="button" class="btn btn--wide au__google">' +
          '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>' +
          'Continue with Google</button>' : '') +
        '<p class="au__fine">' + (APP.hasProgress() && APP.storeKey() === APP.GUEST_KEY ? 'Your guest progress on this device comes with you when you sign in.' : 'You can keep playing as a guest — your progress stays on this device until you sign in.') + '</p>' +
      '</div>';
    var body = APP.openModal(html, 'modal__card--sm');
    APP.setModalOnClose(function () { acctOpen = false; });
    var form = body.querySelector('.au__form'), err = body.querySelector('.au__err'), okp = body.querySelector('.au__ok'), go = body.querySelector('.au__go');
    body.querySelectorAll('[data-tab]').forEach(function (b) { b.addEventListener('click', function () { renderAuth(b.dataset.tab); }); });
    var eye = body.querySelector('.au__eye');
    if (eye) eye.addEventListener('click', function () {
      var i = form.password; i.type = i.type === 'password' ? 'text' : 'password';
      eye.setAttribute('aria-label', i.type === 'password' ? 'Show password' : 'Hide password');
    });
    if (tab === 'up') form.password.addEventListener('input', function () {
      var v = form.password.value, sc = 0;
      if (v.length >= 8) sc++; if (v.length >= 12) sc++; if (/[A-Z]/.test(v) && /[a-z]/.test(v)) sc++; if (/\d/.test(v)) sc++; if (/[^A-Za-z0-9]/.test(v)) sc++;
      var bar = body.querySelector('.au__str i');
      bar.style.width = Math.min(100, sc * 20) + '%';
      bar.className = sc <= 1 ? 'is-weak' : sc <= 3 ? 'is-ok' : 'is-strong';
    });
    form.addEventListener('input', function () { err.hidden = true; });
    function busy(on, label) { go.disabled = on; go.textContent = on ? label : (tab === 'up' ? 'Create account' : tab === 'reset' ? 'Send reset link' : 'Sign in'); }
    function fail(e) { busy(false); if (silent(e)) return; err.hidden = false; err.textContent = typeof e === 'string' ? e : friendly(e); }
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      err.hidden = true; okp.hidden = true;
      if (!be) return fail('Still connecting to the sign-in system — try again in a moment.');
      var email = (form.email.value || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Enter a valid email address.');
      if (tab === 'reset') {
        busy(true, 'Sending…');
        be.reset(email).then(function () {
          busy(false); okp.hidden = false;
          okp.textContent = 'If an account exists for ' + email + ', a reset link is on its way. Check your inbox (and spam).';
        }).catch(function (e) { if (e && e.code === 'auth/user-not-found') { busy(false); okp.hidden = false; okp.textContent = 'If an account exists for ' + email + ', a reset link is on its way.'; } else fail(e); });
        return;
      }
      var pw = form.password.value || '';
      if (tab === 'up') {
        if (pw.length < 8) return fail('Choose a password with at least 8 characters.');
        var name = (form.name.value || '').trim();
        busy(true, 'Creating your account…');
        be.signUp(name, email, pw).then(function (u) {
          if (u && name) { user = u; if (!APP.getState().ceo) { APP.getState().ceo = name; APP.save(); } }
          closeIfAuth();
          APP.toast('Account created', 'We sent a verification link to ' + email + '. You can keep playing right away.', 'gold', '🎉');
        }).catch(fail);
      } else {
        if (!pw) return fail('Enter your password.');
        busy(true, 'Signing in…');
        be.signIn(email, pw).then(closeIfAuth).catch(fail);
      }
    });
    var g = body.querySelector('.au__google');
    if (g) g.addEventListener('click', function () {
      err.hidden = true;
      if (!be) return fail('Still connecting to the sign-in system — try again in a moment.');
      var mobile = /iPhone|iPad|Android/.test(navigator.userAgent) && window.innerWidth < 760;
      g.disabled = true;
      be.google(false).then(closeIfAuth).catch(function (e) {
        g.disabled = false;
        if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') || mobile && e && e.code === 'auth/internal-error') {
          return be.google(true).catch(fail);
        }
        fail(e);
      });
    });
    setTimeout(function () { var f = form.querySelector('input'); if (f) f.focus(); }, 60);
  }

  function syncBlock() {
    var st = STATUS[status] || STATUS.error;
    var s = APP.summarize(APP.getState());
    var rm = lastRemote;
    return '<div class="sync sync--' + st[0] + '">' +
        '<span class="sync__dot"></span><div class="sync__t"><b>' + st[1] + '</b>' +
        '<small>' + (status === 'error' && errMsg ? esc(errMsg) : lastSynced ? 'Last synced ' + ago(lastSynced) : 'Waiting for the first sync') + '</small></div>' +
        '<button type="button" class="btn btn--sm" data-act="sync">Sync now</button>' +
      '</div>' +
      '<div class="acc__save">' +
        '<div><b>' + s.logged + '</b><span>days logged</span></div>' +
        '<div><b>' + s.points.toLocaleString() + '</b><span>points</span></div>' +
        '<div><b>' + s.routes + '</b><span>routes open</span></div>' +
        '<div class="acc__when"><b>' + (rm && rm.updatedAt ? ago(rm.updatedAt) : '—') + '</b><span>' + (rm && rm.deviceLabel ? 'saved from ' + esc(rm.deviceLabel) : 'cloud save') + '</span></div>' +
      '</div>';
  }
  function devicesBlock() {
    var list = devices.slice();
    if (!list.some(function (d) { return d.id === device.id; })) list.unshift({ id: device.id, label: device.label, lastSeen: Date.now() });
    return '<div class="devs"><div class="devs__h">Signed in on ' + list.length + ' device' + (list.length === 1 ? '' : 's') + '</div>' +
      list.map(function (d) {
        var me = d.id === device.id;
        var ic = /iPhone|Android phone/.test(d.label) ? '📱' : /iPad|tablet/.test(d.label) ? '📲' : '💻';
        return '<div class="devs__r"><span class="devs__ic">' + ic + '</span><span class="devs__l"><b>' + esc(d.label) + '</b>' +
          '<small>' + (me ? 'This device' : 'Last seen ' + ago(d.lastSeen)) + '</small></span>' +
          (me ? '<span class="devs__me">You are here</span>' : '<button type="button" class="devs__x" data-dev="' + esc(d.id) + '" aria-label="Remove from list">Forget</button>') +
        '</div>';
      }).join('') +
      '<p class="au__fine">Forgetting a device only removes it from this list. To stop a device syncing, sign out on it.</p></div>';
  }

  function renderAccount(fresh) {
    if (!user) return;
    var pw = user.providers.indexOf('password') >= 0;
    var avatar = user.photo ? '<img src="' + esc(user.photo) + '" alt="" referrerpolicy="no-referrer">' : esc(initial(user));
    var html =
      '<div class="acc">' +
        '<div class="acc__head"><div class="acc__av">' + avatar + '</div><div class="acc__id">' +
          '<b>' + esc(user.name || firstName(user)) + '</b><span>' + esc(user.email) + '</span>' +
          (pw ? (user.verified ? '<i class="badge badge--ok">✓ Email verified</i>' : '<i class="badge badge--warn">Email not verified · <button type="button" data-act="verify">send link</button></i>')
              : '<i class="badge">Signed in with Google</i>') +
        '</div></div>' +
        syncBlock() + devicesBlock() +
        '<div class="acc__acts">' +
          '<button type="button" class="btn btn--sm" data-act="rename">Change name</button>' +
          (pw ? '<button type="button" class="btn btn--sm" data-act="password">Change password</button>' : '') +
          '<button type="button" class="btn btn--sm btn--ghost" data-act="signout">Sign out</button>' +
          '<button type="button" class="btn btn--sm btn--danger" data-act="delete">Delete account</button>' +
        '</div>' +
      '</div>';
    var body;
    if (fresh || !$('#modal-body .acc')) {
      body = APP.openModal(html, 'modal__card--sm');
      APP.setModalOnClose(function () { acctOpen = false; });
    } else { body = $('#modal-body'); body.innerHTML = html; }
    bindAccountActions(body);
  }

  function bindAccountActions(root) {
    root.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var a = b.dataset.act;
        if (a === 'sync') { b.disabled = true; touchDevice(); pushNow().then(function () { APP.toast('Synced', 'Your season is up to date in the cloud.', null, '☁️'); }); }
        if (a === 'verify') be.verify().then(function () { APP.toast('Verification email sent', 'Open the link in it, then come back here.', null, '✉️'); }).catch(function (e) { APP.toast('Could not send it', friendly(e), 'mag', '⚠️'); });
        if (a === 'signout') doSignOut();
        if (a === 'delete') doDelete();
        if (a === 'open') open();
        if (a === 'signin') open('in');
        if (a === 'signup') open('up');
        if (a === 'rename') {
          acctOpen = false;
          APP.confirmBox({ title: 'Change your name', icon: '🪪', text: 'Shown on your account and on the Tower screen.',
            extra: '<input class="field au__nm" type="text" maxlength="60" value="' + esc(user.name || '') + '" aria-label="Name">',
            ok: 'Save', read: function (r) { return (r.querySelector('.au__nm').value || '').trim() || false; } })
          .then(function (n) {
            if (!n) return;
            be.rename(n).then(function (u) { user = u; setSession(u); APP.getState().ceo = n; APP.save(); touchDevice(); APP.toast('Name saved', 'Hello, ' + n + '.', null, '🪪'); render(); })
              .catch(function (e) { APP.toast('Could not save the name', friendly(e), 'mag', '⚠️'); });
          });
        }
        if (a === 'password') {
          acctOpen = false;
          APP.confirmBox({ title: 'Change password', icon: '🔐', text: 'Enter your current password and a new one (8+ characters).',
            extra: '<input class="field au__old" type="password" autocomplete="current-password" placeholder="Current password" aria-label="Current password" style="margin-top:12px">' +
                   '<input class="field au__new" type="password" autocomplete="new-password" placeholder="New password" aria-label="New password" style="margin-top:8px">',
            ok: 'Change it', read: function (r) { return { o: r.querySelector('.au__old').value, n: r.querySelector('.au__new').value }; } })
          .then(function (v) {
            if (!v) return;
            if (!v.n || v.n.length < 8) return APP.toast('Password not changed', 'The new password needs at least 8 characters.', 'mag', '⚠️');
            be.changePassword(v.o, v.n).then(function () { APP.toast('Password changed', 'Use the new one next time you sign in.', null, '🔐'); })
              .catch(function (e) { APP.toast('Password not changed', friendly(e), 'mag', '⚠️'); });
          });
        }
      });
    });
    root.querySelectorAll('[data-dev]').forEach(function (b) {
      b.addEventListener('click', function () { be.removeDevice(user.uid, b.dataset.dev).catch(function () {}); b.closest('.devs__r').remove(); });
    });
  }

  /* ---------------- chrome: header chip, banner, settings ---------------- */
  function render() {
    var btn = $('#acct-btn');
    if (btn) {
      var st = STATUS[status] || STATUS.error;
      btn.className = 'acct acct--' + st[0];
      if (user) {
        btn.innerHTML = '<span class="acct__av">' + (user.photo ? '<img src="' + esc(user.photo) + '" alt="" referrerpolicy="no-referrer">' : esc(initial(user))) + '</span>' +
          '<span class="acct__n">' + esc(firstName(user)) + '</span><span class="acct__dot"></span>';
        btn.setAttribute('aria-label', 'Your account, ' + firstName(user) + '. ' + st[1]);
        btn.title = st[1];
      } else {
        var signed = !CONFIGURED ? 'Guest' : status === 'connecting' && APP.storeKey() !== APP.GUEST_KEY ? 'Connecting' : 'Sign in';
        btn.innerHTML = '<span class="acct__av acct__av--anon">👤</span><span class="acct__n">' + signed + '</span>' + (CONFIGURED ? '<span class="acct__dot"></span>' : '');
        btn.setAttribute('aria-label', CONFIGURED ? 'Sign in or create an account' : 'Accounts are not set up yet');
        btn.title = st[1];
      }
    }
    var ban = $('#cloud-banner');
    if (ban) {
      var hidden = false;
      try { hidden = Date.now() - (+localStorage.getItem(BANNER_KEY) || 0) < 3 * 86400000; } catch (e) {}
      var show = CONFIGURED && !user && status === 'guest' && !hidden;
      ban.hidden = !show;
      if (show) ban.innerHTML = '<span class="cloud-banner__ic">☁️</span><div class="cloud-banner__t"><b>You are playing as a guest.</b> ' +
        (APP.hasProgress() ? 'Your ' + APP.summarize().logged + ' logged days live only in this browser. ' : '') +
        'Create a free account to keep your season safe and continue on any device.</div>' +
        '<button type="button" class="btn btn--sm btn--go" data-act="signup">Create account</button>' +
        '<button type="button" class="btn btn--sm btn--ghost" data-act="signin">Sign in</button>' +
        '<button type="button" class="cloud-banner__x" data-act="hide" aria-label="Hide for now">✕</button>';
    }
    var card = $('#acct-card');
    if (card) {
      var inner;
      if (!CONFIGURED) {
        inner = '<div class="set-row" style="border:0"><div class="set-row__l"><div class="set-row__t">Account & cloud sync</div>' +
          '<div class="set-row__d">Built in, waiting for a Firebase project. Paste your config into <code>assets/js/firebase-config.js</code> (see SETUP-FIREBASE.md) and players can sign in and continue on any device.</div></div>' +
          '<button class="btn" type="button" data-act="open">How to switch it on</button></div>';
      } else if (!user) {
        inner = '<div class="set-row" style="border:0"><div class="set-row__l"><div class="set-row__t">Account & cloud sync</div>' +
          '<div class="set-row__d">' + (status === 'connecting' ? 'Connecting to your account…' : 'You are a guest. Sign in or create a free account to save your season to the cloud and open it on your phone, tablet or another computer.') + '</div></div>' +
          '<div class="set-acts"><button class="btn btn--go" type="button" data-act="signup">Create account</button><button class="btn" type="button" data-act="signin">Sign in</button></div></div>';
      } else {
        inner = '<div class="set-row__t" style="margin-bottom:10px">Account & cloud sync</div>' +
          '<div class="acc__head acc__head--sm"><div class="acc__av">' + (user.photo ? '<img src="' + esc(user.photo) + '" alt="" referrerpolicy="no-referrer">' : esc(initial(user))) + '</div>' +
          '<div class="acc__id"><b>' + esc(user.name || firstName(user)) + '</b><span>' + esc(user.email) + '</span></div>' +
          '<button class="btn btn--sm" type="button" data-act="open" style="margin-left:auto">Manage account</button></div>' + syncBlock();
      }
      card.innerHTML = inner;
      bindAccountActions(card);
      var where = $('#set-where');
      if (where) where.textContent = user ? 'your account (cloud) + this browser' : where.textContent;
    }
    if (acctOpen && user && $('#modal-body .acc') && !$('#modal').hidden) renderAccount(false);
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('#acct-btn');
    if (b) { open(); return; }
    var h = e.target.closest('#cloud-banner [data-act]');
    if (!h) return;
    if (h.dataset.act === 'hide') { try { localStorage.setItem(BANNER_KEY, String(Date.now())); } catch (er) {} render(); }
    else open(h.dataset.act === 'signup' ? 'up' : 'in');
  });

  window.LAX_CLOUD = { open: open, status: function () { return status; }, user: function () { return user; }, syncNow: function () { return pushNow(); } };
  APP.ready.then(start);
})();
