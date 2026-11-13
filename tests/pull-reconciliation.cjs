const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 const page=await browser.newPage({locale:'de-DE',viewport:{width:1280,height:900}});
 await page.addInitScript(require('./mock-bridge.cjs'));
 await page.addInitScript(()=>{
  const invoke=window.__TAURI_INTERNALS__.invoke;
  window.__TAURI_INTERNALS__.invoke=async(cmd,args={})=>{
   if(cmd==='pull'){
    window.testCalls.push({cmd,args});
    if(!args.confirmed)return {ok:false,code:1,stdout:'',stderr:'',conflicts:[],plan:{branch:'main',head:'a'.repeat(40),upstream:'refs/remotes/origin/main',upstream_oid:'b'.repeat(40),ahead:2,behind:3,token:'pull-token'}};
    window.testState.merging=true;return {ok:false,code:1,stdout:'merge conflict',stderr:'',conflicts:['src/main.rs'],plan:null};
   }
   if(cmd==='push') {window.testCalls.push({cmd,args});return {ok:false,code:1,stdout:'',stderr:'! [rejected] main -> main (non-fast-forward)'};}
   return invoke(cmd,args);
  };
 });
 try {
  await page.goto(process.env.MERGECRAFT_TEST_URL);await page.locator('.branches-panel').waitFor();
  await page.locator('[data-act="pull"]').click();await page.getByRole('heading',{name:'Branch-Stände sind auseinander gelaufen',exact:true}).waitFor();
  assert((await page.locator('dialog').innerText()).includes('2 lokale Commits und 3 Remote-Commits'));
  if(process.env.MERGECRAFT_SCREENSHOT_DIR)await page.screenshot({path:process.env.MERGECRAFT_SCREENSHOT_DIR+'/mergecraft-divergent-pull.png'});
  await page.getByRole('button',{name:'Abbrechen',exact:true}).click();await page.waitForFunction(()=>!window.mergecraft.busy&&!document.querySelector('.shell.busy'));
  assert.equal(await page.evaluate(()=>window.testCalls.filter(c=>c.cmd==='pull'&&c.args.confirmed).length),0);
  await page.locator('[data-act="push"]').click();await page.getByRole('heading',{name:'Remote-Branch ist weiter',exact:true}).waitFor();
  await page.getByRole('button',{name:'Pull starten',exact:true}).click();await page.getByRole('heading',{name:'Branch-Stände sind auseinander gelaufen',exact:true}).waitFor();
  await page.getByRole('button',{name:'Remote-Änderungen mergen',exact:true}).click();await page.locator('.merge-host:not(.hidden) .merge').waitFor();
  assert.equal(await page.evaluate(()=>window.testCalls.find(c=>c.cmd==='pull'&&c.args.confirmed).args.confirmed.token),'pull-token');
  assert.equal(await page.evaluate(()=>window.testCalls.filter(c=>c.cmd==='push').length),1,'push was retried automatically');
  assert.equal(await page.evaluate(()=>window.testCalls.some(c=>c.cmd==='git_raw'&&c.args.args[0]==='config')),false);
  console.log('PASS divergent pull confirmation/cancel, rejected push guidance, checked merge and automatic conflict-editor routing');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
