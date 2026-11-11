// A warm manager opens while the synthetic browser read is held behind a gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {LocalStore,DemoAdapter} from '../extension/adapter.js';
import {BookmarkCache} from '../extension/bookmark-cache.js';
import {WebCollection} from '../extension/web-collection.js';

test('cached folders are interactive before browser verification; identical verification preserves DOM; external edits refresh cache and UI',async()=>{
  const page=new JSDOM(await readFile(new URL('../extension/manager.html',import.meta.url),'utf8'),{url:'chrome-extension://cached-library/manager.html',pretendToBeVisual:true});
  Object.assign(globalThis,{window:page.window,document:page.window.document,location:page.window.location,indexedDB:new IDBFactory(),innerWidth:1440,innerHeight:900});
  Object.defineProperty(globalThis,'navigator',{value:page.window.navigator,configurable:true});
  const realTimer=setTimeout,timers=[];globalThis.setTimeout=(fn,delay,...args)=>{const timer=realTimer(fn,delay,...args);timer.unref();timers.push(timer);return timer;};
  globalThis.requestAnimationFrame=fn=>setTimeout(fn,16);globalThis.cancelAnimationFrame=clearTimeout;globalThis.BroadcastChannel=class{postMessage(){}close(){}};
  page.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};page.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new page.window.Event('close'));};
  const store=new LocalStore('bookmark-house'),api=new DemoAdapter(),nativeEvents=new Map();
  for(const name of ['onCreated','onRemoved','onChanged','onMoved','onChildrenReordered','onImportBegan','onImportEnded'])api[name]={addListener:fn=>nativeEvents.set(name,fn)};
  globalThis.chrome={bookmarks:api};
  await store.set('meta',{privateTrashVersion:1,privateTrash:[],history:[]});
  await new WebCollection(store).add([{url:'https://card.test/one',title:'网页卡片'}]);await new BookmarkCache(api,store).read();
  let release,treeReads=0;const gate=new Promise(resolve=>release=resolve),getTree=api.getTree.bind(api);api.getTree=async()=>{treeReads++;await gate;return getTree();};
  const $=selector=>document.querySelector(selector),wait=ms=>new Promise(resolve=>realTimer(resolve,ms));
  const until=async(fn,label)=>{for(let i=0;i<250;i++){if(fn())return;await wait(10);}throw new Error(label);};
  try{
    await import(`../extension/manager.js?warm-native=${Date.now()}`);
    await until(()=>$('#navAll').textContent==='19','cached library ready');assert.equal(treeReads,0,'opening does not wait for native API');
    $('[data-folder="1"]').click();assert.equal($('#pageTitle').textContent,'书签栏');assert.ok($('#list').textContent.includes('GitHub'));
    const folder=$('[data-folder="1"]'),list=$('#list').firstElementChild;
    await until(()=>treeReads===1,'deferred verification starts');assert.equal($('#navAll').textContent,'19');release();await wait(250);
    assert.equal($('[data-folder="1"]'),folder);assert.equal($('#list').firstElementChild,list,'unchanged verification keeps current rows');
    const newNode=await api.create({parentId:'1',title:'来自浏览器的新增',url:'https://external.test/'});nativeEvents.get('onCreated')();
    await until(()=>$('#navAll').textContent==='20','external native addition');assert.ok($('#list').textContent.includes('来自浏览器的新增'));
    await api.update(newNode.id,{title:'更新后的标题'});nativeEvents.get('onChanged')();await until(()=>$('#list').textContent.includes('更新后的标题'),'rename');
    await api.remove(newNode.id);nativeEvents.get('onRemoved')();await until(()=>$('#navAll').textContent==='19','delete');assert.ok(!$('#list').textContent.includes('更新后的标题'));
    const persisted=await new BookmarkCache(api,new LocalStore('bookmark-house')).read();assert.equal(persisted.fromCache,true);assert.ok(!persisted.snapshot.model.nodes.has(newNode.id));
  }finally{release();delete globalThis.chrome;for(const timer of timers)clearTimeout(timer);globalThis.setTimeout=realTimer;page.window.close();}
});
