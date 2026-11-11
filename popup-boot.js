// Chrome shows its action popup after the document's first load completes.
// Keep this entry independent of module imports, storage and capture work.
(() => {
  const open=document.getElementById('openHouse');
  const version=document.getElementById('popupVersion'),info=document.getElementById('popupStartupInfo');
  let shellMs=null;
  version.addEventListener('click',()=>{
    info.textContent=`页面载入：${shellMs??'尚未完成'} 毫秒；网页识别：${document.body.dataset.popupPageReadyMs??'尚未完成'} 毫秒。此计时不包含 Chrome 创建窗口之前的等待。`;
    info.hidden=!info.hidden;
  });
  open.dataset.bootBound='true';
  open.addEventListener('click',async()=>{
    try{
      if(location.protocol==='chrome-extension:')await chrome.tabs.create({url:chrome.runtime.getURL('manager.html')});
      else window.open('manager.html','_blank','noopener');
      window.close();
    }catch(error){document.getElementById('popupStatus').textContent=error.message;}
  });
  const loadControls=()=>{
    shellMs=Math.round(performance.now());
    setTimeout(()=>{
    const controller=document.createElement('script');
    controller.type='module';controller.src='popup.js';
    controller.addEventListener('error',()=>{document.getElementById('popupStatus').textContent='保存功能暂时无法加载，可先打开我的收藏。';});
    document.head.append(controller);
    },0);
  };
  if(document.readyState==='complete')loadControls();
  else window.addEventListener('load',loadControls,{once:true});
})();
