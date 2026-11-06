// Run with a local Vite server. Playwright is a test-only requirement.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({headless:true, ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {})});
  const page = await browser.newPage({viewport:{width:1440,height:900},locale:'de-DE'});
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  const base=process.env.MERGECRAFT_TEST_URL || 'http://127.0.0.1:1420';
  const capture=async(name)=>{
    const previous=await page.evaluate(()=>{
      document.querySelector('.toasts')?.replaceChildren();
      const app=window.mergecraft;const previous=app.lastStatus;
      app.lastStatus='';app.renderStatusbar();return previous;
    });
    await page.screenshot({path:process.env.MERGECRAFT_SCREENSHOT_DIR+'/'+name+'.png'});
    await page.evaluate(previous=>{window.mergecraft.lastStatus=previous;window.mergecraft.renderStatusbar();},previous);
  };
  try {
    await page.goto(base+'/tests/regression.html');
    await page.waitForFunction(()=>['PASS','FAIL'].includes(document.title));
    const results=await page.locator('#results').innerText();console.log(results);
    assert.equal(await page.title(),'PASS');
    await page.addInitScript(require('./mock-bridge.cjs'));
    await page.goto(base);await page.getByRole('heading',{name:'Branches',exact:true}).waitFor();
    assert(await page.evaluate(()=>{const brand=document.querySelector('.titlebar .brand').getBoundingClientRect();const context=document.querySelector('.workspace-toolbar .repo-name').getBoundingClientRect();const panel=document.querySelector('.panel-wrap').getBoundingClientRect();return brand.left<panel.left&&context.left>=panel.left;}),'repository context is still in sidebar header');
    assert.equal(await page.locator('[data-b-act="merge"],.opt-noff').count(),0,'main offers direct merge');
    await page.locator('.branch-trigger').click();assert.equal(await page.locator('.popover [data-act="merge"]').count(),0);await page.keyboard.press('Escape');

    for (const colorScheme of ['light','dark']) {
      await page.emulateMedia({colorScheme});
      await page.waitForFunction(scheme=>getComputedStyle(document.documentElement).colorScheme===scheme,colorScheme);
      for (const width of [1440,1024,768,320]) {
        await page.setViewportSize({width,height:900});
        assert(await page.evaluate(()=>document.body.scrollWidth<=innerWidth),colorScheme+' overflow '+width);
        assert(await page.evaluate(()=>{const p=document.querySelector('.panel');return p.scrollWidth<=p.clientWidth;}),colorScheme+' panel overflow '+width);
      }
      await page.setViewportSize({width:1440,height:900});
      await page.waitForTimeout(200); // Let appearance transitions settle before visual QA.
      if(process.env.MERGECRAFT_SCREENSHOT_DIR)await capture('mergecraft-apple-'+colorScheme);
    }
    await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});
    await page.getByRole('button',{name:'Dunkel',exact:true}).click();
    await page.waitForFunction(()=>getComputedStyle(document.documentElement).colorScheme==='dark');
    await page.emulateMedia({colorScheme:'light'});
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark','system overrode manual choice');
    await page.reload(); await page.getByRole('heading',{name:'Branches',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Dunkel',exact:true}).getAttribute('aria-pressed'),'true');
    await page.getByRole('button',{name:'Hell',exact:true}).click();
    await page.reload(); await page.getByRole('heading',{name:'Branches',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Hell',exact:true}).getAttribute('aria-pressed'),'true');
    assert.equal(await page.getByText('Transparenz reduzieren',{exact:true}).count(),0);
    await page.getByRole('button',{name:'Branches',exact:true}).focus();
    assert(await page.getByRole('button',{name:'Branches',exact:true}).evaluate(e=>getComputedStyle(e).boxShadow!=='none'),'keyboard focus invisible');
    if(process.env.MERGECRAFT_SCREENSHOT_DIR)await capture('mergecraft-branches');
    await page.locator('.branch-row[data-name="main"] [data-b-act="favorite"]').click();
    assert.equal(await page.locator('.branch-groups section').first().locator('h2').innerText(),'Favoriten');
    await page.reload(); await page.locator('.branches-panel').waitFor();
    assert.equal(await page.locator('.branch-row[data-name="main"] [data-b-act="favorite"]').getAttribute('aria-pressed'),'true');
    await page.locator('.branch-row[data-name="main"] [data-b-act="favorite"]').click();
    await page.getByRole('button',{name:'Tags',exact:true}).click();
    await page.getByRole('heading',{name:'Tags',exact:true}).waitFor();
    assert.equal(await page.locator('.tag-row').count(),3);
    await page.getByRole('searchbox',{name:'Tags filtern'}).fill('v2.4');
    assert.equal(await page.locator('.tag-row').count(),1);
    if(process.env.MERGECRAFT_SCREENSHOT_DIR)await capture('mergecraft-tags');
    await page.locator('[data-tag-name="v2.4.0"] [data-tag-act="compare"]').click();
    await page.getByRole('heading',{name:'Tag-Vergleich'}).waitFor();
    await page.getByRole('button',{name:'Zurück zur Übersicht'}).click();
    assert.equal(await page.getByRole('searchbox',{name:'Tags filtern'}).inputValue(),'v2.4');
    await page.locator('[data-tag-name="v2.4.0"] [data-tag-act="commit"]').click();
    await page.locator('.hist-side .commit-head').waitFor();
    assert(await page.locator('.hist-side .commit-head').innerText());
    await page.getByRole('button',{name:'Tags',exact:true}).click();
    await page.locator('[data-tag-name="v2.4.0"] [data-tag-act="branch"]').click();
    await page.getByRole('textbox',{name:/Startpunkt/}).fill('feature/from-release');await page.locator('dialog [data-v="ok"]').click();
    await page.waitForFunction(()=>document.querySelector('.branch-trigger .name').textContent==='feature/from-release');
    assert.equal(await page.evaluate(()=>window.testCalls.filter(c=>c.cmd==='create_branch').at(-1).args.start),'refs/tags/v2.4.0');
    await page.locator('.branch-row[data-name="main"] [data-b-act="checkout"]').click();
    await page.getByRole("button",{name:"Änderungen mitnehmen",exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.branch-trigger .name').textContent==='main');
    for(const width of [1440,768,320]){
      await page.setViewportSize({width,height:900});await page.getByRole('button',{name:'Tags',exact:true}).click();
      assert(await page.evaluate(()=>document.body.scrollWidth<=innerWidth),'tag view overflows '+width);
    }
    await page.setViewportSize({width:1440,height:900});await page.getByRole('button',{name:'Branches',exact:true}).click();
    const search=page.getByRole('searchbox',{name:'Branches filtern'});
    await page.evaluate(()=>window.testManyBranches=true);
    await page.getByRole('button',{name:'Aktualisieren',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.branch-row').length===335);
    await search.fill('work/feature');await page.getByRole('combobox',{name:'Branch-Typ'}).selectOption('remote');
    await page.getByRole('combobox',{name:'Branches sortieren'}).selectOption('name');
    await page.waitForFunction(()=>document.querySelectorAll('.branch-row').length===326);
    const groups=page.locator('.branch-groups');const toolbarTop=await search.evaluate(e=>e.getBoundingClientRect().top);
    await groups.evaluate(e=>{e.scrollTop=1800});await page.waitForTimeout(30);
    assert.equal(await search.evaluate(e=>e.getBoundingClientRect().top),toolbarTop,'search scrolled away');
    await page.getByRole('button',{name:'Fetch',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.shell.busy'));
    assert.equal(await search.inputValue(),'work/feature');
    assert.equal(await page.getByRole('combobox',{name:'Branch-Typ'}).inputValue(),'remote');
    assert.equal(await page.getByRole('combobox',{name:'Branches sortieren'}).inputValue(),'name');
    assert(Math.abs(await groups.evaluate(e=>e.scrollTop)-1800)<2,'refresh lost scroll');
    await page.getByRole('button',{name:'Historie',exact:true}).click();await page.getByRole('button',{name:'Branches',exact:true}).click();
    assert.equal(await search.inputValue(),'work/feature');
    assert(Math.abs(await groups.evaluate(e=>e.scrollTop)-1800)<2,'navigation lost scroll');
    await page.getByRole('button',{name:'Filter zurücksetzen'}).click();await page.evaluate(()=>window.testManyBranches=false);
    await page.getByRole('button',{name:'Aktualisieren',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.branch-row').length===9);

    const nextRow=page.locator('.branch-row').nth(1);const beforeMenu=await nextRow.boundingBox();
    await page.locator('.branch-more summary').nth(0).click();
    assert.equal((await nextRow.boundingBox()).y,beforeMenu.y,'menu expanded the branch row');
    const menu=page.locator('.branch-more[open] .branch-more-menu');
    assert(await menu.evaluate(n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}),'menu outside viewport');
    await page.keyboard.press('End');assert.equal(await page.evaluate(()=>document.activeElement.dataset.bAct),'newfrom');
    await page.keyboard.press('Escape');
    assert(await page.locator('.branch-more summary').nth(0).evaluate(n=>n===document.activeElement),'Escape lost summary focus');
    await page.locator('.branch-more summary').nth(0).click();await page.keyboard.press('Tab');
    assert.equal(await page.locator('.branch-more[open]').count(),0,'Tab did not close menu');
    assert(await page.evaluate(()=>document.activeElement!==document.body&&!document.activeElement.closest('.branch-more[open]')),'Tab lost focus');

    await page.locator('.branch-more summary').nth(0).click();await page.locator('.branch-more summary').nth(1).click();
    assert.equal(await page.locator('.branch-more[open]').count(),1);
    assert.equal(await page.getByRole('button',{name:'Umbenennen',exact:true}).count(),0);
    await page.keyboard.press('Escape');assert.equal(await page.locator('.branch-more[open]').count(),0);
    await page.getByRole('button',{name:'Historie',exact:true}).click();
    await page.evaluate(()=>{window.mergecraft.selectCommit('slow-test');window.mergecraft.selectCommit('fast-test');});
    await page.waitForTimeout(220);
    assert.equal(await page.evaluate(()=>window.mergecraft.commitFiles()[0]?.path),'fast-test.txt','stale commit response won');
    await page.evaluate(()=>window.mergecraft.selectCommit('failed-test'));await page.waitForTimeout(40);
    assert.equal(await page.evaluate(()=>window.mergecraft.commitFiles().length),0,'failed commit retained previous files');
    await page.evaluate(()=>window.mergecraft.selectCommit(window.mergecraft.history()[0].hash));
    await page.waitForTimeout(20);
    await page.getByRole('button',{name:'Branches',exact:true}).click();

    await search.fill('merge-dialog');await page.waitForFunction(()=>document.querySelectorAll('.branch-row').length===1);
    await page.locator('[data-b-act="checkout"]').click();
    await page.getByRole("button",{name:"Änderungen mitnehmen",exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.branch-trigger .name').textContent==='feature/merge-dialog');
    assert.equal(await search.inputValue(),'merge-dialog','checkout reset search');
    await search.fill('');
    await page.getByRole('button',{name:'Neuer Branch',exact:true}).click();
    await page.getByRole('textbox',{name:/Startpunkt/}).fill('feature/test');
    await page.locator('dialog [data-v="ok"]').click();
    await page.waitForFunction(()=>document.querySelector('.branch-trigger .name').textContent==='feature/test');
    await page.locator('.branch-row[data-name="main"] [data-b-act="compare"]').click();
    await page.getByRole('heading',{name:'Branch-Vergleich'}).waitFor();
    await page.locator('[data-compare-file]').first().click();await page.locator('.diff-host:not(.hidden) .diff').waitFor();
    await page.locator('.diff [data-act="close"]').click();await page.locator('.compare-host:not(.hidden)').waitFor();
    await page.getByRole('button',{name:'Zurück zur Übersicht'}).click();
    await page.getByRole('button',{name:'Änderungen',exact:true}).click();
    await page.getByRole('textbox',{name:'Commit-Nachricht'}).fill('preview draft');
    await page.locator('.row[data-path="README.md"] .fpath').click();
    await page.locator('.changes-preview .diff').waitFor();
    assert.equal(await page.evaluate(()=>window.testCalls.filter(c=>c.cmd==='working_diff').at(-1).args.area),'work');
    assert.equal(await page.getByRole('textbox',{name:'Commit-Nachricht'}).inputValue(),'preview draft');
    assert(await page.locator('[data-stage-all]').evaluate(e=>e.indeterminate),'all checkbox should show mixed index state');
    await page.locator('[data-stage-file="work"]').first().focus();await page.keyboard.press('Space');
    await page.waitForFunction(()=>!document.querySelector('.shell.busy'));
    assert.equal(await page.evaluate(()=>window.testCalls.filter(c=>c.cmd==='stage').at(-1).args.paths.length),1,'keyboard checkbox staged more than selected file');

    assert(await page.locator('[data-top-act="commit"]').evaluate(node=>{const r=node.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),'desktop commit action outside viewport');
    if(process.env.MERGECRAFT_SCREENSHOT_DIR)await capture('mergecraft-preview');
    for(const width of [768,320]) {
      await page.setViewportSize({width,height:900});
      assert(await page.evaluate(()=>document.body.scrollWidth<=innerWidth),'change preview overflow '+width);
    }
    await page.setViewportSize({width:1440,height:900});
    await page.locator('.row[data-path="README.md"] [data-row-act="history"]').click();
    await page.getByRole('heading',{name:'Dateihistorie: README.md'}).waitFor();
    assert.equal(await page.evaluate(()=>window.testCalls.filter(c=>c.cmd==='file_history').at(-1).args.path),'README.md');
    await page.getByRole('button',{name:'Gesamte Historie'}).click();
    await page.waitForFunction(()=>!document.querySelector('[data-all-history]'));
    await page.getByRole('button',{name:'Änderungen',exact:true}).click();
    await page.getByRole('button',{name:'Rollback …',exact:true}).click();await page.locator('dialog[open]').waitFor();
    await page.locator('[data-rollback-cancel]').click();assert.equal(await page.evaluate(()=>window.testCalls.filter(c=>c.cmd==='rollback').length),0);
    await page.locator('.row[data-path="README.md"] [data-row-act="rollback"]').click();
    await page.locator('dialog[open]').waitFor();
    assert.equal(await page.locator('[data-rollback-file]').count(),0,'single-file rollback should use a short confirmation');
    assert(!(await page.locator('dialog').innerText()).includes('Sicherung'));
    if(process.env.MERGECRAFT_SCREENSHOT_DIR){await page.locator('.toasts').evaluate(node=>node.replaceChildren());await capture('mergecraft-rollback');}
    await page.locator('dialog [data-i="1"]').click();await page.waitForFunction(()=>!document.querySelector('.shell.busy'));
    assert.deepEqual(await page.evaluate(()=>window.testCalls.find(c=>c.cmd==='rollback').args.paths),['README.md']);
    assert.equal(await page.locator('.row[data-path="README.md"]').count(),0);
    assert.equal(await page.locator('[data-stash-restore]').count(),0,'rollback created a stash');
    assert.equal(await page.locator('[data-top-act="stash-save"],.stash-section,.opt-all,.opt-sign,.opt-amend').count(),0);
    const mode=page.getByRole('combobox',{name:'Commit-Art'});
    assert.equal(await mode.inputValue(),'new');
    const message=page.getByRole('textbox',{name:'Commit-Nachricht'});await message.fill('draft survives');
    await page.locator('[data-stage-file="work"]').first().click();
    await page.waitForFunction(()=>!document.querySelector('.shell.busy'));assert.equal(await message.inputValue(),'draft survives');
    await page.getByRole('button',{name:'Branches',exact:true}).click();await page.getByRole('button',{name:'Änderungen',exact:true}).click();assert.equal(await message.inputValue(),'draft survives');
    await mode.selectOption('amend');
    await page.getByRole('button',{name:'Branches',exact:true}).click();await page.getByRole('button',{name:'Änderungen',exact:true}).click();
    assert.equal(await mode.inputValue(),'amend','navigation lost explicit commit mode');
    await message.fill('amend test');await message.press('Control+Enter');await page.waitForFunction(()=>!document.querySelector('.shell.busy'));
    assert.deepEqual(await page.evaluate(()=>{const a=window.testCalls.filter(c=>c.cmd==='commit').at(-1).args;return [a.amend,a.sign,a.all];}),[true,false,false]);
    assert.equal(await mode.inputValue(),'new','successful amend remained the default');
    await message.fill('fail');await page.locator('[data-top-act="commit"]').click();await page.waitForFunction(()=>!document.querySelector('.shell.busy'));assert.equal(await message.inputValue(),'fail');
    await message.fill('success');await page.locator('[data-top-act="commit"]').click();await page.waitForFunction(()=>!document.querySelector('.shell.busy'));assert.equal(await message.inputValue(),'');
    assert.deepEqual(await page.evaluate(()=>{const a=window.testCalls.filter(c=>c.cmd==='commit').at(-1).args;return [a.amend,a.sign,a.all];}),[false,false,false]);
    await page.getByRole('button',{name:'Branches',exact:true}).click();
    await page.locator('.branch-row[data-name="main"] [data-b-act="merge"]').click();
    await page.locator('dialog').waitFor();await page.getByRole('button',{name:'Jetzt mergen'}).click();
    await page.locator('.merge-host:not(.hidden) .merge').waitFor();
    await page.locator('.merge [data-act="take-ours"]').first().click();
    const chosen=await page.evaluate(()=>window.mergecraft.mergeEditor.resultText());
    await page.evaluate(()=>window.testAbortFailure=true);
    await page.locator('.merge-tools').evaluate(node=>node.open=true);
    await page.locator('[data-act="abort-merge"]').click();await page.locator('dialog [data-i="0"]').click();
    assert.equal(await page.evaluate(()=>window.testCalls.filter(c=>c.cmd==='merge_abort').length),0,'cancel called abort');
    await page.locator('.merge-tools').evaluate(node=>node.open=true);
    await page.locator('[data-act="abort-merge"]').click();await page.locator('dialog [data-i="1"]').click();
    await page.waitForFunction(()=>!document.querySelector('.shell.busy'));
    assert.equal(await page.evaluate(()=>window.mergecraft.mergeEditor.resultText()),chosen,'failed abort lost decisions');
    assert(await page.evaluate(()=>window.mergecraft.mergeEditor.hasUnsavedChanges()),'failed abort cleared dirty state');
    assert(await page.locator('.merge-host:not(.hidden)').count(),'failed abort closed editor');
    await page.evaluate(()=>window.testAbortFailure=false);await page.locator('.merge [data-act="undo"]').click();
    if(process.env.MERGECRAFT_SCREENSHOT_DIR)await capture('mergecraft-merge');
    await page.locator('.merge-tools').evaluate(node=>node.open=true);
    await page.locator('.merge [data-act="accept-theirs-all"]').click();
    await page.getByRole('button',{name:'Dunkel',exact:true}).click();
    assert(await page.evaluate(()=>window.mergecraft.mergeEditor.hasUnsavedChanges()),'theme switch discarded merge edits');
    assert.equal(await page.locator('.theme-switch [aria-pressed="true"]').innerText(),'Dunkel');
    await page.getByRole('button',{name:'Hell',exact:true}).click();
    await page.locator('.merge [data-act="save-resolve"]').click();
    await page.waitForFunction(()=>window.testCalls.some(c=>c.cmd==='save_conflict'&&c.args.mark_resolved));
    await page.waitForFunction(()=>document.querySelector('.merge-head .name')?.textContent==='config.rs');
    // The next file opened automatically; close without edits and resolve remaining files.
    await page.locator('.merge [data-act="close"]').click();
    while(await page.locator('[data-row-act="take-ours"]').count()){
      await page.locator('[data-row-act="take-ours"]').first().click();await page.locator('dialog [data-i="1"]').click();
      await page.waitForFunction(()=>!document.querySelector('.shell.busy'));
    }
    const pushCount=await page.evaluate(()=>window.testCalls.filter(c=>c.cmd==='push').length);
    await page.locator('[data-act="push"]').click();
    assert.equal(await page.evaluate(()=>window.testCalls.filter(c=>c.cmd==='push').length),pushCount,'unfinished merge was pushed');
    assert.match(await page.locator('.toasts').innerText(),/Schließe zuerst den Merge/);
    assert.match(await page.locator('.changes-panel .banner').innerText(),/Merge-Commit/);
    await page.getByRole('button',{name:'Merge abschließen'}).click();await page.waitForFunction(()=>!document.querySelector('.shell.busy'));
    assert(await page.evaluate(()=>window.testCalls.some(c=>c.cmd==='merge_continue')));
    await page.locator('[data-act="push"]').click();
    await page.waitForFunction(n=>window.testCalls.filter(c=>c.cmd==='push').length===n+1,pushCount);
    await page.waitForFunction(()=>!document.querySelector('.shell.busy'));
    assert(await page.evaluate(()=>{
      const app=window.mergecraft;const saved=app.statusData;
      const before=window.testCalls.filter(c=>c.cmd==='commit').length;
      app.statusData={...saved,all:[],staged:[],changed:[],untracked:[],conflicts:[]};
      app.commit('must not create an empty commit',false);
      app.statusData=saved;
      return window.testCalls.filter(c=>c.cmd==='commit').length===before;
    }),'empty commit guard called API');
    assert.match(await page.locator('.toasts').innerText(),/nichts Neues zu committen/);
    // Explicitly validate deletion stays non-forced.
    await page.getByRole('button',{name:'Branches',exact:true}).click();
    const row=page.locator('.branch-row[data-name="main"]');await row.locator('summary').click();await row.locator('[data-b-act="delete"]').click();await page.locator('dialog [data-i="1"]').click();
    await page.waitForFunction(()=>window.testCalls.some(c=>c.cmd==='delete_branch'));
    assert.equal(await page.evaluate(()=>window.testCalls.find(c=>c.cmd==='delete_branch').args.force),false);
    await page.waitForFunction(()=>!document.querySelector('.shell.busy'));
    const checkoutCount=await page.evaluate(()=>window.testCalls.filter(c=>c.cmd==='checkout_branch').length);
    const openRemote=async()=>{
      await page.evaluate(()=>{
        const app=window.mergecraft;const local=app.branchesList.find(b=>b.is_current);
        const remote={...local,name:'origin/'+local.name,checkout_name:local.name,full_name:'refs/remotes/origin/'+local.name,short_hash:'bbbbbbbb',is_current:false,is_remote:true};
        app.checkout(remote);
      });
      await page.getByRole('heading',{name:'Lokaler Branch bereits vorhanden'}).waitFor();
    };
    await openRemote();await page.getByRole('button',{name:'Abbrechen',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.testCalls.filter(c=>c.cmd==='checkout_branch').length),checkoutCount,'cancel switched branch');
    await openRemote();await page.getByRole('button',{name:'Lokalen Branch öffnen'}).click();
    await page.getByRole('button',{name:'Änderungen mitnehmen',exact:true}).click();
    await page.waitForFunction(n=>window.testCalls.filter(c=>c.cmd==='checkout_branch').length===n+1,checkoutCount);
    await page.waitForFunction(()=>!document.querySelector('.shell.busy'));
    assert.equal(await page.evaluate(()=>window.testCalls.filter(c=>c.cmd==='checkout_branch').at(-1).args.track),false);
    await openRemote();await page.getByRole('button',{name:'Mit Remote aktualisieren'}).click();
    await page.getByRole('button',{name:'Änderungen mitnehmen',exact:true}).click();
    await page.waitForFunction(n=>window.testCalls.filter(c=>c.cmd==='checkout_branch').length===n+2,checkoutCount);
    await page.waitForFunction(()=>!document.querySelector('.shell.busy'));
    assert.deepEqual(await page.evaluate(()=>{const a=window.testCalls.filter(c=>c.cmd==='checkout_branch').at(-1).args;return [a.force,a.update_from_remote,a.expected_remote];}),[false,true,'bbbbbbbb']);
    // Missing tracking requires explicit confirmation; cancellation never starts Pull.
    const pullCount=await page.evaluate(()=>window.testCalls.filter(c=>c.cmd==='pull').length);
    await page.evaluate(()=>{
      const app=window.mergecraft;const current=app.branchesList.find(b=>b.is_current);
      current.upstream=null;
      app.branchesList=app.branchesList.filter(b=>!b.is_remote || b.checkout_name!==current.name);
      app.branchesList.push({...current,name:'origin/'+current.name,full_name:'refs/remotes/origin/'+current.name,is_remote:true,is_current:false});
    });
    await page.locator('[data-act="pull"]').click();await page.getByRole('button',{name:'Zuordnen und pullen'}).waitFor();
    await page.locator('dialog [data-i="0"]').click();
    assert.equal(await page.evaluate(()=>window.testCalls.filter(c=>c.cmd==='pull').length),pullCount);
    await page.locator('[data-act="pull"]').click();await page.getByRole('button',{name:'Zuordnen und pullen'}).click();
    await page.waitForFunction(n=>window.testCalls.filter(c=>c.cmd==='pull').length===n+1,pullCount);
    await page.waitForFunction(()=>!document.querySelector('.shell.busy'));
    assert.equal(await page.evaluate(()=>window.testCalls.filter(c=>c.cmd==='pull').at(-1).args.track_same_name),true);
    await page.evaluate(()=>{const app=window.mergecraft;const current=app.branchesList.find(b=>b.is_current);current.upstream=null;app.branchesList=app.branchesList.filter(b=>!b.is_remote);});
    await page.locator('[data-act="pull"]').click();
    assert.equal(await page.evaluate(()=>window.testCalls.filter(c=>c.cmd==='pull').length),pullCount+1,'missing remote started pull');
    assert.match(await page.locator('.toasts').innerText(),/Kein passender Remote-Branch/);
    await page.evaluate(()=>{const app=window.mergecraft;app.lastStatus='!Pull: '+('long diagnostic output '.repeat(100));app.renderStatusbar();});
    assert(await page.locator('.statusbar').evaluate(el=>el.getBoundingClientRect().height<50),'long error expanded statusbar');
    for(const width of [1440,1024,768,320]){
      await page.setViewportSize({width,height:900});
      assert(await page.evaluate(()=>document.body.scrollWidth<=innerWidth),'body overflows at '+width);
      assert(await page.evaluate(()=>{const p=document.querySelector('.panel');return p.scrollWidth<=p.clientWidth;}),'panel overflows at '+width);
    }
    assert.deepEqual(errors,[]);console.log('PASS inline preview, file history, persisted favorites, appearance, 326 remote branches, persistent filters/scroll, menus, history race, tags, rollback, simplified commit modes and application flows: filter, switch, create, compare, drafts, merge, resolve, continue, safe deletion, responsive layout');
  } catch(e) { console.error(await page.evaluate(()=>({calls:window.testCalls,title:document.querySelector(".titlebar")?.textContent,toasts:document.querySelector(".toasts")?.textContent}))); throw e; } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
