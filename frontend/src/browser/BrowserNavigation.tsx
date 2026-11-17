import { useEffect, useState } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Drawer, IconButton, MenuItem, Stack, TextField, Typography } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import SettingsIcon from '@mui/icons-material/Settings';
import CloseIcon from '@mui/icons-material/Close';
import { useUiStore } from '@/stores/uiStore';
import { useProjectStore } from '@/stores/projectStore';
import { useWeb, failure } from './runtime';
import { useWorker } from './worker';
import type { Project } from '@/utils/tauri';
export default function BrowserNavigation() {
  const ui=useUiStore(), projects=useProjectStore(s=>s.projects), selected=useProjectStore(s=>s.selectedProjectId);
  const web=useWeb(), offlineReady=useWorker(s=>s.offlineReady);
  const [open,setOpen]=useState(false), [edit,setEdit]=useState<Project|null|undefined>(undefined), [name,setName]=useState(''), [parent,setParent]=useState('');
  const [online,setOnline]=useState(navigator.onLine), [confirmDelete,setConfirmDelete]=useState(false);
  useEffect(()=>{const update=()=>setOnline(navigator.onLine);window.addEventListener('online',update);window.addEventListener('offline',update);return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};},[]);
  const editor=(p:Project|null)=>{setEdit(p);setName(p?.name??'');setParent(p?.parent_id??'');setConfirmDelete(false);};
  const select=(p:Project)=>{useProjectStore.getState().select(p.id);ui.setView('project');ui.closeSettings();ui.closeDetail();setOpen(false);};
  const save=async()=>{try{ if(edit) await useProjectStore.getState().update(edit.id,{name:name.trim(),parent_id:parent||null}); else {const p=await useProjectStore.getState().add(name.trim(),parent||undefined);select(p);}setEdit(undefined);}catch(e){failure(e);}};
  const remove=async()=>{try{if(edit){await useProjectStore.getState().remove(edit.id);setEdit(undefined);}}catch(e){failure(e);}};
  const depth=(p:Project)=>{const seen=new Set<string>();let d=0;while(p.parent_id&&!seen.has(p.id)){seen.add(p.id);const parent=projects.find(x=>x.id===p.parent_id);if(!parent)break;p=parent;d++;}return Math.min(d,4);};
  const status=web.storageError?'Ошибка сохранения':web.conflict?'Нужен ваш выбор':web.busy?'Синхронизация…':!online?`Нет сети · На устройстве: ${web.pending}`:web.error?'Нужна проверка синхронизации':web.pending?`Ожидают отправки: ${web.pending}`:web.lastSync?'Всё отправлено':offlineReady?'Готово к работе без сети':'Готовим работу без сети…';
  return <>
    <Box component="header" className="web-header">
      <IconButton aria-label="Открыть проекты" onClick={()=>setOpen(true)}><MenuIcon /></IconButton>
      <Typography component="span" sx={{fontWeight:700,flex:1,minWidth:0}}>Wipster</Typography>
      <Button onClick={()=>ui.openSettings('account')} color={web.conflict?'warning':'inherit'} className="sync-indicator">{status}</Button>
      <IconButton aria-label="Настройки" onClick={()=>ui.openSettings('account')}><SettingsIcon /></IconButton>
    </Box>
    {web.error&&!web.storageError&&!(ui.settingsOpen&&ui.settingsSection==='account')&&<Box className="web-inline-error" role="status"><Typography variant="body2">{web.error}</Typography><Button onClick={()=>ui.openSettings('account')}>Подробнее</Button></Box>}
    <Drawer open={open} onClose={()=>setOpen(false)} PaperProps={{sx:{width:'min(360px, 92vw)',px:2,pt:'max(12px, env(safe-area-inset-top))',pb:'max(16px, env(safe-area-inset-bottom))'}}}>
      <Box sx={{display:'flex',alignItems:'center',mb:2}}><Typography variant="h6" sx={{flex:1}}>Проекты</Typography><IconButton aria-label="Закрыть проекты" onClick={()=>setOpen(false)}><CloseIcon /></IconButton></Box>
      <Stack spacing={1}><Button onClick={()=>{ui.setView('all-doing');ui.closeSettings();ui.closeDetail();setOpen(false);}}>Всё в работе</Button><Button onClick={()=>{ui.setView('archive');ui.closeSettings();ui.closeDetail();setOpen(false);}}>Архив</Button></Stack>
      <Box sx={{flex:1,overflow:'auto',my:2}}>{!projects.length&&<Typography color="text.secondary" sx={{py:2}}>Создайте первый проект, чтобы добавить задачи.</Typography>}
      {projects.map(p=><Box key={p.id} sx={{display:'flex',alignItems:'center',pl:depth(p)*1.5,borderRadius:1,bgcolor:selected===p.id?'action.selected':undefined}}>
        <Button sx={{flex:1,justifyContent:'flex-start',textAlign:'left',overflowWrap:'anywhere'}} onClick={()=>select(p)}>{p.name}</Button><IconButton aria-label={'Изменить проект '+p.name} onClick={()=>editor(p)}>⋯</IconButton>
      </Box>)}</Box>
      <Button variant="contained" onClick={()=>editor(null)}>Создать проект</Button>
    </Drawer>
    <Dialog open={edit!==undefined} onClose={()=>setEdit(undefined)} fullWidth maxWidth="xs"><DialogTitle>{edit?'Изменить проект':'Новый проект'}</DialogTitle><DialogContent>
      <Stack spacing={2} sx={{pt:1}}><TextField autoFocus label="Название проекта" value={name} onChange={e=>setName(e.target.value)} fullWidth/><TextField select label="Родительский проект" value={parent} onChange={e=>setParent(e.target.value)} fullWidth><MenuItem value="">Без родителя</MenuItem>{projects.filter(p=>p.id!==edit?.id).map(p=><MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}</TextField>
      {edit&&<Button color="error" onClick={()=>setConfirmDelete(true)}>Удалить проект</Button>}{confirmDelete&&<><Typography>Удалить проект, вложенные проекты и их задачи? Это действие отправится на другие устройства.</Typography><Button color="error" variant="outlined" onClick={()=>void remove()}>Подтвердить удаление</Button></>}
      </Stack></DialogContent><DialogActions><Button onClick={()=>setEdit(undefined)}>Отмена</Button><Button disabled={!name.trim()} onClick={()=>void save()}>Сохранить</Button></DialogActions></Dialog>
  </>;
}
