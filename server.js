require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');

// ─── Mailer ───────────────────────────────────────────────────────────────────

const mailer = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

const ADMIN_EMAIL = 'chxxnkim@gmail.com';

function fmtDate(iso) {
  return new Date(iso).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: 'long', day: 'numeric',
    weekday: 'short', hour: '2-digit', minute: '2-digit'
  });
}

function sendMail(opts) {
  if (!process.env.GMAIL_APP_PASSWORD) return;
  return mailer.sendMail(opts).catch(err => console.error('Mail error:', err.message));
}

// 어드민에게 새 요청 알림
function notifyAdmin(request) {
  const candidates = request.candidates?.length
    ? request.candidates.map((c, i) => `후보${i + 1}: ${fmtDate(c.start)} — ${fmtDate(c.end)}`).join('\n')
    : fmtDate(request.requestedStart) + ' — ' + fmtDate(request.requestedEnd);

  sendMail({
    from: `"냥비서" <${process.env.GMAIL_USER}>`,
    to: ADMIN_EMAIL,
    subject: `[냥비서] ${request.requesterName}님의 미팅 요청 도착`,
    text: [
      `새로운 미팅 요청이 도착했다냥!`,
      ``,
      `이름: ${request.requesterName}`,
      `이메일: ${request.requesterEmail}`,
      `미팅 제목: ${request.title || '(없음)'}`,
      ``,
      `── 희망 시간 ──`,
      candidates,
      ``,
      `목적: ${request.purpose || '(없음)'}`,
      ``,
      `어드민에서 확인하세요 → http://localhost:3000/admin`
    ].join('\n')
  });
}

// 요청자에게 수락 알림
function notifyApproved(request, htmlLink, meetLink) {
  const timeStr = `${fmtDate(request.requestedStart)} — ${fmtDate(request.requestedEnd)}`;
  sendMail({
    from: `"김채원" <${process.env.GMAIL_USER}>`,
    to: request.requesterEmail,
    subject: `[미팅 확정 안내] 안녕하세요, 김채원입니다.`,
    text: [
      `안녕하세요, 시간 내어 미팅 요청해주셔서 감사합니다.`,
      `보내주신 시간대 중 ${timeStr}에 뵈면 좋을 것 같습니다.`,
      `감사합니다.`,
      ``,
      `김채원 드림`,
      ``,
      htmlLink ? `캘린더: ${htmlLink}` : '',
      meetLink ? `Meet:   ${meetLink}` : '',
    ].filter(Boolean).join('\n')
  });
}

// 요청자에게 거절 알림
function notifyRejected(request) {
  sendMail({
    from: `"냥비서" <${process.env.GMAIL_USER}>`,
    to: request.requesterEmail,
    subject: `[냥비서] 미팅 요청 결과 안내`,
    text: [
      `${request.requesterName}님, 아쉽게도 이번 미팅 요청은 어렵겠다냥.`,
      `다음에 다시 요청해달라냥!`,
    ].join('\n')
  });
}

const app = express();
const PORT = process.env.PORT || 3000;
const REDIRECT_URI = process.env.REDIRECT_URI || `http://localhost:${PORT}/auth/callback`;

// ─── Storage helpers ──────────────────────────────────────────────────────────

const DATA_DIR = path.join(__dirname, 'data');
const TOKENS_FILE = path.join(DATA_DIR, 'tokens.json');
const REQUESTS_FILE = path.join(DATA_DIR, 'requests.json');

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); }
  catch { return fallback; }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function getTokens() { return readJSON(TOKENS_FILE, []); }
function saveTokens(tokens) { writeJSON(TOKENS_FILE, tokens); }
function getRequests() { return readJSON(REQUESTS_FILE, []); }
function saveRequests(requests) { writeJSON(REQUESTS_FILE, requests); }

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// Serve static files but handle routing manually
app.use(express.static(path.join(__dirname, 'public')));

// ─── OAuth helpers ────────────────────────────────────────────────────────────

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'email',
  'profile'
];

function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    REDIRECT_URI
  );
}

function isAdmin(req) {
  return !!req.session.isAdmin;
}

// ─── Auth routes ──────────────────────────────────────────────────────────────

app.get('/auth/login', (req, res) => {
  const slot = parseInt(req.query.slot || '0');
  req.session.pendingSlot = slot;
  const oauth2Client = createOAuth2Client();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent select_account'
  });
  res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.redirect('/admin?error=auth_denied');

  try {
    const oauth2Client = createOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();

    const slot = req.session.pendingSlot ?? 0;
    const stored = getTokens();
    stored[slot] = { tokens, email: userInfo.email };
    saveTokens(stored);

    req.session.isAdmin = true;
    res.redirect('/admin');
  } catch (err) {
    console.error('Auth error:', err);
    res.redirect('/admin?error=auth_failed');
  }
});

app.get('/auth/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin');
});

// ─── Admin API ────────────────────────────────────────────────────────────────

