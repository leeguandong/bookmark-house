import {englishText} from './i18n.js';
import {t as uiText,msg as uiMessage,html as uiHtml,locale as uiLocale,date as uiDate,number as uiNumber} from './i18n.js';
import {normalizedUrl,findDuplicates,escapeHtml} from './display-utils.js';
export {normalizedUrl,findDuplicates,escapeHtml} from './display-utils.js';
import {normalizeMeta,trashTree,privateNotes,archivePlan,executeArchive,executeRestore,undoArchive,undoRestore,migratePrivateTrash,privatePreview,emptyPrivateTrash,restoreDestination,resolveId} from './private-trash.js';
export const CATEGORIES = ['AI 与模型','开发与技术','工作与文档','设计与创作','学习与阅读','生活与购物','影音与社区'];

export function flatten(tree, trashId) {
  const nodes = new Map(), bookmarks = [], folders = [];
  function visit(node, path = [], managed = false, inTrash = false, depth = 0) {
    managed ||= Boolean(node.unmodifiable);
    inTrash ||= node.id === trashId;
    const item = {...node, path: path.join(' / '), depth, managed, inTrash};
    nodes.set(item.id, item);
    if (node.url !== undefined) bookmarks.push(item);
    else {
      folders.push(item);
      (node.children || []).forEach((child, index) => visit({...child, parentId:node.id, index}, node.title ? [...path,node.title] : path, managed, inTrash, depth + 1));
    }
  }
  tree.forEach(node => visit(node));
  return {nodes, bookmarks, folders};
}

// Ignore read timestamps; a changed title, URL, location or order invalidates a preview.
export function treeSignature(model) {
  return JSON.stringify([...model.nodes.values()].map(n=>[n.id,n.parentId,n.index,n.title,n.url,Boolean(n.managed),n.folderType]));
}

export function folderContents(model, id) {
  const root = model.nodes.get(id);
  if (!root || root.url !== undefined) return {bookmarkCount:0,folderCount:0,ids:[]};
  const stack=[root], ids=[]; let bookmarkCount=0,folderCount=0;
  while(stack.length){
    const node=stack.pop();ids.push(node.id);
    if(node.url !== undefined)bookmarkCount++;
    else {if(node.id!==id)folderCount++;const children=node.children||[];for(let i=children.length-1;i>=0;i--)stack.push(model.nodes.get(children[i].id)||children[i]);}
  }
  return {bookmarkCount,folderCount,ids};
}

export function suggestCategory(bookmark) {
  const text = `${bookmark.title} ${bookmark.url}`.toLowerCase();
  const rules = [
    ['AI 与模型', /huggingface|modelscope|openai|chatgpt|anthropic|claude|arxiv|机器学习|深度学习|大模型|模型库|人工智能|pytorch|tensorflow|\bllm\b/],
    ['开发与技术', /github|gitlab|stackoverflow|developer\.|devdocs|掘金|csdn|编程|开发|javascript|typescript|python|docker|kubernetes/],
    ['工作与文档', /notion|feishu|lark|yuque|yinxiang|evernote|docs\.google|xfchat|iflytek|腾讯文档|石墨|飞书|工作|文档|验收|标注|管理后台|监察|^https?:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/],
    ['设计与创作', /figma|dribbble|behance|canva|pinterest|unsplash|设计|配色|素材|摄影|创作/],
    ['学习与阅读', /wikipedia|coursera|edx\.org|douban|readthedocs|教程|课程|读书|阅读|论文|学习|文献|笔记/],
    ['生活与购物', /taobao|jd\.com|tmall|amazon|meituan|dianping|trip\.com|ctrip|购物|旅行|旅游|美食|生活/],
    ['影音与社区', /youtube|bilibili|zhihu|xiaohongshu|weibo|reddit|twitter|x\.com|spotify|netflix|视频|电影|音乐|社区/]
  ];
  // Private hosts are work resources even when the title has no keywords.
  try { if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(new URL(bookmark.url).hostname)) return '工作与文档'; } catch {}
  return rules.find(([,pattern]) => pattern.test(text))?.[0] || null;
}

export function isLoose(bookmark, model) {
  const parent = model.nodes.get(bookmark.parentId);
  return parent && (parent.depth === 1 || /^(未分类|待整理|收藏夹)$/.test(parent.title));
}

export function safeOpenUrl(raw) {
  try { const u = new URL(raw); return ['http:','https:','ftp:','file:'].includes(u.protocol) ? u.href : null; } catch { return null; }
}



