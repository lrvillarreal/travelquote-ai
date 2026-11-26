// Cancellation is optional. A failure here must not discard hotel/transfer rates.
// Never select a policy by searching all the tooltips on the page.
const pending = reason => ({ status: 'pending', cancellation: null, reason });

function inspectRate(row, expected) {
  const card = row.closest('article.hotel-result');
  const amount = row.querySelector('.js-currency-conversor[data-amount]');
  let hotelCode = '';
  try { hotelCode = new URL(card?.querySelector('h2 a')?.getAttribute('href') || '', location.origin).pathname.match(/\/(JP[A-Z0-9]+)$/)?.[1] || ''; } catch {}
  const actual = {
    hotelName: card?.querySelector('h2')?.textContent.trim() || '', hotelCode,
    roomName: Array.from(row.querySelectorAll('.product-option__room-name')).map(el => el.textContent.trim()).join(' / '),
    meal: row.querySelector('.condition--board .condition__title')?.textContent.trim() || '',
    occupancy: row.querySelector('.product-option__price-tag')?.textContent.trim() || '',
    amount: amount?.getAttribute('data-amount') || null, currency: amount?.getAttribute('data-currency') || null
  };
  if (!row.isConnected || Object.entries(actual).some(([key, value]) => value !== expected[key])) return { reason: 'rate-changed' };
  const controls = row.querySelectorAll('.js-condition-policy');
  if (controls.length !== 1) return { reason: 'control-unavailable' };
  return { reason: null };
}

function inspectNotice(row) {
  if (!row.isConnected) return { reason: 'rate-changed' };
  const control = row.querySelector('.js-condition-policy');
  if (!control) return { reason: 'control-unavailable' };
  const visible = el => {
    const style = getComputedStyle(el);
    return el.isConnected && el.getClientRects().length > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const owners = [control, ...control.querySelectorAll('[aria-describedby], [aria-controls]')];
  const ids = new Set(owners.flatMap(el => `${el.getAttribute('aria-describedby') || ''} ${el.getAttribute('aria-controls') || ''}`.split(/\s+/).filter(Boolean)));
  const candidates = new Map();
  for (const id of ids) {
    const notice = document.getElementById(id);
    if (!notice || !notice.matches('[role="tooltip"], .tooltip, .popover') || !visible(notice)) continue;
    // A tooltip referenced by another rate/control is ambiguous even if its text
    // looks like a policy. DOM IDs are used only in memory, never exported.
    const foreignOwner = Array.from(document.querySelectorAll('[aria-describedby], [aria-controls]')).some(el =>
      el !== control && !control.contains(el) && `${el.getAttribute('aria-describedby') || ''} ${el.getAttribute('aria-controls') || ''}`.split(/\s+/).includes(id));
    if (foreignOwner || (notice.closest('.result-option') && notice.closest('.result-option') !== row)) return { reason: 'notice-ambiguous' };
    candidates.set(notice, 'control-reference');
  }
  for (const notice of control.querySelectorAll('[role="tooltip"], .tooltip, .popover')) {
    if (visible(notice)) candidates.set(notice, 'control-descendant');
  }
  if (candidates.size > 1) return { reason: 'notice-ambiguous' };
  if (!candidates.size) return { reason: 'notice-unavailable' };
  const [[notice, association]] = candidates;
  const cancellation = notice.innerText.replace(/\s+/g, ' ').trim();
  if (!/Cancelling from/i.test(cancellation)) return { reason: 'notice-unavailable' };
  return { reason: null, cancellation, association };
}

export async function captureHotelCancellation(rate, expected, { timeoutMs = 15000, pollMs = 250 } = {}) {
  let row;
  let control;
  try {
    if (await rate.count() !== 1) return pending('rate-unavailable');
    // Pin this DOM node. A re-render must not silently move us to another rate.
    row = await rate.elementHandle();
    if (!row || !await row.isVisible()) return pending('rate-unavailable');
    const before = await row.evaluate(inspectRate, expected);
    if (before.reason) return pending(before.reason);
    const existing = await row.evaluate(inspectNotice);
    if (!existing.reason) return pending('notice-already-open');
    if (existing.reason === 'notice-ambiguous') return pending(existing.reason);
    control = await row.$('.js-condition-policy');
    // Only this known read-only control may be activated. Fail closed if its
    // label changes to a booking action or a different kind of condition.
    if (!control || !/^Check Conditions$/i.test((await control.innerText()).replace(/\s+/g, ' ').trim())) return pending('control-unavailable');
    await control.click({ timeout: Math.min(timeoutMs, 12000) });
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const identity = await row.evaluate(inspectRate, expected);
      if (identity.reason) return pending(identity.reason);
      const notice = await row.evaluate(inspectNotice);
      if (notice.reason === 'notice-ambiguous') return pending(notice.reason);
      if (!notice.reason) {
        // Confirm the same rate still owns the captured notice after the read.
        const after = await row.evaluate(inspectRate, expected);
        if (after.reason) return pending(after.reason);
        return { status: 'captured', cancellation: notice.cancellation, association: notice.association };
      }
      await new Promise(resolve => setTimeout(resolve, pollMs));
    }
    return pending('notice-unavailable');
  } catch {
    // Playwright exceptions may contain session URLs and page text.
    return pending('control-failed');
  } finally {
    await control?.dispose().catch(() => {});
    await row?.dispose().catch(() => {});
  }
}
