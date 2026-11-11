// Synthetic extension popup and IndexedDB only; never connects to Chrome.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {LocalStore} from '../local-store.js';
import {WebCollection} from '../web-collection.js';
import {capturePageDetails} from '../quick-capture.js';
const html=await readFile(new URL('../popup.html',import.meta.url),'utf8');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){for(let i=0;i<200;i++){if(fn())return;await delay(10);}throw new Error(label);}

test('popup becomes usable and saves in one commit while an old-card lookup is blocked; untouched notes use current stored data',async()=>{
  const page=new JSDOM(html,{url:'chrome-extension://popup-speed/popup.html'});
  Object.assign(globalThis,{window:page.window,document:page.window.document,location:page.window.location,indexedDB:new IDBFactory(),BroadcastChannel:class{postMessage(){}close(){}}});
  const repository=new WebCollection(new LocalStore('bookmark-house')),url='https://article.test/current';
  const {ids}=await repository.add([{url,title:'自己改过的标题',titleEdited:true,note:'原备注',preview:{description:'自己整理的摘要',descriptionEdited:true,cover:'data:image/jpeg;base64,AQID'}}]);
  const first=(await repository.read()).items[0];
  let release,lookupWaiting=false,commits=0;
  const gate=new Promise(resolve=>release=resolve),read=WebCollection.prototype.read,update=LocalStore.prototype.update;
  WebCollection.prototype.read=async function(options){if(options?.light){lookupWaiting=true;await gate;}return read.call(this,options);};
  LocalStore.prototype.update=async function(key,...args){if(key==='webCollectionV1')commits++;return update.call(this,key,...args);};
  globalThis.chrome={tabs:{async query(){return [{id:10,url,title:'网页的新标题'}];}},scripting:{async executeScript(args){assert.equal(args.injectImmediately,true);return [{result:{url,title:'网页的新标题',description:'来自网页的新摘要'}}];}}};
  const $=selector=>document.querySelector(selector);
  try{
    await import('../popup.js?speed');
    await until(()=>lookupWaiting&&!$('#capturePage').disabled,'popup ready before lookup');
    assert.equal($('#currentTitle').textContent,'网页的新标题');assert.equal($('#openHouse').disabled,false);
    await repository.edit(ids[0],{url,title:first.title,note:'在另一个窗口刚更新的备注'});commits=0;
    $('#capturePage').click();assert.equal($('#capturePage').textContent,'正在保存…');assert.equal($('#captureNote').disabled,true);
    await until(()=>$('#capturePage').textContent==='已保存 ✓','save completes before the lookup');
    assert.equal(commits,1,'captured metadata and note are committed together without preliminary full reads');
    let item=(await repository.read()).items[0];
    assert.equal(item.note,'在另一个窗口刚更新的备注');assert.equal(item.title,first.title);assert.equal(item.savedAt,first.savedAt);assert.equal(item.preview.description,first.preview.description);assert.equal(item.preview.cover,first.preview.cover);
    release();await delay(30);assert.equal($('#capturePage').textContent,'已保存 ✓','late lookup cannot overwrite save feedback');
    $('#captureNote').value='';$('#captureNote').dispatchEvent(new page.window.Event('input',{bubbles:true}));$('#capturePage').click();
    await until(()=>$('#capturePage').textContent==='已保存 ✓','explicitly clearing the note');
    item=(await repository.read()).items[0];assert.equal(item.note,'');assert.equal(item.savedAt,first.savedAt);
  }finally{release();WebCollection.prototype.read=read;LocalStore.prototype.update=update;delete globalThis.chrome;page.window.close();}
});

test('late duplicate lookup preserves text already being typed into the popup',async()=>{
  const page=new JSDOM(html,{url:'chrome-extension://popup-note-race/popup.html'});
  Object.assign(globalThis,{window:page.window,document:page.window.document,location:page.window.location,indexedDB:new IDBFactory(),BroadcastChannel:class{postMessage(){}close(){}}});
  const repository=new WebCollection(new LocalStore('bookmark-house')),url='https://article.test/typing';await repository.add([{url,title:'文章',note:'旧备注'}]);
  let release,waiting=false;const gate=new Promise(resolve=>release=resolve),read=WebCollection.prototype.read;
  WebCollection.prototype.read=async function(options){if(options?.light){waiting=true;await gate;}return read.call(this,options);};
  globalThis.chrome={tabs:{async query(){return [{id:10,url,title:'文章'}];}}};
  const $=selector=>document.querySelector(selector);
  try{
    await import('../popup.js?note-race');await until(()=>waiting&&!$('#capturePage').disabled,'popup ready');
    $('#captureNote').value='正在写的新想法';$('#captureNote').dispatchEvent(new page.window.Event('input',{bubbles:true}));release();
    await until(()=>$('#capturePage').textContent==='更新备注','lookup finished');assert.equal($('#captureNote').value,'正在写的新想法');
  }finally{release();WebCollection.prototype.read=read;delete globalThis.chrome;page.window.close();}
});

test('a stalled page extraction has a deadline, uses immediate injection and retains the link without taking a wrong screenshot',async()=>{
  let screenshots=0;
  const tab={id:1,windowId:2,url:'https://slow.test/current',title:'还在加载的网页'};
  const result=await capturePageDetails(tab,{snapshot:true,timeoutMs:30,api:{scripting:{executeScript(args){assert.equal(args.injectImmediately,true);return new Promise(()=>{});}},tabs:{async query(){return [tab];},async captureVisibleTab(){screenshots++;return '';}}}});
  assert.equal(result.url,tab.url);assert.equal(result.title,tab.title);assert.equal(result.contentTimedOut,true);assert.equal(screenshots,0);
});

test('a stalled screenshot cannot discard a successfully extracted summary',async()=>{
  const tab={id:1,windowId:2,url:'https://slow.test/cover',title:'文章'};
  const result=await capturePageDetails(tab,{snapshot:true,timeoutMs:30,api:{scripting:{async executeScript(){return [{result:{url:tab.url,title:tab.title,description:'已经读取的真实文章内容。'}}];}},tabs:{async query(){return [tab];},captureVisibleTab(){return new Promise(()=>{});}}}});
  assert.equal(result.preview.description,'已经读取的真实文章内容。');assert.equal(result.preview.cover,'');assert.equal(result.contentTimedOut,true);
});

test('concurrent fast captures create one card; restoring and updating it retain dates and personal content',async()=>{
  globalThis.indexedDB=new IDBFactory();globalThis.BroadcastChannel=class{postMessage(){}close(){}};
  const store=new LocalStore('atomic-capture'),a=new WebCollection(store),b=new WebCollection(new LocalStore('atomic-capture')),link={url:'https://atomic.test/one',title:'文章'};
  const results=await Promise.all([a.saveCapture(link,{note:'主动填写的备注'}),b.saveCapture(link)]);
  assert.equal(results.reduce((n,r)=>n+r.added,0),1);let data=await a.read();assert.equal(data.items.length,1);assert.equal(data.items[0].note,'主动填写的备注');
  const saved=data.items[0];await a.remove(saved.id);const restored=await b.saveCapture(link);assert.equal(restored.restored,1);assert.equal(restored.item.id,saved.id);assert.equal(restored.item.note,saved.note);assert.equal(restored.item.createdAt,saved.createdAt);assert.equal(restored.item.deletedAt,null);
});
