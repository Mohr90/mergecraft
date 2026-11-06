const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const bridge=require('./mock-bridge.cjs');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 const page=await browser.newPage({locale:'en-GB',viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const base=process.env.MERGECRAFT_TEST_URL||'http://127.0.0.1:1420';
 try {
  await page.addInitScript(bridge);
  await page.addInitScript(()=>{
   let root='/home/demo/projects/demo-repo';const original=window.__TAURI_INTERNALS__.invoke;
   window.__TAURI_INTERNALS__.invoke=async(cmd,args={})=>{
    if(cmd==='open_repo'){
     if(args.path==='/missing/project')throw new Error('Repository no longer exists');
     root=args.path;
    }
    if(cmd==='recent_repos')return ['/home/demo/projects/demo-repo','/work/another/demo-repo','/missing/project'];
    const result=await original(cmd,args);
    if(cmd==='snapshot'||cmd==='open_repo')return {...result,root,name:root.split('/').pop()};
    return result;
   };
  });
  await page.goto(base);await page.locator('.branches-panel').waitFor();
  const menu=()=>page.getByRole('button',{name:'Switch projects',exact:true});
  await menu().click();await page.getByRole('dialog',{name:'Switch projects'}).waitFor();
  assert.equal(await page.locator('.project-row').count(),3);
  assert.equal(await page.locator('[data-project-path="/home/demo/projects/demo-repo"]').getAttribute('aria-current'),'true');
  await page.locator('.project-row').filter({has:page.locator('[data-project-path="/work/another/demo-repo"]')}).getByRole('button',{name:'Pin project',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('mergecraft-project-pins'))),['/work/another/demo-repo']);
  await page.keyboard.press('Escape');assert.equal(await page.locator('.project-popover').count(),0);assert(await menu().evaluate(e=>e===document.activeElement));
  await page.getByRole('button',{name:'Changes',exact:true}).click();await page.getByRole('textbox',{name:'Commit message',exact:true}).fill('keep project A draft');
  await menu().click();await page.locator('[data-project-path="/work/another/demo-repo"]').click();await page.getByRole('heading',{name:'Branches',exact:true}).waitFor();
  assert.equal(await page.locator('.repo-name').getAttribute('title'),'/work/another/demo-repo');
  await page.getByRole('button',{name:'Tags',exact:true}).click();await page.getByRole('searchbox',{name:'Filter tags'}).fill('v2.4');
  await menu().click();await page.locator('[data-project-path="/home/demo/projects/demo-repo"]').click();await page.getByRole('heading',{name:'Changes',exact:true}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'Commit message',exact:true}).inputValue(),'keep project A draft');
  await menu().click();await page.locator('[data-project-path="/work/another/demo-repo"]').click();await page.getByRole('heading',{name:'Tags',exact:true}).waitFor();
  assert.equal(await page.getByRole('searchbox',{name:'Filter tags'}).inputValue(),'v2.4');
  await menu().click();await page.locator('[data-project-path="/missing/project"]').click();await page.getByText(/Repository no longer exists/).first().waitFor();
  assert.equal(await page.locator('.repo-name').getAttribute('title'),'/work/another/demo-repo','failed open changed current repository');
  await page.reload();await page.locator('.branches-panel').waitFor();await menu().click();
  assert.equal(await page.getByRole('button',{name:'Unpin project',exact:true}).count(),1,'pins lost after reload');
  await page.getByRole('button',{name:'Unpin project',exact:true}).click();assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('mergecraft-project-pins'))),[]);
  await page.keyboard.press('End');assert(await page.getByRole('button',{name:'Open another repository …',exact:true}).evaluate(e=>e===document.activeElement));
  await page.keyboard.press('Tab');assert(await page.getByRole('button',{name:'Close',exact:true}).evaluate(e=>e===document.activeElement));
  await page.keyboard.press('Escape');
  await page.locator('[data-language-choice="de"]').click();await page.getByRole('button',{name:'Projekte wechseln',exact:true}).click();
  assert.equal(await page.getByRole('dialog',{name:'Projekte wechseln'}).count(),1);
  for(const theme of ['light','dark']){
   await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
   for(const width of [1440,768,320]){
    await page.setViewportSize({width,height:900});await page.keyboard.press('Escape');await page.getByRole('button',{name:'Projekte wechseln',exact:true}).click();
    assert(await page.locator('.project-popover').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;}),'project menu outside viewport');
   }
  }
  assert.deepEqual(errors,[]);console.log('PASS pinned/recent projects, duplicate names, persistence, keyboard, failed open, per-project draft/view state, DE/EN and responsive light/dark menu');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
