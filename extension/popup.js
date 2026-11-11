import {t as uiText,msg as uiMessage,initLocale,onLanguageChange} from './i18n.js';
import {currentWebPage} from './web-address.js';
initLocale();
for(const id of ['currentTitle','capturePage'])document.getElementById(id).removeAttribute('data-i18n');
const $=selector=>document.querySelector(selector);
const extension=location.protocol==='chrome-extension:';
let current=null,existing=null,busy=false,toolsJob,noteBaseline='',noteDirty=false,saveVersion=0;
function tools(){
  return toolsJob??=Promise.all([import('./local-store.js'),import('./web-collection.js'),import('./quick-capture.js')]).then(([{LocalStore},{WebCollection},{capturePageDetails}])=>({repository:new WebCollection(new LocalStore('bookmark-house')),capturePageDetails}));
}
let lastStatus='',lastStatusSuccess=false;
function setStatus(message,success=false){lastStatus=message;lastStatusSuccess=success;$('#popupStatus').textContent=message;$('#popupStatus').classList.toggle('success',success);}
function editedNote(){return noteDirty||$('#captureNote').value!==noteBaseline;}
async function openHouse(id=''){
  if(extension)await chrome.tabs.create({url:chrome.runtime.getURL('manager.html')+(id?`?saved=${encodeURIComponent(id)}`:'' )});
  else window.open('manager.html','_blank','noopener');
}
async function checkExisting(){
  const version=saveVersion,{repository}=await tools();
  const found=(await repository.read({light:true})).items.find(item=>item.url===current.url&&item.deletedAt==null)||null;
  // A late lookup must not replace a note being typed or a just-saved result.
  if(version!==saveVersion||busy)return;
  existing=found;if(!found)return;
  if(!editedNote()){$('#captureNote').value=found.note;noteBaseline=found.note;}
  $('#capturePage').textContent=uiText("更新备注");setStatus(uiText("已经收藏，可在这里更新备注。"),true);
}
async function showShortcut(){
  if(chrome.commands?.getAll)try{const commands=await chrome.commands.getAll(),shortcut=commands.find(command=>command.name==='save-current-page')?.shortcut;if(shortcut)$('#popupShortcut').textContent=uiMessage`下次直接按 ${shortcut}，即可保存当前网页。`;}catch{}
}
async function start(){
  try{
    if(!extension){$('#currentTitle').textContent=uiText("示例预览 · 网页标题");$('#currentUrl').textContent=uiText("此处在安装后读取当前网页。");setStatus(uiText("当前是界面预览，请在 Chrome 工具栏打开此入口。"));return;}
    current=await currentWebPage(chrome.tabs);
    // Showing the page and enabling capture do not depend on collection reads.
    $('#currentTitle').textContent=current.title;$('#currentUrl').textContent=current.url;$('#capturePage').disabled=false;
    document.body.dataset.popupPageReadyMs=String(Math.round(performance.now()));
    showShortcut();checkExisting().catch(()=>{if(!busy&&!saveVersion)setStatus(uiText("暂未核对已有收藏，保存时会再次确认。"));});
  }catch(error){$('#currentTitle').textContent=uiText("当前页面无法直接保存");$('#currentUrl').textContent=uiText("你仍然可以打开小屋，拖入或粘贴网页链接。");setStatus(error.message);}
}
$('#capturePage').addEventListener('click',async()=>{
  if(busy||!current)return;busy=true;saveVersion++;
  const note=editedNote()?$('#captureNote').value:undefined,snapshot=$('#captureCover').checked;
  for(const id of ['capturePage','openHouse','captureNote','captureCover'])$('#'+id).disabled=true;
  $('#capturePage').textContent=uiText("正在保存…");setStatus(uiText("正在保存网页和备注…"));
  try{
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(tab?.url!==current.url)throw new Error(uiText("当前网页已切换，请重新打开收藏入口。"));
    const {repository,capturePageDetails}=await tools();
    const details=await capturePageDetails(tab,{snapshot});
    const result=await repository.saveCapture(details,{note});existing=result.item;
    $('#captureNote').value=existing.note;noteBaseline=existing.note;noteDirty=false;
    setStatus(details.contentTimedOut?uiText("网页和备注已保存；正文或封面可稍后在小屋中更新。"):result.existing?uiText("备注已更新，收藏信息已保存；收藏日期继续保留。"):result.restored?uiText("已恢复到收藏，可以继续浏览。"):uiText("已保存，可以继续浏览当前网页。"),true);
    $('#capturePage').textContent=uiText("已保存 ✓");
  }catch(error){setStatus(error.message);$('#capturePage').disabled=false;$('#capturePage').textContent=existing?uiText("更新备注"):uiText("保存到小屋");}
  finally{busy=false;for(const id of ['openHouse','captureNote','captureCover'])$('#'+id).disabled=false;}
});
if(!$('#openHouse').dataset.bootBound)$('#openHouse').addEventListener('click',async()=>{try{await openHouse();window.close();}catch(error){setStatus(error.message);}});
$('#captureNote').addEventListener('input',()=>{noteDirty=true;if(current&&!busy){$('#capturePage').disabled=false;$('#capturePage').textContent=existing?uiText("更新备注"):uiText("保存到小屋");}});
$('#captureCover').addEventListener('change',()=>{if(current&&!busy){$('#capturePage').disabled=false;$('#capturePage').textContent=existing?uiText("更新收藏"):uiText("保存到小屋");}});
document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();$('#capturePage').click();}});
start();

onLanguageChange(()=>{
  if(current){$('#currentTitle').textContent=current.title;$('#currentUrl').textContent=current.url;}
  else if(!extension){$('#currentTitle').textContent=uiText('示例预览 · 网页标题');$('#currentUrl').textContent=uiText('此处在安装后读取当前网页。');}
  $('#capturePage').textContent=busy?uiText('正在保存…'):existing?uiText('更新备注'):uiText('保存到小屋');
  setStatus(uiText(lastStatus),lastStatusSuccess);showShortcut();
});
