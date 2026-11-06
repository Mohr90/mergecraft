const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const bridge=require('./mock-bridge.cjs');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
 try {
 const page=await browser.newPage({locale:'en-GB',viewport:{width:1440,height:1000}});
 await page.addInitScript(bridge);
 await page.addInitScript(()=>{
  const original=window.__TAURI_INTERNALS__.invoke;
  window.__TAURI_INTERNALS__.invoke=async(cmd,args={})=>{
   if(cmd==='git_raw'&&args.args[0]==='worktree')return {ok:true,code:0,stdout:'branch refs/heads/feature/refactor\0',stderr:''};
   if(cmd==='git_raw'&&args.args[0]==='merge-base')return {ok:false,code:1,stdout:'',stderr:''};
   if(cmd==='delete_branch'&&args.name==='feature/ui-redesign'){
    window.testCalls.push({cmd,args});return {ok:false,code:1,stdout:'',stderr:'test changed branch'};
   }
   return original(cmd,args);
  };
 });
 await page.goto(process.env.MERGECRAFT_TEST_URL);await page.locator('.branches-panel').waitFor();
 const button=()=>page.getByRole('button',{name:'Clean up local branches …',exact:true});
 await button().click();await page.locator('[data-cleanup-all]').waitFor();
 const total=await page.locator('[data-cleanup-index]:not(:disabled)').count();
 assert(total>1);assert.equal(await page.locator('[data-cleanup-index]:disabled').count(),2);
 await page.locator('[data-cleanup-all]').check();
 if(process.env.MERGECRAFT_BULK_SCREENSHOT) await page.screenshot({path:process.env.MERGECRAFT_BULK_SCREENSHOT});
 assert.equal(await page.locator('[data-cleanup-index]:checked').count(),total);
 await page.locator('[data-cleanup-confirm]').click();
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.waitForFunction(()=>!window.mergecraft.busy);
 assert.equal(await page.evaluate(()=>window.testCalls.filter(c=>c.cmd==='delete_branch').length),0);
 await button().click();await page.locator('[data-cleanup-all]').check();await page.locator('[data-cleanup-confirm]').click();
 await page.getByRole('button',{name:'Delete selected branches',exact:true}).click();
 await page.waitForFunction(()=>!window.mergecraft.busy);
 const deletes=await page.evaluate(()=>window.testCalls.filter(c=>c.cmd==='delete_branch').map(c=>c.args));
 assert.equal(deletes.length,total);
 assert(deletes.every(a=>!a.remote&&a.expected&&a.expected_head&&a.name!=='main'&&a.name!=='feature/refactor'));
 assert.match(await page.locator('.toast.err').innerText(),/test changed branch/);
 console.log('PASS bulk select-all, protected current/worktree branches, confirmation cancellation and partial failure reporting');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