app.get('/api/admin/accounts', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const tokens = getTokens();
  res.json({ accounts: tokens.map(t => t ? { email: t.email } : null) });
});

app.get('/api/admin/requests', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const requests = getRequests();
  res.json({ requests: requests.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) });
});

app.post('/api/admin/requests/:id/approve', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

  const tokens = getTokens();
  const primary = tokens.find(Boolean);
  if (!primary) return res.status(400).json({ error: 'No calendar connected' });

  const requests = getRequests();
  const idx = requests.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Request not found' });

  const request = requests[idx];
  if (request.status !== 'pending') return res.status(400).json({ error: 'Already processed' });

  try {
    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials(primary.tokens);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const event = {
      summary: request.title || `${request.requesterName}님과 미팅`,
      description: `요청자: ${request.requesterName} (${request.requesterEmail})\n\n목적: ${request.purpose || ''}`,
      start: { dateTime: request.requestedStart, timeZone: 'Asia/Seoul' },
      end:   { dateTime: request.requestedEnd,   timeZone: 'Asia/Seoul' },
      attendees: [{ email: request.requesterEmail }],
      conferenceData: {
        createRequest: {
          requestId: `meet-${request.id}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' }
        }
      }
    };

    const { data } = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: event,
      conferenceDataVersion: 1,
      sendUpdates: 'all'
    });

    requests[idx] = {
      ...request,
      status: 'approved',
      eventId: data.id,
      htmlLink: data.htmlLink,
      meetLink: data.conferenceData?.entryPoints?.[0]?.uri,
      processedAt: new Date().toISOString()
    };
    saveRequests(requests);
    notifyApproved(requests[idx], data.htmlLink, data.conferenceData?.entryPoints?.[0]?.uri);

    res.json({ success: true, htmlLink: data.htmlLink });
  } catch (err) {
    console.error('Approve error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/requests/:id/reject', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

  const requests = getRequests();
  const idx = requests.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  requests[idx].status = 'rejected';
  requests[idx].processedAt = new Date().toISOString();
  saveRequests(requests);
  notifyRejected(requests[idx]);
  res.json({ success: true });
});

// ─── Public API ───────────────────────────────────────────────────────────────

app.get('/api/availability', async (req, res) => {
  const tokens = getTokens();
  const connected = tokens.filter(Boolean);
  if (connected.length === 0) return res.json({ busy: [] });

  const days = parseInt(req.query.days || '14');
  const timeMin = new Date();
  timeMin.setHours(0, 0, 0, 0);
  const timeMax = new Date(timeMin);
  timeMax.setDate(timeMax.getDate() + days);

  const allBusy = [];

  for (const account of connected) {
    try {
      const oauth2Client = createOAuth2Client();
      oauth2Client.setCredentials(account.tokens);

      // Refresh token if needed
      oauth2Client.on('tokens', (newTokens) => {
        const idx = tokens.indexOf(account);
        if (idx >= 0) {
          tokens[idx].tokens = { ...account.tokens, ...newTokens };
          saveTokens(tokens);
        }
      });

      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      const { data } = await calendar.freebusy.query({
        requestBody: {
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          items: [{ id: 'primary' }]
        }
      });

      (data.calendars?.primary?.busy || []).forEach(slot => {
        allBusy.push({ start: slot.start, end: slot.end, account: account.email });
      });
    } catch (err) {
      console.error(`Freebusy error for ${account.email}:`, err.message);
    }
  }

  // Also mark approved/pending requests as busy
  const requests = getRequests();
  requests
    .filter(r => r.status === 'pending' || r.status === 'approved')
    .forEach(r => {
      allBusy.push({ start: r.requestedStart, end: r.requestedEnd, account: 'requested' });
    });

  res.json({ busy: allBusy });
});

app.post('/api/request', (req, res) => {
  const { requesterName, requesterEmail, purpose, requestedStart, requestedEnd, title, candidates } = req.body;
  if (!requesterName || !requesterEmail || !requestedStart || !requestedEnd) {
    return res.status(400).json({ error: '이름, 이메일, 시간은 필수예요' });
  }

  const requests = getRequests();
  const newRequest = {
    id: `req-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
    requesterName,
    requesterEmail,
    purpose: purpose || '',
    title: title || '',
    requestedStart,
    requestedEnd,
    candidates: Array.isArray(candidates) ? candidates : [],
    status: 'pending',
    createdAt: new Date().toISOString()
  };

  requests.push(newRequest);
  saveRequests(requests);
  notifyAdmin(newRequest);
  console.log(`New meeting request from ${requesterName} (${requesterEmail})`);
  res.json({ success: true, id: newRequest.id });
});

// ─── Page routes ──────────────────────────────────────────────────────────────

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, () => {
  console.log(`\n✅ Server running at http://localhost:${PORT}`);
  console.log(`   Public:  http://localhost:${PORT}/`);
  console.log(`   Admin:   http://localhost:${PORT}/admin\n`);
});
