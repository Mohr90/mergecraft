(async()=>{
 const invoke=window.__TAURI__.core.invoke,app=window.mergecraft,notes=[];
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const assert=(v,msg)=>{if(!v)throw Error(msg);};
 const until=async(fn)=>{for(let i=0;i<200;i++){if(await fn())return;await wait(50);}throw Error('Timeout '+fn);};
 const click=s=>{const node=document.querySelector(s);assert(node,'Missing '+s);node.click();};
 try {
  await until(()=>document.querySelector('.branches-panel'));
  const before=await invoke('snapshot');const fix=before.head;
  const hunks=await invoke('hunk_set',{path:'lines.txt',area:'work'});assert(hunks.patches.length===2,'expected two hunks');
  assert((await invoke('apply_hunk',{path:'lines.txt',area:'work',index:0,token:hunks.token})).ok,'stage failed');
  let stale=false;try{await invoke('apply_hunk',{path:'lines.txt',area:'work',index:1,token:hunks.token});}catch{stale=true;}assert(stale,'stale token accepted');
  const staged=await invoke('hunk_set',{path:'lines.txt',area:'staged'});assert(staged.patches.length===1,'staged unrelated content');
  assert((await invoke('apply_hunk',{path:'lines.txt',area:'staged',index:0,token:staged.token})).ok,'unstage failed');
  await invoke('git_raw',{args:['restore','--','lines.txt']});
  notes.push('PASS native checked hunk staging, unstaging and stale index protection');
  const preview=await invoke('merge_preview',{name:'source'});assert(preview.kind==='conflicts'&&preview.conflicts.includes('file.txt'),'missing conflict');
  assert((await invoke('snapshot')).head===before.head,'preview changed HEAD');
  await app.refresh(true);app.merge(app.branchesList.find(b=>b.name==='source'));
  await until(()=>document.querySelector('[data-start]:not(:disabled)'));click('[data-cancel]');
  assert(!(await invoke('snapshot')).merging,'cancel started merge');
  app.merge(app.branchesList.find(b=>b.name==='source'));await until(()=>document.querySelector('[data-start]:not(:disabled)'));click('[data-start]');
  await until(()=>document.querySelector('.merge-host:not(.hidden) .merge'));
  const data=await invoke('conflict_data',{path:'file.txt'});assert(data.ours.text==='ours\n'&&data.theirs.text==='incoming\n','incorrect merge sides');
  assert((await invoke('resolve_with_side',{path:'file.txt',side:'ours'})).ok,'resolution failed');
  assert((await invoke('merge_continue',{})).ok,'merge commit failed');
  notes.push('PASS native merge preview, cancel, checked merge and real conflict resolution');
  await app.refresh(true);app.overlay='none';app.tab='history';app.render();
  const commit=await invoke('commit_info',{revision:fix});app.revertCommit(commit);
  await until(()=>document.querySelector('[data-start]:not(:disabled)'));click('[data-start]');
  await until(async()=>{const commits=await invoke('history',{limit:1,all:false});return commits[0].subject.startsWith('Revert');});
  notes.push('PASS native reverse preview and revert creates a new commit without rewriting the selected commit');
 }catch(error){notes.push('FAIL '+String(error)+' '+error.stack);}
 await invoke('selftest_report',{text:notes.join('\n')});
})();
