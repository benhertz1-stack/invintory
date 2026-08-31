/**
 * End-to-end smoke test for the remote MCP endpoint. Exercises the same OAuth
 * flow the Claude app uses (dynamic registration -> PKCE authorize -> token)
 * and then a few MCP calls, saving the locate_bottle picture if a path is given.
 *
 *   node scripts/mcp-smoke.mjs http://localhost:3001 "<passphrase>" [out.png]
 */
import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const [base, passphrase, outPng] = process.argv.slice(2);
if (!base || !passphrase) {
  console.error('usage: node scripts/mcp-smoke.mjs <baseUrl> <passphrase> [out.png]');
  process.exit(2);
}
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const log = (...a) => console.log(...a);
const form = { 'content-type': 'application/x-www-form-urlencoded' };

async function waitForHealth() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server never became healthy');
}

async function main() {
  await waitForHealth();
  log('OK health');

  const prm = await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json();
  const asmRaw = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
  log('OK discovery', prm.resource, '->', asmRaw.issuer);
  // In dev the server advertises PUBLIC_BASE_URL (the Vite origin); keep the paths but talk to `base`.
  const rebase = (u) => new URL(new URL(u).pathname, base).toString();
  const asm = {
    ...asmRaw,
    authorization_endpoint: rebase(asmRaw.authorization_endpoint),
    token_endpoint: rebase(asmRaw.token_endpoint),
    registration_endpoint: rebase(asmRaw.registration_endpoint),
  };

  const un = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  if (un.status !== 401 || !un.headers.get('www-authenticate')) throw new Error(`expected 401 challenge, got ${un.status}`);
  log('OK /mcp rejects anonymous (401 + WWW-Authenticate)');

  const redirectUri = 'https://claude.ai/api/mcp/auth_callback';
  const reg = await (
    await fetch(asm.registration_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'smoke test', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none' }),
    })
  ).json();
  if (!reg.client_id) throw new Error('registration failed: ' + JSON.stringify(reg));
  log('OK registered client', reg.client_id);

  const bad = await fetch(asm.registration_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ redirect_uris: ['https://evil.example/cb'] }),
  });
  if (bad.status !== 400) throw new Error('foreign redirect accepted');
  log('OK foreign redirect_uri refused');

  const verifier = b64u(randomBytes(32));
  const challenge = b64u(createHash('sha256').update(verifier).digest());
  const state = b64u(randomBytes(8));
  const params = {
    response_type: 'code',
    client_id: reg.client_id,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    scope: 'cellar',
  };
  const page = await fetch(`${asm.authorization_endpoint}?${new URLSearchParams(params)}`);
  if (!page.ok || !(await page.text()).includes('Passphrase')) throw new Error('authorize page failed');
  log('OK authorize page renders');

  const wrong = await fetch(asm.authorization_endpoint, {
    method: 'POST',
    redirect: 'manual',
    headers: form,
    body: new URLSearchParams({ ...params, passphrase: 'nope' }),
  });
  if (wrong.status !== 401) throw new Error(`wrong passphrase gave ${wrong.status}`);
  log('OK wrong passphrase rejected');

  const ok = await fetch(asm.authorization_endpoint, {
    method: 'POST',
    redirect: 'manual',
    headers: form,
    body: new URLSearchParams({ ...params, passphrase }),
  });
  const loc = ok.headers.get('location') || '';
  const code = loc ? new URL(loc).searchParams.get('code') : null;
  if (ok.status !== 302 || !code || !loc.includes(`state=${state}`)) throw new Error(`authorize failed: ${ok.status} ${loc}`);
  log('OK passphrase accepted -> code');

  const tok = await (
    await fetch(asm.token_endpoint, {
      method: 'POST',
      headers: form,
      body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: reg.client_id, redirect_uri: redirectUri }),
    })
  ).json();
  if (!tok.access_token || !tok.refresh_token) throw new Error('token failed: ' + JSON.stringify(tok));
  log('OK access + refresh token issued');

  const reuse = await fetch(asm.token_endpoint, {
    method: 'POST',
    headers: form,
    body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: reg.client_id }),
  });
  if (reuse.status !== 400) throw new Error('code reuse accepted');
  log('OK code is single-use');

  const ref = await (
    await fetch(asm.token_endpoint, {
      method: 'POST',
      headers: form,
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: reg.client_id }),
    })
  ).json();
  if (!ref.access_token) throw new Error('refresh failed');
  log('OK refresh grant works');

  let id = 0;
  async function rpc(method, params) {
    const r = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${ref.access_token}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    });
    const ct = r.headers.get('content-type') || '';
    const text = await r.text();
    if (!r.ok) throw new Error(`${method} -> ${r.status} ${text.slice(0, 200)}`);
    if (ct.includes('text/event-stream')) {
      const data = text
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => JSON.parse(l.slice(5).trim()));
      return data.find((d) => d.id === id) ?? data.at(-1);
    }
    return JSON.parse(text);
  }

  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } });
  log('OK initialize', init.result.serverInfo.name, init.result.serverInfo.version, '| instructions:', !!init.result.instructions);
  const tools = await rpc('tools/list', {});
  log('OK tools/list ->', tools.result.tools.map((t) => t.name).join(', '));

  const stats = await rpc('tools/call', { name: 'get_collection_stats', arguments: {} });
  log('OK get_collection_stats:', stats.result.content[0].text.split('\n')[0]);

  const located = await rpc('tools/call', { name: 'locate_bottle', arguments: { wine: 'ontogeny 2019' } });
  const content = located.result.content;
  log('OK locate_bottle:', content[0].text.split('\n')[0]);
  const img = content.find((c) => c.type === 'image');
  if (!img) throw new Error('no image in locate_bottle result');
  if (outPng) {
    writeFileSync(outPng, Buffer.from(img.data, 'base64'));
    log(`   image saved -> ${outPng}`);
  }

  const fr = await rpc('tools/call', { name: 'list_fridges', arguments: {} });
  log('OK list_fridges:', fr.result.content[0].text.split('\n')[0]);

  const amb = await rpc('tools/call', { name: 'locate_bottle', arguments: { wine: 'stolpman' } });
  log('OK ambiguous query handled:', amb.result.content[0].text.split('\n')[0]);

  log('\nALL GOOD');
}

main().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
