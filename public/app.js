const WORK_START = 9;
const WORK_END = 20;

let state = {
  accounts: [],
  busySlots: [],
  currentWeekOffset: 0,
  selectedSlot: null,
  loading: false
};

// ─── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  await fetchAccounts();
  renderApp();
  if (state.accounts.some(Boolean)) {
    await fetchAvailability();
    renderCalendar();
  }
}

// ─── API ───────────────────────────────────────────────────────────────────────

async function fetchAccounts() {
  const res = await fetch('/api/accounts');
  const { accounts } = await res.json();
  state.accounts = accounts;
}

async function fetchAvailability() {
  state.loading = true;
  renderLoadingOverlay(true);
  try {
    const res = await fetch('/api/availability?days=21');
    const { busy } = await res.json();
    state.busySlots = busy.map(b => ({
      start: new Date(b.start),
      end: new Date(b.end),
      account: b.account
    }));
  } finally {
    state.loading = false;
    renderLoadingOverlay(false);
  }
}

// ─── Render ────────────────────────────────────────────────────────────────────

function renderApp() {
  const app = document.getElementById('app');
  const headerActions = document.getElementById('headerActions');
  const connected = state.accounts.filter(Boolean);

  if (connected.length === 0) {
    renderAuthScreen(app);
    headerActions.innerHTML = '';
    return;
  }

  headerActions.innerHTML = `
    <button class="btn btn-ghost btn-sm" onclick="refreshAvailability()">↻ 새로고침</button>
    <a href="/auth/logout" class="btn btn-secondary btn-sm">로그아웃</a>
  `;

  app.innerHTML = `
    <main>
      <aside class="sidebar">
        ${renderAccountsCard()}
        ${renderLegendCard()}
      </aside>
      <section>
        <div class="week-nav">
          <span class="week-label" id="weekLabel"></span>
          <div class="week-controls">
            <button class="btn btn-ghost btn-sm" onclick="changeWeek(-1)">‹</button>
            <button class="btn btn-secondary btn-sm" onclick="goToday()">오늘</button>
            <button class="btn btn-ghost btn-sm" onclick="changeWeek(1)">›</button>
          </div>
        </div>
        <div class="calendar-wrapper">
          <div id="loadingOverlay" style="display:none" class="loading-overlay">
            <div class="spinner-navy"></div>
          </div>
          <div class="calendar-grid" id="calendarGrid"></div>
        </div>
      </section>
    </main>
  `;

  renderCalendar();
}

function renderAuthScreen(container) {
  const slots = [
    { label: '개인 구글 계정', sub: 'chxxnkim@gmail.com' },
    { label: '토스 워크스페이스', sub: 'chaewon@toss.im' }
  ];

  const accountBtns = slots.map((slot, i) => {
    const acct = state.accounts[i];
    const connected = acct && acct.email;
    return `
      <a href="${connected ? '#' : `/auth/login?slot=${i}`}"
         class="auth-account-btn ${connected ? 'connected' : ''}"
         ${connected ? 'onclick="return false"' : ''}>
        <svg class="google-icon" viewBox="0 0 24 24">
          <path fill="${connected ? '#22C55E' : '#4285F4'}" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="${connected ? '#22C55E' : '#34A853'}" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="${connected ? '#22C55E' : '#FBBC05'}" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="${connected ? '#22C55E' : '#EA4335'}" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        <div style="flex:1;text-align:left">
          <div style="font-family:var(--font-head);font-weight:600;font-size:14px;color:var(--navy)">${slot.label}</div>
          <div style="font-size:12px;color:var(--slate);margin-top:2px">
            ${connected ? `<span style="color:var(--success)">✓ 연결됨 — </span>${acct.email}` : slot.sub}
          </div>
        </div>
        ${connected ? '<span class="chip chip-success">연결됨</span>' : '<span style="font-size:12px;color:var(--slate)">→</span>'}
      </a>
    `;
  }).join('');

  container.innerHTML = `
    <div class="auth-screen">
      <div class="auth-badge">📅</div>
      <h2 class="auth-title">캘린더 연결</h2>
      <p class="auth-desc">두 캘린더를 연결하면 일정이 겹치지 않는 시간대를 한눈에 보고, 바로 미팅을 만들 수 있어요.</p>
      <div class="auth-accounts">${accountBtns}</div>
    </div>
  `;
}

