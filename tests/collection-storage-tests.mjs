import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {LocalStore} from '../extension/adapter.js';
import {WebCollection,WEB_COLLECTION_KEY,collectionBackup} from '../extension/web-collection.js';
import {AutoPreview} from '../extension/auto-preview.js';
import {COLLECTION_LAYOUT_KEY,COLLECTION_BACKUP_KEY} from '../extension/collection-storage.js';
import {WebCollectionView} from '../extension/web-collection-view.js';
import {JSDOM} from 'jsdom';
globalThis.indexedDB=new IDBFactory();
const cover='data:image/jpeg;base64,'+'A'.repeat(100000);
const fixture=async(name)=>{const store=new LocalStore(name),repo=new WebCollection(store),{ids}=await repo.add([{url:'https://a.test/a',title:'文章标题',note:'自己的备注',preview:{summary:'这篇文章的摘要',cover}}]);return {store,repo,id:ids[0]};};

test('legacy cards and purge backup migrate together without losing covers, dates or notes',async()=>{
  const store=new LocalStore('legacy-migration'),item={id:'old',url:'https://a.test/',title:'旧收藏',note:'原笔记',savedAt:1000,readAt:1200,starred:true,deletedAt:null,preview:{cover,summary:'原摘要'}};
  const legacy={version:1,revision:7,items:[item],purgeBackup:{date:1400,items:[{...item,id:'purged',deletedAt:1300}]}};
  await store.set(WEB_COLLECTION_KEY,legacy);
  const repo=new WebCollection(store),light=await repo.read({light:true});
  assert.equal(light.revision,7);assert.equal(light.items[0].preview.cover,'');assert.ok(light.items[0].preview.coverRef);
  assert.equal(light.purgeBackup.count,1);assert.ok(!light.purgeBackup.items);
  assert.ok(JSON.stringify(light).length<2000);
  assert.deepEqual(await repo.read(),legacy);
  assert.deepEqual(collectionBackup(await repo.read()).items,legacy.items);
  const second=new WebCollection(new LocalStore('legacy-migration'));
  assert.deepEqual(await second.read(),legacy);
});

test('a failed migration rolls back the index, cover records and layout marker together',async()=>{
  const store=new LocalStore('failed-migration'),legacy={version:1,revision:3,items:[{id:'legacy',preview:{cover}}],purgeBackup:null};
  await store.set(WEB_COLLECTION_KEY,legacy);
  const update=store.update.bind(store);let fail=true;
  store.update=(key,fn)=>update(key,(raw,records)=>{const value=fn(raw,records);if(fail)throw new Error('simulated commit failure');return value;});
  const repo=new WebCollection(store);await assert.rejects(repo.read(),/commit failure/);
  assert.deepEqual(await store.get(WEB_COLLECTION_KEY),legacy);assert.equal(await store.get(COLLECTION_LAYOUT_KEY),undefined);
  fail=false;assert.deepEqual(await repo.read(),legacy);
});

test('read, star, edits, enrichment, delete and restore preserve external covers without re-writing them',async()=>{
  const {store,repo,id}=await fixture('cover-actions'),before=(await repo.read()).items[0];
  const originalRef=(await repo.read({light:true})).items[0].preview.coverRef;
  const puts=[],update=store.update.bind(store);
  store.update=(key,fn)=>update(key,(raw,records)=>fn(raw,{...records,put:(key,value)=>{puts.push(key);records.put(key,value);}}));
  await repo.toggle(id,'starred');await repo.toggle(id,'readAt');await repo.edit(id,{url:before.url,title:'改标题',note:'改备注'});
  await repo.enrich(id,before.url,{summary:'更新摘要'});await repo.remove(id);await repo.restore(id);
  const after=(await repo.read()).items[0];assert.equal(after.preview.cover,cover);assert.equal(after.savedAt,before.savedAt);assert.equal(after.title,'改标题');
  assert.equal((await repo.read({light:true})).items[0].preview.coverRef,originalRef);assert.ok(!puts.some(key=>key.startsWith('webCover:')));
  await repo.edit(id,{url:before.url,title:after.title,note:after.note,removeCover:true});assert.equal((await repo.read()).items[0].preview.cover,'');assert.equal(await store.get(originalRef),undefined);
});

