import { chromium } from 'playwright';
import fs from 'node:fs';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
const log = {};
const shot = async (name) => { await p.waitForTimeout(1200); await p.screenshot({ path: `shots/${name}.jpg`, type: 'jpeg', quality: 85 }); console.log('shot', name); };
const open = async (r) => { await p.goto('https://hivegit.dev/r/' + r); await p.waitForSelector('text=Trunk', { timeout: 40000 }); await p.waitForTimeout(3000); };
const drawer = () => p.locator('[aria-label^="Change "]').first();
const drawerShots = async (name, n = 4) => {
  await drawer().waitFor({ timeout: 15000 }); await p.waitForTimeout(2500);
  log[name] = await drawer().innerText();
  await shot(name + '-0');
  const box = await drawer().boundingBox();
  for (let i = 1; i < n; i++) { await p.mouse.move(box.x + box.width / 2, 600); await p.mouse.wheel(0, 800); await shot(`${name}-${i}`); }
  await p.keyboard.press('Escape'); await p.waitForTimeout(500);
};
const clickCard = async (text) => { await p.locator(`text=${text}`).first().click(); };
try {
  await open('scale2k'); await shot('scale2k');
  await open('demo-shop'); await shot('demoshop');
  await clickCard('c-3ed0c71ada'); await drawerShots('demoshop-needsyou', 3);
  await p.locator('button:has-text("Landed")').first().click(); await p.waitForTimeout(1000); await shot('demoshop-landed');
  log['demoshop-landed'] = await p.locator('main, body').first().innerText();
  for (const id of ['c-ccf498f2d5', 'c-843ac660db']) { await open('demo-shop'); await p.locator('button:has-text("Landed")').first().click(); await clickCard(id); await drawerShots('demoshop-' + id, 5); }
  await open('demo-shop'); await p.locator('text=History of demo-shop').scrollIntoViewIfNeeded(); await p.mouse.wheel(0, 300); await shot('demoshop-history-list');
  await p.locator('button:has-text("Graph")').first().click(); await p.waitForTimeout(2000); await shot('demoshop-history-graph');
  log['demoshop-history'] = await p.locator('main, body').first().innerText();
  await open('camelcheck'); await shot('camelcheck');
  await p.locator('button:has-text("Landed")').first().click(); await p.waitForTimeout(800);
  for (const id of ['c-038e2a6fdd', 'c-654f202deb']) { try { await clickCard(id); await drawerShots('camel-' + id, 5); } catch (e) { console.log('miss', id, e.message.split('\n')[0]); } }
  await open('camelcheck'); await p.locator('text=Why is this line here?').first().click(); await p.waitForTimeout(1500); await shot('camel-why-open');
  await open('vulnshop'); await shot('vulnshop'); await p.locator('[aria-label="Plan"]').scrollIntoViewIfNeeded().catch(() => {}); await shot('vulnshop-plan');
  log['vulnshop'] = await p.locator('main, body').first().innerText();
  await p.goto('https://hivegit.dev/'); await p.waitForTimeout(4000); await shot('landing-0');
  for (let i = 1; i < 6; i++) { await p.mouse.wheel(0, 1000); await shot('landing-' + i); }
} catch (e) { console.log('ERR', e.message.split('\n')[0]); }
fs.writeFileSync('shots/log.json', JSON.stringify(log, null, 1));
await b.close();
