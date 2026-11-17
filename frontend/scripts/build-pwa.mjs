import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../dist/',import.meta.url);
const assets = (await readdir(new URL('assets/',root))).map(x=>'/assets/'+x);
const paths=['/index.html','/manifest.webmanifest','/icons/icon-192.png','/icons/icon-512.png','/icons/maskable-512.png','/icons/apple-touch-icon.png',...assets];
const hash=createHash('sha256');for(const path of paths)hash.update(await readFile(new URL('.'+path,root)));
const version=hash.digest('hex').slice(0,20);
await writeFile(new URL('sw.js',root),`/* Wipster immutable shell ${version}. No API/auth caching. */
const CACHE='wipster-shell-${version}';
const FILES=${JSON.stringify(paths)};
const ALLOWED=new Set(FILES);
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));
// Keep caches for old open clients and independent frontend rollback. No forced activation.
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
 const r=event.request,u=new URL(r.url);
 if(r.method!=='GET'||u.origin!==self.location.origin||u.search||r.headers.has('Authorization'))return;
 if(ALLOWED.has(u.pathname)){
   event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(u.pathname))||fetch(r)));
   return;
 }
 // Root is the only shell document route. Deep links use a fragment, never an OAuth query.
 if(r.mode==='navigate'&&u.pathname==='/')event.respondWith(caches.open(CACHE).then(cache=>cache.match('/index.html')).then(hit=>hit||fetch(r)));
});
`);
await writeFile(new URL('pwa-build.json',root),JSON.stringify({shell:version,files:paths},null,2)+'\n');
console.log('PWA shell',version,paths.length,'static files');
