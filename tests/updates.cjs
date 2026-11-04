const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const bridge=require('./mock-bridge.cjs');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 try{
  const page=await browser.newPage({locale:'en-GB',viewport:{width:1440,height:1000}});
  await page.addInitScript(bridge);
  await page.addInitScript(()=>{
   const original=window.__TAURI_INTERNALS__.invoke;
   window.versionCalls=[];window.versionOffline=false;window.versionAvailable=true;
   window.__TAURI_INTERNALS__.invoke=async(cmd,args)=>{
    if(cmd==='check_for_updates'){
     window.versionCalls.push(cmd);if(window.versionOffline)throw new Error('offline');
     return {current:'0.4.0',latest:window.versionAvailable?'v0.5.0':'v0.4.0',available:window.versionAvailable};
    }
    if(cmd==='open_project'){window.versionCalls.push(cmd);return null;}
    if(['install_update','open_update_download','open_releases'].includes(cmd))throw new Error('Removed updater command invoked');
    return original(cmd,args);
   };
  });
  await page.goto(process.env.MERGECRAFT_TEST_URL||'http://127.0.0.1:1420');
  await page.locator('[data-app-info]').waitFor();
  await page.getByRole('button',{name:'Changes',exact:true}).click();await page.locator('.commit-msg').fill('draft stays here');
  await page.locator('[data-app-info]').click();
  await page.getByText('Version v0.5.0 is available',{exact:true}).waitFor();
  assert.match(await page.locator('[data-app-info]').innerText(),/0\.4\.0/);
  assert.equal(await page.locator('dialog button').count(),2);
  assert.equal(await page.locator('dialog input').count(),0);
  assert.doesNotMatch(await page.locator('dialog').innerText(),/Release notes|Install|Download|SHA-256/);
  await page.getByRole('button',{name:'Open GitHub project …',exact:true}).click();
  assert(await page.evaluate(()=>window.versionCalls.includes('open_project')));
  await page.getByRole('button',{name:'Close',exact:true}).click();
  assert.equal(await page.locator('.commit-msg').inputValue(),'draft stays here');
  await page.evaluate(()=>window.mergecraft.updates.start());
  await page.evaluate(()=>window.mergecraft.updates.start());
  assert.equal(await page.evaluate(()=>window.versionCalls.filter(c=>c==='check_for_updates').length),1);
  await page.getByRole('button',{name:'Deutsch',exact:true}).click();await page.locator('[data-app-info]').click();
  await page.getByRole('button',{name:'GitHub-Projekt öffnen …',exact:true}).waitFor();
  for(const width of [1440,768,640]){await page.setViewportSize({width,height:950});assert(await page.locator('dialog').evaluate(d=>d.scrollWidth<=d.clientWidth));}
  if(process.env.MERGECRAFT_UPDATE_SCREENSHOT)await page.screenshot({path:process.env.MERGECRAFT_UPDATE_SCREENSHOT});
  await page.getByRole('button',{name:'Schließen',exact:true}).click();
  await page.evaluate(()=>{window.versionAvailable=false;window.versionOffline=true;});
  await page.evaluate(()=>window.mergecraft.updates.check());await page.locator('[data-app-info]').click();
  // A known newer version remains visible even when a later network check fails.
  await page.getByText('Version v0.5.0 ist verfügbar',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Schließen',exact:true}).click();
  await page.evaluate(()=>{window.versionOffline=false;});await page.evaluate(()=>window.mergecraft.updates.check());
  await page.locator('[data-app-info]').click();await page.getByText('Du bist auf dem neuesten Stand',{exact:true}).waitFor();
  console.log('PASS minimal version/current/newer state, project link, no installer/download/release notes, daily cache, preserved draft, DE/EN and responsive dialog');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
