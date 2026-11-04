// Reproducible v0.4.0 documentation tour; all repository data is synthetic.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const bridge=require('./mock-bridge.cjs');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 const directory=process.env.MERGECRAFT_SCREENSHOT_DIR;
 const german=process.env.MERGECRAFT_DEMO_GERMAN_DIR;
 const base=process.env.MERGECRAFT_TEST_URL||'http://127.0.0.1:1420';
 try {
 for(const lang of ['en',...(german?['de']:[])]) {
  const page=await browser.newPage({viewport:{width:1600,height:1000},locale:lang==='de'?'de-DE':'en-GB',reducedMotion:'reduce',colorScheme:'light'});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(bridge);
  await page.addInitScript(()=>{
   localStorage.setItem('mergecraft-language',navigator.language.startsWith('de')?'de':'en');
   const original=window.__TAURI_INTERNALS__.invoke;
   const state=window.testState;state.current='feature/refactor';state.merging=true;
   let committed=false,pushed=false;
   const paths=['src/checkout.rs','config/app.toml','docs/setup.md'];
   const base=['// Checkout settings','const SHIPPING_FEE: u32 = 5;','// Delivery limits','const MAX_ITEMS: u32 = 10;','','let retries = 2; let timeout = 10;','','const TAX_RATE: u32 = 19;','// End of settings'];
   const ours=[...base];ours[1]='const SHIPPING_FEE: u32 = 0;';ours[5]='let retries = 3; let timeout = 10;';ours[7]='const TAX_RATE: u32 = 7;';
   const theirs=[...base];theirs[3]='const MAX_ITEMS: u32 = 20;';theirs[5]='let retries = 2; let timeout = 15;';theirs[7]='const TAX_RATE: u32 = 20;';
   const side=lines=>({text:lines.join('\n')+'\n',lines:lines.length,exists:true,binary:false,label:''});
   window.__TAURI_INTERNALS__.invoke=async(cmd,args={})=>{
    if(cmd==='merge_continue')committed=true;
    if(cmd==='push'){pushed=true;return {ok:true,code:0,stdout:'Demo branch pushed',stderr:''};}
    const result=await original(cmd,args);
    if(cmd==='snapshot'||cmd==='open_repo')return {...result,name:'checkout-demo',root:'/home/demo/projects/checkout-demo',head_branch:state.current,head_subject:committed?'Merge main into feature/refactor':'Checkout: free shipping for members',head:committed?'b824d9e':'a19c7e2'};
    if(cmd==='branches')return result.map(branch=>branch.is_current?{...branch,ahead:committed&&!pushed?1:0,behind:0,tracking_known:true,upstream:'origin/feature/refactor'}:branch);
    if(cmd==='status') {
     const entry=(file,conflict)=>({path:file,orig_path:null,index:conflict?'U':'M',worktree:conflict?'U':' ',state:conflict?'conflicted':'staged',conflict_code:conflict?'UU':null,ext:file.split('.').pop()});
     const conflicts=state.merging?paths.filter(file=>!state.resolved.includes(file)).map(file=>entry(file,true)):[];
     const staged=state.merging?state.resolved.map(file=>entry(file,false)):[];
     return {...result,merging:state.merging,conflicts,staged,changed:[],untracked:[],all:[...conflicts,...staged]};
    }
    if(cmd==='conflict_data') {
     const data={...result,root:'/home/demo/projects/checkout-demo',ours_label:'feature/refactor',theirs_label:'main',base:side(base),ours:side(ours),theirs:side(theirs),merged:side(ours),working_modified:false,highlight_ours:{},highlight_theirs:{},trailing_newline:true};
     data.regions=[['unchanged',0,1],['conflict',1,3],['unchanged',4,1],['conflict',5,1],['unchanged',6,1],['conflict',7,1],['unchanged',8,1]].map(([kind,start,length])=>({kind,base:[start,length],ours:[start,length],theirs:[start,length]}));
     if(args.path==='config/app.toml') {
      data.base=side(['[checkout]','currency = "EUR"']);data.ours=side(['[checkout]','currency = "GBP"']);data.theirs=side(['[checkout]','currency = "CHF"']);data.merged=side(['[checkout]','currency = "GBP"']);
      data.regions=[{kind:'unchanged',base:[0,1],ours:[0,1],theirs:[0,1]},{kind:'conflict',base:[1,1],ours:[1,1],theirs:[1,1]}];
     }
     if(args.path==='docs/setup.md'){data.ours={...side([]),exists:false};data.theirs=side(['# Checkout setup','Configure currency before deploying.']);}
     return data;
    }
    return result;
   };
  });
  await page.goto(base);await page.locator('.branches-panel').waitFor();
  await page.getByRole('button',{name:lang==='de'?'Änderungen':'Changes',exact:true}).click();
  await page.evaluate(()=>window.mergecraft.openMerge('src/checkout.rs'));
  const capture=async name=>{
   await page.locator('.toasts').evaluate(node=>node.replaceChildren());
   await page.evaluate(()=>{window.mergecraft.lastStatus='';window.mergecraft.renderStatusbar();});
   await page.locator('body').click({position:{x:1590,y:995}});
   const target=lang==='de'?german:directory;fs.mkdirSync(target,{recursive:true});
   await page.screenshot({path:path.join(target,name+'.png')});
  };
  await page.locator('.merge-files').waitFor();
  assert.equal(await page.locator('.merge-file').count(),3);
  assert.match(await page.locator('.auto-summary').innerText(),/^1 /);
  await capture('mergecraft-merge-overview');
  await page.locator('[data-act="auto-resolve"]').click();await page.locator('dialog[open]').waitFor();
  await capture('mergecraft-auto-resolve');
  await page.locator('dialog [data-i="1"]').click();
  await page.waitForFunction(()=>window.mergecraft.mergeEditor.resultText().includes('SHIPPING_FEE: u32 = 0;')&&window.mergecraft.mergeEditor.resultText().includes('MAX_ITEMS: u32 = 20;'));
  await page.locator('.region[data-region="3"] .auto-suggestion summary').click();
  await capture('mergecraft-review-proposal');
  await page.locator('.region[data-region="3"] [data-act="auto-region"]').click();
  await page.locator('.region[data-region="5"] [data-act="take-ours"]').click();
  assert(!(await page.evaluate(()=>window.mergecraft.mergeEditor.resultText())).includes('<<<<<<<'));
  await capture('mergecraft-merge-resolved');
  await page.locator('[data-act="save-resolve"]').click();await page.waitForFunction(()=>window.mergecraft.mergePath==='config/app.toml');
  await page.locator('[data-act="take-theirs"]').click();await page.locator('[data-act="save-resolve"]').click();
  await page.waitForFunction(()=>window.mergecraft.mergePath==='docs/setup.md');
  await page.locator('[data-act="whole-theirs"]').click();await page.locator('dialog [data-i="1"]').click();
  await page.locator('[data-top-act="merge-continue"]').waitFor();await capture('mergecraft-finish-merge');
  await page.locator('[data-top-act="merge-continue"]').click();await page.locator('[data-top-act="push"]').waitFor();
  await capture('mergecraft-ready-to-push');
  assert.deepEqual(errors,[]);
  console.log('PASS screenshot tour '+lang+': safe preview, reviewed same-line proposal, manual choice, three files, modify/delete, merge commit and push state');
  await page.close();
 }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
