const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 const page=await browser.newPage({locale:'de-DE',viewport:{width:1280,height:900}});
 await page.addInitScript(require('./mock-bridge.cjs'));
 await page.addInitScript(()=>{
  const invoke=window.__TAURI_INTERNALS__.invoke;
  window.__TAURI_INTERNALS__.invoke=async(cmd,args={})=>{
   if(cmd==='worktree_branch_preview'){window.testCalls.push({cmd,args});return {branch:args.name,path:'/home/demo/projects/task-worktree',branch_oid:'a'.repeat(40),caller_head:'b'.repeat(40),token:'test',discardable:!!window.discardWorktree,blocked:window.blockWorktree?'Der Worktree enthält lokale Änderungen, unversionierte oder ignorierte Dateien. Räume ihn zuerst auf; es wurde nichts entfernt.':null};}
   return invoke(cmd,args);
  };
 });
 try {
  await page.goto(process.env.MERGECRAFT_TEST_URL);await page.locator('.branches-panel').waitFor();
  const trash=()=>page.locator('.branch-row[data-name="feature/merge-dialog"] [data-b-act="delete"]');
  await trash().click();await page.getByRole('heading',{name:'Worktree und Branch entfernen?',exact:true}).waitFor();
  assert((await page.locator('dialog').innerText()).includes('/home/demo/projects/task-worktree'));
  assert((await page.locator('dialog').innerText()).includes('Worktree-Verzeichnis'));
  if(process.env.MERGECRAFT_SCREENSHOT_DIR)await page.screenshot({path:process.env.MERGECRAFT_SCREENSHOT_DIR+'/mergecraft-worktree-deletion.png'});
  await page.getByRole('button',{name:'Abbrechen',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.testCalls.filter(c=>c.cmd==='remove_worktree_branch').length),0);
  await trash().click();await page.getByRole('button',{name:'Worktree und Branch entfernen',exact:true}).click();
  await page.waitForFunction(()=>window.testCalls.some(c=>c.cmd==='remove_worktree_branch'));
  assert.equal(await page.evaluate(()=>window.testCalls.find(c=>c.cmd==='remove_worktree_branch').args.preview.path),'/home/demo/projects/task-worktree');
  await page.waitForFunction(()=>!window.mergecraft.busy);
  await page.evaluate(()=>window.blockWorktree=true);await trash().click();
  await page.getByRole('heading',{name:'Branch ist in einem Worktree geöffnet',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Worktree und Branch entfernen',exact:true}).count(),0);
  assert((await page.locator('dialog').innerText()).includes('ignorierte Dateien'));
  await page.getByRole('button',{name:'Schließen',exact:true}).click();
  await page.evaluate(()=>window.discardWorktree=true);await trash().click();
  await page.getByRole('heading',{name:'Änderungen verwerfen und löschen?',exact:true}).waitFor();
  assert((await page.locator('dialog').innerText()).includes('dauerhaft gelöscht'));
  if(process.env.MERGECRAFT_SCREENSHOT_DIR)await page.screenshot({path:process.env.MERGECRAFT_SCREENSHOT_DIR+'/mergecraft-force-worktree-deletion.png'});
  await page.getByRole('button',{name:'Abbrechen',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.testCalls.filter(c=>c.cmd==='remove_worktree_branch').length),1);
  await trash().click();await page.getByRole('button',{name:'Änderungen verwerfen und löschen',exact:true}).click();
  await page.waitForFunction(()=>window.testCalls.filter(c=>c.cmd==='remove_worktree_branch').length===2);
  assert.equal(await page.evaluate(()=>window.testCalls.filter(c=>c.cmd==='remove_worktree_branch')[1].args.discard_changes),true);
  await page.waitForFunction(()=>!window.mergecraft.busy);
  await page.evaluate(()=>window.discardWorktree=false);
  await page.getByRole('button',{name:'English',exact:true}).click();await page.evaluate(()=>window.blockWorktree=false);await trash().click();
  await page.getByRole('heading',{name:'Remove worktree and branch?',exact:true}).waitFor();await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>window.testCalls.filter(c=>c.cmd==='remove_worktree_branch').length),2);
  console.log('PASS explicit worktree path/removal confirmation, cancel, ignored-file blocker and DE/EN labels');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
