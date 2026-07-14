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
    pollTimer: null,
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
    if (signedIn() && d.me) {
      navMsg.hidden = false;
      var b = $('#unreadBadge');
      if (d.unread > 0) { b.hidden = false; b.textContent = d.unread > 99 ? '99+' : d.unread; }
      else b.hidden = true;
      actions.innerHTML =
        '<button class="avatar-btn" data-action="user-menu">' + avatar(d.me, 'avatar-sm') +
        '<span>' + esc(d.me.name.split(' ')[0]) + '</span><i class="fa-solid fa-chevron-down" style="font-size:10px;color:var(--text-faint)"></i></button>';
    } else if (signedIn()) {
      navMsg.hidden = true;
      actions.innerHTML = '<a class="btn btn-gradient btn-sm" href="#/register"><i class="fa-solid fa-user-plus"></i>Complete registration</a>' +
        '<button class="btn btn-ghost btn-sm" data-action="sign-out">Sign out</button>';
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

  // People view — honeycomb of all 46 people (16 mentors clustered in the
  // center, 30 participants around them). Dummy data until wired to backend.

  var HIVE_ROWS = [7, 6, 7, 6, 7, 6, 7]; // 46 cells
  var MENTOR_COUNT = 16;

  var DUMMY_NAMES = [
    'Aisha Rahman', 'Ben Carter', 'Chloe Nakamura', 'Daniel Osei', 'Elena Petrova',
    'Farhan Iqbal', 'Grace Lin', 'Hugo Martins', 'Isla Thompson', 'Jae-won Kim',
    'Kavya Nair', "Liam O'Connor", 'Maya Fernando', 'Nikolai Volkov', 'Olivia Bennett',
    'Priya Sharma', 'Quentin Dubois', 'Rosa Alvarez', 'Samir Haddad', 'Tara Wickramasinghe',
    'Umar Farouk', 'Vera Kowalski', 'Wei Zhang', 'Ximena Torres', 'Yuki Tanaka',
    'Zainab Ali', 'Arun Perera', 'Bianca Rossi', 'Callum Fraser', 'Devi Kumari',
    'Emil Johansson', 'Fatima Zahra', 'George Mwangi', 'Hana Suzuki', 'Ivan Horvat',
    'Jasmine Lee', 'Kofi Mensah', 'Lara Novak', 'Marco Silva', 'Nadia Hussain',
    'Owen Walsh', 'Pia Lindgren', 'Rafael Mendes', 'Sofia Papadopoulos', 'Tomás Herrera',
    'Uma Raghavan',
  ];

  function hiveCells() {
    // Cell centers in hex-width units; y rows are 0.866 apart (pointy-top).
    var cells = [];
    HIVE_ROWS.forEach(function (count, r) {
      for (var i = 0; i < count; i++) {
        cells.push({ x: i - (count - 1) / 2, y: r * 0.866, row: r });
      }
    });
    // The MENTOR_COUNT cells nearest the grid center become mentor tiles.
    var cy = 0.866 * (HIVE_ROWS.length - 1) / 2;
    var byDist = cells.map(function (c, idx) {
      return { idx: idx, d: Math.sqrt(c.x * c.x + (c.y - cy) * (c.y - cy)) };
    }).sort(function (a, b) { return a.d - b.d; });
    var mentorIdx = {};
    byDist.slice(0, MENTOR_COUNT).forEach(function (e) { mentorIdx[e.idx] = true; });
    cells.forEach(function (c, idx) { c.mentor = !!mentorIdx[idx]; });
    return cells;
  }

  function viewHome() {
    var cells = hiveCells();
    var person = 0;
    var rowsHtml = '';
    var cellNo = 0;
    HIVE_ROWS.forEach(function (count) {
      var hexes = '';
      for (var i = 0; i < count; i++, cellNo++) {
        var c = cells[cellNo];
        var name = DUMMY_NAMES[person % DUMMY_NAMES.length];
        var img = 'https://i.pravatar.cc/220?img=' + ((person % 70) + 1);
        person++;
        hexes += '<div class="hex ' + (c.mentor ? 'mentor' : 'participant') + '" title="' + esc(name) + (c.mentor ? ' · Mentor' : '') + '">' +
          '<div class="hex-in"><img src="' + img + '" alt="" loading="lazy">' +
          '<span class="hex-name">' + esc(name) + '</span></div></div>';
      }
      rowsHtml += '<div class="hive-row">' + hexes + '</div>';
    });

    return '<div class="people-page">' +
      '<div class="people-head"><h2>People</h2>' +
      '<div class="legend"><span><span class="dot mentor"></span>' + MENTOR_COUNT + ' mentors</span>' +
      '<span><span class="dot participant"></span>30 participants</span></div></div>' +
      '<div class="hive-wrap" id="hiveWrap"><div class="hive" id="hive">' + rowsHtml + '</div></div>' +
      '</div>';
  }

  // Size the hexes so the whole hive fits the available area with no scroll.
  function fitHive() {
    var wrap = $('#hiveWrap');
    var hive = $('#hive');
    if (!wrap || !hive) return;
    var gap = 7;
    var cols = Math.max.apply(null, HIVE_ROWS);
    var n = HIVE_ROWS.length;
    var wFit = (wrap.clientWidth - (cols - 1) * gap) / cols;
    var hFit = ((wrap.clientHeight - (n - 1) * gap * 0.87) / (1 + 0.75 * (n - 1))) / 1.1547;
    var hw = Math.max(40, Math.floor(Math.min(wFit, hFit)));
    hive.style.setProperty('--hw', hw + 'px');
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
            : (signedIn() && me() ? '<a class="btn btn-primary btn-sm" href="#/messages/' + esc(u.id) + '"><i class="fa-regular fa-message"></i>Message</a>'
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
    var head = '<div class="section-head" style="margin-top:16px"><h2 style="font-size:30px">Teams</h2>' +
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

  function viewAnnouncements() {
    var d = state.data;
    if (!d) return skeletons();
    var anns = (d.announcements || []).slice().sort(function (a, b) {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      return a.createdAt < b.createdAt ? 1 : -1;
    });
    var head = '<div class="section-head" style="margin-top:16px"><h2 style="font-size:30px">Announcements</h2>' +
      (d.isAdmin ? '<button class="btn btn-gradient btn-sm" data-action="new-ann"><i class="fa-solid fa-plus"></i>New announcement</button>' : '') + '</div>';
    if (!anns.length) return head + '<div class="empty"><i class="fa-solid fa-bullhorn"></i>No announcements yet.</div>';
    return head + anns.map(function (a) {
      var author = userById(a.authorId);
      return '<div class="card ann"><div class="ann-head">' +
        (a.isPinned ? '<span class="ann-pin" title="Pinned"><i class="fa-solid fa-thumbtack"></i></span>' : '') +
        '<h3>' + esc(a.title) + '</h3>' +
        '<span class="ann-type ' + esc(a.type) + '">' + esc(a.type) + '</span>' +
        '<span class="ann-date">' + (author ? esc(author.name) + ' · ' : '') + esc(timeAgo(a.createdAt)) + '</span>' +
        (d.isAdmin ? '<span><button class="btn btn-ghost btn-sm" data-action="edit-ann" data-id="' + esc(a.id) + '"><i class="fa-solid fa-pen"></i></button>' +
          '<button class="btn btn-ghost btn-sm" data-action="del-ann" data-id="' + esc(a.id) + '"><i class="fa-regular fa-trash-can"></i></button></span>' : '') +
        '</div><p class="ann-body">' + esc(a.content) + '</p></div>';
    }).join('');
  }

  function annForm(a) {
    a = a || {};
    modal('<h2>' + (a.id ? 'Edit announcement' : 'New announcement') + '</h2>' +
      '<form class="form" id="annForm" data-id="' + esc(a.id || '') + '">' +
      '<div class="field"><label>Title</label><input class="input" name="title" required maxlength="200" value="' + esc(a.title || '') + '"></div>' +
      '<div class="field"><label>Content</label><textarea class="input" name="content" required maxlength="5000" rows="6">' + esc(a.content || '') + '</textarea></div>' +
      '<div class="form-row">' +
      '<div class="field"><label>Type</label><select class="input" name="type">' +
      ['general', 'important', 'urgent'].map(function (t) { return '<option' + (a.type === t ? ' selected' : '') + '>' + t + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="field"><label>Pinned</label><select class="input" name="isPinned"><option value="false">No</option><option value="true"' + (a.isPinned ? ' selected' : '') + '>Yes</option></select></div>' +
      '</div><div class="form-status" id="annFormStatus"></div>' +
      '<div class="form-actions"><button class="btn btn-gradient" type="submit"><span class="label">' + (a.id ? 'Save' : 'Publish') + '</span><span class="spin"></span></button>' +
      '<button class="btn btn-ghost" type="button" data-action="close-modal">Cancel</button></div></form>');
  }

  // -------------------------------------------------------------- messages

  function viewMessages(peerId) {
    if (!signedIn() || !me()) {
      return '<div class="empty" style="margin-top:40px"><i class="fa-regular fa-message"></i>Sign in to see your messages.<br><br>' +
        '<button class="btn btn-primary" data-action="sign-in"><i class="fa-brands fa-google"></i>Sign in</button></div>';
    }
    // async load inbox + thread
    loadMessages(peerId);
    var peer = peerId ? userById(peerId) : null;
    return '<div class="section-head" style="margin-top:16px"><h2 style="font-size:30px">Messages</h2></div>' +
      '<div class="msg-layout">' +
      '<div class="conv-list" id="convList"><div class="skeleton" style="height:60px"></div></div>' +
      '<div class="panel thread" id="threadPanel">' +
      (peer
        ? '<h3 style="margin-bottom:10px">' + avatar(peer, 'avatar-sm') + ' <a href="#/profile/' + esc(peer.id) + '">' + esc(peer.name) + '</a></h3>' +
          '<div class="thread-scroll" id="threadScroll"><div class="skeleton" style="height:60px"></div></div>' +
          '<div class="thread-input"><textarea class="input" id="msgInput" placeholder="Write a message…"></textarea>' +
          '<button class="btn btn-primary" data-action="send-msg" data-peer="' + esc(peerId) + '"><span class="label"><i class="fa-regular fa-paper-plane"></i></span><span class="spin"></span></button></div>'
        : '<div class="empty" style="border:none"><i class="fa-regular fa-comments"></i>Pick a conversation, or open someone\'s profile and press Message.</div>') +
      '</div></div>';
  }

  async function loadMessages(peerId) {
    try {
      var inbox = await A.api('msg_inbox');
      var list = $('#convList');
      if (list) {
        var convs = inbox.conversations || [];
        list.innerHTML = convs.length ? convs.map(function (c) {
          var p = userById(c.peerId) || { name: 'Unknown' };
          return '<a class="conv' + (c.peerId === peerId ? ' active' : '') + '" href="#/messages/' + esc(c.peerId) + '">' +
            avatar(p, 'avatar-sm') + '<div style="flex:1;min-width:0"><div class="who">' + esc(p.name) +
            (c.unread ? ' <b class="badge">' + c.unread + '</b>' : '') + '</div>' +
            '<div class="last">' + esc(c.last ? c.last.content : '') + '</div></div></a>';
        }).join('') : '<div class="empty" style="padding:24px"><i class="fa-regular fa-envelope-open"></i>No conversations yet.</div>';
      }
      if (peerId) {
        var r = await A.api('msg_thread', { peerId: peerId });
        renderThread(r.messages || []);
      }
    } catch (err) {
      toast(err.message || 'Could not load messages', true);
    }
  }

  function renderThread(messages) {
    var scroll = $('#threadScroll');
    if (!scroll) return;
    var myId = me().id;
    scroll.innerHTML = messages.length ? messages.map(function (m) {
      return '<div class="bubble ' + (m.senderId === myId ? 'me' : 'them') + '">' + esc(m.content) +
        '<time>' + esc(timeAgo(m.createdAt)) + '</time></div>';
    }).join('') : '<div style="color:var(--text-muted);text-align:center;padding:30px 0">Say hello — this is the beginning of your conversation.</div>';
    scroll.scrollTop = scroll.scrollHeight;
  }

  // ------------------------------------------------------ register / edit

  function profileForm(u, isNew) {
    u = u || {};
    var skills = (u.skills || []);
    return '<form class="form" id="profileForm" data-new="' + (isNew ? '1' : '') + '">' +
      '<div class="field"><label>Full name</label><input class="input" name="name" required maxlength="100" value="' + esc(u.name || '') + '"></div>' +
      '<div class="field"><label>Photo</label><div class="photo-edit">' +
      '<input type="hidden" name="image" value="' + esc(u.image || '') + '">' +
      '<img id="photoPreview" src="' + esc(u.image || '') + '" alt="" class="avatar avatar-lg" style="' + (u.image ? '' : 'display:none') + '">' +
      '<button type="button" class="btn btn-outline btn-sm" data-action="pick-image" data-target="image" data-preview="photoPreview"><i class="fa-regular fa-image"></i><span class="label">Upload photo</span><span class="spin"></span></button>' +
      '<span class="hint">Square works best. Resized automatically.</span></div></div>' +
      '<div class="form-row">' +
      '<div class="field"><label>Affiliation <span class="hint">university, company…</span></label><input class="input" name="affiliation" maxlength="200" value="' + esc(u.affiliation || '') + '"></div>' +
      '<div class="field"><label>Gender <span class="hint">optional, organizers only</span></label><select class="input" name="gender">' +
      ['', 'Female', 'Male', 'Non-binary', 'Prefer not to say'].map(function (g) {
        return '<option value="' + esc(g) + '"' + (u.gender === g ? ' selected' : '') + '>' + (g || '—') + '</option>';
      }).join('') + '</select></div></div>' +
      '<div class="field"><label>Short bio</label><textarea class="input" name="bio" maxlength="2000" rows="4" placeholder="Tell everyone who you are and what excites you.">' + esc(u.bio || '') + '</textarea></div>' +
      '<div class="field"><label>Expertise areas <span class="hint">comma separated topics</span></label><input class="input" name="expertise" maxlength="500" value="' + esc(u.expertise || '') + '"></div>' +
      '<div class="field"><label>Skills</label><div class="tag-input" id="skillTags" data-action="focus-tags">' +
      skills.map(tagChip).join('') +
      '<input id="skillInput" placeholder="Type a skill and press Enter"></div>' +
      '<div class="suggestions" id="skillSuggestions"></div></div>' +
      '<div class="field"><label>Links <span class="hint">one per line — portfolio, LinkedIn, GitHub…</span></label>' +
      '<textarea class="input" name="links" rows="3" placeholder="https://…">' + esc((u.links || []).join('\n')) + '</textarea></div>' +
      '<div class="field"><label>Intro video URL <span class="hint">optional</span></label><input class="input" name="video" maxlength="300" value="' + esc(u.video || '') + '"></div>' +
      '<div class="form-status" id="profileStatus"></div>' +
      '<div class="form-actions"><button class="btn btn-gradient" type="submit"><span class="label">' + (isNew ? 'Join ' + esc(C.EVENT_NAME) : 'Save changes') + '</span><span class="spin"></span></button></div>' +
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
    C.SKILL_SUGGESTIONS.forEach(function (s) { pool[s] = 1; });
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
    setTimeout(renderSkillSuggestions, 0);
    return '<div style="max-width:640px;margin:20px auto 0"><h1 style="font-size:30px">Welcome to ' + esc(C.EVENT_NAME) + '</h1>' +
      '<p style="color:var(--text-body)">Set up your public profile so mentors and other participants can find you.</p>' +
      profileForm(null, true) + '</div>';
  }

  function viewMe() {
    if (!signedIn() || !me()) { location.hash = signedIn() ? '#/register' : '#/'; return ''; }
    setTimeout(renderSkillSuggestions, 0);
    return '<div style="max-width:640px;margin:20px auto 0"><h1 style="font-size:30px">Edit profile</h1>' +
      profileForm(me(), false) + '</div>';
  }

  // ----------------------------------------------------------------- admin

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
    return '<div class="section-head" style="margin-top:16px"><h2 style="font-size:30px">Admin</h2></div>' +
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
    { re: /^#\/announcements$/, view: viewAnnouncements },
    { re: /^#\/messages$/, view: viewMessages },
    { re: /^#\/messages\/([\w-]+)$/, view: viewMessages },
    { re: /^#\/register$/, view: viewRegister },
    { re: /^#\/me$/, view: viewMe },
    { re: /^#\/admin$/, view: viewAdmin },
  ];

  function route() {
    var hash = location.hash || '#/';
    clearInterval(state.pollTimer);
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
    // people hive: size hexes to the viewport once laid out
    if ($('#hiveWrap')) requestAnimationFrame(fitHive);
    // message polling
    if (/^#\/messages/.test(hash)) {
      state.pollTimer = setInterval(function () {
        if (/^#\/messages/.test(location.hash)) loadMessages(m && m[1]);
      }, 20000);
    }
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
    return {
      name: fd.get('name'),
      image: fd.get('image'),
      affiliation: fd.get('affiliation'),
      gender: fd.get('gender'),
      bio: fd.get('bio'),
      expertise: fd.get('expertise'),
      skills: getTagValues(),
      links: String(fd.get('links') || '').split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean),
      video: fd.get('video'),
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
      case 'send-msg': {
        var box = $('#msgInput');
        var msg = box && box.value.trim();
        if (!msg) break;
        busy(t, true);
        try {
          await A.api('msg_send', { toId: t.getAttribute('data-peer'), content: msg });
          box.value = '';
          await loadMessages(t.getAttribute('data-peer'));
        } catch (err) { toast(err.message, true); }
        busy(t, false);
        break;
      }
      case 'new-ann': annForm(); break;
      case 'edit-ann': {
        var ann = null;
        (state.data.announcements || []).forEach(function (x) { if (x.id === id) ann = x; });
        annForm(ann);
        break;
      }
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
      status.textContent = '';
      busy(btn, true);
      try {
        var payload = collectProfile(form);
        var isNew = form.getAttribute('data-new') === '1';
        await A.api(isNew ? 'register' : 'update_profile', payload);
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
      busy(btn, true);
      var fd2 = new FormData(form);
      var annId = form.getAttribute('data-id');
      var body2 = {
        title: fd2.get('title'), content: fd2.get('content'),
        type: fd2.get('type'), isPinned: fd2.get('isPinned') === 'true',
      };
      try {
        annId ? await A.api('ann_update', Object.assign({ id: annId }, body2))
              : await A.api('ann_create', body2);
        closeModal();
        await refresh();
        location.hash = '#/announcements';
        toast('Announcement published');
      } catch (err) {
        $('#annFormStatus').textContent = err.message;
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
  window.addEventListener('resize', fitHive);

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
