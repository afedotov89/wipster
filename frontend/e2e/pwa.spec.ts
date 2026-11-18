import {test,expect,type Page,type BrowserContext} from '@playwright/test';
const origin='http://127.0.0.1:18089';
const screenshot=async(page:Page,name:string)=>{
 await page.evaluate(()=>{document.querySelector('#settings-panel')?.scrollTo(0,0);});
 return page.screenshot({path:new URL(`../../docs/pwa-evidence/corrections-20261117/${test.info().project.name}-${name}.png`,import.meta.url).pathname,fullPage:true,animations:'disabled'});
};
test.beforeEach(async({context})=>{
 const device=crypto.randomUUID();await context.setExtraHTTPHeaders({'X-Pwa-Test-Device':device});
 await context.addInitScript((device)=>{
  sessionStorage.setItem('pwa-test-device',device);
  Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>sessionStorage.getItem('pwa-test-offline')!=='1'});
 },device);
});
async function offline(context:BrowserContext,value:boolean) {
 // Each test context carries one unique network-fixture header.
 const page=context.pages()[0];
 const id=await page.evaluate(()=>sessionStorage.getItem('pwa-test-device'));
 if(!id)throw new Error('Missing network fixture identity');
 const response=await context.request.post(origin+'/__pwa_test_control',{data:{device:id,action:value?'offline':'online'}});expect(response.status()).toBe(200);
 for(const p of context.pages())await p.evaluate(v=>{sessionStorage.setItem('pwa-test-offline',v?'1':'0');window.dispatchEvent(new Event(v?'offline':'online'));},value);
}
async function login(page:Page,context:BrowserContext,subject:string) {
  let authorize: URL|undefined;
  await page.route('https://oauth.yandex.ru/authorize?**',async route=>{authorize=new URL(route.request().url());await route.fulfill({contentType:'text/html',body:'<h1>Изолированный тестовый провайдер</h1>'});});
  await page.goto('/');await expect(page.getByRole('button',{name:'Войти с Яндекс ID'})).toBeVisible();
  await page.getByRole('button',{name:'Войти с Яндекс ID'}).click();
  await expect.poll(()=>!!authorize).toBeTruthy();
  expect(authorize!.searchParams.get('redirect_uri')).toBe('https://wipster.fedotovs.net/api/v1/auth/yandex/callback');
  expect(authorize!.searchParams.get('scope')).toBe('login:email');
  // Callback has an entirely separate cookie/storage context, as with Safari.
  const safari=await context.browser()!.newContext();
  const callback=await safari.request.get(origin+'/api/v1/auth/yandex/callback',{params:{state:authorize!.searchParams.get('state')!,code:'native-mock-code:'+authorize!.searchParams.get('code_challenge')+':'+subject}});
  expect(callback.status()).toBe(200);await safari.close();
  await page.goto('/');await expect(page.getByRole('button',{name:'Открыть проекты'})).toBeVisible({timeout:25000});
  await page.unroute('https://oauth.yandex.ru/authorize?**');
}
async function createProject(page:Page,name:string) {
 await page.getByRole('button',{name:'Открыть проекты'}).click();
 await page.getByRole('button',{name:'Создать проект',exact:true}).click();
 await page.getByLabel('Название проекта', {exact:true}).fill(name);
 await page.getByRole('button',{name:'Сохранить',exact:true}).click();
 await expect(page.getByRole('heading',{name})).toBeVisible();
}
async function addTask(page:Page,title:string) {
 await page.getByRole('textbox',{name:/Добавить задачу/}).fill(title);
 await page.getByRole('button',{name:'Добавить',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Название задачи'})).toHaveValue(title);
}
async function account(page:Page) {await page.getByRole('button',{name:'Настройки',exact:true}).click();}
async function focusSync(page:Page,mode:string,afterFirstFocus?:()=>Promise<void>) {
 const syncButton=page.getByRole('button',{name:'Синхронизировать сейчас'});
 const requests:any[]=[];
 const request=(r:any)=>{if(new URL(r.url()).pathname.startsWith('/api/v1/web/'))requests.push({at:Date.now(),event:'request',path:new URL(r.url()).pathname});};
 const response=(r:any)=>{if(new URL(r.url()).pathname.startsWith('/api/v1/web/'))requests.push({at:Date.now(),event:'response',path:new URL(r.url()).pathname,status:r.status()});};
 page.on('request',request);page.on('response',response);
 await syncButton.evaluate(button=>{
  const samples:any[]=[];
  const sample=(event:string)=>{const active=document.activeElement;const css=getComputedStyle(button);samples.push({at:Date.now(),event,enabled:!(button as HTMLButtonElement).disabled,connected:button.isConnected,documentFocus:document.hasFocus(),visibility:document.visibilityState,active:active?.tagName+':'+active?.textContent?.slice(0,80),focused:active===button,focusVisible:button.matches(':focus-visible'),outline:css.outlineStyle,status:button.parentElement?.textContent?.slice(0,160)});if(samples.length>500)samples.shift();};
  const focus=(e:Event)=>sample(e.type+':'+(e.target as Element)?.tagName);
  window.addEventListener('focus',focus,true);window.addEventListener('blur',focus,true);
  const timer=setInterval(()=>sample('poll'),50);sample('start');
  (window as any).__focusDiagnostics={samples,stop:()=>{clearInterval(timer);window.removeEventListener('focus',focus,true);window.removeEventListener('blur',focus,true);sample('end');return samples;}};
 });
 try {
  await page.keyboard.press('Tab');
  // A foreground sync may disable the button between focus() and the check.
  // Chromium then blurs it. Poll the whole enabled/focus/ring state again;
  // a nested 10s toBeFocused wait would consume the outer retry deadline.
  let first=true;
  await expect.poll(async()=>{
   if(await syncButton.isEnabled()){
    await syncButton.focus();
    if(first&&afterFirstFocus){first=false;await afterFirstFocus();}
   }
   return syncButton.evaluate(button=>({enabled:!(button as HTMLButtonElement).disabled,focused:document.activeElement===button,documentFocus:document.hasFocus(),outline:getComputedStyle(button).outlineStyle}));
  },{timeout:10000,message:'idle sync control has keyboard focus and a visible ring'}).toEqual({enabled:true,focused:true,documentFocus:true,outline:'solid'});
 } finally {
  page.off('request',request);page.off('response',response);
  const samples=await page.evaluate(()=>(window as any).__focusDiagnostics.stop());
  const fs=await import('node:fs/promises');await fs.writeFile(new URL(`../../docs/pwa-evidence/corrections-20261117/${test.info().project.name}-${mode}-focus-diagnostics.json`,import.meta.url),JSON.stringify({samples,requests},null,2));
 }
}
async function sync(page:Page) {await account(page);await page.getByRole('button',{name:'Синхронизировать сейчас'}).click();await expect(page.getByText('Все сохранённые изменения отправлены',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Закрыть настройки'}).click();}

test('keyboard focus recovers when foreground sync interrupts the idle focus check',async({page,context})=>{
 await login(page,context,String(Date.now())+'97');await account(page);
 const boot=await(await context.request.get(origin+'/api/v1/web/session')).json();
 const fault=(action:string)=>context.request.post(origin+'/__pwa_test_control',{data:{account:boot.account.account_id,action}});
 await focusSync(page,'busy-recovery',async()=>{
  await fault('holdFirstPull');await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button',{name:'Синхронизировать сейчас'})).toBeDisabled();
  await expect(page.getByText('Синхронизируем…',{exact:true})).toBeVisible();
  await fault('release');await fault('clear');
  await expect(page.getByRole('button',{name:'Синхронизировать сейчас'})).toBeEnabled();
 });
});

test('web settings mark the selected section in both themes at phone widths and large text',async({page,context})=>{
 test.setTimeout(120000);await login(page,context,String(Date.now())+'98');
 const geometry:any[]=[];
 for(const mode of ['dark','light']){
  await page.evaluate(mode=>{localStorage.setItem('wipster-theme-dark','mint');localStorage.setItem('wipster-theme-light','mint-light');localStorage.setItem('wipster-theme-mode',mode);},mode);
  await page.reload();await expect(page.getByRole('button',{name:'Открыть проекты'})).toBeVisible();await account(page);
  for(const [width,scale] of [[390,100],[320,100],[320,200]]){
   await page.setViewportSize({width,height:844});await page.evaluate(scale=>{document.documentElement.style.fontSize=scale+'%';window.dispatchEvent(new Event('resize'));},scale);
   for(const section of ['Общие','Аккаунт','Оформление','Поля']){
    const nav=page.getByRole('navigation',{name:'Разделы настроек'}),button=nav.getByRole('button',{name:section,exact:true});
    await button.click();await expect(button).toHaveAttribute('aria-pressed','true');await expect(nav.locator('[aria-pressed="true"]')).toHaveCount(1);
    await expect(button).toHaveCSS('font-weight','700');await expect(button).toHaveCSS('text-decoration-line','underline');
    for(const other of await nav.locator('[aria-pressed="false"]').all())await expect(other).toHaveCSS('text-decoration-line','none');
    const sizes=await nav.evaluate(nav=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,buttons:[...nav.querySelectorAll('button')].map(b=>({label:b.textContent,selected:b.getAttribute('aria-pressed'),rect:b.getBoundingClientRect().toJSON()}))}));
    expect(sizes.scrollWidth).toBeLessThanOrEqual(width);for(const b of sizes.buttons){expect(b.rect.height).toBeGreaterThanOrEqual(44);expect(b.rect.width).toBeGreaterThanOrEqual(44);expect(b.rect.left).toBeGreaterThanOrEqual(0);expect(b.rect.right).toBeLessThanOrEqual(width);}
    geometry.push({mode,scale,section,...sizes});await screenshot(page,`settings-${mode}-${width}-${scale}-${section}`);
   }
  }
  await page.evaluate(()=>{document.documentElement.style.fontSize='';});await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Закрыть настройки'}).click();
 }
 const fs=await import('node:fs/promises');await fs.writeFile(new URL(`../../docs/pwa-evidence/corrections-20261117/${test.info().project.name}-settings-selection-geometry.json`,import.meta.url),JSON.stringify(geometry,null,2));
});

test('real mobile CRUD, cookie rendezvous, offline reload and second-device synchronization',async({page,context,browser})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='warning')console.log(m.text());});
 await page.goto('/');await expect(page.getByRole('button',{name:'Войти с Яндекс ID'})).toBeVisible();await screenshot(page,'login');
 const subject=String(Date.now())+(test.info().project.name==='webkit'?'2':'1');
 await login(page,context,subject);
 await createProject(page,'Дом и работа');
 await addTask(page,'Подготовить материалы к встрече 🐈');
 await page.getByLabel('Комментарий',{exact:true}).fill('Длинный текст — заметки с телефона. '.repeat(12));
 await page.getByRole('textbox',{name:'Название задачи'}).click();
 await screenshot(page,'editor');
 await page.getByRole('button',{name:'Закрыть',exact:true}).click();
 await screenshot(page,'board');
 await sync(page);
 await page.evaluate(async()=>{await navigator.serviceWorker.ready;});await page.reload();
 await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBeTruthy();
 const priorBoot=await page.evaluate(()=>performance.timeOrigin);
 await offline(context,true);await page.reload();
 await expect(page.getByRole('button',{name:'Открыть проекты'})).toBeVisible();
 expect(await page.evaluate(()=>performance.timeOrigin)).not.toBe(priorBoot);
 // Workspace stays available across a full offline reload.
 await page.getByRole('button',{name:'Открыть проекты'}).click();await page.getByRole('button',{name:'Дом и работа',exact:true}).click();
 await addTask(page,'Добавлено без сети');await page.getByRole('button',{name:'Закрыть',exact:true}).click();
 await account(page);await screenshot(page,'offline');
 await expect(page.getByText('Нет сети',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Закрыть настройки'}).click();
 await offline(context,false);await sync(page);await account(page);await screenshot(page,'account');await page.getByRole('button',{name:'Закрыть настройки'}).click();
 const second=await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true});const phone=await second.newPage();
 await login(phone,second,subject);await account(phone);await phone.getByRole('button',{name:'Синхронизировать сейчас'}).click();
 await expect(phone.getByText('Все сохранённые изменения отправлены',{exact:true})).toBeVisible();await phone.getByRole('button',{name:'Закрыть настройки'}).click();
 await phone.getByRole('button',{name:'Открыть проекты'}).click();await phone.getByRole('button',{name:'Дом и работа',exact:true}).click();
 await expect(phone.getByText('Добавлено без сети',{exact:true})).toBeVisible();
 // Static-only caches, even after auth/sync/offline flow.
 const keys=await page.evaluate(async()=>{const urls:string[]=[];for(const name of await caches.keys())for(const r of await (await caches.open(name)).keys())urls.push(r.url);return urls;});
 expect(keys.length).toBeGreaterThan(5);expect(keys.every(u=>!u.includes('/api')&&!u.includes('?'))).toBeTruthy();
 const db=await page.evaluate(async()=>{const list=await indexedDB.databases();return list.map(d=>d.name);});expect(db.some(n=>n?.startsWith('wipster-account-v1-'))).toBeTruthy();
 expect(errors).toEqual([]);await second.close();
});

