/* ICE — in-site Google Chat client.
 * Messaging happens over the real Google Chat REST API, but rendered inside the
 * ICE site (no chat.google.com hand-off). All calls use the signed-in user's
 * OAuth token (GIS token client), so a person only ever sees their own DMs.
 *
 * Google Chat has no browser push, so the UI polls messages.list; and there is
 * no "who am I" endpoint, so we read the caller's numeric id from the OpenID
 * userinfo `sub` (which equals the Chat users/{id}) to align sent vs received.
 *
 * Dormant until ICE_CONFIG.CHAT_CLIENT_ID is set and the Cloud project has the
 * Chat API configured (see docs/google-chat-setup.md). */
(function () {
  'use strict';

  var C = window.ICE_CONFIG;
  // chat.spaces  → create + find/list DM spaces (setup, findDirectMessage)
  // chat.messages → create + list messages
  // openid/email → userinfo.sub, to tell my messages from theirs
  var SCOPE = [
    'openid', 'email',
    'https://www.googleapis.com/auth/chat.spaces',
    'https://www.googleapis.com/auth/chat.messages',
  ].join(' ');
  var API = 'https://chat.googleapis.com/v1/';

  var accessToken = null;
  var tokenExpiry = 0;
  var meCache = null;                 // { id, email }
  var dmByEmail = {};                 // email(lower) -> spaceName | 'none' (cached miss)

  function configured() {
    return !!(C.CHAT_CLIENT_ID && window.google && google.accounts && google.accounts.oauth2);
  }

  function connected() {
    return !!(accessToken && Date.now() < tokenExpiry - 60000);
  }

  // ------------------------------------------------------------------ token
  // The consent popup must be spent inside a user gesture, so getAccessToken is
  // only ever called from a click handler (the "Connect" button / pane open).

  // opts.silent = true attempts a no-UI token renewal (prompt: '') — succeeds
  // without a popup when the user has already granted consent and still has an
  // active Google session, so a page refresh doesn't force "Connect" again.
  function getAccessToken(opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      if (connected()) return resolve(accessToken);
      if (!configured()) return reject(new Error('Google Chat is not set up yet — contact the organizers.'));
      var client = google.accounts.oauth2.initTokenClient({
        client_id: C.CHAT_CLIENT_ID,
        scope: SCOPE,
        callback: function (resp) {
          if (resp.error) return reject(new Error(resp.error_description || resp.error));
          accessToken = resp.access_token;
          tokenExpiry = Date.now() + (resp.expires_in || 3600) * 1000;
          resolve(accessToken);
        },
        error_callback: function (err) {
          reject(new Error((err && err.message) || 'Google sign-in was closed'));
        },
      });
      client.requestAccessToken(opts.silent ? { prompt: '' } : {});
    });
  }

  // Silent reconnect: resolves true if a token was obtained without any UI,
  // false otherwise (caller then shows the Connect button). Never rejects.
  function reconnect() {
    if (connected()) return Promise.resolve(true);
    if (!configured()) return Promise.resolve(false);
    return getAccessToken({ silent: true }).then(function () { return true; }, function () { return false; });
  }

  // Low-level authed fetch. On 401 (token expired mid-session) it clears the
  // token so the next call re-prompts. Throws Error(message) on API errors.
  async function call(method, path, body) {
    var token = await getAccessToken();
    var res = await fetch(/^https?:/.test(path) ? path : API + path, {
      method: method,
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) { accessToken = null; tokenExpiry = 0; }
    var data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) {
      var msg = (data && data.error && data.error.message) || ('Chat error ' + res.status);
      var err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return data || {};
  }

  // ------------------------------------------------------------------- identity
  /** The signed-in person's Chat identity: { id, email }. id is the numeric
   *  users/{id} value, read from the OpenID userinfo `sub`. Cached per session
   *  and in localStorage (it never changes for a given account). */
  async function me() {
    if (meCache) return meCache;
    try {
      var stored = JSON.parse(localStorage.getItem('ice.chat.me') || 'null');
      if (stored && stored.id) { meCache = stored; return meCache; }
    } catch (e) { /* ignore */ }
    var info = await call('GET', 'https://openidconnect.googleapis.com/v1/userinfo');
    meCache = { id: String(info.sub || ''), email: String(info.email || '').toLowerCase() };
    try { localStorage.setItem('ice.chat.me', JSON.stringify(meCache)); } catch (e) { /* ignore */ }
    return meCache;
  }

  // -------------------------------------------------------------------- spaces
  /** The existing 1:1 DM space with `email`, or null if none exists yet.
   *  Uses the email alias for users/{user} (allowed for user-auth calls). */
  async function findDm(email) {
    var key = String(email || '').toLowerCase();
    if (!key) return null;
    if (dmByEmail[key]) return dmByEmail[key] === 'none' ? null : dmByEmail[key];
    try {
      var data = await call('GET', 'spaces:findDirectMessage?name=' + encodeURIComponent('users/' + key));
      dmByEmail[key] = data.name || 'none';
      return data.name || null;
    } catch (err) {
      if (err.status === 404) { dmByEmail[key] = 'none'; return null; }
      throw err;
    }
  }

  /** The DM space with `email`, creating it if it doesn't exist. */
  async function ensureDm(email) {
    var existing = await findDm(email);
    if (existing) return existing;
    var key = String(email || '').toLowerCase();
    var data = await call('POST', 'spaces:setup', {
      space: { spaceType: 'DIRECT_MESSAGE' },
      memberships: [{ member: { name: 'users/' + key, type: 'HUMAN' } }],
    });
    if (data.name) dmByEmail[key] = data.name;
    return data.name;
  }

  /** Messages in a space, oldest→newest. `limit` caps how many recent ones.
   *  Returns [{ id, text, senderId, createTime }]. */
  async function listMessages(space, limit) {
    if (!space) return [];
    var data = await call('GET', space + '/messages?pageSize=' + (limit || 50) + '&orderBy=' + encodeURIComponent('createTime desc'));
    var msgs = (data.messages || []).map(function (m) {
      return {
        id: m.name,
        text: m.text || '',
        senderId: (m.sender && String(m.sender.name || '').replace('users/', '')) || '',
        createTime: m.createTime || '',
      };
    });
    msgs.reverse(); // API gave newest-first; render oldest-first
    return msgs;
  }

  /** Latest message in a space (or null) — cheap unread probe. */
  async function latestMessage(space) {
    var msgs = await listMessages(space, 1);
    return msgs.length ? msgs[msgs.length - 1] : null;
  }

  async function sendMessage(space, text) {
    var body = { text: String(text || '') };
    var m = await call('POST', space + '/messages', body);
    return {
      id: m.name,
      text: m.text || '',
      senderId: (m.sender && String(m.sender.name || '').replace('users/', '')) || '',
      createTime: m.createTime || '',
    };
  }

  window.IceChat = {
    configured: configured,
    connected: connected,
    connect: getAccessToken,   // ensure a token from within a gesture
    reconnect: reconnect,      // silent, no-UI token renewal (returns bool)
    me: me,
    findDm: findDm,
    ensureDm: ensureDm,
    listMessages: listMessages,
    latestMessage: latestMessage,
    sendMessage: sendMessage,
  };
})();
