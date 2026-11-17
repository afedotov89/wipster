import WebAccountPanel from "@/browser/WebAccountPanel";
import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Checkbox, CircularProgress, FormControlLabel, Stack, TextField, Typography } from '@mui/material';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { useCloudStore } from '@/stores/cloudStore';
import { useI18n } from '@/i18n';

function NativeAccountPanel() {
  const { locale } = useI18n();
  const ru = locale === 'ru';
  const { status, busy, sync } = useCloudStore();
  const [origin, setOrigin] = useState(() => localStorage.getItem('wipster-cloud-origin') ?? 'https://wipster.fedotovs.net');
  const [capabilities, setCapabilities] = useState<{ yandex?: boolean; google: boolean; sms: boolean } | null>(null);
  const [capabilityError, setCapabilityError] = useState(false);
  const [capabilityRetry, setCapabilityRetry] = useState(0);
  const [pendingProvider, setPendingProvider] = useState<'yandex' | 'google' | null>(null);
  const pendingRef = useRef<'yandex' | 'google' | null>(null);
  const apiOrigin = status.account?.origin ?? origin;
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    setCapabilities(null); setCapabilityError(false); setChallenge(null); setCode('');
    const timer = window.setTimeout(() => {
      void invoke<{ yandex?: boolean; google: boolean; sms: boolean }>('cloud_capabilities', { originUrl: apiOrigin })
        .then(value => { if (!disposed) setCapabilities(value); })
        .catch(() => { if (!disposed) setCapabilityError(true); });
    }, 300);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [apiOrigin, capabilityRetry]);
  useEffect(() => () => { if (pendingRef.current) void invoke(`cloud_${pendingRef.current}_cancel`).catch(() => {}); }, []);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [importLocal, setImportLocal] = useState(false);
  const [preview, setPreview] = useState<{projects: number; tasks: number; values: number; can_import: boolean} | null>(null);
  useEffect(() => {
    if (!isTauri() || status.account) return;
    let cancelled = false;
    void invoke<{projects: number; tasks: number; values: number; can_import: boolean}>('cloud_import_preview')
      .then(value => { if (!cancelled) setPreview(value); }).catch(() => {});
    return () => { cancelled = true; };
  }, [status.account]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const displayError = (e: unknown) => {
    const message = String(e);
    if (!ru || !/Google|Yandex|sign-in method|Sign-in cancelled/.test(message)) return message;
    const provider = /Google/.test(message) ? 'Google' : 'Яндекс ID';
    if (/cancelled/.test(message)) return `Вход через ${provider} отменён. Можно попробовать снова.`;
    if (/declined/.test(message)) return `Вход через ${provider} не разрешён. Можно попробовать снова.`;
    if (/timed out/.test(message)) return `Время ожидания ${provider} истекло. Попробуйте снова.`;
    if (/another Wipster account/.test(message)) return `Этот ${provider} уже привязан к другому аккаунту Wipster. Аккаунты не объединены.`;
    return `Не удалось завершить вход через ${provider}. Проверьте подключение и попробуйте снова.`;
  };
  const run = async (action: () => Promise<void>) => {
    setWorking(true); setError(null);
    try { await action(); } catch (e) { setError(displayError(e)); } finally { setWorking(false); }
  };
  const providerLogin = (provider: 'yandex' | 'google', link: boolean) => void run(async () => {
    setPendingProvider(provider); pendingRef.current = provider;
    localStorage.setItem('wipster-cloud-origin', apiOrigin);
    try {
      await invoke(`cloud_${provider}_login`, { originUrl: apiOrigin, importLocal: link ? false : importLocal, link });
      if (link) await useCloudStore.getState().refresh();
    } finally { setPendingProvider(null); pendingRef.current = null; }
  });
  if (!isTauri()) return <Alert severity="info">{ru ? 'Облачный аккаунт доступен в приложении Wipster для компьютера. Браузерный вход пока не поддерживается.' : 'Cloud accounts are available in the Wipster desktop app. Browser login is not supported yet.'}</Alert>;
  const locked = busy || working;
  return <Stack spacing={2} sx={{ maxWidth: 600 }}>
    <Typography variant="h6">{ru ? 'Аккаунт и синхронизация' : 'Account and sync'}</Typography>
    <Typography color="text.secondary">{ru ? 'Облако необязательно. Задачи, проекты, поля и лимит WIP доступны на устройствах с одним аккаунтом. Изменения сохраняются офлайн.' : 'Cloud is optional. Tasks, projects, fields and WIP limit follow your account across devices. Changes are saved offline.'}</Typography>
    <Alert severity="info">{ru ? 'Ключи интеграций, пути к файлам, вложения, контекст, чат и история отмены остаются на устройстве.' : 'Integration keys, file paths, attachments, context, chat and undo history stay on this device.'}</Alert>
    {!!status.pending_revocations && <Alert severity="info">{ru ? 'Отзыв предыдущей сессии ожидает связи с сервером. Данные этого аккаунта уже отключены на устройстве.' : 'A previous session is waiting for server revocation. Its workspace is already disconnected on this device.'}</Alert>}
    {(error || status.error) && <Alert severity="warning">{error || status.error}</Alert>}
    {status.account && capabilityError && <Alert severity="warning" action={<Button onClick={() => setCapabilityRetry(x => x + 1)}>{ru ? 'Повторить' : 'Retry'}</Button>}>{ru ? 'Не удалось узнать доступные способы входа.' : 'Could not load sign-in methods.'}</Alert>}
    {status.account ? <>
      <Typography>{status.account.name || status.account.email || status.account.phone || (ru ? 'Аккаунт Wipster' : 'Wipster account')}</Typography>
      {status.account.name && status.account.email && <Typography>{status.account.email}</Typography>}
      {capabilities?.yandex && !status.account.yandex_linked && <Box>
        <Typography variant="body2">{ru ? 'Привяжите Яндекс ID к текущему аккаунту. Все его данные сохранятся; другие аккаунты не объединяются.' : 'Link Yandex ID to this account. Its data stays intact; other accounts are never merged.'}</Typography>
        <Button disabled={locked} onClick={() => providerLogin('yandex', true)}>{ru ? 'Привязать Яндекс ID' : 'Link Yandex ID'}</Button>
      </Box>}
      {status.account.yandex_linked && <Typography variant="body2">{ru ? 'Яндекс ID привязан' : 'Yandex ID linked'}</Typography>}
      {capabilities?.google && !status.account.google_linked && <Box>
        <Typography variant="body2">{ru ? 'Привяжите Google, чтобы входить в этот аккаунт без SMS. Данные других аккаунтов не объединяются.' : 'Link Google to sign into this account without SMS. Other accounts are never merged.'}</Typography>
        <Button disabled={locked} onClick={() => providerLogin('google', true)}>{ru ? 'Привязать Google' : 'Link Google'}</Button>
      </Box>}
      {status.account.google_linked && <Typography variant="body2">{ru ? 'Google привязан' : 'Google linked'}</Typography>}
      <Typography variant="body2" color="text.secondary">{status.account.origin}</Typography>
      <Typography role="status">{busy ? (ru ? 'Синхронизация…' : 'Syncing…') : (ru ? `Ожидают отправки: ${status.pending}` : `Pending: ${status.pending}`)}</Typography>
      {status.last_sync && <Typography variant="body2">{ru ? 'Последняя синхронизация: ' : 'Last sync: '}{new Date(status.last_sync).toLocaleString()}</Typography>}
      {(status.conflict || (status.pending > 0 && status.error)) && <Box>
        <Alert severity="warning">{ru ? 'Отправка локальных изменений остановлена. «Оставить мои» повторит отправку локальных изменений поверх текущей версии. «Использовать облако» заменит данные этого пространства; резервная копия сохранится в локальной базе.' : 'Local changes could not be uploaded. Keep mine explicitly rebases local edits. Use cloud replaces this workspace; a recovery copy stays in the local database.'}</Alert>
        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          {status.conflict && <Button disabled={locked} onClick={() => void run(async () => { await invoke('cloud_resolve', { keepLocal: true }); await sync(); })}>{ru ? 'Оставить мои' : 'Keep mine'}</Button>}
          <Button disabled={locked} onClick={() => void run(async () => { await invoke('cloud_resolve', { keepLocal: false }); await sync(); window.location.reload(); })}>{ru ? 'Использовать облако' : 'Use cloud'}</Button>
        </Stack>
      </Box>}
      <Stack direction="row" spacing={1}>
        <Button variant="contained" disabled={locked} onClick={() => void sync()}>{ru ? 'Синхронизировать' : 'Sync now'}</Button>
        <Button disabled={locked} onClick={() => void run(async () => { await invoke('cloud_logout'); window.location.reload(); })}>{ru ? 'Выйти' : 'Sign out'}</Button>
      </Stack>
      <Typography variant="caption">{ru ? 'При входе и выходе приложение перезапускается. После выхода откроется исходное локальное пространство. Отзыв сессии офлайн отправится при восстановлении связи.' : 'Sign in and sign out restart the app. Sign out returns to the original offline workspace. Offline session revocation is retried when connected.'}</Typography>
    </> : <>
      <TextField label={ru ? 'Адрес API' : 'API origin'} value={origin} disabled={locked || !!challenge} onChange={e => setOrigin(e.target.value)} placeholder="https://wipster.fedotovs.net" />
        <FormControlLabel control={<Checkbox checked={importLocal} disabled={locked || !preview?.can_import} onChange={e => setImportLocal(e.target.checked)} />} label={ru ? 'Скопировать задачи и проекты из исходного локального пространства в пустой облачный аккаунт' : 'Copy tasks and projects from the original offline workspace into an empty cloud account'} />
        {preview && <Typography variant="body2">{ru ? `В локальном пространстве: ${preview.projects} проектов, ${preview.tasks} задач, ${preview.values} значений полей.` : `Local workspace: ${preview.projects} projects, ${preview.tasks} tasks, ${preview.values} field values.`}</Typography>}
        {preview && !preview.can_import && <Alert severity="warning">{ru ? 'Локальные данные превышают размер одного импорта (5000 записей / 7 МиБ). В этой версии можно войти без импорта; исходная база сохранится.' : 'Local data exceeds one import (5000 entities / 7 MiB). Sign in without import in this version; the original database stays intact.'}</Alert>}
        <Typography variant="caption">{ru ? 'Без этой опции откроются данные облака. Исходная локальная база сохранится. Импорт отправляет также текст задач и значения пользовательских полей.' : 'Otherwise cloud data will open. The original local database stays intact. Import also uploads task text and custom field values.'}</Typography>
      <Typography variant="body2" color="text.secondary">{ru ? 'Для прежнего аккаунта сначала войдите прежним способом и привяжите Яндекс ID в настройках. Первый вход с новым способом без привязки создаст отдельный аккаунт; совпадение email не переносит данные. Все локальные пространства сохраняются.' : 'For an existing account, sign in with its previous method and link Yandex ID in settings. First sign-in with a new method without linking creates a separate account; matching email does not transfer data. All local workspaces are preserved.'}</Typography>
      {capabilityError ? <Alert severity="warning" action={<Button onClick={() => setCapabilityRetry(x => x + 1)}>{ru ? 'Повторить' : 'Retry'}</Button>}>{ru ? 'Не удалось узнать доступные способы входа.' : 'Could not load sign-in methods.'}</Alert> : !capabilities ? <Typography role="status">{ru ? 'Проверка способов входа…' : 'Checking sign-in methods…'}</Typography> : <>
        {capabilities.yandex && <Button variant="contained" disabled={locked || !!challenge} onClick={() => providerLogin('yandex', false)}>{ru ? 'Войти с Яндекс ID' : 'Sign in with Yandex ID'}</Button>}
        {capabilities.yandex && <Typography variant="body2" color="text.secondary">{ru ? 'Используйте аккаунт Яндекса. Wipster получит только адрес почты, без доступа к письмам.' : 'Use your Yandex account. Wipster receives your email address only, without mailbox access.'}</Typography>}
        {capabilities.google && <Button variant={capabilities.yandex ? "outlined" : "contained"} disabled={locked || !!challenge} onClick={() => providerLogin('google', false)}>{ru ? 'Войти через Google' : 'Sign in with Google'}</Button>}
        {!capabilities.yandex && !capabilities.google && !capabilities.sms && <Alert severity="info">{ru ? 'Сервер пока не настроен для входа.' : 'Sign-in is not configured on this server yet.'}</Alert>}
      {capabilities?.sms && <>
      <TextField label={ru ? 'Телефон' : 'Phone'} value={phone} disabled={locked || !!challenge} onChange={e => setPhone(e.target.value)} placeholder="+79991234567" inputProps={{ autoComplete: 'tel', inputMode: 'tel' }} />
      {!challenge ? <Button variant={capabilities.yandex || capabilities.google ? "outlined" : "contained"} disabled={locked || !phone || !origin} onClick={() => void run(async () => {
        const result = await invoke<{ challenge_id: string }>('cloud_start', { originUrl: origin, phone });
        localStorage.setItem('wipster-cloud-origin', origin); setChallenge(result.challenge_id);
      })}>{ru ? 'Получить код' : 'Send code'}</Button> : <>
        <TextField label={ru ? 'Код из SMS' : 'SMS code'} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} disabled={locked} inputProps={{ autoComplete: 'one-time-code', inputMode: 'numeric', maxLength: 6 }} />
        <Button variant="contained" disabled={locked || code.length !== 6} onClick={() => void run(async () => {
          await invoke('cloud_login', { originUrl: origin, challengeId: challenge, code, importLocal });
          window.location.reload();
        })}>{ru ? 'Войти' : 'Sign in'}</Button>
        <Button disabled={locked} onClick={() => { setChallenge(null); setCode(''); }}>{ru ? 'Другой номер / запросить снова' : 'Change phone / request again'}</Button>
      </>}
      </>}
      </>}
    </>}
    {pendingProvider && <Stack spacing={1}>
      <Typography role="status">{ru ? 'Завершите вход в системном браузере. Ожидание — до 5 минут.' : 'Complete sign-in in your system browser. Waiting up to 5 minutes.'}</Typography>
      <Button onClick={() => void invoke(`cloud_${pendingProvider}_cancel`).catch(e => setError(displayError(e)))}>{ru ? 'Отменить вход' : 'Cancel sign-in'}</Button>
    </Stack>}
    {working && <CircularProgress size={20} />}
  </Stack>;
}

export default function AccountPanel() { return isTauri() ? <NativeAccountPanel /> : <WebAccountPanel />; }
