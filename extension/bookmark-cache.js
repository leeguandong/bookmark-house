import {t as uiText} from './i18n.js';
import {flatten,findDuplicates} from './core.js';
import {privateTrashRoot} from './private-trash.js';

export const BOOKMARK_CACHE_KEY='bookmarkLibrarySnapshotV1';
export const BOOKMARK_CACHE_STATE='bookmarkLibraryGenerationV1';
const MAX_AGE=5*60*1000;
const generation=value=>typeof value?.generation==='string'?value.generation:'';

// Only the native read model is cached. Recovery, writes and exports continue
// to use BookmarkEngine's fresh browser reads, and private trash stays separate.
export function buildBookmarkCache(tree,signature,revision='',now=Date.now()){
  const model=flatten(tree),counts=new Map(model.folders.map(folder=>[folder.id,0]));
  // Point children at the same indexed objects so IndexedDB stores one copy of
  // each bookmark, instead of both a raw tree and another flattened tree.
  for(const folder of model.folders)folder.children=(folder.children||[]).map(child=>model.nodes.get(child.id));
  for(const bookmark of model.bookmarks){
    let parent=model.nodes.get(bookmark.parentId);
    while(parent){counts.set(parent.id,(counts.get(parent.id)||0)+1);parent=model.nodes.get(parent.parentId);}
  }
  return {version:1,generation:revision,token:crypto.randomUUID(),checkedAt:now,signature,rootId:tree[0]?.id||'0',model,counts,
    duplicates:findDuplicates(model.bookmarks).map(group=>group.map(node=>node.id))};
}

export function validBookmarkCache(value){
  if(value?.version!==1||typeof value.generation!=='string'||typeof value.token!=='string'||!value.token||!Number.isFinite(value.checkedAt)||typeof value.signature!=='string'||value.signature.length!==64||typeof value.rootId!=='string')return false;
  const model=value.model;
  if(!(model?.nodes instanceof Map)||!Array.isArray(model.bookmarks)||!Array.isArray(model.folders)||!(value.counts instanceof Map)||!Array.isArray(value.duplicates))return false;
  if(model.nodes.size!==model.bookmarks.length+model.folders.length)return false;
  for(const node of [...model.bookmarks,...model.folders]){
    if(typeof node?.id!=='string'||typeof node.title!=='string'||model.nodes.get(node.id)!==node||!Number.isInteger(node.depth)||node.depth<0)return false;
    if(node.depth>0&&model.nodes.get(node.parentId)?.depth!==node.depth-1)return false;
    if(typeof node.path!=='string'||typeof node.managed!=='boolean'||node.inTrash!==false)return false;
    if(node.url!==undefined&&typeof node.url!=='string')return false;
    if(node.children!==undefined&&(!Array.isArray(node.children)||node.children.some((child,index)=>model.nodes.get(child?.id)!==child||child.parentId!==node.id||child.depth!==node.depth+1||child.index!==index)))return false;
  }
  if(model.bookmarks.some(node=>node.url===undefined)||model.folders.some(node=>node.url!==undefined))return false;
  if(model.folders.some(node=>!Number.isInteger(value.counts.get(node.id))||value.counts.get(node.id)<0))return false;
  return value.duplicates.every(group=>Array.isArray(group)&&group.length>1&&group.every(id=>model.nodes.get(id)?.url!==undefined));
}

export function cachedBookmarkModel(snapshot,meta){
  const native=snapshot.model,trash=flatten([privateTrashRoot(meta,native.nodes,snapshot.rootId)],meta.trashId);
  return {nodes:new Map([...native.nodes,...trash.nodes]),bookmarks:[...native.bookmarks,...trash.bookmarks],folders:[...native.folders,...trash.folders]};
}

