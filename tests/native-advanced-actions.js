(async()=>{
 const invoke=window.__TAURI__.core.invoke,app=window.mergecraft,notes=[];
 const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const assert=(ok,message)=>{if(!ok)throw new Error(message);};
 const until=async fn=>{for(let i=0;i<160;i++){if(await fn())return;await wait(75);}throw new Error('Timeout '+fn);};
 const click=selector=>{const node=document.querySelector(selector);assert(node,'Missing '+selector);node.click();};
 const open=async path=>{await until(()=>!app.mergeEditor.isSaving());await app.openMerge(path);await until(()=>document.querySelector('.merge-head .name')?.textContent===path);};
 const saved=async path=>{click('[data-act="save-resolve"]');await until(async()=>!(await invoke('status')).conflicts.some(e=>e.path===path));};
 const content=async(path)=>{const d=await invoke('file_diff',{rev_a:'HEAD',rev_b:'WORK',path,label_a:null,label_b:null});return d.b_text;};
 try {
  await until(()=>document.querySelector('.branches-panel'));
  const initial=await invoke('status');assert(initial.conflicts.length===10,'fixture must contain 10 Git conflicts');
  await open('imports.ts');
  const pending = app.mergeEditor.resultText();
  click('[data-act="review-next"]');
  assert(document.querySelector('details.auto-suggestion[open]'), 'import preview missing');
  assert(app.mergeEditor.resultText() === pending, 'review mutated the draft');
  assert(document.querySelector('[data-act="auto-resolve"]').disabled, 'imports entered the safe batch');
  click('[data-act="auto-region"]');
  await saved('imports.ts');
  assert(await content('imports.ts') === "import { Local } from './local';\nimport { Remote } from './remote';\nexport {};\n", 'import order or content changed');
  notes.push('PASS review concurrent TypeScript imports and stage both declarations');
  await open('auto.txt');assert(document.querySelector('[data-act="auto-resolve"]').disabled,'same-line proposal treated as safe');
  click('[data-act="auto-region"]');assert(app.mergeEditor.resultText()==='let x = 10; let y = 20;\n','auto preview wrong');
  assert((await invoke('status')).conflicts.some(e=>e.path==='auto.txt'),'auto resolved on disk before review');
  await saved('auto.txt');assert(await content('auto.txt')==='let x = 10; let y = 20;\n','auto save wrong');notes.push('PASS Auto Resolve previews separate same-line changes and saves only on confirmation');
  await open('advanced.txt');const expectedAdvanced='const a=10;\nconst b=20;\nconst c=30;\n';
  const beforeProposal=app.mergeEditor.resultText();click('.auto-suggestion summary');assert(app.mergeEditor.resultText()===beforeProposal,'review changed proposal');
  click('[data-act="auto-region"]');assert(app.mergeEditor.resultText()===expectedAdvanced,'multiline proposal wrong');
  click('[data-act="undo"]');assert(app.mergeEditor.resultText()===beforeProposal,'native undo wrong');
  click('[data-act="redo"]');assert(app.mergeEditor.resultText()===expectedAdvanced,'native redo wrong');
  click('[data-act="save"]');await until(()=>!app.mergeEditor.hasUnsavedChanges());
  click('[data-act="undo"]');assert(app.mergeEditor.hasUnsavedChanges(),'undo after saved preview not dirty');click('[data-act="redo"]');
  assert(!app.mergeEditor.hasUnsavedChanges(),'redo to saved state not clean');await saved('advanced.txt');
  assert(await content('advanced.txt')===expectedAdvanced,'saved multiline content differs');notes.push('PASS multiline proposals, review, Undo/Redo and saved-state restoration');
  for(const [path,action,expected] of [['left.txt','take-ours','local\n'],['right.txt','take-theirs','incoming\n'],['both.txt','take-both','local\nincoming\n'],['tail.txt','take-theirs','incoming']]){
   await open(path);click('[data-act="'+action+'"]');await saved(path);assert(await content(path)===expected,path+' content mismatch');
  }
  notes.push('PASS Accept Left, Accept Right, Both, and missing final newline preserve expected text');
  await open('overlap.txt');assert(document.querySelector('[data-act="auto-resolve"]').disabled,'overlap guessed automatically');
  click('[data-act="save-resolve"]');await wait(150);assert((await invoke('status')).conflicts.some(e=>e.path==='overlap.txt'),'unresolved conflict marked resolved');
  click('[data-act="take-theirs"]');await saved('overlap.txt');notes.push('PASS overlapping edits stay manual; unresolved save is blocked');
  for(const [path,action] of [['removed.txt','whole-ours'],['binary.dat','whole-theirs']]){
   await open(path);click('[data-act="'+action+'"]');await until(()=>document.querySelector('dialog[open]'));click('dialog [data-i="1"]');
   await until(async()=>!(await invoke('status')).conflicts.some(e=>e.path===path));
  }
  const removed=await invoke('file_diff',{rev_a:'HEAD',rev_b:'WORK',path:'removed.txt',label_a:null,label_b:null});assert(removed.b_missing,'chosen deletion restored the file');
  const bytes=await invoke('git_raw',{args:['hash-object','binary.dat']});const theirs=await invoke('git_raw',{args:['rev-parse','incoming:binary.dat']});assert(bytes.stdout===theirs.stdout,'binary bytes corrupted');
  assert(await content('clean.txt')==='local\nmiddle\nincoming\n','nonconflicting edits lost');assert(await content('notes.txt')==='leave me alone\n','unrelated worktree changed');
  notes.push('PASS modify/delete choice, binary bytes, automatic nonconflicting edits and unrelated worktree preserved');
  assert((await invoke('status')).conflicts.length===0,'conflicts remain');await invoke('merge_continue');assert(!(await invoke('snapshot')).merging,'merge not finalized');
  assert(await content('personal.txt')==='my unrelated local work\n','unrelated tracked work lost');notes.push('PASS merge completed with all 10 original conflicts resolved');
 }catch(e){notes.push('FAIL '+(e.stack||e));}
 await invoke('selftest_report',{text:notes.join('\n')});
})();
