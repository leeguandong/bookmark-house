import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {LocalStore} from '../extension/local-store.js';
import {LANGUAGE_KEY} from '../extension/i18n.js';

test('worker restores the saved language and updates native menus and titles after a language change',async()=>{
  globalThis.indexedDB=new IDBFactory();
  const store=new LocalStore('bookmark-house');await store.set(LANGUAGE_KEY,'en');
  const listeners={},menus=[],titles=[],timers=[];
  const nativeTimer=setTimeout;
  globalThis.setTimeout=(fn,delay,...args)=>{const timer=nativeTimer(fn,delay,...args);timer.unref();timers.push(timer);return timer;};
  globalThis.chrome={
    runtime:{id:'synthetic-extension',onInstalled:{addListener:fn=>listeners.installed=fn},onStartup:{addListener:fn=>listeners.startup=fn},onMessage:{addListener:fn=>listeners.message=fn}},
    contextMenus:{removeAll:callback=>callback(),create:(options,callback)=>{menus.push(options);callback();},update:(id,options,callback)=>{menus.push({id,...options});callback();},onClicked:{addListener(){}}},
    action:{setTitle:async options=>titles.push(options.title),setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},
    commands:{onCommand:{addListener(){}}}
  };
  const wait=ms=>new Promise(resolve=>nativeTimer(resolve,ms));
  try{
    await import(`../extension/background.js?language-worker=${Date.now()}`);
    for(let i=0;i<100&&!titles.length;i++)await wait(10);
    assert.equal(menus.at(-1).title,'Save to Bookmark House');assert.equal(titles.at(-1),'Save webpage · Bookmark House');
    listeners.installed();assert.equal(menus.at(-1).title,'Save to Bookmark House');
    const reply=await new Promise(resolve=>assert.equal(listeners.message({type:'bookmark-house-language',language:'zh-CN'},{id:'synthetic-extension'},resolve),true));
    assert.equal(reply.ok,true);assert.equal(await store.get(LANGUAGE_KEY),'zh-CN');assert.equal(menus.at(-1).title,'收藏到书签小屋');assert.equal(titles.at(-1),'保存网页 · 书签小屋');
  }finally{delete globalThis.chrome;for(const timer of timers)clearTimeout(timer);globalThis.setTimeout=nativeTimer;}
});
