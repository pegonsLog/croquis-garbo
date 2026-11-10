// Desenha um croqui e exporta PDF (paisagem e retrato), KMZ e KML: node.exe export-check.mjs
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const OUT = 'c:/projetos/croquis-bh/.agents/screenshots/export';
mkdirSync(OUT, { recursive: true });
const LINK =
  'https://bhmap.pbh.gov.br/v2/mapa/idebhgeo#zoom=8&lat=7796089.13353&lon=608484.19834&baselayer=base';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })).newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
await page.goto('http://localhost:4200/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.fill('header input[aria-label="Nome do croqui"]', 'Interdição Rua Cuiabá');
await page.keyboard.press('Tab');
await page.fill('header input[placeholder^="Cole"]', LINK);
await page.click('header button[type=submit]');
await wait(3000);

const box = await page.locator('main').boundingBox();
const click = async (fx, fy, opts) => {
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy, opts);
  await wait(200);
};
await page.keyboard.press('a');
await click(0.25, 0.7);
await click(0.5, 0.45, { clickCount: 2 });
await page.keyboard.press('r');
await click(0.6, 0.2);
await click(0.75, 0.35);
await page.keyboard.press('s');
await page.click('app-toolbar button[title="Cone"]');
await click(0.4, 0.62);
await page.keyboard.press('t');
await click(0.5, 0.3);
await wait(300);
await page.fill('app-properties-panel textarea', 'Desvio pela Rua Cuiabá');
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await page.click('app-layers-panel button[title="Nova camada"]');
await page.waitForSelector('app-layers-panel li input');
await wait(200);
await page.keyboard.type('Sinalização');
await page.keyboard.press('Enter');
await wait(300);
await page.keyboard.press('s');
await page.click('app-toolbar button[title="Pare"]');
await click(0.3, 0.4);
await page.keyboard.press('l');
await click(0.2, 0.2);
await click(0.35, 0.25, { clickCount: 2 });
await page.keyboard.press('v');
await wait(800);
await page.screenshot({ path: `${OUT}/tela.png` });

async function exportItem(label, file) {
  await page.click('header button[aria-haspopup="menu"]');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.click(`[role=menuitem]:has-text("${label}")`),
  ]);
  await download.saveAs(`${OUT}/${file}`);
  await wait(500);
  return download.suggestedFilename();
}
const names = [];
names.push(await exportItem('PDF A4 paisagem', 'paisagem.pdf'));
names.push(await exportItem('PDF A4 retrato', 'retrato.pdf'));
names.push(await exportItem('KMZ', 'croqui.kmz'));
names.push(await exportItem('KML simples', 'croqui.kml'));
await page.screenshot({ path: `${OUT}/depois.png` });
const view = await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('croquis-bh:atual'));
  return d.view;
});
console.log(JSON.stringify({ names, view, problems }, null, 1));
await browser.close();
