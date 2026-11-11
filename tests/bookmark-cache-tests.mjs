// Synthetic native API and IndexedDB only; never reads browser bookmarks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {LocalStore,DemoAdapter} from '../extension/adapter.js';
import {BookmarkEngine,flatten,findDuplicates,treeSignature} from '../extension/core.js';
import {normalizeMeta,trashTree} from '../extension/private-trash.js';
import {BookmarkCache,BOOKMARK_CACHE_KEY,BOOKMARK_CACHE_STATE,validBookmarkCache,cachedBookmarkModel,watchBookmarkCache} from '../extension/bookmark-cache.js';

globalThis.indexedDB=new IDBFactory();let sequence=0;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){for(let i=0;i<100;i++){if(await fn())return;await wait(5);}throw new Error(label);}
function fixture(options={}){
  const name='native-cache-'+(++sequence),store=new LocalStore(name),api=new DemoAdapter();let reads=0;
  const getTree=api.getTree.bind(api);api.getTree=async()=>{reads++;return getTree();};
  for(const event of ['onCreated','onRemoved','onChanged','onMoved','onChildrenReordered','onImportBegan','onImportEnded']){
    const listeners=new Set();api[event]={addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn),emit:(...args)=>{for(const fn of listeners)fn(...args);}};
  }
  return {name,store,api,cache:new BookmarkCache(api,store,{locks:null,...options}),get reads(){return reads;}};
}

test('reopening reuses the tree, folder counts and duplicate index; unchanged verification retains identity',async()=>{
  const f=fixture(),first=await f.cache.read();assert.equal(f.reads,1);assert.equal(first.fromCache,false);
  const other=new BookmarkCache(f.api,new LocalStore(f.name),{locks:null}),second=await other.read();assert.equal(second.fromCache,true);assert.equal(f.reads,1);
  assert.ok(validBookmarkCache(second.snapshot));assert.equal(second.snapshot.token,first.snapshot.token);
  const raw=await DemoAdapter.prototype.getTree.call(f.api),model=flatten(raw);
  assert.deepEqual(second.snapshot.duplicates,findDuplicates(model.bookmarks).map(group=>group.map(node=>node.id)));
  assert.equal(second.snapshot.counts.get('0'),19);assert.equal(second.snapshot.counts.get('1'),10);assert.equal(second.snapshot.counts.get('2'),9);
  const third=await other.read({fresh:true});assert.equal(f.reads,2);assert.equal(third.snapshot.token,first.snapshot.token);
  assert.equal((await f.cache.read()).fromCache,true);assert.equal(f.reads,2);
});

test('simultaneous readers share one build locally and across contexts with the browser lock',async()=>{
  let tail=Promise.resolve();const locks={request(name,fn){const task=tail.then(fn);tail=task.catch(()=>{});return task;}};
  const f=fixture({locks}),other=new BookmarkCache(f.api,new LocalStore(f.name),{locks});
  const results=await Promise.all(Array.from({length:20},(_,i)=>(i%2?other:f.cache).read()));
  assert.equal(f.reads,1);assert.equal(new Set(results.map(row=>row.snapshot.token)).size,1);
});

test('warm reads do not wait behind another page revalidating under the shared lock',async()=>{
  let tail=Promise.resolve();const locks={request(name,fn){const task=tail.then(fn);tail=task.catch(()=>{});return task;}};
  const f=fixture({locks});await f.cache.read();const reader=new BookmarkCache(f.api,new LocalStore(f.name),{locks});
  let release,entered;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve),getTree=f.api.getTree;
  f.api.getTree=async()=>{entered();await gate;return getTree();};
  const verification=f.cache.read({fresh:true});await started;
  try{
    const cached=await Promise.race([reader.read(),wait(100).then(()=>null)]);
    assert.ok(cached,'the ready snapshot is independent of the verification lock');assert.equal(cached.fromCache,true);
  }finally{release();await verification;}
});

test('unchanged verification updates the small freshness record without rewriting the whole snapshot',async()=>{
  let now=1000;const f=fixture({now:()=>now,maxAge:100});await f.cache.read();const original=f.store.update.bind(f.store);let snapshots=0;
  f.store.update=(key,transform)=>original(key,(current,related)=>transform(current,{...related,put(key,value){if(key===BOOKMARK_CACHE_KEY)snapshots++;related.put(key,value);}}));
  now=1050;await f.cache.read({fresh:true});assert.equal(snapshots,0);
  now=1120;const cached=await f.cache.read();assert.equal(cached.fromCache,true,'freshness uses the small record, not the old snapshot date');assert.equal(f.reads,2);
});

