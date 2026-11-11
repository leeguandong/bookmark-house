// Isolated native-bookmark simulation; never touches the user's browser data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {LocalStore,DemoAdapter} from '../adapter.js';
import {WebCollection} from '../web-collection.js';

test('folder labels expand children; right-click and keyboard deletion sync the browser tree and preserve webpage cards',async()=>{
  const html=await readFile(new URL('../manager.html',import.meta.url),'utf8');
  const page=new JSDOM(html,{url:'chrome-extension://folder-test/manager.html',pretendToBeVisual:true});
  Object.assign(globalThis,{window:page.window,document:page.window.document,location:page.window.location,indexedDB:new IDBFactory(),innerWidth:1440,innerHeight:900});
  Object.defineProperty(globalThis,'navigator',{value:page.window.navigator,configurable:true});
  const originalTimer=setTimeout,timers=[];
  globalThis.setTimeout=(fn,delay,...args)=>{const timer=originalTimer(fn,delay,...args);timer.unref();timers.push(timer);return timer;};
  globalThis.requestAnimationFrame=fn=>setTimeout(fn,16);globalThis.cancelAnimationFrame=clearTimeout;
  globalThis.BroadcastChannel=class{postMessage(){}close(){}};
  page.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};page.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new page.window.Event('close'));};
  const api=new DemoAdapter(),store=new LocalStore('bookmark-house'),repo=new WebCollection(store);
  const design=[...api.map.values()].find(node=>node.title==='设计灵感'),nested=await api.create({parentId:design.id,title:'界面参考'});
  await api.create({parentId:nested.id,title:'组件案例',url:'https://nested.test/'});
  await repo.add([{url:'https://www.figma.com/',title:'同网址的网页卡片'}]);globalThis.chrome={bookmarks:api};
  const $=selector=>document.querySelector(selector),folder=id=>$(`[data-folder="${id}"]`);
  const until=async(fn,label)=>{for(let i=0;i<150;i++){if(fn())return;await new Promise(resolve=>originalTimer(resolve,10));}throw new Error(label);};
  const context=(anchor,x=100,y=300)=>{const event=new page.window.MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:x,clientY:y,button:2});anchor.dispatchEvent(event);assert.ok(event.defaultPrevented);};
  const submit=()=>$('#dialogForm').dispatchEvent(new page.window.Event('submit',{bubbles:true,cancelable:true}));
  try{
    await import(`../manager.js?folder-context=${Date.now()}`);await until(()=>$('#navAll').textContent==='20','startup');
    assert.equal($('#bookmarkSection').open,false);assert.equal($('.folder-more'),null);
    assert.equal($('#bookmarkSection>summary span').textContent,'书签库');assert.ok($('.sidebar-footer').textContent.includes('留住好内容'));
    $('#bookmarkSection>summary').click();
    assert.equal($('[data-toggle-folder="1"]').getAttribute('aria-expanded'),'true');
    assert.equal(folder(design.id).closest('.folder-branch').querySelector('.folder-children').hidden,true);
    folder(design.id).click();assert.equal($('#pageTitle').textContent,'设计灵感');assert.equal(folder(design.id).closest('.folder-branch').querySelector('.folder-children').hidden,false);
    context(folder(nested.id),1439,899);assert.equal($('#folderMenu').hidden,false);assert.equal($('#pageTitle').textContent,'设计灵感','right-click keeps the current collection view');
    assert.ok(parseFloat($('#folderMenu').style.left)<=1432);assert.ok(parseFloat($('#folderMenu').style.top)<=892);
    document.dispatchEvent(new page.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal($('#folderMenu').hidden,true);assert.equal(document.activeElement,folder(nested.id));
    context(folder('1'));assert.equal($('#folderDeleteMenu').disabled,true);assert.ok($('#folderMenuNote').textContent.includes('不能删除'));$('#pageTitle').click();assert.equal($('#folderMenu').hidden,true);
    folder(design.id).dispatchEvent(new page.window.KeyboardEvent('keydown',{key:'F10',shiftKey:true,bubbles:true,cancelable:true}));assert.equal($('#folderMenu').hidden,false);assert.equal($('#folderDeleteMenu').disabled,false);
    $('#folderDeleteMenu').click();assert.equal($('#dialog').open,true);assert.equal(api.map.has(design.id),true,'opening the confirmation never deletes');$('#dialogCancel').click();assert.equal(api.map.has(design.id),true);
    context(folder(design.id));$('#folderDeleteMenu').click();submit();await until(()=>!$('#dialog').open&&!api.map.has(design.id),'folder deletion');
    assert.equal(api.map.has(nested.id),false);assert.equal((await repo.read()).items.length,1);assert.equal($('#navAll').textContent,'17');
    $('[data-view="trash"]').click();assert.ok($('#list').textContent.includes('设计灵感'));
    $('[data-action="restoreOne"]').click();submit();await until(()=>!$('#dialog').open&&$('#navAll').textContent==='20','folder restore');
    const restored=[...api.map.values()].find(node=>node.title==='设计灵感');assert.ok(restored);assert.equal(restored.parentId,'1');assert.ok(restored.children.some(node=>node.title==='界面参考'));assert.equal((await repo.read()).items.length,1);
  }finally{delete globalThis.chrome;for(const timer of timers)clearTimeout(timer);globalThis.setTimeout=originalTimer;page.window.close();}
});
