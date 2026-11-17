import { useRef, useState } from 'react';
import { Box, Button, Checkbox, TextField, Typography } from '@mui/material';
type Item = { text:string; done:boolean };
type Props = {items:Item[];onToggle:(i:number)=>void;onRemove:(i:number)=>void;onDraftText:(i:number,text:string)=>void;onCommitText:()=>void;onReorder:(items:Item[])=>void};
function Row({item,index,total,onToggle,onRemove,onDraftText,onCommitText,onMove}:Omit<Props,'items'|'onReorder'> & {item:Item;index:number;total:number;onMove:(delta:number)=>void}) {
 const [editing,setEditing]=useState(false),[value,setValue]=useState(item.text);
 const base=useRef(item.text),editButton=useRef<HTMLButtonElement>(null);
 const finish=(cancel=false)=>{onDraftText(index,cancel?base.current:value.trim()||base.current);if(!cancel)onCommitText();setEditing(false);requestAnimationFrame(()=>editButton.current?.focus());};
 return <Box component="li" className="web-checklist-row">
  <Checkbox checked={item.done} inputProps={{'aria-label':`Выполнен шаг ${index+1}: ${item.text}`}} onChange={()=>onToggle(index)}/>
  {editing?<TextField autoFocus multiline fullWidth label={`Текст шага ${index+1}`} value={value} onChange={e=>{setValue(e.target.value);onDraftText(index,e.target.value);}} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();e.preventDefault();finish(true);}if(e.key==='Enter'&&!e.shiftKey){e.stopPropagation();e.preventDefault();finish();}}}/>:<Typography sx={{minWidth:0,overflowWrap:'anywhere',alignSelf:'center',textDecoration:item.done?'line-through':undefined}}>{item.text}</Typography>}
  <Box className="web-checklist-actions">
   {editing?<><Button onMouseDown={e=>e.preventDefault()} onClick={()=>finish()}>Сохранить шаг</Button><Button onMouseDown={e=>e.preventDefault()} onClick={()=>finish(true)}>Отмена</Button></>:<Button ref={editButton} onClick={()=>{base.current=item.text;setValue(item.text);setEditing(true);}}>Изменить шаг {index+1}</Button>}
   {!editing&&<><Button aria-label={`Шаг ${index+1} выше`} disabled={index===0} onClick={()=>onMove(-1)}>Выше</Button><Button aria-label={`Шаг ${index+1} ниже`} disabled={index===total-1} onClick={()=>onMove(1)}>Ниже</Button><Button aria-label={`Удалить шаг ${index+1}`} onClick={()=>onRemove(index)}>Удалить</Button></>}
  </Box>
 </Box>;
}
export default function WebChecklist(props:Props) {
 const ids=useRef<string[]>([]);while(ids.current.length<props.items.length)ids.current.push(crypto.randomUUID());ids.current.length=props.items.length;
 return <Box component="ol" className="web-checklist" aria-label="Шаги задачи">{props.items.map((item,index)=><Row key={ids.current[index]} {...props} item={item} index={index} total={props.items.length} onRemove={i=>{ids.current.splice(i,1);props.onRemove(i);}} onMove={delta=>{const next=[...props.items],to=index+delta;[next[index],next[to]]=[next[to],next[index]];[ids.current[index],ids.current[to]]=[ids.current[to],ids.current[index]];props.onReorder(next);}}/>)}</Box>;
}
