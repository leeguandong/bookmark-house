import {t as uiText,msg as uiMessage,setLanguage,LANGUAGE_KEY} from './i18n.js';
import {LocalStore} from './local-store.js';
import {WebCollection} from './web-collection.js';
import {captureActivePage,captureContextLink,captureMessage} from './quick-capture.js';
import {BookmarkCache,watchBookmarkCache} from './bookmark-cache.js';

const MENU_ID='bookmark-house-save-web',COMMAND='save-current-page';
const store=new LocalStore('bookmark-house'),repository=new WebCollection(store);
const bookmarkCache=chrome.bookmarks?.getTree?new BookmarkCache(chrome.bookmarks,store):null;
const cacheError=error=>console.warn('书签小屋：书签缓存稍后重建',error.message);
if(bookmarkCache){
  watchBookmarkCache(bookmarkCache,{onError:cacheError});
  // Installation, browser startup and bookmark changes prewarm the cache.
  // A worker wake for a capture does not need to scan the bookmark library.
}
const badgeTimers=new Map();
function feedback(tabId,text,title,color){
  const target=Number.isInteger(tabId)?{tabId}:{};
  Promise.all([
    chrome.action.setBadgeText({...target,text}),
    chrome.action.setBadgeBackgroundColor({...target,color}),
    chrome.action.setTitle({...target,title})
  ]).catch(()=>{});
  clearTimeout(badgeTimers.get(tabId));
  badgeTimers.set(tabId,setTimeout(()=>{
    Promise.all([chrome.action.setBadgeText({...target,text:''}),chrome.action.setTitle({...target,title:uiText('保存网页 · 书签小屋')})]).catch(()=>{});badgeTimers.delete(tabId);
  },4500));
}
async function capture(operation,tabId){
  try{const saved=await operation();feedback(saved.tabId,'✓',captureMessage(saved.result),'#315f42');return saved;}
  catch(error){feedback(tabId,'!',uiMessage`未能保存：${error.message}`,'#a66540');console.warn('书签小屋：保存未完成',error.message);}
}
function registerMenu(){
  // Callbacks also support the extension's minimum Chrome version.
  chrome.contextMenus.removeAll(()=>{
    if(chrome.runtime.lastError){console.warn(chrome.runtime.lastError.message);return;}
    chrome.contextMenus.create({id:MENU_ID,title:uiText('收藏到书签小屋'),contexts:['page','link'],documentUrlPatterns:['http://*/*','https://*/*']},()=>{
      if(chrome.runtime.lastError)console.warn(chrome.runtime.lastError.message);
    });
  });
}
function prepareHouse(){
  registerMenu();
  if(bookmarkCache)bookmarkCache.invalidate().then(()=>bookmarkCache.read()).catch(cacheError);
}
chrome.runtime.onInstalled.addListener(prepareHouse);
chrome.runtime.onStartup.addListener(prepareHouse);
chrome.contextMenus.onClicked.addListener((info,tab)=>{
  if(info.menuItemId===MENU_ID)return capture(()=>captureContextLink(repository,info,tab),tab?.id);
});
chrome.commands.onCommand.addListener(command=>{
  if(command===COMMAND)return capture(()=>captureActivePage(repository,chrome.tabs));
});

function updateLanguageSurfaces(){
  if(chrome.contextMenus.update)chrome.contextMenus.update(MENU_ID,{title:uiText('收藏到书签小屋')},()=>{void chrome.runtime.lastError;});
  chrome.action.setTitle({title:uiText('保存网页 · 书签小屋')}).catch(()=>{});
}
// The worker has no localStorage. Reuse the existing IndexedDB store without a
// new permission, and never make popup first paint wait for this preference.
store.get(LANGUAGE_KEY).then(saved=>{
  if(saved==='en'||saved==='zh-CN'){setLanguage(saved,{persist:false,notify:false});updateLanguageSurfaces();}
}).catch(()=>{});
chrome.runtime.onMessage?.addListener((message,sender,respond)=>{
  if(message?.type!=='bookmark-house-language')return;
  if(sender?.id&&sender.id!==chrome.runtime.id)return;
  if(!['en','zh-CN'].includes(message.language)){respond({ok:false});return;}
  store.set(LANGUAGE_KEY,message.language).then(()=>{
    setLanguage(message.language,{persist:false,notify:false});updateLanguageSurfaces();respond({ok:true,language:message.language});
  }).catch(()=>respond({ok:false}));
  return true;
});
