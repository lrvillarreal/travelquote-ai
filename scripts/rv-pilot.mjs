import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { runRvPilot } from '../server/providers/rv-pilot.mjs';
import { validatePilotRequest } from '../server/providers/rv-normalize.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
function dateAfter(days) {
  const date = new Date(); date.setDate(date.getDate() + days);
  return date.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
}
function exampleRequest() {
  return { trip: { client: '', destination: 'Cancún', start: dateAfter(30), end: dateAfter(34),
    rooms: [{ adults: 2, children: [6] }], services: ['hotel', 'transfer'], airport: 'CUN', origin: 'MTY', meal: 'any', notes: '' },
    hotelName: 'Riu Dunamar', outboundTime: '10:00', returnTime: '10:00' };
}

try {
  const requestIndex = args.indexOf('--request');
  if (requestIndex >= 0 && !args[requestIndex + 1]) throw new Error('Indica una ruta JSON después de --request.');
  const request = requestIndex >= 0 ? JSON.parse(await readFile(path.resolve(args[requestIndex + 1]), 'utf8')) : exampleRequest();
  validatePilotRequest(request);
  console.log('TravelQuote / RV Online - PILOTO DE CONSULTA');
  console.log(`${request.trip.destination}: ${request.trip.start} a ${request.trip.end}; ${request.hotelName || 'hotel por seleccionar'}.`);
  console.log('Los horarios son datos de prueba; falta validarlos con los vuelos. No se harán reservas.');
  if (args.includes('--check')) {
    console.log('Dependencias y solicitud válidas. No se abrió el navegador ni se consultó al proveedor.');
    process.exitCode = 0;
  } else {
    const report = await runRvPilot(request);
    const dir = path.join(root, 'data', 'rv-pilot');
    await mkdir(dir, { recursive: true });
    const target = path.join(dir, `consulta-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);
    await writeFile(target, JSON.stringify(report, null, 2), { mode: 0o600, flag: 'wx' });
    console.log(`Resultado guardado: ${target}`);
    console.log('Este archivo es local y está excluido de Git. No contiene contraseñas ni cookies.');
    for (const error of report.errors) console.error(error);
    if (report.errors.length || (request.trip.services.includes('transfer') && !report.transfers.offers.length)) process.exitCode = 2;
    else console.log('Piloto completado. El cotizador continúa en modo demo hasta validar la siguiente integración.');
  }
} catch (error) {
  console.error(`No se completó el piloto: ${error.message}`);
  console.error('No se ha confirmado ninguna reserva ni se ha generado una cotización válida para venta.');
  process.exitCode = 1;
}
