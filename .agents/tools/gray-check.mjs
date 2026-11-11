// Confere que as vias saem em cinza na tela e no PNG exportado: node gray-check.mjs
import { chromium } from 'playwright-core';
const OUT = 'c:/projetos/croquis-bh/.agents/screenshots';
const LINK =
  'https://bhmap.pbh.gov.br/v2/mapa/idebhgeo#zoom=8&lat=7796089.13353&lon=608484.19834&baselayer=base';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })).newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
await page.goto('http://localhost:4200/', { waitUntil: 'networkidle' });
await page.fill('header input[placeholder^="Cole"]', LINK);
await page.click('header button[type=submit]');
await wait(3500);
await page.screenshot({ path: `${OUT}/vias-cinza-fixo.png` });

/** Conta pixels azulados (azul bem maior que vermelho) num PNG. */
const bluePixels = (buffer) =>
  page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let blue = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 2] - d[i] > 60) blue++;
    return blue;
  }, buffer.toString('base64'));

// Avisos sobre o mapa (selo "Desenhando em", com a bolinha azul) não contam: só o mapa
const withNotices = await bluePixels(await page.locator('main').screenshot());
await page.addStyleTag({ content: 'main > .ui { visibility: hidden !important; }' });
const mapShot = await page.locator('main').screenshot();
const filters = await page.evaluate(() =>
  ['.base-meio-fio', '.base-alinhamento'].map((s) => getComputedStyle(document.querySelector(s)).filter),
);
await page.click('header button:has-text("Exportar")');
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 60000 }),
  page.click('[role=menuitem]:has-text("Imagem PNG")'),
]);
const path = `${OUT}/vias-cinza-export.png`;
await download.saveAs(path);
const { readFileSync } = await import('node:fs');
console.log(
  JSON.stringify({
    filters,
    bluePixelsWithNotices: withNotices,
    bluePixelsScreen: await bluePixels(mapShot),
    bluePixelsExport: await bluePixels(readFileSync(path)),
    problems,
  }),
);
await browser.close();
