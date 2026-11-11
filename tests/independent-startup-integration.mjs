// Synthetic IndexedDB and browser API; no access to a Chrome profile.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {LocalStore,DemoAdapter} from '../adapter.js';
import {WebCollection} from '../web-collection.js';
import {BookmarkCache} from '../bookmark-cache.js';

test('a warm library remains usable while the full card read and another tab write lock are held; late cards preserve the chosen folder',async()=>{
  const page=new JSDOM(await readFile(new URL('../manager.html',import.meta.url),'utf8'),{url:'chrome-extension://independent-startup/manager.html',pretendToBeVisual:true});
  Object.assign(globalThis,{window:page.window,document:page.window.document,location:page.window.location,indexedDB:new IDBFactory(),innerWidth:1440,innerHeight:900});
  Object.defineProperty(globalThis,'navigator',{value:page.window.navigator,configurable:true});
  const realTimer=setTimeout,timers=[];globalThis.setTimeout=(fn,delay,...args)=>{const timer=realTimer(fn,delay,...args);timer.unref();timers.push(timer);return timer;};
  globalThis.requestAnimationFrame=fn=>setTimeout(fn,16);globalThis.cancelAnimationFrame=clearTimeout;globalThis.BroadcastChannel=class{postMessage(){}close(){}};
  const store=new LocalStore('bookmark-house'),api=new DemoAdapter(),repo=new WebCollection(store);
  globalThis.chrome={bookmarks:api};
  await store.set('meta',{privateTrashVersion:1,privateTrash:[],history:[]});
  const {ids}=await repo.add([{url:'https://notes.test/one',title:'第一篇'},{url:'https://notes.test/two',title:'第二篇'}]);
  await new BookmarkCache(api,store).read();
  let releaseCards,releaseWriter,waiting=false,writeLocks=0;
  const cardsGate=new Promise(resolve=>releaseCards=resolve),writerGate=new Promise(resolve=>releaseWriter=resolve);
  Object.defineProperty(navigator,'locks',{configurable:true,value:{async request(name,fn){if(name==='bookmark-house-write'){writeLocks++;await writerGate;}return fn();}}});
  const originalGet=LocalStore.prototype.get;
  LocalStore.prototype.get=async function(key){if(key==='webCollectionV1'){waiting=true;await cardsGate;}return originalGet.call(this,key);};
  const $=selector=>document.querySelector(selector),until=async(fn,label)=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(resolve=>realTimer(resolve,10));}throw new Error(label);};
  try{
    await import('../manager-start.js');
    await until(()=>waiting&&$('#navAll').textContent==='19','independent native startup');
    assert.equal(writeLocks,0,'ordinary startup must not wait for an unrelated write lock');
    assert.notEqual(document.body.inert,true);
    const cachedCard=$('#webPanel .web-card');assert.ok(cachedCard);
    assert.equal($('#webPanel [data-action="webDelete"]').disabled,true);
    $('#mobileMenu').click();assert.equal(document.body.classList.contains('sidebar-collapsed'),true);
    $('#mobileMenu').click();$('[data-folder="1"]').click();
    assert.equal($('#pageTitle').textContent,'书签栏');assert.ok($('#list .bookmark-card'));
    assert.equal($('#webPanel .web-card'),cachedCard,'native startup does not replace cached cards');
    await repo.remove(ids[0]);releaseCards();
    await until(()=>!$('#webPanel').hasAttribute('aria-busy')&&$('#navWeb').textContent==='1','full collection is reconciled');
    assert.equal($('#pageTitle').textContent,'书签栏','late collection data does not reset navigation');
    assert.equal(writeLocks,0);
    $('[data-web-nav="all"]').click();assert.equal($('#webPanel .web-card-title').textContent,'第二篇');
    assert.equal($('#webPanel [data-action="webDelete"]').disabled,false);
    assert.equal(document.querySelectorAll('#webPanel .web-card').length,1);
  }finally{releaseCards();releaseWriter();LocalStore.prototype.get=originalGet;delete globalThis.chrome;for(const timer of timers)clearTimeout(timer);globalThis.setTimeout=realTimer;page.window.close();}
});
