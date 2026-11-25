import ExcelJS from 'exceljs';
import { SERVICE_NAMES, nightsBetween, travelerCounts } from '../shared/domain.mjs';

export async function createWorkbook(quote) {
  const book = new ExcelJS.Workbook();
  book.creator = 'TravelQuote'; book.created = new Date(quote.createdAt);
  const sheet = book.addWorksheet('Cotización', { views: [{ showGridLines: false }], pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.35, right: 0.35, top: 0.45, bottom: 0.45, header: 0.15, footer: 0.15 } } });
  sheet.columns = [{ width: 4 }, { width: 23 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 4 }];
  function line(row, text, { fill, size = 11, bold = false, color = '243A38', height = 25 } = {}) {
    sheet.mergeCells(`B${row}:E${row}`); const cell = sheet.getCell(`B${row}`); cell.value = text;
    cell.font = { name: 'Calibri', size, bold, color: { argb: color } }; cell.alignment = { vertical: 'middle', wrapText: true };
    if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    sheet.getRow(row).height = height;
  }
  line(2, quote.agency, { size: 23, bold: true, height: 42, color: '146B60' });
  if (quote.logoDataUrl) {
    const [head, base64] = quote.logoDataUrl.split(',');
    const imageId = book.addImage({ base64, extension: head.includes('png') ? 'png' : 'jpeg' });
    sheet.addImage(imageId, { tl: { col: 4, row: 0.1 }, ext: { width: 64, height: 40 } });
  }
  line(3, 'COTIZACIÓN DE VIAJE', { bold: true, size: 13 });
  line(4, 'DEMOSTRACIÓN — PRECIOS FICTICIOS — NO VÁLIDA PARA VENTA', { fill: 'FFF0D9', color: '80551A', bold: true, height: 32 });
  line(6, `Folio: ${quote.id.slice(0, 8).toUpperCase()}    Emisión: ${new Date(quote.createdAt).toLocaleDateString('es-MX', { timeZone: 'America/Chicago' })}`);
  line(7, `Cliente: ${quote.trip.client || 'Sin nombre'}    Destino: ${quote.trip.destination}`);
  line(8, `Estancia: ${quote.trip.start} al ${quote.trip.end} · ${nightsBetween(quote.trip.start, quote.trip.end)} noches`);
  const guests = travelerCounts(quote.trip.rooms);
  line(9, `${guests.adults} adultos · ${guests.children} niños · ${quote.trip.rooms.length} habitación(es)`);
  let row = 11;
  line(row++, 'VIAJEROS Y HABITACIONES', { fill: 'E8F2EF', bold: true });
  for (const [index, room] of quote.trip.rooms.entries()) line(row++, `Habitación ${index + 1}: ${room.adults} adultos; ${room.children.length ? `niños de ${room.children.join(', ')} años` : 'sin niños'}`, { height: 30 });
  row++;
  line(row++, 'SERVICIOS INCLUIDOS', { fill: '146B60', color: 'FFFFFF', bold: true });
  for (const offer of quote.selected) {
    line(row++, `${SERVICE_NAMES[offer.service]} · ${offer.title}`, { bold: true, height: 32 });
    line(row++, `${offer.subtitle}. ${offer.detail}.${offer.meal ? ` ${offer.meal}.` : ''} ${offer.highlights.join('. ')}.`, { height: 58 });
  }
  row++;
  sheet.mergeCells(`B${row}:D${row}`); sheet.getCell(`B${row}`).value = 'PRECIO TOTAL DEL PAQUETE (MXN)';
  sheet.getCell(`E${row}`).value = quote.totalCents / 100; sheet.getCell(`E${row}`).numFmt = '"$"#,##0.00';
  for (const col of ['B', 'C', 'D', 'E']) { sheet.getCell(`${col}${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '146B60' } }; sheet.getCell(`${col}${row}`).font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FFFFFF' } }; sheet.getCell(`${col}${row}`).alignment = { vertical: 'middle', wrapText: true }; }
  sheet.getRow(row++).height = 38;
  row++;
  line(row++, 'CONDICIONES Y OBSERVACIONES', { fill: 'E8F2EF', bold: true });
  const terms = ['Este documento prueba el formato de la aplicación. No representa disponibilidad, reserva ni una oferta real.', ...quote.selected.map(o => `${SERVICE_NAMES[o.service]}: ${o.cancellation}`), 'Traslados: horarios y puntos de encuentro pendientes de validar. Vuelos: horarios, equipaje y cargos pendientes de validar.', quote.terms || 'Términos comerciales de la agencia pendientes de incorporar.', quote.trip.notes].filter(Boolean);
  for (const term of terms) line(row++, term, { height: Math.max(32, Math.ceil(term.length / 100) * 16 + 12), size: 10 });
  sheet.pageSetup.printArea = `A1:F${row}`;
  sheet.headerFooter.oddFooter = 'TravelQuote · Demostración                                         Página &P de &N';
  return book.xlsx.writeBuffer();
}
