import { chromium } from 'playwright';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
const shot = async (n) => { await p.waitForTimeout(1500); await p.screenshot({ path: `shots/w-${n}.jpg`, type: 'jpeg', quality: 88 }); console.log('shot', n); };
async function drawerOf(repo, id, tab = 'Landed') {
  await p.goto('https://hivegit.dev/r/' + repo); await p.waitForSelector('text=Trunk'); await p.waitForTimeout(3000);
  await p.locator(`button:has-text("${tab}")`).first().click(); await p.locator(`text=${id}`).first().click();
  const d = p.locator('[aria-label^="Change "]').first(); await d.waitFor(); await p.waitForTimeout(2500);
  await d.locator('button:has-text("Widen")').first().click().catch(() => console.log('no widen')); await p.waitForTimeout(1500);
  return d;
}
async function at(d, text, name, offset = -90) {
  const el = d.locator(`text="${text}"`).first();
  try { await el.scrollIntoViewIfNeeded(); await el.evaluate((e, o) => { let s = e.parentElement; while (s && !(s.scrollHeight > s.clientHeight + 5 && getComputedStyle(s).overflowY !== 'visible')) s = s.parentElement; if (s) s.scrollTop += e.getBoundingClientRect().top - s.getBoundingClientRect().top + o; }, offset); await shot(name); } catch (e) { console.log('miss', name, e.message.split('\n')[0]); }
}
let d = await drawerOf('demo-shop', 'c-74109676f8');
await shot('race-top'); await at(d, 'Evidence', 'race-evidence'); await at(d, 'Landed on trunk', 'race-clef', -300); await at(d, 'Context', 'race-context');
d = await drawerOf('camelcheck', 'c-038e2a6fdd'); await shot('camel-top'); await at(d, 'Evidence', 'camel-evidence'); await at(d, 'Landed on trunk', 'camel-clef', -300);
d = await drawerOf('demo-shop', 'c-3ed0c71ada', 'Needs you'); await shot('needs-top'); await at(d, 'Review', 'needs-review');
d = await drawerOf('camelcheck', 'c-654f202deb'); await shot('scout-top'); await at(d, 'Context', 'scout-context');
await b.close();
