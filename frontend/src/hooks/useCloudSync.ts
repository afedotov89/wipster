import { useEffect } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { useCloudStore } from '@/stores/cloudStore';

/** The native journal is durable; these are just opportunities to deliver it. */
export function useCloudSync() {
  useEffect(() => {
    if (!isTauri()) return;
    const sync = () => { if (document.visibilityState !== 'hidden') void useCloudStore.getState().sync(); };
    void useCloudStore.getState().refresh().then(sync).catch(() => {});
    const timer = window.setInterval(sync, 10000);
    window.addEventListener('focus', sync);
    window.addEventListener('online', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', sync);
      window.removeEventListener('online', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);
}