export class BookmarkCache {
  constructor(api,store,{now=Date.now,locks=globalThis.navigator?.locks,maxAge=MAX_AGE}={}){
    this.api=api;this.store=store;this.now=now;this.locks=locks;this.maxAge=maxAge;
    this.epoch=0;this.pending=Promise.resolve();this.job=null;this.mustRead=false;
  }
  invalidate(){
    const epoch=++this.epoch;this.mustRead=true;
    // Invalidate the small generation record, not a copy of the whole library.
    this.pending=this.pending.then(async()=>{
      await this.store.update(BOOKMARK_CACHE_STATE,()=>({generation:crypto.randomUUID()}));
      if(epoch===this.epoch)this.mustRead=false;
    }).catch(()=>{});
    return this.pending;
  }
  read({fresh=false}={}){
    if(this.job){
      if(fresh&&!this.jobFresh)return this.job.then(()=>this.read({fresh:true}));
      return this.job;
    }
    this.jobFresh=fresh;
    this.job=Promise.resolve().then(async()=>{
      // A valid snapshot must not wait behind another page's slow verification.
      if(!fresh){const saved=await this.readStored();if(saved.usable)return {snapshot:saved.cached,fromCache:true};}
      const run=()=>this.readCurrent(fresh);
      return this.locks?this.locks.request('bookmark-house-cache-build',run):run();
    }).finally(()=>{this.job=null;});
    return this.job;
  }
  async readStored(){
    await this.pending;const epoch=this.epoch;
    let records;try{records=await this.store.getMany([BOOKMARK_CACHE_STATE,BOOKMARK_CACHE_KEY]);}catch{records=new Map();}
    const state=records.get(BOOKMARK_CACHE_STATE),revision=generation(state),stored=records.get(BOOKMARK_CACHE_KEY);
    const cached=validBookmarkCache(stored)?stored:null,age=this.now()-(state?.checkedAt??cached?.checkedAt??0);
    return {epoch,revision,cached,usable:!this.mustRead&&epoch===this.epoch&&cached?.generation===revision&&age>=0&&age<this.maxAge};
  }
  async readCurrent(fresh){
    for(let attempt=0;attempt<5;attempt++){
      const {epoch,revision,cached,usable}=await this.readStored();
      if(!fresh&&usable)return {snapshot:cached,fromCache:true};
      const tree=await this.api.getTree();
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(tree)));
      const signature=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
      if(epoch!==this.epoch)continue;
      // Revalidation does not rebuild the directory index or duplicate groups
      // when the browser returns the same data (including last-used dates).
      const snapshot=cached?.signature===signature
        ?{...cached,generation:revision,checkedAt:this.now()}:buildBookmarkCache(tree,signature,revision,this.now());
      let committed=false,storageFailed=false;
      try{
        await this.store.update(BOOKMARK_CACHE_STATE,(current,related)=>{
          if(generation(current)===revision&&epoch===this.epoch){
            if(cached?.token!==snapshot.token||cached.generation!==revision)related.put(BOOKMARK_CACHE_KEY,snapshot);
            committed=true;return {generation:revision,checkedAt:snapshot.checkedAt};
          }
          return current||{generation:revision};
        });
      }catch{storageFailed=true;}
      if(epoch!==this.epoch||(!committed&&!storageFailed))continue;
      this.mustRead=storageFailed;
      return {snapshot,fromCache:false};
    }
    throw new Error(uiText("书签正在变化，请稍后再试。"));
  }
}

// Called synchronously when the service worker starts so Chrome can wake it
// for bookmark edits even when the manager is closed.
export function watchBookmarkCache(cache,{prewarm=true,onChange=()=>{},onError=()=>{},delay=180}={}){
  let timer,importing=false;const listeners=[];
  const listen=(name,fn)=>{const event=cache.api[name];if(event?.addListener){event.addListener(fn);listeners.push([event,fn]);}};
  const changed=()=>{
    cache.invalidate();onChange();clearTimeout(timer);
    if(prewarm)timer=setTimeout(()=>cache.read().catch(onError),delay);
  };
  for(const name of ['onRemoved','onChanged','onMoved','onChildrenReordered'])listen(name,changed);
  listen('onCreated',()=>{if(!importing)changed();});
  listen('onImportBegan',()=>{importing=true;clearTimeout(timer);cache.invalidate();});
  listen('onImportEnded',()=>{importing=false;changed();});
  return ()=>{clearTimeout(timer);for(const [event,fn] of listeners)event.removeListener?.(fn);};
}
