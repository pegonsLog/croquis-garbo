// Testa "prolongar" linha/seta: node.exe extend-check.mjs
import { chromium } from 'playwright-core';
const OUT = 'c:/projetos/croquis-bh/.agents/screenshots';
const LINK =
  'https://bhmap.pbh.gov.br/v2/mapa/idebhgeo#zoom=8&lat=7796089.13353&lon=608484.19834&baselayer=base';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
await page.goto('http://localhost:4200/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.fill('header input[placeholder^="Cole"]', LINK);
await page.click('header button[type=submit]');
await wait(3000);

const box = await page.locator('main').boundingBox();
const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
const click = async (fx, fy, opts) => {
  const [x, y] = at(fx, fy);
  await page.mouse.click(x, y, opts);
  await wait(200);
};
const coords = () =>
  page.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 900));
    const d = JSON.parse(localStorage.getItem('croquis-bh:atual'));
    const f = d.layers[0].features.features[0];
    return { n: f.geometry.coordinates.length, c: f.geometry.coordinates.map((p) => p.map((v) => Math.round(v)).join(',')).join(' | '), inv: f.properties._invertida };
  });
const result = {};

// Seta com 2 pontos
await page.keyboard.press('a');
await click(0.3, 0.6);
await click(0.45, 0.5, { clickCount: 2 });
await page.keyboard.press('v');
result.criada = await coords();

// Seleciona e prolonga pela ponta (+2 pontos)
await click(0.375, 0.55);
await page.click('app-properties-panel button:has-text("Pela ponta")');
result.banner = await page.textContent('main .bg-blue-600 span');
await click(0.6, 0.45);
await click(0.7, 0.3, { clickCount: 2 });
result.pelaPonta = await coords();
result.selecionadaDepois = await page.textContent('app-properties-panel .panel-title');
await page.screenshot({ path: `${OUT}/prolongar-ponta.png` });

// Prolonga pelo início (+1 ponto) e termina com Enter
await page.click('app-properties-panel button:has-text("Pelo início")');
await click(0.2, 0.7);
await page.keyboard.press('Enter');
result.peloInicio = await coords();

// Prolonga e cancela com Esc: não pode mudar
await page.click('app-properties-panel button:has-text("Pela ponta")');
await click(0.8, 0.2);
await page.keyboard.press('Escape');
result.cancelado = await coords();
await page.screenshot({ path: `${OUT}/prolongar-final.png` });

console.log(JSON.stringify({ ...result, problems }, null, 1));
await browser.close();
