import { renderFrame, cellWidth } from './tui-render.js';

const states = { '运行中':'running', '进行中':'running', '完成':'completed', '已完成':'completed', '通过':'passed', '受阻':'blocked', '失败':'failed', '已停止':'interrupted', '已中断':'interrupted' };
const status = value => states[value] || 'pending';
export function referenceWindowAnsi(view, { columns = 120, rows = 46 } = {}) {
  const roles = [{ id:'worker', model:view.workerModel, status:status(view.workerStatus) }, { id:'explorer', model:'not enabled', status:'not enabled' }, { id:'researcher', model:'not enabled', status:'not enabled' }];
  const state = { roles, events:view.events?.length ? view.events : [{ time:view.updatedAt || '', type:'status', message:view.event || '' }], run:{
    status:view.statusCode, stage:view.currentStage || 'implementation', threads:roles.map(r=>({ ...r, id:r.id })),
    reviews:[{type:'plan',status:status(view.plan)},{type:'repeated-error',status:'pending'},{type:'completion',status:status(view.review)}],
  } };
  return renderFrame(state, { columns, rows, workflowView:view, tick:0, elapsed:view.elapsedMs || 0 });
}

// Preserve the original renderer's character coordinates and colors.
export function terminalFrameFromAnsi(ansi, columns = 119, rows = 46) {
  let x=0,y=0,fg='#d3d6e0',bg='#1a1d24',bold=false,position=0;
  const segments=[];
  const hex=values=>'#'+values.map(n=>n.toString(16).padStart(2,'0')).join('');
  function add(text) {
    let ascii='',start=x;
    const flush=()=>{if(ascii && (ascii.trim() || bg!=='#1a1d24'))segments.push({x:start,y,text:ascii,width:x-start,fg,bg,bold});ascii='';start=x;};
    for(const c of text){const width=cellWidth(c);if(!width)continue;
      if('─│┌┐└┘┬'.includes(c)) {
        flush(); const previous=segments.at(-1);
        if(c==='─' && previous?.shape===c && previous.y===y && previous.x+previous.width===x && previous.fg===fg && previous.bg===bg) { previous.width++; previous.text+=c; }
        else segments.push({x,y,text:c,shape:c,width,fg,bg,bold});
        x+=width;start=x;
      }
      else if(width===2){flush();segments.push({x,y,text:c,width,fg,bg,bold});x+=width;start=x;}
      else {ascii+=c;x+=width;}
    }
    flush();
  }
  for(const match of ansi.matchAll(/\x1b\[([0-9;?]*)([A-Za-z])/g)) {
    add(ansi.slice(position,match.index));position=match.index+match[0].length;
    const p=match[1].split(';').map(Number);
    if(match[2]==='H'){y=p.length===2?p[0]-1:0;x=p.length===2?p[1]-1:0;}
    if(match[2]==='m'){
      for(let i=0;i<p.length;i++){
        if(p[i]===0){fg='#d3d6e0';bg='#1a1d24';bold=false;}
        else if(p[i]===1)bold=true;
        else if(p[i]===22)bold=false;
        else if([38,48].includes(p[i])&&p[i+1]===2){const color=hex(p.slice(i+2,i+5));if(p[i]===38)fg=color;else bg=color;i+=4;}
      }
    }
  }
  add(ansi.slice(position));
  return {columns,rows,background:'#1a1d24',segments};
}
export function buildReferenceWindowFrame(view) { return terminalFrameFromAnsi(referenceWindowAnsi(view)); }
