import { RV_ORIGIN } from './rv-normalize.mjs';

// This is the sign-out link observed in the authenticated portal. Its label
// may be translated or hidden inside a menu; neither changes the session.
const signOutSelector = 'a[href*="action=logout" i]';

export async function hasRvSession(page) {
  try {
    if (new URL(page.url()).origin !== RV_ORIGIN) return false;
    return await page.locator(signOutSelector).count() > 0;
  } catch { return false; } // A navigation can replace the document while checking.
}

export async function findRvSessionPage(pages) {
  for (const page of [...pages].reverse()) {
    if (!await hasRvSession(page)) continue;
    try {
      if (await page.getByRole('tab', { name: /^(Hotels|Hoteles)$/i }).first().isVisible()) return page;
    } catch { /* Recheck after a navigation, without submitting anything. */ }
  }
  return null;
}

export async function waitForRvSession(context, {
  log = console.log, timeoutMs = 300000, pollMs = 500, logEveryMs = 15000
} = {}) {
  const started = Date.now(); let lastLog = started;
  while (Date.now() - started < timeoutMs) {
    const pages = context.pages();
    if (!pages.length) throw new Error('Se cerró la ventana del piloto antes de detectar el acceso.');
    const page = await findRvSessionPage(pages);
    if (page) return page;
    if (Date.now() - lastLog >= logEveryMs) {
      log(`Esperando detectar la sesión y el buscador de hoteles (${Math.round((Date.now()-started)/1000)} s). Usa la ventana nueva que abrió el piloto.`);
      lastLog = Date.now();
    }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
  throw new Error('No se detectó una sesión con el buscador de hoteles en 5 minutos. Comparte una captura de la pantalla del portal, ocultando datos sensibles, para revisar el idioma o la pantalla de acceso.');
}
