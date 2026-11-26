import { randomUUID } from 'node:crypto';
import { nightsBetween, travelerCounts, validateTrip } from '../../shared/domain.mjs';

export const RV_ORIGIN = 'https://www.rvonline.mx';
const clean = text => String(text || '').replace(/\s+/g, ' ').trim();
export const asPortalDate = iso => iso.split('-').reverse().join('/');

export function validatePilotRequest(request) {
  const errors = validateTrip(request?.trip);
  if (errors.length) throw new Error(errors.join(' '));
  const { trip } = request;
  if (trip.destination !== 'Cancún' || trip.airport !== 'CUN') throw new Error('Este piloto se validó únicamente para Cancún / CUN.');
  if (trip.rooms.length !== 1) throw new Error('Este piloto admite una habitación; falta validar búsquedas multihabitación.');
  if (!trip.services.includes('hotel') || trip.services.includes('flight')) throw new Error('El piloto admite hotel y, opcionalmente, traslados.');
  if (trip.services.includes('transfer')) {
    if (typeof request.hotelName !== 'string' || !request.hotelName.trim() || request.hotelName.length > 150) throw new Error('Indica el hotel para vincular el traslado.');
    for (const time of [request.outboundTime, request.returnTime]) if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time || '')) throw new Error('Indica ambos horarios del traslado en formato HH:mm.');
  }
  if (request.hotelName && (typeof request.hotelName !== 'string' || request.hotelName.length > 150)) throw new Error('Nombre de hotel inválido.');
  return request;
}

// Read the exact amount from the portal's currency calculator, not its rounded label.
export function decimalToCents(value, currency) {
  if (currency !== 'MXN' || typeof value !== 'string') throw new Error('Falta un importe exacto en MXN.');
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new Error('Importe exacto inválido: no se redondean ni adivinan decimales.');
  const result = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  if (!Number.isSafeInteger(result)) throw new Error('Importe fuera de rango.');
  return result;
}

export function verifySearchHeading(text, request, service) {
  const heading = clean(text);
  const { trip } = request;
  const { adults, children } = travelerCounts(trip.rooms);
  const required = [asPortalDate(trip.start), asPortalDate(trip.end), `${adults} Adult(s)`];
  if (children) required.push(`${children} Child(ren)`);
  if (!required.every(part => heading.includes(part))) throw new Error('El portal devolvió fechas u ocupación diferentes a la solicitud.');
  if (!children && /[1-9]\d* Child\(ren\)/.test(heading)) throw new Error('El portal agregó menores no solicitados.');
  if (service === 'hotel' && (!heading.includes('Hotels in Cancun,') || !heading.includes('1 Rooms') || !heading.includes(`${nightsBetween(trip.start, trip.end)} night(s)`))) throw new Error('El destino, las noches o las habitaciones no coinciden.');
  if (service === 'transfer' && (!heading.includes('Cancun International Airport') || !heading.toLowerCase().includes(request.hotelName.toLowerCase()))) throw new Error('El traslado no corresponde al aeropuerto y hotel solicitados.');
  if (children) {
    const match = /\(([^)]*?)years old\)/.exec(heading);
    const ages = match ? (match[1].match(/\d+/g) || []).map(Number) : [];
    if (ages.join(',') !== trip.rooms[0].children.join(',')) throw new Error('Las edades de los menores no coinciden.');
  }
  return true;
}

function assertOccupancy(text, trip, service) {
  const summary = clean(text).toLowerCase();
  const expected = travelerCounts(trip.rooms);
  const adults = Number(/(\d+)\s*adult/.exec(summary)?.[1] ?? -1);
  const children = Number(/(\d+)\s*child/.exec(summary)?.[1] || 0);
  if (adults !== expected.adults || children !== expected.children) throw new Error('La tarifa tiene otra ocupación.');
  if (service === 'hotel' && Number(/(\d+)\s*night/.exec(summary)?.[1] || 0) !== nightsBetween(trip.start, trip.end)) throw new Error('La tarifa no cubre las noches solicitadas.');
}

function base(row, request, service, consultedAt) {
  assertOccupancy(row.occupancy, request.trip, service);
  return {
    id: randomUUID(), provider: 'RV Online', mode: 'rv-pilot', service,
    currency: 'MXN', priceCents: decimalToCents(row.amount, row.currency),
    consultedAt, source: 'Consulta del portal de RV Online mediante navegador local',
    priceBasis: 'portal-displayed-total', commissionStatus: 'unconfirmed',
    taxes: clean(row.taxes) || 'Impuestos pendientes de confirmar',
    cancellation: clean(row.cancellation) || null,
    revalidated: false, requiresManualReview: true,
    warnings: ['Tarifa orientativa: revalidar disponibilidad, precio, condiciones y cargos locales antes de vender.']
  };
}