function renderAccountsCard() {
  const slots = [
    { label: '개인', fallbackEmail: 'chxxnkim@gmail.com' },
    { label: '토스', fallbackEmail: 'chaewon@toss.im' }
  ];

  const items = slots.map((slot, i) => {
    const acct = state.accounts[i];
    const connected = acct && acct.email;
    return `
      <div class="account-item">
        <div class="account-avatar avatar-${i}">${slot.label[0]}</div>
        <div class="account-info">
          <div class="account-email">${connected ? acct.email : slot.fallbackEmail}</div>
          <div class="account-status ${connected ? 'status-connected' : 'status-disconnected'}">
            ${connected ? '● 연결됨' : '○ 미연결'}
          </div>
        </div>
        ${connected
          ? `<span class="chip chip-success">활성</span>`
          : `<a href="/auth/login?slot=${i}" class="btn btn-secondary btn-sm">연결</a>`
        }
      </div>
    `;
  }).join('');

  return `
    <div class="card">
      <div class="card-header">연결된 캘린더</div>
      <div class="card-body">${items}</div>
    </div>
  `;
}

function renderLegendCard() {
  return `
    <div class="card">
      <div class="card-header">범례</div>
      <div class="card-body">
        <div class="legend">
          <div class="legend-item">
            <div class="legend-dot" style="background:var(--sage)"></div>
            <span>빈 시간 — 클릭해서 미팅 예약</span>
          </div>
          <div class="legend-item">
            <div class="legend-dot" style="background:var(--error)"></div>
            <span>바쁜 시간 (두 캘린더 통합)</span>
          </div>
          <div class="legend-item">
            <div class="legend-dot" style="background:var(--border)"></div>
            <span>업무 시간 외 (9AM – 8PM)</span>
          </div>
        </div>
        <div class="divider"></div>
        <p style="font-size:12px;color:var(--slate);line-height:1.6">
          빈 슬롯 클릭 → 미팅 생성.<br>Google Meet 링크가 자동으로 추가돼요.
        </p>
      </div>
    </div>
  `;
}

function renderCalendar() {
  const grid = document.getElementById('calendarGrid');
  const weekLabel = document.getElementById('weekLabel');
  if (!grid) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay() + 1 + state.currentWeekOffset * 7);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  const dayNames = ['월', '화', '수', '목', '금', '토', '일'];

  if (weekLabel) {
    const startStr = days[0].toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
    const endStr = days[6].toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
    weekLabel.textContent = `${days[0].getFullYear()}년 ${startStr} – ${endStr}`;
  }

  const hours = [];
  for (let h = WORK_START - 1; h <= WORK_END; h++) hours.push(h);

  let html = '';

  // Header row
  html += `<div class="cal-time-header"></div>`;
  days.forEach((day, i) => {
    const isToday = day.getTime() === today.getTime();
    html += `
      <div class="cal-day-header ${isToday ? 'today' : ''}">
        <div class="cal-day-name">${dayNames[i]}</div>
        <div class="cal-day-number">${day.getDate()}</div>
      </div>
    `;
  });

  // Time rows
  hours.forEach(h => {
    html += `<div class="cal-time-label">${h === WORK_START - 1 ? '' : `${h}:00`}</div>`;

    days.forEach(day => {
      const slotStart = new Date(day);
      slotStart.setHours(h, 0, 0, 0);
      const slotEnd = new Date(slotStart);
      slotEnd.setHours(h + 1);

      const isPast = slotStart < new Date();
      const isOutside = h < WORK_START || h >= WORK_END;
      const busyInfo = getBusyInfo(slotStart, slotEnd);
      const isBusy = busyInfo.busy;
      const isSelected = state.selectedSlot &&
        state.selectedSlot.getTime() === slotStart.getTime();

      let cls = 'cal-cell';
      if (isPast) cls += ' past';
      else if (isOutside) cls += ' outside-hours';
      else if (isBusy) cls += ' busy';
      if (isSelected) cls += ' selected';

      const busyLabel = isBusy && !isOutside
        ? `<div class="busy-indicator">${busyInfo.accounts.join(' · ')}</div>`
        : '';

      const onclick = (!isPast && !isOutside && !isBusy)
        ? `onclick="selectSlot('${slotStart.toISOString()}','${slotEnd.toISOString()}')" title="${formatSlotTitle(slotStart)}"`
        : '';

      html += `<div class="${cls}" ${onclick}>${busyLabel}</div>`;
    });
  });

  grid.innerHTML = html;
}

