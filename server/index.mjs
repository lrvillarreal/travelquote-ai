import http from 'node:http';
import { readFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { validateTrip, routeProviders, makeDemoOffers, calculateQuote } from '../shared/domain.mjs';
import { createWorkbook } from './workbook.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.TRAVELQUOTE_DATA_DIR || path.join(root, 'data');
await mkdir(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'travelquote.sqlite'));
db.exec('CREATE TABLE IF NOT EXISTS searches (id TEXT PRIMARY KEY, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS quotes (id TEXT PRIMARY KEY, createdAt TEXT NOT NULL, payload TEXT NOT NULL);');
const port = Number(process.env.PORT || 4180); const host = process.env.HOST || '127.0.0.1';
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('Esta versión debe ejecutarse en localhost. El acceso remoto requiere autenticación y una fase de despliegue.');
function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); }
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw Object.assign(new Error('Se requiere JSON.'), { status: 415 });
  let text = ''; for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 700000) throw Object.assign(new Error('La solicitud es demasiado grande.'), { status: 413 }); }
  try { return JSON.parse(text); } catch { throw Object.assign(new Error('JSON inválido.'), { status: 400 }); }
}
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer(async (req, res) => {
  try {
    const hostname = String(req.headers.host || '').split(':')[0];
    if (!['127.0.0.1', 'localhost'].includes(hostname)) return json(res, 403, { error: 'Host no autorizado.' });
    if (req.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`, 'http://127.0.0.1:4173', 'http://localhost:4173'].includes(req.headers.origin)) return json(res, 403, { error: 'Origen no autorizado.' });
    const url = new URL(req.url, `http://127.0.0.1:${port}`); const pathname = url.pathname;
    if (req.method === 'GET' && pathname === '/api/status') return json(res, 200, { mode: 'demo', aiEnabled: false, apiCalls: 0, providers: [{ name: 'RV Online', connected: false, services: ['hotel', 'transfer'] }, { name: 'Viva Aerobus', connected: false, services: ['flight'] }] });
    if (req.method === 'POST' && pathname === '/api/ai') return json(res, 403, { error: 'La IA está desactivada en esta fase. No se ha realizado ninguna llamada.' });
    if (req.method === 'POST' && pathname === '/api/search') {
      const request = await body(req);
      if (request.mode !== 'demo') return json(res, 501, { error: 'Los proveedores todavía no están conectados. Solo está disponible la demostración.' });
      const errors = validateTrip(request.trip); if (errors.length) return json(res, 422, { error: errors.join(' '), errors });
      const id = randomUUID(); const consultedAt = new Date().toISOString();
      const search = { id, mode: 'demo', trip: request.trip, consultedAt, providers: routeProviders(request.trip.services), offers: makeDemoOffers(request.trip, id, consultedAt) };
      db.prepare('INSERT INTO searches VALUES (?, ?)').run(id, JSON.stringify(search));
      return json(res, 200, search);
    }
    if (req.method === 'POST' && pathname === '/api/quotes') {
      const request = await body(req); const found = db.prepare('SELECT payload FROM searches WHERE id = ?').get(String(request.searchId || ''));
      if (!found) return json(res, 404, { error: 'La búsqueda no existe. Vuelve a buscar.' });
      const search = JSON.parse(found.payload);
      if (Date.now() - Date.parse(search.consultedAt) > 86400000) return json(res, 409, { error: 'La búsqueda de demostración venció. Realiza una nueva búsqueda.' });
      const agency = request.agency || 'Tu agencia de viajes';
      if (typeof agency !== 'string' || agency.length > 100 || !agency.trim() || typeof request.terms !== 'string' || request.terms.length > 3000) return json(res, 422, { error: 'Revisa el nombre de la agencia y las condiciones.' });
      if (request.logoDataUrl && (typeof request.logoDataUrl !== 'string' || request.logoDataUrl.length > 450000 || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(request.logoDataUrl))) return json(res, 422, { error: 'El logo debe ser PNG o JPEG, de hasta 300 KB.' });
      const calculation = calculateQuote(search.trip, search.offers, request.selectedIds, request.adjustmentCents);
      const quote = { id: randomUUID(), createdAt: new Date().toISOString(), trip: search.trip, searchId: search.id, consultedAt: search.consultedAt, agency, terms: request.terms, logoDataUrl: request.logoDataUrl || null, ...calculation };
      db.prepare('INSERT INTO quotes VALUES (?, ?, ?)').run(quote.id, quote.createdAt, JSON.stringify(quote));
      return json(res, 201, quote);
    }
    if (req.method === 'GET' && pathname === '/api/quotes') {
      const rows = db.prepare('SELECT payload FROM quotes ORDER BY createdAt DESC LIMIT 50').all();
      return json(res, 200, rows.map(row => { const q = JSON.parse(row.payload); return { id: q.id, createdAt: q.createdAt, client: q.trip.client, destination: q.trip.destination, totalCents: q.totalCents, services: q.trip.services, mode: q.mode }; }));
    }
    const download = pathname.match(/^\/api\/quotes\/([a-f0-9-]+)\/excel$/);
    if (req.method === 'GET' && download) {
      const row = db.prepare('SELECT payload FROM quotes WHERE id = ?').get(download[1]);
      if (!row) return json(res, 404, { error: 'No se encontró la cotización.' });
      const buffer = await createWorkbook(JSON.parse(row.payload));
      res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="Cotizacion_DEMO_${download[1].slice(0, 8)}.xlsx"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); return res.end(buffer);
    }
    if (pathname.startsWith('/api/')) return json(res, 404, { error: 'Ruta no disponible.' });
    if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Método no permitido.' });
    const dist = path.join(root, 'dist'); let file = path.resolve(dist, '.' + decodeURIComponent(pathname));
    if (!file.startsWith(dist + path.sep) && file !== dist) return json(res, 403, { error: 'Ruta no permitida.' });
    if (pathname === '/') file = path.join(dist, 'index.html');
    try { if (!(await stat(file)).isFile()) throw new Error(); } catch { return json(res, 404, { error: 'Recurso no disponible. Ejecuta primero pnpm run build.' }); }
    const data = await readFile(file); res.writeHead(200, { 'Content-Type': contentTypes[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' }); res.end(req.method === 'HEAD' ? undefined : data);
  } catch (error) { json(res, error.status || 400, { error: error.message || 'No se pudo completar la solicitud.' }); }
});
server.listen(port, host, () => console.log(`TravelQuote backend: http://${host}:${port} · DEMO · IA desactivada`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
