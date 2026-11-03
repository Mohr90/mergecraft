import { branchSync } from "../src/sync";
import { askText, confirmDialog, toast } from "../src/ui";
import { chooseRollback } from "../src/rollback";
import { renderTags } from "../src/tags";
import { DiffView } from "../src/diff";
import { MergeEditor, simpleConflictResolution } from "../src/merge";
import { mockInvoke } from "../src/mock";
import { canMergeInto } from "../src/workflow";
import { openBranchMenu } from "../src/branchmenu";
import { renderBranches, renderChanges } from "../src/panels";
const results: string[] = [];
const fixture = document.querySelector('#fixture') as HTMLElement;
async function test(name: string, fn: () => void | Promise<void>) {
  fixture.innerHTML = '';
  try { await fn(); results.push(`PASS ${name}`); }
  catch(e) { results.push(`FAIL ${name}: ${e}`); }
}
function assert(ok: unknown, message: string) { if (!ok) throw new Error(message); }
function click(selector: string) { (fixture.querySelector(selector) as HTMLElement).click(); }
await test('sync status separates unpublished commits from missing or unknown tracking',async()=>{
 const branch=(await mockInvoke('branches'))[0];branch.upstream='origin/main';branch.tracking_known=true;
 for(const [ahead,behind,tone,words] of [[0,0,'ok','Synchron'],[2,0,'pending','2 ungepushte'],[0,1,'incoming','Remote-Commit fehlt'],[2,1,'pending','Remote-Commit fehlt']] as const){const value=branchSync({...branch,ahead,behind});assert(value.tone===tone&&value.label.includes(words),'wrong sync state');}
 assert(branchSync({...branch,tracking_known:false}).tone==='unknown','unknown tracking claimed synced');
 assert(branchSync({...branch,upstream:null}).label==='Kein Upstream','untracked branch claimed unpublished');
});
await test('toasts are bounded dismissible escaped and pause while reading',async()=>{
 const host=document.createElement('div');host.className='toasts';document.body.appendChild(host);
 try {
  toast('<img src=x onerror=alert(1)>','err');assert(!host.querySelector('img'),'toast HTML injection');
  assert(host.querySelector('[role="alert"]')?.textContent?.includes('<img'),'error not readable');
  toast('same','info');toast('same','info');assert(host.children.length===2,'duplicate notifications');
  toast('third');toast('fourth');assert(host.children.length===3,'notification flood');
  host.querySelector<HTMLButtonElement>('.toast-close')!.click();assert(host.children.length===2,'dismiss failed');
  host.replaceChildren();toast('read me','info',80);const node=host.firstElementChild!;
  node.dispatchEvent(new Event('mouseenter'));await new Promise(r=>setTimeout(r,110));assert(node.isConnected,'toast expired while reading');
  node.dispatchEvent(new Event('mouseleave'));await new Promise(r=>setTimeout(r,110));assert(!node.isConnected,'toast timer never resumed');
 }finally{host.remove();}
});
await test('raw edits survive attempted return to blocks', async () => {
  let saved = '';
  const editor = new MergeEditor({save: async text => { saved = text; return {ok:true,message:'ok'}; }, onSaved(){}, onError(){}, onClose(){}});
  editor.load(await mockInvoke('conflict_data', {path:'src/main.rs'})); editor.mount(fixture);
  click('[data-act="raw"]');
  const raw = fixture.querySelector('.raw-edit') as HTMLTextAreaElement;
  raw.value = 'individuell\n'; raw.dispatchEvent(new Event('input'));
  click('[data-act="raw"]'); click('[data-act="save"]');
  await new Promise(r => setTimeout(r, 0));
  assert(saved === 'individuell\n', `saved ${JSON.stringify(saved)}`);
});

