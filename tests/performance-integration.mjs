// Isolated extension simulation. No access to browser profiles or live bookmarks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {LocalStore,DemoAdapter} from '../adapter.js';
import {WebCollection} from '../web-collection.js';

test('first cards render before native bookmarks; card updates, focus and background previews avoid redundant work',async()=>{
  const html=await readFile(new URL('../manager.html',import.meta.url),'utf8');
  const page=new JSDOM(html,{url:'chrome-extension://synthetic-performance/manager.html',pretendToBeVisual:true});
  Object.assign(globalThis,{window:page.window,document:page.window.document,location:page.window.location,indexedDB:new IDBFactory(),innerWidth:1440,innerHeight:900});
  Object.defineProperty(globalThis,'navigator',{value:page.window.navigator,configurable:true});
  const realTimer=setTimeout,timers=[];
  globalThis.setTimeout=(fn,delay,...args)=>{const timer=realTimer(fn,delay,...args);timer.unref();timers.push(timer);return timer;};
  globalThis.requestAnimationFrame=fn=>setTimeout(fn,16);globalThis.cancelAnimationFrame=clearTimeout;
  const channels=new Set();
  globalThis.BroadcastChannel=class{constructor(name){this.name=name;channels.add(this);}postMessage(data){for(const other of channels)if(other!==this&&other.name===this.name)queueMicrotask(()=>other.onmessage?.({data}));}close(){channels.delete(this);}};
  page.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  page.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new page.window.Event('close'));};
  const $=selector=>document.querySelector(selector),wait=ms=>new Promise(resolve=>realTimer(resolve,ms));
  const until=async(condition,label)=>{for(let i=0;i<200;i++){if(condition())return;await wait(10);}throw new Error(label);};
  const api=new DemoAdapter(),getTree=api.getTree.bind(api);let treeReads=0,releaseTree;const nativeGate=new Promise(resolve=>{releaseTree=resolve;});
  api.getTree=async()=>{treeReads++;await nativeGate;return getTree();};
  const nativeEvents=new Map();for(const name of ['onCreated','onRemoved','onChanged','onMoved','onChildrenReordered','onImportEnded'])api[name]={addListener:fn=>nativeEvents.set(name,fn)};
  globalThis.chrome={bookmarks:api};
  const repo=new WebCollection(new LocalStore('bookmark-house'));
  const {ids}=await repo.add([{url:'https://a.test/a',title:'第一篇文章',preview:{summary:'文章的实际摘要'}},{url:'https://b.test/b',title:'第二篇文章'}]);
  try{
    await import(`../manager.js?perf-integration=${Date.now()}`);
    await until(()=>$('#webPanel .web-card')&&treeReads===1,'first cards while native tree is pending');
    assert.equal($('#navAll').textContent,'—');releaseTree();
    await until(()=>$('#navAll').textContent==='19'&&nativeEvents.size===6,'native ready');
    const first=$('#webPanel .web-card');treeReads=0;
    window.dispatchEvent(new page.window.Event('focus'));await wait(250);
    assert.equal(treeReads,0);assert.equal($('#webPanel .web-card'),first,'unchanged focus preserves DOM');
    let renders=0;const observer=new page.window.MutationObserver(rows=>{renders+=rows.filter(row=>row.target===$('#webPanel')).length;});observer.observe($('#webPanel'),{childList:true});
    $('#webPanel [data-action="webRead"]').click();
    await until(()=>$('#toastMessage').textContent.includes('已标为已读'),'read marker');await wait(200);
    assert.equal(treeReads,0);assert.equal(renders,1,'own broadcast does not render a second time');
    $('[data-view="analysis"]').click();await wait(20);const hiddenCard=$('#webPanel .web-card');renders=0;
    await repo.enrich(ids[0],'https://a.test/a',{summary:'新补充的正文摘要'});
    await repo.enrich(ids[1],'https://b.test/b',{summary:'另一篇文章的正文摘要'});
    const revision=(await repo.read({light:true})).revision;
    for(const channel of channels)channel.onmessage?.({data:{source:'another-browser-context',revision}});
    await wait(250);assert.equal(treeReads,0);assert.equal(renders,0);assert.equal($('#webPanel .web-card'),hiddenCard,'analysis updates never rebuild the hidden card grid');
    $('[data-web-nav="all"]').click();assert.ok($('#webPanel').textContent.includes('新补充的正文摘要'));
    $('[data-action="webAdd"]').click();assert.equal($('#dialog').open,true);
    await api.create({parentId:'1',title:'外部新增',url:'https://native.test/'});nativeEvents.get('onCreated')();await wait(200);
    assert.equal(treeReads,0);$('#dialog').close();await until(()=>$('#navAll').textContent==='20','queued native update after dialog close');assert.equal(treeReads,1);
    observer.disconnect();
  }finally{releaseTree();delete globalThis.chrome;for(const timer of timers)clearTimeout(timer);globalThis.setTimeout=realTimer;page.window.close();}
});
