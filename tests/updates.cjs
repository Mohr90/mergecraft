const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const bridge=require('./mock-bridge.cjs');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 const base=process.env.MERGECRAFT_TEST_URL||'http://127.0.0.1:1420';
 const make=async(mode='user')=>{
  const page=await browser.newPage({locale:'en-GB',viewport:{width:1440,height:1000}});
  await page.addInitScript(bridge);
  await page.addInitScript(mode=>{
   localStorage.setItem('mergecraft-auto-updates','off');
   const original=window.__TAURI_INTERNALS__.invoke;
   window.updateCalls=[];window.failUpdate=false;
   window.__TAURI_INTERNALS__.invoke=async(cmd,args)=>{
    if(['check_for_updates','install_update','open_releases','open_update_download'].includes(cmd)) {
     window.updateCalls.push({cmd,args});
     if(window.failUpdate) throw new Error('offline');
     if(cmd==='check_for_updates')return {current:'0.3.0',latest:'v0.4.0',available:mode!=='current',install_kind:mode==='user'?'user':'package',can_install:mode==='user',can_download:true};
     if(cmd==='install_update')await new Promise(resolve=>setTimeout(resolve,300));
     return null;
    }
    return original(cmd,args);
   };
  },mode);
  await page.goto(base);await page.locator('[data-app-info]').waitFor();return page;
 };
 try{
  const page=await make();
  await page.getByRole('button',{name:'Changes',exact:true}).click();
  await page.locator('.commit-msg').fill('draft stays here');
  await page.locator('[data-app-info]').click();
  await page.getByRole('button',{name:'Check for updates',exact:true}).click();
  await page.getByText('Version v0.4.0 is available',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Install update',exact:true}).click();
  await page.getByText('Installing update …',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Close',exact:true}).isEnabled(),false);
  await page.getByText('Update installed',{exact:true}).waitFor();
  assert.equal(await page.locator('.commit-msg').inputValue(),'draft stays here');
  assert.equal(await page.locator('[data-update-action="install"]').count(),0);
  assert.equal(await page.evaluate(()=>window.updateCalls.find(c=>c.cmd==='install_update').args.expected),'v0.4.0');
  await page.getByRole('button',{name:'Close',exact:true}).click();
  console.log('PASS user update requires explicit click; session/draft preserved, no restart, no duplicate install');
  const pkg=await make('package');await pkg.locator('[data-app-info]').click();
  await pkg.getByRole('button',{name:'Check for updates',exact:true}).click();
  await pkg.getByRole('button',{name:'Download update …',exact:true}).waitFor();
  assert.equal(await pkg.getByRole('button',{name:'Install update',exact:true}).count(),0);
  await pkg.getByRole('button',{name:'Download update …',exact:true}).click();
  await pkg.waitForFunction(()=>window.updateCalls.some(c=>c.cmd==='open_update_download'));
  await pkg.evaluate(()=>window.failUpdate=true);
  await pkg.getByRole('button',{name:'Check for updates',exact:true}).click();
  await pkg.getByText('Update not completed',{exact:true}).waitFor();
  await pkg.evaluate(()=>window.failUpdate=false);
  await pkg.getByRole('button',{name:'Check for updates',exact:true}).click();
  await pkg.getByText('Version v0.4.0 is available',{exact:true}).waitFor();
  for(const width of [1440,768,640]){
   await pkg.setViewportSize({width,height:950});
   assert.equal(await pkg.locator('dialog').evaluate(d=>d.scrollWidth<=d.clientWidth),true);
  }
  if(process.env.MERGECRAFT_UPDATE_SCREENSHOT)await pkg.screenshot({path:process.env.MERGECRAFT_UPDATE_SCREENSHOT});
  console.log('PASS package download, offline retry, responsive About window');
  const current=await make('current');await current.locator('[data-app-info]').click();
  await current.getByRole('button',{name:'Check for updates',exact:true}).click();
  await current.getByText('You’re up to date',{exact:true}).waitFor();
  await current.getByRole('button',{name:'Close',exact:true}).click();
  await current.getByRole('button',{name:'Deutsch',exact:true}).click();
  await current.locator('[data-app-info]').click();
  await current.getByRole('button',{name:'Nach Updates suchen',exact:true}).waitFor();
  assert.equal(await current.getByRole('checkbox',{name:'Automatisch nach Updates suchen',exact:true}).isChecked(),false);
  console.log('PASS current version and German/English About controls');
  await current.getByRole('checkbox',{name:'Automatisch nach Updates suchen',exact:true}).check();
  await current.getByRole('button',{name:'Schließen',exact:true}).click();
  // Remove the test initialization that turns startup checks off, keeping the real saved preference.
  await current.evaluate(()=>{localStorage.setItem('mergecraft-auto-updates','on');localStorage.removeItem('mergecraft-update-check');});
  await current.evaluate(()=>window.mergecraft.updates.start());
  assert.equal(await current.evaluate(()=>window.updateCalls.filter(c=>c.cmd==='check_for_updates').length),2);
  await current.evaluate(()=>window.mergecraft.updates.start());
  assert.equal(await current.evaluate(()=>window.updateCalls.filter(c=>c.cmd==='check_for_updates').length),2);
  console.log('PASS automatic check preference and daily cache prevent duplicate background requests');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
