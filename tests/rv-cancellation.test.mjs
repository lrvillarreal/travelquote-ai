import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { captureHotelCancellation } from '../server/providers/rv-cancellation.mjs';

// Synthetic rates and policies only. No supplier HTML or account data.
const expected = { hotelName: 'Test hotel', hotelCode: 'JPTEST', roomName: 'Test room', meal: 'All Inclusive', occupancy: '4 nights, 2 adults and 1 child', amount: '123.45', currency: 'MXN' };
const fixture = `<article class="hotel-result"><h2><a href="https://fixture.invalid/hotel/JPTEST">Test hotel</a></h2>
  <div class="result-option" id="rate-a"><span class="product-option__room-name">Test room</span>
    <div class="condition--board"><span class="condition__title">All Inclusive</span></div>
    <span class="product-option__price-tag">4 nights, 2 adults and 1 child</span>
    <span class="js-currency-conversor" data-amount="123.45" data-currency="MXN"></span>
    <div class="js-condition-policy" id="control-a">Check Conditions</div>
  </div>
  <div class="result-option" id="rate-b"><div class="js-condition-policy" id="control-b">Check Conditions</div></div>
</article><div role="tooltip" id="foreign">Cancelling from a different rate: wrong policy</div>`;

test('cancellation capture binds the notice to the exact rate and fails closed on ambiguity or replacement', async t => {
  let browser;
  for (const channel of ['chrome', 'msedge']) {
    try { browser = await chromium.launch({ channel, headless: true }); break; }
    catch (error) { if (!/executable.*(exist|found)|distribution.*not found/i.test(error.message)) throw error; }
  }
  if (!browser) return t.skip('Requires installed Chrome or Edge');
  const page = await browser.newPage();
  await page.route('https://fixture.invalid/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  await page.goto('https://fixture.invalid/');
  const capture = () => captureHotelCancellation(page.locator('.result-option').first(), expected, { timeoutMs: 160, pollMs: 10 });
  const reset = async mode => {
    await page.setContent(fixture);
    await page.evaluate(mode => {
      document.querySelector('#control-a').addEventListener('click', event => {
        const control = event.currentTarget;
        if (mode === 'unrelated') return;
        if (mode === 'replace') { document.querySelector('#rate-a').outerHTML = '<div class="result-option">Replacement rate</div>'; return; }
        const notice = document.createElement('div');
        notice.id = 'owned'; notice.role = 'tooltip'; notice.textContent = 'Cancelling from test date: policy for rate A';
        control.setAttribute('aria-describedby', 'owned'); document.body.append(notice);
        if (mode === 'shared') document.querySelector('#control-b').setAttribute('aria-describedby', 'owned');
        if (mode === 'reorder') document.querySelector('article').prepend(document.querySelector('#rate-b'));
        if (mode === 'two') {
          const second = notice.cloneNode(true); second.id = 'owned-two'; document.body.append(second);
          control.setAttribute('aria-describedby', 'owned owned-two');
        }
      });
    }, mode);
  };
  try {
    await t.test('ignores a foreign policy and reads only the control reference', async () => {
      await reset('owned'); const result = await capture();
      assert.equal(result.status, 'captured');
      assert.equal(result.association, 'control-reference');
      assert.equal(result.cancellation, 'Cancelling from test date: policy for rate A');
    });
    await t.test('foreign policy alone remains explicitly pending', async () => {
      await reset('unrelated'); assert.deepEqual(await capture(), { status: 'pending', cancellation: null, reason: 'notice-unavailable' });
    });
    for (const mode of ['shared', 'two']) await t.test(`${mode} notices are rejected`, async () => {
      await reset(mode); assert.equal((await capture()).reason, 'notice-ambiguous');
    });
    await t.test('a replaced rate cannot acquire the next rate policy', async () => {
      await reset('replace'); assert.equal((await capture()).reason, 'rate-changed');
    });
    await t.test('reordering preserves the original DOM rate', async () => {
      await reset('reorder'); assert.equal((await capture()).status, 'captured');
    });
    await t.test('changed price stops before activating the condition control', async () => {
      await reset('owned');
      await page.locator('#rate-a [data-amount]').evaluate(el => el.setAttribute('data-amount', '999.99'));
      assert.equal((await capture()).reason, 'rate-changed');
      assert.equal(await page.locator('#owned').count(), 0);
    });
  } finally { await browser.close(); }
});
