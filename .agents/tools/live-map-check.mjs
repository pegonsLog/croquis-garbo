// Abre um endereço (padrão: o site publicado), vai até um link do BHMap e diz se o fundo apareceu:
// node live-map-check.mjs [url]
import { chromium } from 'playwright-core';
const URL = process.argv[2] ?? 'https://croquis-garbo.web.app/';
const OUT = 'c:/projetos/croquis-bh/.agents/screenshots';
const LINK =
  'https://bhmap.pbh.gov.br/v2/mapa/idebhgeo#zoom=8&lat=7796089.13353&lon=608484.19834&baselayer=base';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
const requests = { ok: 0, failed: [] };
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 160)));
page.on('response', (r) => {
  if (!r.url().includes('bhmap.pbh.gov.br')) return;
  if (r.status() < 400) requests.ok++;
  else requests.failed.push(`${r.status()} ${r.url().slice(0, 110)}`);
});
page.on('requestfailed', (r) => r.url().includes('bhmap') && requests.failed.push(`falhou ${r.failure()?.errorText} ${r.url().slice(0, 90)}`));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('main .ol-viewport', { timeout: 20000 }).catch(() => errors.push('sem .ol-viewport'));
await page.fill('header input[placeholder^="Cole"]', LINK);
await page.click('header button[type=submit]');
await wait(12000);
const map = await page.evaluate(() => {
  const vp = document.querySelector('main .ol-viewport');
  const canvases = [...(vp?.querySelectorAll('canvas') ?? [])];
  // Pixels escuros (vias) em cada canvas de camada
  const dark = canvases.map((c) => {
    try {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 16) if (d[i] > 0) n++;
      return `${c.parentElement?.className || c.className}:${n}`;
    } catch (e) {
      return `${c.parentElement?.className}:erro ${e.message}`;
    }
  });
  return { viewport: !!vp, size: vp ? [vp.clientWidth, vp.clientHeight] : null, canvases: dark };
});
await page.screenshot({ path: `${OUT}/mapa-site.png` });
console.log(JSON.stringify({ map, requests: { ok: requests.ok, failed: requests.failed.slice(0, 8), totalFailed: requests.failed.length }, errors: errors.slice(0, 8) }, null, 1));
await browser.close();
