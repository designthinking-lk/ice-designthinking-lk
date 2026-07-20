/* ICE — Google Chat handoff.
 * Messaging happens in real Google Chat between workshop Workspace accounts.
 * "Message" buttons call spaces.setup (creates or returns the 1:1 DM) with a
 * user-granted OAuth token, then open the DM's chat.google.com URL.
 * Dormant until ICE_CONFIG.CHAT_CLIENT_ID is set (see docs/google-chat-setup.md). */
(function () {
  'use strict';

  var C = window.ICE_CONFIG;
  var SCOPE = 'https://www.googleapis.com/auth/chat.spaces.create';
  var accessToken = null;
  var tokenExpiry = 0;

  function configured() {
    return !!(C.CHAT_CLIENT_ID && window.google && google.accounts && google.accounts.oauth2);
  }

  function haveToken() {
    return !!(accessToken && Date.now() < tokenExpiry - 60000);
  }

  function getAccessToken() {
    return new Promise(function (resolve, reject) {
      if (haveToken()) return resolve(accessToken);
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
          reject(new Error(err.message || 'Google sign-in was closed'));
        },
      });
      client.requestAccessToken();
    });
  }

  async function setupDm(email) {
    var token = await getAccessToken();
    var res = await fetch('https://chat.googleapis.com/v1/spaces:setup', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        space: { spaceType: 'DIRECT_MESSAGE' },
        memberships: [{ member: { name: 'users/' + email, type: 'HUMAN' } }],
      }),
    });
    var data = await res.json();
    if (data.error) throw new Error(data.error.message || 'Could not open the conversation');
    return data.spaceUri || 'https://chat.google.com';
  }

  /**
   * Open (creating if needed) the 1:1 Google Chat DM with `email`.
   * Resolves to { opened, uri }:
   *  - opened:true  → a new tab was navigated to the DM (nothing more to do).
   *  - opened:false → the browser wouldn't let us open a tab from here; `uri`
   *    is the DM link so the caller can offer a one-click open that blends
   *    into our own UI.
   *
   * The single-popup-per-gesture budget is the crux: Google's consent flow
   * needs a popup the first time. So we only pre-open the destination tab when
   * we already hold a token (no consent popup to compete with); otherwise we
   * spend the gesture on consent and hand the link back for a real click.
   */
  async function openDm(email) {
    if (!configured()) throw new Error('Google Chat is not set up yet — contact the organizers.');
    if (haveToken()) {
      // Fast path: no consent popup needed, so pre-open the tab synchronously
      // (survives the later awaits) and navigate it once the DM is ready.
      var win = window.open('about:blank', '_blank');
      try {
        var uri = await setupDm(email);
        if (win) { win.location = uri; return { opened: true, uri: uri }; }
        return { opened: false, uri: uri }; // pop-up blocker ate the tab
      } catch (err) {
        if (win) win.close();
        throw err;
      }
    }
    // First use this session: consent popup spends the gesture, so we can't
    // also open a tab here — return the link for the caller to open on a click.
    var uri2 = await setupDm(email);
    return { opened: false, uri: uri2 };
  }

  window.IceChat = { openDm: openDm, configured: configured };
})();
