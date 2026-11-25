export const SERVICES = ['hotel', 'transfer', 'flight'];
export const SERVICE_NAMES = { hotel: 'Hotel', transfer: 'Traslados', flight: 'Vuelos' };
export const DESTINATIONS = ['Cancún', 'Riviera Maya', 'Los Cabos', 'Puerto Vallarta', 'Mazatlán'];
export function nightsBetween(start, end) { return Math.round((Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86400000); }
export function travelerCounts(rooms) { return rooms.reduce((sum, r) => ({ adults: sum.adults + r.adults, children: sum.children + r.children.length }), { adults: 0, children: 0 }); }
export function routeProviders(services) { return [...new Set(services.map(s => s === 'flight' ? 'Viva Aerobus' : 'RV Online'))]; }
const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
export function validateTrip(trip) {
  const errors = [];
  if (!trip || typeof trip !== 'object') return ['La solicitud no es válida.'];
  if (!Array.isArray(trip.services) || !trip.services.length || trip.services.some(s => !SERVICES.includes(s)) || new Set(trip.services).size !== trip.services.length) errors.push('Selecciona al menos un servicio válido, sin duplicados.');
  if (!DESTINATIONS.includes(trip.destination)) errors.push('Selecciona un destino de la lista.');
  if (!validDay(trip.start) || !validDay(trip.end) || !(nightsBetween(trip.start, trip.end) > 0) || nightsBetween(trip.start, trip.end) > 90) errors.push('Revisa las fechas: la estancia debe ser de 1 a 90 noches.');
  if (validDay(trip.start) && trip.start < new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })) errors.push('La fecha de inicio no puede estar en el pasado.');
  if (!Array.isArray(trip.rooms) || trip.rooms.length < 1 || trip.rooms.length > 8) errors.push('Agrega entre 1 y 8 habitaciones.');
  else for (const [index, room] of trip.rooms.entries()) {
    if (!Number.isInteger(room.adults) || room.adults < 1 || room.adults > 6 || !Array.isArray(room.children) || room.children.length > 4 || room.children.some(age => !Number.isInteger(age) || age < 0 || age > 17)) errors.push(`Revisa los viajeros de la habitación ${index + 1}; cada niño necesita una edad de 0 a 17 años.`);
  }
  if (trip.services?.some(s => ['flight', 'transfer'].includes(s)) && !['CUN', 'SJD', 'PVR', 'MZT'].includes(trip.airport)) errors.push('Selecciona el aeropuerto de llegada.');
  const expectedAirports = { 'Cancún': 'CUN', 'Riviera Maya': 'CUN', 'Los Cabos': 'SJD', 'Puerto Vallarta': 'PVR', 'Mazatlán': 'MZT' };
  if (trip.services?.some(s => ['flight', 'transfer'].includes(s)) && expectedAirports[trip.destination] !== trip.airport) errors.push('El aeropuerto de llegada no corresponde al destino.');
  if (trip.services?.includes('flight') && (!['MTY', 'MEX', 'NLU', 'GDL', 'BJX'].includes(trip.origin) || trip.origin === trip.airport)) errors.push('Selecciona un aeropuerto de salida válido.');
  if (!['any', 'breakfast', 'all-inclusive'].includes(trip.meal)) errors.push('Selecciona un plan de alimentos válido.');
  if (typeof trip.client !== 'string' || trip.client.length > 100 || typeof trip.notes !== 'string' || trip.notes.length > 2000) errors.push('Revisa el nombre del cliente y las observaciones.');
  return errors;
}
export function makeDemoOffers(trip, searchId, consultedAt) {
  const nights = nightsBetween(trip.start, trip.end);
  const people = travelerCounts(trip.rooms); const guests = people.adults + people.children;
  const base = { searchId, consultedAt, mode: 'demo', currency: 'MXN', source: 'Datos ficticios para probar el flujo. No se consultó al proveedor.', cancellation: 'Condición de ejemplo. Pendiente de validar con el proveedor.', taxes: 'Importes ficticios con impuestos de ejemplo incluidos.', revalidated: false };
  const result = [];
  const add = (service, suffix, fields) => result.push({ ...base, id: `${searchId}-${suffix}`, service, ...fields });
  if (trip.services.includes('hotel')) {
    const names = ['Costa Serena', 'Bahía Jardín', 'Mar de Palma'];
    names.forEach((name, i) => add('hotel', `h${i}`, { provider: 'RV Online', title: `Hotel ${name} · ejemplo`, subtitle: trip.destination, detail: `${trip.rooms.length} habitación(es) Deluxe · ${nights} noches`, meal: trip.meal === 'breakfast' ? 'Desayuno incluido' : trip.meal === 'all-inclusive' ? 'Todo incluido' : ['Todo incluido', 'Desayuno incluido', 'Solo hospedaje'][i], priceCents: (320000 + i * 76000) * nights * trip.rooms.length + people.children * nights * 25000, highlights: ['Habitación de ejemplo', 'Ocupación solicitada', 'Sin reserva confirmada'], rating: [4, 5, 4][i], image: ['coast', 'garden', 'palms'][i] }));
  }
  if (trip.services.includes('transfer')) {
    ['Compartido', 'Privado'].forEach((kind, i) => add('transfer', `t${i}`, { provider: 'RV Online', title: `Traslado ${kind.toLowerCase()} · ejemplo`, subtitle: `${trip.airport} → hotel → ${trip.airport}`, detail: `Ida y regreso · ${guests} pasajeros`, meal: '', priceCents: i ? 260000 + guests * 18000 : guests * 65000, highlights: [kind, 'Ambos trayectos incluidos', 'Horarios por confirmar'], legs: [{ date: trip.start, from: trip.airport, to: 'Hotel seleccionado', time: null }, { date: trip.end, from: 'Hotel seleccionado', to: trip.airport, time: null }] }));
  }
  if (trip.services.includes('flight')) {
    ['Tarifa A', 'Tarifa B'].forEach((fare, i) => add('flight', `f${i}`, { provider: 'Viva Aerobus', title: `Vuelo redondo · ${fare} · ejemplo`, subtitle: `${trip.origin} → ${trip.airport} → ${trip.origin}`, detail: `${guests} pasajeros · salida ${trip.start} · regreso ${trip.end}`, meal: '', priceCents: guests * (340000 + i * 110000), highlights: ['Itinerario ficticio', 'Equipaje pendiente de validar', 'Incluye ida y regreso de ejemplo'], baggage: 'Pendiente de validar. No asumir equipaje incluido.', itinerary: { origin: trip.origin, destination: trip.airport, outbound: trip.start, inbound: trip.end, arrivalTime: null, departureTime: null } }));
  }
  return result;
}
export function calculateQuote(trip, offers, selectedIds, adjustmentCents = 0) {
  if (!Array.isArray(selectedIds) || selectedIds.length !== trip.services.length || new Set(selectedIds).size !== selectedIds.length) throw new Error('Selecciona exactamente una opción para cada servicio solicitado.');
  const selected = selectedIds.map(id => offers.find(o => o.id === id));
  if (selected.some(o => !o) || trip.services.some(s => selected.filter(o => o.service === s).length !== 1)) throw new Error('La selección no corresponde a los servicios solicitados.');
  if (selected.some(o => o.currency !== 'MXN' || !Number.isSafeInteger(o.priceCents) || o.priceCents < 0)) throw new Error('No se pueden combinar monedas ni importes inválidos.');
  if (!Number.isSafeInteger(adjustmentCents) || adjustmentCents < 0 || adjustmentCents > 100000000) throw new Error('El ajuste comercial debe ser un importe válido de 0 a 1,000,000 MXN.');
  const subtotalCents = selected.reduce((sum, o) => sum + o.priceCents, 0);
  return { selected, subtotalCents, adjustmentCents, totalCents: subtotalCents + adjustmentCents, currency: 'MXN', mode: 'demo' };
}
