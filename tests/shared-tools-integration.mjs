// Isolated DOM/IndexedDB simulation; never connects to or controls a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {LocalStore} from '../adapter.js';
import {WebCollection} from '../web-collection.js';
const html=await readFile(new URL('../manager.html',import.meta.url),'utf8');
const nativeTimeout=globalThis.setTimeout,nativeClearTimeout=globalThis.clearTimeout,timers=new Set();
const idb=new IDBFactory();let page,loadNumber=0;
function setup(){
  for(const timer of timers)nativeClearTimeout(timer);timers.clear();page?.window.close();
  page=new JSDOM(html,{url:'http://local-test.invalid/manager.html',pretendToBeVisual:true});
  Object.assign(globalThis,{window:page.window,document:page.window.document,location:page.window.location,indexedDB:idb,innerWidth:1440,innerHeight:900});
  Object.defineProperty(globalThis,'navigator',{value:page.window.navigator,configurable:true});
  globalThis.BroadcastChannel=class{postMessage(){}close(){}};
  globalThis.setTimeout=(fn,delay,...args)=>{const timer=nativeTimeout(fn,delay,...args);timer.unref();timers.add(timer);return timer;};
  globalThis.requestAnimationFrame=fn=>setTimeout(fn,16);globalThis.cancelAnimationFrame=clearTimeout;
  page.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};page.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
}
const $=selector=>document.querySelector(selector);
async function until(condition,label){for(let i=0;i<150;i++){if(condition())return;await new Promise(resolve=>nativeTimeout(resolve,10));}throw new Error(`Not ready: ${label}; ${$('#list')?.textContent}; ${$('#status')?.textContent}`);}
async function load(){setup();await import(new URL(`../manager.js?dom-check=${++loadNumber}`,import.meta.url));await until(()=>$('#webPanel .web-card')&&['19','20'].includes($('#navAll').textContent),'startup');}
function click(selector){const el=$(selector);assert.ok(el,selector);el.click();}
function submit(){ $('#dialogForm').dispatchEvent(new page.window.Event('submit',{bubbles:true,cancelable:true})); }
function dropped(url,title){const event=new page.window.Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(event,'dataTransfer',{value:{types:['text/uri-list','text/html'],getData(type){return type==='text/uri-list'?url:type==='text/html'?`<a href="${url}">${title}</a>`:'';}}});$('#webPanel .web-capture').dispatchEvent(event);}


test('shared tools switch sources, analyze card content, and keep deletion/restoration independent',async()=>{
  try{
    await load();
    assert.equal($('#bookmarkSection').open,false);
    assert.equal($('#navigation').closest('#bookmarkSection'),null);
    click('[data-view="analysis"]');assert.equal($('#bookmarkSection').open,false);
    assert.equal($('#analysisPanel .analysis-metrics strong').textContent,'5');
    assert.ok($('#analysisPanel [data-action="webEdit"]'));assert.equal($('#analysisPanel [data-action="contentNote"]'),null);
    click('#analysisPanel [data-analysis-type="topic"]');assert.equal($('#webPanel').hidden,false);assert.ok(document.querySelectorAll('#webPanel .web-card').length>0);assert.equal($('.collection-panel').hidden,true);
    click('[data-view="analysis"]');click('[data-tool-source="bookmarks"]');assert.equal($('#analysisPanel .analysis-metrics strong').textContent,'19');
    click('[data-view="organize"]');assert.ok($('#organizeScope'));click('[data-tool-source="web"]');assert.ok($('#organizerPanel .library-topic-grid'));assert.equal($('#organizeScope'),null);
    click('[data-view="duplicates"]');assert.equal(document.querySelectorAll('#webPanel .web-card').length,0);click('[data-tool-source="bookmarks"]');assert.equal($('#listCount').textContent,'4');
    click('[data-web-nav="all"]');
    document.querySelectorAll('[data-web-select]').forEach((input,i)=>{if(i<2){input.checked=true;input.dispatchEvent(new page.window.Event('change',{bubbles:true}));}});
    // Rendering replaces controls; select the second card through a fresh node.
    const second=document.querySelectorAll('[data-web-select]')[1];second.checked=true;second.dispatchEvent(new page.window.Event('change',{bubbles:true}));
    assert.equal($('.web-bulkbar strong').textContent,'2');click('[data-action="webBulkDelete"]');assert.equal($('#dialog').open,true);submit();
    await until(()=>!$('#dialog').open&&$('#navWeb').textContent==='3','bulk web delete');assert.equal($('#navAll').textContent,'19');assert.equal($('#navTrash').textContent,'2');
    click('[data-view="trash"]');assert.equal(document.querySelectorAll('#webPanel .web-card').length,2);assert.equal($('#emptyTrashButton').hidden,true);
    click('[data-tool-source="bookmarks"]');assert.equal($('#listCount').textContent,'0');assert.equal($('#webPanel').hidden,true);
    click('[data-tool-source="web"]');click('[data-action="webSelectVisible"]');click('[data-action="webBulkRestore"]');await until(()=>$('#navWeb').textContent==='5','bulk restore');assert.equal($('#navAll').textContent,'19');assert.equal($('#navTrash').textContent,'0');
    click('[data-view="all"]');
    const originalRow=document.querySelector('a[href="https://developer.mozilla.org/zh-CN/"]').closest('[data-bookmark-card]');originalRow.querySelector('[data-action="archiveOne"]').click();assert.equal($('#dialog').open,true);submit();
    await until(()=>!$('#dialog').open&&$('#navAll').textContent==='18','delete Chrome bookmark');assert.equal($('#navWeb').textContent,'5');
    click('[data-view="trash"]');assert.equal($('#listCount').textContent,'1');assert.equal($('#webPanel').hidden,true);click('[data-action="restoreOne"]');submit();
    await until(()=>!$('#dialog').open&&$('#navAll').textContent==='19','restore Chrome bookmark');assert.equal($('#navWeb').textContent,'5');
    click('[data-view="backup"]');assert.ok($('#backupPanel [data-action="webExport"]'));assert.ok($('#backupPanel [data-action="backup"]'));assert.equal($('#webPanel').hidden,true);
  }finally{page?.window.close();for(const timer of timers)nativeClearTimeout(timer);globalThis.setTimeout=nativeTimeout;}
});
