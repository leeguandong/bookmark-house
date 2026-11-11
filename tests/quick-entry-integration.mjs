// Extension UI and service-worker simulations only; no live browser access.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {LocalStore} from '../adapter.js';
import {WebCollection} from '../web-collection.js';
const popupHtml=await readFile(new URL('../popup.html',import.meta.url),'utf8');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){for(let i=0;i<100;i++){if(fn())return;await delay(10);}throw new Error(label);}

test('toolbar save stays on the original page, allows note updates, and opens the manager only on request',async()=>{
  const dom=new JSDOM(popupHtml,{url:'chrome-extension://synthetic/popup.html'}),closeWindow=dom.window.close.bind(dom.window);let closed=0;const opened=[];
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,location:dom.window.location,indexedDB:new IDBFactory(),BroadcastChannel:class{postMessage(){}close(){}}});
  window.close=()=>{closed++;};
  globalThis.chrome={tabs:{async query(){return [{id:10,title:'好文章',url:'https://example.com/current'}];},async create(details){opened.push(details);}},runtime:{getURL:path=>'chrome-extension://synthetic/'+path},commands:{async getAll(){return [{name:'save-current-page',shortcut:'Alt+Shift+S'}];}}};
  await import(new URL('../popup.js?in-place-test',import.meta.url));
  const $=selector=>document.querySelector(selector);
  await until(()=>!$('#capturePage').disabled,'popup ready');assert.ok($('#popupShortcut').textContent.includes('Alt+Shift+S'));
  $('#captureNote').value='保存时的想法';$('#capturePage').click();await until(()=>$('#capturePage').textContent.includes('已保存'),'saved');
  assert.equal(opened.length,0);assert.equal(closed,0);assert.ok($('#popupStatus').classList.contains('success'));
  const repository=new WebCollection(new LocalStore('bookmark-house'));let [item]=(await repository.read()).items;assert.equal(item.note,'保存时的想法');const date=item.savedAt;
  await repository.edit(item.id,{url:item.url,title:'后来修改的标题',note:item.note});
  $('#captureNote').value='补充的新想法';$('#captureNote').dispatchEvent(new window.Event('input',{bubbles:true}));assert.equal($('#capturePage').textContent,'更新备注');$('#capturePage').click();await until(()=>$('#capturePage').disabled&&$('#popupStatus').textContent.includes('备注已更新'),'updated note');
  [item]=(await repository.read()).items;assert.equal(item.savedAt,date);assert.equal(item.note,'补充的新想法');assert.equal(item.title,'后来修改的标题');assert.equal(opened.length,0);
  $('#openHouse').click();await until(()=>opened.length===1&&closed===1,'explicit open');assert.equal(opened[0].url,'chrome-extension://synthetic/manager.html');assert.equal(closed,1);closeWindow();
});

test('worker registers menu and shortcut, writes cards, and reports success without opening a manager tab',async()=>{
  globalThis.indexedDB=new IDBFactory();const listeners={},badges=[],menus=[],opened=[];const originalTimeout=globalThis.setTimeout;
  globalThis.setTimeout=(fn,ms)=>{const timer=originalTimeout(fn,ms);timer.unref();return timer;};
  globalThis.chrome={
    runtime:{onInstalled:{addListener:fn=>listeners.installed=fn},onStartup:{addListener:fn=>listeners.startup=fn}},
    contextMenus:{removeAll(callback){menus.length=0;callback();},create(details,callback){menus.push(details);callback();},onClicked:{addListener:fn=>listeners.context=fn}},
    commands:{onCommand:{addListener:fn=>listeners.command=fn}},
    tabs:{async query(){return [{id:11,title:'快捷键保存网页',url:'https://example.com/keyboard'}];},async create(details){opened.push(details);}},
    action:{async setBadgeText(details){badges.push(details);},async setBadgeBackgroundColor(){},async setTitle(details){badges.push(details);}}
  };
  try{
    await import(new URL('../background.js?worker-test',import.meta.url));listeners.installed();assert.equal(menus.length,1);assert.deepEqual(menus[0].contexts,['page','link']);assert.deepEqual(menus[0].documentUrlPatterns,['http://*/*','https://*/*']);
    const result=await listeners.command('save-current-page');assert.equal(result.result.added,1);assert.equal(opened.length,0);assert.ok(badges.some(b=>b.text==='✓'&&b.tabId===11));
    await listeners.context({menuItemId:menus[0].id,linkUrl:'https://example.com/right-click',pageUrl:'https://source.test/'},{id:12,title:'来源网页'});
    const repository=new WebCollection(new LocalStore('bookmark-house')),data=await repository.read();assert.equal(data.items.length,2);assert.equal(data.items.find(n=>n.url.endsWith('/right-click')).title,'example.com');assert.equal(opened.length,0);
    await listeners.command('save-current-page');assert.equal((await repository.read()).items.length,2);assert.ok(badges.some(b=>b.title==='这个网页已经收藏'));
  }finally{globalThis.setTimeout=originalTimeout;}
});
