(async()=>{
 const app=window.mergecraft,invoke=window.__TAURI__.core.invoke,{a,b,restart}=window.projectFixture;
 const assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
 const until=async check=>{for(let i=0;i<180;i++){if(await check())return;await new Promise(r=>setTimeout(r,60));}throw new Error('Native projects test timed out');};
 const click=selector=>{const e=document.querySelector(selector);assert(e,'Missing '+selector);e.click();};
 const openMenu=async()=>{click('[data-act="projects"]');await until(()=>document.querySelector('.project-popover'));};
 const choose=path=>[...document.querySelectorAll('[data-project-path]')].find(e=>e.dataset.projectPath===path).click();
 const report=[];
 try{
  await until(()=>document.querySelector('.branches-panel'));
  click('[data-language-choice="en"]');
  if(restart){
   await openMenu();assert(document.querySelector('[data-pin-path][aria-pressed="true"]'),'native project pin was lost after restart');
   report.push('PASS native pinned projects persist after restart');
  }else{
   await app.openRepo(b);await openMenu();assert(document.querySelectorAll('.project-row').length===2,'real recent projects not shown');
   [...document.querySelectorAll('[data-pin-path]')].find(e=>e.dataset.pinPath===a).click();
   choose(a);await until(()=>app.snap.root===a&&!app.busy);
   await app.switchTab('changes');const message=document.querySelector('.commit-msg');message.value='native project draft';message.dispatchEvent(new Event('input',{bubbles:true}));
   await app.openWorkingDiff('Sample.java');assert(document.querySelector('.diff .hljs-keyword'),'native Java diff has no colors');await app.requestCloseOverlay();
   await app.openMerge('Example.ts');assert(document.querySelector('.merge .col-ours .hljs-keyword'),'native TypeScript merge side has no colors');
   click('.merge [data-act="take-ours"]');assert(document.querySelector('.merge .syntax-backdrop .hljs-keyword'),'native result has no colors');
   const area=document.querySelector('.merge .cf-edit');assert(area.value.includes('"current"'),'coloring changed result');
   await openMenu();choose(b);await until(()=>document.querySelector('.modal'));
   [...document.querySelectorAll('.modal button')].find(e=>e.textContent==='Cancel').click();await until(()=>!document.querySelector('.modal'));
   assert(app.snap.root===a&&app.mergeEditor.hasUnsavedChanges(),'cancel discarded merge draft or switched project');
   await openMenu();choose(b);await until(()=>document.querySelector('.modal'));
   [...document.querySelectorAll('.modal button')].find(e=>e.textContent==='Discard').click();await until(()=>app.snap.root===b&&!app.busy);
   await openMenu();choose(a);await until(()=>app.snap.root===a&&!app.busy);
   assert(document.querySelector('.commit-msg')?.value==='native project draft','native project switch lost commit draft');
   report.push('PASS native Java diff, TypeScript merge/result syntax, real project switching, duplicate names, unsaved merge cancellation and per-project draft');
  }
 }catch(e){report.push('FAIL '+String(e)+'\n'+(e.stack||''));}
 await invoke('selftest_report',{text:report.join('\n')});
})();
