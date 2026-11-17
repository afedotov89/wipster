import { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, CircularProgress, CssBaseline, ThemeProvider, Typography, GlobalStyles } from '@mui/material';
import { buildMuiTheme } from '@/theme/builder';
import { useThemeStore } from '@/theme/store';
import AppShell from '@/components/layout/AppShell';
import { useWeb, initialize, synchronize, completeLogin, cancelLogin, startLogin, failure, status } from './runtime';
import { refreshCloudData } from '@/stores/cloudStore';
import { useUiStore } from '@/stores/uiStore';
import { useProjectStore } from '@/stores/projectStore';
import { useTaskStore } from '@/stores/taskStore';
import { useTaskFieldStore } from '@/stores/taskFieldStore';
import { useI18n } from '@/i18n';
import WebAccountPanel from './WebAccountPanel';
import { registerWorker, useWorker } from './worker';
import { connectHistory } from './history';
import './mobile.css';

export default function BrowserApp() {
  const theme = useThemeStore(s => s.current);
  const mui = useMemo(() => buildMuiTheme(theme), [theme]);
  const web = useWeb();
  const worker = useWorker();
  const [showRecovery, setShowRecovery] = useState(false);
  useEffect(() => {
    document.body.classList.add('wipster-web');
    try { if (!localStorage.getItem('wipster-locale')) useI18n.getState().setLocale('ru'); } catch { useI18n.getState().setLocale('ru'); }
    void initialize(); void registerWorker();
    let stopped = false, timer: number | undefined, attempts = 0, loading = false;
    const refresh = async () => {
      if (!useWeb.getState().account || loading) return;
      loading = true;
      try { await refreshCloudData(); } catch(e) { failure(e); } finally { loading=false; }
    };
    const tick = async () => {
      window.clearTimeout(timer);
      try {
        if (document.visibilityState !== 'hidden') {
          if (useWeb.getState().pendingLogin) await completeLogin();
          else if (useWeb.getState().account) await synchronize();
          else if (useWeb.getState().blocked && navigator.onLine) await initialize();
          if (useWeb.getState().error) attempts++; else attempts=0;
        }
      } catch(e) { failure(e); attempts++; }
      if (!stopped) timer=window.setTimeout(tick, useWeb.getState().pendingLogin ? 2000 : Math.min(60000, 10000 * 2**Math.min(attempts,3)));
    };
    const changed = () => { void refresh(); };
    const accountChanged = () => {
      // Remove previous-account state before any asynchronous refresh.
      useUiStore.getState().closeDetail(); useUiStore.getState().closeSettings();
      useProjectStore.setState({ projects: [], selectedProjectId: null });
      useTaskStore.setState({ tasks: [], doingTasks: [], archivedTasks: [] });
      useTaskFieldStore.setState({ fields: [], removed: [], loaded: false });
      void refresh();
    };
    const visible = () => { if (document.visibilityState !== 'hidden') { void status().catch(() => {}); void tick(); } };
    window.addEventListener('wipster-web-change',changed);
    window.addEventListener('wipster-account-change',accountChanged);
    window.addEventListener('online',visible); window.addEventListener('focus',visible);
    document.addEventListener('visibilitychange',visible);
    timer=window.setTimeout(tick,1000);
    return () => { document.body.classList.remove('wipster-web'); stopped=true; window.clearTimeout(timer); window.removeEventListener('wipster-web-change',changed); window.removeEventListener('wipster-account-change',accountChanged); window.removeEventListener('online',visible); window.removeEventListener('focus',visible); document.removeEventListener('visibilitychange',visible); };
  }, []);
  useEffect(() => {
    if (!web.account) return;
    let dispose: (() => void) | undefined, stopped=false;
    void refreshCloudData().then(() => { if (!stopped) dispose=connectHistory(); }).catch(failure);
    void navigator.storage?.persist?.().catch(() => false);
    return () => { stopped=true; dispose?.(); };
  }, [web.account?.account_id]);
  return <ThemeProvider theme={mui}><CssBaseline /><GlobalStyles styles={{"body.wipster-web":{"--web-control-fg":mui.palette.mode==="dark"?"#f5fff9":"#123c33","--web-control-muted":mui.palette.mode==="dark"?"#929e98":"#687b74"}}}/><Box className="web-app" sx={{"--web-control-fg":mui.palette.mode==="dark"?"#f5fff9":"#123c33","--web-control-muted":mui.palette.mode==="dark"?"#929e98":"#687b74"}}>
    {!web.ready ? <Box sx={{m:'auto',p:3}} role="status"><CircularProgress /><Typography>Открываем Wipster…</Typography></Box> : !web.account ?
      <Box component="main" className="login-page">
        <Box className="login-card">
          <img src="/icons/icon-192.png" width="72" height="72" alt="" />
          <Typography variant="h4" component="h1" sx={{fontWeight:700,mt:2}}>Wipster</Typography>
          <Typography sx={{mt:1,mb:3}} color="text.secondary">Меньше задач в работе. Больше завершённых дел.</Typography>
          {web.error && <Alert severity="warning" sx={{mb:2}}>{web.error}</Alert>}
          {web.storageError ? <Alert severity="error">Хранилище устройства недоступно. Проверьте свободное место и настройки браузера, затем откройте Wipster снова.</Alert> : web.pendingLogin ? <>
            <Typography sx={{mb:2}}>Завершите вход в Яндексе и вернитесь в это окно. Wipster продолжит автоматически.</Typography>
            <Button variant="contained" onClick={() => void completeLogin().catch(failure)}>Проверить вход</Button>
            <Button onClick={() => void cancelLogin().catch(failure)}>Отменить</Button>
          </> : <Button variant="contained" fullWidth size="large" onClick={() => void startLogin().catch(failure)}>Войти с Яндекс ID</Button>}
          <Typography variant="body2" color="text.secondary" sx={{mt:3}}>Те же проекты на телефоне и компьютере. Сохранённые на устройстве изменения отправятся, когда приложение открыто и есть сеть.</Typography>
          <Button sx={{mt:2}} onClick={() => setShowRecovery(!showRecovery)}>Установка и сохранённая работа</Button>
          {showRecovery && <><Typography variant="body2" sx={{mt:1}}>На iPhone откройте меню «Поделиться» → «На экран Домой». На Android — меню браузера → «Установить приложение» или «Добавить на главный экран». Названия зависят от версии браузера. Локальная работа после выхода сохраняется для того же аккаунта. Войдите в него снова, чтобы продолжить.</Typography><WebAccountPanel /></>}
        </Box>
      </Box> : <>
        {web.storageError && <Alert severity="error">Не удалось сохранить данные на устройстве. Оставьте Wipster открытым, освободите место и повторите сохранение.</Alert>}
        {worker.waiting && <Alert severity="info">Доступно обновление. Завершите редактирование и закройте все окна Wipster: новая версия откроется при следующем запуске.</Alert>}
        <Box sx={{flex:1,minHeight:0}}><AppShell windowButtonsOverlap={false} /></Box>
      </>}
  </Box></ThemeProvider>;
}
