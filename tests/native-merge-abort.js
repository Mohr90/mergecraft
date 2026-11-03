(async()=>{
 const invoke=window.__TAURI__.core.invoke,app=window.mergecraft,notes=[];
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
 const until=async fn=>{for(let i=0;i<180;i++){if(await fn())return;await wait(70);}throw new Error('Timeout '+fn);};
 const click=s=>{const n=document.querySelector(s);assert(n,'Missing '+s);n.click();};
 const content=async path=>(await invoke('file_diff',{rev_a:'HEAD',rev_b:'WORK',path,label_a:null,label_b:null})).b_text;
 try{
  await until(()=>document.querySelector('.branches-panel'));
  const before=await invoke('snapshot');const stashes=(await invoke('stashes')).length;
  await app.openMerge('auto.txt');click('[data-act="auto-resolve"]');click('[data-act="save"]');await until(()=>!app.mergeEditor.hasUnsavedChanges());
  await app.openMerge('left.txt');click('[data-act="take-theirs"]');click('[data-act="save-resolve"]');
  await until(async()=>!(await invoke('status')).conflicts.some(e=>e.path==='left.txt'));
  await until(()=>!app.mergeEditor.isSaving());await app.openMerge('right.txt');await until(()=>!document.querySelector('.shell.busy'));click('[data-act="take-ours"]');const selected=app.mergeEditor.resultText();
  click('[data-act="abort-merge"]');await until(()=>document.querySelector('dialog[open]'));click('dialog [data-i="0"]');
  assert(app.mergeEditor.resultText()===selected&&app.mergeEditor.hasUnsavedChanges(),'cancel lost decisions');assert((await invoke('snapshot')).merging,'cancel aborted merge');
  notes.push('PASS abort cancellation preserves dirty preview and running merge');
  click('[data-act="abort-merge"]');await until(()=>document.querySelector('dialog[open]'));click('dialog [data-i="1"]');
  await until(async()=>!(await invoke('snapshot')).merging&&!document.querySelector('.shell.busy'));
  await until(()=>document.querySelector('.merge-host.hidden'));
  const after=await invoke('snapshot');assert(after.head===before.head,'abort changed original HEAD');
  const st=await invoke('status');assert(!st.conflicts.length&&!st.staged.length,'abort left resolved entries staged');
  assert(st.changed.length===1&&st.changed[0].path==='personal.txt','abort lost pre-existing changes or kept merge changes');
  assert(await content('auto.txt')==='let x = 10; let y = 2;\n','abort retained saved auto result');
  assert(await content('left.txt')==='local\n','abort retained staged resolution');
  assert(await content('personal.txt')==='my unrelated local work\n','abort lost unrelated tracked work');
  assert(await content('notes.txt')==='leave me alone\n','abort lost untracked work');
  assert((await invoke('stashes')).length===stashes,'abort created a stash');
  notes.push('PASS complete merge abort restores saved and staged resolutions, original HEAD, and preserves pre-existing tracked/untracked work');
 }catch(e){notes.push('FAIL '+(e.stack||e));}
 await invoke('selftest_report',{text:notes.join('\n')});
})();
