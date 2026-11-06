const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const bridge = require('./mock-bridge.cjs');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
 const page=await browser.newPage({locale:'en-GB',viewport:{width:1440,height:1000}});
 await page.addInitScript(bridge);
 await page.addInitScript(()=>{
   const invoke=window.__TAURI_INTERNALS__.invoke;
   window.__TAURI_INTERNALS__.invoke=async(cmd,args={})=>{
     if(cmd==='git_raw'&&args.args[0]==='merge-base'){
       window.testCalls.push({cmd,args});return {ok:false,code:1,stdout:'',stderr:''};
     }
     return invoke(cmd,args);
   };
 });
 try {
  await page.goto(process.env.MERGECRAFT_TEST_URL);await page.locator('.branches-panel').waitFor();
  const target=()=>page.locator('.branch-row[data-name="feature/merge-dialog"]');
  assert.equal(await page.locator('.branch-row.current [data-b-act="delete"]').count(),0);
  await target().locator('[data-b-act="delete"]').click();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.testCalls.filter(c=>c.cmd==='delete_branch').length),0);
  await target().locator('[data-b-act="delete"]').click();
  await page.getByRole('button',{name:'Delete branch with its own commits',exact:true}).click();
  await page.waitForFunction(()=>window.testCalls.some(c=>c.cmd==='delete_branch'));
  assert.deepEqual(await page.evaluate(()=>{const a=window.testCalls.find(c=>c.cmd==='delete_branch').args;return [a.force,a.remote,!!a.expected];}),[true,false,true]);
  await page.waitForFunction(()=>!document.querySelector('.shell.busy'));
  await target().locator('[data-b-act="checkout"]').click();
  await page.getByRole('button',{name:'Discard changes …',exact:true}).click();
  await page.locator('[data-rollback-cancel]').click();
  assert.equal(await page.evaluate(()=>window.testCalls.filter(c=>c.cmd==='checkout_branch'||c.cmd==='rollback').length),0);
  await target().locator('[data-b-act="checkout"]').click();
  await page.getByRole('button',{name:'Discard changes …',exact:true}).click();
  await page.locator('[data-rollback-confirm]').click();
  await page.waitForFunction(()=>window.testCalls.some(c=>c.cmd==='checkout_branch'));
  const calls=await page.evaluate(()=>window.testCalls);
  assert(calls.findIndex(c=>c.cmd==='rollback')<calls.findIndex(c=>c.cmd==='checkout_branch'));
  assert.equal(calls.find(c=>c.cmd==='checkout_branch').args.force,false);
  const selected=calls.find(c=>c.cmd==='rollback').args.paths;
  assert(selected.length>0);
  const untracked=await page.evaluate(()=>window.mergecraft.statusData.untracked.map(f=>f.path));
  assert(untracked.every(path=>!selected.includes(path)));
  console.log('PASS direct branch deletion, own-commit confirmation, cancellation, explicit rollback preview before checkout and preserved untracked files');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
