// Record without terminating, then let the normal window-close flow end the app.
(async()=>{
  const api=window.__TAURI__;
  const win={close:()=>api.core.invoke('plugin:window|close',{label:'main'})};
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const until=async fn=>{for(let i=0;i<80;i++){if(fn())return;await wait(50);}throw new Error('close test timeout');};
  const notes=[];
  const record=()=>api.core.invoke('selftest_report',{text:notes.join('\n'),finish:false});
  try{
    if(document.querySelector('.merge')){
      if(window.__MERGECRAFT_CLOSE_TEST_PARTIAL__){
        document.querySelector('[data-act="save"]').click();await wait(300);
        notes.push('PASS unresolved intermediate result close requested');await record();await win.close();return;
      }
      if(window.__MERGECRAFT_CLOSE_TEST_SAVE__){
        document.querySelector('[data-act="accept-theirs-all"]').click();
        document.querySelector('[data-act="save"]').click();
        await until(()=>!window.mergecraft.mergeEditor.hasUnsavedChanges());
        notes.push('PASS saved merge close requested');await record();await win.close();return;
      }
      document.querySelector('[data-act="accept-ours-all"]').click();
      await win.close();await until(()=>document.querySelector('dialog[open]'));
      document.querySelector('dialog [data-i="0"]').click();await wait(100);
      if(!window.mergecraft.mergeEditor.hasUnsavedChanges())throw new Error('cancel lost edits');
      notes.push('PASS close cancelled, edits preserved');await record();
      await win.close();await until(()=>document.querySelector('dialog[open]'));
      notes.push('PASS discard confirmation reached; normal close requested');await record();
      document.querySelector('dialog [data-i="1"]').click();
    }else{
      notes.push('PASS normal close requested');await record();await win.close();
    }
  }catch(e){notes.push('FAIL '+e);await record();}
})();