test('purge keeps a complete recoverable backup and replaces only the previous purge backup',async()=>{
  const {store,repo,id}=await fixture('purge-covers');await repo.remove(id);await repo.purgeDeleted((await repo.read({light:true})).revision);
  const first=await repo.read(),oldRef=(await store.get(COLLECTION_BACKUP_KEY)).items[0].preview.coverRef;
  assert.equal(first.items.length,0);assert.equal(first.purgeBackup.items[0].preview.cover,cover);
  const target=new WebCollection(new LocalStore('purge-import'));await target.importBackup(collectionBackup(first.purgeBackup));assert.equal((await target.read()).items[0].preview.cover,cover);
  const second=await repo.add([{url:'https://b.test/',preview:{cover:'data:image/jpeg;base64,BBBB'}}]);
  await repo.remove(second.ids[0]);await repo.purgeDeleted((await repo.read({light:true})).revision);
  assert.equal((await repo.read()).purgeBackup.items[0].preview.cover,'data:image/jpeg;base64,BBBB');assert.equal(await store.get(oldRef),undefined);
});

test('full export reads one consistent snapshot while another connection removes a cover',async()=>{
  const {store,repo,id}=await fixture('snapshot-export'),second=new WebCollection(new LocalStore('snapshot-export'));
  await second.prepare();
  const [snapshot]=await Promise.all([repo.read(),second.edit(id,{url:'https://a.test/a',title:'文章标题',note:'',removeCover:true})]);
  assert.equal(snapshot.items[0].preview.cover,cover);assert.equal((await repo.read()).items[0].preview.cover,'');
});

test('failed summaries have a persistent cooldown, explicit retry and later retry remain available',async()=>{
  const {repo}=await fixture('retry-cooldown');const item=(await repo.read({light:true})).items[0];item.preview={};let reads=0,now=1000;
  const queue=()=>new AutoPreview(repo,async()=>{},{now:()=>now,read:async()=>{reads++;return null;}});
  await queue().enqueue([item]);await queue().enqueue([item]);assert.equal(reads,1);
  await queue().enqueue([item],{force:true});assert.equal(reads,2);
  now+=31*60*1000;await queue().enqueue([item]);assert.equal(reads,3);
  assert.equal((await repo.read()).items[0].preview.cover,cover);
});

test('cover replacement and a failed edit keep the committed collection intact',async()=>{
  const {store,repo,id}=await fixture('failed-cover-edit'),before=await repo.read();
  const update=store.update.bind(store);
  store.update=(key,fn)=>update(key,(raw,records)=>{fn(raw,records);throw new Error('write failed');});
  await assert.rejects(repo.enrich(id,'https://a.test/a',{cover:'data:image/jpeg;base64,CCCC'}),/write failed/);
  assert.deepEqual(await repo.read(),before);
  store.update=update;
  await repo.edit(id,{url:'https://different.test/',title:'另一个地址',note:''});
  assert.equal((await repo.read()).items[0].preview.cover,'');
});

test('only the displayed covers are read; subsequent renders reuse the bounded cache',async()=>{
  const store=new LocalStore('visible-covers'),repo=new WebCollection(store);
  for(let batch=0;batch<2;batch++)await repo.add(Array.from({length:40},(_,i)=>({url:`https://a.test/${batch*40+i}`,title:'卡片 '+(batch*40+i),preview:{cover:'data:image/jpeg;base64,AAAA'}})));
  const page=new JSDOM('<div id="cards"></div>');globalThis.document=page.window.document;
  const loads=[],getMany=store.getMany.bind(store);store.getMany=keys=>{loads.push(keys);return getMany(keys);};
  const view=new WebCollectionView({container:document.querySelector('#cards'),repository:repo,onCount(){},getSearch:()=>'',getModel:()=>({bookmarks:[]})});
  try{
    await view.refresh();assert.equal(loads.length,0);view.render();
    for(let i=0;i<50&&!document.querySelector('img[src]');i++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(loads.length,1);assert.equal(loads[0].length,24);assert.equal(document.querySelectorAll('img[src]').length,24);
    view.render();assert.equal(loads.length,1);assert.equal(document.querySelectorAll('img[src]').length,24);
    view.limit=48;view.render();
    for(let i=0;i<50&&document.querySelectorAll('img[src]').length<48;i++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(loads.length,2);assert.equal(loads[1].length,24);assert.equal(document.querySelectorAll('img[src]').length,48);
  }finally{page.window.close();delete globalThis.document;}
});
