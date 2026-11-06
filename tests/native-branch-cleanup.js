(async()=>{
 const invoke=window.__TAURI__.core.invoke,app=window.mergecraft,notes=[];
 const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const assert=(ok,message)=>{if(!ok)throw new Error(message);};
 const until=async fn=>{for(let i=0;i<150;i++){if(await fn())return;await wait(75);}throw new Error('Timeout '+fn);};
 const click=selector=>{const node=document.querySelector(selector);assert(node,'Missing '+selector);node.click();};
 const branch=name=>app.branchesList.find(b=>b.name===name);
 try {
  await until(()=>document.querySelector('.branches-panel'));
  app.checkout(branch('origin/task'));
  await until(()=>document.querySelector('dialog [data-i="1"]'));
  click('dialog [data-i="1"]');
  await until(()=>document.querySelector('[data-rollback-cancel]'));
  click('[data-rollback-cancel]');
  assert((await invoke('snapshot')).head_branch==='main','cancel switched branch');
  assert((await invoke('status')).staged.some(f=>f.path==='file.txt'),'cancel discarded staged work');
  notes.push('PASS cancelling rollback preserves staged changes and current branch');
  app.checkout(branch('origin/task'));
  await until(()=>document.querySelector('dialog [data-i="1"]'));click('dialog [data-i="1"]');
  await until(()=>document.querySelector('[data-rollback-confirm]'));click('[data-rollback-confirm]');
  await until(()=>app.snap.head_branch==='task'&&!app.busy);
  assert((await invoke('status')).untracked.some(f=>f.path==='notes.txt'),'checkout removed untracked file');
  notes.push('PASS explicit rollback then remote checkout creates tracked task branch');
  app.remove(branch('own-work'));
  await until(()=>document.querySelector('dialog [data-i="0"]'));click('dialog [data-i="0"]');
  assert((await invoke('branches')).some(b=>b.name==='own-work'),'cancel deleted branch');
  app.remove(branch('own-work'));
  await until(()=>document.querySelector('dialog [data-i="1"]'));click('dialog [data-i="1"]');
  await until(()=>!app.busy&&!branch('own-work'));
  app.remove(branch('merged'));
  await until(()=>document.querySelector('dialog [data-i="1"]'));click('dialog [data-i="1"]');
  await until(()=>!app.busy&&!branch('merged'));
  notes.push('PASS explicit deletion of branch with own commits and safe deletion of merged branch');
 }catch(error){notes.push('FAIL '+(String(error)+" "+error.stack));}
 await invoke('selftest_report',{text:notes.join('\n')});
})();
