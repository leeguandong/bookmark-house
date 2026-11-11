import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {JSDOM} from 'jsdom';
import {LocalStore} from '../local-store.js';
import {WebCollection} from '../web-collection.js';
import {HOME_CACHE_KEY,HOME_CACHE_LAYOUT_KEY,validHomeCache,rememberHomePreview} from '../home-cache.js';
import {renderWebCollection} from '../web-collection-render.js';
import {WebCollectionView} from '../web-collection-view.js';
globalThis.indexedDB=new IDBFactory();
let fixtureId=0;
async function fixture(){const name='home-cache-'+(++fixtureId),store=new LocalStore(name),repo=new WebCollection(store);await repo.add(Array.from({length:40},(_,i)=>({url:`https://a.test/${i}`,title:'收藏 '+i,note:'备注',preview:{summary:'真实的内容摘要',cover:'data:image/jpeg;base64,AAAA'}})));return {name,store,repo};}

test('first-page cache is bounded, contains accurate totals and never embeds cover data',async()=>{
  const {store,repo}=await fixture(),snapshot=await store.get(HOME_CACHE_KEY),data=await repo.read({light:true});
  assert.ok(validHomeCache(snapshot));assert.equal(snapshot.items.length,24);assert.equal(snapshot.summary.counts.all,40);assert.equal(snapshot.summary.counts.unread,40);assert.equal(snapshot.token,data.cacheToken);
  assert.ok(!JSON.stringify(snapshot).includes('data:image'));assert.ok(JSON.stringify(snapshot).length<160000);
  assert.equal(snapshot.items[0].preview.cover,'');assert.ok(snapshot.items[0].preview.coverRef);
  const html=renderWebCollection(snapshot,{summary:snapshot.summary});assert.ok(html.includes('已显示 24 / 40'));assert.ok(html.includes('再看 16 个网页'));
  assert.equal((await repo.read()).items[0].preview.cover,'data:image/jpeg;base64,AAAA');
});

test('changes from a second connection, deletions and restores atomically update the cached first page',async()=>{
  const {name,store,repo}=await fixture(),other=new WebCollection(new LocalStore(name));const first=await store.get(HOME_CACHE_KEY),id=first.items[0].id;
  await other.remove(id);let current=await store.get(HOME_CACHE_KEY);assert.equal(current.summary.counts.all,39);assert.equal(current.summary.counts.deleted,1);assert.ok(!current.items.some(item=>item.id===id));assert.notEqual(current.token,first.token);
  await repo.restore(id);await other.toggle(id,'starred');await other.toggle(id,'readAt');current=await store.get(HOME_CACHE_KEY);assert.equal(current.summary.counts.all,40);assert.equal(current.summary.counts.starred,1);assert.equal(current.summary.counts.read,1);
  const original=store.update.bind(store),before=await store.get(HOME_CACHE_KEY);
  store.update=(key,fn)=>original(key,(raw,records)=>{fn(raw,records);throw new Error('failed commit');});
  await assert.rejects(repo.remove(id),/failed commit/);assert.deepEqual(await store.get(HOME_CACHE_KEY),before);assert.equal((await other.read()).items.find(item=>item.id===id).deletedAt,null);
});

test('old installations create the cache without losing data; malformed or unsafe caches are rejected',async()=>{
  const store=new LocalStore('old-cache-layout');await store.set('webCollectionLayoutV2',2);
  const legacy={version:1,revision:7,items:[],purgeBackup:null,storageVersion:2};await store.set('webCollectionV1',legacy);
  const repo=new WebCollection(store);await repo.read();assert.equal(await store.get(HOME_CACHE_LAYOUT_KEY),1);const empty=await store.get(HOME_CACHE_KEY);assert.ok(validHomeCache(empty));
  assert.equal(validHomeCache({...empty,version:9}),false);assert.equal(validHomeCache({...empty,summary:{counts:{all:1}}}),false);
  assert.equal(validHomeCache({...empty,items:[{id:'bad',url:'javascript:alert(1)',savedAt:1}],summary:{...empty.summary,counts:{...empty.summary.counts,all:1}}}),false);
  assert.equal(validHomeCache({...empty,timezone:empty.timezone+1}),false);
});

test('verified first page reuses its DOM; stale cache is replaced; bookmarking changes only its badge',async()=>{
  const {store,repo}=await fixture(),snapshot=await store.get(HOME_CACHE_KEY),page=new JSDOM('<div id="cards"></div>',{url:'http://local.invalid/'}),panel=page.window.document.querySelector('#cards');
  let model={bookmarks:[]};
  const view=new WebCollectionView({container:panel,repository:repo,getModel:()=>model,getSearch:()=>'',onCount(){}});
  try{
    panel.innerHTML=renderWebCollection(snapshot,{summary:snapshot.summary});rememberHomePreview(panel,snapshot);const original=panel.querySelector('.web-card');
    await view.refresh();view.adoptCachedHome();view.render();assert.equal(panel.querySelector('.web-card'),original);
    model={bookmarks:[{url:snapshot.items[0].url}]};view.render();assert.equal(panel.querySelector('.web-card'),original);assert.ok(original.querySelector('.web-bookmarked'));
    const damaged=structuredClone(snapshot);damaged.items[0].title='错误的缓存标题';panel.innerHTML=renderWebCollection(damaged,{summary:damaged.summary});rememberHomePreview(panel,damaged);view.lastRenderKey=null;
    view.adoptCachedHome();view.render();assert.ok(!panel.textContent.includes('错误的缓存标题'),'even a matching revision must agree with the authoritative first-page data');
    await repo.remove(snapshot.items[0].id);await view.refresh();view.render();assert.notEqual(panel.querySelector('.web-card'),original);assert.ok(!panel.querySelector(`[data-web-card="${snapshot.items[0].id}"]`));
    panel.innerHTML=renderWebCollection(snapshot,{summary:snapshot.summary});rememberHomePreview(panel,snapshot);view.lastRenderKey=null;await view.refresh();view.adoptCachedHome();view.render();assert.ok(!panel.querySelector(`[data-web-card="${snapshot.items[0].id}"]`));
  }finally{page.window.close();}
});