test('background edits warm the cache with the manager closed and bulk import coalesces work',async()=>{
  const f=fixture(),errors=[],stop=watchBookmarkCache(f.cache,{delay:10,onError:error=>errors.push(error)});
  try{
    const first=await f.cache.read();
    const folder=await f.api.create({parentId:'1',title:'新目录'});f.api.onCreated.emit(folder.id,folder);
    const bookmark=await f.api.create({parentId:folder.id,title:'新增书签',url:'https://new.test/'});f.api.onCreated.emit(bookmark.id,bookmark);
    await until(async()=>(await f.store.get(BOOKMARK_CACHE_KEY))?.model.nodes.has(bookmark.id),'cache prewarm');
    assert.equal(f.reads,2);assert.equal((await f.cache.read()).snapshot.counts.get(folder.id),1);
    await f.api.update(folder.id,{title:'更名目录'});f.api.onChanged.emit(folder.id);
    await until(async()=>(await f.store.get(BOOKMARK_CACHE_KEY))?.model.nodes.get(folder.id)?.title==='更名目录','rename');
    await f.api.move(bookmark.id,{parentId:'2'});f.api.onMoved.emit(bookmark.id);
    await until(async()=>(await f.store.get(BOOKMARK_CACHE_KEY))?.model.nodes.get(bookmark.id)?.parentId==='2','move');
    const moved=await f.cache.read();assert.equal(moved.snapshot.counts.get(folder.id),0);assert.equal(moved.snapshot.counts.get('2'),10);
    await f.api.remove(folder.id);f.api.onRemoved.emit(folder.id);
    await until(async()=>!(await f.store.get(BOOKMARK_CACHE_KEY))?.model.nodes.has(folder.id),'delete folder');
    const beforeImport=f.reads;f.api.onImportBegan.emit();
    for(let i=0;i<60;i++){const node=await f.api.create({parentId:'2',title:'导入 '+i,url:'https://import.test/'+i});f.api.onCreated.emit(node.id,node);}
    await wait(30);assert.equal(f.reads,beforeImport,'do not rescan for each imported bookmark');
    f.api.onImportEnded.emit();await until(async()=>(await f.store.get(BOOKMARK_CACHE_KEY))?.model.bookmarks.length===80,'import finished');
    assert.equal(f.reads,beforeImport+1);
    const final=await new BookmarkCache(f.api,new LocalStore(f.name)).read();assert.equal(final.fromCache,true);assert.notEqual(final.snapshot.token,first.snapshot.token);
    assert.deepEqual(errors,[]);
  }finally{stop();}
});

test('an older in-flight browser read cannot overwrite an edit committed by another context',async()=>{
  const f=fixture(),other=new BookmarkCache(f.api,new LocalStore(f.name),{locks:null});await f.cache.read();
  const original=f.api.getTree;let release,entered;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);let block=true;
  f.api.getTree=async()=>{const tree=await original();if(block){block=false;entered();await gate;}return tree;};
  const oldRead=f.cache.read({fresh:true});await started;
  const node=await f.api.create({parentId:'2',title:'读取期间新增',url:'https://race.test/'});await other.invalidate();const latest=await other.read();
  release();const result=await oldRead;
  assert.ok(result.snapshot.model.nodes.has(node.id));assert.equal(result.snapshot.token,latest.snapshot.token);
  const saved=await f.store.get(BOOKMARK_CACHE_KEY),state=await f.store.get(BOOKMARK_CACHE_STATE);assert.ok(saved.model.nodes.has(node.id));assert.equal(saved.generation,state.generation);
});

test('local events arriving during a build force another read instead of serving stale data',async()=>{
  const f=fixture(),original=f.api.getTree;let release,entered;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);let block=true;
  f.api.getTree=async()=>{const tree=await original();if(block){block=false;entered();await gate;}return tree;};
  const pending=f.cache.read();await started;
  const node=await f.api.create({parentId:'1',title:'新建',url:'https://local-race.test/'});await f.cache.invalidate();release();
  const result=await pending;assert.ok(result.snapshot.model.nodes.has(node.id));assert.equal(f.reads,2);
});

test('expired, malformed and unreadable caches fall back to the browser; eventless date changes revalidate',async()=>{
  let now=1000;const f=fixture({now:()=>now,maxAge:100});const first=await f.cache.read();
  const bookmark=f.api.tree[0].children[0].children.find(node=>node.url);bookmark.dateLastUsed=900;
  now=1050;assert.equal((await f.cache.read()).fromCache,true);
  const verified=await f.cache.read({fresh:true});assert.equal(verified.snapshot.model.nodes.get(bookmark.id).dateLastUsed,900);assert.notEqual(verified.snapshot.token,first.snapshot.token);
  now=1200;assert.equal((await f.cache.read()).fromCache,false);
  await f.store.set(BOOKMARK_CACHE_KEY,{version:1,model:{}});const healed=await f.cache.read();assert.ok(validBookmarkCache(healed.snapshot));assert.equal(healed.fromCache,false);
  const failStore={async getMany(){throw new Error('read unavailable');},async update(){throw new Error('write unavailable');}};
  const fallback=new BookmarkCache(f.api,failStore);await fallback.invalidate();assert.equal((await fallback.read()).snapshot.model.bookmarks.length,19);
});

test('private trash comes from current metadata, while writes and backups still read the authoritative browser tree',async()=>{
  const f=fixture(),engine=new BookmarkEngine(f.api,f.store),snapshot=(await f.cache.read()).snapshot;
  const removed=f.api.tree[0].children[0].children.find(node=>node.url),meta=normalizeMeta({privateTrash:[{id:'trash:one',sourceId:'gone',tree:{id:'gone',title:'已删除收藏',url:'https://trash.test/'},position:{path:'原目录'}}]});
  assert.equal(treeSignature(cachedBookmarkModel(snapshot,meta)),treeSignature(flatten(trashTree(await f.api.getTree(),meta),meta.trashId)));
  assert.equal(cachedBookmarkModel(snapshot,normalizeMeta({})).bookmarks.length,19,'emptying private trash never needs a native cache rebuild');
  const originalCount=snapshot.model.bookmarks.length;
  await f.api.remove(removed.id);
  assert.equal((await engine.model()).bookmarks.filter(node=>!node.inTrash).length,originalCount-1);
  assert.equal(flatten(await engine.backupTree()).bookmarks.length,originalCount-1);
  assert.equal((await f.cache.read()).snapshot.model.bookmarks.length,originalCount,'fixture deliberately missed events');
  await assert.rejects(engine.move([removed.id],'2'),/不存在|变化|失效/);
  assert.equal(f.api.map.has(removed.id),false);
});
