import {t,h} from './i18n';
import {el,esc,icon,toast} from './ui';
const KEY='mergecraft-project-pins';
export function pinnedProjects():string[] {
  try {const value:unknown=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(value)?[...new Set(value.filter((p):p is string=>typeof p==='string'&&p.startsWith('/')&&!p.includes('\0')))].slice(0,20):[];}catch{return [];}
}
export function openProjects(anchor:HTMLElement,recent:string[],current:string|null,onOpen:(path:string)=>void,onBrowse:()=>void) {
  document.querySelector('.popover')?.remove();
  const pop=el('div','popover project-popover');pop.setAttribute('role','dialog');pop.setAttribute('aria-label',t('Projekte wechseln'));
  let pins=pinnedProjects();
  const paths=[...new Set([...(current?[current]:[]),...pins,...recent])];
  const close=()=>{pop.remove();anchor.focus();};
  const paint=()=>{
    const group=(title:string,entries:string[])=>entries.length?`<div class="group-title">${esc(title)}</div>${entries.map(path=>{
      const pinned=pins.includes(path),active=path===current;
      return `<div class="project-row"><button class="project-open" data-project-path="${esc(path)}" title="${esc(path)}"${active?' aria-current="true"':''}>${icon('folder',16)}<span><strong>${esc(path.split('/').pop()||path)}</strong><small>${esc(path)}</small></span>${active?icon('check',14):''}</button><button class="icon-btn project-pin" data-pin-path="${esc(path)}" aria-label="${esc(t(pinned?'Projekt lösen':'Projekt anheften'))}" aria-pressed="${pinned}" title="${esc(t(pinned?'Projekt lösen':'Projekt anheften'))}"><span aria-hidden="true">${pinned?'★':'☆'}</span></button></div>`;
    }).join('')}`:'';
    pop.innerHTML=h`<header><strong>Projekte</strong><button class="icon-btn" data-project-close aria-label="Schließen">${icon('close',14)}</button></header>`+group(t('Angeheftet'),pins)+group(t('Zuletzt geöffnet'),paths.filter(p=>!pins.includes(p)))+h`<footer><button class="btn ghost" data-project-browse>${icon('folder',14)} Anderes Repository öffnen …</button></footer>`;
  };
  paint();document.body.appendChild(pop);
  const rect=anchor.getBoundingClientRect();pop.style.width=`${Math.min(380,innerWidth-16)}px`;pop.style.left=`${Math.max(8,Math.min(rect.right-380,innerWidth-pop.offsetWidth-8))}px`;pop.style.top=`${rect.bottom+6}px`;pop.style.maxHeight=`${Math.max(160,innerHeight-rect.bottom-20)}px`;
  const listeners=new AbortController();const observer=new MutationObserver(()=>{if(!pop.isConnected){listeners.abort();observer.disconnect();anchor.setAttribute('aria-expanded','false');}});observer.observe(document.body,{childList:true});
  anchor.setAttribute('aria-expanded','true');
  document.addEventListener('pointerdown',event=>{if(!pop.contains(event.target as Node)&&!anchor.contains(event.target as Node))close();},{signal:listeners.signal});
  pop.addEventListener('click',event=>{
    const target=event.target as HTMLElement;
    if(target.closest('[data-project-close]')){close();return;}
    if(target.closest('[data-project-browse]')){close();onBrowse();return;}
    const pin=target.closest<HTMLElement>('[data-pin-path]')?.dataset.pinPath;
    if(pin){const next=pins.includes(pin)?pins.filter(p=>p!==pin):[...pins,pin];if(next.length>20){toast(t('Maximal 20 Projekte anheften'),'info');return;}try{localStorage.setItem(KEY,JSON.stringify(next));pins=next;paint();pop.querySelectorAll<HTMLButtonElement>('[data-pin-path]').forEach(b=>{if(b.dataset.pinPath===pin)b.focus();});}catch{toast(t('Projektfavoriten konnten nicht gespeichert werden'),'err');}return;}
    const path=target.closest<HTMLElement>('[data-project-path]')?.dataset.projectPath;
    if(path){close();if(path!==current)onOpen(path);}
  });
  pop.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
    const buttons=[...pop.querySelectorAll<HTMLButtonElement>('button')],index=buttons.indexOf(document.activeElement as HTMLButtonElement);
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}
    if(event.key==='Tab'){if(event.shiftKey&&index===0){event.preventDefault();buttons[buttons.length-1]?.focus();}else if(!event.shiftKey&&index===buttons.length-1){event.preventDefault();buttons[0]?.focus();}}
  });
  pop.querySelector<HTMLButtonElement>('.project-open, [data-project-browse]')?.focus();
}
