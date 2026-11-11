// Isolated DOM/IndexedDB simulation; never connects to or controls a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {LocalStore} from '../extension/adapter.js';
import {WebCollection} from '../extension/web-collection.js';
const html=await readFile(new URL('../extension/manager.html',import.meta.url),'utf8');
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
async function load(){setup();await import(new URL(`../extension/manager.js?dom-check=${++loadNumber}`,import.meta.url));await until(()=>$('#webPanel .web-card')&&['19','20'].includes($('#navAll').textContent),'startup');}
function click(selector){const el=$(selector);assert.ok(el,selector);el.click();}
function submit(){ $('#dialogForm').dispatchEvent(new page.window.Event('submit',{bubbles:true,cancelable:true})); }
function dropped(url,title){const event=new page.window.Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(event,'dataTransfer',{value:{types:['text/uri-list','text/html'],getData(type){return type==='text/uri-list'?url:type==='text/html'?`<a href="${url}">${title}</a>`:'';}}});$('#webPanel .web-capture').dispatchEvent(event);}

test('manager starts on cards, saves and drops independently, adds a Chrome bookmark, and reloads durable data',async()=>{
  try{
    await load();
    assert.equal($('#bookmarkSection').open,false);assert.equal($('#webPanel').hidden,false);assert.equal($('.stats').hidden,true);assert.equal($('.collection-panel').hidden,true);assert.equal(document.querySelectorAll('#webPanel .web-card').length,5);
    assert.equal($('[data-toggle-folder="1"]').getAttribute('aria-expanded'),'true');assert.equal($('#navWeb').textContent,'5');
    click('[data-web-nav="starred"]');assert.equal($('#pageTitle').textContent,'星标收藏');assert.equal(document.querySelectorAll('#webPanel .web-card').length,2);assert.equal($('[data-web-nav="starred"]').getAttribute('aria-current'),'page');
    click('[data-action="webFilter"][data-id="unread"]');assert.equal($('#pageTitle').textContent,'未读内容');assert.equal(document.querySelectorAll('#webPanel .web-card').length,4);
    click('[data-view="trash"]');assert.equal(document.querySelectorAll('#webPanel .web-card').length,0);assert.equal($('#pageTitle').textContent,'回收站');
    click('[data-web-nav="all"]');assert.equal($('#pageTitle').textContent,'网页收藏');assert.equal(document.querySelectorAll('[data-web-nav].active').length,1);
    const menu=$('.web-card-menu');menu.open=true;document.dispatchEvent(new page.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(menu.open,false);
    menu.open=true;click('#pageTitle');assert.equal(menu.open,false);

    click('#webHeadingActions [data-action="webAdd"]');assert.equal($('#dialog').open,true);
    $('#webUrl').value='https://example.com/dom-saved';$('#webTitle').value='模拟保存网页';$('#webNote').value='来自独立测试的备注';submit();
    await until(()=>!$('#dialog').open&&$('#navWeb').textContent==='6','card save');assert.equal($('#navAll').textContent,'19');assert.ok($('#webPanel').textContent.includes('模拟保存网页'));

    dropped('https://example.com/dom-dropped','拖拽标题与日期');await until(()=>$('#navWeb').textContent==='7','drop');assert.ok($('#webPanel').textContent.includes('拖拽标题与日期'));assert.equal($('#bookmarkSection').open,false);assert.equal($('#navAll').textContent,'19');
    dropped('https://example.com/dom-dropped','重复网页');await until(()=>$('#toastMessage').textContent.includes('已经收藏'),'duplicate drop');assert.equal($('#navWeb').textContent,'7');

    const card=[...document.querySelectorAll('#webPanel .web-card')].find(n=>n.textContent.includes('模拟保存网页'));assert.ok(card);
    card.querySelector('[data-action="webBookmark"]').click();await until(()=>$('#dialog').open,'bookmark dialog');assert.equal($('#webBookmarkFolder').value,'1');submit();
    await until(()=>!$('#dialog').open&&$('#navAll').textContent==='20','bookmark creation');assert.equal($('#navWeb').textContent,'7');assert.ok([...document.querySelectorAll('#webPanel .web-card')].find(n=>n.textContent.includes('模拟保存网页')).textContent.includes('已在书签'));

    click('[data-view="all"]');assert.equal($('#bookmarkSection').open,true);assert.equal($('#webPanel').hidden,true);assert.equal($('.collection-panel').hidden,false);assert.equal($('#statTotal').textContent,'20');
    click('[data-view="web"]');assert.equal($('#webPanel').hidden,false);

    const current=[...document.querySelectorAll('#webPanel .web-card')].find(n=>n.textContent.includes('模拟保存网页'));current.querySelector('[data-action="webDelete"]').click();await until(()=>$('#navWeb').textContent==='6','soft delete');assert.equal($('#navAll').textContent,'20');
    click('[data-view="trash"]');assert.equal(document.querySelectorAll('#webPanel .web-card').length,1);click('[data-action="webRestore"]');await until(()=>$('#navWeb').textContent==='7','restore card');

    await load();assert.equal($('#bookmarkSection').open,false);assert.equal($('#webPanel').hidden,false);assert.equal($('#navWeb').textContent,'7');assert.equal($('#navAll').textContent,'20');assert.ok($('#webPanel').textContent.includes('来自独立测试的备注'));
  }finally{page?.window.close();for(const timer of timers)nativeClearTimeout(timer);globalThis.setTimeout=nativeTimeout;}
});
test('two local database connections serialize concurrent popup and manager captures',async()=>{
  globalThis.indexedDB=idb;
  const first=new WebCollection(new LocalStore('synthetic-concurrency')),second=new WebCollection(new LocalStore('synthetic-concurrency'));
  await Promise.all([first.add([{url:'https://example.com/one'}]),second.add([{url:'https://example.com/two'}]),first.add([{url:'https://example.com/three'}]),second.add([{url:'https://example.com/one'}])]);
  const data=await first.read();assert.equal(data.items.length,3);assert.equal(new Set(data.items.map(n=>n.url)).size,3);
});
