import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { KINGS, QUEENS, isKing, isQueen } from './candidates.js';
import * as db from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const IP_SALT = process.env.IP_SALT || 'baile-de-primavera';
const IS_PROD = process.env.NODE_ENV === 'production';
const COOKIE = 'voter_id';

const app = express();

// Atrás de um proxy (Render, Railway, etc.) o IP real vem no X-Forwarded-For.
// TRUST_PROXY = número de proxies na frente do app (padrão 1). Use 0 ao rodar direto no seu PC.
const trust = process.env.TRUST_PROXY ?? '1';
app.set('trust proxy', /^\d+$/.test(trust) ? Number(trust) : trust);
app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));

// ---------- utilidades ----------

const hashIp = (ip) => crypto.createHash('sha256').update(`${IP_SALT}:${ip}`).digest('hex');

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((p) => p.trim().split('=')).filter(([k, v]) => k && v)
      .map(([k, v]) => [k, decodeURIComponent(v)]),
  );
}

// Identificador do aparelho: cookie aleatório que dura 1 ano.
function getDeviceId(req, res) {
  let id = parseCookies(req.headers.cookie)[COOKIE];
  if (!id || !/^[a-f0-9]{32}$/.test(id)) {
    id = crypto.randomBytes(16).toString('hex');
    res.cookie(COOKIE, id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: IS_PROD,
      maxAge: 365 * 24 * 60 * 60 * 1000,
    });
  }
  return id;
}

// Limitador simples em memória (anti-spam / força bruta).
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs).unref();
  return (req, res, next) => {
    const n = (hits.get(req.ip) || 0) + 1;
    hits.set(req.ip, n);
    if (n > max) return res.status(429).json({ error: 'too_many_requests' });
    next();
  };
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'admin_disabled' });
  if (!safeEqual(req.get('x-admin-password') || '', ADMIN_PASSWORD)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- API pública ----------

app.get('/api/candidates', (req, res) => res.json({ kings: KINGS, queens: QUEENS }));

app.get('/api/status', wrap(async (req, res) => {
  const deviceId = getDeviceId(req, res);
  const settings = await db.getSettings();
  const hasVoted = await db.hasVoted({ deviceId, ipHash: hashIp(req.ip), maxPerIp: settings.maxPerIp });
  res.json({ votingOpen: settings.votingOpen, requireCode: settings.requireCode, hasVoted });
}));

app.post('/api/vote', rateLimit({ windowMs: 60_000, max: 300 }), wrap(async (req, res) => {
  const deviceId = getDeviceId(req, res);
  const settings = await db.getSettings();
  if (!settings.votingOpen) return res.status(403).json({ error: 'voting_closed' });

  const kingId = Number(req.body?.kingId);
  const queenId = Number(req.body?.queenId);
  if (!isKing(kingId) || !isQueen(queenId)) return res.status(400).json({ error: 'invalid_candidate' });

  const code = String(req.body?.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (settings.requireCode && !code) return res.status(400).json({ error: 'invalid_code' });

  try {
    const result = await db.castVote({ kingId, queenId, ipHash: hashIp(req.ip), deviceId, code, settings });
    if (!result.ok) return res.status(409).json({ error: result.error });
    res.json({ ok: true });
  } catch (err) {
    // Violação de UNIQUE = duplicado que escapou (ex.: duas abas ao mesmo tempo).
    if (/unique|duplicate/i.test(err.message)) return res.status(409).json({ error: 'already_voted' });
    throw err;
  }
}));

// ---------- API do administrador ----------

const admin = express.Router();
admin.use(rateLimit({ windowMs: 60_000, max: 60 }), requireAdmin);

admin.get('/overview', wrap(async (req, res) => {
  const [settings, results] = await Promise.all([db.getSettings(), db.getResults()]);
  const rank = (list, counts) => list
    .map((c) => ({ ...c, votes: counts[c.id] || 0 }))
    .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name, 'pt-BR'));
  res.json({
    settings,
    total: results.total,
    kings: rank(KINGS, results.king),
    queens: rank(QUEENS, results.queen),
    yourIp: req.ip,
    forwardedFor: req.get('x-forwarded-for') || null,
  });
}));

admin.post('/settings', wrap(async (req, res) => {
  const { votingOpen, requireCode, maxPerIp } = req.body || {};
  res.json(await db.updateSettings({ votingOpen, requireCode, maxPerIp: Number(maxPerIp) }));
}));

admin.get('/codes', wrap(async (req, res) => res.json(await db.listCodes())));

admin.post('/codes', wrap(async (req, res) => {
  const count = Math.min(Math.max(parseInt(req.body?.count, 10) || 0, 1), 2000);
  res.json({ created: await db.createCodes(count) });
}));

admin.delete('/codes/unused', wrap(async (req, res) => {
  await db.deleteUnusedCodes();
  res.json({ ok: true });
}));

admin.post('/reset', wrap(async (req, res) => {
  if (req.body?.confirm !== 'ZERAR') return res.status(400).json({ error: 'confirmation_required' });
  await db.resetVotes();
  res.json({ ok: true });
}));

app.use('/api/admin', admin);

// ---------- páginas ----------

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'server_error' });
});

const kind = await db.initDb();
app.listen(PORT, () => {
  console.log(`🌸 Baile de Primavera rodando em http://localhost:${PORT}`);
  console.log(`   Banco de dados: ${kind}`);
  if (!ADMIN_PASSWORD) console.log('   ⚠️  ADMIN_PASSWORD não definida — painel /admin desativado.');
});
