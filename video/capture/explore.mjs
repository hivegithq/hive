import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
for (const r of process.argv.slice(2)) {
  await p.goto('https://hivegit.dev/r/' + r);
  await p.waitForSelector('text=Trunk', { timeout: 30000 });
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `shots/explore-${r}.jpg`, type: 'jpeg', quality: 70 });
  console.log('=== ' + r + '\n' + (await p.locator('main, body').first().innerText()).slice(0, 1200));
}
await b.close();
