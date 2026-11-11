// Aviso de BHMap fora do ar: aparece quando o servidor falha, some quando volta, e não aparece à toa.
// node bhmap-down-check.mjs
import { chromium } from 'playwright-core';
const OUT = 'c:/projetos/croquis-bh/.agents/screenshots';
const LINK =
  'https://bhmap.pbh.gov.br/v2/mapa/idebhgeo#zoom=8&lat=7796089.13353&lon=608484.19834&baselayer=base';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const alert = 'main [role=alert]';

async function open(down) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const state = { down };
  // Simula o servidor fora do ar: 503 sem cabeçalho CORS, como aconteceu de verdade
  await page.route('**/bhmap.pbh.gov.br/**', (route) =>
    state.down ? route.fulfill({ status: 503, body: 'Service Unavailable' }) : route.continue(),
  );
  await page.goto('http://localhost:4200/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.ng?.getComponent(document.querySelector('app-root'))?.store?.map);
  await page.fill('header input[placeholder^="Cole"]', LINK);
  await page.click('header button[type=submit]');
  return { page, state, ctx };
}
const pan = (page) =>
  page.evaluate(() => {
    const v = window.ng.getComponent(document.querySelector('app-root')).store.map.getView();
    const c = v.getCenter();
    v.setCenter([c[0] + 60, c[1]]);
  });

const r = {};
// 1) Servidor normal: o aviso não pode aparecer (nem com as imagens canceladas ao mover o mapa)
{
  const { page, ctx } = await open(false);
  await wait(4000);
  await pan(page);
  await wait(4000);
  r.normal = await page.locator(alert).count();
  await ctx.close();
}
// 2) Servidor fora do ar: aparece; volta: some ao carregar de novo
{
  const { page, state, ctx } = await open(true);
  await wait(5000);
  r.down = await page.locator(alert).count();
  r.text = r.down ? (await page.locator(alert).innerText()).replace(/\s+/g, ' ') : null;
  await page.screenshot({ path: `${OUT}/bhmap-fora.png` });
  state.down = false;
  await pan(page);
  await wait(5000);
  r.back = await page.locator(alert).count();
  await ctx.close();
}
console.log(JSON.stringify(r, null, 1));
await browser.close();
