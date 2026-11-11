import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {LocalStore,DemoAdapter} from '../adapter.js';
import {WebCollection} from '../web-collection.js';
import {HOME_CACHE_KEY} from '../home-cache.js';

test('the real startup entry paints a cached page before the full collection is available and reconciles a concurrent deletion',async()=>{
  const html=await readFile(new URL('../manager.html',import.meta.url),'utf8'),page=new JSDOM(html,{url:'chrome-extension://startup-test/manager.html',pretendToBeVisual:true});
  Object.assign(globalThis,{window:page.window,document:page.window.document,location:page.window.location,indexedDB:new IDBFactory(),innerWidth:1440,innerHeight:900});
  Object.defineProperty(globalThis,'navigator',{value:page.window.navigator,configurable:true});
  globalThis.chrome={bookmarks:new DemoAdapter()};globalThis.BroadcastChannel=class{postMessage(){}close(){}};
  const preferences=new Map();Object.defineProperty(page.window,'localStorage',{value:{getItem:key=>preferences.get(key)||null,setItem:(key,value)=>preferences.set(key,value)}});
  page.window.localStorage.setItem('bookmark-house.sidebar-layout.v1',JSON.stringify({width:330,collapsed:true}));
  const realTimer=setTimeout,timers=[];globalThis.setTimeout=(fn,delay,...args)=>{const timer=realTimer(fn,delay,...args);timer.unref();timers.push(timer);return timer;};globalThis.requestAnimationFrame=fn=>setTimeout(fn,16);globalThis.cancelAnimationFrame=clearTimeout;
  const store=new LocalStore('bookmark-house'),repo=new WebCollection(store);await repo.add(Array.from({length:40},(_,i)=>({url:`https://sample.test/${i}`,title:'收藏 '+i})));
  const cached=await store.get(HOME_CACHE_KEY),deletedId=cached.items[0].id;
  const originalGet=LocalStore.prototype.get;let release,waiting=false;const gate=new Promise(resolve=>{release=resolve;});
  LocalStore.prototype.get=async function(key){if(key==='webCollectionV1'){waiting=true;await gate;}return originalGet.call(this,key);};
  const until=async(fn)=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(resolve=>realTimer(resolve,10));}throw new Error('startup did not progress');};
  try{
    const entry=await import('../manager-start.js');
    await until(()=>waiting&&document.querySelectorAll('.web-card').length===24);
    assert.equal(document.body.style.getPropertyValue('--sidebar-width'),'72px');
    assert.notEqual(document.body.inert,true,'cached links and sidebar stay usable during the full read');assert.equal(document.querySelector('#navWeb').textContent,'40');assert.ok(document.querySelector(`[data-web-card="${deletedId}"]`));
    assert.equal(document.querySelector('[data-action="webDelete"]').disabled,true,'cached destructive controls wait for authoritative data');
    assert.equal(document.querySelector('.web-card-title').getAttribute('target'),'_blank');
    await repo.remove(deletedId);release();await entry.startup;
    await until(()=>!document.body.inert&&document.querySelector('#navAll').textContent==='19'&&document.querySelector('#navWeb').textContent==='39');
    assert.equal(document.querySelector('#navWeb').textContent,'39');assert.equal(document.querySelector(`[data-web-card="${deletedId}"]`),null);assert.equal(document.querySelectorAll('.web-card').length,24);
    document.querySelector('#mobileMenu').click();assert.equal(document.body.style.getPropertyValue('--sidebar-width'),'330px','startup shares one sidebar controller with the manager');
  }finally{release();LocalStore.prototype.get=originalGet;delete globalThis.chrome;for(const timer of timers)clearTimeout(timer);globalThis.setTimeout=realTimer;page.window.close();}
});