export function exportHtml(tree) {
  function render(node) {
    if (node.url !== undefined) return `<DT><A HREF="${escapeHtml(node.url)}" ADD_DATE="${Math.floor((node.dateAdded || Date.now()) / 1000)}">${escapeHtml(node.title || node.url)}</A>\n`;
    const inner = (node.children || []).map(render).join('');
    return node.parentId === undefined ? inner : `<DT><H3>${escapeHtml(node.title)}</H3>\n<DL><p>\n${inner}</DL><p>\n`;
  }
  return uiHtml`<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>书签小屋备份</TITLE>
<H1>书签备份</H1>
<DL><p>
` + tree.map(render).join('') + '</DL><p>\n';
}

export class BookmarkEngine {
  constructor(api, store, onProgress=()=>{}) { this.api = api; this.store = store; this.onProgress=onProgress; }
  async meta() { return normalizeMeta(await this.store.get('meta') || {}); }
  async model(meta) { meta??=await this.meta();return flatten(trashTree(await this.api.getTree(),meta),meta.trashId); }
  async backupTree() { const meta=await this.meta();return trashTree(await this.api.getTree(),meta).filter(node=>node.id!==meta.trashId||node.children.length); }
  async migratePrivateTrash() { return migratePrivateTrash(this); }
  async trashNotes(meta) { return privateNotes(meta||await this.meta()); }
  async saveTrashNote(id,note) {
    const meta=await this.meta();
    for(const entry of meta.privateTrash){
      if(id===entry.id||id.startsWith(entry.id+':')){const source=id===entry.id?entry.tree.id:id.slice(entry.id.length+1);entry.notes||={};entry.notes[source]=note;await this.store.set('meta',meta);return;}
    }
    throw new Error(uiText("回收站项目已经变化。"));
  }
  async getTrashPreview() { return privatePreview(await this.meta()); }
  async recoverTrashPurge() {
    const meta=await this.meta(),job=meta.purgePending;if(!job)return null;
    const current=flatten(await this.api.getTree(),meta.trashId),missing=new Set(job.nodes.filter(n=>!current.nodes.has(n.id)).map(n=>n.id));
    // Remove only recovery steps made impossible by permanent deletion.
    meta.history=(meta.history||[]).map(entry=>({...entry,plans:entry.plans.filter(p=>!missing.has(p.id)&&!missing.has(p.before?.parentId)&&!missing.has(p.after?.parentId))})).filter(entry=>entry.plans.length);
    for(const id of missing)delete meta.originals?.[id];
    const notes=await this.store.get('contentNotes')||{};for(const id of missing)delete notes[id];
    await this.store.set('contentNotes',notes);
    meta.purgePending=null;await this.store.set('meta',meta);
    return {deletedItems:job.entries.filter(entry=>missing.has(entry.id)).length,deletedBookmarks:job.nodes.filter(n=>missing.has(n.id)&&!n.isFolder).length,deletedFolders:job.nodes.filter(n=>missing.has(n.id)&&n.isFolder).length};
  }
  async emptyTrash(expected) { return emptyPrivateTrash(this,expected); }
  primaryRoot(model) {
    return model.folders.find(f => f.depth === 1 && f.folderType === 'other' && !f.managed && !f.inTrash)
      || model.folders.find(f => f.depth === 1 && !f.managed && !f.inTrash);
  }
  bookmarksBar(model) {
    return model.folders.find(f=>f.depth===1&&f.folderType==='bookmarks-bar'&&!f.managed&&!f.inTrash)
      || model.folders.find(f=>f.depth===1&&!f.managed&&!f.inTrash&&/^(书签栏|Bookmarks bar)$/i.test(f.title));
  }
  async ensureHome(meta, model) {
    const home = model.nodes.get(meta.homeId);
    if (!home || home.url !== undefined || home.managed || home.inTrash || home.depth === 0) {
      const root = this.bookmarksBar(model)||this.primaryRoot(model);
      if (!root) throw new Error(uiText("没有可写入的书签文件夹。"));
      const node = await this.api.create({parentId:root.id,title:uiText('书签小屋')});
      meta.homeId = node.id;
      await this.store.set('meta', meta);
    }
    return meta.homeId;
  }
  validateFolder(model,id,meta,{inTrash=false}={}) {
    const folder=model.nodes.get(id);
    if(!folder||folder.url!==undefined)throw new Error(uiText("文件夹已变化，请刷新后再试。"));
    if(folder.depth<=1||folder.folderType)throw new Error(uiText("Chrome 自带的文件夹不能删除。"));
    const contents=folderContents(model,id),nodes=contents.ids.map(childId=>model.nodes.get(childId));
    if(nodes.some(n=>n.managed||n.unmodifiable))throw new Error(uiText("该文件夹包含受管理的内容，无法删除或还原。"));
    if(contents.ids.includes(meta.homeId)||contents.ids.includes(meta.trashId))throw new Error(uiText("书签小屋及其回收站所在的文件夹需要保留。"));
    if(folder.inTrash!==inTrash)throw new Error(inTrash?uiText("该文件夹不在回收站中。"):uiText("该文件夹已在回收站中。"));
    return folder;
  }
  validateBookmark(model, id) {
    const b = model.nodes.get(id);
    if (!b || b.url === undefined) throw new Error(uiText("书签已变化，请刷新后再试。"));
    if (b.managed) throw new Error(uiText("受管理的书签无法修改。"));
    if (b.inTrash) throw new Error(uiText("请先还原回收站中的书签，再进行修改。"));
    return b;
  }
  movePlan(b, destination) { return {kind:'move',id:b.id,before:{parentId:b.parentId,index:b.index},after:destination}; }
  originalPosition(model,node) {
    const siblings=model.nodes.get(node.parentId)?.children||[],index=siblings.findIndex(n=>n.id===node.id);
    return {parentId:node.parentId,index:node.index,path:node.path,previousId:siblings[index-1]?.id,nextId:siblings[index+1]?.id};
  }
  async run(label, planner) {
    const meta = await this.meta();
    meta.history ||= []; meta.originals ||= {};
    if (meta.pending) throw new Error(uiText("上次操作未完成，请先点击“撤销上次操作”。"));
    if(meta.purgePending)throw new Error(uiText("上次清空尚未完成，请重新打开小屋以核对清空结果。"));
    const tree = trashTree(await this.api.getTree(),meta), model = flatten(tree, meta.trashId);
    await this.store.set('backup', {tree, date:Date.now()});
    const plans = await planner(model, meta);
    if (!plans.length) return 0;
    const entry = {label, date:Date.now(), plans};
    meta.pending = entry;
    await this.store.set('meta',meta);
    try {
      let completed=0;this.onProgress({label,completed,total:plans.length});
      for (const p of plans) {
        if(p.kind==='archive'||p.kind==='restore'){
          if(p.kind==='archive')await executeArchive(this,meta,p);else await executeRestore(this,meta,p);
          this.onProgress({label,completed:++completed,total:plans.length});continue;
        }
        if(p.kind==='create'){
          const node=await this.api.create(p.after);p.id=node.id;
          if(p.ref)for(const dependent of plans)if(dependent.targetRef===p.ref)dependent.after.parentId=node.id;
          await this.store.set('meta',meta);
          this.onProgress({label,completed:++completed,total:plans.length});
          continue;
        }
        const [current] = await this.api.get(p.id);
        if (!current || (p.kind === 'move' ? current.parentId !== p.before.parentId : current.title !== p.before.title || current.url !== p.before.url)) throw new Error(uiText("书签在整理期间被其他页面修改。"));
        if (p.kind === 'move') {
          const destination={...p.after};
          if(p.targetRef&&!destination.parentId)throw new Error(uiText("分类文件夹尚未建立。"));
          if(Number.isInteger(destination.index)||p.restoreAnchors){
            const children=await this.api.getChildren(destination.parentId),next=children.findIndex(n=>n.id===p.restoreAnchors?.nextId),previous=children.findIndex(n=>n.id===p.restoreAnchors?.previousId);
            destination.index=next>=0?next:previous>=0?previous+1:Math.min(Math.max(0,destination.index??children.length),children.length);
          }
          await this.api.move(p.id,destination);
        }
        else await this.api.update(p.id,p.after);
        this.onProgress({label,completed:++completed,total:plans.length});
      }
      meta.pending = null;
      meta.history.push(entry);
      meta.history = meta.history.slice(-30);
      await this.store.set('meta',meta);
      return plans.length;
    } catch (error) {
      throw new Error(uiMessage`${error.message} 已保留恢复记录，请点击“撤销上次操作”恢复。`);
    }
  }
  async move(ids, parentId) {
    return this.run('移动书签', async model => {
      const parent = model.nodes.get(parentId);
      if (!parent || parent.url !== undefined || parent.depth === 0 || parent.managed || parent.inTrash) throw new Error(uiText("请选择可写入的目标文件夹。"));
      return [...new Set(ids)].map(id => this.validateBookmark(model,id)).filter(b => b.parentId !== parentId).map(b => this.movePlan(b,{parentId}));
    });
  }
  async addBookmarks(links,parentId){
    return this.run('拖入网页链接',async model=>{
      const parent=model.nodes.get(parentId);
      if(!parent||parent.url!==undefined||parent.depth===0||parent.managed||parent.inTrash)throw new Error(uiText("请选择可写入的目标文件夹。"));
      if(!Array.isArray(links)||!links.length||links.length>50)throw new Error(uiText("每次可拖入 1–50 个网页链接。"));
      const seen=new Set((parent.children||[]).filter(n=>n.url!==undefined).map(n=>normalizedUrl(n.url))),plans=[];
      for(const link of links){let url;try{url=new URL(link.url);}catch{throw new Error(uiText("网页链接无效。"));}if(!['http:','https:'].includes(url.protocol))throw new Error(uiText("这里只接收 http 或 https 网页链接。"));
        if(seen.has(url.href))continue;seen.add(url.href);
        plans.push({kind:'create',ref:`new-bookmark:${plans.length}`,id:null,before:{},after:{parentId,title:String(link.title||url.href).trim().slice(0,500)||url.href,url:url.href}});
      }
      return plans;
    });
  }
  async categorize(ids) {
    return this.run('应用分类建议', async (model,meta) => {
      const items = [...new Set(ids)].map(id => this.validateBookmark(model,id)).filter(b => !b.inTrash && suggestCategory(b));
      if (!items.length) return [];
      const homeId = await this.ensureHome(meta,model);
      const children = await this.api.getChildren(homeId), targets = new Map();
      for (const category of new Set(items.map(suggestCategory))) {
        const folder = children.find(f => f.url === undefined && [category,englishText(category)].includes(f.title) && !f.unmodifiable) || await this.api.create({parentId:homeId,title:uiText(category)});
        targets.set(category,folder.id);
      }
      return items.filter(b => b.parentId !== targets.get(suggestCategory(b))).map(b => this.movePlan(b,{parentId:targets.get(suggestCategory(b))}));
    });
  }
  async archive(ids) {
    return this.run('移入回收站',async(model)=>[...new Set(ids)].map(id=>this.validateBookmark(model,id)).map(node=>archivePlan(this,model,node)));
  }
  async archiveFolder(id) {
    return this.run('删除文件夹',async(model,meta)=>[archivePlan(this,model,this.validateFolder(model,id,meta))]);
  }
  async applyOrganization(plan,keys) {
    return this.run('自动整理',async(model,meta)=>{
      if(treeSignature(model)!==plan.signature||meta.homeId!==plan.homeId||meta.trashId!==plan.trashId)throw new Error(uiText("书签库已变化，请重新生成整理方案后再执行。"));
      const selected=new Set(keys),steps=plan.steps.filter(s=>selected.has(s.key));
      if(!steps.length)throw new Error(uiText("请至少选择一项整理操作。"));
      const target=model.nodes.get(plan.settings.targetId);
      if(!target||target.managed||target.inTrash||target.url!==undefined||target.depth===0)throw new Error(uiText("分类位置不可写入。"));
      const archives=steps.flatMap(s=>s.archiveIds),plans=[],created=new Set();
      // Validate the complete selection before any folder is created or moved.
      for(const step of steps){
        const n=model.nodes.get(step.id);
        if(n?.url===undefined)this.validateFolder(model,step.id,meta);else this.validateBookmark(model,step.id);
        for(const move of step.moves){const child=model.nodes.get(move.id);if(!child||child.managed)throw new Error(uiText("目录内容已变化。"));}
        if(step.targetId){const dest=model.nodes.get(step.targetId);if(!dest||dest.managed||dest.inTrash||archives.includes(dest.id))throw new Error(uiText("目标文件夹不可用。"));}
      }
      for(const step of steps){
        if(step.type==='classify'){
          if(step.targetRef&&!created.has(step.targetRef)){plans.push({kind:'create',ref:step.targetRef,id:null,before:{},after:{parentId:target.id,title:step.newTitle}});created.add(step.targetRef);}
          const move=this.movePlan(model.nodes.get(step.id),{parentId:step.targetId||''});if(step.targetRef)move.targetRef=step.targetRef;plans.push(move);
        }else{
          for(const move of step.moves)plans.push(this.movePlan(model.nodes.get(move.id),{parentId:move.parentId}));
          for(const id of step.archiveIds){const node=model.nodes.get(id);plans.push(archivePlan(this,model,node,{exclude:step.moves.map(move=>move.id)}));}
        }
      }
      return plans;
    });
  }
  async restore(ids) {
    return this.run('还原回收站项目',async(model,meta)=>{
      return [...new Set(ids)].map(id=>{
        const entry=meta.privateTrash.find(item=>item.id===id);
        if(!entry)throw new Error(uiText("请还原整个所属文件夹，以保留原有层级。"));
        if(!model.nodes.get(id)?.inTrash)throw new Error(uiText("该项目仍在 Chrome 中，请先撤销未完成的操作。"));
        return {kind:'restore',id,before:{parentId:meta.trashId},after:restoreDestination(this,model,meta,entry),entry:structuredClone(entry)};
      }).sort((a,b)=>a.after.parentId.localeCompare(b.after.parentId)||(a.after.index??Infinity)-(b.after.index??Infinity));
    });
  }
  async edit(id, title, url) {
    return this.run('编辑书签', async model => {
      const b = this.validateBookmark(model,id);
      if (url !== b.url && !safeOpenUrl(url)) throw new Error(uiText("新网址需要使用 http、https、ftp 或 file 协议。"));
      if (title === b.title && url === b.url) return [];
      return [{kind:'update',id,before:{title:b.title,url:b.url},after:{title,url}}];
    });
  }
  async createFolder(parentId, title) {
    if ((await this.meta()).pending) throw new Error(uiText("请先撤销未完成的操作。"));
    if((await this.meta()).purgePending)throw new Error(uiText("请重新打开小屋以核对上次清空结果。"));
    const tree = await this.api.getTree(), model = flatten(tree,(await this.meta()).trashId), parent = model.nodes.get(parentId);
    if (!title.trim()) throw new Error(uiText("请输入文件夹名称。"));
    if (!parent || parent.url !== undefined || parent.depth === 0 || parent.managed || parent.inTrash) throw new Error(uiText("请选择可写入的文件夹。"));
    await this.store.set('backup',{tree,date:Date.now()});
    return this.api.create({parentId,title:title.trim()});
  }
  async undo() {
    const meta=await this.meta(),entry=meta.pending||meta.history.at(-1);
    if(meta.purgePending)throw new Error(uiText("请重新打开小屋以核对上次清空结果。"));
    if(!entry)return {restored:0,failed:0};
    await this.store.set('backup',{tree:await this.backupTree(),date:Date.now()});
    const rank=p=>p.kind==='archive'?0:p.kind==='create'?2:1;
    const plans=[...entry.plans].sort((a,b)=>rank(a)-rank(b)||(a.before?.parentId||'').localeCompare(b.before?.parentId||'')||(a.before?.index??0)-(b.before?.index??0));
    const failures=[];let restored=0;
    for(const p of plans){
      try{
        if(p.kind==='archive'){await undoArchive(this,meta,p);restored++;continue;}
        if(p.kind==='restore'){await undoRestore(this,meta,p);restored++;continue;}
        const id=resolveId(meta,p.id);
        if(p.kind==='create'){
          if(!p.id)continue;
          let current;try{[current]=await this.api.get(id);}catch{continue;}
          if(current.title!==p.after.title||current.url!==p.after.url||current.parentId!==resolveId(meta,p.after.parentId)||(current.url===undefined&&(await this.api.getChildren(id)).length))throw new Error(uiText("新增内容已有外部变化"));
          await this.api.remove(id);restored++;continue;
        }
        const [current]=await this.api.get(id);if(!current)throw new Error(uiText("书签不存在"));
        if(p.kind==='move'){
          const before=resolveId(meta,p.before.parentId),after=resolveId(meta,p.after.parentId);
          if(current.parentId===before)continue;
          if(current.parentId!==after)throw new Error(uiText("书签已由其他页面移动"));
          const parent=(await this.model()).nodes.get(before);
          if(!parent||parent.url!==undefined||parent.managed||parent.inTrash||parent.depth===0)throw new Error(uiText("原文件夹已变化"));
          const children=await this.api.getChildren(parent.id);await this.api.move(id,{parentId:parent.id,index:Math.min(p.before.index,children.length)});
        }else{
          if(current.title===p.before.title&&current.url===p.before.url)continue;
          if(current.title!==p.after.title||current.url!==p.after.url)throw new Error(uiText("书签已被修改"));
          await this.api.update(id,p.before);
        }
        restored++;
      }catch{failures.push(p);}
    }
    if(failures.length){entry.plans=failures;if(meta.pending)meta.pending=entry;else meta.history[meta.history.length-1]=entry;}
    else if(meta.pending)meta.pending=null;else meta.history.pop();
    await this.store.set('meta',meta);return {restored,failed:failures.length};
  }
}
