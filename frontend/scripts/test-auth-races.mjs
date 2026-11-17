// Exact current runtime + real isolated API/PostgreSQL. No Web Locks. Only the
// external provider is the server's fail-closed DEBUG fixture. Never ships in image.
import {createServer,request as httpRequest} from 'node:http';
import {build} from 'esbuild';
import {chromium,webkit} from '@playwright/test';
import {writeFile,mkdir} from 'node:fs/promises';
const out=new URL('../../docs/pwa-evidence/corrections-20261117/',import.meta.url);await mkdir(out,{recursive:true});
const built=await build({stdin:{contents:"export * as r from './src/browser/runtime';export * as d from './src/browser/db';export * as l from './src/browser/sessionLock';",resolveDir:new URL('../',import.meta.url).pathname,loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser'});
const bundle=built.outputFiles[0].text,records=[],holds=[];
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function hold(window,path,phase){const h={window,path,phase,seen:deferred(),gate:deferred(),done:deferred()};holds.push(h);return h;}
const server=createServer(async(req,res)=>{
 if(req.url==='/bundle.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(bundle);return;}
 if(!req.url.startsWith('/api/')){res.end('<!doctype html><title>Isolated auth race verification</title>');return;}
 const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks),window=req.headers['x-test-window'];
 const h=holds.find(h=>!h.used&&h.window===window&&h.path===req.url);if(h){h.used=true;h.seen.resolve();if(h.phase==='before')await h.gate.promise;}
 const proxy=httpRequest({hostname:'127.0.0.1',port:18088,path:req.url,method:req.method,headers:req.headers},async upstream=>{
  const chunks=[];for await(const c of upstream)chunks.push(c);const bytes=Buffer.concat(chunks);
  const rec={window,path:req.url,status:upstream.statusCode,generation:req.headers['x-wipster-auth-generation'],cookies:upstream.headers['set-cookie']??[]};
  try{rec.result=JSON.parse(bytes);}catch{}
  records.push(rec);if(h){h.record=rec;h.done.resolve();if(h.phase==='after')await h.gate.promise;}
  if(!res.destroyed){res.writeHead(upstream.statusCode,upstream.headers);res.end(bytes);}
 });proxy.on('error',()=>{if(!res.destroyed){res.writeHead(502);res.end();}});proxy.end(body);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
function check(value,message){if(!value)throw new Error(message);}
async function setup(engine){
 const browser=await engine.launch();const context=await browser.newContext();await context.addInitScript(()=>Object.defineProperty(navigator,'locks',{value:undefined,configurable:true}));
 const a=await context.newPage(),b=await context.newPage();
 for(const [p,id]of [[a,'A'],[b,'B']]){await p.setExtraHTTPHeaders({'X-Test-Window':id});await p.goto(origin);await p.evaluate(async()=>{Object.assign(window,await import('/bundle.js'));});await p.evaluate(()=>window.r.initialize());}
 return{browser,context,a,b};
}
async function expire(b){await b.evaluate(()=>window.d.control(c=>{if(c.sessionLease)c.sessionLease.expires=0;}));}
async function operation(p,path,body={}){return p.evaluate(async({path,body})=>window.l.sessionLock(async g=>{await window.r.request('session',undefined,undefined,true,g);return window.r.request(path,body,undefined,true,g);}),{path,body});}
async function callback(context,url,subject){const u=new URL(url);const r=await context.request.get(origin+'/api/v1/auth/yandex/callback',{params:{state:u.searchParams.get('state'),code:`native-mock-code:${u.searchParams.get('code_challenge')}:${subject}`}});return r.status();}
const result=[];
try{
 for(const [name,engine]of [['chromium',chromium],['webkit',webkit]]){
  {
   const {browser,context,a,b}=await setup(engine);try{
    await context.clearCookies({name:/^wipster_dev_browser-/});
    const h=hold('A','/api/v1/web/session','after');await a.evaluate(()=>{window.done=window.r.initialize();});await h.done.promise;
    await expire(b);await b.evaluate(()=>window.r.initialize());const fresh=await operation(b,'yandex/start',{device_name:'new bootstrap'});
    h.gate.resolve();await a.evaluate(()=>window.done);
    // Force delivery even if the old fetch was aborted; unlike a single named
    // binding cookie it cannot replace B's credential or server pointer.
    const late=h.record.cookies.filter(x=>x.startsWith('wipster_dev_browser-')).map(x=>{const pair=x.split(';')[0],i=pair.indexOf('=');return{name:pair.slice(0,i),value:pair.slice(i+1),domain:'127.0.0.1',path:'/',httpOnly:true,sameSite:'Strict'};});await context.addCookies(late);
    check(await callback(context,fresh.authorization_url,'69999')===200,'late provision damaged callback');await operation(b,'yandex/finish');
    const boot=await b.evaluate(()=>window.l.sessionLock(g=>window.r.request('session',undefined,undefined,true,g)));check(boot.account,'late provision hid current session');
    result.push({engine:name,case:'late first bootstrap credential',new_account_available:true,pass:true});
   }finally{await browser.close();}
  }
  // Exact original startLogin repro: A is delayed during GET; B owns real IDB
  // lease and has claimed a newer server generation before A can resume.
  {
   const {browser,context,a,b}=await setup(engine);try{
    const h=hold('A','/api/v1/web/session','after');
    await a.evaluate(()=>{window.done=window.r.startLogin().then(()=>({ok:true}),e=>({error:e.message}));});await h.seen.promise;
    await expire(b);await b.evaluate(()=>{window.held=false;window.doneB=window.l.sessionLock(async g=>{await window.r.request('session',undefined,undefined,true,g);await window.r.request('claim',{},undefined,true,g);window.held=true;await new Promise(r=>window.releaseB=r);});});await b.waitForFunction(()=>window.held);
    const before=records.filter(x=>x.window==='A'&&x.path.endsWith('/yandex/start')).length;h.gate.resolve();const value=await a.evaluate(()=>window.done);
    check(value.error,'stale exact startLogin did not fail');check(records.filter(x=>x.window==='A'&&x.path.endsWith('/yandex/start')).length===before,'stale POST dispatched');
    check(!(await(await context.request.get(origin+'/api/v1/web/session')).json()).pending,'stale start changed real pending state');
    await b.evaluate(()=>window.releaseB());await b.evaluate(()=>window.doneB);
    result.push({engine:name,case:'lost lease during bootstrap',stale_start_requests:0,real_pending:false,pass:true});
   }finally{await browser.close();}
  }
  for(const phase of ['before','after']){
   const {browser,context,a,b}=await setup(engine);try{
    const h=hold('A','/api/v1/web/yandex/start',phase);
    await a.evaluate(()=>{window.done=window.l.sessionLock(async g=>{await window.r.request('session',undefined,undefined,true,g);return window.r.request('yandex/start',{device_name:'race A'},undefined,true,g);}).then(x=>({ok:true}),e=>({error:e.message}));});await h.seen.promise;if(phase==='after')await h.done.promise;
    await expire(b);const fresh=await operation(b,'yandex/start',{device_name:'race B'});h.gate.resolve();await h.done.promise;
    check(h.record.status===(phase==='before'?409:200),'unexpected real stale API status');
    if(phase==='after'){
     check(await callback(context,h.record.result.authorization_url,'70001')===400,'replaced attempt still accepts callback');
     // Deliver the real delayed Set-Cookie even if cancellation aborted fetch.
     const late=h.record.cookies.filter(x=>x.startsWith('wipster_dev_pending-')).map(x=>{const pair=x.split(';')[0],i=pair.indexOf('=');return{name:pair.slice(0,i),value:pair.slice(i+1),domain:'127.0.0.1',path:'/',httpOnly:true,sameSite:'Strict'};});
     await context.addCookies(late);
    }
    check(await callback(context,fresh.authorization_url,'70002')===200,'new attempt damaged by stale response');
    await operation(b,'yandex/finish');const boot=await(await context.request.get(origin+'/api/v1/web/session')).json();check(boot.account,'new account unavailable');
    result.push({engine:name,case:phase==='before'?'already dispatched stale start':'late successful start Set-Cookie',real_old_status:h.record.status,new_attempt_callback:200,old_attempt_callback:phase==='after'?400:null,pass:true});
   }finally{await browser.close();}
  }
  {
   const {browser,context,a,b}=await setup(engine);try{
    const fresh=await operation(a,'yandex/start',{device_name:'finish A'});check(await callback(context,fresh.authorization_url,'70003')===200,'prepare finish');
    const h=hold('A','/api/v1/web/yandex/finish','after');await a.evaluate(()=>{window.done=window.l.sessionLock(async g=>{await window.r.request('session',undefined,undefined,true,g);return window.r.request('yandex/finish',{},undefined,true,g);}).then(()=>({ok:true}),e=>({error:e.message}));});await h.done.promise;
    await expire(b);const boot=await(await context.request.get(origin+'/api/v1/web/session')).json();
    // A's session cookie has not arrived: pending proof can cancel the completed
    // attempt and revoke its real DeviceSession, without needing its lost ack.
    await operation(b,'yandex/cancel');const newer=await operation(b,'yandex/start',{device_name:'finish B'});
    h.gate.resolve();await a.evaluate(()=>window.done);
    const late=h.record.cookies.filter(x=>x.startsWith('wipster_dev_session-')).map(x=>{const pair=x.split(';')[0],i=pair.indexOf('=');return{name:pair.slice(0,i),value:pair.slice(i+1),domain:'127.0.0.1',path:'/',httpOnly:true,sameSite:'Strict'};});await context.addCookies(late);
    const noResurrection=await(await context.request.get(origin+'/api/v1/web/session')).json();check(!noResurrection.account&&noResurrection.pending,'old finish resurrected state');
    check(await callback(context,newer.authorization_url,'70004')===200,'new finish attempt callback');await operation(b,'yandex/finish');
    result.push({engine:name,case:'late finish credential after cancellation and new start',old_account_resurrected:false,new_attempt_callback:200,pass:true});
   }finally{await browser.close();}
  }
  for(const target of ['yandex/finish','yandex/cancel','logout']){
   const {browser,context,a,b}=await setup(engine);try{
    const start=await operation(a,'yandex/start',{device_name:'guard '+target});
    if(target!=='yandex/cancel')check(await callback(context,start.authorization_url,'70101')===200,'prepare target callback');
    if(target==='logout')await operation(a,'yandex/finish');
    await a.evaluate(()=>window.r.initialize());
    const path=target==='yandex/finish'?'/api/v1/web/yandex/status':target==='logout'?'/api/v1/web/session':'/api/v1/web/yandex/cancel';
    const h=hold('A',path,target==='yandex/cancel'?'before':'after');
    const before=records.filter(x=>x.window==='A'&&x.path==='/api/v1/web/'+target).length;
    await a.evaluate(target=>{window.done=(target==='logout'?window.r.logout():target==='yandex/cancel'?window.r.cancelLogin():window.r.completeLogin()).then(()=>({ok:true}),e=>({error:e.message}));},target);await h.seen.promise;
    await expire(b);await operation(b,'claim');h.gate.resolve();await h.done.promise;await a.evaluate(()=>window.done);
    const count=records.filter(x=>x.window==='A'&&x.path==='/api/v1/web/'+target).length-before;
    check(target==='yandex/cancel'?h.record.status===409:count===0,'stale '+target+' effect');
    const boot=await(await context.request.get(origin+'/api/v1/web/session')).json();
    check(target==='logout'?!!boot.account:boot.pending&&!boot.account,'real state changed by stale '+target);
    result.push({engine:name,case:'lost lease '+target,stale_target_requests:count,old_status:target==='yandex/cancel'?409:null,real_state_preserved:true,pass:true});
   }finally{await browser.close();}
  }
  {
   const {browser,context,a,b}=await setup(engine);try{
    // Force Django's real CSRF rejection; hold the hidden refresh, not a mock403.
    await context.addCookies([{name:'wipster_csrf_dev',value:'a'.repeat(32),domain:'127.0.0.1',path:'/',httpOnly:true,sameSite:'Strict'}]);
    const h=hold('A','/api/v1/web/session','after');const before=records.filter(x=>x.window==='A'&&x.path.endsWith('/yandex/start')).length;
    await a.evaluate(()=>{window.done=window.l.sessionLock(g=>window.r.request('yandex/start',{device_name:'csrf race'},undefined,true,g)).then(()=>({ok:true}),e=>({error:e.message}));});await h.seen.promise;
    await expire(b);await operation(b,'claim');h.gate.resolve();await a.evaluate(()=>window.done);
    check(records.filter(x=>x.window==='A'&&x.path.endsWith('/yandex/start')).length===before,'CSRF retry sent stale start');
    check(records.some(x=>x.window==='A'&&x.path.endsWith('/claim')&&x.status===403),'real CSRF rejection missing');
    result.push({engine:name,case:'lost lease in hidden CSRF bootstrap/retry',stale_start_requests:0,real_csrf_rejection:403,pass:true});
   }finally{await browser.close();}
  }
 }
 await writeFile(new URL('auth-races.json',out),JSON.stringify({scope:'exact-source runtime, real PostgreSQL/API, two pages, Web Locks disabled; forced lease expiry and real delayed HTTP',cases:result},null,2)+'\n');console.log(`${result.length} auth races passed`);
}finally{for(const h of holds)h.gate.resolve();await new Promise(r=>server.close(r));}
