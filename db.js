// Camada de banco de dados.
// - Sem DATABASE_URL: usa SQLite (arquivo em ./data/votos.db) — ótimo para rodar local ou com disco persistente.
// - Com DATABASE_URL: usa PostgreSQL — recomendado em hospedagens onde o disco é apagado a cada deploy.
// Todo SQL é escrito uma vez com placeholders $1, $2... e funciona nos dois.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_SETTINGS = {
  voting_open: '1',
  require_code: process.env.REQUIRE_CODE === 'true' ? '1' : '0',
  max_per_ip: process.env.MAX_VOTES_PER_IP ?? '1',
};

let backend; // { query(sql, params) -> rows, tx(fn), kind }

// Fila simples: garante que só uma transação roda por vez neste processo.
let chain = Promise.resolve();
function serialize(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

async function makePostgres(url) {
  const { default: pg } = await import('pg');
  const wantSsl = !/localhost|127\.0\.0\.1/.test(url) && process.env.PGSSL !== 'false';
  let pool = new pg.Pool({ connectionString: url, ssl: wantSsl && { rejectUnauthorized: false }, max: 5 });
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    // Algumas conexões internas (ex.: rede privada do provedor) não aceitam SSL.
    if (!wantSsl || !/ssl/i.test(err.message)) throw err;
    await pool.end().catch(() => {});
    pool = new pg.Pool({ connectionString: url, ssl: false, max: 5 });
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS votes (
      id SERIAL PRIMARY KEY,
      king_id INTEGER NOT NULL,
      queen_id INTEGER NOT NULL,
      ip_hash TEXT NOT NULL,
      device_id TEXT NOT NULL UNIQUE,
      code TEXT UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS votes_ip_idx ON votes(ip_hash);
    CREATE TABLE IF NOT EXISTS codes (
      code TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      used_at TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  return {
    kind: 'postgres',
    query: async (sql, params = []) => (await pool.query(sql, params)).rows,
    tx: (fn) => serialize(async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Trava global: mesmo com várias instâncias do servidor, votos são processados um por vez.
        await client.query('SELECT pg_advisory_xact_lock(20261106)');
        const result = await fn(async (sql, params = []) => (await client.query(sql, params)).rows);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    }),
  };
}

async function makeSqlite() {
  const { DatabaseSync } = await import('node:sqlite');
  const file = process.env.SQLITE_PATH || path.join(process.cwd(), 'data', 'votos.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      king_id INTEGER NOT NULL,
      queen_id INTEGER NOT NULL,
      ip_hash TEXT NOT NULL,
      device_id TEXT NOT NULL UNIQUE,
      code TEXT UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS votes_ip_idx ON votes(ip_hash);
    CREATE TABLE IF NOT EXISTS codes (
      code TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      used_at TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // $1 -> ?1 (parâmetro numerado do SQLite)
  const query = async (sql, params = []) => db.prepare(sql.replace(/\$(\d+)/g, '?$1')).all(...params);

  return {
    kind: `sqlite (${file})`,
    query,
    tx: (fn) => serialize(async () => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn(query);
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    }),
  };
}

export async function initDb() {
  backend = process.env.DATABASE_URL
    ? await makePostgres(process.env.DATABASE_URL)
    : await makeSqlite();
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await backend.query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
      [key, value],
    );
  }
  return backend.kind;
}

const now = () => new Date().toISOString();

// ---------- Configurações ----------

export async function getSettings() {
  const rows = await backend.query('SELECT key, value FROM settings');
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    votingOpen: s.voting_open === '1',
    requireCode: s.require_code === '1',
    maxPerIp: Number(s.max_per_ip) || 0, // 0 = sem limite por IP
  };
}

export async function updateSettings({ votingOpen, requireCode, maxPerIp }) {
  const set = (key, value) => backend.query(
    'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    [key, String(value)],
  );
  if (typeof votingOpen === 'boolean') await set('voting_open', votingOpen ? '1' : '0');
  if (typeof requireCode === 'boolean') await set('require_code', requireCode ? '1' : '0');
  if (Number.isInteger(maxPerIp) && maxPerIp >= 0) await set('max_per_ip', maxPerIp);
  return getSettings();
}

// ---------- Votos ----------

export async function hasVoted({ deviceId, ipHash, maxPerIp }) {
  const byDevice = await backend.query('SELECT 1 FROM votes WHERE device_id = $1', [deviceId]);
  if (byDevice.length) return true;
  if (maxPerIp > 0) {
    const [{ n }] = await backend.query('SELECT COUNT(*) AS n FROM votes WHERE ip_hash = $1', [ipHash]);
    if (Number(n) >= maxPerIp) return true;
  }
  return false;
}

/**
 * Registra o voto de forma atômica. Retorna { ok: true } ou { ok: false, error }.
 * Erros: already_voted | ip_limit | invalid_code
 */
export function castVote({ kingId, queenId, ipHash, deviceId, code, settings }) {
  return backend.tx(async (q) => {
    if ((await q('SELECT 1 FROM votes WHERE device_id = $1', [deviceId])).length) {
      return { ok: false, error: 'already_voted' };
    }
    if (settings.maxPerIp > 0) {
      const [{ n }] = await q('SELECT COUNT(*) AS n FROM votes WHERE ip_hash = $1', [ipHash]);
      if (Number(n) >= settings.maxPerIp) return { ok: false, error: 'ip_limit' };
    }
    let usedCode = null;
    if (settings.requireCode) {
      const rows = await q(
        'UPDATE codes SET used_at = $1 WHERE code = $2 AND used_at IS NULL RETURNING code',
        [now(), code],
      );
      if (!rows.length) return { ok: false, error: 'invalid_code' };
      usedCode = code;
    }
    await q(
      'INSERT INTO votes (king_id, queen_id, ip_hash, device_id, code, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [kingId, queenId, ipHash, deviceId, usedCode, now()],
    );
    return { ok: true };
  });
}

export async function getResults() {
  const king = await backend.query('SELECT king_id AS id, COUNT(*) AS n FROM votes GROUP BY king_id');
  const queen = await backend.query('SELECT queen_id AS id, COUNT(*) AS n FROM votes GROUP BY queen_id');
  const [{ n: total }] = await backend.query('SELECT COUNT(*) AS n FROM votes');
  const toMap = (rows) => Object.fromEntries(rows.map((r) => [Number(r.id), Number(r.n)]));
  return { king: toMap(king), queen: toMap(queen), total: Number(total) };
}

export function resetVotes() {
  return backend.tx(async (q) => {
    await q('DELETE FROM votes');
    await q('UPDATE codes SET used_at = NULL');
  });
}

// ---------- Códigos de votação ----------

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sem 0/O, 1/I/L para evitar confusão

function randomCode(len = 6) {
  const bytes = crypto.randomBytes(len);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export async function createCodes(count) {
  const created = [];
  while (created.length < count) {
    const code = randomCode();
    const rows = await backend.query(
      'INSERT INTO codes (code, created_at) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING RETURNING code',
      [code, now()],
    );
    if (rows.length) created.push(code);
  }
  return created;
}

export async function listCodes() {
  return backend.query('SELECT code, created_at, used_at FROM codes ORDER BY created_at, code');
}

export async function deleteUnusedCodes() {
  await backend.query('DELETE FROM codes WHERE used_at IS NULL');
}