async function localState(page:Page) {
 return page.evaluate(async()=>{
   const names=await indexedDB.databases(),name=names.find(x=>x.name?.startsWith('wipster-account-v1-'))?.name;
   if(!name)return null;
   return new Promise<any>((resolve,reject)=>{const r=indexedDB.open(name);r.onsuccess=()=>{const d=r.result,t=d.transaction('state'),q=t.objectStore('state').get('current');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);t.oncomplete=()=>d.close();};r.onerror=()=>reject(r.error);});
 });
}
async function selectProject(page:Page,name:string) {await page.getByRole('button',{name:'Открыть проекты'}).click();await page.getByRole('button',{name,exact:true}).click();}

test('durable lost acknowledgement, multitab, custom fields, conflict and safe account logout',async({page,context,browser})=>{
 test.setTimeout(120000);
 await context.addInitScript(()=>Object.defineProperty(navigator,'locks',{configurable:true,value:undefined}));
 const subject=String(Date.now())+(test.info().project.name==='webkit'?'4':'3');await login(page,context,subject);await createProject(page,'Синхронизация');
 // A real server commit followed by a simulated transport loss. Retry must use
 // the frozen bytes, not manufacture a new operation or overwrite newer edits.
 const id=(await (await context.request.get(origin+'/api/v1/web/session')).json()).account.account_id;
 const fault=async(action:string)=>(await context.request.post(origin+'/__pwa_test_control',{data:{account:id,action}})).json();
 await fault('dropPush');
 await addTask(page,'Потерянный ответ');await page.getByRole('button',{name:'Закрыть',exact:true}).click();
 await account(page);await page.getByRole('button',{name:'Синхронизировать сейчас'}).click();
 await expect.poll(async()=>(await fault('status')).committed).toBeTruthy();
 await expect.poll(async()=>!!(await localState(page))?.batch).toBeTruthy();
 const frozen=(await localState(page)).batch.text;expect(frozen).toBe((await fault('status')).text);
 await page.reload();await expect(page.getByRole('button',{name:'Открыть проекты'})).toBeVisible();
 expect((await localState(page)).batch.text).toBe(frozen);
 await fault('clear');await sync(page);
 expect((await localState(page)).batch).toBeUndefined();
 // Same browser account, a separate installed window/tab. Durable edits are
 // visible there; competing foreground syncs cannot consume the journal twice.
 const tab=await context.newPage();await tab.goto('/');await expect(tab.getByRole('button',{name:'Открыть проекты'})).toBeVisible();
 await selectProject(tab,'Синхронизация');await expect(tab.getByText('Потерянный ответ',{exact:true})).toBeVisible();
 await account(page);await page.getByRole('button',{name:'Поля',exact:true}).click();await page.getByRole('button',{name:'Добавить поле',exact:true}).click();
 await page.getByLabel('Название',{exact:true}).fill('Место встречи');await page.getByRole('button',{name:'Добавить поле',exact:true}).click();
 await page.getByRole('button',{name:'Закрыть настройки'}).click();await selectProject(page,'Синхронизация');
 await page.getByText('Потерянный ответ',{exact:true}).click();
 const custom=page.getByRole('textbox').last();await custom.fill('Кабинет 42');await page.getByRole('textbox',{name:'Название задачи'}).click();
 await page.getByRole('button',{name:'Закрыть',exact:true}).click();await Promise.all([sync(page),sync(tab)]);
 await expect.poll(async()=>{const s=await localState(page);return Object.values(s.entities).some((e:any)=>e.kind==='value'&&e.data?.value===JSON.stringify('Кабинет 42')&&!e.dirty);}).toBeTruthy();
 console.log('custom and multitab complete');
 // Independent device prepares a concurrent task change.
 const second=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const phone=await second.newPage();await login(phone,second,subject);await sync(phone);await selectProject(phone,'Синхронизация');
 await offline(context,true);await page.getByText('Потерянный ответ',{exact:true}).click();await page.getByRole('textbox',{name:'Название задачи'}).fill('Моя версия');await page.getByRole('button',{name:'Закрыть',exact:true}).click();
 await phone.getByText('Потерянный ответ',{exact:true}).click();await phone.getByRole('textbox',{name:'Название задачи'}).fill('Версия телефона');await phone.getByRole('button',{name:'Закрыть',exact:true}).click();await sync(phone);
 await offline(context,false);await account(page);await page.getByRole('button',{name:'Синхронизировать сейчас'}).click();
 await expect(page.getByText(/На другом устройстве появились изменения/)).toBeVisible();await expect(page.getByRole('button',{name:'Синхронизировать сейчас'})).toBeEnabled();await screenshot(page,'conflict');
 expect(Object.values((await localState(page)).entities).some((e:any)=>e.kind==='task'&&e.data?.title==='Моя версия')).toBeTruthy();
 await page.getByRole('button',{name:'Использовать данные из облака'}).click();await expect(page.getByText('Все сохранённые изменения отправлены',{exact:true})).toBeVisible();
 expect((await localState(page)).recovery.length).toBeGreaterThan(0);
 await page.getByRole('button',{name:'Закрыть настройки'}).click();await expect(page.getByText('Версия телефона',{exact:true})).toBeVisible();
 console.log('conflict resolved');
 // Storage failure is injected at the real persistence boundary. No synthetic
 // success: the entity must be absent until the user retries the same draft.
 await page.evaluate(()=>{const original=IDBObjectStore.prototype.put;let fail=true;IDBObjectStore.prototype.put=function(...args:any[]){if(fail&&this.transaction.db.name.startsWith('wipster-account-')&&Object.values(args[0]?.entities??{}).some((e:any)=>e.data?.title==='После ошибки места')){fail=false;throw new DOMException('quota fixture','QuotaExceededError');}return original.apply(this,args as [any,IDBValidKey?]);};});
 await page.getByRole('textbox',{name:/Добавить задачу/}).fill('После ошибки места');await page.getByRole('button',{name:'Добавить',exact:true}).click();
 await expect(page.getByText(/Не удалось сохранить данные на устройстве/)).toBeVisible();await screenshot(page,'storage-error');
 expect(Object.values((await localState(page)).entities).some((e:any)=>e.data?.title==='После ошибки места')).toBeFalsy();
 await page.getByRole('button',{name:'Добавить',exact:true}).click();await expect(page.getByRole('textbox',{name:'Название задачи'})).toHaveValue('После ошибки места');await page.getByRole('button',{name:'Закрыть',exact:true}).click();
 await offline(context,true);await account(page);await page.getByRole('button',{name:'Выйти из аккаунта',exact:true}).click();await page.getByRole('button',{name:'Выйти, сохранив работу'}).click();
 await expect(page.getByRole('button',{name:'Войти с Яндекс ID'})).toBeVisible();
 expect(Object.values((await localState(page)).entities).some((e:any)=>e.data?.title==='После ошибки места')).toBeTruthy();
 await expect(tab.getByRole('button',{name:'Войти с Яндекс ID'})).toBeVisible();
 await offline(context,false);await page.reload();await expect(page.getByRole('button',{name:'Войти с Яндекс ID'})).toBeVisible();
 // Different account must never see the retained partition or previous store.
 await login(page,context,subject+'8');await page.getByRole('button',{name:'Открыть проекты'}).click();
 await expect(page.getByText('Создайте первый проект, чтобы добавить задачи.')).toBeVisible();
 await expect(page.getByRole('button',{name:'Синхронизация',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Закрыть проекты'}).click();
 await account(page);await page.getByRole('button',{name:'Выйти из аккаунта',exact:true}).click();await page.getByRole('button',{name:'Выйти, сохранив работу'}).click();
 await expect(page.getByRole('button',{name:'Войти с Яндекс ID'})).toBeVisible();
 // Reauthenticate original Yandex identity; only its retained work resumes.
 await login(page,context,subject);await sync(page);await selectProject(page,'Синхронизация');
 await expect(page.getByText('После ошибки места',{exact:true})).toBeVisible();
 // A response from the old epoch is held until after logout. It must not
 // repopulate stores, even while another installed window is still open.
 await fault('holdFirstPull');await account(page);await page.getByRole('button',{name:'Синхронизировать сейчас'}).click();
 await expect.poll(async()=>(await fault('status')).pulls).toBeGreaterThanOrEqual(1);
 await page.getByRole('button',{name:'Выйти из аккаунта',exact:true}).click();await page.getByRole('button',{name:'Выйти, сохранив работу'}).click();
 await expect(page.getByRole('button',{name:'Войти с Яндекс ID'})).toBeVisible();await fault('release');await fault('clear');
 await page.reload();await expect(page.getByRole('button',{name:'Войти с Яндекс ID'})).toBeVisible();
 console.log('late-reply tab state',await tab.locator('body').innerText());
 await expect(tab.getByRole('button',{name:'Войти с Яндекс ID'})).toBeVisible();
 await second.close();await tab.close();
});

test('responsive full screens and geometry across phone, tablet and desktop',async({page,context})=>{
 const subject=String(Date.now())+(test.info().project.name==='webkit'?'6':'5');await login(page,context,subject);
 await page.getByRole('button',{name:'Открыть проекты'}).click();await expect.poll(()=>page.getByRole('button',{name:'Создать проект',exact:true}).evaluate(e=>e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);await screenshot(page,'empty');await page.getByRole('button',{name:'Закрыть проекты'}).click();
 await createProject(page,'Очень длинное название проекта: семейные и рабочие планы на следующую неделю');
 await addTask(page,'Длинная задача с подробным названием, которое переносится на несколько строк и остаётся доступным');
 await page.getByRole('button',{name:'Закрыть',exact:true}).click();
 const measurements=[];
 for(const width of [320,390,430,768,1440]){
  await page.setViewportSize({width,height:900});
  // Wait for React/MUI matchMedia before measuring the new breakpoint.
  await expect(page.getByRole('tab',{name:/Очередь/})).toHaveCount(width<900?1:0);
  await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>window.dispatchEvent(new Event('resize')));
  if(width<900)await expect.poll(()=>page.evaluate(()=>{const t=document.querySelector('[role=tab][aria-selected=true]')!.getBoundingClientRect(),i=document.querySelector('.MuiTabs-indicator')!.getBoundingClientRect();return Math.max(Math.abs(t.x-i.x),Math.abs(t.width-i.width));})).toBeLessThanOrEqual(0.05);
  const value=await page.evaluate(()=>({tab:document.querySelector('[role=tab][aria-selected=true]')?.getBoundingClientRect().toJSON(),indicator:document.querySelector('.MuiTabs-indicator')?.getBoundingClientRect().toJSON(),viewport:innerWidth,page:document.documentElement.scrollWidth,header:document.querySelector('header')?.getBoundingClientRect().toJSON(),task:document.querySelector('[data-task-card]')?.getBoundingClientRect().toJSON()}));
  expect(value.page).toBeLessThanOrEqual(width+1);measurements.push({width,...value});
  await screenshot(page,'board-'+width);
 }
 await page.setViewportSize({width:320,height:700});await account(page);await page.getByRole('button',{name:'Поля',exact:true}).click();
 await screenshot(page,'fields-320');expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
 await page.getByRole('button',{name:'Закрыть настройки'}).click();
 await page.getByText('Длинная задача с подробным названием, которое переносится на несколько строк и остаётся доступным',{exact:true}).click();
 await page.getByRole('textbox',{name:'Название задачи'}).click();await screenshot(page,'editor-320');
 const groups=[];
 for(const width of [320,390,430]){
  await page.setViewportSize({width,height:900});await page.locator('.web-priority').scrollIntoViewIfNeeded();
  const data=await page.locator('.web-choice-grid').evaluateAll(els=>els.map(e=>({name:e.className,rect:e.getBoundingClientRect().toJSON(),cells:[...e.querySelectorAll('button')].map(b=>({rect:b.getBoundingClientRect().toJSON(),margin:getComputedStyle(b).margin,borderRadius:getComputedStyle(b).borderRadius}))})));
  for(const g of data){expect(g.rect.x).toBe(16);expect(g.cells[0].rect.x).toBe(g.rect.x);const widths=g.cells.map(c=>c.rect.width),heights=g.cells.map(c=>c.rect.height);expect(Math.max(...widths)-Math.min(...widths)).toBeLessThanOrEqual(1);expect(Math.max(...heights)-Math.min(...heights)).toBeLessThanOrEqual(1);for(const c of g.cells){expect(c.margin).toBe('0px');expect(c.borderRadius).toBe('8px');}}
  groups.push({width,data});await screenshot(page,'editor-grid-'+width);
 }
 await page.setViewportSize({width:320,height:700});
 const fsGroups=await import('node:fs/promises');await fsGroups.writeFile(new URL(`../../docs/pwa-evidence/corrections-20261117/${test.info().project.name}-choice-geometry.json`,import.meta.url),JSON.stringify(groups,null,2));
 await page.evaluate(()=>{document.documentElement.style.fontSize='200%';window.dispatchEvent(new Event('resize'));});
 await expect.poll(()=>page.getByRole('textbox',{name:'Название задачи'}).evaluate(e=>e.scrollHeight-e.clientHeight)).toBeLessThanOrEqual(1);
 await screenshot(page,'text-200');
 await page.locator('.web-priority').scrollIntoViewIfNeeded();await screenshot(page,'priority-200');await page.locator('.web-energy').scrollIntoViewIfNeeded();await screenshot(page,'energy-200');
 await page.getByRole('textbox',{name:'Название задачи'}).focus();
 const close=page.getByRole('button',{name:'Закрыть',exact:true});await expect(close).toBeInViewport();
 const panel=await page.locator('.web-task-panel').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth}));expect(panel.scroll).toBeLessThanOrEqual(panel.width+1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
 await page.evaluate(()=>{document.documentElement.style.fontSize='';});
 await page.setViewportSize({width:390,height:420});await page.getByRole('textbox',{name:'Название задачи'}).focus();await screenshot(page,'keyboard-height');
 await expect(page.getByRole('button',{name:'Закрыть',exact:true})).toBeInViewport();
 await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBeTruthy();
 const boot=await page.evaluate(()=>performance.timeOrigin);
 await page.getByRole('textbox',{name:'Название задачи'}).fill('Незавершённый текст перед обновлением');
 await page.evaluate(()=>navigator.serviceWorker.register('/__pwa_test_update_sw.js',{scope:'/'}));
 await expect(page.getByText(/Доступно обновление. Завершите редактирование/)).toBeVisible();
 await expect(page.getByRole('textbox',{name:'Название задачи'})).toHaveValue('Незавершённый текст перед обновлением');
 expect(await page.evaluate(()=>performance.timeOrigin)).toBe(boot);await screenshot(page,'update-draft');
 await test.info().attach('geometry',{body:JSON.stringify(measurements,null,2),contentType:'application/json'});
 const fs=await import('node:fs/promises');await fs.writeFile(new URL(`../../docs/pwa-evidence/corrections-20261117/${test.info().project.name}-geometry.json`,import.meta.url),JSON.stringify(measurements,null,2));
});

async function pushFixture(context:BrowserContext,operations:any[]) {
 const boot=await (await context.request.get(origin+'/api/v1/web/session')).json();
 const r=await context.request.post(origin+'/api/v1/web/sync/push',{headers:{Origin:origin,'X-CSRFToken':boot.csrf,'X-Wipster-Account':boot.account.account_id},data:{batch_id:crypto.randomUUID(),operations}});
 expect(r.status()).toBe(200);return r.json();
}

test('touch WIP swap, task ordering, archive, deletion and project hierarchy',async({page,context})=>{
 await login(page,context,String(Date.now())+'71');await createProject(page,'Семья');
 await page.getByRole('button',{name:'Открыть проекты'}).click();await page.getByRole('button',{name:'Создать проект',exact:true}).click();
 await page.getByLabel('Название проекта',{exact:true}).fill('Покупки');await page.getByLabel('Родительский проект').click();await page.getByRole('option',{name:'Семья',exact:true}).click();await page.getByRole('button',{name:'Сохранить',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Покупки',exact:true})).toBeVisible();
 for(const name of ['Первая','Вторая']){await addTask(page,name);await page.getByRole('button',{name:'Закрыть',exact:true}).click();}
 await page.getByRole('button',{name:'Действия: Вторая'}).click();await page.getByRole('menuitem',{name:'Выше',exact:true}).click();
 await expect.poll(async()=>{const s=await localState(page);const t=Object.values(s.entities).filter((e:any)=>e.kind==='task').sort((a:any,b:any)=>a.data.position-b.data.position);return (t[0] as any).data.title;}).toBe('Вторая');
 await account(page);await page.getByRole('button',{name:'Общие',exact:true}).click();await page.getByRole('button',{name:'Задач в работе одновременно',exact:true}).first().click();await page.getByRole('button',{name:'Задач в работе одновременно',exact:true}).first().click();await page.getByRole('button',{name:'Закрыть настройки'}).click();
 await page.getByRole('button',{name:'Первая',exact:true}).getByRole('button',{name:'Начать задачу'}).click();
 await page.getByRole('button',{name:'Вторая',exact:true}).getByRole('button',{name:'Начать задачу'}).click();
 await expect(page.getByRole('dialog')).toContainText('Лимит WIP достигнут');await screenshot(page,'wip-swap');await page.getByRole('dialog').getByRole('button',{name:'Первая',exact:true}).click();
 await page.getByRole('tab',{name:/В работе/}).click();await expect(page.getByText('Вторая',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Завершить задачу'}).click();
 await page.getByRole('tab',{name:/Готово/}).click();await page.getByRole('button',{name:'Действия: Вторая'}).click();await page.getByRole('menuitem',{name:'В архив',exact:true}).click();
 await page.getByRole('button',{name:'Открыть проекты'}).click();await page.getByRole('button',{name:'Архив',exact:true}).click();await expect(page.getByText('Вторая',{exact:true})).toBeVisible();
 await page.getByTitle('Вернуть').click();await expect(page.getByText('Вторая',{exact:true})).toHaveCount(0);
 await selectProject(page,'Покупки');await page.getByRole('tab',{name:/Очередь/}).click();await page.getByRole('button',{name:'Действия: Первая'}).click();await page.getByRole('menuitem',{name:'Удалить',exact:true}).click();
 await expect(page.getByText('Первая',{exact:true})).toHaveCount(0);await sync(page);
 const s=await localState(page);expect(Object.values(s.entities).some((e:any)=>e.kind==='task'&&e.data===null&&!e.dirty)).toBeTruthy();
});

test('paged Unicode feed is staged atomically and remote deletion preserves an open draft',async({page,context})=>{
 test.setTimeout(90000);await login(page,context,String(Date.now())+'81');await createProject(page,'Большой проект');await addTask(page,'Открытый черновик');await page.getByRole('button',{name:'Закрыть',exact:true}).click();await sync(page);
 const state=await localState(page),source:any=Object.values(state.entities).find((e:any)=>e.kind==='task');
 const operations=Array.from({length:220},(_,i)=>{const id=crypto.randomUUID();return {kind:'task',id,base_version:0,data:{...source.data,id,title:`Строка ${i} 🐈`,comment:'Большой UTF-8 текст 🐈 '.repeat(200),position:i+10}};});
 const oldCursor=state.cursor;
 const id=(await (await context.request.get(origin+'/api/v1/web/session')).json()).account.account_id;
 const fault=async(action:string)=>(await context.request.post(origin+'/__pwa_test_control',{data:{account:id,action}})).json();
 await fault('holdSecondPull');
 await pushFixture(context,operations);await account(page);await page.getByRole('button',{name:'Синхронизировать сейчас'}).click();
 await expect.poll(async()=>(await fault('status')).pulls).toBeGreaterThanOrEqual(2);const staged=await localState(page);expect(staged.cursor).toBe(oldCursor);expect(staged.stagedCursor).toBeGreaterThan(oldCursor);expect(Object.keys(staged.entities).length).toBe(Object.keys(state.entities).length);
 await fault('release');await expect(page.getByText('Все сохранённые изменения отправлены',{exact:true})).toBeVisible();await fault('clear');
 await expect.poll(async()=>Object.values((await localState(page)).entities).filter((e:any)=>e.kind==='task').length).toBe(221);
 await page.getByRole('button',{name:'Закрыть настройки'}).click();await page.getByText('Открытый черновик',{exact:true}).click();
 const title=page.getByRole('textbox',{name:'Название задачи'});await title.fill('Мой несохранённый текст');
 // The incoming tombstone is real. Typing has been journaled separately from
 // committed entities, so pulling must not silently erase the open editor.
 await pushFixture(context,[{kind:'task',id:source.id,base_version:source.version,data:null}]);
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.getByText(/Задача удалена. Черновики остаются/)).toBeVisible();await expect(title).toHaveValue('Мой несохранённый текст');await screenshot(page,'deleted-draft');
 await page.reload();await expect(page.getByRole('button',{name:'Открыть проекты'})).toBeVisible();
 const saved=await localState(page);expect(Object.values(saved.settings).some((v:any)=>String(v).includes('Мой несохранённый текст'))).toBeTruthy();
});


test('accessible populated checklist persists and syncs with touch and keyboard',async({page,context})=>{
 test.setTimeout(120000);await login(page,context,String(Date.now())+'91');await createProject(page,'План проверки');await addTask(page,'Чек-лист с телефона');
 for(const name of ['Собрать материалы','Проверить результат','Отправить']){await page.getByLabel('Новый шаг',{exact:true}).fill(name);await page.getByRole('button',{name:'Добавить шаг',exact:true}).click();await expect(page.getByText(name,{exact:true})).toBeVisible();}
 await page.getByRole('checkbox',{name:/Выполнен шаг 1:/}).check();
 await page.getByRole('button',{name:'Изменить шаг 1',exact:true}).click();await page.getByLabel('Текст шага 1',{exact:true}).fill('Материалы собраны');await page.getByLabel('Текст шага 1',{exact:true}).press('Enter');
 await page.getByRole('button',{name:'Шаг 3 выше',exact:true}).click();await page.getByRole('button',{name:'Шаг 2 выше',exact:true}).click();
 await expect(page.locator('.web-checklist-row').first()).toContainText('Отправить');
 await page.getByRole('button',{name:'Шаг 1 ниже',exact:true}).focus();await page.getByRole('button',{name:'Шаг 1 ниже',exact:true}).press('Enter');await expect(page.locator('.web-checklist-row').nth(1)).toContainText('Отправить');await page.getByRole('button',{name:'Шаг 2 выше',exact:true}).press('Enter');
 await page.getByRole('button',{name:'Удалить шаг 3',exact:true}).click();await expect(page.locator('.web-checklist-row')).toHaveCount(2);
 const checkbox=page.getByRole('checkbox',{name:/Выполнен шаг 1:/});await checkbox.focus();await checkbox.press('Space');await expect(checkbox).toBeChecked();
 await page.getByRole('button',{name:'Изменить шаг 2',exact:true}).click();await page.getByLabel('Текст шага 2',{exact:true}).fill('Несохранённый ввод');await page.getByLabel('Текст шага 2',{exact:true}).press('Escape');await expect(page.getByRole('button',{name:'Закрыть',exact:true})).toBeVisible();await expect(page.locator('.web-checklist-row').nth(1)).toContainText('Материалы собраны');
 await page.getByRole('button',{name:'Закрыть',exact:true}).click();await sync(page);await page.reload();await expect(page.getByRole('button',{name:'Открыть проекты'})).toBeVisible();await selectProject(page,'План проверки');await page.getByText('Чек-лист с телефона',{exact:true}).click();
 await expect(page.locator('.web-checklist-row')).toHaveCount(2);await expect(page.getByRole('checkbox',{name:/Выполнен шаг 1:/})).toBeChecked();
 const boot=await(await context.request.get(origin+'/api/v1/web/session')).json();const remote=await(await context.request.get(origin+'/api/v1/web/sync/pull',{headers:{'X-Wipster-Account':boot.account.account_id}})).json();const task=remote.changes.find((c:any)=>c.kind==='task'&&c.data?.title==='Чек-лист с телефона');expect(JSON.parse(task.data.checklist)).toEqual([{text:'Отправить',done:true},{text:'Материалы собраны',done:true}]);
 const measures=[];
 for(const width of [320,390,430]){await page.setViewportSize({width,height:900});await page.getByLabel('Новый шаг',{exact:true}).scrollIntoViewIfNeeded();await screenshot(page,'checklist-'+width);measures.push(await page.locator('.web-checklist').evaluate(e=>({width:innerWidth,rows:[...e.querySelectorAll('li')].map(r=>({rect:r.getBoundingClientRect().toJSON(),controls:[...r.querySelectorAll('button,.MuiCheckbox-root')].map(b=>b.getBoundingClientRect().toJSON())}))})));}
 await page.setViewportSize({width:320,height:700});await page.evaluate(()=>{document.documentElement.style.fontSize='200%';window.dispatchEvent(new Event('resize'));});await page.getByLabel('Новый шаг',{exact:true}).scrollIntoViewIfNeeded();await screenshot(page,'checklist-200');
 for(let i=0;i<2;i++){await page.locator('.web-checklist-row').nth(i).evaluate(e=>e.scrollIntoView({block:'center'}));await screenshot(page,'checklist-200-row-'+(i+1));}
 await page.evaluate(()=>{document.documentElement.style.fontSize='';window.dispatchEvent(new Event('resize'));});await page.setViewportSize({width:390,height:420});await page.getByLabel('Новый шаг',{exact:true}).focus();await screenshot(page,'checklist-keyboard-height');
 for(const m of measures)for(const r of m.rows)for(const c of r.controls){expect(c.width).toBeGreaterThanOrEqual(44);expect(c.height).toBeGreaterThanOrEqual(44);}
 const fs=await import('node:fs/promises');await fs.writeFile(new URL(`../../docs/pwa-evidence/corrections-20261117/${test.info().project.name}-checklist-geometry.json`,import.meta.url),JSON.stringify(measures,null,2));
 // A real incoming checklist update must retain the local row edit and require
 // explicit CAS resolution; local drafts must survive reload and deletion.
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Изменить шаг 2',exact:true}).click();await page.getByLabel('Текст шага 2',{exact:true}).fill('Локальный текст шага');
 let source:any=Object.values((await localState(page)).entities).find((e:any)=>e.kind==='task');
 await pushFixture(context,[{kind:'task',id:source.id,base_version:source.version,data:{...source.data,checklist:JSON.stringify([{text:'Облачный шаг',done:false}])}}]);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.getByText(/Шаги: Поле обновилось/)).toBeVisible();await expect(page.getByLabel('Текст шага 2',{exact:true})).toHaveValue('Локальный текст шага');await page.getByRole('button',{name:'Сохранить шаг',exact:true}).click();
 const cloud=await(await context.request.get(origin+'/api/v1/web/sync/pull',{headers:{'X-Wipster-Account':boot.account.account_id}})).json();expect(cloud.changes.filter((c:any)=>c.kind==='task'&&c.id===source.id).sort((a:any,b:any)=>b.version-a.version)[0].data.checklist).toContain('Облачный шаг');
 await screenshot(page,'checklist-incoming-conflict');await page.reload();await expect(page.getByText('Локальный текст шага',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Изменить шаг 2',exact:true}).click();await page.getByLabel('Текст шага 2',{exact:true}).fill('Черновик после удаления');
 source=Object.values((await localState(page)).entities).find((e:any)=>e.kind==='task');await pushFixture(context,[{kind:'task',id:source.id,base_version:source.version,data:null}]);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.getByText(/Задача удалена. Черновики остаются/)).toBeVisible();await expect(page.getByLabel('Текст шага 2',{exact:true})).toHaveValue('Черновик после удаления');await screenshot(page,'checklist-deleted-draft');
 await expect.poll(async()=>Object.values((await localState(page)).settings).some((v:any)=>String(v).includes('Черновик после удаления'))).toBeTruthy();

});

test('web control contrast in dark mint and light mint across account offline and conflict',async({page,context})=>{
 test.setTimeout(120000);await login(page,context,String(Date.now())+'96');await createProject(page,'Контраст');await addTask(page,'Проверка контраста');await page.getByRole('button',{name:'Закрыть',exact:true}).click();await sync(page);
 const samples:any[]=[];
 async function capture(theme:string,state:string){
  if(state==='offline-200')await page.getByRole('button',{name:'Синхронизировать сейчас'}).scrollIntoViewIfNeeded();
  const measure=()=>page.locator('button,a').evaluateAll(els=>els.filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height&&r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight&&getComputedStyle(e).visibility==='visible'&&!e.hasAttribute('disabled')&&e.textContent?.trim();}).map(e=>{const css=getComputedStyle(e),r=e.getBoundingClientRect();let opacity=1;for(let p:Element|null=e;p;p=p.parentElement)opacity*=+getComputedStyle(p).opacity;return {label:e.textContent!.trim(),foreground:css.color,opacity,rect:r.toJSON(),selected:e.getAttribute('aria-selected'),focus:getComputedStyle(e).outlineStyle};}));
  let controls=await measure(),stable=false;
  for(let attempt=0;attempt<4;attempt++){
   controls=await measure();
  await page.screenshot({path:new URL(`../../docs/pwa-evidence/corrections-20261117/${test.info().project.name}-${theme}-${state}.png`,import.meta.url).pathname,fullPage:true,animations:'disabled'});
   const after=await measure();if(JSON.stringify(after)===JSON.stringify(controls)){stable=true;break;}
  }
  expect(stable,'screenshot and DOM measurements must describe the same settled layout').toBeTruthy();
  samples.push({theme,state,file:`${test.info().project.name}-${theme}-${state}.png`,controls});
 }
 for(const mode of ['dark','light']){
  await page.evaluate(mode=>{localStorage.setItem('wipster-theme-dark','mint');localStorage.setItem('wipster-theme-light','mint-light');localStorage.setItem('wipster-theme-mode',mode);},mode);await page.reload();await expect(page.getByRole('button',{name:'Открыть проекты'})).toBeVisible();await selectProject(page,'Контраст');await capture(mode,'navigation');
  await account(page);await capture(mode,'account');
  const syncButton=page.getByRole('button',{name:'Синхронизировать сейчас'});await focusSync(page,mode);await capture(mode,'account-focus');
  const boot=await(await context.request.get(origin+'/api/v1/web/session')).json();const fault=async(action:string)=>context.request.post(origin+'/__pwa_test_control',{data:{account:boot.account.account_id,action}});await fault('holdFirstPull');await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(syncButton).toBeDisabled();await capture(mode,'account-busy');await fault('release');await fault('clear');await expect(syncButton).toBeEnabled();
  await offline(context,true);await page.getByRole('button',{name:'Синхронизировать сейчас'}).click();await expect(page.locator('#settings-panel .MuiAlert-root')).toBeVisible();await expect(page.getByRole('button',{name:'Синхронизировать сейчас'})).toBeEnabled();await page.evaluate(()=>{document.documentElement.style.fontSize='200%';window.dispatchEvent(new Event('resize'));});await capture(mode,'offline-200');await page.evaluate(()=>{document.documentElement.style.fontSize='';window.dispatchEvent(new Event('resize'));});await offline(context,false);
  await page.getByRole('button',{name:'Закрыть настройки'}).click();await page.getByText('Проверка контраста',{exact:true}).click();
  await page.locator('.web-priority button').first().click();await page.locator('.web-energy button').last().click();await page.locator('.web-priority').scrollIntoViewIfNeeded();await capture(mode,'editor-controls');
  const saved=await localState(page),task:any=Object.values(saved.entities).find((e:any)=>e.kind==='task');await page.getByRole('textbox',{name:'Название задачи'}).fill('Моя версия контраста');await page.getByRole('button',{name:'Закрыть',exact:true}).click();
  await pushFixture(context,[{kind:'task',id:task.id,base_version:task.version,data:{...task.data,title:'Проверка контраста'}}]);await account(page);await page.getByRole('button',{name:'Синхронизировать сейчас'}).click();await expect(page.getByText(/На другом устройстве появились изменения/)).toBeVisible();await capture(mode,'conflict');
  await page.getByRole('button',{name:'Использовать данные из облака'}).click();await expect(page.getByText('Все сохранённые изменения отправлены',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Закрыть настройки'}).click();
 }
 const fs=await import('node:fs/promises');await fs.writeFile(new URL(`../../docs/pwa-evidence/corrections-20261117/${test.info().project.name}-contrast-samples.json`,import.meta.url),JSON.stringify(samples,null,2));
});
