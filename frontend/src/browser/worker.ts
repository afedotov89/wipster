import { create } from 'zustand';
export const useWorker = create<{waiting:boolean;offlineReady:boolean}>(()=>({waiting:false,offlineReady:false}));
export async function registerWorker() {
  if(!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  try {
    const r=await navigator.serviceWorker.register('/sw.js',{scope:'/'});
    const check=()=>useWorker.setState({waiting:!!r.waiting,offlineReady:!!r.active});
    check(); r.addEventListener('updatefound',()=>{r.installing?.addEventListener('statechange',check);});
    await navigator.serviceWorker.ready; useWorker.setState({offlineReady:true});
    // Never force skipWaiting/reload. Existing clients keep their shell and drafts.
  } catch { useWorker.setState({offlineReady:false}); }
}
