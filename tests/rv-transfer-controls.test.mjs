import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { getTransferTimeButtons, describeTransferFailure, readCancellationTooltip } from '../server/providers/rv-pilot.mjs';

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
    if (selector === 'button:has(input.hour-selector-text)') return new Controls(buttons.filter(button => button.children?.some(input => input.time)));
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

test('transfer control count diagnostic includes only a safe numeric count', () => {
  const error = Object.assign(new Error('private supplier text'), { code: 'TIME_CONTROL_COUNT', controlCount: 0 });
  const diagnostic = describeTransferFailure('configurar hora de ida', error);
  assert.equal(diagnostic.code, 'TIME_CONTROL_COUNT');
  assert.equal(diagnostic.controlCount, 0);
  assert.doesNotMatch(JSON.stringify(diagnostic), /private supplier text/);
});

test('cancellation keeps the validated tooltip snapshot if it disappears on the next read', async () => {
  let reads = 0;
  const page = { getByRole: role => {
    assert.equal(role, 'tooltip');
    return { allTextContents: async () => ++reads === 1 ? ['Unrelated hint', 'Cancelling from 01/12/2027: example penalty'] : [] };
  } };
  assert.equal(await readCancellationTooltip(page), 'Cancelling from 01/12/2027: example penalty');
  assert.equal(reads, 1);
});

test('real browser resolves time controls relative to the Transfers panel', async t => {
  let browser;
  for (const channel of ['chrome', 'msedge']) {
    try { browser = await chromium.launch({ channel, headless: true }); break; }
    catch (error) {
      if (!/executable.*(exist|found)|distribution.*not found/i.test(error.message)) throw error;
    }
  }
  if (!browser) return t.skip('Requires installed Chrome or Edge');
  try {
    const page = await browser.newPage();
    await page.setContent(`<section role="tabpanel" aria-label="Hotels"><button><input class="hour-selector-text"></button></section>
      <section role="tabpanel" aria-label="Transfers">
        <button id="outbound"><input class="hour-selector-text"></button>
        <button hidden><input class="hour-selector-text"></button>
        <button id="return"><input class="hour-selector-text"></button>
        <button hidden><input class="hour-selector-text"></button>
        <button>Search</button>
      </section>`);
    const panel = page.getByRole('tabpanel', { name: 'Transfers', exact: true });
    // Reproduce the original bug with Playwright's actual relative has semantics.
    assert.equal(await panel.locator('button').filter({ has: panel.locator('input.hour-selector-text') }).count(), 0);
    const controls = await getTransferTimeButtons(panel);
    assert.deepEqual(await controls.evaluateAll(nodes => nodes.map(node => node.id)), ['outbound', 'return']);
    await page.locator('#return').evaluate(node => node.hidden = true);
    await assert.rejects(getTransferTimeButtons(panel), error => error.code === 'TIME_CONTROL_COUNT' && error.controlCount === 1);
  } finally { await browser.close(); }
});
