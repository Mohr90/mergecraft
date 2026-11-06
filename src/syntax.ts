// Presentation only: token colors never change source text or Git word highlights.
import hljs from 'highlight.js/lib/core';
import java from 'highlight.js/lib/languages/java';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import rust from 'highlight.js/lib/languages/rust';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import {esc} from './ui';
import type {WordSpan} from './api';
for(const [name,grammar] of Object.entries({java,typescript,javascript,json,rust,css,xml,python,bash})) hljs.registerLanguage(name,grammar);
const extensions:Record<string,string>={java:'java',ts:'typescript',tsx:'typescript',js:'javascript',jsx:'javascript',mjs:'javascript',cjs:'javascript',json:'json',rs:'rust',css:'css',html:'xml',htm:'xml',xml:'xml',svg:'xml',py:'python',sh:'bash',bash:'bash'};
const escapeCode=(text:string)=>esc(text).replace(/\r/g,'&#13;');
interface Token {text:string;classes:string;}
export class SyntaxDocument {
  private lines:Token[][]=[];
  constructor(path:string,text:string) {
    const language=extensions[path.split('.').pop()?.toLowerCase()??''];
    // Bound work on untrusted repository content; do not guess languages.
    if(!language||text.length>200_000||text.split('\n',6002).length>6000)return;
    try {
      const template=document.createElement('template');
      template.innerHTML=hljs.highlight(text,{language,ignoreIllegals:true}).value.replace(/\r/g,'&#13;');
      this.lines=[[]];
      const walk=(node:Node,classes:string)=>{
        if(node.nodeType===Node.TEXT_NODE) {
          const chunks=(node.textContent??'').split('\n');
          chunks.forEach((text,index)=>{if(index)this.lines.push([]);if(text)this.lines[this.lines.length-1].push({text,classes});});
        } else {
          const next=node instanceof HTMLElement ? [classes,...[...node.classList].filter(c=>/^(hljs-[\w-]+|[\w-]+_)$/.test(c))].filter(Boolean).join(' ') : classes;
          node.childNodes.forEach(child=>walk(child,next));
        }
      };
      walk(template.content,'');
    }catch{this.lines=[];}
  }
  line(index:number,text:string,marks?:WordSpan[]):string {
    const tokens=this.lines[index];
    // Preserve exact input even when a parser or caller provides mismatched lines.
    const parts=tokens?.map(t=>t.text).join('')===text?tokens:[{text,classes:''}];
    const ranges:[number,number][]=[];let offset=0;
    if(marks?.map(s=>s.text).join('')===text)for(const span of marks){if(span.changed)ranges.push([offset,offset+span.text.length]);offset+=span.text.length;}
    offset=0;
    return parts.map(token=>{
      const start=offset,end=start+token.text.length;offset=end;
      const cuts=[start,...ranges.flat().filter(x=>x>start&&x<end),end].sort((a,b)=>a-b);
      return cuts.slice(1).map((to,i)=>{
        const from=cuts[i];let body=escapeCode(token.text.slice(from-start,to-start));
        if(token.classes)body=`<span class="${token.classes}">${body}</span>`;
        if(ranges.some(([a,b])=>from>=a&&from<b))body=`<span class="w">${body}</span>`;
        return body;
      }).join('');
    }).join('');
  }
}
export function syntaxText(path:string,text:string):string {
  const doc=new SyntaxDocument(path,text);
  return text.split('\n').map((line,i)=>doc.line(i,line)).join('\n');
}
/** A decorative layer behind a normal textarea preserves native editing/IME/undo. */
export function colorEditor(area:HTMLTextAreaElement,path:string):HTMLElement {
  const wrap=document.createElement('div');wrap.className='syntax-editor'+(area.classList.contains('raw-edit')?' syntax-raw':'');
  const backdrop=document.createElement('pre');backdrop.className='syntax-backdrop';backdrop.setAttribute('aria-hidden','true');
  area.wrap='off';
  const update=()=>{backdrop.innerHTML=syntaxText(path,area.value)+'\n';backdrop.scrollTop=area.scrollTop;backdrop.scrollLeft=area.scrollLeft;};
  area.addEventListener('input',update);area.addEventListener('syntax-refresh',update);area.addEventListener('scroll',()=>{backdrop.scrollTop=area.scrollTop;backdrop.scrollLeft=area.scrollLeft;});
  wrap.append(backdrop,area);update();return wrap;
}
