// Teste de ponta a ponta: node.exe e2e-check.mjs [url]
// Abre o app, vai até o link do BHMap, desenha objetos, cria camada, exporta PNG e tira screenshots.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const URL = process.argv[2] ?? 'http://localhost:4300/';
const OUT = 'c:/projetos/croquis-bh/.agents/screenshots';
const LINK =
  'https://bhmap.pbh.gov.br/v2/mapa/idebhgeo#zoom=7&lat=7796089.13353&lon=608484.19834&baselayer=base';
mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const problems = [];
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('response', (r) => r.status() >= 400 && problems.push(`${r.status()}: ${r.url().slice(0, 140)}`));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });

await page.fill('header input[placeholder^="Cole"]', LINK);
await page.click('header button[type=submit]');
await wait(4000);
await page.screenshot({ path: `${OUT}/01-link.png` });

const box = await page.locator('main').boundingBox();
const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
const click = async (fx, fy, opts) => {
  const [x, y] = at(fx, fy);
  await page.mouse.click(x, y, opts);
  await wait(150);
};

// Linha tracejada
await page.keyboard.press('l');
await page.click('app-properties-panel label:has-text("Tracejado") input');
await click(0.2, 0.3);
await click(0.35, 0.35);
await click(0.45, 0.25, { clickCount: 2 });
// Seta
await page.keyboard.press('a');
await click(0.55, 0.7);
await click(0.7, 0.55, { clickCount: 2 });
// Retângulo
await page.keyboard.press('r');
await click(0.6, 0.2);
await click(0.75, 0.35);
// Símbolos
await page.keyboard.press('s');
await page.click('app-toolbar button[title="Cone"]');
await click(0.3, 0.6);
await page.click('app-toolbar button[title="Pare"]');
await click(0.4, 0.62);
// Texto
await page.keyboard.press('t');
await click(0.5, 0.45);
await wait(300);
await page.fill('app-properties-panel textarea', 'Desvio pela Rua Cuiabá');
await page.keyboard.press('Escape');
console.log('after text', await page.$eval('.tool-active', (e) => e.textContent.trim()), await page.evaluate(() => document.activeElement?.tagName));

// Nova camada com um círculo
await page.click('app-layers-panel button[title="Nova camada"]');
await page.waitForSelector('app-layers-panel li input');
await wait(200);
await page.keyboard.type('Interdição');
await page.keyboard.press('Enter');
await wait(200);
console.log('after rename', await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120)));
await page.keyboard.press('c');
await click(0.8, 0.7);
await click(0.84, 0.75);
console.log('after circle', await page.$eval('.tool-active', (e) => e.textContent.trim()), await page.$$eval('[role=status]', (e) => e.map((x) => x.textContent)));
await page.screenshot({ path: `${OUT}/02a-circulo.png` });
await page.keyboard.press('v');
// Imagem
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('app-toolbar button[title^="Imagem"]')]);
await chooser.setFiles('c:/projetos/croquis-bh/.agents/ref/amostras-bhmap/t_MAPA_BASE.png');
await wait(500);
await click(0.15, 0.85);
await wait(500);
await page.keyboard.press('Escape');
await wait(1200);
await page.screenshot({ path: `${OUT}/02-desenhos.png` });

await page.screenshot({ path: `${OUT}/02b-antes-selecao.png` });
console.log('tool', await page.$eval('.tool-active', (e) => e.textContent.trim()), await page.$$eval('app-layers-panel li', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').trim())));
console.log('pre', await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('croquis-bh:atual')); return [d.view, d.layers.map((l) => l.name + ':' + l.features.features.map((f) => f.properties.kind))]; }));
// Seleciona a seta e mostra propriedades
await click(0.62, 0.635);
await wait(400);
const selectedTitle = await page.textContent('app-properties-panel .panel-title');
const measures = await page.$$eval('app-properties-panel dd', (e) => e.map((x) => x.textContent.trim()));
const layerOptions = await page.$$eval('app-properties-panel select option', (e) => e.map((o) => o.textContent.trim()));
await page.selectOption('app-properties-panel select', { label: 'Interdição' });
await wait(300);
await page.screenshot({ path: `${OUT}/03-selecao.png` });
await page.keyboard.press('Escape');

// Zoom para ver nomes de ruas
const [cx, cy] = at(0.5, 0.5);
await page.mouse.move(cx, cy);
await page.mouse.wheel(0, -400);
await wait(3500);
await page.screenshot({ path: `${OUT}/04-zoom.png` });

// Salvamento local
await wait(1000);
const saved = await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('croquis-bh:atual') ?? 'null');
  return d && d.layers.map((l) => `${l.name}: ${l.features.features.map((f) => f.properties.kind).join(',')}`);
});

// Exporta PNG
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  page.click('header button:has-text("Exportar PNG")'),
]);
await download.saveAs(`${OUT}/05-export.png`);

// Recarrega e confere a restauração
await page.reload({ waitUntil: 'networkidle' });
await wait(2500);
const layersAfterReload = await page.$$eval('app-layers-panel li span.truncate', (e) =>
  e.map((x) => x.textContent.replace(/\s+/g, ' ').trim()),
);

console.log(JSON.stringify({ selectedTitle, measures, layerOptions, saved, layersAfterReload, problems }, null, 1));
await browser.close();
