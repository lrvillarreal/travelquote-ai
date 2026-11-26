import { chromium } from 'playwright';
import { RV_ORIGIN, asPortalDate, verifySearchHeading, normalizeHotels, normalizeTransfers, validatePilotRequest } from './rv-normalize.mjs';
import { hasRvSession, waitForRvSession } from './rv-session.mjs';

const exact = name => ({ name, exact: true });
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const searchTimeout = 75000;

async function until(check, timeout, message) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 350));
  }
  throw new Error(message);
}

async function accessible(page) {
  if (new URL(page.url()).origin !== RV_ORIGIN) throw new Error('El navegador salió del dominio autorizado de RV Online.');
  const text = await page.locator('body').innerText();
  if (/access denied|automated (traffic|requests)|verify (that )?you are human|captcha verification failed/i.test(text)) throw new Error('El portal pide verificación o deniega la consulta. El piloto se detuvo sin reintentar.');
  if (!await hasRvSession(page)) throw new Error('La sesión no está iniciada o venció.');
}

async function clickReadOnly(locator) {
  const text = (await locator.innerText()).trim();
  if (/book\s*now|add to cart|reservar|confirmar reserva|pagar|shopping basket/i.test(text)) throw new Error('Acción de reserva o pago bloqueada por el piloto.');
  await locator.click();
}

async function chooseDestination(page, panel, name, query, optionPattern) {
  const input = panel.getByRole('combobox', exact(name));
  await input.fill(query);
  const option = page.getByRole('option').filter({ hasText: optionPattern });
  await option.waitFor({ state: 'visible' });
  if (await option.count() !== 1) throw new Error(`El catálogo de ${name} devolvió opciones ambiguas.`);
  await clickReadOnly(option);
}

async function chooseEnhanced(page, control, value) {
  await clickReadOnly(control);
  await clickReadOnly(page.getByRole('option', exact(String(value))));
}

async function setGuests(page, opener, room) {
  await clickReadOnly(opener);
  const dialog = page.getByRole('dialog').filter({ visible: true });
  for (const [label, desired] of [['Adults (18+)', room.adults], ['Children (0-17)', room.children.length]]) {
    const input = dialog.getByRole('spinbutton', exact(label));
    const current = Number(await input.inputValue());
    const wrapper = dialog.locator('.number-stepper-wrapper').filter({ has: page.getByRole('spinbutton', exact(label)) });
    const name = current < desired ? '+' : '−';
    for (let i = 0; i < Math.abs(current - desired); i++) await clickReadOnly(wrapper.getByRole('button', exact(name)));
    if (Number(await input.inputValue()) !== desired) throw new Error('No se pudo ajustar la ocupación del portal.');
  }
  // These enhanced age fields are generated dynamically. Use visible comboboxes.
  const selectors = dialog.getByRole('combobox');
  const offset = await selectors.count() - room.children.length;
  if (offset < 0 || offset > 1) throw new Error('Cambió el selector de edades del portal.');
  for (let i = 0; i < room.children.length; i++) await chooseEnhanced(page, selectors.nth(offset + i), room.children[i]);
  await clickReadOnly(dialog.getByRole('button', exact('Apply')));
}

async function setDate(input, date) { await input.fill(asPortalDate(date)); await input.press('Tab'); }

async function setTime(page, button, value) {
  await clickReadOnly(button);
  const dialog = page.getByRole('dialog').filter({ visible: true });
  const [hour, minutes] = value.split(':').map(Number);
  await chooseEnhanced(page, dialog.getByRole('combobox', exact('Hour')), (hour % 12) || 12);
  await chooseEnhanced(page, dialog.getByRole('combobox', exact('minutes')), String(minutes).padStart(2, '0'));
  await dialog.getByRole('radio', exact(hour >= 12 ? 'PM' : 'AM')).check();
  await clickReadOnly(dialog.getByRole('button', exact('Confirm')));
}

