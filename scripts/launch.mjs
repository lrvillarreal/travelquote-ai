import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const address = 'http://127.0.0.1:4180';
const controller = new AbortController();
let startupError = false;
const child = spawn(process.execPath, ['--experimental-sqlite', 'server/index.mjs'], {
  cwd: root,
  env: { ...process.env, PORT: '4180', HOST: '127.0.0.1' },
  stdio: ['inherit', 'pipe', 'inherit']
});
let opened = false;
child.stdout.on('data', async chunk => {
  process.stdout.write(chunk);
  if (opened || !String(chunk).includes('TravelQuote backend:')) return;
  opened = true;
  try {
    const response = await fetch(`${address}/api/status`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) });
    if (!response.ok || (await response.json()).mode !== 'demo') throw new Error('Respuesta inesperada del servidor.');
    console.log(`\nTravelQuote listo: ${address}\nConserva esta ventana abierta. Ctrl+C detiene la aplicacion.\n`);
    if (process.platform === 'win32') {
      const browser = spawn('explorer.exe', [address], { windowsHide: true, stdio: 'ignore' });
      browser.on('error', () => console.error(`Abre manualmente ${address} en tu navegador.`));
    }
  } catch (error) {
    if (controller.signal.aborted) return;
    startupError = true;
    console.error(`No se pudo comprobar la conexion local: ${error.cause?.code || error.message}.`);
    console.error('La ventana conserva el error; no se ha abierto el navegador.');
    child.kill();
  }
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { controller.abort(); process.exitCode = startupError ? 1 : (code || 0); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { controller.abort(); child.kill(); });
