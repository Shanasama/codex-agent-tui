import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Controller } from './controller.js';
import { ROOT, prepareRuntime } from './runtime.js';
import { safeText } from './state.js';

const STATIC = new Map([['/', ['index.html', 'text/html; charset=utf-8']], ['/styles.css', ['styles.css', 'text/css; charset=utf-8']], ['/app.js', ['app.js', 'text/javascript; charset=utf-8']]]);
function json(res, code, data) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); }
async function body(req) {
  if (!String(req.headers['content-type']).startsWith('application/json')) throw new Error('JSON Content-Type required');
  let data = ''; for await (const chunk of req) { data += chunk; if (Buffer.byteLength(data) > 8192) throw new Error('Request body too large'); }
  let value; try { value = JSON.parse(data || '{}'); } catch { throw new Error('Invalid JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON object required'); return value;
}
function exactFields(value, allowed) { if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unknown request field'); }
export function createServer(controller = new Controller()) {
  const clients = new Set();
  const capability = randomBytes(32).toString('hex');
  const validSession = req => {
    const value = String(req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('control_panel_session='))?.slice('control_panel_session='.length) || '';
    return value.length === capability.length && timingSafeEqual(Buffer.from(value), Buffer.from(capability));
  };
  const broadcast = state => { for (const res of clients) { if (!res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`)) { res.end(); clients.delete(res); } } };
  controller.store.on('change', broadcast);
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const port = server.address()?.port;
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    const host = req.headers.host;
    if (!hosts.includes(host)) return json(res, 403, { error: 'Local Host required' });
    const origin = req.headers.origin;
    if (origin && origin !== `http://${host}`) return json(res, 403, { error: 'Same origin required' });
    if (req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: 'Cross-site request rejected' });
    let url; try { url = new URL(req.url, `http://${host}`); } catch { return json(res, 400, { error: 'Invalid URL' }); }
    try {
      if (url.pathname.startsWith('/api/') && !validSession(req)) return json(res, 403, { error: 'Open the local dashboard first' });
      if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, controller.snapshot());
      if (req.method === 'GET' && url.pathname === '/api/events') {
        if (clients.size >= 20) return json(res, 429, { error: 'Too many event streams' });
        res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
        res.write(`event: state\ndata: ${JSON.stringify(controller.snapshot())}\n\n`); clients.add(res);
        req.on('close', () => clients.delete(res)); return;
      }
      if (req.method === 'GET' && STATIC.has(url.pathname)) {
        const [name, type] = STATIC.get(url.pathname); const data = await readFile(path.join(ROOT, 'public', name));
        if (url.pathname === '/') res.setHeader('Set-Cookie', `control_panel_session=${capability}; HttpOnly; SameSite=Strict; Path=/`);
        res.writeHead(200, { 'Content-Type': type }); res.end(data); return;
      }
      if (req.method !== 'POST') return json(res, 404, { error: 'Not found' });
      if (req.headers['x-control-panel'] !== '1') return json(res, 403, { error: 'X-Control-Panel header required' });
      if (!['/api/connect', '/api/disconnect', '/api/run', '/api/demo', '/api/interrupt'].includes(url.pathname)) return json(res, 404, { error: 'Not found' });
      const data = await body(req);
      if (url.pathname === '/api/run') {
        exactFields(data, ['goal']); if (typeof data.goal !== 'string' || !data.goal.trim() || data.goal.length > 2000) throw new Error('Goal must be 1–2000 characters');
        controller.startRun(data.goal.trim());
      } else if (url.pathname === '/api/demo') {
        exactFields(data, ['scenario']); if (!['success', 'repeated-error', 'approval'].includes(data.scenario)) throw new Error('Invalid demo scenario');
        controller.startDemo(data.scenario);
      } else {
        exactFields(data, []);
        if (url.pathname === '/api/connect') await controller.connect();
        if (url.pathname === '/api/disconnect') await controller.disconnect();
        if (url.pathname === '/api/interrupt') await controller.interrupt();
      }
      return json(res, 200, controller.snapshot());
    } catch (error) { return json(res, 400, { error: safeText(error.message, 600) }); }
  });
  server.requestTimeout = 30000; server.headersTimeout = 10000;
  const keepalive = setInterval(() => { for (const res of clients) res.write(': heartbeat\n\n'); }, 15000); keepalive.unref();
  server.on('close', () => { clearInterval(keepalive); controller.store.off('change', broadcast); for (const res of clients) res.end(); });
  return { server, controller, async close() { for (const res of clients) res.end(); await controller.disconnect(); await new Promise(resolve => server.close(resolve)); } };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareRuntime();
  const port = Number(process.env.PORT || 4317);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be between 1024 and 65535');
  const app = createServer();
  app.server.listen(port, '127.0.0.1', () => console.log(`Codex Control Panel: http://127.0.0.1:${port}\nLocal only. Live inference disabled unless explicitly enabled. Separate CODEX_HOME is NOT a security sandbox.`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
}
