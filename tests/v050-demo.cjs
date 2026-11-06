// Synthetic visual fixtures for v0.5.0; never captures a user's repositories.
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 const page=await browser.newPage({viewport:{width:1600,height:1000},locale:'de-DE',reducedMotion:'reduce'});
 const out=process.env.MERGECRAFT_SCREENSHOT_DIR;
 try{
  await page.addInitScript(require('./mock-bridge.cjs'));
  await page.addInitScript(()=>{const original=window.__TAURI_INTERNALS__.invoke;window.__TAURI_INTERNALS__.invoke=async(cmd,args)=>{const value=await original(cmd,args);return cmd==='conflict_data'?{...value,ours_label:'feature/refactor',theirs_label:'main'}:value;};});
  await page.goto(process.env.MERGECRAFT_TEST_URL||'http://127.0.0.1:1436');await page.locator('.branches-panel').waitFor();
  await page.getByRole('button',{name:'Projekte wechseln',exact:true}).click();await page.locator('.project-row').first().getByRole('button',{name:'Projekt anheften',exact:true}).click();
  const capture=async name=>{if(out){fs.mkdirSync(out,{recursive:true});await page.locator('.toasts').evaluate(e=>e.replaceChildren());await page.screenshot({path:path.join(out,name+'.png')});}};
  await capture('mergecraft-projects');await page.keyboard.press('Escape');
  await page.evaluate(async()=>{
   const {mockInvoke}=await import('/src/mock.ts');const diff=await mockInvoke('working_diff',{path:'CheckoutService.java'});
   diff.path='src/main/java/CheckoutService.java';
   diff.a_text='package app.checkout;\n\n/** Calculates the total for a cart. */\npublic class CheckoutService {\n    private final int shippingFee = 5;\n\n    public int total(int price, boolean member) {\n        String currency = "EUR";\n        return price + shippingFee;\n    }\n}\n';
   diff.b_text=diff.a_text.replace('shippingFee = 5','shippingFee = 0').replace('return price + shippingFee;','return member ? price : price + shippingFee;');
   diff.blocks=[{a_start:4,a_len:1,b_start:4,b_len:1},{a_start:8,a_len:1,b_start:8,b_len:1}];
   diff.highlight_a={'4':[{text:'    private final int shippingFee = ',changed:false},{text:'5',changed:true},{text:';',changed:false}]};
   diff.highlight_b={'4':[{text:'    private final int shippingFee = ',changed:false},{text:'0',changed:true},{text:';',changed:false}]};
   const app=window.mergecraft;app.diffView.set(diff);app.diffView.mount(app.diffHost);app.overlay='diff';app.render();
  });
  assert(await page.locator('.diff .hljs-keyword').count()>0);assert.equal(await page.locator('.diff .w').count(),2);
  await capture('mergecraft-syntax-java');
  await page.evaluate(()=>window.mergecraft.requestCloseOverlay());
  await page.evaluate(()=>{window.testState.current='feature/refactor';window.testState.merging=true;return window.mergecraft.refresh(true);});
  await page.evaluate(()=>window.mergecraft.openMerge('src/main.rs'));
  await page.locator('.merge [data-act="take-ours"]').first().click();
  const area=page.locator('.merge .cf-edit').first();
  await area.fill('fn total(price: u32) -> u32 {\n    let currency = "EUR";\n    price + 5\n}');
  await area.focus();
  assert(await page.locator('.syntax-backdrop .hljs-keyword').count()>0);
  const styles=await area.evaluate(e=>{
   const back=e.parentElement.querySelector('.syntax-backdrop'),a=getComputedStyle(e),b=getComputedStyle(back);
   return {textarea:[a.fontFamily,a.fontSize,a.lineHeight,a.padding,a.tabSize],backdrop:[b.fontFamily,b.fontSize,b.lineHeight,b.padding,b.tabSize],background:a.backgroundColor,fill:a.webkitTextFillColor};
  });
  assert.deepEqual(styles.textarea,styles.backdrop,'editable syntax layer is misaligned');assert.equal(styles.background,'rgba(0, 0, 0, 0)','focus covers syntax colors');
  await capture('mergecraft-syntax-merge');
  await page.getByRole('button',{name:'Dunkel',exact:true}).click();await capture('mergecraft-syntax-merge-dark');
  await page.emulateMedia({forcedColors:'active'});assert.notEqual(await area.evaluate(e=>getComputedStyle(e).webkitTextFillColor),'rgba(0, 0, 0, 0)');assert.equal(await page.locator('.syntax-backdrop').first().evaluate(e=>getComputedStyle(e).display),'none');
  console.log('PASS syntax demo: Java diff with Git word marks, colored merge result, matching editable layers, focused light/dark and forced-colors fallback');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
