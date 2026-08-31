import crypto from 'crypto';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import type { Firestore } from 'firebase-admin/firestore';

/**
 * Single-owner authentication.
 *
 *  • Web app: POST /api/login with the passphrase → httpOnly session cookie.
 *  • Claude connector (remote MCP): OAuth 2.1 authorization server with PKCE and
 *    dynamic client registration. The /oauth/authorize page asks for the same
 *    passphrase; tokens are HMAC-signed JWTs so the server stays stateless
 *    (Cloud Run can run several instances).
 *
 * Required env: OWNER_PASSPHRASE_HASH (from `npm run passphrase`), AUTH_SECRET.
 */

export const SESSION_COOKIE = 'invintory_session';
const ACCESS_TTL = 60 * 60 * 24; // 24 h
const REFRESH_TTL = 60 * 60 * 24 * 180; // 180 d
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 d
const CODE_TTL = 10 * 60; // 10 min
const MAX_FAILURES = 8;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

const ALLOWED_REDIRECT_HOSTS = ['claude.ai', 'claude.com', 'anthropic.com', 'localhost', '127.0.0.1'];

export interface AuthConfig {
  passphraseHash: string;
  secret: string;
  extraRedirectHosts: string[];
}

export function loadAuthConfig(): AuthConfig {
  const passphraseHash = process.env.OWNER_PASSPHRASE_HASH?.trim();
  const secret = process.env.AUTH_SECRET?.trim();
  if (!passphraseHash || !secret) {
    throw new Error(
      'OWNER_PASSPHRASE_HASH and AUTH_SECRET must be set. Run `npm run passphrase` to generate them.',
    );
  }
  const extraRedirectHosts = (process.env.OAUTH_EXTRA_REDIRECT_HOSTS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return { passphraseHash, secret, extraRedirectHosts };
}

// ── Passphrase hashing (scrypt) ───────────────────────────────────────────────

export function hashPassphrase(passphrase: string): string {
  const N = 16384;
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(passphrase.normalize('NFKC'), salt, 32, { N, r: 8, p: 1 });
  return `scrypt$${N}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export function verifyPassphrase(passphrase: string, stored: string): boolean {
  try {
    const [alg, nStr, saltB, keyB] = stored.split('$');
    if (alg !== 'scrypt') return false;
    const salt = Buffer.from(saltB, 'base64url');
    const key = Buffer.from(keyB, 'base64url');
    const test = crypto.scryptSync(passphrase.normalize('NFKC'), salt, key.length, {
      N: parseInt(nStr, 10),
      r: 8,
      p: 1,
    });
    return test.length === key.length && crypto.timingSafeEqual(test, key);
  } catch {
    return false;
  }
}

// ── Signed tokens (compact HS256 JWT, no external deps) ───────────────────────

export interface TokenPayload {
  typ: 'access' | 'refresh' | 'session';
  sub: 'owner';
  cid?: string;
  scope?: string;
  iat: number;
  exp: number;
  jti: string;
}

function b64u(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

export function signToken(secret: string, payload: Omit<TokenPayload, 'iat' | 'exp' | 'jti'>, ttlSec: number): string {
  const now = Math.floor(Date.now() / 1000);
  const body: TokenPayload = { ...payload, iat: now, exp: now + ttlSec, jti: crypto.randomBytes(8).toString('hex') };
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const pl = b64u(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${pl}`).digest('base64url');
  return `${head}.${pl}.${sig}`;
}

export function verifyToken(secret: string, token: string | undefined | null): TokenPayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [head, pl, sig] = parts;
  const expected = crypto.createHmac('sha256', secret).update(`${head}.${pl}`).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(pl, 'base64url').toString('utf8')) as TokenPayload;
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (payload.sub !== 'owner') return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Request helpers ───────────────────────────────────────────────────────────

