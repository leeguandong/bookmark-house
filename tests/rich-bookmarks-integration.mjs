// Synthetic data only; verifies the manager's real cover cache across both views.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {LocalStore,DemoAdapter} from '../extension/adapter.js';
import {WebCollection} from '../extension/web-collection.js';

test('Xiaohongshu bookmarks share cached covers and real content across view changes without cross-source edits',async()=>{
  const page=new JSDOM(await readFile(new URL('../extension/manager.html',import.meta.url),'utf8'),{url:'chrome-extension://rich-native/manager.html',pretendToBeVisual:true});
  Object.assign(globalThis,{window:page.window,document:page.window.document,location:page.window.location,indexedDB:new IDBFactory(),innerWidth:1440,innerHeight:900});Object.defineProperty(globalThis,'navigator',{value:page.window.navigator,configurable:true});
  const realTimer=setTimeout,timers=[];globalThis.setTimeout=(fn,delay,...args)=>{const timer=realTimer(fn,delay,...args);timer.unref();timers.push(timer);return timer;};globalThis.requestAnimationFrame=fn=>setTimeout(fn,16);globalThis.cancelAnimationFrame=clearTimeout;globalThis.BroadcastChannel=class{postMessage(){}close(){}};
  page.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};page.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  const api=new DemoAdapter(),store=new LocalStore('bookmark-house'),repo=new WebCollection(store),url='https://www.xiaohongshu.com/explore/abcdef0123456789abcdef01';
  const a=await api.create({parentId:'1',title:'xiaohongshu.com',url:url+'?xsec_token=bookmark'}),b=await api.create({parentId:'1',title:'xiaohongshu.com',url:url.replace(/01$/,'02')});
  const coverA='data:image/png;base64,AAAA',coverB='data:image/png;base64,BBBB';
  await repo.add([{url,title:'阅读空间的采光与收纳',note:'下次整理时参考',preview:{summary:'通过柔和采光和分层收纳，让阅读角落保持清爽。',cover:coverA,author:'作者甲'}},{url:b.url,title:'周末的另一份旅行笔记',preview:{summary:'旅行线路与沿途停留的记录。',cover:coverB,author:'作者乙'}}]);
  await store.set('meta',{privateTrashVersion:1,privateTrash:[],history:[]});globalThis.chrome={bookmarks:api};
  const covers=WebCollection.prototype.covers,requests=[];let release;const gate=new Promise(resolve=>release=resolve);
  WebCollection.prototype.covers=async function(refs){requests.push([...refs]);await gate;return covers.call(this,refs);};
  const $=selector=>document.querySelector(selector),wait=ms=>new Promise(resolve=>realTimer(resolve,ms));
  const until=async(fn,label)=>{for(let i=0;i<250;i++){if(fn())return;await wait(10);}throw new Error(label);};
  const card=id=>$(`[data-bookmark-card="${id}"]`);
  try{
    await import(`../extension/manager.js?rich-bookmarks=${Date.now()}`);await until(()=>$('#navAll').textContent==='21','startup');
    $('[data-view="all"]').click();assert.equal(card(a.id).querySelector('.web-card-title').textContent,'阅读空间的采光与收纳');assert.ok(card(a.id).textContent.includes('柔和采光'));assert.ok(card(b.id).textContent.includes('旅行线路'));assert.ok(!card(b.id).textContent.includes('柔和采光'));
    assert.equal(card(a.id).querySelector('img').getAttribute('src'),null);assert.equal(requests.length,1,'native view waits for the existing web cover read');
    release();await until(()=>card(a.id).querySelector('img')?.getAttribute('src')===coverA,'shared first cover');assert.equal(card(b.id).querySelector('img').getAttribute('src'),coverB);assert.equal(requests.length,1);
    const input=card(a.id).querySelector('[data-select]');input.checked=true;input.dispatchEvent(new page.window.Event('change',{bubbles:true}));assert.equal(card(a.id).querySelector('img').getAttribute('src'),coverA);assert.equal(requests.length,1,'selection uses image memory cache');
    const image=card(a.id).querySelector('img');image.dispatchEvent(new page.window.Event('error'));assert.equal(card(a.id).querySelector('.web-card-cover'),null);assert.ok(!card(a.id).classList.contains('has-cover'));assert.ok($('#webPanel [data-cover-ref]').isConnected,'failure remains local to this view');
    $('#search').value='采光与收纳';$('#search').dispatchEvent(new page.window.Event('input',{bubbles:true}));await until(()=>$('#listCount').textContent==='1','search extracted title');assert.equal($('#list [data-bookmark-card]').dataset.bookmarkCard,a.id);
    assert.equal(api.map.get(a.id).title,'xiaohongshu.com');assert.equal((await repo.read()).items.length,2);assert.equal((await store.get('contentNotes')),undefined);
  }finally{release();WebCollection.prototype.covers=covers;delete globalThis.chrome;for(const timer of timers)clearTimeout(timer);globalThis.setTimeout=realTimer;page.window.close();}
});
