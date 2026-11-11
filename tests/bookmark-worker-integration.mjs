import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {LocalStore,DemoAdapter} from '../extension/adapter.js';
import {BOOKMARK_CACHE_KEY} from '../extension/bookmark-cache.js';

test('worker defers native prewarming until install/startup or changes, then keeps the closed-manager cache current',async()=>{
  globalThis.indexedDB=new IDBFactory();const api=new DemoAdapter(),store=new LocalStore('bookmark-house'),listeners={},events=new Map();
  const realTimer=setTimeout,timers=[];globalThis.setTimeout=(fn,delay,...args)=>{const timer=realTimer(fn,delay,...args);timer.unref();timers.push(timer);return timer;};
  for(const name of ['onCreated','onRemoved','onChanged','onMoved','onChildrenReordered','onImportBegan','onImportEnded'])api[name]={addListener:fn=>events.set(name,fn)};
  let opens=0;globalThis.chrome={bookmarks:api,runtime:{onInstalled:{addListener:fn=>listeners.installed=fn},onStartup:{addListener:fn=>listeners.startup=fn}},
    contextMenus:{removeAll:callback=>callback(),create:(details,callback)=>callback(),onClicked:{addListener:fn=>listeners.click=fn}},commands:{onCommand:{addListener:fn=>listeners.command=fn}},tabs:{async create(){opens++;}}};
  const until=async(fn,label)=>{for(let i=0;i<200;i++){if(await fn())return;await new Promise(resolve=>realTimer(resolve,10));}throw new Error(label);};
  try{
    await import(`../extension/background.js?native-worker=${Date.now()}`);assert.equal(events.size,7);
    assert.equal(await store.get(BOOKMARK_CACHE_KEY),undefined,'an ordinary capture wake does not scan the native library');
    listeners.installed();
    await until(async()=>(await store.get(BOOKMARK_CACHE_KEY))?.model.bookmarks.length===19,'initial prewarm');
    const node=await api.create({parentId:'1',title:'小屋关闭时添加',url:'https://closed.test/'});events.get('onCreated')(node.id,node);
    await until(async()=>(await store.get(BOOKMARK_CACHE_KEY))?.model.nodes.has(node.id),'closed manager native event');
    await api.update(node.id,{title:'重启前修改'});listeners.startup();
    await until(async()=>(await store.get(BOOKMARK_CACHE_KEY))?.model.nodes.get(node.id)?.title==='重启前修改','startup refresh');assert.equal(opens,0);
  }finally{delete globalThis.chrome;for(const timer of timers)clearTimeout(timer);globalThis.setTimeout=realTimer;}
});
