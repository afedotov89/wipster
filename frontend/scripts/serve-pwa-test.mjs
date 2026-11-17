// Loopback-only test proxy to real Django API + production static boundary.
// This file is not copied to the production image. Fault controls additionally
// require the same explicit opt-in as the isolated provider fixture.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
const enabled=process.env.WIPSTER_YANDEX_TEST_PROVIDER==='1';
const faults=new Map();
const offlineDevices=new Set();
http.createServer(async(req,res)=>{
 if(req.url==='/__pwa_test_update_sw.js'&&enabled){
  const source=await readFile(new URL('../dist/sw.js',import.meta.url),'utf8');
  res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store','Service-Worker-Allowed':'/'});res.end(source.replace('wipster-shell-','wipster-shell-update-'));return;
 }
 if(req.url==='/__pwa_test_control') {
  if(!enabled||req.method!=='POST'){res.writeHead(404);res.end();return;}
  let text='';for await(const chunk of req){text+=chunk;if(text.length>1024){res.writeHead(413);res.end();return;}}
  try {
   const {account,action,device}=JSON.parse(text);
   if(action==='offline'||action==='online'){
    if(typeof device!=='string')throw Error();
    if(action==='offline')offlineDevices.add(device);else offlineDevices.delete(device);
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{}');return;
   }
   if(typeof account!=='string')throw Error();
   let f=faults.get(account);
   if(action==='dropPush'){f={drop:true,pushes:0,pulls:0};faults.set(account,f);}
   if(action==='holdFirstPull'){f={drop:false,pushes:0,pulls:0,hold:1};faults.set(account,f);}
   if(action==='holdSecondPull'){f={drop:false,pushes:0,pulls:0,hold:2};faults.set(account,f);}
   if(action==='release'){f?.release?.();if(f)f.hold=0;}
   if(action==='clear'){f?.release?.();faults.delete(account);}
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({pushes:f?.pushes??0,pulls:f?.pulls??0,text:f?.text??null,committed:f?.committed??false}));
  }catch{res.writeHead(400);res.end();}return;
 }
 if(enabled&&offlineDevices.has(req.headers['x-pwa-test-device'])){res.destroy();return;}
 const f=faults.get(req.headers['x-wipster-account']);
 const push=req.url==='/api/v1/web/sync/push',pull=req.url?.startsWith('/api/v1/web/sync/pull?');
 const proxy=http.request({hostname:'127.0.0.1',port:18088,path:req.url,method:req.method,headers:req.headers},async r=>{
  if(f&&push&&f.drop){r.resume();r.on('end',()=>{f.committed=r.statusCode===200;f.pushes++;res.destroy();});return;}
  if(f&&pull){f.pulls++;if(f.pulls===f.hold){await new Promise(resolve=>{f.release=resolve;});}}
  if(!res.destroyed){res.writeHead(r.statusCode,r.headers);r.pipe(res);}else r.resume();
 });
 proxy.on('error',()=>{if(!res.destroyed){res.writeHead(502);res.end();}});
 if(f&&push&&f.drop){let text='';req.on('data',chunk=>{text+=chunk;if(text.length<=8*1024*1024)f.text=text;});}
 req.pipe(proxy);
}).listen(18089,'127.0.0.1',()=>console.log('PWA test proxy on loopback 18089'));
