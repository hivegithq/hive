import { chromium } from 'playwright';
import fs from 'node:fs';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
const shot = async (n) => { await p.waitForTimeout(1200); await p.screenshot({ path: `shots/${n}.jpg`, type: 'jpeg', quality: 85 }); };
await p.goto('https://hivegit.dev/r/demo-shop'); await p.waitForSelector('text=Trunk'); await p.waitForTimeout(3000);
await p.locator('button:has-text("Landed")').first().click(); await p.locator('text=c-74109676f8').first().click();
const d = p.locator('[aria-label^="Change "]').first(); await d.waitFor(); await p.waitForTimeout(3000);
const txt = await d.innerText(); fs.writeFileSync('shots/race.txt', txt);
const box = await d.boundingBox();
for (let i = 0; i < 7; i++) { await shot('race-' + i); await p.mouse.move(box.x + box.width / 2, 600); await p.mouse.wheel(0, 800); }
await b.close();
