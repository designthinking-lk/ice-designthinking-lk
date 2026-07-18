/* ICE — single-file application: hash router + views.
 * No framework: template strings + event delegation.
 * Multi-project: A.getProject() names the active project; per-project
 * branding arrives in bootstrap (state.data.project) and every project-scoped
 * localStorage key carries the project slug. */
(function () {
  'use strict';

  var C = window.ICE_CONFIG;
  var A = window.IceApi;

  var state = {
    data: null,       // bootstrap payload
    loaded: false,    // fresh data arrived
    q: '',            // directory search
    roleFilter: 'all',
    skillFilter: null,
    teamFilter: null, // active team highlight on the People hive (team id or null)
  };

  // ------------------------------------------------------------- utilities

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
  }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function timeAgo(iso) {
    var d = new Date(iso); if (isNaN(d)) return '';
    var s = (Date.now() - d.getTime()) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 7 * 86400) return Math.floor(s / 86400) + 'd ago';
    return fmtDate(iso);
  }

  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2)
      .map(function (w) { return w.charAt(0).toUpperCase(); }).join('');
  }

  function avatar(user, cls) {
    cls = 'avatar ' + (cls || '');
    if (user && user.image) {
      return '<img class="' + cls + '" src="' + esc(user.image) + '" alt="" loading="lazy" ' +
             'onerror="this.outerHTML=window.__avFallback(' + esc(JSON.stringify(initials(user.name))) + ',' + JSON.stringify(cls) + ')">';
    }
    return window.__avFallback(initials(user && user.name), cls);
  }
  window.__avFallback = function (init, cls) {
    return '<span class="' + esc(cls) + ' avatar-fallback">' + esc(init || '?') + '</span>';
  };

  function toast(msg, isError) {
    var t = $('#toast');
    t.className = 'toast' + (isError ? ' error' : '');
    t.innerHTML = '<i class="fa-solid ' + (isError ? 'fa-circle-exclamation' : 'fa-circle-check') + '"></i>' + esc(msg);
    t.hidden = false;
    clearTimeout(t.__timer);
    t.__timer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  function modal(html) {
    var root = $('#modalRoot');
    root.innerHTML = '<div class="modal-backdrop" data-action="close-modal"><div class="modal" onclick="event.stopPropagation()">' + html + '</div></div>';
  }
  function closeModal() { $('#modalRoot').innerHTML = ''; }

  function busy(btn, on) {
    if (!btn) return;
    btn.classList.toggle('loading', !!on);
    btn.disabled = !!on;
  }

  function me() { return state.data && state.data.me; }
  function signedIn() { return !!A.getToken(); }

  // ---- day / night theme ----
  // data-theme on <html> (also set pre-paint by an inline snippet in
  // index.html); persisted as ice.theme.
  function applyTheme(dark) {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    var btn = $('#themeToggle');
    if (btn) {
      btn.innerHTML = '<i class="fa-solid ' + (dark ? 'fa-sun' : 'fa-moon') + '"></i>';
      btn.title = dark ? 'Day mode' : 'Night mode';
    }
  }
  function isDark() { return document.documentElement.getAttribute('data-theme') === 'dark'; }

  // Per-project branding from bootstrap; config values are only the
  // pre-bootstrap fallback shown before the first payload arrives.
  function proj() { return (state.data && state.data.project) || {}; }
  function eventName() { return proj().name || C.EVENT_NAME; }
  function eventTagline() { return proj().tagline || C.EVENT_TAGLINE; }
  function siteUrl() { return proj().siteUrl || location.host; }
  // "ICE2026" renders as ICE + emphasised year wherever the brand is shown.
  function brandHtml(bold) {
    var m = String(eventName()).match(/^([A-Za-z]+)(\d+)$/);
    var tagOpen = bold ? '<b>' : '<span class="brand-year">';
    var tagClose = bold ? '</b>' : '</span>';
    return m ? esc(m[1]) + tagOpen + esc(m[2]) + tagClose : esc(eventName());
  }
  function isMentor() { var m = me(); return !!(m && m.role === 'mentor'); }
  // Mentors and admins may post announcements.
  function canAnnounce() { return !!(state.data && (state.data.isAdmin || isMentor())); }

  function userById(id) {
    var users = (state.data && state.data.users) || [];
    for (var i = 0; i < users.length; i++) if (users[i].id === id) return users[i];
    return null;
  }

  // --------------------------------------------------------------- data

  async function refresh() {
    try {
      var data = await A.api('bootstrap');
      state.data = data;
      state.loaded = true;
      A.writeCache(data);
      renderChrome();
      route(); // re-render current view with fresh data
    } catch (err) {
      // A stale/deleted project selection must not brick the app — fall back
      // to the default project once.
      if (err.code === 'unknown_project' && A.getProject() !== C.DEFAULT_PROJECT) {
        A.setProject(C.DEFAULT_PROJECT);
        state.data = A.readCache();
        return refresh();
      }
      if (!state.data) {
        $('#view').innerHTML = '<div class="empty"><i class="fa-solid fa-plug-circle-xmark"></i>' +
          'Could not reach the ' + esc(eventName()) + ' server.<br>' + esc(err.message || '') +
          '<br><br><button class="btn btn-outline" onclick="location.reload()">Retry</button></div>';
      } else {
        toast('Could not refresh data: ' + (err.message || 'network error'), true);
      }
    }
  }

  // --------------------------------------------------------------- chrome

  function renderChrome() {
    var d = state.data || {};
    // Sidebar brand follows the active project's name.
    var brandName = $('.brand-name');
    if (brandName) brandName.innerHTML = brandHtml(false);
    renderProjectSwitcher(d);
    var actions = $('#topbarActions');
    // People & Projects are public; Tools needs sign-in; Admin only for admins.
    var loggedIn = signedIn();
    var navTools = $('#navTools');
    var navAdmin = $('#navAdmin');
    if (navTools) navTools.hidden = !loggedIn;
    if (navAdmin) navAdmin.hidden = !d.isAdmin;
    if (signedIn() && d.me) {
      actions.innerHTML =
        '<button class="avatar-circle-btn" data-action="user-menu" aria-label="Account" title="' + esc(d.me.name) + '">' +
        avatar(d.me, 'avatar-sm') + '</button>';
    } else if (signedIn()) {
      actions.innerHTML =
        '<a class="btn btn-gradient btn-sm" href="#/register"><i class="fa-regular fa-id-card"></i>Complete registration</a>' +
        '<button class="avatar-circle-btn" data-action="guest-menu" aria-label="Account" title="Account">' +
        '<span class="avatar-guest"><i class="fa-solid fa-user"></i></span></button>';
    } else {
      actions.innerHTML = '<button class="btn btn-primary btn-sm" data-action="sign-in"><i class="fa-brands fa-google"></i>Sign in</button>';
    }
    // chat & broadcasts pane — for registered participants (DMs need a
    // workshop account). Hide the sidebar button + force-close otherwise.
    var chatBtn = $('#navChatBtn');
    var showChat = signedIn() && !!d.me;
    if (chatBtn) chatBtn.hidden = !showChat;
    if (!showChat) {
      var pane = $('#chatpane');
      if (pane && !pane.hidden) { pane.hidden = true; document.body.classList.remove('chat-open'); }
    } else {
      renderChatPane();
      if (localStorage.getItem(chatKey()) === 'open' && $('#chatpane') && $('#chatpane').hidden) {
        $('#chatpane').hidden = false;
        document.body.classList.add('chat-open');
      }
    }
    // team filter chips live in the app bar, on the People view only
    var isHome = /^#\/?$/.test(location.hash || '#/');
    var tb = $('#topbarTeams');
    if (tb) {
      var chips = isHome ? teamChipsHtml() + topbarLegendHtml() : '';
      if (tb.innerHTML !== chips) tb.innerHTML = chips;
    }
    // on People, the hive goes full-bleed over the rail (letters above the
    // half octagon; the I's cavity hosts the nav)
    document.body.classList.toggle('hive-full', isHome);
    // active nav
    var hash = location.hash || '#/';
    $all('#nav a').forEach(function (a) {
      var key = a.getAttribute('data-nav');
      var on = (key === 'home' && (hash === '#/' || hash.indexOf('#/profile') === 0 || hash === '#')) ||
               (key !== 'home' && hash.indexOf('#/' + key) === 0) ||
               (key === 'teams' && hash.indexOf('#/team/') === 0);
      a.classList.toggle('active', !!on);
    });
  }

  // Project switcher — a <select> between the brand and the nav. Hidden until
  // bootstrap lists more than one visible project. Switching swaps in the
  // target project's cached bootstrap (per-project cache keys — no
  // bleed-through) and refreshes.
  function renderProjectSwitcher(d) {
    var box = $('#projectSwitcher');
    if (!box) return;
    var projects = d.projects || [];
    var current = A.getProject();
    if (projects.length < 2) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = '<select class="project-select" data-action="switch-project" aria-label="Switch project">' +
      projects.map(function (p) {
        return '<option value="' + esc(p.id) + '"' + (p.id === current ? ' selected' : '') + '>' +
          esc(p.name) + (p.status === 'test' ? ' (test)' : p.status === 'archived' ? ' (archived)' : '') + '</option>';
      }).join('') + '</select>';
  }

  function switchProject(id) {
    if (!id || id === A.getProject()) return;
    A.setProject(id);
    teamDetailCache = {};
    state.data = A.readCache(); // instant if this project was loaded before
    state.loaded = false;
    state.q = ''; state.roleFilter = 'all'; state.skillFilter = null; state.teamFilter = null;
    adminProjects = null;
    renderChrome();
    route();
    refresh();
  }

  // Small dropdown anchored under the avatar button (not a full-screen modal).
  function openMenu(kind) {
    var pop = $('#menuPop');
    if (!pop) return;
    if (!pop.hidden && pop.getAttribute('data-kind') === kind) { closeMenu(); return; }
    var d = state.data || {};
    var items;
    if (kind === 'user' && d.me) {
      items =
        '<div class="menu-head">' + esc(d.me.name) + '</div>' +
        '<a class="menu-item" href="#/profile/' + esc(d.me.id) + '" data-action="menu-nav"><i class="fa-regular fa-user"></i>My profile</a>' +
        '<a class="menu-item" href="#/me" data-action="menu-nav"><i class="fa-solid fa-pen"></i>Edit profile</a>' +
        (d.isAdmin ? '<a class="menu-item" href="#/admin" data-action="menu-nav"><i class="fa-solid fa-shield-halved"></i>Admin</a>' : '') +
        '<div class="menu-sep"></div>' +
        '<button class="menu-item danger" data-action="sign-out"><i class="fa-solid fa-arrow-right-from-bracket"></i>Sign out</button>';
    } else {
      // Signed in but not registered — the "Complete registration" CTA already
      // lives in the topbar, so the menu only needs sign-out.
      items = '<button class="menu-item danger" data-action="sign-out"><i class="fa-solid fa-arrow-right-from-bracket"></i>Sign out</button>';
    }
    pop.innerHTML = items;
    pop.setAttribute('data-kind', kind);
    pop.hidden = false;
  }
  function closeMenu() {
    var pop = $('#menuPop');
    if (pop) { pop.hidden = true; pop.removeAttribute('data-kind'); }
  }

  // ------------------------------------------------------------- chat pane
  // Toggleable right rail listing everyone who has a workshop @designthinking.lk
  // account; clicking opens the 1:1 Google Chat DM (js/chat.js).

  function chatKey() { return 'ice.chat.' + A.getProject(); }

  function workEmailOf(u) {
    var w = u && u.workEmail;
    return (w && /@designthinking\.lk$/i.test(w)) ? w : '';
  }

  function chatPaneList() {
    var users = (state.data && state.data.users) || [];
    var mine = me();
    var list = users.filter(function (u) {
      return workEmailOf(u) && (!mine || u.id !== mine.id);
    }).sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
    if (!list.length) {
      return '<div class="chatpane-empty"><i class="fa-regular fa-comment-dots"></i>' +
        '<span>No workshop accounts yet.<br>People appear here once they register.</span></div>';
    }
    return list.map(function (u) {
      return '<button class="chat-row" data-action="chat-dm" data-email="' + esc(workEmailOf(u)) + '" title="Message ' + esc(u.name) + '">' +
        avatar(u, 'avatar-sm') +
        '<span class="chat-row-info"><span class="chat-row-name">' + esc(u.name) +
        (u.role === 'mentor' ? ' <i class="fa-solid fa-star chat-row-star" title="Mentor"></i>' : '') + '</span>' +
        (u.affiliation ? '<span class="chat-row-sub">' + esc(u.affiliation) + '</span>' : '') + '</span>' +
        '<i class="fa-regular fa-paper-plane chat-row-go"></i></button>';
    }).join('');
  }

  // Which tab of the comm pane is showing: 'chat' (1:1 DMs via Google Chat)
  // or 'broadcast' (announcements to everyone).
  var commTab = 'chat';

  function broadcastList() {
    var anns = ((state.data && state.data.announcements) || []).slice()
      .filter(function (a) { return a.isPublished; })
      .sort(function (a, b) {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        return a.createdAt < b.createdAt ? 1 : -1;
      });
    if (!anns.length) {
      return '<div class="chatpane-empty"><i class="fa-solid fa-bullhorn"></i>' +
        '<span>No broadcasts yet.<br>Messages to everyone appear here.</span></div>';
    }
    return anns.map(function (a) {
      var author = userById(a.authorId);
      return '<div class="bcast">' +
        '<div class="bcast-head"><span>' + (author ? esc(author.name) : 'Organizers') + '</span>' +
        '<span class="bcast-when">' + esc(timeAgo(a.createdAt)) + '</span></div>' +
        '<div class="bcast-title">' + (a.isPinned ? '<i class="fa-solid fa-thumbtack"></i> ' : '') + esc(a.title) + '</div>' +
        (a.content !== a.title ? '<p class="bcast-body">' + esc(a.content) + '</p>' : '') +
        '</div>';
    }).join('');
  }

  function renderChatPane() {
    var body = $('#chatpaneBody');
    if (!body) return;
    $all('.comm-tab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-tab') === commTab);
    });
    var foot = $('#commFoot');
    // preserve a broadcast draft across re-renders (refresh() redraws chrome)
    var draftEl = $('#bcastInput');
    var draft = draftEl ? draftEl.value : '';
    if (commTab === 'chat') {
      body.innerHTML = chatPaneList();
      if (foot) {
        foot.innerHTML = '<a class="chatpane-foot-link" href="https://chat.google.com" target="_blank" rel="noopener">' +
          'Open Google Chat <i class="fa-solid fa-arrow-up-right-from-square"></i></a>';
      }
    } else {
      body.innerHTML = broadcastList();
      if (foot) {
        foot.innerHTML = canAnnounce()
          ? '<div class="bcast-compose"><textarea class="input" id="bcastInput" rows="2" placeholder="Broadcast to everyone…"></textarea>' +
            '<button class="btn btn-gradient btn-sm" data-action="bcast-send" title="Send to everyone"><span class="label"><i class="fa-regular fa-paper-plane"></i></span><span class="spin"></span></button></div>'
          : '<div class="bcast-note">Broadcasts come from mentors &amp; organizers.</div>';
        var bi = $('#bcastInput');
        if (bi && draft) bi.value = draft;
      }
    }
  }

  function setChatPane(open) {
    var pane = $('#chatpane');
    if (!pane) return;
    pane.hidden = !open;
    document.body.classList.toggle('chat-open', open);
    localStorage.setItem(chatKey(), open ? 'open' : 'closed');
    if (open) renderChatPane();
  }

  // ---------------------------------------------------------------- views

  function skillChip(s, on, actionable) {
    return '<span class="chip' + (on ? ' on' : '') + (actionable === false ? ' static' : '') + '"' +
      (actionable === false ? '' : ' data-action="filter-skill" data-skill="' + esc(s) + '"') + '>' + esc(s) + '</span>';
  }

  function personCard(u) {
    var isMentor = u.role === 'mentor';
    var skills = (u.skills || []).slice(0, 3).map(function (s) { return skillChip(s, false, false); }).join('');
    var more = (u.skills || []).length > 3 ? '<span class="more">+' + ((u.skills || []).length - 3) + ' more</span>' : '';
    return '<a class="card person' + (isMentor ? ' mentor' : '') + '" href="#/profile/' + esc(u.id) + '">' +
      '<div class="person-top">' + avatar(u) +
      '<div><div class="person-name">' + esc(u.name) +
      (isMentor ? '<span class="role-tag mentor"><i class="fa-solid fa-star"></i>Mentor</span>' : '') +
      (u.role === 'admin' ? '<span class="role-tag admin"><i class="fa-solid fa-shield-halved"></i>Organizer</span>' : '') +
      '</div>' +
      (u.affiliation ? '<div class="person-affil">' + esc(u.affiliation) + '</div>' : '') +
      '</div></div>' +
      (u.bio ? '<div class="person-bio">' + esc(u.bio) + '</div>' : '') +
      (u.expertise ? '<div class="person-expertise">' + esc(u.expertise) + '</div>' : '') +
      '<div class="skills">' + skills + more + '</div></a>';
  }

  // People view — every participant & mentor rendered as an octagon tile,
  // arranged to spell the ICE wordmark. Greyscale + duotone tint by role
  // (mentors purple, participants cyan). Hovering a face dims the rest and
  // shows a large preview in the hollow of the C. Clicking opens the profile.

  var WORD_LETTERS = [
    ['11111', '00100', '00100', '00100', '00100', '00100', '11111'], // I
    ['11111', '10000', '10000', '10000', '10000', '10000', '11111'], // C
    ['11111', '10000', '10000', '11110', '10000', '10000', '11111'], // E
  ];
  var WORD_GAP = 1.4; // empty columns between letters

  // Build the ordered list of cells (grid col/row) plus the C-hollow centroid.
  function wordCells() {
    var cells = [], origins = [], cursor = 0;
    WORD_LETTERS.forEach(function (L, li) {
      origins.push(cursor);
      var cols = L[0].length;
      for (var r = 0; r < L.length; r++) {
        for (var c = 0; c < cols; c++) {
          if (L[r][c] === '1') cells.push({ r: r, c: cursor + c, letter: li });
        }
      }
      cursor += cols + WORD_GAP;
    });
    var Cl = WORD_LETTERS[1], Co = origins[1], sc = 0, sr = 0, n = 0;
    for (var rr = 0; rr < Cl.length; rr++) {
      for (var cc = 0; cc < Cl[0].length; cc++) {
        if (Cl[rr][cc] === '0') { sc += Co + cc; sr += rr; n++; }
      }
    }
    return { cells: cells, hollow: { col: sc / n, row: sr / n } };
  }

  // Team list for the filter chips — one per team, sorted by name; before any
  // teams exist, a Team A–F scaffold keeps the filter visible and interactive.
  function homeTeams() {
    var teams = ((state.data && state.data.teams) || []).slice()
      .sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
    if (!teams.length) {
      teams = ['A', 'B', 'C', 'D', 'E', 'F'].map(function (l) {
        return { id: 'demo-team-' + l, name: 'Team ' + l, members: [], demo: true };
      });
    }
    return teams;
  }

  // Team filter chips — rendered into the app bar (renderChrome), People view only.
  function teamChipsHtml() {
    if (!state.data) return '';
    var teams = homeTeams();
    if (state.teamFilter && !teams.some(function (t) { return t.id === state.teamFilter; })) {
      state.teamFilter = null; // team went away
    }
    // chain stack: later chips tuck under earlier ones (descending z-index),
    // only their tail letter visible. Chips after the first hide their "Team"
    // prefix via an invisible span — size and letter placement stay identical.
    return '<div class="hive-teams" id="hiveTeams">' +
      teams.map(function (t, i) {
        var name = String(t.name || '');
        var cut = name.lastIndexOf(' ') + 1;
        var label = (i === 0 || !cut)
          ? esc(name)
          : '<span class="tc-ghost">' + esc(name.slice(0, cut)) + '</span>' + esc(name.slice(cut));
        return '<button class="team-chip' + (t.id === state.teamFilter ? ' on' : '') + (t.demo ? ' demo' : '') + '" type="button" ' +
          'style="z-index:' + (teams.length - i) + '" ' +
          'data-action="filter-team" data-team="' + esc(t.id) + '" data-name="' + esc(t.name) + '">' + label + '</button>';
      }).join('') + '</div>';
  }

  // mentors/participants counts — shown beside the team chain in the app bar
  function topbarLegendHtml() {
    var users = (state.data && state.data.users) || [];
    var mentors = users.filter(function (u) { return u.role === 'mentor'; }).length;
    var participants = users.length - mentors;
    return '<div class="topbar-legend">' +
      '<span><span class="dot mentor"></span>' + mentors + ' mentor' + (mentors === 1 ? '' : 's') + '</span>' +
      '<span><span class="dot participant"></span>' + participants + ' participant' + (participants === 1 ? '' : 's') + '</span>' +
      '</div>';
  }

  function viewHome() {
    var d = state.data;
    if (!d) return skeletons();
    var activeTeam = null;
    homeTeams().forEach(function (x) { if (x.id === state.teamFilter) activeTeam = x; });
    if (state.teamFilter && !activeTeam) state.teamFilter = null;
    // legend lives in the app bar beside the team chain; caption inside the
    // preview octagon (buildWordmark)
    return '<div class="hive">' +
      '<div class="hive-stage" id="hiveStage"><div class="word" id="word"></div></div>' +
      '</div>';
  }

  function hiveCaptionText(users, team) {
    if (team) return 'Showing ' + esc(team.name) + ' — tap the chip again to clear';
    return users.length ? 'Hover a face to preview' : 'Waiting for people to join — slots fill as they register';
  }

  // The whole ICE wordmark always renders. Cells with no assigned user yet are
  // placeholder octagons; joining users are assigned round-robin across I/C/E so
  // early joiners scatter across the letters instead of clustering in one.
  function slotOrder(cells) {
    var groups = [[], [], []];
    cells.forEach(function (cell, idx) { groups[cell.letter].push(idx); });
    var order = [], maxLen = Math.max(groups[0].length, groups[1].length, groups[2].length);
    for (var rk = 0; rk < maxLen; rk++) {
      for (var li = 0; li < 3; li++) if (groups[li][rk] !== undefined) order.push(groups[li][rk]);
    }
    return order;
  }

  // Populate the wordmark tiles from live users, then size to fit (no scroll).
  function buildWordmark() {
    var word = $('#word');
    if (!word) return;
    var users = (state.data && state.data.users) || [];
    var built = wordCells();
    var cells = built.cells;
    var w = 74, minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    cells.forEach(function (cell) {
      cell.x = cell.c * w; cell.y = cell.r * w;
      minX = Math.min(minX, cell.x); maxX = Math.max(maxX, cell.x + w);
      minY = Math.min(minY, cell.y); maxY = Math.max(maxY, cell.y + w);
    });
    // Natural (unscaled) dimensions; fitWordmark scales from these and sets the
    // layout box to the scaled size so flexbox can centre it at any width.
    word.__w = maxX - minX;
    word.__h = maxY - minY;
    word.innerHTML = '';

    // map each assigned user onto a spread-out cell
    var order = slotOrder(cells), cellUser = {};
    for (var k = 0; k < users.length && k < order.length; k++) cellUser[order[k]] = users[k];

    cells.forEach(function (cell, i) {
      var u = cellUser[i];
      var el;
      if (u) {
        var mentor = u.role === 'mentor';
        var online = ((state.data && state.data.online) || []).indexOf(u.id) !== -1;
        el = document.createElement('a');
        el.className = 'oct ' + (mentor ? 'm' : 'p');
        el.href = '#/profile/' + u.id;
        el.title = u.name + (online ? ' — online' : '');
        el.setAttribute('data-uid', u.id);
        el.innerHTML = '<div class="oct-in">' +
          (u.image ? '<img src="' + esc(u.image) + '" alt="" loading="lazy">' : '<span class="oct-blank">' + esc(initials(u.name)) + '</span>') +
          '</div>' +
          (online ? '<span class="oct-online" title="Online"></span>' : '');
        el.addEventListener('mouseenter', function () { showHivePreview(u, mentor, el); });
        el.addEventListener('mouseleave', hideHivePreview);
      } else {
        el = document.createElement('div');
        el.className = 'oct empty';
        el.innerHTML = '<div class="oct-in"><span class="oct-slot"><i class="fa-solid fa-user"></i></span></div>';
      }
      el.style.width = w + 'px'; el.style.height = w + 'px';
      el.style.left = (cell.x - minX) + 'px';
      el.style.top = (cell.y - minY) + 'px';
      word.appendChild(el);
    });

    // preview parked in the C's hollow (regular octagon)
    var pw = w * 2.9, ph = pw;
    var preview = document.createElement('div');
    preview.className = 'oct-preview';
    preview.style.width = pw + 'px'; preview.style.height = ph + 'px';
    preview.style.left = ((built.hollow.col + 0.5) * w - minX - pw / 2) + 'px';
    preview.style.top = ((built.hollow.row + 0.5) * w - minY - ph / 2) + 'px';
    // the caption sits inside the empty preview octagon (the C's cavity);
    // it fades out when a hovered member's photo fills the slot
    var activeTeam = null;
    ((state.data && state.data.teams) || []).forEach(function (x) { if (x.id === state.teamFilter) activeTeam = x; });
    preview.innerHTML = '<span class="hive-caption">' + hiveCaptionText(users, activeTeam) + '</span>' +
      '<div class="oct-pin"><img id="hivePvImg" alt="">' +
      '<span class="oct-pvname"><span id="hivePvNm"></span><span class="oct-pvrole" id="hivePvRole"></span></span></div>';
    word.appendChild(preview);
    word.__preview = preview;

    fitWordmark();
    applyTeamFilter(); // re-assert an active team highlight after any rebuild
  }

  // Spotlight the octagons of the currently-filtered team (state.teamFilter),
  // dimming everyone else. No-op when no team is selected. Called on rebuilds
  // and on chip toggles so no full re-render is needed.
  function applyTeamFilter() {
    var word = $('#word');
    if (!word) return;
    var team = null;
    ((state.data && state.data.teams) || []).forEach(function (x) { if (x.id === state.teamFilter) team = x; });
    var members = {};
    if (team) (team.members || []).forEach(function (mid) { members[mid] = 1; });
    word.classList.toggle('teamfocus', !!team);
    $all('.oct[data-uid]', word).forEach(function (el) {
      el.classList.toggle('team-member', !!members[el.getAttribute('data-uid')]);
    });
  }

  function showHivePreview(u, mentor, el) {
    var word = $('#word'); if (!word) return;
    word.classList.add('focus');
    if (word.__active) word.__active.classList.remove('active');
    el.classList.add('active'); word.__active = el;
    var img = $('#hivePvImg'), nm = $('#hivePvNm'), role = $('#hivePvRole');
    if (img) img.src = u.image || '';
    if (nm) nm.textContent = u.name;
    if (role) role.textContent = mentor ? 'Mentor' : 'Participant';
    var p = word.__preview;
    if (p) { p.classList.remove('m', 'p'); p.classList.add(mentor ? 'm' : 'p', 'on'); }
  }
  function hideHivePreview() {
    var word = $('#word'); if (!word) return;
    word.classList.remove('focus');
    if (word.__active) { word.__active.classList.remove('active'); word.__active = null; }
    if (word.__preview) word.__preview.classList.remove('on');
  }

  // Scale the whole wordmark so it fits the stage with no scrolling.
  function fitWordmark() {
    var stage = $('#hiveStage'), word = $('#word');
    if (!stage || !word || !word.__w) return;
    var ww = word.__w, wh = word.__h;
    var pad = 24; // tight padding — the fixed sidebar shouldn't shrink the ICE
    var s = Math.min((stage.clientWidth - pad) / ww, (stage.clientHeight - pad) / wh, 1.5);
    if (!(s > 0) || !isFinite(s)) return;
    // Scale from the top-left and shrink the layout box to the scaled size, so the
    // flexbox-centred stage keeps equal margins whether the sidebar is open or not.
    word.style.transformOrigin = 'top left';
    word.style.transform = 'scale(' + s + ')';
    word.style.width = (ww * s) + 'px';
    word.style.height = (wh * s) + 'px';
  }

  function skeletons() {
    return '<div class="grid grid-people" style="margin-top:40px">' +
      new Array(8).join('<div class="skeleton"></div>') + '</div>';
  }

  function viewProfile(id) {
    var u = userById(id);
    if (!u) return state.loaded
      ? '<div class="empty"><i class="fa-regular fa-user"></i>Profile not found.</div>'
      : skeletons();
    var isMe = me() && me().id === id;
    var links = (u.links || []).map(function (l) {
      return '<li><i class="fa-solid fa-link"></i><a href="' + esc(l) + '" target="_blank" rel="noopener">' + esc(l.replace(/^https?:\/\//, '')) + '</a></li>';
    }).join('');
    var myTeams = (state.data.teams || []).filter(function (t) { return (t.members || []).indexOf(u.id) !== -1; });

    return '<div class="page-head">' + avatar(u, 'avatar-lg') +
      '<div class="info"><h1>' + esc(u.name) + '</h1>' +
      '<div class="person-name">' +
      (u.role === 'mentor' ? '<span class="role-tag mentor"><i class="fa-solid fa-star"></i>Mentor</span>' : '') +
      (u.role === 'admin' ? '<span class="role-tag admin"><i class="fa-solid fa-shield-halved"></i>Organizer</span>' : '') + '</div>' +
      '<div class="meta-row">' +
      (u.affiliation ? '<span><i class="fa-solid fa-building"></i>' + esc(u.affiliation) + '</span>' : '') +
      (u.email ? '<span><i class="fa-regular fa-envelope"></i>' + esc(u.email) + '</span>' : '') +
      '</div>' +
      '<div>' +
      (isMe ? '<a class="btn btn-outline btn-sm" href="#/me"><i class="fa-solid fa-pen"></i>Edit profile</a>'
            : (signedIn() && me() ? '<button class="btn btn-primary btn-sm" data-action="chat-dm" data-email="' + esc(u.workEmail || u.email || '') + '"><i class="fa-regular fa-message"></i><span class="label">Message</span><span class="spin"></span></button>'
                                  : '<button class="btn btn-primary btn-sm" data-action="sign-in"><i class="fa-brands fa-google"></i>Sign in to message</button>')) +
      (u.video ? ' <a class="btn btn-ghost btn-sm" href="' + esc(u.video) + '" target="_blank" rel="noopener"><i class="fa-solid fa-video"></i>Intro video</a>' : '') +
      '</div></div></div>' +
      '<div class="detail-grid"><div>' +
      (u.bio ? '<div class="panel" style="margin-bottom:20px"><h3><i class="fa-regular fa-id-badge"></i>About</h3><p style="white-space:pre-wrap;color:var(--text-body);margin:0">' + esc(u.bio) + '</p></div>' : '') +
      (u.expertise ? '<div class="panel"><h3><i class="fa-solid fa-lightbulb"></i>Expertise</h3><p style="color:var(--text-body);margin:0">' + esc(u.expertise) + '</p></div>' : '') +
      '</div><div>' +
      ((u.skills || []).length ? '<div class="panel" style="margin-bottom:20px"><h3><i class="fa-solid fa-wand-magic-sparkles"></i>Skills</h3><div class="skills">' +
        u.skills.map(function (s) { return skillChip(s); }).join('') + '</div></div>' : '') +
      (links ? '<div class="panel" style="margin-bottom:20px"><h3><i class="fa-solid fa-link"></i>Links</h3><ul class="link-list">' + links + '</ul></div>' : '') +
      (myTeams.length ? '<div class="panel"><h3><i class="fa-solid fa-people-group"></i>Teams</h3><ul class="link-list">' +
        myTeams.map(function (t) { return '<li><i class="fa-solid fa-people-group"></i><a href="#/team/' + esc(t.id) + '">' + esc(t.name) + '</a></li>'; }).join('') + '</ul></div>' : '') +
      '</div></div>';
  }

  // ------------------------------------------------------------- teams

  function teamCard(t) {
    var members = (t.members || []).map(userById).filter(Boolean);
    var stack = members.slice(0, 5).map(function (m) { return avatar(m, 'avatar-sm'); }).join('');
    return '<a class="card team-card" href="#/team/' + esc(t.id) + '">' +
      '<div class="team-cover">' + (t.coverImage ? '<img src="' + esc(t.coverImage) + '" alt="" loading="lazy">' :
        '<span class="team-initial">' + esc(initials(t.name)) + '</span>') + '</div>' +
      '<div class="team-body"><h3 class="team-name">' + esc(t.name) + '</h3>' +
      (t.description ? '<p class="team-desc">' + esc(t.description) + '</p>' : '') +
      '<div class="team-meta"><span class="member-stack">' + stack + '</span>' +
      '<span>' + members.length + ' member' + (members.length === 1 ? '' : 's') + '</span></div>' +
      '</div></a>';
  }

  function viewTeams() {
    var d = state.data;
    if (!d) return skeletons();
    var teams = (d.teams || []).slice().sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
    var head = '<div class="section-head section-actions">' +
      (me() ? '<button class="btn btn-gradient btn-sm" data-action="new-team"><i class="fa-solid fa-plus"></i>Create team</button>' : '') + '</div>';
    if (!teams.length) {
      return head + '<div class="empty"><i class="fa-solid fa-people-group"></i>No teams yet.' +
        (me() ? '<br><br><button class="btn btn-gradient" data-action="new-team"><i class="fa-solid fa-plus"></i>Create the first team</button>' : ' Sign in to create the first one.') + '</div>';
    }
    return head + '<div class="grid grid-teams">' + teams.map(teamCard).join('') + '</div>';
  }

  var teamDetailCache = {};
  function viewTeam(id) {
    var t = null;
    (state.data && state.data.teams || []).forEach(function (x) { if (x.id === id) t = x; });
    if (!t) return state.loaded ? '<div class="empty"><i class="fa-solid fa-people-group"></i>Team not found.</div>' : skeletons();
    var detail = teamDetailCache[id];
    if (!detail) {
      A.api('team_detail', { teamId: id }).then(function (r) {
        teamDetailCache[id] = r;
        if (location.hash === '#/team/' + id) route();
      }).catch(function () {});
    }
    var members = (t.members || []).map(userById).filter(Boolean);
    var amMember = me() && (t.members || []).indexOf(me().id) !== -1;
    var canManage = me() && (t.creatorId === me().id || state.data.isAdmin);

    var membersHtml = members.map(function (m) {
      return '<li>' + avatar(m, 'avatar-sm') + '<a href="#/profile/' + esc(m.id) + '" style="margin-left:8px">' + esc(m.name) + '</a>' +
        (m.id === t.creatorId ? ' <span class="role-tag admin" style="margin-left:6px">Lead</span>' : '') + '</li>';
    }).join('');

    var linksHtml = detail ? (detail.links || []).map(function (l) {
      return '<li><i class="fa-solid fa-link"></i><div style="flex:1"><a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.title) + '</a>' +
        (l.description ? '<div style="font-size:13px;color:var(--text-muted)">' + esc(l.description) + '</div>' : '') + '</div>' +
        ((me() && (l.createdBy === me().id || canManage)) ? '<button class="btn btn-ghost btn-sm" data-action="del-link" data-id="' + esc(l.id) + '" data-team="' + esc(id) + '" title="Delete"><i class="fa-regular fa-trash-can"></i></button>' : '') +
        '</li>';
    }).join('') : '';

    var postsHtml = detail ? (detail.posts || []).slice().sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; }).map(function (p) {
      var author = userById(p.createdBy) || { name: 'Unknown' };
      return '<div class="feed-item">' + avatar(author, 'avatar-sm') +
        '<div class="body"><span class="who">' + esc(author.name) + '</span><span class="when">' + esc(timeAgo(p.createdAt)) + '</span>' +
        '<p>' + esc(p.content) + '</p></div></div>';
    }).join('') : '<div class="skeleton" style="height:70px"></div>';

    return '<div class="page-head">' +
      '<div class="info"><h1>' + esc(t.name) + '</h1>' +
      '<div class="meta-row"><span><i class="fa-solid fa-user-group"></i>' + members.length + ' members</span>' +
      '<span><i class="fa-regular fa-calendar"></i>Created ' + esc(fmtDate(t.createdAt)) + '</span></div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
      (me() ? (amMember
          ? '<button class="btn btn-outline btn-sm" data-action="leave-team" data-id="' + esc(id) + '"><i class="fa-solid fa-arrow-right-from-bracket"></i><span class="label">Leave team</span><span class="spin"></span></button>'
          : '<button class="btn btn-gradient btn-sm" data-action="join-team" data-id="' + esc(id) + '"><i class="fa-solid fa-plus"></i><span class="label">Join team</span><span class="spin"></span></button>')
        : '<button class="btn btn-primary btn-sm" data-action="sign-in"><i class="fa-brands fa-google"></i>Sign in to join</button>') +
      (canManage ? '<button class="btn btn-outline btn-sm" data-action="edit-team" data-id="' + esc(id) + '"><i class="fa-solid fa-pen"></i>Edit</button>' +
                   '<button class="btn btn-danger btn-sm" data-action="del-team" data-id="' + esc(id) + '"><i class="fa-regular fa-trash-can"></i>Delete</button>' : '') +
      '</div></div></div>' +
      '<div class="detail-grid"><div>' +
      '<div class="panel" style="margin-bottom:20px"><h3><i class="fa-regular fa-file-lines"></i>About</h3>' +
      '<p style="white-space:pre-wrap;color:var(--text-body);margin:0">' + (t.description ? esc(t.description) : '<i>No description yet.</i>') + '</p>' +
      (t.lookingFor ? '<p style="margin:14px 0 0"><b>Looking for:</b> <span style="color:var(--color-accent-dark)">' + esc(t.lookingFor) + '</span></p>' : '') +
      '</div>' +
      '<div class="panel"><h3><i class="fa-regular fa-comments"></i>Team feed</h3>' +
      '<div class="feed">' + (postsHtml || '<p style="color:var(--text-muted)">Nothing posted yet.</p>') + '</div>' +
      (amMember ? '<div class="thread-input" style="margin-top:16px"><textarea class="input" id="postInput" placeholder="Share an update with your team…"></textarea>' +
        '<button class="btn btn-primary" data-action="post-team" data-id="' + esc(id) + '"><span class="label"><i class="fa-regular fa-paper-plane"></i></span><span class="spin"></span></button></div>' : '') +
      '</div></div><div>' +
      '<div class="panel" style="margin-bottom:20px"><h3><i class="fa-solid fa-user-group"></i>Members</h3><ul class="link-list" style="gap:12px">' + membersHtml + '</ul></div>' +
      '<div class="panel"><h3><i class="fa-solid fa-link"></i>Links</h3>' +
      (linksHtml ? '<ul class="link-list">' + linksHtml + '</ul>' : '<p style="color:var(--text-muted);margin:0">No links yet.</p>') +
      (amMember ? '<button class="btn btn-outline btn-sm" style="margin-top:14px" data-action="add-link" data-id="' + esc(id) + '"><i class="fa-solid fa-plus"></i>Add link</button>' : '') +
      '</div></div></div>';
  }

  function teamForm(t) {
    t = t || {};
    modal('<h2>' + (t.id ? 'Edit team' : 'Create a team') + '</h2>' +
      '<form class="form" id="teamForm" data-id="' + esc(t.id || '') + '">' +
      '<div class="field"><label>Team name</label><input class="input" name="name" required maxlength="100" value="' + esc(t.name || '') + '"></div>' +
      '<div class="field"><label>Description</label><textarea class="input" name="description" maxlength="3000">' + esc(t.description || '') + '</textarea></div>' +
      '<div class="field"><label>Looking for <span class="hint">skills or roles you need</span></label><input class="input" name="lookingFor" maxlength="500" value="' + esc(t.lookingFor || '') + '"></div>' +
      '<div class="field"><label>Cover image <span class="hint">optional</span></label>' +
      '<div class="photo-edit"><input type="hidden" name="coverImage" value="' + esc(t.coverImage || '') + '">' +
      '<img id="coverPreview" src="' + esc(t.coverImage || '') + '" alt="" style="height:56px;border-radius:8px;' + (t.coverImage ? '' : 'display:none') + '">' +
      '<button type="button" class="btn btn-outline btn-sm" data-action="pick-image" data-target="coverImage" data-preview="coverPreview"><i class="fa-regular fa-image"></i><span class="label">Upload</span><span class="spin"></span></button></div></div>' +
      '<div class="form-status" id="teamFormStatus"></div>' +
      '<div class="form-actions"><button class="btn btn-gradient" type="submit"><span class="label">' + (t.id ? 'Save changes' : 'Create team') + '</span><span class="spin"></span></button>' +
      '<button class="btn btn-ghost" type="button" data-action="close-modal">Cancel</button></div></form>');
  }

  // ---------------------------------------------------------- announcements

  // Inline drafting card state: open + which announcement is being edited (null = new)
  var annDraft = { open: false, editing: null };

  function viewAnnouncements() {
    var d = state.data;
    if (!d) return skeletons();
    var canPost = canAnnounce();
    var anns = (d.announcements || []).slice().sort(function (a, b) {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      return a.createdAt < b.createdAt ? 1 : -1;
    });
    var head = '<div class="section-head section-actions">' +
      (canPost && !annDraft.open ? '<button class="btn btn-gradient btn-sm" data-action="new-ann"><i class="fa-solid fa-plus"></i>New announcement</button>' : '') + '</div>';
    var draft = (canPost && annDraft.open) ? annDraftCard(annDraft.editing) : '';
    var list = anns.length
      ? anns.map(function (a) { return annCard(a, d); }).join('')
      : (annDraft.open ? '' : '<div class="empty"><i class="fa-solid fa-bullhorn"></i>No announcements yet.</div>');
    return head + draft + list;
  }

  function annCard(a, d) {
    var author = userById(a.authorId);
    var mine = me() && a.authorId === me().id;
    var canEdit = d.isAdmin || mine;
    return '<div class="card ann"><div class="ann-head">' +
      (a.isPinned ? '<span class="ann-pin" title="Pinned"><i class="fa-solid fa-thumbtack"></i></span>' : '') +
      '<h3>' + esc(a.title) + '</h3>' +
      '<span class="ann-type ' + esc(a.type) + '">' + esc(a.type) + '</span>' +
      (!a.isPublished ? '<span class="ann-type draft"><i class="fa-regular fa-pen-to-square"></i> draft</span>' : '') +
      '<span class="ann-date">' + (author ? esc(author.name) + ' · ' : '') + esc(timeAgo(a.createdAt)) + '</span>' +
      (canEdit ? '<span class="ann-actions"><button class="btn btn-ghost btn-sm" data-action="edit-ann" data-id="' + esc(a.id) + '"><i class="fa-solid fa-pen"></i></button>' +
        '<button class="btn btn-ghost btn-sm" data-action="del-ann" data-id="' + esc(a.id) + '"><i class="fa-regular fa-trash-can"></i></button></span>' : '') +
      '</div><p class="ann-body">' + esc(a.content) + '</p></div>';
  }

  // Full-width inline card (no modal) — draft, then Save / Discard / Send.
  function annDraftCard(a) {
    a = a || {};
    var d = state.data || {};
    var editing = !!a.id;
    var author = (me() && me().name) || '';
    return '<div class="card ann-draft">' +
      '<form class="form" id="annForm" data-id="' + esc(a.id || '') + '">' +
      '<div class="ann-draft-head"><h3><i class="fa-solid fa-bullhorn"></i>' + (editing ? 'Edit announcement' : 'New announcement') + '</h3>' +
      (author ? '<span class="ann-draft-author">Posting as ' + esc(author) + '</span>' : '') + '</div>' +
      '<div class="field"><label>Title</label><input class="input" name="title" required maxlength="200" value="' + esc(a.title || '') + '" placeholder="What&#39;s happening?"></div>' +
      '<div class="field"><label>Message</label><textarea class="input" name="content" required maxlength="5000" rows="5" placeholder="Write your announcement…">' + esc(a.content || '') + '</textarea></div>' +
      '<div class="form-row">' +
      '<div class="field"><label>Type</label><select class="input" name="type">' +
      ['general', 'important', 'urgent'].map(function (t) { return '<option' + (a.type === t ? ' selected' : '') + '>' + t + '</option>'; }).join('') +
      '</select></div>' +
      (d.isAdmin ? '<div class="field"><label>Pinned</label><select class="input" name="isPinned"><option value="false">No</option><option value="true"' + (a.isPinned ? ' selected' : '') + '>Yes</option></select></div>' : '') +
      '</div>' +
      '<div class="form-status" id="annFormStatus"></div>' +
      '<div class="form-actions">' +
      '<button class="btn btn-gradient" type="submit"><span class="label"><i class="fa-regular fa-paper-plane"></i> Send</span><span class="spin"></span></button>' +
      '<button class="btn btn-outline" type="button" data-action="save-ann"><span class="label"><i class="fa-regular fa-floppy-disk"></i> Save draft</span><span class="spin"></span></button>' +
      '<button class="btn btn-ghost" type="button" data-action="discard-ann">Discard</button>' +
      '</div></form></div>';
  }

  function openAnnDraft(editing) {
    annDraft = { open: true, editing: editing || null };
    if (location.hash === '#/announcements') route(); else location.hash = '#/announcements';
  }

  async function submitAnn(form, publish, btn) {
    var status = $('#annFormStatus');
    if (status) { status.className = 'form-status'; status.textContent = ''; }
    var fd = new FormData(form);
    var title = String(fd.get('title') || '').trim();
    var content = String(fd.get('content') || '').trim();
    if (!title || !content) { if (status) status.textContent = 'Title and message are required.'; return; }
    busy(btn, true);
    var annId = form.getAttribute('data-id');
    var body = {
      title: title, content: content,
      type: fd.get('type') || 'general',
      isPinned: fd.get('isPinned') === 'true',
      isPublished: publish,
    };
    try {
      annId ? await A.api('ann_update', Object.assign({ id: annId }, body))
            : await A.api('ann_create', body);
      annDraft = { open: false, editing: null };
      await refresh();
      route();
      toast(publish ? 'Announcement sent' : 'Draft saved');
    } catch (err) {
      if (status) status.textContent = err.message || 'Something went wrong.';
      busy(btn, false);
    }
  }

  // ------------------------------------------------------ register / edit

  /** Form select/suggestion options — fetched from the Google Sheet via
   *  bootstrap ("options" tab); config lists are only the offline fallback. */
  function opts(category, fallback) {
    var o = state.data && state.data.options;
    return (o && o[category] && o[category].length) ? o[category] : fallback;
  }
  function formReady() { return !!(state.data && state.data.options); }
  function formLoading() {
    return '<div class="form-loading"><span class="spin"></span>Preparing the form…</div>';
  }

  // ---- photo editor (drag to adjust, scroll/pinch to zoom) ----
  // State model: (cx, cy) = natural-image point at the viewport center,
  // s = displayed px per natural px. Baked to a 512px square on submit.
  var photoEd = null;

  function photoLoad(file) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var vp = $('#photoVp');
      if (!vp) return;
      photoEd = {
        img: img, iw: img.naturalWidth, ih: img.naturalHeight,
        cx: img.naturalWidth / 2, cy: img.naturalHeight / 2, s: 0, minS: 0,
      };
      vp.innerHTML = '<img id="photoImg" src="' + url + '" alt="" draggable="false">' +
        '<button type="button" class="photo-change" data-action="photo-pick" title="Change photo"><i class="fa-solid fa-camera"></i></button>';
      photoEd.minS = vp.clientWidth / Math.min(photoEd.iw, photoEd.ih);
      photoEd.s = photoEd.minS;
      photoPaint();
      wirePhotoGestures(vp);
      updateJoinState(); // a photo now exists — may complete the form
    };
    img.src = url;
  }

  function photoClamp() {
    var vp = $('#photoVp');
    if (!vp || !photoEd) return;
    var V = vp.clientWidth, e = photoEd;
    e.s = Math.max(e.minS, Math.min(e.minS * 8, e.s));
    var half = V / (2 * e.s);
    e.cx = Math.max(half, Math.min(e.iw - half, e.cx));
    e.cy = Math.max(half, Math.min(e.ih - half, e.cy));
  }

  function photoPaint() {
    var vp = $('#photoVp'), img = $('#photoImg');
    if (!vp || !img || !photoEd) return;
    photoClamp();
    var V = vp.clientWidth, e = photoEd;
    img.style.maxWidth = 'none';
    img.style.width = (e.iw * e.s) + 'px';
    img.style.left = (V / 2 - e.cx * e.s) + 'px';
    img.style.top = (V / 2 - e.cy * e.s) + 'px';
  }

  function wirePhotoGestures(vp) {
    var pts = {}, lastDist = 0;
    vp.addEventListener('pointerdown', function (ev) {
      if (!photoEd || ev.target.closest('[data-action]')) return;
      ev.preventDefault();
      vp.setPointerCapture(ev.pointerId);
      pts[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      lastDist = 0;
    });
    vp.addEventListener('pointermove', function (ev) {
      if (!photoEd || !pts[ev.pointerId]) return;
      var ids = Object.keys(pts);
      if (ids.length === 1) {           // one finger / mouse: pan
        var p = pts[ev.pointerId];
        photoEd.cx -= (ev.clientX - p.x) / photoEd.s;
        photoEd.cy -= (ev.clientY - p.y) / photoEd.s;
        p.x = ev.clientX; p.y = ev.clientY;
        photoPaint();
      } else if (ids.length === 2) {    // two fingers: pinch zoom
        pts[ev.pointerId].x = ev.clientX; pts[ev.pointerId].y = ev.clientY;
        var a = pts[ids[0]], b = pts[ids[1]];
        var d = Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
        if (lastDist) { photoEd.s *= d / lastDist; photoPaint(); }
        lastDist = d;
      }
    });
    function up(ev) { delete pts[ev.pointerId]; lastDist = 0; }
    vp.addEventListener('pointerup', up);
    vp.addEventListener('pointercancel', up);
    vp.addEventListener('wheel', function (ev) {
      if (!photoEd) return;
      ev.preventDefault();
      photoEd.s *= Math.exp(-ev.deltaY * 0.0015);
      photoPaint();
    }, { passive: false });
  }

  function photoBake() {
    var vp = $('#photoVp');
    photoClamp();
    var V = vp.clientWidth, e = photoEd;
    var win = V / e.s; // visible window size in natural px
    var canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    canvas.getContext('2d').drawImage(e.img, e.cx - win / 2, e.cy - win / 2, win, win, 0, 0, 512, 512);
    return canvas.toDataURL('image/jpeg', 0.88);
  }

  // ---- youtube intro video ----

  function ytId(url) {
    var m = String(url || '').match(/(?:youtube\.com\/(?:watch\?[^#\s]*v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/);
    return m ? m[1] : null;
  }

  function ytCardHtml(url) {
    var id = ytId(url);
    if (!id) {
      return '<div class="yt-empty"><i class="fa-brands fa-youtube"></i>' +
        '<input id="ytInput" placeholder="Paste a YouTube link" value="' + esc(url || '') + '"></div>';
    }
    return '<div class="yt-preview">' +
      '<img class="yt-thumb" src="https://i.ytimg.com/vi/' + esc(id) + '/hqdefault.jpg" alt="">' +
      '<div class="yt-info"><div class="yt-title" id="ytTitle">YouTube video</div>' +
      '<input class="yt-url" value="https://youtu.be/' + esc(id) + '" readonly onclick="this.select()"></div>' +
      '<button type="button" class="yt-remove" data-action="yt-remove" title="Remove video"><i class="fa-solid fa-xmark"></i></button>' +
      '</div>';
  }

  function ytRender(url) {
    var box = $('#ytCard');
    if (!box) return;
    var id = ytId(url);
    var hid = $('#profileForm [name="video"]');
    if (hid) hid.value = id ? 'https://youtu.be/' + id : '';
    box.innerHTML = ytCardHtml(url);
    wireYt();
    updateJoinState();
    saveRegDraft();
    renderCardVideo(); // the card backdrop follows the picked video live
    if (id) {
      fetch('https://noembed.com/embed?url=' + encodeURIComponent('https://youtu.be/' + id))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var el = $('#ytTitle');
          if (el && d && d.title) el.textContent = d.title;
        })
        .catch(function () { /* thumbnail alone is fine */ });
    }
  }

  function wireYt() {
    var input = $('#ytInput');
    if (input) {
      input.addEventListener('input', function () {
        if (ytId(input.value)) ytRender(input.value);
      });
    }
  }

  // ---- intro video as the card backdrop ----
  // The video fills the card above the footer row (~16:9 there), autoplaying
  // muted on loop at reduced opacity so the card gradient tints through.
  // A footer speaker button unmutes via the YouTube iframe postMessage API.
  var cardVideoMuted = true;

  function cardVideoFrame(id) {
    var qs = 'autoplay=1&mute=1&loop=1&playlist=' + id +
      '&controls=0&playsinline=1&rel=0&modestbranding=1&iv_load_policy=3&disablekb=1' +
      '&enablejsapi=1&origin=' + encodeURIComponent(location.origin);
    return '<iframe id="cardVideoIf" src="https://www.youtube.com/embed/' + esc(id) + '?' + qs + '"' +
      ' allow="autoplay; encrypted-media" tabindex="-1" title="Intro video backdrop"></iframe>';
  }

  function renderCardVideo() {
    var box = $('#cardVideo');
    if (!box) return;
    var hid = $('#profileForm [name="video"]');
    var id = ytId(hid && hid.value);
    var muteBtn = $('#cardMuteBtn');
    var label = $('#cardVideoLabel');
    if (!id) {
      box.innerHTML = '';
      box.removeAttribute('data-vid');
      if (muteBtn) muteBtn.hidden = true;
      if (label) label.textContent = 'Add video';
      return;
    }
    if (label) label.textContent = '';
    if (muteBtn) muteBtn.hidden = false;
    // only rebuild the iframe when the video actually changed, so re-renders
    // don't restart playback
    if (box.getAttribute('data-vid') !== id) {
      box.setAttribute('data-vid', id);
      box.innerHTML = cardVideoFrame(id);
      cardVideoMuted = true;
      setCardMuteIcon();
    }
  }

  function cardVideoCmd(func) {
    var f = $('#cardVideoIf');
    if (f && f.contentWindow) {
      f.contentWindow.postMessage(JSON.stringify({ event: 'command', func: func, args: [] }), '*');
    }
  }

  function setCardMuteIcon() {
    var btn = $('#cardMuteBtn');
    if (!btn) return;
    btn.innerHTML = '<i class="fa-solid ' + (cardVideoMuted ? 'fa-volume-xmark' : 'fa-volume-high') + '"></i>';
    btn.title = cardVideoMuted ? 'Unmute video' : 'Mute video';
  }

  // Add/edit the video URL — the yt-card picker lives in an inline overlay on
  // the card front, opened from the footer's video button.
  function openVideoOverlay() {
    var ov = $('#videoOverlay');
    if (!ov) return;
    var hid = $('#profileForm [name="video"]');
    var box = $('#ytCard');
    if (box) box.innerHTML = ytCardHtml((hid && hid.value) || '');
    ov.hidden = false;
    wireYt();
    var input = $('#ytInput');
    if (input) input.focus();
  }

  function closeVideoOverlay() {
    var ov = $('#videoOverlay');
    if (ov) ov.hidden = true;
  }

  // ---- validation ----

  function normUrl(v) {
    v = String(v || '').trim();
    if (!v) return '';
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
    return v;
  }

  function validateProfile(form) {
    var fd = new FormData(form);
    if (!String(fd.get('firstName') || '').trim()) return 'Please enter your first name.';
    var linkRules = [
      ['linkGithub', /(^|\.)github\.com$/i, 'GitHub'],
      ['linkWebsite', null, 'Website'],
      ['linkLinkedin', /(^|\.)linkedin\.com$/i, 'LinkedIn'],
    ];
    for (var i = 0; i < linkRules.length; i++) {
      var v = normUrl(fd.get(linkRules[i][0]));
      if (!v) continue;
      var host = '';
      try { host = new URL(v).hostname; } catch (e) { /* invalid */ }
      if (!host || host.indexOf('.') === -1) return linkRules[i][2] + ' link is not a valid URL.';
      if (linkRules[i][1] && !linkRules[i][1].test(host)) {
        return linkRules[i][2] + ' link should point to ' + linkRules[i][2].toLowerCase() + '.com.';
      }
    }
    var ytIn = $('#ytInput');
    if (ytIn && ytIn.value.trim() && !ytId(ytIn.value)) return 'That does not look like a YouTube link.';
    return null;
  }

  function profileForm(u, isNew) {
    u = u || {};
    // split stored links into the three card fields by hostname
    var lg = '', lw = '', ll = '';
    (u.links || []).forEach(function (l) {
      var s = String(l);
      if (/github\.com/i.test(s) && !lg) lg = s;
      else if (/linkedin\.com/i.test(s) && !ll) ll = s;
      else if (!lw) lw = s;
    });
    var skills = (u.skills || []);
    var gender = u.gender || '';
    var vid = ytId(u.video || '');
    // The card edits first + last separately; they recombine into the stored `name`.
    var nameParts = String(u.name || '').trim().split(/\s+/).filter(Boolean);
    var firstName = nameParts.shift() || '';
    var lastName = nameParts.join(' ');

    return '<form class="form pf-grid" id="profileForm" data-new="' + (isNew ? '1' : '') + '">' +

      '<div class="pf-left">' +
      '<div class="idcard-scene"><div class="idcard" id="idcard">' +

      // ---------------- front
      '<div class="idface idfront">' +
      // intro video plays as the card's backdrop (everything above the footer)
      '<div class="card-video" id="cardVideo"></div>' +
      '<div class="idcard-head"><span class="idcard-brand">' + brandHtml(true) + '</span>' +
      // role is self-selected on the card: member (participant/student) or
      // mentor (facilitator) — admins keep their fixed organizer badge
      (u.role === 'admin'
        ? '<span class="idcard-type">ORGANIZER</span>'
        : '<span class="idcard-type idcard-type-select"><select name="roleSel" aria-label="Your role">' +
          '<option value="participant"' + (u.role === 'mentor' ? '' : ' selected') + '>Member</option>' +
          '<option value="mentor"' + (u.role === 'mentor' ? ' selected' : '') + '>Mentor</option>' +
          '</select><i class="fa-solid fa-caret-down"></i></span>') +
      '</div>' +
      '<div class="idcard-main">' +
      '<div class="idcard-photo"><div class="photo-vp" id="photoVp" title="Drag to adjust · scroll to zoom">' +
      (u.image
        ? '<img class="photo-static" src="' + esc(u.image) + '" alt="">'
        : '<div class="photo-empty" data-action="photo-pick"><i class="fa-solid fa-camera"></i><span>Add photo</span></div>') +
      '<button type="button" class="photo-change" data-action="photo-pick" title="Change photo"><i class="fa-solid fa-camera"></i></button>' +
      '</div></div>' +
      '<div class="idcard-fields">' +
      '<div class="cname-row">' +
      '<span class="cgender" id="cgender"></span>' +
      '<input class="cinput cname" name="firstName" required maxlength="50" placeholder="First name" value="' + esc(firstName) + '">' +
      '<input class="cinput cname" name="lastName" maxlength="50" placeholder="Last name" value="' + esc(lastName) + '">' +
      '</div>' +
      '<input type="hidden" name="gender" value="' + esc(gender) + '">' +
      '<div class="cemail" id="proposedEmail" hidden><i class="fa-regular fa-envelope"></i>' +
      '<span class="cemail-addr" id="cemailAddr"></span>' +
      '<span class="cemail-status" id="cemailStatus" data-status=""></span></div>' +
      '<label class="cfield"><i class="fa-solid fa-building"></i><input class="cinput" name="affiliation" maxlength="70" placeholder="Affiliation — university, company" value="' + esc(u.affiliation || '') + '"></label>' +
      '<label class="cfield"><i class="fa-solid fa-lightbulb"></i><input class="cinput" name="expertise" maxlength="90" placeholder="Expertise — comma separated topics" value="' + esc(u.expertise || '') + '"></label>' +
      '</div></div>' + // close .idcard-fields + .idcard-main
      // skills attach directly on the card front (max 3, one line)
      '<div class="idcard-skills">' +
      '<i class="fa-solid fa-wand-magic-sparkles cskill-lead"></i>' +
      '<div class="cskill-tags" id="skillTags">' + skills.slice(0, 3).map(cardChip).join('') + '</div>' +
      '<button type="button" class="cskill-add" id="skillAddBtn" data-action="open-skills"><i class="fa-solid fa-plus"></i>Add skill</button>' +
      '</div>' +
      '<div class="idcard-foot"><span class="idcard-url">' + esc(siteUrl()) + '</span>' +
      '<span class="foot-right">' +
      '<button type="button" class="foot-icon" id="cardMuteBtn" data-action="card-video-mute" title="Unmute video" hidden><i class="fa-solid fa-volume-xmark"></i></button>' +
      '<button type="button" class="foot-icon" data-action="card-video-edit" title="Intro video — YouTube link"><i class="fa-solid fa-video"></i><span class="foot-icon-label" id="cardVideoLabel"></span></button>' +
      '<button type="button" class="flip-btn" data-action="flip-card"><i class="fa-solid fa-rotate"></i><span>More on the back</span></button>' +
      '</span></div>' +
      // skill picker — a temporary overlay over the card front
      '<div class="cskill-overlay" id="skillOverlay" hidden>' +
      '<div class="cskill-oh"><span>Add skills <b id="skillCount">(0/3)</b></span>' +
      '<button type="button" class="cskill-close" data-action="close-skills" aria-label="Done"><i class="fa-solid fa-xmark"></i></button></div>' +
      '<div class="cskill-inrow"><input id="skillInput" placeholder="Type a skill…" autocomplete="off">' +
      '<button type="button" class="cskill-addbtn" data-action="add-typed-skill">Add</button></div>' +
      '<div class="cskill-pool" id="skillPool"></div>' +
      '</div>' +
      // intro video picker — an inline overlay on the card (like the skill
      // picker), no popup windows
      '<div class="cskill-overlay video-overlay" id="videoOverlay" hidden>' +
      '<div class="cskill-oh"><span>Intro video</span>' +
      '<button type="button" class="cskill-close" data-action="close-video" aria-label="Done"><i class="fa-solid fa-xmark"></i></button></div>' +
      '<p class="video-ov-hint">Paste a YouTube link — it plays as your card’s backdrop.</p>' +
      '<div class="yt-card" id="ytCard"></div>' +
      '</div>' +
      '</div>' + // close .idfront

      // ---------------- back
      '<div class="idface idback">' +
      '<div class="idband"></div>' +
      '<textarea class="cinput cbio" name="bio" maxlength="260" placeholder="Short bio — who you are, what excites you">' + esc(u.bio || '') + '</textarea>' +
      '<div class="idlinks">' +
      '<label class="cfield"><i class="fa-brands fa-github"></i><input class="cinput" name="linkGithub" maxlength="200" placeholder="github.com/you" value="' + esc(lg) + '"><span class="link-status" id="ls_linkGithub" data-status=""></span></label>' +
      '<label class="cfield"><i class="fa-solid fa-globe"></i><input class="cinput" name="linkWebsite" maxlength="200" placeholder="yourwebsite.com" value="' + esc(lw) + '"><span class="link-status" id="ls_linkWebsite" data-status=""></span></label>' +
      '<label class="cfield"><i class="fa-brands fa-linkedin-in"></i><input class="cinput" name="linkLinkedin" maxlength="200" placeholder="linkedin.com/in/you" value="' + esc(ll) + '"><span class="link-status" id="ls_linkLinkedin" data-status=""></span></label>' +
      '</div>' +
      '<div class="idcard-foot"><span class="idcard-url">' + esc(eventTagline()) + '</span>' +
      '<button type="button" class="flip-btn" data-action="flip-card"><i class="fa-solid fa-rotate"></i><span>Front</span></button></div>' +
      '</div>' +

      '</div></div>' +
      '<input type="hidden" name="image" value="' + esc(u.image || '') + '">' +
      '<input type="file" id="photoFile" accept="image/*" hidden>' +
      '</div>' + // .pf-left

      '<div class="pf-right">' +
      // intro video lives on the card (backdrop + footer buttons); only the
      // value travels with the form
      '<input type="hidden" name="video" value="' + (vid ? 'https://youtu.be/' + esc(vid) : '') + '">' +

      // live persona — Claude interprets the card as it fills in
      '<div class="persona" id="personaPanel"><p class="persona-text" id="personaText">' + esc(personaDefaultText(isNew)) + '</p></div>' +

      '<div class="form-status" id="profileStatus"></div>' +
      // always visible: the consent row activates once the card is complete,
      // and the button activates once consent is ticked. The tick itself is
      // never persisted anywhere — each registration asks fresh.
      '<div class="join-block" id="joinWrap">' +
      (isNew
        ? '<label class="consent"><input type="checkbox" id="consentBox" disabled> I agree that this information is stored by the organizers and that my profile is shown publicly to the workshop’s mentors and participants.</label>'
        : '') +
      '<div class="form-actions"><button class="btn btn-gradient" type="submit"><span class="label">' + (isNew ? 'Let’s build something amazing' : 'Save changes') + '</span><span class="spin"></span></button></div>' +
      '</div>' +
      '</div>' + // .pf-right
      '</form>';
  }

  // ---- live persona (LLM via the backend `persona` action) ----

  function personaDefaultText(isNew) {
    if (!isNew) return 'This is how others will meet you — your persona refreshes as you edit the card.';
    var prefill = state.data && state.data.prefill;
    if (prefill && prefill.profile) {
      return 'Welcome back! Your card is filled in from last time — check it over, and watch your persona take shape here.';
    }
    return 'Every great team starts with a person. Fill in your card and a persona will take shape right here — it’s how mentors and other participants will first meet you.';
  }

  var personaTimer = null;
  var personaLastPayload = '';
  var personaDisabled = false; // backend has no API key configured

  function personaFields() {
    var form = $('#profileForm');
    if (!form) return null;
    var fd = new FormData(form);
    var first = String(fd.get('firstName') || '').trim();
    var last = String(fd.get('lastName') || '').trim();
    return {
      name: (first + ' ' + last).trim(),
      role: fd.get('roleSel') || 'participant',
      affiliation: String(fd.get('affiliation') || '').trim(),
      expertise: String(fd.get('expertise') || '').trim(),
      bio: String(fd.get('bio') || '').trim(),
      skills: getTagValues(),
    };
  }

  function schedulePersona() {
    if (personaDisabled) return;
    clearTimeout(personaTimer);
    personaTimer = setTimeout(refreshPersona, 1400);
  }

  async function refreshPersona() {
    if (personaDisabled) return;
    var f = personaFields();
    if (!f) return;
    if (!f.name && !f.affiliation && !f.expertise && !f.bio && !f.skills.length) return;
    var payload = JSON.stringify(f);
    if (payload === personaLastPayload) return;
    personaLastPayload = payload;
    var el = $('#personaText');
    if (el) el.classList.add('thinking');
    try {
      var r = await A.api('persona', f);
      if (r.disabled) { personaDisabled = true; return; }
      // only render if the form still matches what we asked about — a newer
      // keystroke has its own refresh queued
      var now = personaFields();
      if (!now || JSON.stringify(now) !== payload) return;
      var out = $('#personaText');
      if (out && r.text) out.textContent = r.text;
    } catch (e) {
      /* persona is decorative — fail silently */
    } finally {
      var done = $('#personaText');
      if (done) done.classList.remove('thinking');
    }
  }

  var MAX_SKILLS = 3;

  function cardChip(s) {
    return '<span class="cskill" data-skill="' + esc(s) + '">' + esc(s) +
      '<i class="fa-solid fa-xmark" data-action="rm-tag" title="Remove"></i></span>';
  }

  function getTagValues() {
    return $all('#skillTags [data-skill]').map(function (c) { return c.getAttribute('data-skill'); });
  }

  // Sync the card skills row + overlay after any change.
  function refreshSkillsUI() {
    var count = getTagValues().length;
    var addBtn = $('#skillAddBtn');
    if (addBtn) addBtn.style.display = count >= MAX_SKILLS ? 'none' : '';
    var cnt = $('#skillCount');
    if (cnt) cnt.textContent = '(' + count + '/' + MAX_SKILLS + ')';
    renderSkillPool();
  }

  // The pick-from list inside the overlay (suggested skills + other users' skills).
  function renderSkillPool() {
    var box = $('#skillPool');
    if (!box) return;
    var existing = getTagValues().map(function (x) { return x.toLowerCase(); });
    if (getTagValues().length >= MAX_SKILLS) {
      box.innerHTML = '<div class="cskill-full">That’s ' + MAX_SKILLS + ' skills — the max. Remove one to swap.</div>';
      return;
    }
    var pool = {};
    opts('skill', C.SKILL_SUGGESTIONS).forEach(function (s) { pool[s] = 1; });
    ((state.data && state.data.users) || []).forEach(function (u) { (u.skills || []).forEach(function (s) { pool[s] = 1; }); });
    var items = Object.keys(pool).filter(function (s) { return existing.indexOf(s.toLowerCase()) === -1; });
    box.innerHTML = items.map(function (s) {
      return '<span class="cskill-pick" data-action="add-tag" data-skill="' + esc(s) + '"><i class="fa-solid fa-plus"></i>' + esc(s) + '</span>';
    }).join('');
  }

  function addTag(s) {
    s = String(s || '').trim();
    if (!s) return;
    var values = getTagValues();
    if (values.length >= MAX_SKILLS) { toast('You can add up to ' + MAX_SKILLS + ' skills.', true); return; }
    if (values.map(function (x) { return x.toLowerCase(); }).indexOf(s.toLowerCase()) !== -1) return;
    var tags = $('#skillTags');
    if (tags) tags.insertAdjacentHTML('beforeend', cardChip(s));
    refreshSkillsUI();
    saveRegDraft();
    updateJoinState();
    schedulePersona();
    if (getTagValues().length >= MAX_SKILLS) closeSkills(); // the third pick finishes
  }

  function openSkills() {
    var ov = $('#skillOverlay');
    if (!ov) return;
    ov.hidden = false;
    refreshSkillsUI();
    var si = $('#skillInput');
    if (si) { si.value = ''; si.focus(); }
  }
  function closeSkills() {
    var ov = $('#skillOverlay');
    if (ov) ov.hidden = true;
  }

  // ---- gender picker on the name line (round M / F badge) ----
  function genderLetter(g) { return g === 'Female' ? 'F' : 'M'; }

  function renderGender() {
    var box = $('#cgender');
    if (!box) return;
    var hid = $('#profileForm [name="gender"]');
    var val = hid ? hid.value : '';
    var isMF = (val === 'Male' || val === 'Female');
    var open = box.getAttribute('data-open') === '1';
    if (isMF && !open) {
      // collapsed: just the chosen letter; click to reselect
      box.innerHTML = '<button type="button" class="cg-btn selected" data-action="gender-toggle" title="' + esc(val) + ' — tap to change">' + genderLetter(val) + '</button>';
    } else {
      // expanded: both options
      box.innerHTML =
        '<button type="button" class="cg-btn' + (val === 'Male' ? ' on' : '') + '" data-action="gender-pick" data-gender="Male" title="Male">M</button>' +
        '<button type="button" class="cg-btn' + (val === 'Female' ? ' on' : '') + '" data-action="gender-pick" data-gender="Female" title="Female">F</button>';
    }
  }

  // ---- registration draft autosave (localStorage) ----
  // Only the fresh-registration form is persisted (data-new="1"); editing an
  // existing profile isn't, to avoid a stale draft shadowing live data.
  // Keyed per project — a draft started in a test project must never surface
  // in another project's register form.
  function regDraftKey() { return 'ice.regdraft.' + A.getProject(); }

  function collectRegDraft() {
    var form = $('#profileForm');
    if (!form || form.getAttribute('data-new') !== '1') return null;
    var fd = new FormData(form);
    return {
      firstName: fd.get('firstName') || '', lastName: fd.get('lastName') || '',
      affiliation: fd.get('affiliation') || '', expertise: fd.get('expertise') || '',
      bio: fd.get('bio') || '', gender: fd.get('gender') || '',
      linkGithub: fd.get('linkGithub') || '', linkWebsite: fd.get('linkWebsite') || '',
      linkLinkedin: fd.get('linkLinkedin') || '', video: fd.get('video') || '',
      image: fd.get('image') || '', skills: getTagValues(),
      role: fd.get('roleSel') || 'participant',
    };
  }
  function saveRegDraft() {
    var d = collectRegDraft();
    if (!d) return;
    try { localStorage.setItem(regDraftKey(), JSON.stringify(d)); } catch (e) { /* quota */ }
  }
  function loadRegDraft() {
    try { return JSON.parse(localStorage.getItem(regDraftKey()) || 'null'); } catch (e) { return null; }
  }
  function clearRegDraft() { localStorage.removeItem(regDraftKey()); }

  // Draft → the user-shaped object profileForm() expects (name recombined,
  // links re-bucketed by hostname into the github/website/linkedin fields).
  function draftToUser(d) {
    if (!d) return null;
    return {
      name: ((d.firstName || '') + ' ' + (d.lastName || '')).trim(),
      affiliation: d.affiliation, expertise: d.expertise, bio: d.bio, gender: d.gender,
      image: d.image, video: d.video, skills: d.skills || [],
      links: [d.linkGithub, d.linkWebsite, d.linkLinkedin].filter(Boolean),
      role: d.role || 'participant',
    };
  }

  function viewRegister() {
    if (!signedIn()) {
      return '<div class="empty" style="margin-top:40px"><i class="fa-solid fa-user-plus"></i>Sign in with Google first, then complete your profile.<br><br>' +
        '<button class="btn btn-gradient" data-action="sign-in"><i class="fa-brands fa-google"></i>Sign in with Google</button></div>';
    }
    if (me()) { location.hash = '#/me'; return ''; }
    if (state.data && !state.data.registrationOpen) {
      return '<div class="empty" style="margin-top:40px"><i class="fa-solid fa-door-closed"></i>Registration is closed. Contact the organizers if you believe this is a mistake.</div>';
    }
    if (!formReady()) return profileScaffold('', '', formLoading());
    setTimeout(afterProfileForm, 0);
    // A local draft wins; otherwise a returning person (known in the
    // cross-project directory) starts from their last profile. No heading —
    // the persona panel beside the card carries the narration.
    var prefill = state.data && state.data.prefill;
    var seed = draftToUser(loadRegDraft()) || (prefill && prefill.profile) || null;
    return profileScaffold('', '', profileForm(seed, true));
  }

  function viewMe() {
    if (!signedIn() || !me()) { location.hash = signedIn() ? '#/register' : '#/'; return ''; }
    if (!formReady()) return profileScaffold('Edit profile', '', formLoading());
    setTimeout(afterProfileForm, 0);
    return profileScaffold('Edit profile', '', profileForm(me(), false));
  }

  function profileScaffold(title, sub, inner) {
    return '<div class="profile-edit">' +
      (title ? '<h1 style="font-size:30px">' + title + '</h1>' : '') +
      (sub ? '<p style="color:var(--text-body)">' + sub + '</p>' : '') + inner + '</div>';
  }

  // ---- link existence check + Join-button gating ----
  // Registration requires every field complete; the three web links are verified
  // server-side (js -> check_url) and must resolve before Join enables.
  var LINK_FIELDS = ['linkGithub', 'linkWebsite', 'linkLinkedin'];
  var linkStatus = {};   // field -> 'empty' | 'checking' | 'ok' | 'bad'
  var linkTimers = {};   // debounce handles
  var linkSeq = {};      // race guard: only the latest check per field wins

  function setLinkStatus(field, status) {
    linkStatus[field] = status;
    var el = document.getElementById('ls_' + field);
    if (el) {
      el.setAttribute('data-status', status);
      el.innerHTML =
        status === 'checking' ? '<i class="fa-solid fa-spinner fa-spin"></i>' :
        status === 'ok' ? '<i class="fa-solid fa-circle-check"></i>' :
        status === 'bad' ? '<i class="fa-solid fa-triangle-exclamation"></i>' : '';
    }
    updateJoinState();
  }

  function checkLink(field, rawValue) {
    var v = normUrl(rawValue);
    if (!v) { setLinkStatus(field, 'empty'); return; }
    setLinkStatus(field, 'checking');
    var seq = (linkSeq[field] = (linkSeq[field] || 0) + 1);
    A.api('check_url', { url: v }).then(function (r) {
      if (seq !== linkSeq[field]) return; // a newer keystroke superseded this
      setLinkStatus(field, r && r.exists ? 'ok' : 'bad');
    }).catch(function () {
      if (seq !== linkSeq[field]) return;
      setLinkStatus(field, 'bad');
    });
  }

  function wireLinkChecks(pform) {
    LINK_FIELDS.forEach(function (f) {
      var input = pform.querySelector('[name="' + f + '"]');
      if (!input) return;
      if (input.value.trim()) checkLink(f, input.value); else setLinkStatus(f, 'empty');
      input.addEventListener('input', function () {
        setLinkStatus(f, input.value.trim() ? 'checking' : 'empty');
        clearTimeout(linkTimers[f]);
        linkTimers[f] = setTimeout(function () {
          if (input.value.trim()) checkLink(f, input.value); else setLinkStatus(f, 'empty');
        }, 600);
      });
    });
  }

  // Enable Join only when the whole card is complete (new registrations only).
  function updateJoinState() {
    var form = $('#profileForm');
    if (!form || form.getAttribute('data-new') !== '1') return;
    var btn = form.querySelector('button[type="submit"]');
    if (!btn) return;
    var fd = new FormData(form);
    var has = function (n) { return String(fd.get(n) || '').trim().length > 0; };
    var photoOk = !!photoEd || has('image');
    var textOk = has('firstName') && has('lastName') && has('affiliation') && has('expertise') && has('bio');
    var skillsOk = getTagValues().length > 0;
    var videoOk = !!ytId(fd.get('video') || ($('#ytInput') && $('#ytInput').value) || '');
    var linksOk = LINK_FIELDS.every(function (f) { return linkStatus[f] === 'ok'; });
    var complete = photoOk && textOk && skillsOk && videoOk && linksOk;
    // staged activation: complete card → consent unlocks; consent ticked →
    // button unlocks. Consent is never persisted, and it un-ticks if the
    // card drops back to incomplete.
    var consent = $('#consentBox');
    if (consent) {
      consent.disabled = !complete;
      if (!complete && consent.checked) consent.checked = false;
    }
    var ready = complete && (!consent || consent.checked);
    btn.disabled = !ready;
    btn.classList.toggle('btn-disabled', !ready);
  }

  // ---- name inputs size to their exact rendered text, so first + last read as
  // one name with a single natural space between them ----
  var nameMeasureEl = null;
  function measureNameWidth(input) {
    if (!nameMeasureEl) {
      nameMeasureEl = document.createElement('span');
      nameMeasureEl.style.cssText = 'position:absolute;top:-9999px;left:-9999px;visibility:hidden;white-space:pre;';
      document.body.appendChild(nameMeasureEl);
    }
    var cs = getComputedStyle(input);
    nameMeasureEl.style.fontFamily = cs.fontFamily;
    nameMeasureEl.style.fontSize = cs.fontSize;
    nameMeasureEl.style.fontWeight = cs.fontWeight;
    nameMeasureEl.style.fontStyle = cs.fontStyle;
    nameMeasureEl.style.letterSpacing = cs.letterSpacing;
    nameMeasureEl.textContent = input.value || input.placeholder || '';
    return nameMeasureEl.getBoundingClientRect().width;
  }
  function sizeName(input) {
    // +2px leaves room for the caret on focus without visibly widening the text.
    input.style.width = Math.ceil(measureNameWidth(input) + 2) + 'px';
  }

  // ---- proposed workshop email (firstname@designthinking.lk), checked live ----
  // Mirrors the backend's assignment: firstname@ first, and if that's taken it
  // auto-advances to firstname.lastname@ (then numbered) — showing the address the
  // account will actually get. New registrations only.
  var WORKSPACE_DOMAIN = 'designthinking.lk';
  var emailSeq = 0;
  var emailTimer = null;

  function emailHandle(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }

  function setProposedEmailUI(status, email) {
    var box = $('#proposedEmail'), addr = $('#cemailAddr'), st = $('#cemailStatus');
    if (!box) return;
    box.hidden = false;
    if (addr) addr.textContent = email;
    if (st) {
      st.setAttribute('data-status', status);
      st.innerHTML =
        status === 'checking' ? '<i class="fa-solid fa-spinner fa-spin"></i>' :
        status === 'ok' ? '<i class="fa-solid fa-circle-check" title="Available"></i>' :
        status === 'bad' ? '<i class="fa-solid fa-triangle-exclamation" title="Could not verify"></i>' : '';
    }
  }

  function updateProposedEmail() {
    var form = $('#profileForm');
    if (!form || form.getAttribute('data-new') !== '1') return;
    var box = $('#proposedEmail');
    if (!box) return;
    // Returning person: they keep the account they already have — show it
    // instead of proposing (and checking) a fresh address.
    var prefill = state.data && state.data.prefill;
    if (prefill && prefill.workEmail) {
      setProposedEmailUI('ok', prefill.workEmail);
      var st0 = $('#cemailStatus');
      if (st0) st0.innerHTML = '<i class="fa-solid fa-circle-check" title="Your existing workshop account — you keep it"></i>';
      return;
    }
    // No workshop accounts are minted in this project (test projects).
    if (proj().provisionAccounts === false) { box.hidden = true; return; }
    var fd = new FormData(form);
    var f = emailHandle(fd.get('firstName'));
    var l = emailHandle(fd.get('lastName'));
    if (!f) { box.hidden = true; return; }
    var candidates = [f];
    if (l) { candidates.push(f + '.' + l); for (var n = 2; n <= 9; n++) candidates.push(f + '.' + l + n); }
    else { for (var m = 2; m <= 9; m++) candidates.push(f + m); }
    var seq = ++emailSeq;
    setProposedEmailUI('checking', candidates[0] + '@' + WORKSPACE_DOMAIN);
    (function tryNext(i) {
      if (i >= candidates.length) return; // give up quietly
      var email = candidates[i] + '@' + WORKSPACE_DOMAIN;
      setProposedEmailUI('checking', email);
      A.api('check_email', { email: email }).then(function (r) {
        if (seq !== emailSeq) return; // superseded by a newer keystroke
        if (r && r.available) setProposedEmailUI('ok', email);
        else tryNext(i + 1); // taken → auto-advance to firstname.lastname, etc.
      }).catch(function () {
        if (seq !== emailSeq) return;
        setProposedEmailUI('bad', email);
      });
    })(0);
  }

  function afterProfileForm() {
    photoEd = null; // fresh form; only set when the user picks a new photo
    linkStatus = {}; linkTimers = {}; linkSeq = {}; emailSeq = 0;
    refreshSkillsUI();
    renderGender();
    var pform = $('#profileForm');
    if (pform) {
      wireLinkChecks(pform); // verify links + show ✓/⚠ (both new and edit forms)
      // Name inputs size to their content so first + last read as one name.
      var nameInputs = ['firstName', 'lastName'].map(function (nm) {
        return pform.querySelector('[name="' + nm + '"]');
      }).filter(Boolean);
      nameInputs.forEach(function (inp) {
        sizeName(inp);
        inp.addEventListener('input', function () { sizeName(inp); });
      });
      // Re-measure once the display font loads (initial measure may hit the fallback).
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () { nameInputs.forEach(sizeName); });
      }
      // Live persona: any edit (both new and edit forms) re-interprets the card.
      personaLastPayload = '';
      pform.addEventListener('input', schedulePersona);
      pform.addEventListener('change', schedulePersona);
      refreshPersona(); // initial (edit form / restored draft / prefill)
      var isNew = pform.getAttribute('data-new') === '1';
      if (isNew) {
        // Autosave the fresh-registration form + re-evaluate the Join gate.
        var onEdit = function () { saveRegDraft(); updateJoinState(); };
        pform.addEventListener('input', onEdit);
        pform.addEventListener('change', onEdit);
        // Debounced proposed-email lookup as the first/last name change.
        var nameFields = ['firstName', 'lastName'];
        nameFields.forEach(function (nm) {
          var inp = pform.querySelector('[name="' + nm + '"]');
          if (!inp) return;
          inp.addEventListener('input', function () {
            clearTimeout(emailTimer);
            emailTimer = setTimeout(updateProposedEmail, 450);
          });
        });
        updateProposedEmail(); // initial (e.g. restored draft)
      }
    }
    renderCardVideo(); // card backdrop from the stored/drafted video
    var file = $('#photoFile');
    if (file) file.addEventListener('change', function () {
      if (file.files && file.files[0]) photoLoad(file.files[0]);
    });
    // Card fields print onto a physical card: keep them single-paragraph so
    // the unfocused (printed) view never needs to scroll.
    var bio = $('#profileForm [name="bio"]');
    if (bio) {
      bio.addEventListener('keydown', function (e) { if (e.key === 'Enter') e.preventDefault(); });
      bio.addEventListener('input', function () {
        var flat = bio.value.replace(/\s*\n+\s*/g, ' ');
        if (flat !== bio.value) bio.value = flat;
      });
    }
    updateJoinState(); // initial state (disabled until everything is complete)
  }

  // ----------------------------------------------------------------- admin

  // ---- Projects & Tools (logged-in only; placeholder content for now) ----

  function signInGate(what) {
    return '<div class="empty" style="margin-top:40px"><i class="fa-solid fa-lock"></i>' +
      'Sign in to view ' + esc(what) + '.<br><br>' +
      '<button class="btn btn-gradient" data-action="sign-in"><i class="fa-brands fa-google"></i>Sign in with Google</button></div>';
  }

  // Placeholder showcase until teams publish real projects — 6 cards at the
  // ID-card aspect ratio, each with its own backdrop.
  var DEMO_PROJECTS = [
    { t: 'Smart Mobility', d: 'Rethinking how the city moves — accessible transit for everyone.' },
    { t: 'CareConnect', d: 'Bridging patients and caregivers with human-centred health tools.' },
    { t: 'AgriSense', d: 'Data-driven decisions for smallholder farmers.' },
    { t: 'EduPlay', d: 'Learning through play — creative classrooms beyond the textbook.' },
    { t: 'Circular Living', d: 'Designing waste out of everyday life, one household at a time.' },
    { t: 'FinAccess', d: 'Everyday finance for the unbanked and underserved.' },
  ];

  function viewProjects() {
    // public — like People
    return '<div class="projects-wrap"><div class="projects-grid">' +
      DEMO_PROJECTS.map(function (p, i) {
        return '<article class="project-card pc-' + (i + 1) + '">' +
          '<span class="pc-tag">Project</span>' +
          '<h3>' + esc(p.t) + '</h3>' +
          '<p>' + esc(p.d) + '</p>' +
          '</article>';
      }).join('') + '</div></div>';
  }

  function viewTools() {
    if (!signedIn()) return signInGate('tools');
    return '<div class="empty" style="margin-top:40px"><i class="fa-solid fa-toolbox"></i>Tools are coming soon.<br>Handy links and resources for the workshop will live here.</div>';
  }

  // Full registry rows, lazily fetched for the admin Projects panel (global
  // admins only — the backend rejects everyone else). null = not loaded yet.
  var adminProjects = null;

  function projectsPanel(d) {
    if (!d.registryUrl) return ''; // only global admins manage projects
    var inner;
    if (!adminProjects) {
      inner = '<div class="skeleton" style="height:60px"></div>';
      A.api('admin_list_projects').then(function (r) {
        adminProjects = r.projects || [];
        if (location.hash === '#/admin') route();
      }).catch(function (err) { toast(err.message, true); });
    } else {
      var current = A.getProject();
      inner = '<div class="table-wrap"><table class="admin">' +
        '<thead><tr><th>Project</th><th>Status</th><th>Registration</th><th>Accounts</th><th>Storage</th><th></th></tr></thead><tbody>' +
        adminProjects.map(function (p) {
          return '<tr><td><b>' + esc(p.name) + '</b> <span style="color:var(--text-muted);font-size:13px">' + esc(p.id) + '</span></td>' +
            '<td><select class="input" style="padding:5px 10px;font-size:13px" data-action="proj-status" data-proj="' + esc(p.id) + '">' +
            ['active', 'test', 'archived'].map(function (s) { return '<option' + ((p.status || 'active') === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') +
            '</select></td>' +
            '<td><label style="cursor:pointer;white-space:nowrap"><input type="checkbox" data-action="proj-reg" data-proj="' + esc(p.id) + '"' + (p.registrationOpen === 'true' ? ' checked' : '') + '> open</label></td>' +
            '<td><label style="cursor:pointer;white-space:nowrap" title="Mint @designthinking.lk accounts on registration"><input type="checkbox" data-action="proj-prov" data-proj="' + esc(p.id) + '"' + (p.provisionAccounts === 'true' ? ' checked' : '') + '> mint</label></td>' +
            '<td class="proj-store">' +
            (p.dbId
              ? '<a href="https://docs.google.com/spreadsheets/d/' + esc(p.dbId) + '/edit" target="_blank" rel="noopener" title="Database — Google Sheet"><i class="fa-solid fa-table-cells-large sheet-ic"></i></a>'
              : '<span class="store-off" title="Sheet is created on first use"><i class="fa-solid fa-table-cells-large"></i></span>') +
            (p.uploadsFolderId
              ? '<a href="https://drive.google.com/drive/folders/' + esc(p.uploadsFolderId) + '" target="_blank" rel="noopener" title="Uploads — Google Drive"><i class="fa-brands fa-google-drive drive-ic"></i></a>'
              : '<span class="store-off" title="Folder is created on first use"><i class="fa-brands fa-google-drive"></i></span>') +
            '</td>' +
            '<td>' + (p.id === current
              ? '<span class="role-tag admin">current</span>'
              : '<button class="btn btn-ghost btn-sm" data-action="switch-project-btn" data-proj="' + esc(p.id) + '">Switch</button>') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    return '<div class="panel" style="margin-bottom:22px"><h3><i class="fa-solid fa-layer-group"></i>Projects</h3>' + inner +
      '<div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap">' +
      '<button class="btn btn-outline btn-sm" data-action="new-project"><i class="fa-solid fa-plus"></i>New project</button>' +
      '<a class="btn btn-ghost btn-sm" href="' + esc(d.registryUrl) + '" target="_blank" rel="noopener">Registry sheet <i class="fa-solid fa-arrow-up-right-from-square"></i></a>' +
      '</div>' +
      (showNewProject ? newProjectCard() : '') +
      '</div>';
  }

  // Inline card under the projects list (no popup).
  var showNewProject = false;

  function newProjectCard() {
    return '<form class="form new-project-card" id="projectForm">' +
      '<h3 style="margin:0"><i class="fa-solid fa-plus"></i> New project</h3>' +
      '<div class="form-row">' +
      '<div class="field"><label>Project id <span class="hint">lowercase letters, digits, hyphens</span></label>' +
      '<input class="input" name="id" required pattern="[a-z0-9][a-z0-9-]{1,29}" maxlength="30" placeholder="ice2027"></div>' +
      '<div class="field"><label>Name</label><input class="input" name="name" required maxlength="60" placeholder="ICE2027"></div>' +
      '</div>' +
      '<div class="field"><label>Tagline <span class="hint">optional</span></label><input class="input" name="tagline" maxlength="200" value="' + esc(C.EVENT_TAGLINE) + '"></div>' +
      '<div class="field"><label style="display:flex;align-items:center;gap:10px;cursor:pointer"><input type="checkbox" name="isTest"> Test project — only admins see it in the switcher</label></div>' +
      '<div class="field"><label style="display:flex;align-items:center;gap:10px;cursor:pointer"><input type="checkbox" name="provision"> Mint @designthinking.lk accounts on registration</label></div>' +
      '<p class="hint" style="margin:0;color:var(--text-muted);font-size:13px">The project’s Google Sheet and Drive folder are created automatically on first use.</p>' +
      '<div class="form-status" id="projectFormStatus"></div>' +
      '<div class="form-actions"><button class="btn btn-gradient" type="submit"><span class="label">Create project</span><span class="spin"></span></button>' +
      '<button class="btn btn-ghost" type="button" data-action="cancel-new-project">Cancel</button></div></form>';
  }

  // ---- admin sections (one per tab) ----

  function adminPeopleSection(d) {
    var users = (d.users || []).slice().sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
    if (!users.length) return '<div class="empty"><i class="fa-solid fa-users"></i>Nobody has registered yet.</div>';
    var rows = users.map(function (u) {
      return '<tr><td style="display:flex;align-items:center;gap:10px">' + avatar(u, 'avatar-sm') +
        '<a href="#/profile/' + esc(u.id) + '">' + esc(u.name) + '</a></td>' +
        '<td>' + esc(u.email || '') + '</td>' +
        '<td>' + esc(u.affiliation || '') + '</td>' +
        '<td><select class="input" style="padding:5px 10px;font-size:13px" data-action="set-role" data-id="' + esc(u.id) + '">' +
        ['participant', 'mentor', 'admin'].map(function (r) { return '<option' + (u.role === r ? ' selected' : '') + '>' + r + '</option>'; }).join('') +
        '</select></td>' +
        '<td><button class="btn btn-ghost btn-sm" data-action="del-user" data-id="' + esc(u.id) + '" data-name="' + esc(u.name) + '"><i class="fa-regular fa-trash-can"></i></button></td></tr>';
    }).join('');
    return '<div class="table-wrap"><table class="admin"><thead><tr><th>Name</th><th>Email</th><th>Affiliation</th><th>Role</th><th></th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }

  function adminEventSection(d) {
    var p = proj();
    return '<div class="panel" style="margin-bottom:22px"><h3><i class="fa-solid fa-toggle-on"></i>Event settings <span style="font-weight:400;color:var(--text-muted);font-size:14px">— ' + esc(eventName()) + '</span></h3>' +
      '<label style="display:flex;align-items:center;gap:10px;cursor:pointer"><input type="checkbox" id="regToggle" ' + (d.registrationOpen ? 'checked' : '') + ' data-action="toggle-reg"> Registration open</label></div>' +
      '<div class="panel" style="margin-bottom:22px"><h3><i class="fa-regular fa-calendar"></i>Event dates</h3>' +
      '<div class="date-range">' +
      '<label>Start <input type="date" class="input" id="evStart" value="' + esc(p.startDate || '') + '"></label>' +
      '<label>End <input type="date" class="input" id="evEnd" value="' + esc(p.endDate || '') + '"></label>' +
      '<button class="btn btn-outline btn-sm" data-action="save-dates"><span class="label"><i class="fa-regular fa-floppy-disk"></i> Save dates</span><span class="spin"></span></button>' +
      '</div>' +
      '<p class="hint" style="margin:10px 0 0;color:var(--text-muted);font-size:13px">Shown on the home page later.</p></div>' +
      '<div class="panel"><h3><i class="fa-solid fa-bullhorn"></i>Announcements</h3>' +
      '<button class="btn btn-outline btn-sm" data-action="new-ann"><i class="fa-solid fa-plus"></i>New announcement</button> ' +
      '<a class="btn btn-ghost btn-sm" href="#/announcements">Manage on the news page</a></div>';
  }

  // Which admin tab is showing; People is home. (Storage links live inside
  // each project row — no separate Resources tab.)
  var adminTab = 'people';

  function viewAdmin() {
    var d = state.data;
    if (!d) return skeletons();
    if (!d.isAdmin) return '<div class="empty" style="margin-top:40px"><i class="fa-solid fa-shield-halved"></i>Admins only.</div>';
    var users = (d.users || []);
    var tabs = [{ id: 'people', label: 'People (' + users.length + ')' }];
    if (d.registryUrl) tabs.push({ id: 'projects', label: 'Projects' });
    tabs.push({ id: 'event', label: 'Event' });
    if (!tabs.some(function (t) { return t.id === adminTab; })) adminTab = 'people';
    var bar = '<div class="admin-tabs">' + tabs.map(function (t) {
      return '<button class="comm-tab' + (t.id === adminTab ? ' active' : '') + '" type="button" data-action="admin-tab" data-tab="' + t.id + '">' + t.label + '</button>';
    }).join('') + '</div>';
    var body =
      adminTab === 'projects' ? projectsPanel(d) :
      adminTab === 'event' ? adminEventSection(d) :
      adminPeopleSection(d);
    // tabs sit at the footer, on the same line as the sidebar's Admin item
    return '<div class="admin-wrap"><div class="admin-tabview">' + body + '</div>' + bar + '</div>';
  }

  // ---------------------------------------------------------------- router

  var routes = [
    { re: /^#\/?$/, view: viewHome },
    { re: /^#\/profile\/([\w-]+)$/, view: viewProfile },
    // the teams listing is gone — People (with its team filter) covers it;
    // team detail pages remain reachable from profiles
    { re: /^#\/teams$/, view: function () { location.hash = '#/'; return ''; } },
    { re: /^#\/team\/([\w-]+)$/, view: viewTeam },
    { re: /^#\/projects$/, view: viewProjects },
    { re: /^#\/tools$/, view: viewTools },
    { re: /^#\/announcements$/, view: viewAnnouncements },
    { re: /^#\/register$/, view: viewRegister },
    { re: /^#\/me$/, view: viewMe },
    { re: /^#\/admin$/, view: viewAdmin },
  ];

  function route() {
    var hash = location.hash || '#/';
    closeMenu();
    // Drop an open announcement draft when leaving the news page.
    if (annDraft.open && !/^#\/announcements$/.test(hash)) annDraft = { open: false, editing: null };
    var view = $('#view');
    for (var i = 0; i < routes.length; i++) {
      var m = hash.match(routes[i].re);
      if (m) {
        view.innerHTML = routes[i].view(m[1]);
        renderChrome();
        wireViewExtras(hash, m);
        return;
      }
    }
    view.innerHTML = '<div class="empty" style="margin-top:40px"><i class="fa-regular fa-compass"></i>Page not found. <a href="#/">Go home</a></div>';
  }

  function wireViewExtras(hash, m) {
    // people wordmark: build tiles from live data, then scale to fit
    if ($('#word')) requestAnimationFrame(buildWordmark);
    // skill tag input
    var skillInput = $('#skillInput');
    if (skillInput) {
      skillInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ',') {
          e.preventDefault();
          addTag(skillInput.value.replace(/,$/, ''));
          skillInput.value = '';
        } else if (e.key === 'Backspace' && !skillInput.value) {
          var chips = $all('#skillTags [data-skill]');
          if (chips.length) { chips[chips.length - 1].remove(); refreshSkillsUI(); saveRegDraft(); updateJoinState(); schedulePersona(); }
        }
      });
    }
  }

  // -------------------------------------------------------------- actions

  async function pickImage(btn) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async function () {
      var file = input.files && input.files[0];
      if (!file) return;
      busy(btn, true);
      try {
        var dataUrl = await downscale(file, 640, 0.85);
        var r = await A.api('upload_image', { data: dataUrl, filename: file.name.replace(/\.[^.]+$/, '') });
        var form = btn.closest('form');
        form.querySelector('[name="' + btn.getAttribute('data-target') + '"]').value = r.url;
        var prev = document.getElementById(btn.getAttribute('data-preview'));
        if (prev) { prev.src = r.url; prev.style.display = ''; }
        toast('Image uploaded');
      } catch (err) {
        toast(err.message || 'Upload failed', true);
      } finally {
        busy(btn, false);
      }
    };
    input.click();
  }

  function downscale(file, maxDim, quality) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Could not read image')); };
      img.src = url;
    });
  }

  function collectProfile(form) {
    var fd = new FormData(form);
    var links = [
      normUrl(fd.get('linkGithub')),
      normUrl(fd.get('linkWebsite')),
      normUrl(fd.get('linkLinkedin')),
    ].filter(Boolean);
    var ytIn = $('#ytInput');
    var video = fd.get('video') || (ytIn && ytId(ytIn.value) ? 'https://youtu.be/' + ytId(ytIn.value) : '');
    var first = String(fd.get('firstName') || '').trim();
    var last = String(fd.get('lastName') || '').trim();
    return {
      // first/last recombine into the single stored display name; firstName &
      // lastName are also sent so the backend can mint firstname@designthinking.lk.
      name: (first + ' ' + last).trim(),
      firstName: first,
      lastName: last,
      image: fd.get('image'),
      affiliation: fd.get('affiliation'),
      gender: fd.get('gender'),
      bio: fd.get('bio'),
      expertise: fd.get('expertise'),
      skills: getTagValues(),
      links: links,
      video: video,
      // undefined (dropped from JSON) when the card shows the fixed admin badge
      role: fd.get('roleSel') || undefined,
    };
  }

  async function confirmModal(title, body) {
    return new Promise(function (resolve) {
      modal('<h2>' + esc(title) + '</h2><p style="color:var(--text-body)">' + esc(body) + '</p>' +
        '<div class="form-actions"><button class="btn btn-danger" id="confirmYes">Delete</button>' +
        '<button class="btn btn-ghost" data-action="close-modal">Cancel</button></div>');
      $('#confirmYes').onclick = function () { closeModal(); resolve(true); };
      $('#modalRoot .modal-backdrop').addEventListener('click', function () { resolve(false); }, { once: true });
    });
  }

  document.addEventListener('click', async function (e) {
    var t = e.target.closest('[data-action]');
    if (!t) return;
    var action = t.getAttribute('data-action');
    var id = t.getAttribute('data-id');

    switch (action) {
      case 'sign-in': A.signIn(); break;
      case 'sign-out': e.preventDefault(); closeMenu(); A.signOut(); break;
      case 'user-menu': e.preventDefault(); openMenu('user'); break;
      case 'guest-menu': e.preventDefault(); openMenu('guest'); break;
      case 'menu-nav': closeMenu(); break; // let the anchor navigate
      case 'close-modal': closeModal(); break;
      case 'filter-skill': {
        var s = t.getAttribute('data-skill');
        state.skillFilter = state.skillFilter === s ? null : s;
        if (!/^#\/?$/.test(location.hash || '#/')) location.hash = '#/'; else route();
        break;
      }
      case 'filter-team': {
        var tid = t.getAttribute('data-team');
        var teamOn = state.teamFilter !== tid;
        state.teamFilter = teamOn ? tid : null;
        // Update in place (no rebuild) so the octagons don't flash.
        $all('#hiveTeams .team-chip').forEach(function (c) {
          c.classList.toggle('on', c.getAttribute('data-team') === state.teamFilter);
        });
        applyTeamFilter();
        var cap = $('.hive-caption');
        if (cap) {
          // Name comes from the chip so the caption works for the empty-state
          // scaffold too (those teams aren't in state.data.teams).
          var team = teamOn ? { name: t.getAttribute('data-name') } : null;
          cap.innerHTML = hiveCaptionText((state.data && state.data.users) || [], team);
        }
        break;
      }
      case 'toggle-chat': { var cp = $('#chatpane'); if (cp) setChatPane(cp.hidden); break; }
      case 'comm-tab': commTab = t.getAttribute('data-tab') === 'broadcast' ? 'broadcast' : 'chat'; renderChatPane(); break;
      case 'bcast-send': {
        var bi = $('#bcastInput');
        var msg = bi ? bi.value.trim() : '';
        if (!msg) break;
        busy(t, true);
        try {
          // announcements need a title — the first line doubles as one
          var firstLine = msg.split('\n')[0].slice(0, 80);
          await A.api('ann_create', { title: firstLine, content: msg, type: 'general', isPublished: true });
          if (bi) bi.value = '';
          await refresh();
          toast('Broadcast sent to everyone');
        } catch (err) { toast(err.message, true); }
        busy(t, false);
        renderChatPane();
        break;
      }
      case 'toggle-theme': {
        var dark = !isDark();
        try { localStorage.setItem('ice.theme', dark ? 'dark' : 'light'); } catch (err) { /* private mode */ }
        applyTheme(dark);
        break;
      }
      case 'new-team': teamForm(); break;
      case 'edit-team': {
        var team = null;
        (state.data.teams || []).forEach(function (x) { if (x.id === id) team = x; });
        teamForm(team);
        break;
      }
      case 'del-team':
        if (await confirmModal('Delete team?', 'This removes the team, its links and its feed. This cannot be undone.')) {
          try { await A.api('delete_team', { teamId: id }); toast('Team deleted'); location.hash = '#/teams'; refresh(); }
          catch (err) { toast(err.message, true); }
        }
        break;
      case 'join-team':
      case 'leave-team':
        busy(t, true);
        try {
          await A.api(action === 'join-team' ? 'join_team' : 'leave_team', { teamId: id });
          delete teamDetailCache[id];
          await refresh();
          toast(action === 'join-team' ? 'Welcome to the team' : 'You left the team');
        } catch (err) { toast(err.message, true); busy(t, false); }
        break;
      case 'post-team': {
        var input = $('#postInput');
        var content = input && input.value.trim();
        if (!content) break;
        busy(t, true);
        try {
          await A.api('team_post_add', { teamId: id, content: content });
          delete teamDetailCache[id];
          route();
        } catch (err) { toast(err.message, true); busy(t, false); }
        break;
      }
      case 'add-link':
        modal('<h2>Add a link</h2><form class="form" id="linkForm" data-team="' + esc(id) + '">' +
          '<div class="field"><label>URL</label><input class="input" name="url" required placeholder="https://…"></div>' +
          '<div class="field"><label>Title</label><input class="input" name="title" maxlength="150"></div>' +
          '<div class="field"><label>Description <span class="hint">optional</span></label><input class="input" name="description" maxlength="500"></div>' +
          '<div class="form-actions"><button class="btn btn-gradient" type="submit"><span class="label">Add link</span><span class="spin"></span></button>' +
          '<button class="btn btn-ghost" type="button" data-action="close-modal">Cancel</button></div></form>');
        break;
      case 'del-link':
        try {
          await A.api('team_link_delete', { linkId: id });
          delete teamDetailCache[t.getAttribute('data-team')];
          route();
        } catch (err) { toast(err.message, true); }
        break;
      case 'chat-dm': {
        var chatEmail = t.getAttribute('data-email');
        if (!chatEmail) { toast('This person has no workshop email yet.', true); break; }
        busy(t, true);
        try { await window.IceChat.openDm(chatEmail); }
        catch (err) { toast(err.message || 'Could not open Google Chat', true); }
        busy(t, false);
        break;
      }
      case 'new-ann': openAnnDraft(null); break;
      case 'edit-ann': {
        var ann = null;
        (state.data.announcements || []).forEach(function (x) { if (x.id === id) ann = x; });
        openAnnDraft(ann);
        break;
      }
      case 'save-ann': { var af = $('#annForm'); if (af) submitAnn(af, false, t); break; }
      case 'discard-ann': annDraft = { open: false, editing: null }; route(); break;
      case 'del-ann':
        if (await confirmModal('Delete announcement?', 'This cannot be undone.')) {
          try { await A.api('ann_delete', { id: id }); toast('Deleted'); refresh(); }
          catch (err) { toast(err.message, true); }
        }
        break;
      case 'del-user': {
        var name = t.getAttribute('data-name');
        if (await confirmModal('Remove ' + name + '?', 'Their profile is removed from the directory and from all teams.')) {
          try { await A.api('admin_delete_user', { userId: id }); toast('User removed'); refresh(); }
          catch (err) { toast(err.message, true); }
        }
        break;
      }
      case 'pick-image': pickImage(t); break;
      case 'photo-pick': { var pf = $('#photoFile'); if (pf) pf.click(); break; }
      case 'flip-card': { var card = $('#idcard'); if (card) card.classList.toggle('flipped'); break; }
      case 'yt-remove': {
        var hid = $('#profileForm [name="video"]');
        if (hid) hid.value = '';
        ytRender('');
        break;
      }
      case 'card-video-edit': openVideoOverlay(); break;
      case 'close-video': closeVideoOverlay(); break;
      case 'card-video-mute': {
        cardVideoMuted = !cardVideoMuted;
        cardVideoCmd(cardVideoMuted ? 'mute' : 'unMute');
        setCardMuteIcon();
        break;
      }
      case 'add-tag': addTag(t.getAttribute('data-skill')); break;
      case 'rm-tag': e.preventDefault(); t.closest('[data-skill]').remove(); refreshSkillsUI(); saveRegDraft(); updateJoinState(); schedulePersona(); break;
      case 'open-skills': openSkills(); break;
      case 'close-skills': closeSkills(); break;
      case 'gender-toggle': { var gb = $('#cgender'); if (gb) { gb.setAttribute('data-open', '1'); renderGender(); } break; }
      case 'gender-pick': {
        var hid = $('#profileForm [name="gender"]');
        if (hid) hid.value = t.getAttribute('data-gender') || '';
        var gbx = $('#cgender'); if (gbx) gbx.setAttribute('data-open', '0');
        renderGender(); saveRegDraft();
        break;
      }
      case 'add-typed-skill': { var si3 = $('#skillInput'); if (si3) { addTag(si3.value); si3.value = ''; si3.focus(); } break; }
      case 'new-project': showNewProject = true; route(); break;
      case 'cancel-new-project': showNewProject = false; route(); break;
      case 'switch-project-btn': switchProject(t.getAttribute('data-proj')); break;
      case 'admin-tab': adminTab = t.getAttribute('data-tab'); route(); break;
      case 'save-dates': {
        var sd = $('#evStart') ? $('#evStart').value : '';
        var ed = $('#evEnd') ? $('#evEnd').value : '';
        if (sd && ed && ed < sd) { toast('End date is before the start date.', true); break; }
        busy(t, true);
        try {
          await A.api('admin_update_project', { startDate: sd, endDate: ed });
          toast('Event dates saved');
          await refresh();
        } catch (err) { toast(err.message, true); }
        busy(t, false);
        break;
      }
    }
  });

  // Close the avatar dropdown on an outside click or Escape.
  document.addEventListener('click', function (e) {
    var pop = $('#menuPop');
    if (!pop || pop.hidden) return;
    if (e.target.closest('#menuPop')) return;
    if (e.target.closest('[data-action="user-menu"],[data-action="guest-menu"]')) return;
    closeMenu();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeMenu();
  });

  document.addEventListener('change', async function (e) {
    var t = e.target.closest('[data-action]');
    if (!t) return;
    if (t.getAttribute('data-action') === 'set-role') {
      try {
        await A.api('admin_set_role', { userId: t.getAttribute('data-id'), role: t.value });
        toast('Role updated');
        refresh();
      } catch (err) { toast(err.message, true); }
    }
    if (t.getAttribute('data-action') === 'toggle-reg') {
      try {
        var r = await A.api('admin_set_config', { registrationOpen: t.checked });
        toast('Registration is now ' + (r.registrationOpen ? 'open' : 'closed'));
        adminProjects = null;
        refresh();
      } catch (err) { toast(err.message, true); }
    }
    if (t.getAttribute('data-action') === 'switch-project') {
      switchProject(t.value);
    }
    // Inline project editors in the admin Projects panel — each row targets
    // its own project via an explicit `project` override.
    var pa = t.getAttribute('data-action');
    if (pa === 'proj-status' || pa === 'proj-reg' || pa === 'proj-prov') {
      var pid = t.getAttribute('data-proj');
      var patch = { project: pid };
      if (pa === 'proj-status') patch.status = t.value;
      if (pa === 'proj-reg') patch.registrationOpen = t.checked;
      if (pa === 'proj-prov') patch.provisionAccounts = t.checked;
      try {
        await A.api('admin_update_project', patch);
        adminProjects = null;
        toast('Project updated');
        refresh(); // projects list + current-project flags may have changed
      } catch (err) {
        toast(err.message, true);
        adminProjects = null;
        if (location.hash === '#/admin') route(); // revert the control
      }
    }
  });

  document.addEventListener('submit', async function (e) {
    var form = e.target;
    e.preventDefault();
    var btn = form.querySelector('button[type="submit"]');

    if (form.id === 'profileForm') {
      var status = $('#profileStatus');
      status.className = 'form-status';
      status.textContent = '';
      var invalid = validateProfile(form);
      if (invalid) { status.textContent = invalid; return; }
      busy(btn, true);
      try {
        // if the user picked a new photo, bake the cropped square & upload it
        if (photoEd) {
          var dataUrl = photoBake();
          var up = await A.api('upload_image', { data: dataUrl, filename: 'profile' });
          form.querySelector('[name="image"]').value = up.url;
        }
        var payload = collectProfile(form);
        var isNew = form.getAttribute('data-new') === '1';
        try {
          await A.api(isNew ? 'register' : 'update_profile', payload);
        } catch (err) {
          // A retried register can land twice: 'exists' means the first
          // attempt succeeded and only its response was lost — carry on.
          if (!(isNew && err.code === 'exists')) throw err;
        }
        if (isNew) clearRegDraft();
        photoEd = null;
        await refresh();
        toast(isNew ? 'Welcome aboard' : 'Profile saved');
        location.hash = '#/profile/' + (me() ? me().id : '');
      } catch (err) {
        status.textContent = err.message || 'Something went wrong.';
      } finally { busy(btn, false); }
    }

    if (form.id === 'teamForm') {
      busy(btn, true);
      var fd = new FormData(form);
      var teamId = form.getAttribute('data-id');
      var body = {
        name: fd.get('name'), description: fd.get('description'),
        lookingFor: fd.get('lookingFor'), coverImage: fd.get('coverImage'),
      };
      try {
        var r = teamId
          ? await A.api('update_team', Object.assign({ teamId: teamId }, body))
          : await A.api('create_team', body);
        closeModal();
        delete teamDetailCache[teamId || (r.team && r.team.id)];
        await refresh();
        location.hash = '#/team/' + r.team.id;
        toast(teamId ? 'Team updated' : 'Team created');
      } catch (err) {
        $('#teamFormStatus').textContent = err.message;
        busy(btn, false);
      }
    }

    if (form.id === 'annForm') {
      // Submit = Send (publish). Save-draft goes through the save-ann action.
      submitAnn(form, true, btn);
    }

    if (form.id === 'projectForm') {
      busy(btn, true);
      var fdp = new FormData(form);
      try {
        await A.api('admin_create_project', {
          id: fdp.get('id'),
          name: fdp.get('name'),
          tagline: fdp.get('tagline'),
          status: fdp.get('isTest') ? 'test' : 'active',
          provisionAccounts: !!fdp.get('provision'),
        });
        showNewProject = false;
        adminProjects = null;
        toast('Project created');
        refresh(); // pulls the updated projects list into the switcher
      } catch (err) {
        $('#projectFormStatus').textContent = err.message;
        busy(btn, false);
      }
    }

    if (form.id === 'linkForm') {
      busy(btn, true);
      var fd3 = new FormData(form);
      var teamId3 = form.getAttribute('data-team');
      try {
        await A.api('team_link_add', {
          teamId: teamId3, url: fd3.get('url'), title: fd3.get('title'), description: fd3.get('description'),
        });
        closeModal();
        delete teamDetailCache[teamId3];
        route();
        toast('Link added');
      } catch (err) { toast(err.message, true); busy(btn, false); }
    }
  });

  // ------------------------------------------------------------------ boot

  window.addEventListener('hashchange', route);
  window.addEventListener('resize', fitWordmark);

  (function boot() {
    // ?project=<slug> deep-links into a specific project (e.g. a next-year
    // invite link) — it becomes the sticky selection.
    try {
      var qp = new URLSearchParams(location.search).get('project');
      if (qp) A.setProject(qp.toLowerCase());
    } catch (e) { /* old browser */ }
    applyTheme(localStorage.getItem('ice.theme') === 'dark'); // sync the toggle icon
    var justSignedIn = A.absorbLoginToken();
    state.data = A.readCache();
    renderChrome();
    route();
    refresh().then(function () {
      if (justSignedIn && signedIn() && state.data && !state.data.me) {
        location.hash = '#/register';
      }
    });
    // Keep presence dots + broadcasts fresh (and mark ourselves online)
    // while the tab is visible. 2 min < the backend's 5-min online window.
    setInterval(function () {
      if (document.visibilityState === 'visible' && signedIn()) refresh();
    }, 120000);
  })();
})();