function formatSlotTitle(date) {
  return date.toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function getBusyInfo(slotStart, slotEnd) {
  const overlapping = state.busySlots.filter(b => b.start < slotEnd && b.end > slotStart);
  if (!overlapping.length) return { busy: false };
  const accounts = [...new Set(overlapping.map(b =>
    b.account.includes('toss') ? '토스' : '개인'
  ))];
  return { busy: true, accounts };
}

// ─── Interactions ──────────────────────────────────────────────────────────────

function selectSlot(startISO, endISO) {
  state.selectedSlot = new Date(startISO);
  renderCalendar();
  openModal(startISO, endISO);
}

function changeWeek(delta) {
  state.currentWeekOffset += delta;
  renderCalendar();
}

function goToday() {
  state.currentWeekOffset = 0;
  renderCalendar();
}

async function refreshAvailability() {
  await fetchAvailability();
  renderCalendar();
  showToast('캘린더를 새로고침했어요');
}

function renderLoadingOverlay(show) {
  const el = document.getElementById('loadingOverlay');
  if (el) el.style.display = show ? 'flex' : 'none';
}

// ─── Modal ─────────────────────────────────────────────────────────────────────

function openModal(startISO, endISO) {
  const fmt = iso => {
    const d = new Date(iso);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  document.getElementById('meetingStart').value = fmt(startISO);
  document.getElementById('meetingEnd').value = fmt(endISO);
  document.getElementById('meetingTitle').value = '';
  document.getElementById('meetingAttendees').value = '';
  document.getElementById('meetingDesc').value = '';
  document.getElementById('meetingModal').classList.add('open');
  setTimeout(() => document.getElementById('meetingTitle').focus(), 200);
}

function closeModal() {
  document.getElementById('meetingModal').classList.remove('open');
  state.selectedSlot = null;
  renderCalendar();
}

async function createMeeting() {
  const title = document.getElementById('meetingTitle').value.trim();
  const startVal = document.getElementById('meetingStart').value;
  const endVal = document.getElementById('meetingEnd').value;
  const attendeesRaw = document.getElementById('meetingAttendees').value;
  const description = document.getElementById('meetingDesc').value.trim();

  if (!title) { showToast('미팅 제목을 입력해 주세요', 'error'); return; }
  if (!startVal || !endVal) { showToast('시간을 입력해 주세요', 'error'); return; }

  const attendees = attendeesRaw.split(',').map(e => e.trim()).filter(Boolean);
  const btn = document.getElementById('createBtn');
  btn.innerHTML = '<span class="spinner"></span> 만드는 중...';
  btn.disabled = true;

  try {
    const res = await fetch('/api/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        startTime: new Date(startVal).toISOString(),
        endTime: new Date(endVal).toISOString(),
        attendees,
        description
      })
    });
    const data = await res.json();

    if (data.success) {
      closeModal();
      showToast('미팅이 생성됐어요! 캘린더를 확인해 보세요', 'success');
      if (data.htmlLink) setTimeout(() => window.open(data.htmlLink, '_blank'), 600);
      await fetchAvailability();
      renderCalendar();
    } else {
      showToast(data.error || '미팅 생성에 실패했어요', 'error');
    }
  } catch {
    showToast('네트워크 오류가 발생했어요', 'error');
  } finally {
    btn.innerHTML = '미팅 만들기';
    btn.disabled = false;
  }
}

document.getElementById('meetingModal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeModal();
});

// ─── Toast ─────────────────────────────────────────────────────────────────────

function showToast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ─── Start ─────────────────────────────────────────────────────────────────────

init();
