(async()=>{
 const invoke=window.__TAURI__.core.invoke,app=window.mergecraft;
 const assert=(value,message)=>{if(!value)throw new Error(message);};
 const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const until=async check=>{for(let attempt=0;attempt<160;attempt++){if(await check())return;await wait(60);}throw new Error('Native i18n test timed out');};
 const click=selector=>{const element=document.querySelector(selector);assert(element,'Missing '+selector);element.click();};
 const report=[];
 try {
  await until(()=>document.querySelector('.branches-panel'));
  if(window.__MERGECRAFT_I18N_RESTART__){
   assert(document.documentElement.lang==='en','native language preference was not persisted');
   report.push('PASS native language choice persists after restarting the app');
  }else{
   await app.openMerge('a.txt');
   click('.merge [data-act="take-ours"]');
   click('.merge [data-act="raw"]');
   const area=document.querySelector('.merge .raw-edit');
   area.value='Arbeitskopie / Änderungen remain source text\n';area.setSelectionRange(3,10);area.dispatchEvent(new Event('input',{bubbles:true}));
   for(const language of ['de','en']){
    click(`[data-language-choice="${language}"]`);
    assert(document.documentElement.lang===language,'document language did not change');
    assert(document.querySelector('.merge .raw-edit').value==='Arbeitskopie / Änderungen remain source text\n','language change lost raw text');
    assert(app.mergeEditor.hasUnsavedChanges(),'language change cleared dirty state');
    assert(document.querySelector('.merge .raw-edit').selectionStart===3,'language change lost text selection');
   }
   assert(document.querySelector('.merge [data-act="save"]').textContent==='Save','native merge controls are untranslated');
   click('.merge [data-act="undo"]');click('.merge [data-act="redo"]');
   assert(document.querySelector('.merge .raw-edit').value==='Arbeitskopie / Änderungen remain source text\n','native undo/redo changed after translation');
   report.push('PASS native German/English switch preserves raw edits, selection, dirty state and undo/redo');
  }
 }catch(error){report.push('FAIL '+(error.stack||error));}
 await invoke('selftest_report',{text:report.join('\n')});
})();
