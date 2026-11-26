import test from 'node:test';
import assert from 'node:assert/strict';
import { decimalToCents, validatePilotRequest, verifySearchHeading, normalizeHotels, normalizeTransfers } from '../server/providers/rv-normalize.mjs';

// Entirely synthetic fixtures; no supplier prices, sessions or copied account HTML.
const request = () => ({ trip: { client: '', destination: 'Cancún', start: '2029-03-12', end: '2029-03-16', rooms: [{ adults: 2, children: [6] }], services: ['hotel','transfer'], airport: 'CUN', origin: 'MTY', meal: 'any', notes: '' }, hotelName: 'Hotel de prueba', outboundTime: '10:00', returnTime: '10:00' });
const hotel = () => ({ hotelName: 'Hotel de prueba', hotelCode: 'JPTEST01', roomName: 'Habitación familiar de prueba', meal: 'All Inclusive', occupancy: '4 night(s), 2 adults and 1 child', amount: '12345.67', currency: 'MXN', taxes: 'Taxes and charges included', nonRefundable: false });
const transfer = () => ({ title:'Traslado de prueba', occupancy:'2 adults and 1 child', amount:'987.65', currency:'MXN', taxes:'Taxes and charges included', legTexts:['Departure: Shared To be determined Leg: 1h 50m', 'Return: Private 07:00 Leg: 1h 30m'] });

test('RV prices retain cents and reject ambiguous or unsupported amounts', () => {
  assert.equal(decimalToCents('12345.67','MXN'),1234567);
  assert.equal(decimalToCents('12345.6','MXN'),1234560);
  assert.equal(decimalToCents('12345','MXN'),1234500);
  for (const value of ['1,234.56','1.234,56','123.456','-1','NaN','',null]) assert.throws(()=>decimalToCents(value,'MXN'));
  assert.throws(()=>decimalToCents('10','USD'));
});

test('RV pilot rejects unsupported searches before opening a browser', () => {
  assert.equal(validatePilotRequest(request()).trip.airport,'CUN');
  for (const change of [r=>r.trip.rooms.push({adults:2,children:[]}), r=>r.trip.services.push('flight'), r=>r.hotelName='', r=>r.outboundTime='25:00',r=>r.trip.destination='Los Cabos']) {
    const r=request();change(r);assert.throws(()=>validatePilotRequest(r));
  }
});

test('RV result headings must match dates, ages, nights and destinations', () => {
  const heading='Hotels in Cancun, Quintana Roo, Mexico 12/03/2029 - 16/03/2029 4 night(s) 1 Rooms 2 Adult(s) 1 Child(ren) (6 years old)';
  assert.equal(verifySearchHeading(heading,request(),'hotel'),true);
  for(const [before,after] of [['12/03/2029','13/03/2029'],['6 years','7 years'],['1 Rooms','2 Rooms'],['4 night(s)','3 night(s)'],['2 Adult(s)','3 Adult(s)']]) assert.throws(()=>verifySearchHeading(heading.replace(before,after),request(),'hotel'));
  const transferHeading='Transfers in Cancun International Airport Hotel de prueba 12/03/2029 - 16/03/2029 2 Adult(s) 1 Child(ren) (6 years old)';
  assert.equal(verifySearchHeading(transferHeading,request(),'transfer'),true);
  assert.throws(()=>verifySearchHeading(transferHeading.replace('Hotel de prueba','Otro hotel'),request(),'transfer'));
});

test('hotel capture removes duplicates and private fields without inferring missing policies', () => {
  const row={...hotel(),cookies:'secret fixture',optionId:'session fixture',rawHtml:'not exported'};
  const result=normalizeHotels([row,row],request(),'2029-01-01T00:00:00Z');
  assert.equal(result.offers.length,1);
  const offer=result.offers[0];
  assert.equal(offer.priceCents,1234567);assert.equal(offer.cancellation,null);
  assert.equal(offer.cancellationStatus,'pending');assert.equal(offer.cancellationPendingReason,'not-queried');
  assert.equal(offer.requiresManualReview,true);assert.equal(offer.includesTransfer,'unknown');
  assert.equal(offer.consultedAt,'2029-01-01T00:00:00Z');
  for(const field of ['cookies','optionId','rawHtml'])assert.equal(field in offer,false);
});

test('hotel capture rejects wrong nights, occupancy, board, currency and adult-only rooms', () => {
  const r=request();r.trip.meal='all-inclusive';
  const invalid=[{...hotel(),occupancy:'3 night(s), 2 adults and 1 child'},{...hotel(),occupancy:'4 night(s), 2 adults'}, {...hotel(),meal:'Room Only'}, {...hotel(),currency:'USD'},{...hotel(),roomName:'Ocean room 18+'},{...hotel(),amount:null}];
  const result=normalizeHotels(invalid,r);
  assert.equal(result.offers.length,0);assert.equal(result.rejected.length,invalid.length);
  const nonRefundable=normalizeHotels([{...hotel(),nonRefundable:true}],r).offers[0];
  assert.match(nonRefundable.cancellation,/no reembolsable/);
  assert.equal(nonRefundable.cancellationStatus,'pending');
});

test('hotel policy metadata remains attached to its rate and other rates stay pending', () => {
  const rows=[{...hotel(),cancellation:'Cancelling from a synthetic date: penalty A',cancellationAssociation:'control-reference'}, {...hotel(),amount:'12346.67',cancellationPendingReason:'rate-changed'}];
  const [first,second]=normalizeHotels(rows,request()).offers;
  assert.equal(first.cancellationStatus,'captured');
  assert.equal(first.cancellationAssociation,'control-reference');
  assert.equal(second.cancellationStatus,'pending');
  assert.equal(second.cancellationPendingReason,'rate-changed');
  assert.equal(second.cancellation,null);
});

test('transfer capture preserves mixed legs, exact roundtrip total and actual return time', () => {
  const offer=normalizeTransfers([transfer()],request()).offers[0];
  assert.equal(offer.priceCents,98765);assert.equal(offer.priceScope,'roundtrip-all-passengers');
  assert.equal(offer.mixedService,true);assert.equal(offer.legs[0].time,null);
  assert.equal(offer.legs[1].requestedTime,'10:00');assert.equal(offer.legs[1].time,'07:00');
  assert.equal(offer.legs[1].from,'Hotel de prueba');assert.equal(offer.legs[1].to,'CUN');
  assert.ok(offer.warnings.some(w=>w.includes('difiere')));
  assert.ok(offer.warnings.some(w=>w.includes('cambia')));
  const withVehicles=normalizeTransfers([{...transfer(),vehicleDescriptions:['Car: Standard','Car: Standard']},{...transfer(),vehicleDescriptions:['SUV: Premium','SUV: Premium']}],request());
  assert.equal(withVehicles.offers.length,2);
});

test('transfer capture rejects missing legs, reversed directions and incorrect passengers', () => {
  const row=transfer();
  const invalid=[{...row,legTexts:row.legTexts.slice(0,1)},{...row,legTexts:[...row.legTexts].reverse()},{...row,occupancy:'3 adults'},{...row,currency:'USD'}];
  const result=normalizeTransfers(invalid,request());assert.equal(result.offers.length,0);assert.equal(result.rejected.length,invalid.length);
});
