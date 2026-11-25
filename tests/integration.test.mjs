import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';

test('local search, server-controlled quote, Excel and persistent history', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'travelquote-test-')); const port = 4199;
  const child = spawn(process.execPath, ['--experimental-sqlite', 'server/index.mjs'], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', TRAVELQUOTE_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise(resolve => child.once('exit', resolve));
  const base = `http://127.0.0.1:${port}`;
  async function post(endpoint, data, extraHeaders = {}) { return fetch(base + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...extraHeaders }, body: JSON.stringify(data) }); }
  try {
    await new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('Backend startup timed out')), 15000); child.once('error', reject); child.stdout.on('data', data => { if (String(data).includes('TravelQuote backend:')) { clearTimeout(timeout); resolve(); } }); child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Backend exited ${code}`)); }); });
    assert.equal((await (await fetch(base + '/api/status')).json()).aiEnabled, false);
    assert.equal((await post('/api/ai', {})).status, 403);
    assert.equal((await post('/api/search', {}, { Origin: 'https://untrusted.example' })).status, 403);
    assert.equal((await post('/api/search', { mode: 'live', trip: {} })).status, 501);
    const trip = { client: 'Familia ejemplo', destination: 'Cancún', start: '2029-03-12', end: '2029-03-16', rooms: [{ adults: 2, children: [6] }], services: ['hotel', 'transfer', 'flight'], airport: 'CUN', origin: 'MTY', meal: 'all-inclusive', notes: 'Observación de prueba' };
    const searchResponse = await post('/api/search', { mode: 'demo', trip }); assert.equal(searchResponse.status, 200); const search = await searchResponse.json();
    const selectedIds = ['h0', 't0', 'f0'].map(suffix => `${search.id}-${suffix}`);
    const response = await post('/api/quotes', { searchId: search.id, selectedIds, adjustmentCents: 12050, agency: 'Viajes AGYL', terms: 'Condiciones de ejemplo', totalCents: 1 });
    assert.equal(response.status, 201); const quote = await response.json(); assert.ok(quote.totalCents > 1);
    assert.equal((await post('/api/quotes', { searchId: search.id, selectedIds: [selectedIds[0]], adjustmentCents: 0, agency: 'Viajes AGYL', terms: '' })).status, 400);
    const excel = await fetch(`${base}/api/quotes/${quote.id}/excel`); assert.equal(excel.status, 200);
    const book = new ExcelJS.Workbook(); await book.xlsx.load(Buffer.from(await excel.arrayBuffer()));
    const sheet = book.worksheets[0]; assert.equal(sheet.getCell('B2').value, 'Viajes AGYL'); assert.match(sheet.getCell('B4').value, /NO VÁLIDA PARA VENTA/);
    let total; sheet.eachRow(row => { if (row.getCell(2).value === 'PRECIO TOTAL DEL PAQUETE (MXN)') total = row.getCell(5).value; }); assert.equal(total, quote.totalCents / 100);
    const history = await (await fetch(base + '/api/quotes')).json(); assert.equal(history.length, 1); assert.equal(history[0].id, quote.id);
    child.kill(); await exited;
    const restarted = spawn(process.execPath, ['--experimental-sqlite', 'server/index.mjs'], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', TRAVELQUOTE_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
    try { await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Restart timed out')), 15000); restarted.stdout.on('data', data => { if (String(data).includes('TravelQuote backend:')) { clearTimeout(timer); resolve(); } }); restarted.once('error', reject); }); assert.equal((await (await fetch(base + '/api/quotes')).json())[0].id, quote.id); }
    finally { const done = new Promise(resolve => restarted.once('exit', resolve)); restarted.kill(); await done; }
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill(); await exited; await rm(dataDir, { recursive: true, force: true }); }
});
