import { control } from './db';
export interface SessionGuard {
 ():Promise<void>;
 fence:number; epoch:number; browserId?:string; claimed:boolean; signal:AbortSignal;
 observe:(browserId:string,generation:number)=>Promise<void>;
}
// IDB generation is shared even when Web Locks is available. The server claim
// fences requests that have already left a suspended/dead page. Abort is only an
// optimisation: it cannot undo an HTTP commit, hence server fencing is required.
async function leased<T>(fn:(guard:SessionGuard)=>Promise<T>):Promise<T> {
 const owner=crypto.randomUUID(),ttl=4000,deadline=Date.now()+15000,abort=new AbortController();
 let fence=0,epoch=0,browserId:string|undefined;
 while(true){
  const held=await control(c=>{
   if(c.sessionLease&&c.sessionLease.expires>Date.now())return false;
   c.sessionLease={owner,expires:Date.now()+ttl};c.authFence=(c.authFence??0)+1;
   fence=c.authFence;epoch=c.epoch;browserId=c.browserId;return true;
  });
  if(held)break;
  if(Date.now()>deadline)throw new Error('Другое окно завершает вход или выход. Повторите попытку.');
  await new Promise(r=>setTimeout(r,100));
 }
 let lost=false;
 const guard=Object.assign(async()=>{
  await control(c=>{
   if(lost||c.sessionLease?.owner!==owner||c.sessionLease.expires<Date.now()||c.epoch!==guard.epoch){lost=true;abort.abort();throw new Error('Другое окно продолжило вход или выход. Откройте Wipster снова.');}
   c.sessionLease.expires=Date.now()+ttl;
  });
 },{fence,epoch,browserId,claimed:false,signal:abort.signal,observe:async(id:string,generation:number)=>{
  await guard();
  await control(c=>{
   if(c.sessionLease?.owner!==owner||c.sessionLease.expires<Date.now()||c.epoch!==guard.epoch)throw new Error('Операция входа устарела.');
   if(guard.claimed&&(id!==guard.browserId||generation>guard.fence))throw new Error('Другое окно изменило вход. Повторите попытку.');
   if(!guard.claimed){guard.fence=Math.max(guard.fence,generation+1);c.authFence=Math.max(c.authFence??0,guard.fence);guard.browserId=id;c.browserId=id;}
  });
 }}) as SessionGuard;
 const timer=setInterval(()=>{void guard().catch(()=>{lost=true;abort.abort();});},750);
 try{const result=await fn(guard);await guard();return result;}
 finally{clearInterval(timer);abort.abort();await control(c=>{if(c.sessionLease?.owner===owner)delete c.sessionLease;});}
}
export async function sessionLock<T>(fn:(guard:SessionGuard)=>Promise<T>):Promise<T>{
 return navigator.locks?navigator.locks.request('wipster-web-session-v1',()=>leased(fn)):leased(fn);
}