await test('simple auto resolution merges separate edits but refuses overlap and ambiguous text',()=>{
  const cases:[string[],string[],string[],string[]|null][]=[
    [['let x = 1; let y = 2;'],['let x = 10; let y = 2;'],['let x = 1; let y = 20;'],['let x = 10; let y = 20;']],
    [['x=1'],['x=2'],['x=3'],null],
    [['x=1;y=1;'],['x=2;y=1;'],['x=1;y=3;'],null],
    [['base'],[],['changed'],null],
    [[],['new'],['different'],null],
    [[],['same'],['same'],['same']],
    [['base'],[],[],[]],
    [['base'],['base'],['incoming'],['incoming']],
    [['a','b'],['a','local'],['incoming','b'],['incoming','local']],
  ];
  for(const [base,left,right,expected] of cases) assert(JSON.stringify(simpleConflictResolution(base,left,right))===JSON.stringify(expected),'unexpected auto result '+JSON.stringify([base,left,right]));
});
async function conflictFixture(base:string,ours:string,theirs:string,regions:any[]) {
  const d=await mockInvoke('conflict_data',{path:'test.txt'});
  d.base.text=base;d.ours.text=ours;d.theirs.text=theirs;d.regions=regions;d.guarded=false;d.working_modified=false;d.trailing_newline=true;
  return d;
}
const oneConflict=[{kind:'conflict',base:[0,1],ours:[0,1],theirs:[0,1]}];
await test('auto resolve previews simple conflicts and does not write or overwrite decisions',async()=>{
  let writes=0;const editor=new MergeEditor({save:async()=>{writes++;return {ok:true,message:'ok'};},onSaved(){},onError(){},onClose(){}});
  const d=await conflictFixture('let x = 1; let y = 2;\n','let x = 10; let y = 2;\n','let x = 1; let y = 20;\n',oneConflict);
  editor.load(d);editor.mount(fixture);click('[data-act="auto-resolve"]');
  assert(editor.resultText()==='let x = 10; let y = 20;\n','simple edit not combined');assert(writes===0,'auto resolve wrote file');
  assert(editor.hasUnsavedChanges(),'auto result not dirty');
  click('[data-act="accept-theirs-all"]');assert(editor.resultText()==='let x = 10; let y = 20;\n','bulk overwrote resolved result');
  click('[data-act="save-resolve"]');await new Promise(r=>setTimeout(r,0));assert(writes===1,'result did not save');
  click('[data-act="revert"]');assert(editor.hasUnsavedChanges(),'undo after save not dirty');
  d.guarded=true;editor.load(d);editor.mount(fixture);assert(fixture.querySelector<HTMLButtonElement>('[data-act="auto-resolve"]')!.disabled,'guarded auto resolve enabled');
});
await test('left right and both act on the selected block and bulk keeps prior decisions',async()=>{
  const editor=new MergeEditor({save:async()=>({ok:true,message:'ok'}),onSaved(){},onError(){},onClose(){}});
  const d=await conflictFixture('base1\nbase2\n','left1\nleft2\n','right1\nright2\n',[...oneConflict,{kind:'conflict',base:[1,1],ours:[1,1],theirs:[1,1]}]);
  editor.load(d);editor.mount(fixture);click('.region[data-region="0"] [data-act="take-ours"]');click('[data-act="accept-theirs-all"]');
  assert(editor.resultText()==='left1\nright2\n','left / remaining right mismatch');
  click('[data-act="accept-ours-all"]');assert(editor.resultText()==='left1\nright2\n','bulk overwrote prior choices');
  click('.region[data-region="1"] [data-act="take-both"]');assert(editor.resultText()==='left1\nleft2\nright2\n','both order or duplication wrong');
  click('[data-act="raw"]');const raw=fixture.querySelector<HTMLTextAreaElement>('.raw-edit')!;raw.value='custom\n';raw.dispatchEvent(new Event('input'));
  assert(fixture.querySelector<HTMLButtonElement>('[data-act="accept-ours-all"]')!.disabled,'raw bulk enabled');
  assert(fixture.querySelector<HTMLButtonElement>('[data-act="auto-resolve"]')!.disabled,'raw auto enabled');
});
await test('accepting the final conflict preserves the selected side final newline',async()=>{
  const editor=new MergeEditor({save:async()=>({ok:true,message:'ok'}),onSaved(){},onError(){},onClose(){}});
  editor.load(await conflictFixture('base\n','left\n','right',oneConflict));editor.mount(fixture);
  click('[data-act="take-theirs"]');assert(editor.resultText()==='right','right gained unwanted final newline');
  click('[data-act="take-ours"]');assert(editor.resultText()==='left\n','left lost final newline');
});
await test('merge decisions retain keyboard focus and report progress and unsaved state',async()=>{
  const editor=new MergeEditor({save:async()=>({ok:true,message:'ok'}),onSaved(){},onError(){},onClose(){}});
  editor.load(await conflictFixture('one\ntwo\n','left1\nleft2\n','right1\nright2\n',[...oneConflict,{kind:'conflict',base:[1,1],ours:[1,1],theirs:[1,1]}]));editor.mount(fixture);
  const left=fixture.querySelector<HTMLButtonElement>('.region[data-region="1"] [data-act="take-ours"]')!;left.focus();left.click();
  assert((document.activeElement as HTMLElement).dataset.act==='take-ours','decision lost keyboard focus');
  assert(document.activeElement?.closest<HTMLElement>('.region')?.dataset.region==='1','focus jumped to another block');
  assert(fixture.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')==='1','progress incorrect');
  assert(fixture.querySelector('.edit-state')!.textContent==='Nicht gespeichert','dirty state missing');
  click('[data-act="accept-theirs-all"]');assert(fixture.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')==='2','bulk progress incorrect');
  assert(editor.resultText()==='right1\nleft2\n','bulk overwrote prior choice');
  click('[data-act="save"]');await new Promise(r=>setTimeout(r,0));assert(!fixture.querySelector('.edit-state')!.textContent,'saved state remains dirty');
});
await test('merge navigation uses reduced motion and avoids a second focus scroll',async()=>{
  const editor=new MergeEditor({save:async()=>({ok:true,message:'ok'}),onSaved(){},onError(){},onClose(){}});
  editor.load(await conflictFixture('base\n','left\n','right\n',oneConflict));editor.mount(fixture);
  const region=fixture.querySelector<HTMLElement>('.region')!;let behavior='';
  const originalMatch=window.matchMedia;
  const originalScroll=region.scrollIntoView;
  try {
    window.matchMedia=((query:string)=>({...originalMatch.call(window,query),matches:true})) as typeof window.matchMedia;
    region.scrollIntoView=((options:ScrollIntoViewOptions)=>{behavior=String(options.behavior);}) as typeof region.scrollIntoView;
    click('[data-act="next"]');assert(behavior==='auto','reduced motion scroll animated');
    assert(document.activeElement===region.querySelector('.cf-edit'),'navigation did not focus result');
  }finally{window.matchMedia=originalMatch;region.scrollIntoView=originalScroll;}
});
await test('multi-hunk auto proposals combine separate edits and keep overlaps manual',()=>{
 const cases:[string[],string[],string[],string[]|null][]=[
  [['const a=1; const b=2; const c=3;'],['const a=10; const b=2; const c=30;'],['const a=1; const b=20; const c=3;'],['const a=10; const b=20; const c=30;']],
  [['a','b','c'],['A','b','c'],['a','b','C'],['A','b','C']],
  [['a','b','c','d','e'],['a','extra','b','c','d','e'],['a','b','c','d','E'],['a','extra','b','c','d','E']],
  [['a','b','c'],['a','X','c'],['a','Y','c'],null],
  [[],['one'],['two'],null],
 ];
 for(const [base,left,right,expected] of cases) assert(JSON.stringify(simpleConflictResolution(base,left,right))===JSON.stringify(expected),'wrong multi-hunk proposal '+JSON.stringify([base,left,right]));
});
await test('a proposal can be reviewed and accepted for just one block then undone',async()=>{
 const editor=new MergeEditor({save:async()=>({ok:true,message:'ok'}),onSaved(){},onError(){},onClose(){}});
 editor.load(await conflictFixture('x=1; y=2;\nbase\n','x=10; y=2;\nleft\n','x=1; y=20;\nright\n',[...oneConflict,{kind:'conflict',base:[1,1],ours:[1,1],theirs:[1,1]}]));editor.mount(fixture);
 const initial=editor.resultText();assert(!!fixture.querySelector('.auto-suggestion'),'proposal missing');
 click('.auto-suggestion summary');assert(editor.resultText()===initial,'review changed result');
 click('[data-act="auto-region"]');assert(editor.resultText().includes('x=10; y=20;')&&editor.resultText().includes('<<<<<<<'),'proposal changed other conflict');
 click('[data-act="undo"]');assert(editor.resultText()===initial,'proposal undo failed');
});
await test('undo redo and reset preserve decisions and remain independent of saved files',async()=>{
 const editor=new MergeEditor({save:async()=>({ok:true,message:'ok'}),onSaved(){},onError(){},onClose(){}});
 editor.load(await conflictFixture('one\ntwo\n','left1\nleft2\n','right1\nright2\n',[...oneConflict,{kind:'conflict',base:[1,1],ours:[1,1],theirs:[1,1]}]));editor.mount(fixture);
 const initial=editor.resultText();click('.region[data-region="0"] [data-act="take-ours"]');const first=editor.resultText();
 click('[data-act="accept-theirs-all"]');const both=editor.resultText();
 click('[data-act="undo"]');assert(editor.resultText()===first,'bulk undo lost prior choice');
 click('[data-act="undo"]');assert(editor.resultText()===initial&&!editor.hasUnsavedChanges(),'undo to initial incorrect');
 click('[data-act="redo"]');click('[data-act="redo"]');assert(editor.resultText()===both,'redo failed');
 click('[data-act="save"]');await new Promise(r=>setTimeout(r,0));click('[data-act="undo"]');assert(editor.hasUnsavedChanges(),'undo after save not dirty');
 click('[data-act="reset-preview"]');(document.querySelector('dialog [data-i="1"]') as HTMLElement).click();await new Promise(r=>setTimeout(r,0));assert(editor.resultText()===initial,'reset did not restore opening state');
 click('[data-act="undo"]');assert(editor.resultText()===first,'reset cannot be undone');
});
await test('text editing participates in undo redo including free result mode',async()=>{
 const editor=new MergeEditor({save:async()=>({ok:true,message:'ok'}),onSaved(){},onError(){},onClose(){}});
 editor.load(await conflictFixture('base\n','left\n','right\n',oneConflict));editor.mount(fixture);
 const initial=editor.resultText();const area=fixture.querySelector<HTMLTextAreaElement>('.cf-edit')!;area.value='manual';area.dispatchEvent(new Event('input'));
 click('[data-act="undo"]');assert(editor.resultText()===initial,'block text undo failed');click('[data-act="redo"]');assert(editor.resultText()==='manual\n','block text redo failed');
 click('[data-act="raw"]');let raw=fixture.querySelector<HTMLTextAreaElement>('.raw-edit')!;raw.value='free result\n';raw.dispatchEvent(new Event('input'));
 raw.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}));
 assert(fixture.querySelector<HTMLTextAreaElement>('.raw-edit')!.value==='manual\n','raw undo failed');
 click('[data-act="redo"]');assert(fixture.querySelector<HTMLTextAreaElement>('.raw-edit')!.value==='free result\n','raw redo failed');
});
await test('manual block markers cannot be resolved and failed saves preserve dirty edits',async()=>{
  let writes=0;let errors=0;const editor=new MergeEditor({save:async()=>{writes++;return {ok:false,message:'failure'};},onSaved(){},onError(){errors++;},onClose(){}});
  editor.load(await conflictFixture('base\n','left\n','right\n',oneConflict));editor.mount(fixture);
  const area=fixture.querySelector<HTMLTextAreaElement>('.cf-edit')!;area.value='<<<<<<< still open';area.dispatchEvent(new Event('input'));click('[data-act="save-resolve"]');await new Promise(r=>setTimeout(r,0));
  assert(writes===0&&errors===1,'manual markers were saved as resolved');
  click('[data-act="take-theirs"]');click('[data-act="save-resolve"]');await new Promise(r=>setTimeout(r,0));assert(writes===1&&editor.hasUnsavedChanges(),'failed save lost dirty state');
});
await test('saving locks result editing and duplicate save requests',async()=>{
  let writes=0;let finish!:(value:any)=>void;
  const editor=new MergeEditor({save:()=>{writes++;return new Promise(resolve=>finish=resolve);},onSaved(){},onError(){},onClose(){}});
  editor.load(await conflictFixture('base\n','left\n','right\n',oneConflict));editor.mount(fixture);click('[data-act="take-ours"]');click('[data-act="save"]');click('[data-act="save"]');
  assert(writes===1,'duplicate concurrent save');assert(fixture.querySelector<HTMLTextAreaElement>('.cf-edit')!.readOnly,'result editable during save');
  finish({ok:true,message:'ok'});await new Promise(r=>setTimeout(r,0));assert(!fixture.querySelector<HTMLTextAreaElement>('.cf-edit')!.readOnly,'result stayed locked');
});
await test('typing m in branch search does not merge', async () => {
  const anchor = document.createElement('button'); fixture.append(anchor);
  let merges = 0;
  openBranchMenu(anchor, await mockInvoke('branches'), {onCheckout(){},onMerge(){merges++;},onDelete(){},onNewFrom(){},onCompare(){},onCreate(){}});
  const input = document.querySelector('.popover input') as HTMLInputElement;
  input.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowDown',bubbles:true}));
  const event = new KeyboardEvent('keydown', {key:'m',bubbles:true,cancelable:true}); input.dispatchEvent(event);
  assert(merges === 0 && !event.defaultPrevented, 'm intercepted');
  document.querySelector('.popover')?.remove();
});
await test('changes offer one global selection instead of repeated group checkboxes', async()=>{
  const status=await mockInvoke('status');fixture.append(renderChanges({status:()=>status} as any));
  assert(fixture.querySelectorAll('[data-stage-all]').length===1,'global selection missing or duplicated');
  assert(!fixture.querySelector('[data-stage-group]'),'redundant group selections remain');
  assert(fixture.querySelectorAll('[data-stage-file]').length===status.staged.length+status.changed.length+status.untracked.length,'file selections missing');
});
await test('changes expose only explicit new or amend commit without stash controls', async()=>{
  const status=await mockInvoke('status'); status.merging=false;status.conflicts=[]; let submitted:any[]=[];
  fixture.append(renderChanges({snapshot:()=>({head:"abc"}),status:()=>status,commit:(...args:any[])=>submitted=args} as any));
  assert(!fixture.querySelector('[data-top-act="stash-save"],.stash-section,.opt-all,.opt-sign,.opt-amend'),'removed controls remain');
  const mode=fixture.querySelector<HTMLSelectElement>('.commit-mode')!;
  assert(mode.value==='new','default must create a new commit');
  fixture.querySelector<HTMLTextAreaElement>('.commit-msg')!.value='message';
  click('[data-top-act="commit"]'); assert(JSON.stringify(submitted)==='["message",false]','new commit arguments');
  mode.value='amend';mode.dispatchEvent(new Event('change'));
  click('[data-top-act="commit"]'); assert(JSON.stringify(submitted)==='["message",true]','amend commit arguments');
});
await test('clean worktree blocks new commit but permits amend and explains staging',async()=>{
 const status=await mockInvoke('status');status.merging=false;
 for(const key of ['all','staged','changed','untracked','conflicts'])status[key]=[];
 const ctx:any={status:()=>status,snapshot:()=>({head:'abc'})};
 const render=()=>{fixture.innerHTML='';fixture.append(renderChanges(ctx));};render();
 assert(fixture.querySelector<HTMLButtonElement>('[data-top-act="commit"]')!.disabled,'empty new commit enabled');
 assert(fixture.querySelector('.commit-hint')!.textContent!.includes('nichts Neues'),'missing clean explanation');
 const mode=fixture.querySelector<HTMLSelectElement>('.commit-mode')!;mode.value='amend';mode.dispatchEvent(new Event('change'));
 assert(!fixture.querySelector<HTMLButtonElement>('[data-top-act="commit"]')!.disabled,'message-only amend blocked');
 status.all=[{path:'test.txt'}];render();
 assert(fixture.querySelector('.commit-hint')!.textContent!.includes('Hake zuerst'),'missing staging instruction');
});
await test('staging checkboxes reflect index state and only toggle their own paths', async()=>{
  const status=await mockInvoke('status');status.conflicts=[];
  status.staged=[{...status.changed[0],index:'M'}];
  let staged:string[]=[];let unstaged:string[]=[];
  const ctx:any={status:()=>status,stage:(paths:string[])=>staged=paths,unstage:(paths:string[])=>unstaged=paths};
  const render=()=>{fixture.innerHTML='';fixture.append(renderChanges(ctx));};render();
  assert(fixture.querySelector<HTMLInputElement>('[data-stage-all]')!.indeterminate,'mixed selection missing');
  const selected=fixture.querySelector<HTMLInputElement>('[data-stage-file="staged"]')!;
  assert(selected.checked,'index row not checked');selected.click();
  assert(JSON.stringify(unstaged)===JSON.stringify([status.staged[0].path]),'unstaged unrelated files');
  render();const pending=fixture.querySelector<HTMLInputElement>('[data-stage-file="work"]')!;
  assert(!pending.checked,'worktree row checked');pending.click();
  assert(JSON.stringify(staged)===JSON.stringify([status.changed[0].path]),'staged unrelated files');
  assert(!!fixture.querySelector('.partial-stage'),'partial staging explanation missing');
  render();fixture.querySelector<HTMLInputElement>('[data-stage-all]')!.click();
  assert(JSON.stringify(staged)===JSON.stringify([...new Set([...status.changed,...status.untracked].map(e=>e.path))]),'select all changed wrong paths');
  status.changed=[];status.untracked=[];render();
  assert(fixture.querySelector<HTMLInputElement>('[data-stage-all]')!.checked,'all-staged checkbox not checked');
  fixture.querySelector<HTMLInputElement>('[data-stage-all]')!.click();
  assert(JSON.stringify(unstaged)===JSON.stringify(status.staged.map(e=>e.path)),'uncheck all changed wrong paths');

});
await test('raw conflict markers cannot be marked resolved', async () => {
  let saves = 0;
  const editor = new MergeEditor({save: async()=>{saves++;return {ok:true,message:'ok'};},onSaved(){},onError(){},onClose(){}});
  editor.load(await mockInvoke('conflict_data',{path:'src/main.rs'})); editor.mount(fixture);
  click('[data-act="raw"]'); click('[data-act="save-resolve"]');
  await new Promise(r=>setTimeout(r,0)); assert(saves===0,'unresolved markers saved as resolved');
});
await test('guarded changes serialize conflict markers', async()=>{
  const editor = new MergeEditor({save:async()=>({ok:true,message:'ok'}),onSaved(){},onError(){},onClose(){}});
  const data = await mockInvoke('conflict_data',{path:'a'});
  data.guarded = true; data.regions = [{kind:'ours_only',base:[0,1],ours:[0,1],theirs:[0,1]}];
  editor.load(data); assert(editor.resultText().includes('<<<<<<<'),'guarded undecided change silently serialized');
});
await test('dialogs do not reuse stale handlers and escape cancels', async()=>{
  const first = askText('One','Name','first');
  (document.querySelector('dialog input') as HTMLInputElement).value='chosen';
  (document.querySelector('[data-v="ok"]') as HTMLElement).click();
  assert(await first==='chosen','first result');
  const second = askText('Two','Name','second');
  (document.querySelector('[data-v="ok"]') as HTMLElement).click();
  assert(await second==='second','stale result reused');
  const cancel = confirmDialog('Cancel');
  document.querySelector('dialog')!.dispatchEvent(new Event('cancel',{cancelable:true}));
  assert(await cancel===false,'cancel result');
});
await test('binary diff can be closed',async()=>{
  let closed=false; const view = new DiffView(()=>closed=true);
  const data = await mockInvoke('file_diff',{path:'asset'}); data.binary=true;
  view.set(data); view.mount(fixture); click('[data-act="close"]'); assert(closed,'binary diff close inactive');
});
await test('saved working resolution loads without reconstructing old conflicts',async()=>{
  const editor=new MergeEditor({save:async()=>({ok:true,message:'ok'}),onSaved(){},onError(){},onClose(){}});
  const data=await mockInvoke('conflict_data',{path:'a'});data.working_modified=true;data.merged.text='saved manual result\n';
  editor.load(data);editor.mount(fixture);
  assert((fixture.querySelector('.raw-edit') as HTMLTextAreaElement)?.value===data.merged.text,'saved text replaced');
  assert(!editor.hasUnsavedChanges(),'loading marks saved text as dirty');
});
await test('branch view restores query, scope and sorting', async()=>{
  const branches=await mockInvoke('branches');
  const state={query:'feature',scope:'remote',sort:'name',scrollTop:0};
  const ctx:any={branches:()=>branches,snapshot:()=>({head_branch:'main'}),mergeNoFF:()=>true,setMergeNoFF(){}};
  fixture.append((renderBranches as any)(ctx,state));
  assert((fixture.querySelector('input[type="search"]') as HTMLInputElement).value==='feature','query lost');
  assert((fixture.querySelector('.branch-scope') as HTMLSelectElement).value==='remote','scope lost');
  assert(fixture.querySelectorAll('.branch-row').length===1,'wrong restored results');
});
await test('branch menus no longer offer rename',async()=>{
  const branches=await mockInvoke('branches');
  const ctx:any={branches:()=>branches,snapshot:()=>({head_branch:'main'}),mergeNoFF:()=>true,setMergeNoFF(){}};
  fixture.append(renderBranches(ctx));
  assert(!fixture.querySelector('[data-b-act="rename"]'),'rename still offered');
});
await test('master and main use merge requests while work branches keep local merging',async()=>{
  assert(!canMergeInto('master')&&!canMergeInto('main')&&!canMergeInto(null),'integration branch allowed');
  assert(canMergeInto('feature/payments')&&canMergeInto('master-fix'),'work branch blocked');
  const branches=await mockInvoke('branches');
  const ctx:any={branches:()=>branches,snapshot:()=>({head_branch:'master'}),mergeNoFF:()=>true,setMergeNoFF(){}};
  fixture.append(renderBranches(ctx));assert(!fixture.querySelector('[data-b-act="merge"],.opt-noff'),'master offers merging');
  fixture.innerHTML='';ctx.snapshot=()=>({head_branch:'feature/work'});fixture.append(renderBranches(ctx));assert(!!fixture.querySelector('[data-b-act="merge"]'),'work branch lost merge');
  let merges=0;const anchor=document.createElement('button');fixture.appendChild(anchor);
  openBranchMenu(anchor,branches,{allowMerge:false,onCheckout(){},onMerge(){merges++;},onDelete(){},onNewFrom(){},onCompare(){},onCreate(){}});
  assert(!document.querySelector('.popover [data-act="merge"]'),'quick switch offers integration merge');
  const input=document.querySelector<HTMLInputElement>('.popover input')!;
  input.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',altKey:true,bubbles:true,cancelable:true}));
  assert(merges===0,'shortcut bypassed merge-request workflow');document.querySelector('.popover')?.remove();
});
await test('tag view filters tags and blocks actions on non-commit objects',async()=>{
  const tags=await mockInvoke('tags');
  tags.push({...tags[0],name:'blob-only',commit:null,is_annotated:false});
  const state:any={query:'',scope:'all',sort:'recent',scrollTop:0};
  const ctx:any={tags:()=>tags,snapshot:()=>({head:'abc'}),compareTag(){},showTagCommit(){},newFromTag(){}};
  fixture.append(renderTags(ctx,state));
  const blob=fixture.querySelector('[data-tag-name="blob-only"]')!;
  assert([...blob.querySelectorAll('button')].every(b=>b.disabled),'non-commit tag permits commit actions');
  const input=fixture.querySelector('input') as HTMLInputElement;input.value='v2.4';input.dispatchEvent(new Event('input'));
  assert(fixture.querySelectorAll('.tag-row').length===1,'tag search failed');
  assert(state.query==='v2.4','tag search state not retained');
});
await test('rollback preview keeps explicit selection and can be cancelled',async()=>{
  const status=await mockInvoke('status');const files=status.changed;
  const pending=chooseRollback(files,[files[0].path]);
  const boxes=[...document.querySelectorAll<HTMLInputElement>('[data-rollback-file]')];
  assert(boxes[0].checked && boxes.slice(1).every(box=>!box.checked),'unexpected default selection');
  boxes[0].checked=false;boxes[0].dispatchEvent(new Event('change',{bubbles:true}));
  assert((document.querySelector('[data-rollback-confirm]') as HTMLButtonElement).disabled,'empty rollback enabled');
  (document.querySelector('[data-rollback-cancel]') as HTMLElement).click();assert(await pending===null,'cancel executed rollback');
  const second=chooseRollback(files,[files[1].path]);(document.querySelector('[data-rollback-confirm]') as HTMLElement).click();
  assert(JSON.stringify(await second)===JSON.stringify([files[1].path]),'wrong rollback target');
});
await test('lightweight tags have no type badge',async()=>{
  const tags=await mockInvoke('tags');
  fixture.append(renderTags({tags:()=>tags,snapshot:()=>({head:'x'} as any),compareTag(){},showTagCommit(){},newFromTag(){}},{query:'',scope:'all',sort:'recent',scrollTop:0}));
  assert(!fixture.querySelector('[data-tag-name="snapshot/ui"] .chip'),'lightweight tag badge remains');
});
document.querySelector('#results')!.textContent = results.join('\n');
document.title = results.some(r=>r.startsWith('FAIL')) ? 'FAIL' : 'PASS';
