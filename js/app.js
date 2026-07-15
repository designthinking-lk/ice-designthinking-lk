/* ICE2026 — single-file application: hash router + views.
 * No framework: template strings + event delegation. */
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
      if (!state.data) {
        $('#view').innerHTML = '<div class="empty"><i class="fa-solid fa-plug-circle-xmark"></i>' +
          'Could not reach the ICE2026 server.<br>' + esc(err.message || '') +
          '<br><br><button class="btn btn-outline" onclick="location.reload()">Retry</button></div>';
      } else {
        toast('Could not refresh data: ' + (err.message || 'network error'), true);
      }
    }
  }

  // --------------------------------------------------------------- chrome

  function renderChrome() {
    var d = state.data || {};
    var actions = $('#topbarActions');
    var navMsg = $('#navMessages');
    // Projects & Tools are for logged-in users; Admin only for admins.
    var loggedIn = signedIn();
    var navProjects = $('#navProjects');
    var navTools = $('#navTools');
    var navAdmin = $('#navAdmin');
    if (navProjects) navProjects.hidden = !loggedIn;
    if (navTools) navTools.hidden = !loggedIn;
    if (navAdmin) navAdmin.hidden = !d.isAdmin;
    if (signedIn() && d.me) {
      navMsg.hidden = false;
      actions.innerHTML =
        '<button class="avatar-circle-btn" data-action="user-menu" aria-label="Account" title="' + esc(d.me.name) + '">' +
        avatar(d.me, 'avatar-sm') + '</button>';
    } else if (signedIn()) {
      navMsg.hidden = true;
      actions.innerHTML =
        '<a class="btn btn-gradient btn-sm" href="#/register"><i class="fa-solid fa-user-plus"></i>Complete registration</a>' +
        '<button class="avatar-circle-btn" data-action="guest-menu" aria-label="Account" title="Account">' +
        '<span class="avatar-guest"><i class="fa-solid fa-user"></i></span></button>';
    } else {
      navMsg.hidden = true;
      actions.innerHTML = '<button class="btn btn-primary btn-sm" data-action="sign-in"><i class="fa-brands fa-google"></i>Sign in</button>';
    }
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

  function userMenu() {
    var d = state.data;
    var items =
      '<a class="conv" href="#/profile/' + esc(d.me.id) + '" data-action="close-modal"><i class="fa-regular fa-user"></i> My profile</a>' +
      '<a class="conv" href="#/me" data-action="close-modal"><i class="fa-solid fa-pen"></i> Edit profile</a>' +
      (d.isAdmin ? '<a class="conv" href="#/admin" data-action="close-modal"><i class="fa-solid fa-shield-halved"></i> Admin</a>' : '') +
      '<a class="conv" href="#" data-action="sign-out"><i class="fa-solid fa-arrow-right-from-bracket"></i> Sign out</a>';
    modal('<h2>' + esc(d.me.name) + '</h2><div class="conv-list">' + items + '</div>');
  }

  function guestMenu() {
    var items =
      '<a class="conv" href="#/register" data-action="close-modal"><i class="fa-solid fa-user-plus"></i> Complete registration</a>' +
      '<a class="conv" href="#" data-action="sign-out"><i class="fa-solid fa-arrow-right-from-bracket"></i> Sign out</a>';
    modal('<h2>Account</h2><div class="conv-list">' + items + '</div>');
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

  function viewHome() {
    var d = state.data;
    if (!d) return skeletons();
    var users = (d.users || []);
    var mentors = users.filter(function (u) { return u.role === 'mentor'; }).length;
    var participants = users.length - mentors;
    return '<div class="hive">' +
      '<div class="hive-legend">' +
      '<span><span class="dot mentor"></span>' + mentors + ' mentor' + (mentors === 1 ? '' : 's') + '</span>' +
      '<span><span class="dot participant"></span>' + participants + ' participant' + (participants === 1 ? '' : 's') + '</span>' +
      '</div>' +
      '<div class="hive-stage" id="hiveStage"><div class="word" id="word"></div></div>' +
      '<div class="hive-caption">' + (users.length ? 'Hover a face to preview' : 'Waiting for people to join — slots fill as they register') + '</div>' +
      '</div>';
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
    word.style.width = (maxX - minX) + 'px';
    word.style.height = (maxY - minY) + 'px';
    word.innerHTML = '';

    // map each assigned user onto a spread-out cell
    var order = slotOrder(cells), cellUser = {};
    for (var k = 0; k < users.length && k < order.length; k++) cellUser[order[k]] = users[k];

    cells.forEach(function (cell, i) {
      var u = cellUser[i];
      var el;
      if (u) {
        var mentor = u.role === 'mentor';
        el = document.createElement('a');
        el.className = 'oct ' + (mentor ? 'm' : 'p');
        el.href = '#/profile/' + u.id;
        el.title = u.name;
        el.innerHTML = '<div class="oct-in">' +
          (u.image ? '<img src="' + esc(u.image) + '" alt="" loading="lazy">' : '<span class="oct-blank">' + esc(initials(u.name)) + '</span>') +
          '</div>';
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
    preview.innerHTML = '<div class="oct-pin"><img id="hivePvImg" alt="">' +
      '<span class="oct-pvname"><span id="hivePvNm"></span><span class="oct-pvrole" id="hivePvRole"></span></span></div>';
    word.appendChild(preview);
    word.__preview = preview;

    fitWordmark();
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
    if (!stage || !word || !word.style.width) return;
    var ww = parseFloat(word.style.width), wh = parseFloat(word.style.height);
    var pad = 48;
    var s = Math.min((stage.clientWidth - pad) / ww, (stage.clientHeight - pad) / wh, 1.5);
    if (s > 0 && isFinite(s)) word.style.transform = 'scale(' + s + ')';
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
            : (signedIn() && me() ? '<button class="btn btn-primary btn-sm" data-action="chat-dm" data-email="' + esc(u.email || '') + '"><i class="fa-regular fa-message"></i><span class="label">Message</span><span class="spin"></span></button>'
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
      var hint = $('#photoHint');
      if (hint) hint.hidden = false;
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

  // ---- validation ----

  function normUrl(v) {
    v = String(v || '').trim();
    if (!v) return '';
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
    return v;
  }

  function validateProfile(form) {
    var fd = new FormData(form);
    if (!String(fd.get('name') || '').trim()) return 'Please enter your name.';
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
    var genders = opts('gender', ['Female', 'Male', 'Non-binary', 'Prefer not to say']);
    var skills = (u.skills || []);
    var vid = ytId(u.video || '');

    return '<form class="form pf-grid" id="profileForm" data-new="' + (isNew ? '1' : '') + '">' +

      '<div class="pf-left">' +
      '<div class="idcard-scene"><div class="idcard" id="idcard">' +

      // ---------------- front
      '<div class="idface idfront">' +
      '<div class="idcard-head"><span class="idcard-brand">ICE<b>2026</b></span>' +
      '<span class="idcard-type">' + (u.role === 'mentor' ? 'MENTOR' : 'MEMBER') + '</span></div>' +
      '<div class="idcard-main">' +
      '<div class="idcard-photo"><div class="photo-vp" id="photoVp">' +
      (u.image
        ? '<img class="photo-static" src="' + esc(u.image) + '" alt="">'
        : '<div class="photo-empty" data-action="photo-pick"><i class="fa-solid fa-camera"></i><span>Add photo</span></div>') +
      '<button type="button" class="photo-change" data-action="photo-pick" title="Change photo"><i class="fa-solid fa-camera"></i></button>' +
      '</div><span class="photo-hint" id="photoHint"' + (u.image ? '' : ' hidden') + '>drag to adjust · scroll to zoom</span></div>' +
      '<div class="idcard-fields">' +
      '<input class="cinput cname" name="name" required maxlength="100" placeholder="Full name" value="' + esc(u.name || '') + '">' +
      '<label class="cfield"><i class="fa-solid fa-building"></i><input class="cinput" name="affiliation" maxlength="70" placeholder="Affiliation — university, company" value="' + esc(u.affiliation || '') + '"></label>' +
      '<label class="cfield"><i class="fa-solid fa-lightbulb"></i><input class="cinput" name="expertise" maxlength="90" placeholder="Expertise — comma separated topics" value="' + esc(u.expertise || '') + '"></label>' +
      '</div></div>' +
      '<div class="idcard-foot"><span class="idcard-url">ice2026.designthinking.lk</span>' +
      '<button type="button" class="flip-btn" data-action="flip-card"><i class="fa-solid fa-rotate"></i><span>More on the back</span></button></div>' +
      '</div>' +

      // ---------------- back
      '<div class="idface idback">' +
      '<div class="idband"></div>' +
      '<textarea class="cinput cbio" name="bio" maxlength="260" placeholder="Short bio — who you are, what excites you">' + esc(u.bio || '') + '</textarea>' +
      '<div class="idlinks">' +
      '<label class="cfield"><i class="fa-brands fa-github"></i><input class="cinput" name="linkGithub" maxlength="200" placeholder="github.com/you" value="' + esc(lg) + '"></label>' +
      '<label class="cfield"><i class="fa-solid fa-globe"></i><input class="cinput" name="linkWebsite" maxlength="200" placeholder="yourwebsite.com" value="' + esc(lw) + '"></label>' +
      '<label class="cfield"><i class="fa-brands fa-linkedin-in"></i><input class="cinput" name="linkLinkedin" maxlength="200" placeholder="linkedin.com/in/you" value="' + esc(ll) + '"></label>' +
      '</div>' +
      '<div class="idcard-foot"><span class="idcard-url">' + esc(C.EVENT_TAGLINE) + '</span>' +
      '<button type="button" class="flip-btn" data-action="flip-card"><i class="fa-solid fa-rotate"></i><span>Front</span></button></div>' +
      '</div>' +

      '</div></div>' +
      '<input type="hidden" name="image" value="' + esc(u.image || '') + '">' +
      '<input type="file" id="photoFile" accept="image/*" hidden>' +
      '</div>' + // .pf-left

      '<div class="pf-right">' +
      '<div class="field"><label>Gender <span class="hint">optional, organizers only</span></label><select class="input" name="gender">' +
      [''].concat(genders).map(function (g) {
        return '<option value="' + esc(g) + '"' + (u.gender === g ? ' selected' : '') + '>' + (esc(g) || '—') + '</option>';
      }).join('') + '</select></div>' +
      '<div class="field"><label>Intro video <span class="hint">YouTube, optional</span></label>' +
      '<div class="yt-card" id="ytCard">' + ytCardHtml(u.video || '') + '</div>' +
      '<input type="hidden" name="video" value="' + (vid ? 'https://youtu.be/' + esc(vid) : '') + '"></div>' +

      '<div class="field"><label>Skills</label><div class="tag-input" id="skillTags" data-action="focus-tags">' +
      skills.map(tagChip).join('') +
      '<input id="skillInput" placeholder="Type a skill and press Enter"></div>' +
      '<div class="suggestions" id="skillSuggestions"></div></div>' +

      '<div class="form-status" id="profileStatus"></div>' +
      '<div class="form-actions"><button class="btn btn-gradient" type="submit"><span class="label">' + (isNew ? 'Join ' + esc(C.EVENT_NAME) : 'Save changes') + '</span><span class="spin"></span></button></div>' +
      '</div>' + // .pf-right
      '</form>';
  }

  function tagChip(s) {
    return '<span class="chip on" data-skill="' + esc(s) + '">' + esc(s) + '<i class="fa-solid fa-xmark" data-action="rm-tag"></i></span>';
  }

  function renderSkillSuggestions() {
    var box = $('#skillSuggestions');
    if (!box) return;
    var existing = getTagValues();
    var pool = {};
    opts('skill', C.SKILL_SUGGESTIONS).forEach(function (s) { pool[s] = 1; });
    ((state.data && state.data.users) || []).forEach(function (u) { (u.skills || []).forEach(function (s) { pool[s] = 1; }); });
    var items = Object.keys(pool).filter(function (s) {
      return existing.map(function(x){return x.toLowerCase();}).indexOf(s.toLowerCase()) === -1;
    }).slice(0, 14);
    box.innerHTML = items.map(function (s) {
      return '<span class="chip" data-action="add-tag" data-skill="' + esc(s) + '"><i class="fa-solid fa-plus" style="font-size:10px"></i>' + esc(s) + '</span>';
    }).join('');
  }

  function getTagValues() {
    return $all('#skillTags .chip').map(function (c) { return c.getAttribute('data-skill'); });
  }

  function addTag(s) {
    s = String(s || '').trim();
    if (!s) return;
    var lower = getTagValues().map(function (x) { return x.toLowerCase(); });
    if (lower.indexOf(s.toLowerCase()) !== -1) return;
    $('#skillInput').insertAdjacentHTML('beforebegin', tagChip(s));
    renderSkillSuggestions();
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
    if (!formReady()) return profileScaffold('Welcome to ' + esc(C.EVENT_NAME),
      'Set up your public profile so mentors and other participants can find you.', formLoading());
    setTimeout(afterProfileForm, 0);
    return profileScaffold('Welcome to ' + esc(C.EVENT_NAME),
      'Set up your public profile so mentors and other participants can find you.',
      profileForm(null, true));
  }

  function viewMe() {
    if (!signedIn() || !me()) { location.hash = signedIn() ? '#/register' : '#/'; return ''; }
    if (!formReady()) return profileScaffold('Edit profile', '', formLoading());
    setTimeout(afterProfileForm, 0);
    return profileScaffold('Edit profile', '', profileForm(me(), false));
  }

  function profileScaffold(title, sub, inner) {
    return '<div class="profile-edit"><h1 style="font-size:30px">' + title + '</h1>' +
      (sub ? '<p style="color:var(--text-body)">' + sub + '</p>' : '') + inner + '</div>';
  }

  function afterProfileForm() {
    photoEd = null; // fresh form; only set when the user picks a new photo
    renderSkillSuggestions();
    var vid = $('#profileForm [name="video"]');
    if (vid && vid.value) ytRender(vid.value); else wireYt();
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
  }

  // ----------------------------------------------------------------- admin

  // ---- Projects & Tools (logged-in only; placeholder content for now) ----

  function signInGate(what) {
    return '<div class="empty" style="margin-top:40px"><i class="fa-solid fa-lock"></i>' +
      'Sign in to view ' + esc(what) + '.<br><br>' +
      '<button class="btn btn-gradient" data-action="sign-in"><i class="fa-brands fa-google"></i>Sign in with Google</button></div>';
  }

  function viewProjects() {
    if (!signedIn()) return signInGate('projects');
    return '<div class="empty" style="margin-top:40px"><i class="fa-solid fa-diagram-project"></i>Projects are coming soon.<br>This is where teams will showcase what they are building.</div>';
  }

  function viewTools() {
    if (!signedIn()) return signInGate('tools');
    return '<div class="empty" style="margin-top:40px"><i class="fa-solid fa-toolbox"></i>Tools are coming soon.<br>Handy links and resources for the workshop will live here.</div>';
  }

  function viewAdmin() {
    var d = state.data;
    if (!d) return skeletons();
    if (!d.isAdmin) return '<div class="empty" style="margin-top:40px"><i class="fa-solid fa-shield-halved"></i>Admins only.</div>';
    var users = (d.users || []).slice().sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
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
    // Admin resource links. The database link is only present when the backend
    // exposes it (dbUrl in the bootstrap payload, admins only).
    var resourceLinks = [];
    if (d.dbUrl) {
      resourceLinks.push('<a class="admin-link" href="' + esc(d.dbUrl) + '" target="_blank" rel="noopener">' +
        '<span class="admin-link-icon db"><i class="fa-solid fa-database"></i></span>' +
        '<span class="admin-link-body"><span class="admin-link-title">Main database</span>' +
        '<span class="admin-link-sub">Connected Google Sheet — all tables</span></span>' +
        '<i class="fa-solid fa-arrow-up-right-from-square admin-link-ext"></i></a>');
    }
    var resourcesPanel = '<div class="panel" style="margin-bottom:22px"><h3><i class="fa-solid fa-link"></i>Database &amp; resources</h3>' +
      (resourceLinks.length
        ? '<div class="admin-links">' + resourceLinks.join('') + '</div>'
        : '<p style="color:var(--text-muted);margin:0">No linked resources yet.</p>') +
      '</div>';

    return '<div style="margin-top:8px"></div>' +
      resourcesPanel +
      '<div class="panel" style="margin-bottom:22px"><h3><i class="fa-solid fa-toggle-on"></i>Event settings</h3>' +
      '<label style="display:flex;align-items:center;gap:10px;cursor:pointer"><input type="checkbox" id="regToggle" ' + (d.registrationOpen ? 'checked' : '') + ' data-action="toggle-reg"> Registration open</label></div>' +
      '<div class="panel" style="margin-bottom:22px"><h3><i class="fa-solid fa-bullhorn"></i>Announcements</h3>' +
      '<button class="btn btn-outline btn-sm" data-action="new-ann"><i class="fa-solid fa-plus"></i>New announcement</button> ' +
      '<a class="btn btn-ghost btn-sm" href="#/announcements">Manage on the news page</a></div>' +
      '<h3 style="margin:26px 0 12px">People (' + users.length + ')</h3>' +
      '<div class="table-wrap"><table class="admin"><thead><tr><th>Name</th><th>Email</th><th>Affiliation</th><th>Role</th><th></th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }

  // ---------------------------------------------------------------- router

  var routes = [
    { re: /^#\/?$/, view: viewHome },
    { re: /^#\/profile\/([\w-]+)$/, view: viewProfile },
    { re: /^#\/teams$/, view: viewTeams },
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
          var chips = $all('#skillTags .chip');
          if (chips.length) { chips[chips.length - 1].remove(); renderSkillSuggestions(); }
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
    return {
      name: fd.get('name'),
      image: fd.get('image'),
      affiliation: fd.get('affiliation'),
      gender: fd.get('gender'),
      bio: fd.get('bio'),
      expertise: fd.get('expertise'),
      skills: getTagValues(),
      links: links,
      video: video,
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
      case 'sign-out': e.preventDefault(); closeModal(); A.signOut(); break;
      case 'user-menu': userMenu(); break;
      case 'guest-menu': guestMenu(); break;
      case 'close-modal': closeModal(); break;
      case 'filter-skill': {
        var s = t.getAttribute('data-skill');
        state.skillFilter = state.skillFilter === s ? null : s;
        if (!/^#\/?$/.test(location.hash || '#/')) location.hash = '#/'; else route();
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
      case 'add-tag': addTag(t.getAttribute('data-skill')); break;
      case 'rm-tag': t.closest('.chip').remove(); renderSkillSuggestions(); break;
      case 'focus-tags': { var si3 = $('#skillInput'); if (si3 && e.target === t) si3.focus(); break; }
    }
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
        refresh();
      } catch (err) { toast(err.message, true); }
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
        await A.api(isNew ? 'register' : 'update_profile', payload);
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

  // Sidebar collapse/expand — collapsed (icons only) by default; persisted.
  (function initSidebar() {
    var sidebar = $('#sidebar');
    var toggle = $('#sidebarToggle');
    if (!sidebar || !toggle) return;
    if (localStorage.getItem('ice2026.sidebar') === 'expanded') sidebar.classList.add('expanded');
    toggle.addEventListener('click', function () {
      var expanded = sidebar.classList.toggle('expanded');
      localStorage.setItem('ice2026.sidebar', expanded ? 'expanded' : 'collapsed');
      toggle.setAttribute('aria-label', expanded ? 'Collapse menu' : 'Expand menu');
    });
    // The content area resizes when the sidebar expands/collapses; rebuild the
    // wordmark once the width transition settles so it stays centred.
    sidebar.addEventListener('transitionend', function (e) {
      if (e.propertyName === 'width' && $('#word')) buildWordmark();
    });
  })();

  (function boot() {
    var justSignedIn = A.absorbLoginToken();
    state.data = A.readCache();
    renderChrome();
    route();
    refresh().then(function () {
      if (justSignedIn && signedIn() && state.data && !state.data.me) {
        location.hash = '#/register';
      }
    });
  })();
})();
