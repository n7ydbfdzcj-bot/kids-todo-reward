/* 우리집 할일 캐시
 * 아이와 부모가 함께 쓰는 할 일 체크 · 현금 보상 웹앱
 * 순수 HTML/CSS/JS (빌드 없음). 아래 KTR 객체는 node 테스트용으로 내보낸다.
 */
(function (root) {
  'use strict';

  var STORAGE_KEY = 'kidsTodoReward.state.v1';
  var SYNC_KEY = 'kidsTodoReward.sync.v1';
  var DEVICE_KEY = 'kidsTodoReward.device.v1';
  var HINT_KEY = 'kidsTodoReward.installHint.v1';
  var POLL_MS = 3000;
  var APP_VERSION = '1.0.0';

  var DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
  var EMOJI_CHOICES = ['⭐', '🪥', '📚', '📖', '🧸', '🧹', '🍽️', '🎒', '🚿', '🛏️', '🎹', '🏃', '🐶', '🧺', '✏️', '🎨', '🧮', '🌱', '💧', '🧦', '🥕', '🎵'];

  /* ---------------------------------------------------------------- utils */

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function dateKeyOf(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function todayKey(d) { return dateKeyOf(d || new Date()); }

  function parseDateKey(key) {
    var p = String(key).split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function won(n) {
    var v = Math.round(Number(n) || 0);
    return v.toLocaleString('ko-KR') + '원';
  }

  function signedWon(n) {
    var v = Math.round(Number(n) || 0);
    return (v > 0 ? '+' : v < 0 ? '-' : '') + Math.abs(v).toLocaleString('ko-KR') + '원';
  }

  function digits(str) { return Number(String(str).replace(/[^0-9]/g, '')) || 0; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

  function sum(list, pick) {
    var t = 0;
    for (var i = 0; i < list.length; i++) { t += Number(pick(list[i])) || 0; }
    return t;
  }

  function findById(list, id) {
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) { return list[i]; } }
    return null;
  }

  function byTimeDesc(field) {
    return function (a, b) { return (Number(b[field]) || 0) - (Number(a[field]) || 0); };
  }

  function dateLabel(key) {
    var today = todayKey();
    if (key === today) { return '오늘'; }
    if (key === dateKeyOf(new Date(Date.now() - 86400000))) { return '어제'; }
    var d = parseDateKey(key);
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
  }

  function timeLabel(ts) {
    var d = new Date(Number(ts) || 0);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function scheduleLabel(schedule) {
    var s = schedule || { type: 'daily' };
    if (s.type === 'weekly') {
      var days = (s.days || []).slice().sort();
      if (!days.length) { return '요일 미선택'; }
      if (days.length >= 7) { return '매일'; }
      return days.map(function (d) { return DAY_LABELS[d]; }).join('·') + '요일';
    }
    if (s.type === 'once') {
      if (!s.date) { return '날짜 미선택'; }
      var d = parseDateKey(s.date);
      return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 하루';
    }
    return '매일';
  }

  function greeting(name) {
    var h = new Date().getHours();
    var who = name ? name + ' ' : '';
    if (h < 11) { return { emoji: '🌤️', title: who + '좋은 아침이야!' }; }
    if (h < 17) { return { emoji: '🍀', title: who + '좋은 오후야!' }; }
    return { emoji: '🌙', title: who + '좋은 저녁이야!' };
  }

  /* ---------------------------------------------------------------- state */

  function seedTasks(now) {
    var seed = [
      ['양치하기', '🪥', 'daily', ''],
      ['숙제하기', '📚', 'weekly', [1, 3, 5]],
      ['책 10분 읽기', '📖', 'daily', ''],
      ['방 정리하기', '🧸', 'weekly', [2, 4]],
      ['식사 도와주기', '🍽️', 'daily', '']
    ];
    return seed.map(function (row, i) {
      var schedule = { type: row[2] };
      if (row[3]) { schedule.days = row[3]; }
      return {
        id: uid(), title: row[0], emoji: row[1], reward: 300,
        schedule: schedule, active: true, createdAt: now + i
      };
    });
  }

  function newState() {
    var now = Date.now();
    return {
      v: 1,
      meta: { rev: 1, updatedAt: now, updatedBy: deviceId() },
      settings: { pin: '0000', defaultReward: 300, childName: '' },
      tasks: seedTasks(now),
      completions: [],
      payouts: [],
      adjustments: []
    };
  }

  function normSchedule(s) {
    var out = { type: 'daily' };
    if (s && (s.type === 'weekly' || s.type === 'once' || s.type === 'daily')) { out.type = s.type; }
    if (out.type === 'weekly') {
      var days = (s && Array.isArray(s.days)) ? s.days : [1, 2, 3, 4, 5];
      out.days = days.filter(function (d) { return typeof d === 'number' && d >= 0 && d <= 6; });
    }
    if (out.type === 'once') { out.date = (s && s.date) ? String(s.date).slice(0, 10) : ''; }
    return out;
  }

  function normTask(t) {
    if (!t || typeof t !== 'object') { return null; }
    return {
      id: t.id || uid(),
      title: String(t.title || '할 일').slice(0, 40),
      emoji: String(t.emoji || '⭐').slice(0, 8),
      reward: clamp(Math.round(Number(t.reward) || 0), 0, 100000),
      schedule: normSchedule(t.schedule),
      active: t.active !== false,
      createdAt: Number(t.createdAt) || Date.now()
    };
  }

  function normCompletion(c) {
    if (!c || typeof c !== 'object') { return null; }
    var status = c.status;
    if (status !== 'pending' && status !== 'approved' && status !== 'rejected') { status = 'pending'; }
    return {
      id: c.id || uid(),
      taskId: String(c.taskId || ''),
      date: String(c.date || todayKey()).slice(0, 10),
      taskTitle: String(c.taskTitle || ''),
      emoji: String(c.emoji || '⭐'),
      reward: clamp(Math.round(Number(c.reward) || 0), 0, 100000),
      status: status,
      requestedAt: Number(c.requestedAt) || Date.now(),
      reviewedAt: Number(c.reviewedAt) || null,
      note: String(c.note || ''),
      attempts: Number(c.attempts) || 1
    };
  }

  function normPayout(p) {
    if (!p || typeof p !== 'object') { return null; }
    var status = p.status;
    if (status !== 'requested' && status !== 'paid' && status !== 'canceled') { status = 'requested'; }
    return {
      id: p.id || uid(),
      amount: clamp(Math.round(Number(p.amount) || 0), 0, 1000000),
      status: status,
      requestedAt: Number(p.requestedAt) || Date.now(),
      paidAt: Number(p.paidAt) || null
    };
  }

  function normAdjust(a) {
    if (!a || typeof a !== 'object') { return null; }
    return {
      id: a.id || uid(),
      amount: Math.round(Number(a.amount) || 0),
      memo: String(a.memo || ''),
      createdAt: Number(a.createdAt) || Date.now()
    };
  }

  function normalize(raw) {
    var d = (raw && typeof raw === 'object') ? raw : {};
    var out = {
      v: 1,
      meta: Object.assign({ rev: 1, updatedAt: Date.now(), updatedBy: '' }, d.meta || {}),
      settings: Object.assign({ pin: '0000', defaultReward: 300, childName: '' }, d.settings || {}),
      tasks: (Array.isArray(d.tasks) ? d.tasks : []).map(normTask).filter(Boolean),
      completions: (Array.isArray(d.completions) ? d.completions : []).map(normCompletion).filter(Boolean),
      payouts: (Array.isArray(d.payouts) ? d.payouts : []).map(normPayout).filter(Boolean),
      adjustments: (Array.isArray(d.adjustments) ? d.adjustments : []).map(normAdjust).filter(Boolean)
    };
    out.meta.rev = Number(out.meta.rev) || 1;
    out.meta.updatedAt = Number(out.meta.updatedAt) || Date.now();
    if (!/^\d{4}$/.test(String(out.settings.pin))) { out.settings.pin = '0000'; }
    out.settings.defaultReward = clamp(Math.round(Number(out.settings.defaultReward) || 300), 0, 100000);
    out.settings.childName = String(out.settings.childName || '').slice(0, 12);
    return out;
  }

  /* --------------------------------------------------------------- domain */

  function matchesDate(task, key) {
    var s = task.schedule || { type: 'daily' };
    var dow = parseDateKey(key).getDay();
    if (s.type === 'weekly') { return (s.days || []).indexOf(dow) >= 0; }
    if (s.type === 'once') { return s.date === key; }
    return true;
  }

  function tasksForDate(list, key) {
    return list.tasks.filter(function (t) {
      return t.active !== false && matchesDate(t, key);
    });
  }

  function completionFor(list, taskId, key) {
    for (var i = 0; i < list.completions.length; i++) {
      var c = list.completions[i];
      if (c.taskId === taskId && c.date === key) { return c; }
    }
    return null;
  }

  function computeStats(list) {
    var earned = 0, pendingEarn = 0, paidOut = 0, requested = 0;
    list.completions.forEach(function (c) {
      if (c.status === 'approved') { earned += Number(c.reward) || 0; }
      else if (c.status === 'pending') { pendingEarn += Number(c.reward) || 0; }
    });
    list.payouts.forEach(function (p) {
      if (p.status === 'paid') { paidOut += Number(p.amount) || 0; }
      else if (p.status === 'requested') { requested += Number(p.amount) || 0; }
    });
    var adjusted = sum(list.adjustments, function (a) { return a.amount; });
    var balance = earned - paidOut + adjusted;
    return {
      earned: earned,
      pendingEarn: pendingEarn,
      paidOut: paidOut,
      requested: requested,
      adjusted: adjusted,
      balance: balance,
      available: balance - requested
    };
  }

  /* ------------------------------------------------------------- storage */

  var state = null;

  function deviceId() {
    try {
      var v = localStorage.getItem(DEVICE_KEY);
      if (!v) { v = uid(); localStorage.setItem(DEVICE_KEY, v); }
      return v;
    } catch (e) { return 'device'; }
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) { return normalize(JSON.parse(raw)); }
    } catch (e) { /* 손상된 저장값은 새로 시작 */ }
    return newState();
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* 저장 공간 부족 등 */ }
  }

  function commit(mutator) {
    mutator(state);
    state.meta.rev = (Number(state.meta.rev) || 0) + 1;
    state.meta.updatedAt = Date.now();
    state.meta.updatedBy = deviceId();
    saveState();
    render();
    schedulePush();
  }

  /* ---------------------------------------------------------------- sync */

  var sync = { cfg: null, status: 'local', error: '', lastSync: 0, timer: null, pushTimer: null, inflight: false };

  function normalizeDbUrl(u) {
    var s = String(u || '').trim();
    if (!s) { return ''; }
    if (!/^https?:\/\//i.test(s)) { s = 'https://' + s; }
    s = s.replace(/\/+$/, '');
    s = s.replace(/\/families\/?.*$/i, '');
    return s;
  }

  function sanitizeRoom(r) {
    return String(r || '').trim().toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[.#$\[\]\/]/g, '')
      .slice(0, 40);
  }

  function isSyncReady() { return !!(sync.cfg && sync.cfg.url && sync.cfg.room); }

  function endpointUrl() {
    return sync.cfg.url + '/families/' + encodeURIComponent(sync.cfg.room) + '.json';
  }

  function loadSync() {
    try {
      var raw = localStorage.getItem(SYNC_KEY);
      if (!raw) { return; }
      var c = JSON.parse(raw);
      if (c && c.url && c.room) {
        sync.cfg = { url: normalizeDbUrl(c.url), room: sanitizeRoom(c.room) };
        sync.status = 'connecting';
      }
    } catch (e) { /* 설정 없음 */ }
  }

  function saveSync() {
    try {
      if (sync.cfg) { localStorage.setItem(SYNC_KEY, JSON.stringify(sync.cfg)); }
      else { localStorage.removeItem(SYNC_KEY); }
    } catch (e) { /* 무시 */ }
  }

  function schedulePush() {
    if (!isSyncReady()) { return; }
    if (sync.pushTimer) { clearTimeout(sync.pushTimer); }
    sync.pushTimer = setTimeout(function () { sync.pushTimer = null; pushNow(); }, 500);
  }

  async function pushNow() {
    if (!isSyncReady()) { return; }
    try {
      var res = await fetch(endpointUrl(), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
        cache: 'no-store'
      });
      if (!res.ok) { throw new Error('HTTP ' + res.status); }
      sync.status = 'connected';
      sync.error = '';
      sync.lastSync = Date.now();
    } catch (e) {
      sync.status = 'error';
      sync.error = (e && e.message) || '연결 실패';
    }
    renderStatusOnly();
  }

  async function pullNow() {
    if (!isSyncReady() || sync.inflight) { return; }
    sync.inflight = true;
    try {
      var res = await fetch(endpointUrl() + '?ts=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) { throw new Error('HTTP ' + res.status); }
      var remote = await res.json();
      if (remote && remote.meta && typeof remote.meta.rev !== 'undefined') {
        var localRev = Number(state.meta.rev) || 0;
        var remoteRev = Number(remote.meta.rev) || 0;
        if (remoteRev > localRev ||
          (remoteRev === localRev && (Number(remote.meta.updatedAt) || 0) > (Number(state.meta.updatedAt) || 0))) {
          if (remote.meta.updatedBy !== deviceId()) {
            state = normalize(remote);
            saveState();
            render();
            toast('다른 기기와 맞췄어요');
          }
        } else if (localRev > remoteRev) {
          await pushNow();
        }
      } else if (remote === null) {
        await pushNow();
      }
      sync.status = 'connected';
      sync.error = '';
      sync.lastSync = Date.now();
    } catch (e) {
      sync.status = 'error';
      sync.error = (e && e.message) || '연결 실패';
    } finally {
      sync.inflight = false;
      renderStatusOnly();
    }
  }

  function startSync() {
    stopSync();
    if (!isSyncReady()) { sync.status = 'local'; renderStatusOnly(); return; }
    sync.status = 'connecting';
    renderStatusOnly();
    pullNow();
    sync.timer = setInterval(function () {
      if (document.visibilityState === 'visible') { pullNow(); }
    }, POLL_MS);
  }

  function stopSync() {
    if (sync.timer) { clearInterval(sync.timer); sync.timer = null; }
    if (sync.pushTimer) { clearTimeout(sync.pushTimer); sync.pushTimer = null; }
  }

  /* ------------------------------------------------------------------ ui */

  var ui = { mode: 'child', tab: 'home', sheet: null, pin: null, lastDay: todayKey(), hintDismissed: false };
  var toastTimer = null;

  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) { return; }
    el.textContent = msg;
    el.classList.add('is-show');
    if (toastTimer) { clearTimeout(toastTimer); }
    toastTimer = setTimeout(function () { el.classList.remove('is-show'); }, 2400);
  }

  function confetti() {
    var emojis = ['⭐', '✨', '🎉', '💗', '🍬', '☁️'];
    for (var i = 0; i < 14; i++) {
      var s = document.createElement('span');
      s.className = 'confetti';
      s.textContent = emojis[i % emojis.length];
      s.style.left = (10 + Math.random() * 80) + '%';
      s.style.animationDelay = (Math.random() * 0.25) + 's';
      s.style.fontSize = (15 + Math.random() * 14) + 'px';
      document.body.appendChild(s);
      (function (el) { setTimeout(function () { if (el.parentNode) { el.parentNode.removeChild(el); } }, 1700); })(s);
    }
  }

  function openSheet(opts) {
    var rootEl = document.getElementById('sheetRoot');
    if (!rootEl) { return; }
    if (rootEl.innerHTML) { closeSheet(true); }
    var actions = opts.actions || [];
    var actHtml = actions.map(function (a) {
      return '<button type="button" class="btn ' + (a.kind ? 'btn-' + a.kind : 'btn-soft') + '" data-sact="' + esc(a.id) + '">' + esc(a.label) + '</button>';
    }).join('');
    rootEl.innerHTML =
      '<div class="sheet-backdrop" data-sact="__close"></div>' +
      '<section class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle">' +
        '<div class="sheet-grab" aria-hidden="true"></div>' +
        '<h2 class="sheet-title" id="sheetTitle">' + esc(opts.title || '') + '</h2>' +
        (opts.subtitle ? '<p class="sheet-sub">' + esc(opts.subtitle) + '</p>' : '') +
        '<div class="sheet-body">' + (opts.body || '') + '</div>' +
        (actHtml ? '<div class="sheet-actions">' + actHtml + '</div>' : '') +
      '</section>';
    ui.sheet = { actions: {}, dismissible: opts.dismissible !== false };
    ui.sheetSheetActions = null;
    actions.forEach(function (a) { ui.sheet.actions[a.id] = a.onClick; });
    ui.sheet.actions.__close = function () { closeSheet(); };
    document.body.classList.add('sheet-open');
    var panel = rootEl.querySelector('.sheet');
    requestAnimationFrame(function () { if (panel) { panel.classList.add('is-open'); } });
    var first = rootEl.querySelector('input:not([type=hidden]), textarea');
    if (first && first.type !== 'date') {
      setTimeout(function () { try { first.focus(); } catch (e) { /* noop */ } }, 180);
    }
  }

  function closeSheet(immediate) {
    var rootEl = document.getElementById('sheetRoot');
    if (!rootEl) { return; }
    ui.sheet = null;
    ui.pin = null;
    document.body.classList.remove('sheet-open');
    if (immediate) { rootEl.innerHTML = ''; return; }
    var panel = rootEl.querySelector('.sheet');
    if (panel) { panel.classList.remove('is-open'); }
    setTimeout(function () { if (rootEl && !rootEl.querySelector('.sheet.is-open')) { rootEl.innerHTML = ''; } }, 230);
  }

  function syncChipInfo() {
    if (!isSyncReady()) { return null; }
    if (sync.status === 'connected') { return { kind: 'ok', text: '실시간 연결' }; }
    if (sync.status === 'error') { return { kind: 'warn', text: '연결 확인' }; }
    return { kind: 'wait', text: '맞추는 중' };
  }

  function syncStatusHTML() {
    var map = {
      local: ['dot-idle', '로컬 저장 모드', '이 기기에만 저장돼요. 아래에 Firebase 주소를 넣으면 두 아이폰이 실시간으로 맞춰져요.'],
      connecting: ['dot-wait', '연결하는 중…', 'Firebase에 연결하고 있어요.'],
      connected: ['dot-ok', '실시간 동기화 중', '두 아이폰의 할 일과 캐시가 자동으로 맞춰져요.'],
      error: ['dot-warn', '연결을 확인해 주세요', '주소나 방 코드가 맞는지, Firebase 규칙이 읽기/쓰기를 허용하는지 확인해 주세요.']
    };
    var it = map[sync.status] || map.local;
    var extra = (sync.status === 'connected' && sync.lastSync) ? (' · ' + timeLabel(sync.lastSync) + ' 동기화') : '';
    return '<span class="sync-dot ' + it[0] + '"></span><div><p class="sync-name">' + esc(it[1]) + extra + '</p><p class="sync-desc">' + esc(it[2]) + '</p></div>';
  }

  function renderStatusOnly() {
    var chip = document.getElementById('syncChip');
    if (chip) {
      var info = syncChipInfo();
      chip.hidden = !info;
      if (info) {
        chip.className = 'sync-chip is-' + info.kind;
        chip.innerHTML = '<i aria-hidden="true"></i>' + esc(info.text);
      }
    }
    var box = document.querySelector('[data-sync-status]');
    if (box) { box.innerHTML = syncStatusHTML(); }
  }

  /* -------------------------------------------------------------- render */

  function render() {
    var view = document.getElementById('view');
    if (!view) { return; }
    var html;
    if (ui.mode === 'child') {
      html = ui.tab === 'history' ? viewChildHistory() : viewChildHome();
    } else if (ui.tab === 'tasks') {
      html = viewParentTasks();
    } else if (ui.tab === 'payouts') {
      html = viewParentPayouts();
    } else if (ui.tab === 'settings') {
      html = viewParentSettings();
    } else {
      html = viewParentCheck();
    }
    view.innerHTML = html;
    renderTabs();
    renderHeader();
    view.classList.remove('is-enter');
    void view.offsetWidth;
    view.classList.add('is-enter');
  }

  function renderHeader() {
    var btn = document.getElementById('modeBtn');
    if (btn) {
      btn.textContent = ui.mode === 'child' ? '부모 모드' : '아이 화면';
      btn.setAttribute('data-act', 'switch-mode');
    }
    renderStatusOnly();
  }

  function tabsForMode() {
    if (ui.mode === 'child') {
      return [
        { id: 'home', ico: '🏠', label: '오늘' },
        { id: 'history', ico: '📒', label: '기록' }
      ];
    }
    var pending = state.completions.filter(function (c) { return c.status === 'pending'; }).length;
    var pays = state.payouts.filter(function (p) { return p.status === 'requested'; }).length;
    return [
      { id: 'check', ico: '✅', label: '확인', badge: pending },
      { id: 'tasks', ico: '📝', label: '할 일' },
      { id: 'payouts', ico: '💰', label: '현금', badge: pays },
      { id: 'settings', ico: '⚙️', label: '설정' }
    ];
  }

  function renderTabs() {
    var bar = document.getElementById('tabbar');
    if (!bar) { return; }
    bar.innerHTML = tabsForMode().map(function (t) {
      return '<button type="button" class="tab' + (ui.tab === t.id ? ' is-active' : '') + '" data-act="tab" data-tab="' + t.id + '"' +
        (ui.tab === t.id ? ' aria-current="page"' : '') + '>' +
        '<span class="tab-ico" aria-hidden="true">' + t.ico + '</span>' +
        '<span class="tab-label">' + esc(t.label) + '</span>' +
        (t.badge ? '<span class="tab-badge">' + t.badge + '</span>' : '') +
      '</button>';
    }).join('');
  }

  /* ------------------------------------------------------- child: today */

  function installHintHTML() {
    if (ui.hintDismissed) { return ''; }
    var standalone = (root.navigator && root.navigator.standalone === true) ||
      (root.matchMedia && root.matchMedia('(display-mode: standalone)').matches);
    if (standalone) { return ''; }
    return '<div class="hint">' +
      '<span class="hint-emoji" aria-hidden="true">📲</span>' +
      '<div class="hint-main"><p class="hint-title">홈 화면에 추가하면 앱처럼 열려요</p>' +
      '<p class="hint-sub">사파리 아래 공유 버튼 → ‘홈 화면에 추가’</p></div>' +
      '<button type="button" class="btn-mini" data-act="dismiss-hint">알겠어요</button>' +
    '</div>';
  }

  function taskRow(task, key) {
    var c = completionFor(state, task.id, key);
    var status = c ? c.status : 'none';
    var right, sub;
    if (status === 'pending') {
      sub = '부모님 확인을 기다리는 중이에요';
      right = '<span class="pill pill-wait">확인 중</span>';
    } else if (status === 'approved') {
      sub = '캐시가 적립됐어요';
      right = '<span class="pill pill-done">+' + won(task.reward) + '</span>';
    } else if (status === 'rejected') {
      sub = c.note ? esc(c.note) : '조금 더 해보고 다시 도전!';
      right = '<button type="button" class="task-btn" data-act="ask-complete" data-id="' + task.id + '" aria-label="' + esc(task.title) + ' 다시 도전">↻</button>';
    } else {
      sub = '완료하면 ' + won(task.reward);
      right = '<button type="button" class="task-btn" data-act="ask-complete" data-id="' + task.id + '" aria-label="' + esc(task.title) + ' 완료 요청">✓</button>';
    }
    return '<div class="task is-' + status + '">' +
      '<span class="task-emoji" aria-hidden="true">' + esc(task.emoji || '⭐') + '</span>' +
      '<div class="task-main"><p class="task-title">' + esc(task.title) + '</p><p class="task-sub">' + sub + '</p></div>' +
      right +
    '</div>';
  }

  function payoutRequestRows() {
    var list = state.payouts.filter(function (p) { return p.status === 'requested'; }).sort(byTimeDesc('requestedAt'));
    if (!list.length) { return ''; }
    return '<div class="request-list">' + list.map(function (p) {
      return '<div class="request-row">' +
        '<div class="request-main"><p class="request-title">' + won(p.amount) + ' 현금 교환 신청</p>' +
        '<p class="request-sub">' + dateLabel(dateKeyOf(new Date(p.requestedAt))) + ' 신청 · 부모님 확인 기다리는 중</p></div>' +
        '<button type="button" class="btn-mini" data-act="cancel-payout" data-id="' + p.id + '">신청 취소</button>' +
      '</div>';
    }).join('') + '</div>';
  }

  function viewChildHome() {
    var key = todayKey();
    var list = tasksForDate(state, key);
    var st = computeStats(state);
    var done = 0, waiting = 0;
    list.forEach(function (t) {
      var c = completionFor(state, t.id, key);
      if (c && c.status === 'approved') { done++; }
      else if (c && c.status === 'pending') { waiting++; }
    });
    var pct = list.length ? Math.round((done / list.length) * 100) : 0;
    var g = greeting(state.settings.childName);
    var chips = [];
    if (st.pendingEarn > 0) { chips.push('<span class="chip chip-ghost">확인 기다리는 캐시 ' + won(st.pendingEarn) + '</span>'); }
    if (st.requested > 0) { chips.push('<span class="chip chip-ghost">교환 신청 ' + won(st.requested) + '</span>'); }
    if (!chips.length) { chips.push('<span class="chip chip-ghost">할 일을 하면 캐시가 쌓여요</span>'); }

    var note;
    if (!list.length) { note = '부모님이 할 일을 아직 만들지 않았어요.'; }
    else if (done === list.length) { note = '오늘 할 일을 모두 마쳤어요! 🎉'; }
    else if (waiting > 0) { note = '부모님 확인을 기다리는 할 일이 ' + waiting + '개 있어요.'; }
    else { note = '남은 할 일 ' + (list.length - done) + '개, 조금씩 힘내요!'; }

    return installHintHTML() +
      '<section class="hello">' +
        '<span class="hello-emoji" aria-hidden="true">' + g.emoji + '</span>' +
        '<div><p class="hello-title">' + esc(g.title) + '</p>' +
        '<p class="hello-sub">' + esc(dateLabel(key)) + ' · 할 일 ' + list.length + '개</p></div>' +
      '</section>' +

      '<section class="balance-card">' +
        '<div class="balance-deco deco-1" aria-hidden="true">☁️</div>' +
        '<div class="balance-deco deco-2" aria-hidden="true">⭐</div>' +
        '<p class="balance-label">지금 모은 캐시</p>' +
        '<p class="balance-amount">' + won(st.balance) + '</p>' +
        '<div class="balance-chips">' + chips.join('') + '</div>' +
      '</section>' +

      '<section class="card progress-card">' +
        '<div class="progress-head"><span class="progress-title">오늘 할 일</span>' +
        '<span class="progress-count">' + done + '/' + list.length + ' 완료</span></div>' +
        '<div class="progress-track"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
        '<p class="progress-note">' + esc(note) + '</p>' +
      '</section>' +

      '<div class="section-head"><h2 class="section-title">오늘의 할 일</h2>' +
      '<span class="section-sub">' + esc(dateLabel(key)) + '</span></div>' +
      '<div class="task-list">' + (list.length ? list.map(function (t) { return taskRow(t, key); }).join('') : emptyTasksHTML()) + '</div>' +

      '<div class="section-head"><h2 class="section-title">현금 교환</h2></div>' +
      '<section class="cash-card">' +
        '<div class="cash-main"><p class="cash-title">' + (st.available > 0 ? '현금으로 바꿀 수 있어요' : '캐시를 모아보자') + '</p>' +
        '<p class="cash-sub">' + (st.available > 0 ? '지금 ' + won(st.available) + '까지 신청할 수 있어요' : '현금 교환은 부모님이 직접 주세요') + '</p></div>' +
        '<button type="button" class="btn btn-mint" data-act="ask-payout"' + (st.available > 0 ? '' : ' disabled') + '>현금 교환 신청</button>' +
      '</section>' +
      payoutRequestRows();
  }

  function emptyTasksHTML() {
    return '<div class="empty"><span class="empty-emoji" aria-hidden="true">🌱</span>' +
      '<p class="empty-title">아직 할 일이 없어요</p>' +
      '<p class="empty-sub">부모 모드에서 오늘의 할 일을 만들어 주세요.</p></div>';
  }

  /* ----------------------------------------------------- child: history */

  function buildEvents() {
    var ev = [];
    state.completions.forEach(function (c) {
      var ts = c.reviewedAt || c.requestedAt || 0;
      if (c.status === 'approved') {
        ev.push({ ts: ts, emoji: c.emoji || '⭐', title: c.taskTitle, amount: Number(c.reward) || 0, note: '캐시 적립', kind: 'earn' });
      } else if (c.status === 'pending') {
        ev.push({ ts: c.requestedAt || 0, emoji: '⏳', title: c.taskTitle, amount: 0, note: '부모님 확인 기다리는 중', kind: 'wait' });
      } else {
        ev.push({ ts: ts, emoji: '↩️', title: c.taskTitle, amount: 0, note: c.note || '다시 하기로 했어요', kind: 'skip' });
      }
    });
    state.payouts.forEach(function (p) {
      if (p.status === 'paid') {
        ev.push({ ts: p.paidAt || p.requestedAt, emoji: '💵', title: '현금 교환', amount: -(Number(p.amount) || 0), note: '현금으로 받았어요', kind: 'out' });
      } else if (p.status === 'requested') {
        ev.push({ ts: p.requestedAt, emoji: '💌', title: '현금 교환 신청', amount: 0, note: '부모님 확인 기다리는 중', kind: 'wait' });
      }
    });
    state.adjustments.forEach(function (a) {
      ev.push({
        ts: a.createdAt, emoji: '📝', title: a.memo || '부모님 조정',
        amount: Number(a.amount) || 0, note: '잔액 조정', kind: (Number(a.amount) || 0) >= 0 ? 'earn' : 'out'
      });
    });
    return ev.sort(function (a, b) { return b.ts - a.ts; });
  }

  function viewChildHistory() {
    var st = computeStats(state);
    var events = buildEvents();
    if (!events.length) {
      return '<div class="section-head"><h2 class="section-title">내 기록</h2></div>' +
        '<div class="empty"><span class="empty-emoji" aria-hidden="true">📒</span>' +
        '<p class="empty-title">아직 기록이 없어요</p>' +
        '<p class="empty-sub">할 일을 완료하면 여기에 하나씩 쌓여요.</p></div>';
    }
    var groups = [];
    var currentKey = null;
    events.forEach(function (e) {
      var k = dateKeyOf(new Date(e.ts));
      if (k !== currentKey) { currentKey = k; groups.push({ key: k, items: [] }); }
      groups[groups.length - 1].items.push(e);
    });

    return '<div class="section-head"><h2 class="section-title">내 기록</h2>' +
      '<span class="section-sub">최근 순</span></div>' +
      '<div class="stat-row">' +
        '<div class="stat"><p class="stat-label">모은 캐시</p><p class="stat-value">' + won(st.earned) + '</p></div>' +
        '<div class="stat"><p class="stat-label">현금으로 받음</p><p class="stat-value">' + won(st.paidOut) + '</p></div>' +
        '<div class="stat"><p class="stat-label">지금 캐시</p><p class="stat-value stat-strong">' + won(st.balance) + '</p></div>' +
      '</div>' +
      groups.map(function (g) {
        return '<div class="day-group"><p class="day-head">' + esc(dateLabel(g.key)) + '</p>' +
          '<div class="card list-card">' + g.items.map(function (e) {
            var amt = e.amount ? '<span class="ledger-amount is-' + (e.amount > 0 ? 'plus' : 'minus') + '">' + signedWon(e.amount) + '</span>' : '<span class="ledger-amount is-wait">대기</span>';
            return '<div class="ledger-row"><span class="ledger-emoji" aria-hidden="true">' + esc(e.emoji) + '</span>' +
              '<div class="ledger-main"><p class="ledger-title">' + esc(e.title) + '</p>' +
              '<p class="ledger-sub">' + esc(e.note) + ' · ' + timeLabel(e.ts) + '</p></div>' + amt + '</div>';
          }).join('') + '</div></div>';
      }).join('');
  }

  /* ------------------------------------------------------ parent: check */

  function viewParentCheck() {
    var key = todayKey();
    var pending = state.completions.filter(function (c) { return c.status === 'pending'; })
      .sort(function (a, b) { return (a.requestedAt || 0) - (b.requestedAt || 0); });
    var approvedToday = state.completions.filter(function (c) { return c.status === 'approved' && c.date === key; })
      .sort(byTimeDesc('reviewedAt'));
    var payWait = state.payouts.filter(function (p) { return p.status === 'requested'; });
    var st = computeStats(state);
    var pendingTotal = sum(pending, function (c) { return c.reward; });

    var pendingHTML = pending.length
      ? pending.map(function (c) {
        return '<div class="review-card">' +
          '<div class="review-head">' +
            '<span class="task-emoji" aria-hidden="true">' + esc(c.emoji || '⭐') + '</span>' +
            '<div class="task-main"><p class="task-title">' + esc(c.taskTitle) + '</p>' +
            '<p class="task-sub">' + esc(dateLabel(c.date)) + ' ' + timeLabel(c.requestedAt) + ' 요청' +
            (c.attempts > 1 ? ' · ' + c.attempts + '번째 도전' : '') + '</p></div>' +
            '<span class="review-reward">+' + won(c.reward) + '</span>' +
          '</div>' +
          '<div class="review-actions">' +
            '<button type="button" class="btn btn-primary btn-sm" data-act="approve" data-id="' + c.id + '">확인 · ' + won(c.reward) + ' 적립</button>' +
            '<button type="button" class="btn btn-ghost btn-sm" data-act="reject" data-id="' + c.id + '">다시 하기</button>' +
          '</div>' +
        '</div>';
      }).join('')
      : '<div class="empty"><span class="empty-emoji" aria-hidden="true">🍵</span>' +
        '<p class="empty-title">확인할 일이 없어요</p>' +
        '<p class="empty-sub">아이가 완료 요청을 보내면 여기에 나타나요.</p></div>';

    var approvedHTML = approvedToday.length
      ? '<div class="card list-card">' + approvedToday.map(function (c) {
        return '<div class="ledger-row"><span class="ledger-emoji" aria-hidden="true">' + esc(c.emoji || '⭐') + '</span>' +
          '<div class="ledger-main"><p class="ledger-title">' + esc(c.taskTitle) + '</p>' +
          '<p class="ledger-sub">' + timeLabel(c.reviewedAt || c.requestedAt) + ' 적립 완료</p></div>' +
          '<span class="ledger-amount is-plus">+' + won(c.reward) + '</span>' +
          '<button type="button" class="link-btn" data-act="revert-approval" data-id="' + c.id + '">되돌리기</button></div>';
      }).join('') + '</div>'
      : '<p class="muted-note">오늘 적립한 기록이 아직 없어요.</p>';

    return '<div class="section-head"><h2 class="section-title">오늘 확인</h2>' +
      '<span class="section-sub">' + esc(dateLabel(key)) + '</span></div>' +
      '<div class="mini-stats">' +
        '<div class="mini-stat"><span class="mini-label">확인 대기</span><strong>' + pending.length + '건</strong></div>' +
        '<div class="mini-stat"><span class="mini-label">대기 금액</span><strong>' + won(pendingTotal) + '</strong></div>' +
        '<div class="mini-stat"><span class="mini-label">지금 잔액</span><strong>' + won(st.balance) + '</strong></div>' +
      '</div>' +
      (payWait.length ? '<button type="button" class="banner" data-act="tab" data-tab="payouts">💌 현금 교환 신청 ' + payWait.length + '건이 기다리고 있어요 <span>보러 가기 ›</span></button>' : '') +
      (pending.length > 1 ? '<button type="button" class="btn btn-soft btn-block" data-act="approve-all">대기 중인 ' + pending.length + '건 모두 확인 · ' + won(pendingTotal) + '</button>' : '') +
      '<div class="stack">' + pendingHTML + '</div>' +
      '<div class="section-head"><h2 class="section-title">오늘 적립한 일</h2></div>' +
      approvedHTML;
  }

  /* ------------------------------------------------------ parent: tasks */

  function viewParentTasks() {
    var list = state.tasks.slice().sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
    var key = todayKey();
    var rows = list.length ? list.map(function (t) {
      var today = t.active !== false && matchesDate(t, key);
      return '<div class="manage-row' + (t.active === false ? ' is-off' : '') + '">' +
        '<span class="task-emoji" aria-hidden="true">' + esc(t.emoji || '⭐') + '</span>' +
        '<div class="task-main"><p class="task-title">' + esc(t.title) + '</p>' +
        '<p class="task-sub">' + esc(scheduleLabel(t.schedule)) + ' · ' + won(t.reward) +
        (today ? ' · <span class="today-tag">오늘</span>' : '') + '</p></div>' +
        '<button type="button" class="switch' + (t.active !== false ? ' is-on' : '') + '" data-act="toggle-task" data-id="' + t.id + '" ' +
        'aria-label="' + esc(t.title) + ' ' + (t.active !== false ? '쉬는 중으로 바꾸기' : '다시 켜기') + '" aria-pressed="' + (t.active !== false) + '"><span></span></button>' +
        '<button type="button" class="icon-btn" data-act="edit-task" data-id="' + t.id + '" aria-label="' + esc(t.title) + ' 수정">✏️</button>' +
      '</div>';
    }).join('') : '<div class="empty"><span class="empty-emoji" aria-hidden="true">🌱</span>' +
      '<p class="empty-title">할 일이 없어요</p><p class="empty-sub">아래 버튼으로 첫 할 일을 만들어 보세요.</p></div>';

    return '<div class="section-head"><h2 class="section-title">할 일 관리</h2>' +
      '<span class="section-sub">' + state.tasks.length + '개</span></div>' +
      '<p class="muted-note">기본 보상은 ' + won(state.settings.defaultReward) + '이에요. 할 일마다 금액을 바꿀 수 있어요.</p>' +
      '<div class="manage-list">' + rows + '</div>' +
      '<button type="button" class="btn btn-primary btn-block" data-act="task-new">＋ 새 할 일 만들기</button>';
  }

  /* ---------------------------------------------------- parent: payouts */

  function viewParentPayouts() {
    var st = computeStats(state);
    var waiting = state.payouts.filter(function (p) { return p.status === 'requested'; }).sort(byTimeDesc('requestedAt'));
    var paid = state.payouts.filter(function (p) { return p.status === 'paid'; }).sort(byTimeDesc('paidAt'));

    var waitHTML = waiting.length ? '<div class="stack">' + waiting.map(function (p) {
      return '<div class="review-card">' +
        '<div class="review-head"><span class="task-emoji" aria-hidden="true">💌</span>' +
        '<div class="task-main"><p class="task-title">' + won(p.amount) + ' 현금 교환 신청</p>' +
        '<p class="task-sub">' + dateLabel(dateKeyOf(new Date(p.requestedAt))) + ' ' + timeLabel(p.requestedAt) + ' 신청</p></div></div>' +
        '<div class="review-actions">' +
          '<button type="button" class="btn btn-primary btn-sm" data-act="payout-pay" data-id="' + p.id + '">현금 지급 완료</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-act="payout-dismiss" data-id="' + p.id + '">신청 취소</button>' +
        '</div></div>';
    }).join('') + '</div>'
      : '<div class="empty"><span class="empty-emoji" aria-hidden="true">💭</span>' +
        '<p class="empty-title">교환 신청이 없어요</p>' +
        '<p class="empty-sub">아이가 신청하면 여기에서 지급 완료를 눌러 주세요.</p></div>';

    var paidHTML = paid.length
      ? '<div class="card list-card">' + paid.map(function (p) {
        return '<div class="ledger-row"><span class="ledger-emoji" aria-hidden="true">💵</span>' +
          '<div class="ledger-main"><p class="ledger-title">' + won(p.amount) + ' 지급 완료</p>' +
          '<p class="ledger-sub">' + dateLabel(dateKeyOf(new Date(p.paidAt || p.requestedAt))) + ' ' + timeLabel(p.paidAt || p.requestedAt) + '</p></div>' +
          '<span class="ledger-amount is-minus">-' + won(p.amount) + '</span></div>';
      }).join('') + '</div>'
      : '<p class="muted-note">아직 지급한 기록이 없어요.</p>';

    return '<div class="section-head"><h2 class="section-title">현금 교환</h2></div>' +
      '<div class="mini-stats">' +
        '<div class="mini-stat"><span class="mini-label">지금 잔액</span><strong>' + won(st.balance) + '</strong></div>' +
        '<div class="mini-stat"><span class="mini-label">신청 대기</span><strong>' + won(st.requested) + '</strong></div>' +
        '<div class="mini-stat"><span class="mini-label">지금까지 지급</span><strong>' + won(st.paidOut) + '</strong></div>' +
      '</div>' +
      '<button type="button" class="btn btn-soft btn-block" data-act="settings-adjust">잔액 직접 조정하기</button>' +
      '<div class="section-head"><h2 class="section-title">지급할 신청</h2>' +
      (waiting.length ? '<span class="section-sub">' + waiting.length + '건</span>' : '') + '</div>' + waitHTML +
      '<div class="section-head"><h2 class="section-title">지급 완료</h2></div>' + paidHTML;
  }

  /* --------------------------------------------------- parent: settings */

  function viewParentSettings() {
    var standalone = (root.navigator && root.navigator.standalone === true) ||
      (root.matchMedia && root.matchMedia('(display-mode: standalone)').matches);
    return '<div class="section-head"><h2 class="section-title">설정</h2></div>' +
      '<div class="card list-card">' +
        '<button type="button" class="setting-row" data-act="settings-name"><span class="setting-ico" aria-hidden="true">🐰</span>' +
          '<span class="setting-main"><span class="setting-title">아이 이름</span><span class="setting-sub">' + esc(state.settings.childName || '설정하지 않음') + '</span></span><span class="chev">›</span></button>' +
        '<button type="button" class="setting-row" data-act="settings-reward"><span class="setting-ico" aria-hidden="true">🪙</span>' +
          '<span class="setting-main"><span class="setting-title">기본 보상 금액</span><span class="setting-sub">' + won(state.settings.defaultReward) + '</span></span><span class="chev">›</span></button>' +
        '<button type="button" class="setting-row" data-act="settings-pin"><span class="setting-ico" aria-hidden="true">🔒</span>' +
          '<span class="setting-main"><span class="setting-title">부모 비밀번호</span><span class="setting-sub">4자리 · 지금 ' + esc(state.settings.pin.replace(/./g, '●')) + '</span></span><span class="chev">›</span></button>' +
      '</div>' +

      '<div class="section-head"><h2 class="section-title">두 아이폰 연결</h2></div>' +
      '<div class="card sync-card"><div class="sync-status" data-sync-status>' + syncStatusHTML() + '</div>' +
        '<button type="button" class="btn btn-soft btn-block" data-act="settings-sync">' + (isSyncReady() ? '연결 설정 바꾸기' : 'Firebase 연결하기') + '</button>' +
      '</div>' +

      '<div class="section-head"><h2 class="section-title">앱</h2></div>' +
      '<div class="card list-card">' +
        '<button type="button" class="setting-row" data-act="install-help"><span class="setting-ico" aria-hidden="true">📲</span>' +
          '<span class="setting-main"><span class="setting-title">홈 화면에 추가하는 방법</span><span class="setting-sub">' + (standalone ? '이미 앱처럼 열고 있어요' : '사파리 공유 버튼에서 추가') + '</span></span><span class="chev">›</span></button>' +
        '<div class="setting-row is-static"><span class="setting-ico" aria-hidden="true">✨</span>' +
          '<span class="setting-main"><span class="setting-title">버전</span><span class="setting-sub">' + APP_VERSION + ' · 아이와 함께 쓰는 할 일 캐시</span></span></div>' +
      '</div>' +
      '<button type="button" class="btn btn-danger-ghost btn-block" data-act="settings-reset">모든 데이터 지우고 처음부터</button>' +
      '<p class="foot-note">부모 비밀번호는 이 기기 안에서만 확인하는 잠금이에요. 중요한 개인정보는 넣지 마세요.</p>';
  }

  /* -------------------------------------------------------------- sheets */

  function sheetField(id, label, value, opts) {
    opts = opts || {};
    return '<div class="field"><label class="field-label" for="' + id + '">' + esc(label) + '</label>' +
      '<input class="input" id="' + id + '" type="' + (opts.type || 'text') + '"' +
      (opts.inputmode ? ' inputmode="' + opts.inputmode + '"' : '') +
      (opts.maxlength ? ' maxlength="' + opts.maxlength + '"' : '') +
      (opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '') +
      (opts.value != null ? ' value="' + esc(value) + '"' : '') + '>' +
      (opts.hint ? '<p class="field-hint">' + esc(opts.hint) + '</p>' : '') +
      '</div>';
  }

  /* --- 부모 모드 진입 / 비밀번호 --- */

  function startPinEntry(reason, onSubmit) {
    closeSheet(true);
    ui.pin = { buf: '', onSubmit: onSubmit, reason: reason || '4자리 비밀번호를 눌러 주세요' };
    drawPinSheet();
  }

  function drawPinSheet() {
    if (!ui.pin) { ui.pin = { buf: '', onSubmit: null, reason: '' }; }
    var dots = '';
    for (var i = 0; i < 4; i++) {
      dots += '<span class="pin-dot' + (i < ui.pin.buf.length ? ' is-filled' : '') + '"></span>';
    }
    var keys = '';
    for (var n = 1; n <= 9; n++) { keys += '<button type="button" class="key" data-key="' + n + '">' + n + '</button>'; }
    var body = '<div class="pin-dots" aria-hidden="true">' + dots + '</div>' +
      '<p class="pin-hidden-label" aria-live="polite">' + (ui.pin.buf.length ? ui.pin.buf.length + '자리 입력됨' : '') + '</p>' +
      '<div class="keypad">' + keys +
        '<button type="button" class="key key-ghost" data-key="back" aria-label="한 자리 지우기">⌫</button>' +
        '<button type="button" class="key" data-key="0">0</button>' +
        '<button type="button" class="key key-ghost" data-key="close">취소</button>' +
      '</div>';
    openSheet({
      title: '부모님 확인',
      subtitle: ui.pin.reason,
      body: body,
      actions: [{ id: 'forgot', label: '비밀번호를 잊으셨나요?', kind: 'text', onClick: forgotPin }]
    });
  }

  function updatePinDots() {
    var dots = document.querySelectorAll('.pin-dot');
    for (var i = 0; i < dots.length; i++) {
      dots[i].classList.toggle('is-filled', i < ui.pin.buf.length);
    }
    var lbl = document.querySelector('.pin-hidden-label');
    if (lbl) { lbl.textContent = ui.pin.buf.length ? ui.pin.buf.length + '자리 입력됨' : ''; }
  }

  function pinKey(k) {
    if (!ui.pin) { return; }
    if (k === 'close') { closeSheet(); return; }
    if (k === 'back') { ui.pin.buf = ui.pin.buf.slice(0, -1); updatePinDots(); return; }
    if (!/^\d$/.test(k) || ui.pin.buf.length >= 4) { return; }
    ui.pin.buf += k;
    updatePinDots();
    if (ui.pin.buf.length === 4) {
      var value = ui.pin.buf;
      setTimeout(function () { checkPin(value); }, 140);
    }
  }

  function checkPin(value) {
    if (!ui.pin) { return; }
    if (value === String(state.settings.pin)) {
      var after = ui.pin.onSubmit;
      closeSheet(true);
      if (after) { after(); }
      return;
    }
    ui.pin.buf = '';
    updatePinDots();
    var panel = document.querySelector('.sheet');
    if (panel) {
      panel.classList.add('shake');
      setTimeout(function () { panel.classList.remove('shake'); }, 420);
    }
    toast('비밀번호가 맞지 않아요');
  }

  function forgotPin() {
    var after = ui.pin ? ui.pin.onSubmit : null;
    var reason = ui.pin ? ui.pin.reason : '4자리 비밀번호를 눌러 주세요';
    openSheet({
      title: '비밀번호를 잊으셨나요?',
      subtitle: '이 기기를 가진 분만 할 수 있는 방법이에요',
      body: '<p class="sheet-text">비밀번호를 <strong>0000</strong>으로 되돌릴까요? 할 일과 캐시 기록은 그대로 남아요.</p>',
      actions: [
        { id: 'cancel', label: '그만두기', kind: 'ghost', onClick: function () { startPinEntry(reason, after); } },
        { id: 'ok', label: '0000으로 되돌리기', kind: 'primary', onClick: function () {
          commit(function (s) { s.settings.pin = '0000'; });
          closeSheet(true);
          toast('0000으로 바뀌었어요. 다시 입력해 주세요');
          startPinEntry('새 비밀번호 0000을 입력해 주세요', after);
        } }
      ]
    });
  }

  /* --- 아이: 완료 요청 --- */

  function askComplete(taskId) {
    var task = findById(state.tasks, taskId);
    if (!task) { return; }
    if (!matchesDate(task, todayKey())) { toast('오늘은 이 할 일이 없어요'); return; }
    openSheet({
      title: '다 했어요!',
      subtitle: '부모님이 확인하면 캐시가 쌓여요',
      body: '<div class="confirm-box"><span class="confirm-emoji" aria-hidden="true">' + esc(task.emoji || '⭐') + '</span>' +
        '<p class="confirm-title">' + esc(task.title) + '</p>' +
        '<p class="confirm-reward">+' + won(task.reward) + '</p></div>',
      actions: [
        { id: 'cancel', label: '아직이에요', kind: 'ghost', onClick: function () { closeSheet(); } },
        { id: 'ok', label: '확인 요청 보내기', kind: 'primary', onClick: function () { completeTask(task); } }
      ]
    });
  }

  function completeTask(task) {
    var key = todayKey();
    var existing = completionFor(state, task.id, key);
    commit(function () {
      if (existing) {
        existing.status = 'pending';
        existing.requestedAt = Date.now();
        existing.reviewedAt = null;
        existing.note = '';
        existing.attempts = (existing.attempts || 1) + 1;
      } else {
        state.completions.push({
          id: uid(), taskId: task.id, date: key,
          taskTitle: task.title, emoji: task.emoji, reward: Number(task.reward) || 0,
          status: 'pending', requestedAt: Date.now(), reviewedAt: null, note: '', attempts: 1
        });
      }
    });
    closeSheet(true);
    confetti();
    toast('부모님께 확인 요청을 보냈어요!');
  }

  /* --- 아이: 현금 교환 신청 --- */

  function askPayout() {
    var st = computeStats(state);
    var max = Math.max(0, Math.floor(st.available));
    if (max <= 0) { toast('아직 바꿀 캐시가 없어요'); return; }

    var presetSet = [max, 3000, 2000, 1000, 500].filter(function (v, i, arr) {
      return v > 0 && v <= max && arr.indexOf(v) === i;
    });

    function bodyHTML() {
      return '<div class="amount-box">' +
        '<p class="amount-label">바꿀 금액</p>' +
        '<div class="amount-edit">' +
          '<button type="button" class="step-btn" data-sact="minus" aria-label="줄이기">−</button>' +
          '<input id="payoutAmount" class="amount-input" inputmode="numeric" value="' + max + '" aria-label="바꿀 금액">' +
          '<button type="button" class="step-btn" data-sact="plus" aria-label="늘리기">＋</button>' +
        '</div>' +
        '<p class="amount-hint">신청할 수 있는 금액 <strong>' + won(max) + '</strong></p>' +
        '<div class="chip-row">' + presetSet.map(function (v) {
          return '<button type="button" class="chip-btn" data-sact="preset" data-v="' + v + '">' + won(v) + '</button>';
        }).join('') + '</div>' +
        '<p class="sheet-text">부모님이 현금으로 주시면 잔액에서 빠져요.</p>' +
      '</div>';
    }

    function readAmount() {
      var el = document.getElementById('payoutAmount');
      return el ? digits(el.value) : max;
    }

    openSheet({
      title: '현금으로 바꾸기',
      subtitle: '부모님께 신청서를 보내요',
      body: bodyHTML(),
      actions: [
        { id: 'cancel', label: '취소', kind: 'ghost', onClick: function () { closeSheet(); } },
        { id: 'ok', label: '신청 보내기', kind: 'primary', onClick: function () {
          var amount = readAmount();
          if (amount <= 0) { toast('금액을 입력해 주세요'); return; }
          if (amount > max) { toast(won(max) + '까지만 신청할 수 있어요'); return; }
          commit(function () {
            state.payouts.push({ id: uid(), amount: amount, status: 'requested', requestedAt: Date.now(), paidAt: null });
          });
          closeSheet(true);
          confetti();
          toast(won(amount) + ' 교환을 신청했어요!');
        } }
      ]
    });

    // 금액 버튼은 다시 그리지 않고 값만 바꾼다.
    var minus = document.querySelector('[data-sact="minus"]');
    var plus = document.querySelector('[data-sact="plus"]');
    var input = document.getElementById('payoutAmount');
    function setAmount(v) {
      if (!input) { return; }
      input.value = String(clamp(Math.round(v), 0, max));
    }
    if (minus) { minus.addEventListener('click', function () { setAmount(readAmount() - 500); }); }
    if (plus) { plus.addEventListener('click', function () { setAmount(readAmount() + 500); }); }
    var presetBtns = document.querySelectorAll('[data-sact="preset"]');
    for (var i = 0; i < presetBtns.length; i++) {
      presetBtns[i].addEventListener('click', function (ev) {
        ev.stopPropagation();
        setAmount(digits(this.getAttribute('data-v')));
      });
    }
  }

  function cancelPayout(id) {
    commit(function () {
      var p = findById(state.payouts, id);
      if (p && p.status === 'requested') { p.status = 'canceled'; }
    });
    toast('신청을 취소했어요');
  }

  /* --- 부모: 확인 / 다시 하기 --- */

  function approveCompletion(id) {
    var c = findById(state.completions, id);
    if (!c || c.status !== 'pending') { return; }
    commit(function () {
      c.status = 'approved';
      c.reviewedAt = Date.now();
    });
    toast(won(c.reward) + ' 캐시를 적립했어요');
  }

  function approveAll() {
    var pending = state.completions.filter(function (c) { return c.status === 'pending'; });
    if (!pending.length) { return; }
    var total = sum(pending, function (c) { return c.reward; });
    openSheet({
      title: '모두 확인할까요?',
      subtitle: '대기 중인 ' + pending.length + '건을 한 번에 적립해요',
      body: '<p class="sheet-text">모두 합쳐 <strong>' + won(total) + '</strong>이 적립돼요.</p>',
      actions: [
        { id: 'cancel', label: '취소', kind: 'ghost', onClick: function () { closeSheet(); } },
        { id: 'ok', label: '모두 확인', kind: 'primary', onClick: function () {
          commit(function () {
            pending.forEach(function (c) { c.status = 'approved'; c.reviewedAt = Date.now(); });
          });
          closeSheet(true);
          toast(pending.length + '건 · ' + won(total) + ' 적립했어요');
        } }
      ]
    });
  }

  function revertApproval(id) {
    var c = findById(state.completions, id);
    if (!c) { return; }
    commit(function () {
      c.status = 'pending';
      c.reviewedAt = null;
    });
    toast('적립을 되돌렸어요');
  }

  function askReject(id) {
    var c = findById(state.completions, id);
    if (!c) { return; }
    var quick = ['조금 더 해보자', '내일 다시 하자', '같이 해보자'];
    openSheet({
      title: '다시 하기로 할까요?',
      subtitle: esc(c.taskTitle) + ' · 적립하지 않고 돌려보내요',
      body: '<div class="chip-row">' + quick.map(function (q) {
          return '<button type="button" class="chip-btn" data-quick="' + esc(q) + '">' + esc(q) + '</button>';
        }).join('') + '</div>' +
        '<div class="field"><label class="field-label" for="rejectNote">전할 말 (선택)</label>' +
        '<input class="input" id="rejectNote" maxlength="40" placeholder="예: 책상을 한 번 더 정리해 보자"></div>',
      actions: [
        { id: 'cancel', label: '취소', kind: 'ghost', onClick: function () { closeSheet(); } },
        { id: 'ok', label: '다시 하기로 보내기', kind: 'primary', onClick: function () {
          var noteEl = document.getElementById('rejectNote');
          var note = noteEl ? noteEl.value.trim().slice(0, 40) : '';
          commit(function () {
            c.status = 'rejected';
            c.reviewedAt = Date.now();
            c.note = note;
          });
          closeSheet(true);
          toast('아이에게 다시 하기를 전했어요');
        } }
      ]
    });
    var chips = document.querySelectorAll('[data-quick]');
    for (var i = 0; i < chips.length; i++) {
      chips[i].addEventListener('click', function (ev) {
        ev.stopPropagation();
        var noteEl = document.getElementById('rejectNote');
        if (noteEl) { noteEl.value = this.getAttribute('data-quick'); }
      });
    }
  }

  function askPayPayout(id) {
    var p = findById(state.payouts, id);
    if (!p || p.status !== 'requested') { return; }
    openSheet({
      title: '현금을 주셨나요?',
      subtitle: '지급 완료로 바꾸면 잔액에서 빠져요',
      body: '<div class="confirm-box"><span class="confirm-emoji" aria-hidden="true">💵</span>' +
        '<p class="confirm-title">' + won(p.amount) + '</p>' +
        '<p class="confirm-reward">지급 완료로 기록해요</p></div>',
      actions: [
        { id: 'cancel', label: '아직이에요', kind: 'ghost', onClick: function () { closeSheet(); } },
        { id: 'ok', label: '현금 지급 완료', kind: 'primary', onClick: function () {
          commit(function () {
            p.status = 'paid';
            p.paidAt = Date.now();
          });
          closeSheet(true);
          toast(won(p.amount) + ' 지급 완료로 기록했어요');
        } }
      ]
    });
  }

  function dismissPayout(id) {
    commit(function () {
      var p = findById(state.payouts, id);
      if (p && p.status === 'requested') { p.status = 'canceled'; }
    });
    toast('신청을 취소했어요');
  }

  /* --- 부모: 할 일 폼 --- */

  function openTaskForm(taskId) {
    var existing = taskId ? findById(state.tasks, taskId) : null;
    var draft = existing ? {
      title: existing.title,
      emoji: existing.emoji || '⭐',
      reward: Number(existing.reward) || 0,
      schedule: normSchedule(existing.schedule)
    } : {
      title: '',
      emoji: '⭐',
      reward: Number(state.settings.defaultReward) || 300,
      schedule: { type: 'daily' }
    };
    if (draft.schedule.type === 'weekly' && !draft.schedule.days) { draft.schedule.days = [1, 2, 3, 4, 5]; }

    function syncDraft() {
      var t = document.getElementById('tfTitle');
      if (t) { draft.title = t.value; }
      var r = document.getElementById('tfReward');
      if (r) { draft.reward = digits(r.value); }
      var d = document.getElementById('tfDate');
      if (d && draft.schedule.type === 'once') { draft.schedule.date = d.value || ''; }
    }

    var actions = {
      emoji: function (el) {
        syncDraft();
        draft.emoji = el.getAttribute('data-v');
        draw();
      },
      reward: function (el) {
        syncDraft();
        draft.reward = digits(el.getAttribute('data-v'));
        var input = document.getElementById('tfReward');
        if (input) { input.value = String(draft.reward); }
      },
      type: function (el) {
        syncDraft();
        var v = el.getAttribute('data-v');
        draft.schedule = { type: v };
        if (v === 'weekly') { draft.schedule.days = [1, 2, 3, 4, 5]; }
        if (v === 'once') { draft.schedule.date = todayKey(); }
        draw();
      },
      day: function (el) {
        syncDraft();
        var v = Number(el.getAttribute('data-v'));
        var days = draft.schedule.days || [];
        var idx = days.indexOf(v);
        if (idx >= 0) { days.splice(idx, 1); } else { days.push(v); }
        draft.schedule.days = days.sort(function (a, b) { return a - b; });
        el.classList.toggle('is-on');
      }
    };

    function draw() {
      var type = draft.schedule.type;
      var days = draft.schedule.days || [];
      var body = '<div class="field"><label class="field-label" for="tfTitle">할 일 이름</label>' +
          '<input class="input" id="tfTitle" maxlength="40" placeholder="예: 양치하기" value="' + esc(draft.title) + '"></div>' +

        '<div class="field"><span class="field-label">그림</span><div class="emoji-grid">' +
          EMOJI_CHOICES.map(function (e) {
            return '<button type="button" class="emoji-opt' + (e === draft.emoji ? ' is-on' : '') + '" data-sact="emoji" data-v="' + e + '" aria-label="' + e + '">' + e + '</button>';
          }).join('') + '</div></div>' +

        '<div class="field"><label class="field-label" for="tfReward">완료하면 줄 캐시</label>' +
          '<input class="input" id="tfReward" inputmode="numeric" value="' + draft.reward + '">' +
          '<div class="chip-row">' + [100, 300, 500, 1000].map(function (v) {
            return '<button type="button" class="chip-btn" data-sact="reward" data-v="' + v + '">' + won(v) + '</button>';
          }).join('') + '</div></div>' +

        '<div class="field"><span class="field-label">언제 하나요?</span>' +
          '<div class="seg-row">' +
            '<button type="button" class="seg' + (type === 'daily' ? ' is-on' : '') + '" data-sact="type" data-v="daily">매일</button>' +
            '<button type="button" class="seg' + (type === 'weekly' ? ' is-on' : '') + '" data-sact="type" data-v="weekly">요일 정하기</button>' +
            '<button type="button" class="seg' + (type === 'once' ? ' is-on' : '') + '" data-sact="type" data-v="once">한 번만</button>' +
          '</div>' +
          (type === 'weekly'
            ? '<div class="day-row">' + DAY_LABELS.map(function (label, idx) {
                return '<button type="button" class="day-opt' + (days.indexOf(idx) >= 0 ? ' is-on' : '') + '" data-sact="day" data-v="' + idx + '">' + label + '</button>';
              }).join('') + '</div>'
            : '') +
          (type === 'once'
            ? '<input class="input" type="date" id="tfDate" value="' + esc(draft.schedule.date || todayKey()) + '">'
            : '') +
        '</div>';

      openSheet({
        title: existing ? '할 일 고치기' : '새 할 일 만들기',
        subtitle: existing ? '' : '아이 화면에 바로 나타나요',
        body: body,
        actions: (existing ? [{ id: 'del', label: '삭제', kind: 'text-danger', onClick: function () { closeSheet(true); askDeleteTask(existing.id); } }] : []).concat([
          { id: 'cancel', label: '취소', kind: 'ghost', onClick: function () { closeSheet(); } },
          { id: 'save', label: '저장', kind: 'primary', onClick: save }
        ])
      });
      ui.sheetSheetActions = actions;
    }

    function save() {
      syncDraft();
      var title = String(draft.title || '').trim();
      if (!title) { toast('할 일 이름을 적어 주세요'); return; }
      var reward = clamp(Math.round(Number(draft.reward) || 0), 0, 100000);
      if (draft.schedule.type === 'weekly' && !(draft.schedule.days || []).length) {
        toast('요일을 하나 이상 골라 주세요');
        return;
      }
      if (draft.schedule.type === 'once' && !draft.schedule.date) {
        toast('날짜를 골라 주세요');
        return;
      }
      commit(function (s) {
        if (existing) {
          var t = findById(s.tasks, existing.id);
          if (t) {
            t.title = title;
            t.emoji = draft.emoji;
            t.reward = reward;
            t.schedule = normSchedule(draft.schedule);
          }
        } else {
          s.tasks.push({
            id: uid(), title: title, emoji: draft.emoji, reward: reward,
            schedule: normSchedule(draft.schedule), active: true, createdAt: Date.now()
          });
        }
      });
      closeSheet(true);
      toast(existing ? '할 일을 고쳤어요' : '할 일을 만들었어요');
    }

    draw();
  }

  /* --- 부모: 삭제 / 설정 시트들 --- */

  function askDeleteTask(taskId) {
    var t = findById(state.tasks, taskId);
    if (!t) { return; }
    openSheet({
      title: '이 할 일을 지울까요?',
      subtitle: esc(t.title),
      body: '<p class="sheet-text">지금까지 쌓인 캐시 기록은 그대로 남아요.</p>',
      actions: [
        { id: 'cancel', label: '그만두기', kind: 'ghost', onClick: function () { openTaskForm(taskId); } },
        { id: 'ok', label: '지우기', kind: 'danger', onClick: function () {
          commit(function (s) {
            s.tasks = s.tasks.filter(function (x) { return x.id !== taskId; });
          });
          closeSheet(true);
          toast('할 일을 지웠어요');
        } }
      ]
    });
  }

  function toggleTask(taskId) {
    var t = findById(state.tasks, taskId);
    if (!t) { return; }
    commit(function () { t.active = (t.active === false); });
    toast(t.active === false ? '잠시 쉬는 할 일로 바꿨어요' : '다시 켰어요');
  }

  function openPinChange() {
    openSheet({
      title: '부모 비밀번호 바꾸기',
      subtitle: '4자리 숫자로 정해 주세요',
      body: sheetField('pinCurrent', '지금 비밀번호', '', { inputmode: 'numeric', maxlength: 4, placeholder: '4자리' }) +
        sheetField('pinNew', '새 비밀번호', '', { inputmode: 'numeric', maxlength: 4, placeholder: '4자리' }) +
        sheetField('pinNew2', '새 비밀번호 한 번 더', '', { inputmode: 'numeric', maxlength: 4, placeholder: '4자리' }),
      actions: [
        { id: 'cancel', label: '취소', kind: 'ghost', onClick: function () { closeSheet(); } },
        { id: 'ok', label: '바꾸기', kind: 'primary', onClick: function () {
          var cur = digits((document.getElementById('pinCurrent') || {}).value);
          var n1 = digits((document.getElementById('pinNew') || {}).value);
          var n2 = digits((document.getElementById('pinNew2') || {}).value);
          if (String(cur) !== String(state.settings.pin)) { toast('지금 비밀번호가 맞지 않아요'); return; }
          if (String(n1).length !== 4) { toast('새 비밀번호 4자리를 넣어 주세요'); return; }
          if (n1 !== n2) { toast('새 비밀번호가 서로 달라요'); return; }
          commit(function (s) { s.settings.pin = String(n1); });
          closeSheet(true);
          toast('비밀번호를 바꿨어요');
        } }
      ]
    });
  }

  function openAdjust() {
    openSheet({
      title: '잔액 조정',
      subtitle: '적립 기록 없이 잔액을 더하거나 뺄 때 써요',
      body: '<div class="field"><label class="field-label" for="adjAmount">금액</label>' +
        '<input class="input" id="adjAmount" inputmode="numeric" placeholder="예: 1000"></div>' +
        '<div class="field"><span class="field-label">방향</span><div class="seg-row">' +
          '<button type="button" class="seg is-on" data-sact="dir" data-v="plus">더하기</button>' +
          '<button type="button" class="seg" data-sact="dir" data-v="minus">빼기</button>' +
        '</div></div>' +
        '<div class="field"><label class="field-label" for="adjMemo">이유 (선택)</label>' +
        '<input class="input" id="adjMemo" maxlength="40" placeholder="예: 용돈으로 준비"></div>',
      actions: [
        { id: 'cancel', label: '취소', kind: 'ghost', onClick: function () { closeSheet(); } },
        { id: 'ok', label: '조정하기', kind: 'primary', onClick: function () {
          var amount = digits((document.getElementById('adjAmount') || {}).value);
          var memo = String((document.getElementById('adjMemo') || {}).value || '').trim().slice(0, 40);
          var minus = document.querySelector('[data-sact="dir"][data-v="minus"]');
          var dir = minus && minus.classList.contains('is-on') ? -1 : 1;
          if (!amount) { toast('금액을 넣어 주세요'); return; }
          commit(function (s) {
            s.adjustments.push({ id: uid(), amount: dir * amount, memo: memo, createdAt: Date.now() });
          });
          closeSheet(true);
          toast(won(dir * amount) + ' 잔액을 조정했어요');
        } }
      ]
    });
    var dirBtns = document.querySelectorAll('[data-sact="dir"]');
    for (var i = 0; i < dirBtns.length; i++) {
      dirBtns[i].addEventListener('click', function (ev) {
        ev.stopPropagation();
        for (var j = 0; j < dirBtns.length; j++) { dirBtns[j].classList.remove('is-on'); }
        this.classList.add('is-on');
      });
    }
  }

  function openDefaultReward() {
    openSheet({
      title: '기본 보상 금액',
      subtitle: '새 할 일을 만들 때 미리 채워져요',
      body: sheetField('defReward', '금액', state.settings.defaultReward, { inputmode: 'numeric' }) +
        '<div class="chip-row">' + [100, 300, 500, 1000].map(function (v) {
          return '<button type="button" class="chip-btn" data-sact="preset" data-v="' + v + '">' + won(v) + '</button>';
        }).join('') + '</div>',
      actions: [
        { id: 'cancel', label: '취소', kind: 'ghost', onClick: function () { closeSheet(); } },
        { id: 'ok', label: '저장', kind: 'primary', onClick: function () {
          var v = clamp(digits((document.getElementById('defReward') || {}).value), 0, 100000);
          commit(function (s) { s.settings.defaultReward = v; });
          closeSheet(true);
          toast('기본 보상을 ' + won(v) + '으로 정했어요');
        } }
      ]
    });
    var btns = document.querySelectorAll('[data-sact="preset"]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function (ev) {
        ev.stopPropagation();
        var el = document.getElementById('defReward');
        if (el) { el.value = this.getAttribute('data-v'); }
      });
    }
  }

  function openChildName() {
    openSheet({
      title: '아이 이름',
      subtitle: '아이 화면 인사에 쓰여요',
      body: sheetField('childName', '이름 또는 애칭', state.settings.childName, { maxlength: 12, placeholder: '예: 지우' }),
      actions: [
        { id: 'cancel', label: '취소', kind: 'ghost', onClick: function () { closeSheet(); } },
        { id: 'ok', label: '저장', kind: 'primary', onClick: function () {
          var v = String((document.getElementById('childName') || {}).value || '').trim().slice(0, 12);
          commit(function (s) { s.settings.childName = v; });
          closeSheet(true);
          toast('이름을 저장했어요');
        } }
      ]
    });
  }

  function openSyncSettings() {
    var cfg = sync.cfg || { url: '', room: '' };
    openSheet({
      title: '두 아이폰 연결',
      subtitle: 'Firebase Realtime Database로 실시간 동기화',
      body: '<div class="sync-status" data-sync-status>' + syncStatusHTML() + '</div>' +
        sheetField('syncUrl', 'Realtime Database 주소', cfg.url, {
          placeholder: 'https://내프로젝트-default-rtdb.firebaseio.com',
          hint: 'Firebase 콘솔 → Realtime Database에서 주소를 복사해 붙여넣으세요.'
        }) +
        sheetField('syncRoom', '가족 방 코드', cfg.room, {
          placeholder: '예: uri-family-7',
          hint: '두 아이폰에 똑같이 넣으면 같은 방으로 연결돼요. 남에게 알려주지 마세요.'
        }) +
        '<details class="more"><summary>Firebase 준비가 안 되어 있나요?</summary>' +
        '<div class="more-body"><p>1. console.firebase.google.com에서 새 프로젝트를 만들어요.</p>' +
        '<p>2. 왼쪽 메뉴에서 <strong>Realtime Database</strong> → 데이터베이스 만들기.</p>' +
        '<p>3. 규칙에서 아래처럼 읽기/쓰기를 열어요.</p>' +
        '<pre class="code">{\n  "rules": {\n    "families": {\n      "$room": { ".read": true, ".write": true }\n    }\n  }\n}</pre>' +
        '<p>4. 위 주소와 방 코드를 여기에 넣고 연결하면 끝!</p></div></details>',
      actions: (isSyncReady() ? [{ id: 'off', label: '연결 해제', kind: 'ghost', onClick: function () {
          stopSync(); sync.cfg = null; sync.status = 'local'; saveSync(); closeSheet(true); render(); toast('이 기기에서만 저장해요');
        } }] : []).concat([
        { id: 'cancel', label: '닫기', kind: 'ghost', onClick: function () { closeSheet(); } },
        { id: 'ok', label: '연결하기', kind: 'primary', onClick: function () {
          var url = normalizeDbUrl((document.getElementById('syncUrl') || {}).value);
          var room = sanitizeRoom((document.getElementById('syncRoom') || {}).value);
          if (!/^https:\/\/[a-z0-9.-]+/i.test(url)) { toast('Firebase 주소를 확인해 주세요'); return; }
          if (room.length < 3) { toast('방 코드를 3자 이상으로 정해 주세요'); return; }
          sync.cfg = { url: url, room: room };
          saveSync();
          closeSheet(true);
          startSync();
          toast('연결을 확인하고 있어요');
        } }
      ])
    });
  }

  function showInstallHelp() {
    openSheet({
      title: '홈 화면에 추가하기',
      subtitle: '아이폰 사파리에서 앱처럼 쓰는 방법',
      body: '<ol class="steps">' +
        '<li>아이폰 <strong>사파리</strong>로 이 주소를 열어요.</li>' +
        '<li>아래쪽 <strong>공유 버튼</strong>(□↑)을 눌러요.</li>' +
        '<li><strong>홈 화면에 추가</strong>를 골라요.</li>' +
        '<li>홈 화면의 <strong>할일캐시</strong> 아이콘을 누르면 앱처럼 열려요.</li>' +
      '</ol><p class="sheet-text">부모님 폰과 아이 폰 두 대 모두에 추가하면 편해요.</p>',
      actions: [{ id: 'ok', label: '알겠어요', kind: 'primary', onClick: function () { closeSheet(); } }]
    });
  }

  function askReset() {
    openSheet({
      title: '처음부터 다시 시작할까요?',
      subtitle: '이 기기의 기록이 모두 지워져요',
      body: '<p class="sheet-text">할 일, 적립 기록, 현금 교환 기록이 모두 사라져요. 되돌릴 수 없어요.</p>' +
        '<p class="sheet-text">두 아이폰이 연결되어 있다면 다른 기기 기록도 다음 동기화 때 지워질 수 있어요.</p>',
      actions: [
        { id: 'cancel', label: '그만두기', kind: 'ghost', onClick: function () { closeSheet(); } },
        { id: 'ok', label: '모두 지우기', kind: 'danger', onClick: function () {
          state = newState();
          saveState();
          closeSheet(true);
          render();
          schedulePush();
          toast('처음 상태로 되돌렸어요');
        } }
      ]
    });
  }

  /* ------------------------------------------------------------- actions */

  function handleSheetAction(id, el) {
    if (ui.sheet && ui.sheet.actions[id]) {
      ui.sheet.actions[id](el);
      return;
    }
    var extra = ui.sheetSheetActions;
    if (extra && extra[id]) { extra[id](el); }
  }

  function handleAction(act, el) {
    var id = el.getAttribute('data-id');
    switch (act) {
      case 'tab':
        ui.tab = el.getAttribute('data-tab');
        render();
        break;
      case 'switch-mode':
        if (ui.mode === 'child') {
          startPinEntry('부모 모드로 들어가려면 4자리를 눌러 주세요', function () {
            ui.mode = 'parent';
            ui.tab = 'check';
            render();
            toast('부모 모드예요');
          });
        } else {
          ui.mode = 'child';
          ui.tab = 'home';
          render();
        }
        break;
      case 'ask-complete': askComplete(id); break;
      case 'ask-payout': askPayout(); break;
      case 'cancel-payout': cancelPayout(id); break;
      case 'approve': approveCompletion(id); break;
      case 'approve-all': approveAll(); break;
      case 'reject': askReject(id); break;
      case 'revert-approval': revertApproval(id); break;
      case 'payout-pay': askPayPayout(id); break;
      case 'payout-dismiss': dismissPayout(id); break;
      case 'task-new': openTaskForm(null); break;
      case 'edit-task': openTaskForm(id); break;
      case 'del-task': askDeleteTask(id); break;
      case 'toggle-task': toggleTask(id); break;
      case 'settings-pin': openPinChange(); break;
      case 'settings-adjust': openAdjust(); break;
      case 'settings-sync': openSyncSettings(); break;
      case 'settings-reset': askReset(); break;
      case 'settings-reward': openDefaultReward(); break;
      case 'settings-name': openChildName(); break;
      case 'install-help': showInstallHelp(); break;
      case 'dismiss-hint':
        ui.hintDismissed = true;
        try { localStorage.setItem(HINT_KEY, '1'); } catch (e) { /* 무시 */ }
        render();
        break;
      default: break;
    }
  }

  /* ---------------------------------------------------------------- boot */

  function bindEvents() {
    document.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.closest) { return; }
      var keyBtn = t.closest('[data-key]');
      if (keyBtn) { pinKey(keyBtn.getAttribute('data-key')); return; }
      var sbtn = t.closest('[data-sact]');
      if (sbtn) {
        var sact = sbtn.getAttribute('data-sact');
        if (sact === '__close') {
          if (ui.sheet && ui.sheet.dismissible) { closeSheet(); }
          return;
        }
        handleSheetAction(sact, sbtn);
        return;
      }
      var btn = t.closest('[data-act]');
      if (btn) { handleAction(btn.getAttribute('data-act'), btn); }
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && document.body.classList.contains('sheet-open')) { closeSheet(); }
    });

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && isSyncReady()) { pullNow(); }
    });
    root.addEventListener('online', function () { if (isSyncReady()) { pullNow(); } renderStatusOnly(); });
    root.addEventListener('offline', function () { renderStatusOnly(); });

    setInterval(function () {
      var k = todayKey();
      if (k !== ui.lastDay) { ui.lastDay = k; render(); }
    }, 30000);
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) { return; }
    if (location.protocol !== 'http:' && location.protocol !== 'https:') { return; }
    navigator.serviceWorker.register('sw.js').catch(function () { /* 오프라인 캐시는 없어도 동작 */ });
  }

  function boot() {
    state = loadState();
    try { ui.hintDismissed = localStorage.getItem(HINT_KEY) === '1'; } catch (e) { ui.hintDismissed = false; }
    loadSync();
    bindEvents();
    render();
    if (isSyncReady()) { startSync(); }
    registerSW();
  }

  var KTR = {
    normalize: normalize,
    newState: newState,
    matchesDate: matchesDate,
    tasksForDate: tasksForDate,
    completionFor: completionFor,
    computeStats: computeStats,
    normSchedule: normSchedule,
    scheduleLabel: scheduleLabel,
    dateKeyOf: dateKeyOf,
    parseDateKey: parseDateKey,
    todayKey: todayKey,
    won: won,
    signedWon: signedWon,
    normalizeDbUrl: normalizeDbUrl,
    sanitizeRoom: sanitizeRoom,
    uid: uid
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = KTR; }
  if (typeof document !== 'undefined') { boot(); }
})(typeof globalThis !== 'undefined' ? globalThis : this);
