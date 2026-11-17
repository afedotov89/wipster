import { current, failure, useWeb } from './runtime';
import { workspace } from './db';
export async function readDraft(key:string) {
  if(!useWeb.getState().account)return undefined;
  try {const c=await current();return await workspace(c.account.account_id,s=>s.settings['draft:'+key]?JSON.parse(s.settings['draft:'+key]):undefined,false);}catch{return undefined;}
}
export async function retainDraft(key:string,value:unknown) {
  if(!useWeb.getState().account)return;
  try {const c=await current();await workspace(c.account.account_id,s=>{if(value===undefined)delete s.settings['draft:'+key];else s.settings['draft:'+key]=JSON.stringify(value);});}
  catch(e){failure(e,true);}
}