export async function getTransferTimeButtons(panel) {
  // Each journey has a desktop button AND a hidden mobile copy. Index only
  // visible triggers, otherwise index 1 is the hidden outbound mobile button.
  const buttons = panel.locator('button').filter({ has: panel.locator('input.hour-selector-text') }).filter({ visible: true });
  if (await buttons.count() !== 2) throw new Error('No se encontraron exactamente dos selectores de hora visibles.');
  return buttons;
}

export function describeTransferFailure(stage, error) {
  // Playwright messages can contain supplier URLs, IDs and page text. Keep
  // diagnostics useful without storing that raw message, stack or call log.
  const code = error?.name === 'TimeoutError' ? 'TIMEOUT' : 'STEP_FAILED';
  const reason = code === 'TIMEOUT' ? 'El control o resultado no estuvo disponible dentro del plazo.' : 'El paso no se completó o no superó la validación.';
  return { service: 'transfer', stage, code, message: reason };
}

// Read only rendered result cards. Never extract cookies, credentials, option/cache IDs or full HTML.
export async function readHotelRows(page) {
  return page.locator('article.hotel-result').evaluateAll(cards => cards.flatMap(card => {
    const title = card.querySelector('h2');
    const link = title?.querySelector('a');
    let hotelCode = '';
    try { hotelCode = new URL(link?.getAttribute('href') || '', location.origin).pathname.match(/\/(JP[A-Z0-9]+)$/)?.[1] || ''; } catch {}
    return Array.from(card.querySelectorAll('.result-option')).slice(0,20).map(row => {
      const amount = row.querySelector('.js-currency-conversor[data-amount]');
      return { hotelName: title?.textContent.trim() || '', hotelCode,
        roomName: Array.from(row.querySelectorAll('.product-option__room-name')).map(el => el.textContent.trim()).join(' / '),
        meal: row.querySelector('.condition--board .condition__title')?.textContent.trim() || '',
        occupancy: row.querySelector('.product-option__price-tag')?.textContent.trim() || '',
        amount: amount?.getAttribute('data-amount') || null, currency: amount?.getAttribute('data-currency') || null,
        taxes: row.querySelector('.product-option__price-tag--taxes')?.textContent.trim() || '',
        nonRefundable: row.getAttribute('data-non-refundable') === 'true' };
    });
  }).slice(0,200));
}

export async function readTransferRows(page) {
  return page.locator('article.transfer-result').evaluateAll(cards => cards.slice(0,100).map(card => {
    const amount = card.querySelector('.js-currency-conversor[data-amount]');
    const content = card.querySelector('.product-option__content');
    return { title: 'Traslado redondo',
      occupancy: card.querySelector('.product-option__price-tag')?.textContent.trim() || '',
      amount: amount?.getAttribute('data-amount') || null, currency: amount?.getAttribute('data-currency') || null,
      taxes: card.querySelector('.product-option__price-tag--taxes')?.textContent.trim() || '',
      vehicleDescriptions: Array.from(card.querySelectorAll('.card__car-model')).map(el=>el.textContent.trim()),
      legTexts: Array.from(content?.querySelectorAll('.product-option__data') || []).map(el=>el.innerText.trim()) };
  }));
}

