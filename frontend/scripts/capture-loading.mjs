// Actual loading UI while the real bootstrap request is held, no fake response.
import { chromium, webkit, expect } from '@playwright/test';
for (const [name,engine] of [['chromium',chromium],['webkit',webkit]]) {
 const browser=await engine.launch();
 try {
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage();let release;const gate=new Promise(r=>release=r);
  await page.route('**/api/v1/web/session',async r=>{await gate;await r.continue();});
  await page.goto('http://127.0.0.1:18089/');
  await expect(page.getByText('Открываем Wipster…',{exact:true})).toBeVisible();
  await page.screenshot({path:new URL(`../../docs/pwa-evidence/corrections-20261117/${name}-loading.png`,import.meta.url).pathname,fullPage:true});
  release();await expect(page.getByRole('button',{name:'Войти с Яндекс ID'})).toBeVisible();
  console.log(`${name}: loading screen and bootstrap completion PASS`);
 }finally{await browser.close();}
}
