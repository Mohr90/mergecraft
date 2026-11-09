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
  await open('second.ts');
  const choices=()=>Array.from(document.querySelectorAll('[data-act="take-theirs"]'));
  assert(choices().length===3,'expected a partially resolvable mixed Git conflict');
  choices()[1].click();
  const earlierDraft=app.mergeEditor.resultText();
  await open('first.ts');
  const beforeBatch=app.mergeEditor.resultText();
  await until(()=>document.querySelector('[data-act="workspace-apply"]:not(:disabled)'));
  click('[data-act="workspace-apply"]');
  assert(app.mergeEditor.resultText().startsWith('check = 1\n<<<<<<<'),'local independent edit lost');
  assert(app.mergeEditor.resultText().endsWith('log = 1\n'),'incoming independent edit lost');
  assert((await invoke('status')).conflicts.length===10,'batch prematurely wrote to index');
  await open('second.ts');
  assert(app.mergeEditor.resultText()==='check = 1\ntimeout = 60\nlog = 1\n','batch changed prior manual choice');
  click('[data-act="undo"]');
  assert(app.mergeEditor.resultText()===earlierDraft,'undo lost earlier manual decision');
  await open('first.ts');
  assert(app.mergeEditor.resultText()===beforeBatch,'batch not undone across files');
  await until(()=>document.querySelector('[data-act="workspace-apply"]:not(:disabled)'));
  click('[data-act="workspace-apply"]');
  document.querySelector('.unresolved [data-act="take-theirs"]').click();
  await saved('first.ts');
  await open('second.ts');
  await saved('second.ts');
  for(const path of ['first.ts','second.ts']) assert(await content(path)==='check = 1\ntimeout = 60\nlog = 1\n','wrong saved text');
  notes.push('PASS native multi-file mixed conflict, grouped Undo, preserved manual decision and exact staged results');
  const beforeGuard=await content('auto.txt');
  const context=await invoke('conflict_data',{path:'auto.txt'});
  for(const args of [{expected_working:'stale working file'}, {expected_sources:['stale base','stale ours','stale theirs']}]) {
   let rejected=false;
   try{await invoke('save_conflict',{path:'auto.txt',text:'must not be written',mark_resolved:true,...args});}catch{rejected=true;}
   assert(rejected,'stale merge input accepted');assert(await content('auto.txt')===beforeGuard,'stale save changed working file');
  }
  notes.push('PASS stale worktree and index inputs rejected without overwriting');
  await open('auto.txt');assert(document.querySelector('[data-act="auto-resolve"]').disabled,'same-line proposal treated as safe');
  click('[data-act="auto-region"]');assert(app.mergeEditor.resultText()==='let x = 10; let y = 20;\n','auto preview wrong');
  assert((await invoke('status')).conflicts.some(e=>e.path==='auto.txt'),'auto resolved on disk before review');
  await saved('auto.txt');assert(await content('auto.txt')==='let x = 10; let y = 20;\n','auto save wrong');notes.push('PASS Auto Resolve previews separate same-line changes and saves only on confirmation');
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
  notes.push('PASS merge completed with all 10 original conflicts resolved');
 }catch(e){notes.push('FAIL '+(e.stack||e));}
 await invoke('selftest_report',{text:notes.join('\n')});
})();
