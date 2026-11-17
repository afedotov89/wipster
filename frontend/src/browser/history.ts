import { useUiStore } from '@/stores/uiStore';
import { useProjectStore } from '@/stores/projectStore';
import { useTaskStore } from '@/stores/taskStore';
import { getTask } from '@/utils/tauri';
import { failure } from './runtime';
/** Fragments keep entity links out of server logs and SW navigation matching. */
export function connectHistory() {
  let applying=false;
  const write=()=>{
    if(applying)return;
    const u=useUiStore.getState(),p=useProjectStore.getState();
    const params=new URLSearchParams();params.set('view',u.view);
    if(p.selectedProjectId)params.set('project',p.selectedProjectId);
    if(u.detailOpen&&u.selectedTaskId)params.set('task',u.selectedTaskId);
    if(u.settingsOpen)params.set('settings',u.settingsSection);
    const next='#'+params.toString();if(location.hash!==next)history.pushState(null,'',next);
  };
  const read=async()=>{
    applying=true;
    try {
      const p=new URLSearchParams(location.hash.slice(1)),ui=useUiStore.getState();
      const project=p.get('project');
      if(project&&useProjectStore.getState().projects.some(x=>x.id===project))useProjectStore.getState().select(project);
      const view=p.get('view');if(view==='project'||view==='all-doing'||view==='archive')ui.setView(view);
      const section=p.get('settings');
      if(section==='general'||section==='account'||section==='appearance'||section==='fields')ui.openSettings(section);else ui.closeSettings();
      const id=p.get('task');
      if(id){ const task=await getTask(id);if(!useTaskStore.getState().findTask(id))useTaskStore.setState(s=>({tasks:[...s.tasks,task]}));ui.openDetail(id); }else ui.closeDetail();
    }catch(e){failure(e);}finally{applying=false;}
  };
  const onPop=()=>{void read();};
  const u=useUiStore.subscribe(write),p=useProjectStore.subscribe((s,prev)=>{if(s.selectedProjectId!==prev.selectedProjectId)write();});
  window.addEventListener('popstate',onPop);
  void read();
  return()=>{u();p();window.removeEventListener('popstate',onPop);};
}
