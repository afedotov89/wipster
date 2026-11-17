import { workspace, put, live, requireData, keyOf, type Workspace, type Data, type Kind } from './db';
import { useWeb, current, assertCurrent, status, failure, announce } from './runtime';
const now = () => new Date().toISOString();
const builtinSpecs = [['project','project_id','select'], ['priority','priority','select'], ['energy','energy','select'], ['time-estimate','time_estimate','text'], ['due','due','date'], ['promised-to','promised_to','text'], ['dod','dod','long_text'], ['checklist','checklist','checklist'], ['tracker-url','tracker_url','url'], ['comment','comment','long_text']];
function defaults() { return builtinSpecs.map(([id,key,kind], position) => ({ id: 'builtin-' + id, key, kind, position, builtin: 1, enabled: 1, label: null, options: '[]', removed_at: null, column_side: null, created_at: '2026-01-01T00:00:00Z' })); }
function fields(s: Workspace) { const all = new Map(defaults().map(f => [f.id,f as Data])); for (const f of live(s,'field')) all.set(f.id,f); return [...all.values()].sort((a,b) => a.position-b.position); }
function domainField(f: Data) { return { ...f, builtin: !!f.builtin, enabled: !!f.enabled, options: JSON.parse(f.options) }; }
function task(s: Workspace, id: string) { return requireData(s, 'task', id); }
function tasks(s: Workspace) { return live(s,'task').sort((a,b) => (a.position ?? 0)-(b.position ?? 0) || a.created_at.localeCompare(b.created_at)); }
function doing(s: Workspace) { return tasks(s).filter(t => t.status === 'doing' && !t.archived_at); }
function limit(s: Workspace) { return Number(s.entities['preference:wip_limit']?.data?.value ?? 3); }
function validate(s: Workspace) {
  if (doing(s).length > limit(s)) throw new Error('Сначала приостановите задачу: превышен лимит задач в работе.');
  const projects = live(s,'project');
  for (const p of projects) {
    const seen = new Set([p.id]); let parent = p.parent_id;
    while (parent) { if (seen.has(parent)) throw new Error('Проект нельзя вложить в самого себя.'); seen.add(parent); const next = projects.find(p => p.id === parent); if (!next) throw new Error('Родительский проект удалён.'); parent = next.parent_id; }
  }
  for (const t of tasks(s)) if (t.project_id && !projects.some(p => p.id === t.project_id)) throw new Error('Проект удалён. Выберите другой.');
}
const readCommands = new Set(['list_projects','list_tasks','get_task','get_doing_tasks','list_archived_tasks','get_project_task_counts','get_promised_to_options','get_estimate_options','list_task_fields','removed_task_fields','task_field_values','get_wip_limit','get_setting','project_delete_impact','get_changelog','get_task_contexts','is_bare_issue_reference']);
function descendants(s: Workspace, id: string) { const ids = new Set([id]); let more = true; while(more) { more=false; for (const p of live(s,'project')) if(p.parent_id && ids.has(p.parent_id) && !ids.has(p.id)) {ids.add(p.id);more=true;} } return ids; }
export async function browserInvoke<T>(command: string, args: any = {}): Promise<T> {
  try {
    const c = await current();
    const writing = !readCommands.has(command);
    const result = await workspace(c.account.account_id, s => {
      const a = args, input = a.input ?? {};
      const set = (kind: Kind, id: string, value: Data | null) => put(s,kind,id,value);
      const updateTask = (id: string, patch: Data) => { const t = { ...task(s,id), ...patch, updated_at: now() }; set('task',id,t); return t; };
      const field = (id: string) => { const f=fields(s).find(f=>f.id===id); if(!f) throw new Error('Поле удалено.'); return f; };
      const values = (taskId: string) => Object.fromEntries(live(s,'value').filter(v=>v.task_id===taskId).map(v=>[v.field_id,JSON.parse(v.value)]));
      const eraseTask = (id: string) => { task(s,id); set('task',id,null); for(const v of live(s,'value').filter(v=>v.task_id===id)) set('value',v.task_id+':'+v.field_id,null); };
      let result: any;
      switch(command) {
        case 'list_projects': result=live(s,'project').sort((a,b)=>a.order-b.order).map(p=>({...p,icon_mono:!!p.icon_mono}));break;
        case 'create_project': {
          const name=String(input.name).trim(); if(!name) throw new Error('Введите название проекта.');
          const p={ id:crypto.randomUUID(), name, parent_id:input.parent_id??null, icon:null,icon_image:null,icon_mono:0,color:null,order:live(s,'project').length,created_at:now(),updated_at:now() };set('project',p.id,p);result=p;break;
        }
        case 'update_project': { const p={...requireData(s,'project',a.id),...input,updated_at:now()}; p.icon_mono=p.icon_mono?1:0;set('project',a.id,p);result={...p,icon_mono:!!p.icon_mono};break; }
        case 'project_delete_impact': {const ids=descendants(s,a.id);result={sub_projects:ids.size-1,tasks:tasks(s).filter(t=>ids.has(t.project_id)).length};break;}
        case 'delete_project': {const ids=descendants(s,a.id);for(const t of tasks(s)) if(ids.has(t.project_id)) eraseTask(t.id);for(const id of ids) set('project',id,null);break;}
        case 'list_tasks': {const ids=a.projectId?descendants(s,a.projectId):null;result=tasks(s).filter(t=>!t.archived_at && (!ids||ids.has(t.project_id)) && (!a.status||t.status===a.status));break;}
        case 'get_task': result=task(s,a.id);break;
        case 'get_doing_tasks': result=doing(s);break;
        case 'list_archived_tasks': result=tasks(s).filter(t=>t.archived_at);break;
        case 'create_task': {
          const title=String(input.title).trim();if(!title) throw new Error('Введите название задачи.');
          const t={id:crypto.randomUUID(),title,project_id:input.project_id??null,status:input.status??'queue',priority:null,energy:null,due:null,estimate:null,time_estimate:null,tags:'[]',dod:null,checklist:'[]',next_step:null,return_ref:null,promised_to:null,comment:null,tracker_url:null,position:tasks(s).length,completed_at:null,archived_at:null,created_at:now(),updated_at:now()};set('task',t.id,t);result=t;break;
        }
        case 'update_task': result=updateTask(a.id,input);break;
        case 'save_task_draft': {const t=task(s,a.id);const applied=(t[a.field]??'')===(a.expected??'');result={applied,task:applied?updateTask(a.id,{[a.field]:a.value}):t};break;}
        case 'delete_task':eraseTask(a.id);break;
        case 'set_task_archived':result=updateTask(a.id,{archived_at:a.archived?now():null});break;
        case 'move_task': {
          const id=input.task_id,t=task(s,id);const blocked=input.new_status==='doing' && t.status!=='doing' && doing(s).length>=limit(s) && !input.swap_task_id;
          if(!blocked) { if(input.swap_task_id) { if(input.swap_task_id===id || task(s,input.swap_task_id).status!=='doing') throw new Error('Выберите задачу в работе.');updateTask(input.swap_task_id,{status:'queue'}); }result=updateTask(id,{status:input.new_status,completed_at:input.new_status==='done'?now():null}); }
          result={task:blocked?t:result,wip_blocked:blocked,doing_tasks:doing(s)};break;
        }
        case 'reorder_tasks': for(const [position,id] of (a.taskIds as string[]).entries()) updateTask(id,{position});break;
        case 'get_project_task_counts':result=live(s,'project').map(p=>({project_id:p.id,...Object.fromEntries(['queue','doing','done'].map(status=>[status,tasks(s).filter(t=>t.project_id===p.id&&!t.archived_at&&t.status===status).length]))}));break;
        case 'get_promised_to_options':case 'get_estimate_options':result=[...new Set(tasks(s).map(t=>t[command==='get_promised_to_options'?'promised_to':'time_estimate']).filter(Boolean))];break;
        case 'get_wip_limit':result=limit(s);break;
        case 'set_wip_limit': {const value=Math.max(1,Math.min(20,Math.round(a.limit)));set('preference','wip_limit',{key:'wip_limit',value:String(value)});result=value;break;}
        case 'get_setting':result=s.settings[a.key]??null;break;
        case 'set_setting':s.settings[a.key]=a.value;break;
        case 'list_task_fields':result=fields(s).filter(f=>!f.removed_at && f.kind!=='file_list').map(domainField);break;
        case 'removed_task_fields':result=fields(s).filter(f=>f.removed_at).map(domainField);break;
        case 'create_task_field': {if(a.kind==='file_list') throw new Error('Файлы устройства доступны в настольном приложении.');const id=crypto.randomUUID(), f={id,key:'custom-'+id,label:a.label,kind:a.kind,options:JSON.stringify(a.options??[]),builtin:0,enabled:1,position:fields(s).length,removed_at:null,column_side:null,created_at:now()};set('field',id,f);result=domainField(f);break;}
        case 'update_task_field': {const f={...field(a.id)};for(const k of ['label','enabled','options','columnSide']) if(a[k]!==undefined) {const key=k==='columnSide'?'column_side':k;f[key]=k==='options'?JSON.stringify(a[k]):k==='enabled'?(a[k]?1:0):a[k]==='auto'?null:a[k];}set('field',a.id,f);result=domainField(f);break;}
        case 'reorder_task_fields':for(const [position,id] of (a.ids as string[]).entries()) set('field',id,{...field(id),position});break;
        case 'remove_task_field':set('field',a.id,{...field(a.id),removed_at:now(),enabled:0});break;
        case 'restore_task_field': {const f={...field(a.id),removed_at:null,enabled:1};set('field',a.id,f);result=domainField(f);break;}
        case 'task_field_values':result=values(a.taskId);break;
        case 'set_task_field_value':case 'save_custom_field_draft': {
          task(s,a.taskId);const f=field(a.fieldId);if(f.builtin||f.kind==='file_list') throw new Error('Это поле недоступно в браузере.');
          const old=values(a.taskId)[a.fieldId]??null;const applied=command==='set_task_field_value'||JSON.stringify(old)===JSON.stringify(a.expected??null);
          if(applied) { if(!s.entities[keyOf('field',f.id)]) set('field',f.id,f);set('value',a.taskId+':'+a.fieldId,{task_id:a.taskId,field_id:a.fieldId,value:JSON.stringify(a.value??null),updated_at:now()}); }
          result={applied,value:applied?a.value:old};break;
        }
        case 'get_changelog':case 'get_task_contexts': result=[];break;
        case 'is_bare_issue_reference':result=false;break;
        default: throw new Error('Эта возможность доступна в настольном Wipster.');
      }
      if(writing) validate(s);
      return result;
    }, writing);
    await assertCurrent(c);
    if(writing) { if(useWeb.getState().storageError) useWeb.setState({storageError:false,error:null}); await status(); announce(); }
    return result as T;
  } catch(e) { failure(e,e instanceof DOMException);throw e; }
}