export async function runRvPilot(request, { log = console.log, channel } = {}) {
  validatePilotRequest(request);
  const channels = channel ? [channel] : (process.platform === 'win32' ? ['chrome', 'msedge'] : ['chrome']);
  let browser;
  for (const candidate of channels) {
    try { browser = await chromium.launch({ channel: candidate, headless: false, timeout: 20000 }); break; }
    catch (error) {
      if (!/executable.*(exist|found)|distribution.*not found/i.test(error.message)) throw new Error('No se pudo abrir el navegador local. Cierra el piloto e inténtalo de nuevo desde Windows.');
    }
  }
  if (!browser) throw new Error('No se encontró Chrome o Edge instalado. Instala uno desde su sitio oficial.');
  try {
    const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 1000 }, acceptDownloads: false });
    // Prevent all booking navigation/requests even if the supplier changes its interface.
    await context.route('**/*', route => /\/(booking|payment|checkout)\//i.test(new URL(route.request().url()).pathname) ? route.abort('blockedbyclient') : route.continue());
    let page = await context.newPage();
    page.setDefaultTimeout(12000); page.setDefaultNavigationTimeout(30000);
    await page.goto(RV_ORIGIN, { waitUntil: 'domcontentloaded' });
    log('Inicia sesión directamente en la ventana de RV Online (hasta 5 minutos). No escribas credenciales en CMD.');
    page = await waitForRvSession(context, { log });
    page.setDefaultTimeout(12000); page.setDefaultNavigationTimeout(30000);
    await accessible(page);
    log('Sesión detectada en la ventana del piloto.');
    if (!await page.getByRole('tab', exact('Hotels')).isVisible()) throw new Error('El acceso está iniciado, pero el portal no muestra las etiquetas en inglés validadas por el piloto. Comparte una captura del buscador para adaptar el idioma.');
    log('Sesión iniciada. Consultando hoteles...');
    const panel = page.getByRole('tabpanel', exact('Hotels'));
    log('Hotel: seleccionando Cancún en el catálogo...');
    await chooseDestination(page, panel, 'Destination', 'Cancun', /^\s*Cancun Quintana Roo, Mexico\s*$/);
    log('Hotel: configurando fechas, nacionalidad y viajeros...');
    await setDate(panel.getByRole('textbox', exact('Check-in More information')), request.trip.start);
    await setDate(panel.getByRole('textbox', exact('Check-out More information')), request.trip.end);
    await chooseEnhanced(page, panel.getByRole('combobox', exact('Nationality')), 'Mexico');
    await setGuests(page, panel.getByRole('button', { name: /\d+ Rooms \d+ Guests/ }), request.trip.rooms[0]);
    log('Hotel: enviando la consulta y esperando resultados completos...');
    await clickReadOnly(panel.getByRole('button', exact('Search')));
    await page.getByRole('heading', { name: 'Hotels in Cancun, Quintana Roo, Mexico', exact: true }).waitFor();
    await until(async () => {
      await accessible(page);
      return await page.getByRole('combobox', exact('Recommended')).isEnabled().catch(()=>false);
    }, searchTimeout, 'La búsqueda de hoteles no terminó. No se capturaron propuestas provisionales.');
    const hotelHeading = await page.getByRole('heading', { level: 1 }).first().innerText();
    verifySearchHeading(hotelHeading, request, 'hotel');
    if (request.hotelName) {
      await page.getByRole('textbox', exact('Insert hotel name')).fill(request.hotelName);
      await until(async()=> (await page.locator('article.hotel-result h2').allTextContents()).some(text=>text.toLowerCase().includes(request.hotelName.toLowerCase())), 15000, 'El hotel solicitado no aparece entre los resultados visibles.');
    }
    let rows = await readHotelRows(page);
    if (request.hotelName) rows = rows.filter(row=>row.hotelName.toLowerCase().includes(request.hotelName.toLowerCase()));
    if (!rows.length) throw new Error('No se encontraron tarifas legibles para el hotel solicitado.');
    const firstCard = page.locator('article.hotel-result').filter({ has: page.getByRole('heading', { name: new RegExp(escapeRegex(rows[0].hotelName), 'i') }) }).first();
    const condition = firstCard.locator('.result-option').first().getByText('Check Conditions', { exact: true }).first();
    if (await condition.count()) {
      await clickReadOnly(condition);
      try {
        await until(async()=> /Cancelling from/i.test((await page.getByRole('tooltip').allTextContents()).join(' ')), 15000, 'Política no disponible.');
        rows[0].cancellation = (await page.getByRole('tooltip').allTextContents()).join(' ').replace(/\s+/g,' ').trim();
      } catch { log('No se recibió la política de cancelación de la primera tarifa; queda pendiente de revisar.'); }
    }
    const hotels = normalizeHotels(rows, request);
    if (!hotels.offers.length) throw new Error('Todas las tarifas hoteleras fueron rechazadas por los controles de consistencia.');
    log(`Hoteles: ${hotels.offers.length} tarifas capturadas; ${hotels.rejected.length} descartadas.`);
    const report = { version: 1, mode: 'rv-pilot', consultedAt: new Date().toISOString(), booked: false,
      coverage: 'Resultados visibles del hotel solicitado, no todo el inventario del destino',
      request: { trip: { client: '', notes: '', destination: request.trip.destination,
        start: request.trip.start, end: request.trip.end, airport: request.trip.airport,
        origin: request.trip.origin, meal: request.trip.meal, services: [...request.trip.services],
        rooms: request.trip.rooms.map(room=>({adults:room.adults,children:[...room.children]})) }, nationality: 'MX', hotelName: request.hotelName || null,
        outboundTime: request.outboundTime || null, returnTime: request.returnTime || null },
      hotels, transfers: { offers: [], rejected: [] }, errors: [], diagnostics: [],
      limitations: ['No hay integración con el cotizador todavía.', 'No se validaron vuelos ni comisiones de la cuenta.', 'Revalidar antes de vender; no se realizaron reservas.'] };
    if (request.trip.services.includes('transfer')) {
      log('Consultando traslados redondos para el mismo hotel...');
      let stage = 'abrir el buscador';
      const step = value => { stage = value; log(`Traslados: ${stage}...`); };
      try {
        step('abrir el buscador');
        await page.goto(RV_ORIGIN, { waitUntil: 'domcontentloaded' });
        await page.locator('a[href*="action=logout" i]').first().waitFor({ state: 'attached' });
        await accessible(page);
        await clickReadOnly(page.getByRole('tab', exact('Transfers')));
        const transfers = page.getByRole('tabpanel', exact('Transfers'));
        await transfers.waitFor({ state: 'visible' });
        step('seleccionar aeropuerto y hotel');
        await transfers.getByRole('radio', exact('Round trip')).check();
        await chooseDestination(page, transfers, 'Origin', 'Cancun', /^\s*Cancun International Airport \(CUN\) Cancun, Quintana Roo, Mexico\s*$/);
        await chooseDestination(page, transfers, 'Destination', request.hotelName, new RegExp(escapeRegex(request.hotelName),'i'));
        step('configurar pasajeros y fechas');
        await setGuests(page, transfers.getByRole('button', { name: /\d+ Guests/ }), request.trip.rooms[0]);
        await setDate(transfers.getByRole('textbox', exact('Departure More information')), request.trip.start);
        await setDate(transfers.getByRole('textbox', exact('Return More information')), request.trip.end);
        // Confirm BOTH pickers; the portal otherwise leaves Search without a response.
        // Use the visible time inputs to identify their containing buttons, not a remembered hour.
        step('configurar hora de ida');
        const timeButtons = await getTransferTimeButtons(transfers);
        await setTime(page, timeButtons.nth(0), request.outboundTime);
        step('configurar hora de regreso');
        await setTime(page, timeButtons.nth(1), request.returnTime);
        step('enviar la consulta');
        await clickReadOnly(transfers.getByRole('button', exact('Search')));
        await page.getByRole('heading', { name: /^Transfers in Cancun International Airport/, level: 1 }).first().waitFor({ timeout: searchTimeout });
        step('validar ruta, fechas y pasajeros');
        verifySearchHeading(await page.getByRole('heading', { level: 1 }).first().innerText(), request, 'transfer');
        step('esperar opciones del proveedor');
        await until(async()=> {
          await accessible(page);
          return await page.locator('article.transfer-result').count() > 0;
        }, searchTimeout, 'No se recibieron opciones de traslado en el plazo permitido.');
        step('leer y validar las tarifas');
        report.transfers = normalizeTransfers(await readTransferRows(page), request);
        if (!report.transfers.offers.length) throw new Error('Ninguna tarifa de traslado superó la validación.');
        log(`Traslados: ${report.transfers.offers.length} opciones capturadas; ${report.transfers.rejected.length} descartadas.`);
      } catch (error) {
        const diagnostic = describeTransferFailure(stage, error);
        report.diagnostics.push(diagnostic);
        report.errors.push(`No se completó la consulta de traslados. Paso: ${stage} [${diagnostic.code}]. ${diagnostic.message} El piloto conservó las tarifas hoteleras; no añadió importes de ejemplo.`);
      }
    }
    return report;
  } finally { await browser.close(); }
}
