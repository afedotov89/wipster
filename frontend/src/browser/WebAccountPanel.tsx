import { useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';
import { useWeb, logout, synchronize, resolveConflict, exportWork, failure } from './runtime';
export default function WebAccountPanel() {
  const web=useWeb(), [confirm,setConfirm]=useState(false);
  return <Stack spacing={2} sx={{maxWidth:620}}>
    {web.account && <Box><Typography variant="h6">{web.account.name || 'Яндекс ID'}</Typography><Typography color="text.secondary" sx={{overflowWrap:'anywhere'}}>{web.account.email}</Typography></Box>}
    <Typography>{web.busy?'Синхронизируем…':web.conflict?'Нужен ваш выбор':!navigator.onLine?'Нет сети':web.pending?`Ожидают отправки: ${web.pending}`:'Все сохранённые изменения отправлены'}</Typography>
    <Typography variant="body2" color="text.secondary">Изменения сначала сохраняются на устройстве. Отправка продолжается, когда Wipster открыт и есть сеть. После выхода локальная копия остаётся для этого аккаунта.</Typography>
    {web.error&&<Alert severity="warning">{web.error}</Alert>}
    {web.conflict&&<Alert severity="warning">
      На другом устройстве появились изменения. Автоматическая синхронизация приостановлена, локальная работа сохранена.
      <Stack sx={{mt:1}} spacing={1}><Button onClick={()=>void exportWork().catch(failure)}>Сохранить копию моей работы</Button>
      <Button onClick={()=>void resolveConflict('local').catch(failure)}>Отправить мою версию</Button><Button onClick={()=>void resolveConflict('cloud').catch(failure)}>Использовать данные из облака</Button></Stack>
      <Typography variant="body2">Перед заменой Wipster также сохранит копию в локальном хранилище. Удалённые на другом устройстве объекты не восстанавливаются автоматически.</Typography>
    </Alert>}
    {web.account&&<><Button variant="outlined" disabled={web.busy} onClick={()=>void synchronize()}>Синхронизировать сейчас</Button><Button onClick={()=>void exportWork().catch(failure)}>Сохранить копию данных</Button><Button color="error" onClick={()=>setConfirm(true)}>Выйти из аккаунта</Button></>}
    <Dialog open={confirm} onClose={()=>setConfirm(false)}><DialogTitle>Выйти на этом устройстве?</DialogTitle><DialogContent>
      {web.pending?`На устройстве есть неотправленные изменения (${web.pending}). `:''}Они останутся здесь для этого аккаунта. Для продолжения войдите в тот же Яндекс ID. Без сети отзыв доступа завершится при подключении, до следующей синхронизации.
    </DialogContent><DialogActions sx={{flexWrap:'wrap'}}><Button onClick={()=>void exportWork().catch(failure)}>Сохранить копию</Button><Button onClick={()=>setConfirm(false)}>Остаться</Button><Button color="error" onClick={()=>{setConfirm(false);void logout().catch(failure);}}>Выйти, сохранив работу</Button></DialogActions></Dialog>
  </Stack>;
}
