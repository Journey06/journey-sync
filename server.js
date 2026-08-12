// Journey sync server — zero dependencies.
// Serves the single-file app (Journey.html) AND a tiny sync API so that
// phone + PC open the same URL and auto two-way sync their data.
//
// API:
//   GET  /api/pull?token=T   -> { ts, data }   (data:null when nothing stored)
//   POST /api/push            -> { token, ts, data }  (last-write-wins by ts)
//
// Storage: ./data/<token>.json  (token is sanitised; filesystem is the store)

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const APP_FILE = path.join(__dirname, 'Journey.html');
const DATA_DIR = path.join(__dirname, 'data');
const MAX_BODY = 6 * 1024 * 1024; // 6 MB hard cap

try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}

function safeToken(t) {
  if (typeof t !== 'string') return null;
  t = t.trim();
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(t)) return null;
  return t;
}
function fileFor(tok) { return path.join(DATA_DIR, tok + '.json'); }
function readStore(tok) {
  try { return JSON.parse(fs.readFileSync(fileFor(tok), 'utf8')); }
  catch (e) { return null; }
}
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}
function sendJSON(res, code, obj) {
  res.writeHead(code, Object.assign(
    { 'Content-Type': 'application/json; charset=utf-8' }, corsHeaders()));
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    return res.end();
  }

  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  // ---- Pull ----
  if (p === '/api/pull') {
    const tok = safeToken(url.searchParams.get('token'));
    if (!tok) return sendJSON(res, 400, { error: 'bad token' });
    const store = readStore(tok);
    if (!store) return sendJSON(res, 200, { ts: 0, data: null });
    return sendJSON(res, 200, { ts: store.ts || 0, data: store.data || null });
  }

  // ---- Push ----
  if (p === '/api/push') {
    let buf = '';
    let tooBig = false;
    req.on('data', (c) => {
      buf += c;
      if (buf.length > MAX_BODY) { tooBig = true; req.destroy(); }
    });
    req.on('end', () => {
      if (tooBig) return sendJSON(res, 413, { error: 'payload too large' });
      let body;
      try { body = JSON.parse(buf); } catch (e) { return sendJSON(res, 400, { error: 'bad json' }); }
      const tok = safeToken(body && body.token);
      if (!tok) return sendJSON(res, 400, { error: 'bad token' });
      const ts = Number(body && body.ts);
      if (!body || !body.data || !Number.isFinite(ts)) return sendJSON(res, 400, { error: 'bad payload' });
      const store = readStore(tok);
      if (store && Number(store.ts) >= ts) {
        return sendJSON(res, 200, { ok: false, conflict: true, ts: store.ts });
      }
      try { fs.writeFileSync(fileFor(tok), JSON.stringify({ ts: ts, data: body.data })); }
      catch (e) { return sendJSON(res, 500, { error: 'write failed' }); }
      return sendJSON(res, 200, { ok: true, ts: ts });
    });
    return;
  }

  // ---- Static: serve the app ----
  if (req.method === 'GET' || req.method === 'HEAD') {
    fs.readFile(APP_FILE, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('App file not found. Deploy with Journey.html in the project root.');
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(req.method === 'HEAD' ? '' : data);
    });
    return;
  }

  res.writeHead(405, { 'Content-Type': 'text/plain' });
  res.end('Method not allowed');
});

server.listen(PORT, () => {
  console.log('Journey sync server listening on port ' + PORT);
});
