import test from 'node:test';
import assert from 'node:assert/strict';
import { getTransferTimeButtons, describeTransferFailure } from '../server/providers/rv-pilot.mjs';

// Synthetic control inventory reproduces the portal's desktop/mobile pairs.
// No supplier account data, session IDs or prices are used.
class Controls {
  constructor(nodes) { this.nodes = nodes; }
  filter({ has, visible } = {}) {
    return new Controls(this.nodes.filter(node =>
      (visible === undefined || node.visible === visible) &&
      (!has || node.children?.some(child => has.nodes.includes(child)))));
  }
  async count() { return this.nodes.length; }
  nth(index) { return this.nodes[index]; }
}
function panel(buttons) {
  return { locator: selector => {
    if (selector === 'button') return new Controls(buttons);
    if (selector === 'input.hour-selector-text') return new Controls(buttons.flatMap(button => button.children || []).filter(input => input.time));
    throw new Error(`Unexpected selector: ${selector}`);
  } };
}
const button = (id, visible, time = true) => ({ id, visible, children: [{ time }] });

test('transfer times select outbound and return, skipping hidden mobile duplicates and unrelated input buttons', async () => {
  const buttons = [button('outbound', true), button('outbound-mobile', false),
    button('return', true), button('return-mobile', false), button('unrelated', true, false)];
  const times = await getTransferTimeButtons(panel(buttons));
  assert.equal(times.nth(0).id, 'outbound');
  assert.equal(times.nth(1).id, 'return');
});

test('transfer times stop for missing or ambiguous visible controls', async () => {
  for (const count of [0, 1, 3]) {
    await assert.rejects(getTransferTimeButtons(panel(Array.from({ length: count }, (_, index) => button(String(index), true)))), /exactamente dos/);
  }
});

test('transfer diagnostic retains the failing stage without leaking raw provider errors', () => {
  const error = new Error('https://supplier.example/?searchSessionID=private-secret\nCall log: account details');
  error.name = 'TimeoutError';
  const diagnostic = describeTransferFailure('configurar hora de regreso', error);
  assert.equal(diagnostic.stage, 'configurar hora de regreso');
  assert.equal(diagnostic.code, 'TIMEOUT');
  assert.doesNotMatch(JSON.stringify(diagnostic), /private-secret|account details|searchSessionID|supplier\.example/);
  assert.equal(describeTransferFailure('validar ruta, fechas y pasajeros', new Error('private text')).code, 'STEP_FAILED');
});