export function baseUrlOf(req: Request): string {
  const fixed = process.env.PUBLIC_BASE_URL?.trim();
  if (fixed) return fixed.replace(/\/+$/, '');
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() || req.protocol;
  const host = (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim() || req.get('host');
  return `${proto}://${host}`;
}

function clientIp(req: Request): string {
  const fwd = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  return fwd || req.socket.remoteAddress || 'unknown';
}

function parseCookies(req: Request): Record<string, string> {
  const raw = req.headers.cookie;
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

function bearerOf(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

// ── Brute-force protection ────────────────────────────────────────────────────
// Two layers. A per-IP counter in memory (cheap, per instance), and a GLOBAL
// escalating lockout persisted in Firestore so a short passcode cannot be
// guessed by spreading attempts across IPs or Cloud Run instances:
// after GLOBAL_FREE_ATTEMPTS wrong tries every login is refused for 15 min,
// doubling on each further failure up to 24 h. A correct login resets it.
// (Existing sessions and connector tokens keep working during a lockout.)

const LOCK_DOC = 'auth_lockout';
const GLOBAL_FREE_ATTEMPTS = 5;
const BASE_LOCK_MS = 15 * 60 * 1000;
const MAX_LOCK_MS = 24 * 60 * 60 * 1000;
const FAILURE_MEMORY_MS = 24 * 60 * 60 * 1000;

interface LockDoc {
  failures: number;
  lockedUntil: number;
  lastFailureAt: number;
}

const failures = new Map<string, { n: number; reset: number }>();

function ipBlockedUntil(ip: string): number {
  const f = failures.get(ip);
  if (!f) return 0;
  if (Date.now() > f.reset) {
    failures.delete(ip);
    return 0;
  }
  return f.n >= MAX_FAILURES ? f.reset : 0;
}

async function readLock(db: Firestore): Promise<LockDoc> {
  const snap = await db.collection('meta').doc(LOCK_DOC).get();
  const d = snap.exists ? (snap.data() as LockDoc) : { failures: 0, lockedUntil: 0, lastFailureAt: 0 };
  if (d.lastFailureAt && Date.now() - d.lastFailureAt > FAILURE_MEMORY_MS) return { failures: 0, lockedUntil: 0, lastFailureAt: 0 };
  return d;
}

async function lockStatus(db: Firestore, ip: string): Promise<{ blocked: boolean; retryAfterSec: number }> {
  const now = Date.now();
  const local = ipBlockedUntil(ip);
  if (local > now) return { blocked: true, retryAfterSec: Math.ceil((local - now) / 1000) };
  const g = await readLock(db);
  if (g.lockedUntil > now) return { blocked: true, retryAfterSec: Math.ceil((g.lockedUntil - now) / 1000) };
  return { blocked: false, retryAfterSec: 0 };
}

async function noteFailure(db: Firestore, ip: string): Promise<void> {
  const f = failures.get(ip);
  if (!f || Date.now() > f.reset) failures.set(ip, { n: 1, reset: Date.now() + FAILURE_WINDOW_MS });
  else f.n += 1;
  const g = await readLock(db);
  const count = g.failures + 1;
  let lockedUntil = g.lockedUntil;
  if (count >= GLOBAL_FREE_ATTEMPTS) {
    lockedUntil = Date.now() + Math.min(BASE_LOCK_MS * 2 ** (count - GLOBAL_FREE_ATTEMPTS), MAX_LOCK_MS);
  }
  await db.collection('meta').doc(LOCK_DOC).set({ failures: count, lockedUntil, lastFailureAt: Date.now() } as LockDoc);
  console.warn(`auth: wrong passcode from ${ip} (global failure #${count}${lockedUntil > Date.now() ? ', locked' : ''})`);
}

async function noteSuccess(db: Firestore, ip: string): Promise<void> {
  failures.delete(ip);
  const g = await readLock(db);
  if (g.failures || g.lockedUntil) await db.collection('meta').doc(LOCK_DOC).set({ failures: 0, lockedUntil: 0, lastFailureAt: 0 } as LockDoc);
}

function humanWait(sec: number): string {
  if (sec < 90) return `${sec} seconds`;
  if (sec < 3600) return `${Math.ceil(sec / 60)} minutes`;
  return `${Math.ceil(sec / 3600)} hours`;
}

// ── Redirect URI policy ───────────────────────────────────────────────────────

function redirectAllowed(uri: string, extra: string[]): boolean {
  try {
    const u = new URL(uri);
    const h = u.hostname.toLowerCase();
    const hosts = [...ALLOWED_REDIRECT_HOSTS, ...extra];
    if (!hosts.some((a) => h === a || h.endsWith('.' + a))) return false;
    if (h === 'localhost' || h === '127.0.0.1') return u.protocol === 'http:' || u.protocol === 'https:';
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

// ── HTML ──────────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function loginPage(opts: { action: string; hidden: Record<string, string>; error?: string; clientName?: string }): string {
  const hidden = Object.entries(opts.hidden)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Invintory — sign in</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#020617;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  .card{width:100%;max-width:380px;margin:16px;background:#0f172a;border:1px solid #1e293b;border-radius:16px;padding:28px}
  h1{font-size:20px;margin:0 0 4px}
  p{color:#94a3b8;font-size:14px;margin:0 0 20px}
  label{display:block;font-size:12px;color:#94a3b8;margin-bottom:6px}
  input[type=password]{width:100%;box-sizing:border-box;background:#020617;border:1px solid #334155;border-radius:10px;padding:12px;color:#fff;font-size:16px}
  button{width:100%;margin-top:14px;background:#ab1f40;color:#fff;border:0;border-radius:10px;padding:12px;font-size:15px;font-weight:600}
  .err{background:#450a0a;border:1px solid #7f1d1d;color:#fca5a5;padding:10px 12px;border-radius:10px;font-size:13px;margin-bottom:14px}
  .who{font-size:12px;color:#64748b;margin-top:16px}
</style></head><body>
<form class="card" method="post" action="${esc(opts.action)}" autocomplete="off">
  <h1>🍷 Invintory</h1>
  <p>${opts.clientName ? `<b>${esc(opts.clientName)}</b> wants access to your wine cellar.` : 'Enter your passcode to continue.'}</p>
  ${opts.error ? `<div class="err">${esc(opts.error)}</div>` : ''}
  ${hidden}
  <label for="pp">Passcode</label>
  <input id="pp" type="password" name="passphrase" required autofocus autocomplete="current-password">
  <button type="submit">Sign in</button>
  <div class="who">Single-owner access. Sessions expire automatically.</div>
</form></body></html>`;
}

// ── Firestore-backed OAuth client / code storage ──────────────────────────────

interface OAuthClientDoc {
  client_id: string;
  client_secret_hash: string | null;
  client_name: string;
  redirect_uris: string[];
  token_endpoint_auth_method: 'none' | 'client_secret_post' | 'client_secret_basic';
  created_at: string;
}

interface OAuthCodeDoc {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  scope: string;
  resource: string;
  exp: number;
}

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('base64url');
}

// ── Middleware factories ──────────────────────────────────────────────────────

export interface AuthedLocals {
  auth?: { via: 'bearer' | 'cookie'; payload: TokenPayload };
}

/** Accepts either a session cookie (web app) or a bearer access token (MCP/API clients). */
export function requireOwner(cfg: AuthConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const bearer = verifyToken(cfg.secret, bearerOf(req));
    if (bearer && bearer.typ === 'access') {
      (res.locals as AuthedLocals).auth = { via: 'bearer', payload: bearer };
      next();
      return;
    }
    const cookie = verifyToken(cfg.secret, parseCookies(req)[SESSION_COOKIE]);
    if (cookie && cookie.typ === 'session') {
      (res.locals as AuthedLocals).auth = { via: 'cookie', payload: cookie };
      next();
      return;
    }
    res.status(401).json({ error: 'Not signed in' });
  };
}

/** Bearer-only guard for /mcp; replies with the RFC 9728 challenge header so MCP clients discover the OAuth server. */
export function requireBearer(cfg: AuthConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const payload = verifyToken(cfg.secret, bearerOf(req));
    if (payload && payload.typ === 'access') {
      (res.locals as AuthedLocals).auth = { via: 'bearer', payload };
      next();
      return;
    }
    const base = baseUrlOf(req);
    res
      .set(
        'WWW-Authenticate',
        `Bearer realm="invintory", resource_metadata="${base}/.well-known/oauth-protected-resource"`,
      )
      .status(401)
      .json({ error: 'invalid_token', error_description: 'A valid bearer token is required.' });
  };
}

function corsOpen(_req: Request, res: Response, next: NextFunction): void {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version');
  res.set('Access-Control-Expose-Headers', 'Mcp-Session-Id, WWW-Authenticate');
  if (_req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}

// ── Route installation ────────────────────────────────────────────────────────

export function installAuthRoutes(app: Express, db: Firestore, cfg: AuthConfig): void {
  const form = express.urlencoded({ extended: false });
  const json = express.json();

  app.use(['/.well-known', '/oauth', '/mcp'], corsOpen);

  // RFC 8414 / RFC 9728 discovery
  const asMetadata = (req: Request, res: Response): void => {
    const base = baseUrlOf(req);
    res.json({
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
      scopes_supported: ['cellar'],
      service_documentation: `${base}/`,
    });
  };
  app.get(['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/mcp'], asMetadata);

  app.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'], (req, res) => {
    const base = baseUrlOf(req);
    res.json({
      resource: `${base}/mcp`,
      authorization_servers: [base],
      bearer_methods_supported: ['header'],
      scopes_supported: ['cellar'],
      resource_name: 'Invintory wine cellar',
    });
  });

  // Dynamic client registration (RFC 7591)
  app.post('/oauth/register', json, async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const redirectUris = Array.isArray(body.redirect_uris) ? (body.redirect_uris as unknown[]).map(String) : [];
    if (!redirectUris.length || !redirectUris.every((u) => redirectAllowed(u, cfg.extraRedirectHosts))) {
      res.status(400).json({
        error: 'invalid_redirect_uri',
        error_description: 'Only claude.ai / claude.com (or localhost) redirect URIs are accepted.',
      });
      return;
    }
    const requested = String(body.token_endpoint_auth_method ?? 'none');
    const method: OAuthClientDoc['token_endpoint_auth_method'] =
      requested === 'client_secret_basic' || requested === 'client_secret_post' ? requested : 'none';
    const clientId = crypto.randomBytes(16).toString('hex');
    const clientSecret = method === 'none' ? null : crypto.randomBytes(32).toString('base64url');
    const doc: OAuthClientDoc = {
      client_id: clientId,
      client_secret_hash: clientSecret ? sha256(clientSecret) : null,
      client_name: String(body.client_name ?? 'MCP client').slice(0, 120),
      redirect_uris: redirectUris,
      token_endpoint_auth_method: method,
      created_at: new Date().toISOString(),
    };
    await db.collection('oauth_clients').doc(clientId).set(doc);
    res.status(201).json({
      client_id: clientId,
      ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}),
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: doc.client_name,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: method,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    });
  });

  async function loadClient(clientId: string | undefined): Promise<OAuthClientDoc | null> {
    if (!clientId) return null;
    const doc = await db.collection('oauth_clients').doc(clientId).get();
    return doc.exists ? (doc.data() as OAuthClientDoc) : null;
  }

  interface AuthorizeParams {
    response_type: string;
    client_id: string;
    redirect_uri: string;
    code_challenge: string;
    code_challenge_method: string;
    state: string;
    scope: string;
    resource: string;
  }

  function readAuthorizeParams(src: Record<string, unknown>): AuthorizeParams {
    const g = (k: string): string => (typeof src[k] === 'string' ? (src[k] as string) : '');
    return {
      response_type: g('response_type'),
      client_id: g('client_id'),
      redirect_uri: g('redirect_uri'),
      code_challenge: g('code_challenge'),
      code_challenge_method: g('code_challenge_method'),
      state: g('state'),
      scope: g('scope'),
      resource: g('resource'),
    };
  }

  async function validateAuthorize(p: AuthorizeParams, res: Response): Promise<OAuthClientDoc | null> {
    const client = await loadClient(p.client_id);
    if (!client) {
      res.status(400).send('Unknown client_id. Re-add the connector in Claude to register again.');
      return null;
    }
    if (!client.redirect_uris.includes(p.redirect_uri)) {
      res.status(400).send('redirect_uri is not registered for this client.');
      return null;
    }
    if (p.response_type !== 'code' || !p.code_challenge || p.code_challenge_method !== 'S256') {
      const u = new URL(p.redirect_uri);
      u.searchParams.set('error', 'invalid_request');
      u.searchParams.set('error_description', 'response_type=code with S256 PKCE is required');
      if (p.state) u.searchParams.set('state', p.state);
      res.redirect(u.toString());
      return null;
    }
    return client;
  }

  app.get('/oauth/authorize', async (req, res) => {
    const p = readAuthorizeParams(req.query as Record<string, unknown>);
    const client = await validateAuthorize(p, res);
    if (!client) return;
    res.type('html').send(
      loginPage({ action: `${baseUrlOf(req)}/oauth/authorize`, hidden: { ...p }, clientName: client.client_name }),
    );
  });

  app.post('/oauth/authorize', form, async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const p = readAuthorizeParams(body);
    const client = await validateAuthorize(p, res);
    if (!client) return;
    const ip = clientIp(req);
    const passphrase = typeof body.passphrase === 'string' ? body.passphrase : '';
    const render = (error: string, status = 401): void => {
      res
        .status(status)
        .type('html')
        .send(loginPage({ action: `${baseUrlOf(req)}/oauth/authorize`, hidden: { ...p }, error, clientName: client.client_name }));
    };
    const lock = await lockStatus(db, ip);
    if (lock.blocked) {
      res.set('Retry-After', String(lock.retryAfterSec));
      render(`Too many attempts. Try again in ${humanWait(lock.retryAfterSec)}.`, 429);
      return;
    }
    if (!verifyPassphrase(passphrase, cfg.passphraseHash)) {
      await noteFailure(db, ip);
      render('Incorrect passcode.');
      return;
    }
    await noteSuccess(db, ip);
    const code = crypto.randomBytes(32).toString('base64url');
    const doc: OAuthCodeDoc = {
      client_id: client.client_id,
      redirect_uri: p.redirect_uri,
      code_challenge: p.code_challenge,
      scope: p.scope || 'cellar',
      resource: p.resource,
      exp: Math.floor(Date.now() / 1000) + CODE_TTL,
    };
    await db.collection('oauth_codes').doc(code).set(doc);
    const u = new URL(p.redirect_uri);
    u.searchParams.set('code', code);
    if (p.state) u.searchParams.set('state', p.state);
    res.redirect(u.toString());
  });

  app.post('/oauth/token', form, json, async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const g = (k: string): string => (typeof body[k] === 'string' ? (body[k] as string) : '');
    const fail = (status: number, error: string, description: string): void => {
      res.status(status).json({ error, error_description: description });
    };

    // Client identification: body params or HTTP Basic
    let clientId = g('client_id');
    let clientSecret = g('client_secret');
    const basic = /^Basic\s+(.+)$/i.exec(req.headers.authorization ?? '');
    if (basic) {
      const [id, secret = ''] = Buffer.from(basic[1], 'base64').toString('utf8').split(':');
      clientId = clientId || decodeURIComponent(id);
      clientSecret = clientSecret || decodeURIComponent(secret);
    }
    const client = await loadClient(clientId);
    if (!client) {
      fail(401, 'invalid_client', 'Unknown client.');
      return;
    }
    if (client.token_endpoint_auth_method !== 'none') {
      if (!clientSecret || !client.client_secret_hash || sha256(clientSecret) !== client.client_secret_hash) {
        fail(401, 'invalid_client', 'Client authentication failed.');
        return;
      }
    }

    const issue = (scope: string): void => {
      res.json({
        access_token: signToken(cfg.secret, { typ: 'access', sub: 'owner', cid: client.client_id, scope }, ACCESS_TTL),
        token_type: 'Bearer',
        expires_in: ACCESS_TTL,
        refresh_token: signToken(cfg.secret, { typ: 'refresh', sub: 'owner', cid: client.client_id, scope }, REFRESH_TTL),
        scope,
      });
    };

    const grant = g('grant_type');
    if (grant === 'authorization_code') {
      const code = g('code');
      const verifier = g('code_verifier');
      if (!code || !verifier) {
        fail(400, 'invalid_request', 'code and code_verifier are required.');
        return;
      }
      const ref = db.collection('oauth_codes').doc(code);
      const snap = await ref.get();
      if (!snap.exists) {
        fail(400, 'invalid_grant', 'Unknown or already-used authorization code.');
        return;
      }
      const stored = snap.data() as OAuthCodeDoc;
      await ref.delete(); // single use
      if (stored.exp < Math.floor(Date.now() / 1000)) {
        fail(400, 'invalid_grant', 'Authorization code expired.');
        return;
      }
      if (stored.client_id !== client.client_id) {
        fail(400, 'invalid_grant', 'Code was issued to a different client.');
        return;
      }
      const redirectUri = g('redirect_uri');
      if (redirectUri && redirectUri !== stored.redirect_uri) {
        fail(400, 'invalid_grant', 'redirect_uri mismatch.');
        return;
      }
      if (sha256(verifier) !== stored.code_challenge) {
        fail(400, 'invalid_grant', 'PKCE verification failed.');
        return;
      }
      issue(stored.scope);
      return;
    }

    if (grant === 'refresh_token') {
      const payload = verifyToken(cfg.secret, g('refresh_token'));
      if (!payload || payload.typ !== 'refresh' || payload.cid !== client.client_id) {
        fail(400, 'invalid_grant', 'Refresh token is invalid or expired.');
        return;
      }
      issue(payload.scope ?? 'cellar');
      return;
    }

    fail(400, 'unsupported_grant_type', 'Use authorization_code or refresh_token.');
  });

  // Web-app session endpoints
  app.post('/api/login', json, async (req, res) => {
    const ip = clientIp(req);
    const lock = await lockStatus(db, ip);
    if (lock.blocked) {
      res.set('Retry-After', String(lock.retryAfterSec));
      res.status(429).json({ error: `Too many attempts. Try again in ${humanWait(lock.retryAfterSec)}.` });
      return;
    }
    const passphrase = typeof req.body?.passphrase === 'string' ? req.body.passphrase : '';
    if (!verifyPassphrase(passphrase, cfg.passphraseHash)) {
      await noteFailure(db, ip);
      res.status(401).json({ error: 'Incorrect passcode' });
      return;
    }
    await noteSuccess(db, ip);
    const token = signToken(cfg.secret, { typ: 'session', sub: 'owner' }, SESSION_TTL);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: baseUrlOf(req).startsWith('https://'),
      maxAge: SESSION_TTL * 1000,
      path: '/',
    });
    res.json({ ok: true });
  });

  app.post('/api/logout', (_req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  app.get('/api/me', requireOwner(cfg), (_req, res) => {
    const auth = (res.locals as AuthedLocals).auth!;
    res.json({ ok: true, via: auth.via, expiresAt: auth.payload.exp });
  });
}
