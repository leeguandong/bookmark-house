import {t as uiText} from './i18n.js';
// Private snapshots never become Chrome bookmark nodes. A durable copy is
// committed before removing a native node; restore creates new native IDs.
export const PRIVATE_TRASH_ID='bookmark-house:private-trash';
const copy=value=>structuredClone(value);
export function normalizeMeta(meta){
  meta.history||=[];meta.originals||={};meta.privateTrash||=[];meta.idMap||={};
  if(meta.trashId&&meta.trashId!==PRIVATE_TRASH_ID)meta.legacyTrashId||=meta.trashId;
  meta.trashId=PRIVATE_TRASH_ID;return meta;
}
export function resolveId(meta,id){const seen=new Set();while(meta.idMap[id]&&!seen.has(id)){seen.add(id);id=meta.idMap[id];}return id;}
export function snapshotNode(node){
  const result={id:node.id,title:node.title||'',parentId:node.parentId,index:node.index,dateAdded:node.dateAdded};
  if(node.url!==undefined)result.url=node.url;
  else result.children=(node.children||[]).map(snapshotNode);
  return result;
}
export function walk(node,fn){fn(node);for(const child of node.children||[])walk(child,fn);}
export function shape(node,ids=true){return JSON.stringify([...(ids?[node.id]:[]),node.title,node.url,node.children?.map(n=>JSON.parse(shape(n,ids)))]);}
export function privateTrashRoot(meta,nativeIds,rootId='0'){
  const root={id:PRIVATE_TRASH_ID,parentId:rootId,title:'小屋回收站（仅本地）',children:[]};
  for(const entry of meta.privateTrash){
    if(nativeIds.has(resolveId(meta,entry.sourceId)))continue; // An interrupted deletion is still live.
    function virtual(n,parentId,index,isRoot=false){return {...n,id:isRoot?entry.id:`${entry.id}:${n.id}`,parentId,index,originalPath:entry.position?.path,children:n.children?.map((child,i)=>virtual(child,isRoot?entry.id:`${entry.id}:${n.id}`,i))};}
    root.children.push(virtual(entry.tree,root.id,root.children.length,true));
  }
  return root;
}
export function trashTree(tree,meta){
  const nativeIds=new Set();for(const item of tree)walk(item,n=>nativeIds.add(n.id));
  return [...copy(tree),privateTrashRoot(meta,nativeIds,tree[0]?.id||'0')];
}
export function privateNotes(meta){const notes={};for(const entry of meta.privateTrash)walk(entry.tree,n=>{if(entry.notes?.[n.id])notes[n.id===entry.tree.id?entry.id:`${entry.id}:${n.id}`]=copy(entry.notes[n.id]);});return notes;}
export function archivePlan(engine,model,node,{exclude=[]}={}){
  const tree=snapshotNode(node),excluded=new Set(exclude);if(tree.children)tree.children=tree.children.filter(n=>!excluded.has(n.id));
  return {kind:'archive',id:node.id,before:{parentId:node.parentId,index:node.index},after:{parentId:PRIVATE_TRASH_ID},position:engine.originalPosition(model,node),expected:shape(tree),trashKey:`trash:${globalThis.crypto.randomUUID()}`};
}
async function nativeNode(engine,id){const tree=await engine.api.getTree();let found;for(const root of tree)walk(root,n=>{if(n.id===id)found=n;});return found;}
function protectedTree(node){let invalid=false;walk(node,n=>{if(n.unmodifiable||n.folderType)invalid=true;});return invalid;}
async function deleteSnapshot(engine,tree){
  // Remove known leaves, then empty folders. Chrome refuses the folder removal
  // if another page added unknown children after our snapshot was saved.
  const nodes=[];walk(tree,n=>nodes.push(n));
  for(const saved of nodes.reverse()){
    let node;try{[node]=await engine.api.get(saved.id);}catch{if(await nativeNode(engine,saved.id))throw new Error(uiText("无法核对待删除的项目。"));continue;}
    if(node.parentId!==saved.parentId||node.title!==saved.title||node.url!==saved.url||node.unmodifiable||node.folderType)throw new Error(uiText("项目有外部变化，已保留恢复副本。"));
    await engine.api.remove(node.id);
  }
}
async function makeEntry(engine,meta,node,position,id){
  const notes=await engine.store.get('contentNotes')||{},saved={};walk(node,n=>{if(notes[n.id])saved[n.id]=copy(notes[n.id]);});
  return {id,sourceId:node.id,tree:snapshotNode(node),position:copy(position),notes:saved,date:Date.now()};
}
export async function executeArchive(engine,meta,plan){
  const id=resolveId(meta,plan.id),node=await nativeNode(engine,id);
  let entry=meta.privateTrash.find(e=>e.id===plan.trashKey);
  if(!node){if(entry)return;throw new Error(uiText("待回收的项目已不存在。"));}
  if(node.parentId!==resolveId(meta,plan.before.parentId)||protectedTree(node)||shape(node)!==plan.expected)throw new Error(uiText("项目在整理期间发生变化，已保留原内容。"));
  if(!entry){entry=await makeEntry(engine,meta,node,plan.position,plan.trashKey);meta.privateTrash.push(entry);}
  await engine.store.set('meta',meta); // Must complete before native deletion.
  const current=await nativeNode(engine,id);
  if(!current||current.parentId!==node.parentId||shape(current)!==shape(node))throw new Error(uiText("项目刚刚发生变化，请刷新后重试。"));
  await deleteSnapshot(engine,entry.tree);
}
export function restoreDestination(engine,model,meta,entry){
  const original=entry.position||{},parent=model.nodes.get(resolveId(meta,original.parentId)),fallback=engine.primaryRoot(model);
  if(!fallback)throw new Error(uiText("没有可还原到的文件夹。"));
  return parent&&parent.url===undefined&&parent.depth>0&&!parent.managed&&!parent.inTrash?{parentId:parent.id,index:original.index}:{parentId:fallback.id};
}
export async function executeRestore(engine,meta,plan){
  const entry=plan.entry;plan.restoredIds||={};
  const model=await engine.model(),destination=plan.after||restoreDestination(engine,model,meta,entry);
  const parentId=resolveId(meta,destination.parentId),parent=model.nodes.get(parentId);
  if(!parent||parent.url!==undefined||parent.managed||parent.inTrash||parent.depth===0)throw new Error(uiText("还原位置已变化，请重新选择。"));
  async function create(node,target,index){
    let id=plan.restoredIds[node.id],current=id?await nativeNode(engine,id):null;
    if(id&&!current)throw new Error(uiText("还原期间新增的项目被其他页面删除。"));
    if(current&&(current.parentId!==target||current.title!==node.title||current.url!==node.url))throw new Error(uiText("还原期间新增的项目被其他页面修改。"));
    if(!id){
      const details={parentId:target,title:node.title};if(node.url!==undefined)details.url=node.url;
      const siblings=await engine.api.getChildren(target);
      if(Number.isInteger(index))details.index=Math.min(Math.max(0,index),siblings.length);
      plan.createIntent={parentId:target,beforeIds:siblings.map(n=>n.id)};await engine.store.set('meta',meta);
      const created=await engine.api.create(details);id=created.id;plan.restoredIds[node.id]=id;meta.idMap[node.id]=id;
      plan.createIntent=null;
      await engine.store.set('meta',meta);
    }
    for(let i=0;i<(node.children||[]).length;i++)await create(node.children[i],id,i);
    return id;
  }
  let index=destination.index;
  if(entry.position&&parentId===resolveId(meta,entry.position.parentId)){
    const children=await engine.api.getChildren(parentId),next=children.findIndex(n=>n.id===resolveId(meta,entry.position.nextId)),previous=children.findIndex(n=>n.id===resolveId(meta,entry.position.previousId));
    if(next>=0)index=next;else if(previous>=0)index=previous+1;
  }
  const restoredId=await create(entry.tree,parentId,index);
  const notes=await engine.store.get('contentNotes')||{};for(const [old,note] of Object.entries(entry.notes||{}))if(plan.restoredIds[old])notes[plan.restoredIds[old]]=copy(note);
  await engine.store.set('contentNotes',notes);
  plan.restoredId=restoredId;meta.privateTrash=meta.privateTrash.filter(e=>e.id!==entry.id);
  await engine.store.set('meta',meta);
}
export async function undoArchive(engine,meta,plan){
  const entry=meta.privateTrash.find(e=>e.id===plan.trashKey),native=await nativeNode(engine,resolveId(meta,plan.id));
  if(native){
    if(entry){
      // A failed empty-folder removal can leave a partially removed subtree.
      // Recreate only missing nodes; keep external edits/additions/moves intact.
      async function recover(saved,parentId,index){
        const actualId=resolveId(meta,saved.id);let node=await nativeNode(engine,actualId);
        if(!node){const details={parentId,title:saved.title,index:Math.min(index,(await engine.api.getChildren(parentId)).length)};if(saved.url!==undefined)details.url=saved.url;
          node=await engine.api.create(details);meta.idMap[saved.id]=node.id;await engine.store.set('meta',meta);
        }
        if(saved.children&&node.url===undefined)for(let i=0;i<saved.children.length;i++)await recover(saved.children[i],node.id,i);
      }
      await recover(entry.tree,native.parentId,native.index);
      const notes=await engine.store.get('contentNotes')||{};for(const [old,note]of Object.entries(entry.notes||{}))notes[resolveId(meta,old)]=copy(note);await engine.store.set('contentNotes',notes);
      meta.privateTrash=meta.privateTrash.filter(e=>e.id!==entry.id);await engine.store.set('meta',meta);
    }
    return;
  }
  if(!entry){if(plan.recovery?.restoredId&&await nativeNode(engine,plan.recovery.restoredId))return;throw new Error(uiText("回收站副本已不存在。"));}
  plan.recovery||={kind:'restore',entry:copy(entry),after:restoreDestination(engine,await engine.model(),meta,entry)};
  await engine.store.set('meta',meta);await executeRestore(engine,meta,plan.recovery);
}
export async function undoRestore(engine,meta,plan){
  const entry=plan.entry,id=plan.restoredId||plan.restoredIds?.[entry.tree.id];
  if(!id){
    if(plan.createIntent){const children=await engine.api.getChildren(plan.createIntent.parentId);if(children.some(n=>!plan.createIntent.beforeIds.includes(n.id)))throw new Error(uiText("新增项目尚未完成核对，已保留全部副本和恢复记录。"));}
    return;
  }
  const node=await nativeNode(engine,id),existing=meta.privateTrash.find(e=>e.id===entry.id);
  if(!node){if(existing)return;throw new Error(uiText("已还原的项目被其他页面删除。"));}
  // During an interrupted restore, remove only recorded creations; unexpected
  // additions keep the partial tree and recovery record intact.
  const expectedIds=new Set(Object.values(plan.restoredIds||{}));let unexpected=false;walk(node,n=>{if(!expectedIds.has(n.id))unexpected=true;});
  const liveIds=new Set();if(plan.undoStarted)for(const root of await engine.api.getTree())walk(root,n=>liveIds.add(n.id));
  if(unexpected||node.parentId!==resolveId(meta,plan.after.parentId))throw new Error(uiText("已还原的项目有外部变化。"));
  const originalById=new Map();walk(entry.tree,n=>originalById.set(plan.restoredIds[n.id],n));
  walk(node,n=>{const old=originalById.get(n.id);if(!old||old.title!==n.title||old.url!==n.url||(n.id!==id&&n.parentId!==plan.restoredIds[old.parentId]))unexpected=true;
    if(old?.children&&JSON.stringify(old.children.map(child=>plan.restoredIds[child.id]).filter(childId=>childId&&(!plan.undoStarted||liveIds.has(childId))))!==JSON.stringify((n.children||[]).map(child=>child.id)))unexpected=true;
  });
  if(unexpected)throw new Error(uiText("已还原的项目有外部变化。"));
  const liveNotes=await engine.store.get('contentNotes')||{},snapshot=copy(entry);snapshot.notes||={};
  for(const [old,currentId] of Object.entries(plan.restoredIds||{})){if(liveNotes[currentId])snapshot.notes[old]=copy(liveNotes[currentId]);else if(plan.restoredId)delete snapshot.notes[old];}
  // Keep the complete original snapshot even if restore stopped halfway.
  if(!existing)meta.privateTrash.push({...snapshot,sourceId:id});else {existing.sourceId=id;existing.notes=snapshot.notes;}
  plan.undoStarted=true;await engine.store.set('meta',meta);
  await deleteSnapshot(engine,snapshotNode(node));
}
export async function migratePrivateTrash(engine){
  const meta=await engine.meta();
  if(meta.privateTrashVersion===1)return {migrated:0};
  const tree=await engine.api.getTree();let legacy=meta.legacyTrashId?await nativeNode(engine,meta.legacyTrashId):null;
  if(legacy&&(legacy.parentId!==meta.homeId||legacy.url!==undefined||protectedTree(legacy)))throw new Error(uiText("旧回收站位置或权限有变化，已保留全部内容，请先检查。"));
  if(!await engine.store.get('privateTrashMigrationBackup'))await engine.store.set('privateTrashMigrationBackup',{tree,date:Date.now(),meta:copy(meta),notes:await engine.store.get('contentNotes')||{}});
  let migrated=0;
  for(const initial of legacy?.children||[]){
    const node=await nativeNode(engine,initial.id);if(!node)continue;
    if(node.parentId!==legacy.id||shape(node)!==shape(initial))throw new Error(uiText("旧回收站内容正在变化，请稍后重新打开。"));
    let entry=meta.privateTrash.find(e=>e.sourceId===node.id);
    if(!entry){entry=await makeEntry(engine,meta,node,meta.originals[node.id]||{parentId:'',path:'原位置已不可用'},`trash:${globalThis.crypto.randomUUID()}`);meta.privateTrash.push(entry);}
    await engine.store.set('meta',meta);
    const fresh=await nativeNode(engine,node.id);if(!fresh||fresh.parentId!==legacy.id||shape(fresh)!==shape(node))throw new Error(uiText("旧回收站内容正在变化，请稍后重新打开。"));
    await deleteSnapshot(engine,entry.tree);
    migrated++;engine.onProgress({label:'迁移本地回收站',completed:migrated,total:legacy.children.length});
  }
  // Only delete the exact app-owned, empty containers, never similarly named folders.
  legacy=meta.legacyTrashId?await nativeNode(engine,meta.legacyTrashId):null;
  if(legacy){if(legacy.parentId!==meta.homeId||legacy.children?.length||protectedTree(legacy))throw new Error(uiText("旧回收站还有新内容，已保留目录，请重新打开重试。"));await engine.api.remove(legacy.id);}
  const home=meta.homeId?await nativeNode(engine,meta.homeId):null;
  if(home&&home.title==='书签小屋'&&home.url===undefined&&!home.children?.length&&!protectedTree(home)){
    await engine.api.remove(home.id);delete meta.homeId;
  }
  const convert=entry=>{entry.plans=entry.plans.flatMap(p=>{
    if(p.kind==='move'&&p.after?.parentId===meta.legacyTrashId){const saved=meta.privateTrash.find(e=>e.sourceId===p.id);return saved?[{...p,kind:'archive',trashKey:saved.id,position:saved.position}]:[];}
    if(p.kind==='move'&&p.before?.parentId===meta.legacyTrashId)return [];
    return [p];
  });return entry;};
  meta.history=meta.history.map(convert).filter(e=>e.plans.length);if(meta.pending){convert(meta.pending);if(!meta.pending.plans.length)meta.pending=null;}
  if(migrated||meta.legacyTrashId)meta.privateTrashMigratedAt=Date.now();
  meta.privateTrashVersion=1;meta.purgePending=null;await engine.store.set('meta',meta);
  return {migrated};
}
export function privatePreview(meta){
  let bookmarkCount=0,folderCount=0;for(const entry of meta.privateTrash)walk(entry.tree,n=>{if(n.url===undefined)folderCount++;else bookmarkCount++;});
  return {trashId:PRIVATE_TRASH_ID,signature:JSON.stringify(meta.privateTrash),itemCount:meta.privateTrash.length,bookmarkCount,folderCount};
}
export async function emptyPrivateTrash(engine,expected){
  const meta=await engine.meta();if(meta.pending)throw new Error(uiText("请先撤销未完成的操作，再清空回收站。"));
  const snapshot=privatePreview(meta);if(!expected||snapshot.signature!==expected.signature||expected.trashId!==PRIVATE_TRASH_ID)throw new Error(uiText("回收站内容已变化，请重新查看数量并确认。"));
  if(!snapshot.itemCount)return {deletedItems:0,deletedBookmarks:0,deletedFolders:0,failed:0,remaining:0};
  const nativeTree=await engine.api.getTree(),tree=trashTree(nativeTree,meta),date=Date.now();
  await engine.store.set('trashBackup',{tree,date,meta:copy(meta),notes:{...await engine.store.get('contentNotes'),...privateNotes(meta)}});
  await engine.store.set('backup',{tree,date});
  const removed=new Set();for(const entry of meta.privateTrash){removed.add(entry.id);removed.add(entry.sourceId);walk(entry.tree,n=>{removed.add(n.id);removed.add(resolveId(meta,n.id));removed.add(`${entry.id}:${n.id}`);});}
  const live=new Set();for(const root of nativeTree)walk(root,n=>live.add(n.id));
  const notes=await engine.store.get('contentNotes')||{};for(const id of removed)if(!live.has(id))delete notes[id];await engine.store.set('contentNotes',notes);
  meta.history=meta.history.map(e=>({...e,plans:e.plans.filter(p=>!removed.has(p.trashKey)&&!removed.has(p.before?.parentId)&&!removed.has(p.after?.parentId))})).filter(e=>e.plans.length);
  meta.privateTrash=[];meta.lastPurgeDate=date;await engine.store.set('meta',meta);
  return {deletedItems:snapshot.itemCount,deletedBookmarks:snapshot.bookmarkCount,deletedFolders:snapshot.folderCount,failed:0,remaining:0};
}