function collect(rows, convert) {
  const offers = [], rejected = [], seen = new Set();
  for (const row of rows) {
    try {
      const offer = convert(row);
      const key = JSON.stringify([offer.service, offer.hotelCode, offer.title, offer.roomName, offer.meal, offer.priceCents, offer.legs, offer.vehicles]);
      if (!seen.has(key)) { seen.add(key); offers.push(offer); }
    } catch (error) { rejected.push({ name: clean(row.hotelName || row.title).slice(0,160), reason: error.message }); }
  }
  return { offers, rejected };
}

export function normalizeHotels(rows, request, consultedAt = new Date().toISOString()) {
  return collect(rows, row => {
    if (!clean(row.hotelName) || !clean(row.roomName) || !clean(row.meal)) throw new Error('Falta el nombre del hotel, habitación o plan de alimentos.');
    if (!/^JP[A-Z0-9]+$/.test(row.hotelCode || '')) throw new Error('Falta el identificador del hotel del proveedor.');
    if (travelerCounts(request.trip.rooms).children && /18\s*\+|adults?\s*only|solo\s*adultos/i.test(`${row.roomName} ${row.meal}`)) throw new Error('La tarifa indica una restricción de adultos y hay menores en la solicitud.');
    if (request.trip.meal === 'all-inclusive' && !/all inclusive|todo incluido/i.test(row.meal)) throw new Error('No coincide el plan todo incluido solicitado.');
    if (request.trip.meal === 'breakfast' && !/breakfast|desayuno/i.test(row.meal)) throw new Error('No coincide el desayuno solicitado.');
    const offer = { ...base(row, request, 'hotel', consultedAt), title: clean(row.hotelName), hotelCode: row.hotelCode, roomName: clean(row.roomName), meal: clean(row.meal), includesTransfer: 'unknown' };
    offer.nonRefundable = row.nonRefundable === true;
    if (offer.nonRefundable && !offer.cancellation) offer.cancellation = 'El portal marca esta tarifa como no reembolsable; consultar la política completa.';
    if (!offer.cancellation) offer.warnings.push('Política de cancelación pendiente de consultar para esta tarifa.');
    offer.warnings.push('No se ha confirmado si el hotel incluye traslados.');
    return offer;
  });
}

export function normalizeTransfers(rows, request, consultedAt = new Date().toISOString()) {
  return collect(rows, row => {
    if (!Array.isArray(row.legTexts) || row.legTexts.length !== 2) throw new Error('No se pueden confirmar los dos trayectos del traslado.');
    const legs = row.legTexts.map((text, index) => {
      const detail = clean(text);
      if (!(index === 0 ? /^Departure:/i : /^Return:/i).test(detail)) throw new Error('El orden de los trayectos no está confirmado.');
      const kind = /\b(Shared|Private|Shuttle|Others)\b/i.exec(detail)?.[1];
      if (!kind) throw new Error('No se pudo identificar el tipo de servicio de cada trayecto.');
      const time = /\b(?:[01]\d|2[0-3]):[0-5]\d\b/.exec(detail)?.[0] || null;
      return { date: index === 0 ? request.trip.start : request.trip.end,
        from: index === 0 ? request.trip.airport : request.hotelName,
        to: index === 0 ? request.hotelName : request.trip.airport,
        kind, requestedTime: index === 0 ? request.outboundTime : request.returnTime,
        time, detail };
    });
    const offer = { ...base(row, request, 'transfer', consultedAt), title: `${legs[0].kind} / ${legs[1].kind}`, hotelName: request.hotelName, legs, vehicles: (row.vehicleDescriptions || []).map(clean), priceScope: 'roundtrip-all-passengers', mixedService: legs[0].kind.toLowerCase() !== legs[1].kind.toLowerCase() };
    if (offer.mixedService) offer.warnings.push('El tipo de servicio cambia entre ida y regreso.');
    if (legs.some(leg => !leg.time)) offer.warnings.push('Hay horarios por determinar por el proveedor.');
    if (legs.some(leg => leg.time && leg.time !== leg.requestedTime)) offer.warnings.push('El horario devuelto difiere del solicitado; revisar la relación con el vuelo.');
    offer.warnings.push('Falta validar vuelos, equipaje y política de cancelación del traslado.');
    return offer;
  });
}
