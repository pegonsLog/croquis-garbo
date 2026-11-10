// Screenshot do app num link do BHMap: node.exe shot-link.mjs <saida.png> [zoom]
import { chromium } from 'playwright-core';
const [out = 'c:/projetos/croquis-bh/.agents/screenshots/link.png', zoom = '8'] = process.argv.slice(2);
const link = `https://bhmap.pbh.gov.br/v2/mapa/idebhgeo#zoom=${zoom}&lat=7796089.13353&lon=608484.19834&baselayer=base`;
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
page.on('response', (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.url().slice(0, 120)}`));
await page.goto('http://localhost:4200/', { waitUntil: 'networkidle' });
await page.fill('header input[placeholder^="Cole"]', link);
await page.click('header button[type=submit]');
await page.waitForTimeout(5000);
await page.screenshot({ path: out });
console.log(JSON.stringify({ problems }));
await browser.close();
