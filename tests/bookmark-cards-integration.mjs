// Uses synthetic bookmarks only: pagination, multi-select and the actual drag handlers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {DemoAdapter,LocalStore} from '../extension/adapter.js';
import {WebCollection} from '../extension/web-collection.js';

test('native card grid paginates, keeps checkbox focus, excludes managed items, reuses text and moves selected cards by dragging',async()=>{
  const page=new JSDOM(await readFile(new URL('../extension/manager.html',import.meta.url),'utf8'),{url:'chrome-extension://native-cards/manager.html',pretendToBeVisual:true});
  Object.assign(globalThis,{window:page.window,document:page.window.document,location:page.window.location,indexedDB:new IDBFactory(),innerWidth:1440,innerHeight:900});Object.defineProperty(globalThis,'navigator',{value:page.window.navigator,configurable:true});
  const realTimer=setTimeout,timers=[];globalThis.setTimeout=(fn,delay,...args)=>{const timer=realTimer(fn,delay,...args);timer.unref();timers.push(timer);return timer;};globalThis.requestAnimationFrame=fn=>setTimeout(fn,16);globalThis.cancelAnimationFrame=clearTimeout;globalThis.BroadcastChannel=class{postMessage(){}close(){}};
  page.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};page.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  const api=new DemoAdapter(),store=new LocalStore('bookmark-house'),repo=new WebCollection(store);
  for(let i=0;i<45;i++)await api.create({parentId:'1',title:'测试收藏 '+i,url:'https://cards.test/'+i});
  const managed=await api.create({parentId:'1',title:'受管理的收藏',url:'https://managed.test/'});api.map.get(managed.id).unmodifiable='managed';
  const newest=[...api.map.values()].find(node=>node.url==='https://cards.test/44');await repo.add([{url:newest.url,title:newest.title,preview:{summary:'这是一段来自已有网页收藏的内容摘要。'}}]);
  await store.set('meta',{privateTrashVersion:1,privateTrash:[],history:[]});globalThis.chrome={bookmarks:api};
  const $=selector=>document.querySelector(selector),all=selector=>[...document.querySelectorAll(selector)],wait=ms=>new Promise(resolve=>realTimer(resolve,ms));
  const until=async(fn,label)=>{for(let i=0;i<250;i++){if(fn())return;await wait(10);}throw new Error(label);};
  const change=input=>input.dispatchEvent(new page.window.Event('change',{bubbles:true}));
  const card=id=>all('[data-bookmark-card]').find(node=>node.dataset.bookmarkCard===id);
  const dragEvent=(node,type,dataTransfer)=>{const event=new page.window.Event(type,{bubbles:true,cancelable:true});Object.defineProperty(event,'dataTransfer',{value:dataTransfer});node.dispatchEvent(event);return event;};
  try{
    await import(`../extension/manager.js?native-cards=${Date.now()}`);await until(()=>$('#navAll').textContent==='65','native ready');
    $('[data-view="all"]').click();assert.equal($('#list table'),null);assert.equal(all('.bookmark-card').length,60);assert.equal($('#pageNumber').textContent,'1 / 2');assert.ok(card(newest.id).textContent.includes('来自已有网页收藏'));
    assert.ok(card(managed.id).querySelector('[data-select]').disabled);
    $('#selectPage').checked=true;change($('#selectPage'));assert.equal($('#selectedCount').textContent,'59');assert.equal(document.activeElement.id,'selectPage');assert.equal(all('.bookmark-card.selected').length,59);
    $('#nextPage').click();assert.equal(all('.bookmark-card').length,5);assert.equal($('#pageNumber').textContent,'2 / 2');assert.equal($('#selectPage').checked,false);assert.equal($('#selectedCount').textContent,'59');
    $('[data-action="clearSelection"]').click();$('#previousPage').click();
    const ids=all('[data-select]:not(:disabled)').slice(0,2).map(input=>input.dataset.select);
    for(const id of ids){const input=card(id).querySelector('[data-select]');input.checked=true;change(input);assert.equal(document.activeElement.dataset.select,id);}
    assert.equal($('#selectedCount').textContent,'2');assert.equal($('#selectPage').indeterminate,true);
    const values=new Map(),transfer={effectAllowed:'',dropEffect:'',types:[],setData(type,value){values.set(type,value);this.types=[...values.keys()];},getData:type=>values.get(type)||''};
    dragEvent(card(ids[0]).querySelector('[data-drag-bookmark]'),'dragstart',transfer);assert.equal(card(ids[0]).classList.contains('drag-source'),true);assert.equal(transfer.effectAllowed,'copyMove');
    dragEvent($('[data-drop-folder="2"]'),'drop',transfer);await until(()=>ids.every(id=>api.map.get(id).parentId==='2')&&!document.body.classList.contains('is-busy'),'multi-card move');
    assert.equal($('#navAll').textContent,'65');assert.equal((await repo.read()).items.length,1);assert.equal($('#bulkbar').hidden,true);
    $('#search').value='不存在的筛选词';$('#search').dispatchEvent(new page.window.Event('input',{bubbles:true}));await until(()=>$('#list .empty-state'),'empty search');assert.equal($('#list .bookmark-grid'),null);
    $('[data-folder="10"]').click();$('[data-view="all"]').click();$('[data-action="statScope"][data-id="duplicates"]').click();assert.equal(all('.bookmark-card').length,4);assert.equal(all('.is-keeper').length,2,'global duplicates must not retain the previous folder scope');
    $('[data-action="selectDuplicates"]').click();assert.equal($('#selectedCount').textContent,'2');assert.equal(all('.bookmark-card.selected .is-keeper').length,0);
  }finally{delete globalThis.chrome;for(const timer of timers)clearTimeout(timer);globalThis.setTimeout=realTimer;page.window.close();}
});
