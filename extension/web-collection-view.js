import {t as uiText,msg as uiMessage,html as uiHtml,locale as uiLocale} from './i18n.js';
import {removeFailedCover} from './collection-card.js';
import {renderWebCollection} from './web-collection-render.js';
export {renderWebCollection} from './web-collection-render.js';
import {escapeHtml as e,normalizedUrl} from './core.js';
import {collectionItems,collectionBackup,groupByDay,localDay,parseWebDrop,webUrl} from './web-collection.js';
import {cleanPreview,requestPreviewAccess} from './page-preview.js';
import {AutoPreview} from './auto-preview.js';
import {externalLinkDropEffect} from './drag-transfer.js';
import {cardTitle,xhsNoteId,isXhsSiteDescription,isPlaceholderTitle} from './page-identity.js';
import {webDuplicateGroups} from './library-tools.js';
import {takeHomePreview,buildHomeCache,releaseHomeControls} from './home-cache.js';
export class WebCollectionView {
  constructor(options){Object.assign(this,options);this.selected=new Set();this.mode='library';this.insightIds=null;this.filter='all';this.month='';this.sort='newest';this.limit=24;this.data={version:1,revision:0,items:[]};this.loadingPreviews=new Set();this.coverCache=new Map();this.autoPreview=new AutoPreview(this.repository,async()=>{if(this.onDataChange)await this.onDataChange();else{await this.refresh();this.render();}});
    this.container.addEventListener('error',event=>removeFailedCover(event.target),true);
  }
  async refresh(){this.data=await this.repository.read({light:true});this.onCount(this.data.items.filter(n=>n.deletedAt==null).length);}
  renderKey(){return JSON.stringify([uiLocale(),this.data.cacheToken||'',this.data.revision,localDay(Date.now()),this.filter,this.month,this.sort,this.getSearch(),this.limit,[...this.selected],this.mode,this.insightIds?[...this.insightIds]:null]);}
  adoptCachedHome(){
    releaseHomeControls(this.container);
    const snapshot=takeHomePreview(this.container);
    if(this.container.dataset.renderLocale&&this.container.dataset.renderLocale!==uiLocale())return;
    if(!snapshot||snapshot.token!==this.data.cacheToken||snapshot.revision!==this.data.revision||snapshot.items.length!==Math.min(24,this.data.items.filter(item=>item.deletedAt==null).length))return;
    const current=buildHomeCache(this.data);
    if(!current||JSON.stringify([snapshot.items,snapshot.summary])!==JSON.stringify([current.items,current.summary]))return;
    this.lastRenderKey=this.renderKey();
  }
  render(){
    const eligible=new Set(this.matchingItems().map(item=>item.id));this.selected=new Set([...this.selected].filter(id=>eligible.has(id)));
    const key=this.renderKey();
    if(this.lastRenderKey!==key){this.container.dataset.renderLocale=uiLocale();this.container.innerHTML=renderWebCollection(this.data,{filter:this.filter,month:this.month,sort:this.sort,query:this.getSearch(),limit:this.limit,bookmarks:this.getModel().bookmarks,selected:this.selected,mode:this.mode,insightIds:this.insightIds});this.lastRenderKey=key;}
    this.syncBookmarkBadges();
    for(const button of this.container.querySelectorAll('[data-action="webEnrich"]'))button.disabled=this.loadingPreviews.has(button.dataset.id);
    this.onRender?.(this.filter,this.data);this.loadVisibleCovers().catch(()=>{});this.scheduleVisiblePreviews();
  }
  scheduleVisiblePreviews(){
    clearTimeout(this.previewTimer);
    if(!globalThis.chrome?.permissions||this.container.hidden)return;
    const ids=new Set([...this.container.querySelectorAll('[data-web-card]')].map(card=>card.dataset.webCard));
    const items=this.data.items.filter(item=>ids.has(item.id));
    // Opening the library should not start a network queue for every saved URL.
    // Let the visible cards become usable before checking their missing content.
    this.previewTimer=setTimeout(()=>{
      if(this.container.hidden||this.container.ownerDocument.visibilityState==='hidden')return;
      this.autoPreview.enqueue(items).catch(()=>{});
    },800);
  }
  syncBookmarkBadges(){
    const saved=new Set(this.getModel().bookmarks.filter(item=>!item.inTrash).map(item=>normalizedUrl(item.url)));
    for(const card of this.container.querySelectorAll('[data-web-card]')){
      const found=saved.has(normalizedUrl(card.querySelector('.web-card-title').href)),badge=card.querySelector('.web-bookmarked');
      if(found&&!badge){const node=this.container.ownerDocument.createElement('span');node.className='web-bookmarked';node.textContent=uiText("已在书签");card.querySelector('.web-card-meta').append(node);}else if(!found&&badge)badge.remove();
    }
  }
  async loadVisibleCovers(container=this.container){
    const images=[...container.querySelectorAll('img[data-cover-ref]:not([src])')].filter(image=>{
      const cover=this.coverCache.get(image.dataset.coverRef);
      if(cover){image.src=cover;return false;}return true;
    });
    if(!images.length)return;
    if(this.coverJob){await this.coverJob;return this.loadVisibleCovers(container);}
    this.coverJob=this.repository.covers(images.map(image=>image.dataset.coverRef));
    let covers;try{covers=await this.coverJob;}finally{this.coverJob=null;}
    for(const image of images){
      const ref=image.dataset.coverRef,cover=cleanPreview({cover:covers.get(ref)}).cover;
      if(cover){this.coverCache.delete(ref);this.coverCache.set(ref,cover);}
      if(!image.isConnected)continue;
      if(cover)image.src=cover;else removeFailedCover(image);
    }
    while(this.coverCache.size>96)this.coverCache.delete(this.coverCache.keys().next().value);
  }
  matchingItems(){
    let items=collectionItems(this.data,{filter:this.filter,month:this.month,sort:this.sort,query:this.getSearch()});
    if(this.mode==='duplicates'){const ids=new Set(webDuplicateGroups(this.data).flat().map(item=>item.id));items=items.filter(item=>ids.has(item.id));}
    if(this.insightIds)items=items.filter(item=>this.insightIds.has(item.id));
    return items;
  }
  async change(event){
    if(event.target.dataset.webSelect){event.target.checked?this.selected.add(event.target.dataset.webSelect):this.selected.delete(event.target.dataset.webSelect);this.render();return;}
    if(event.target.id==='webMonth'||event.target.id==='webToolMonth'){this.month=event.target.value;this.limit=24;this.render();return;}
    if(event.target.id==='webSort'){this.sort=event.target.value;this.limit=24;this.render();return;}
    if(event.target.id==='webImportFile'){
      const file=event.target.files?.[0];if(!file)return;
      if(file.size>100*1024*1024)throw new Error(uiText("备份文件超过 100 MB，请分批导入。"));
      let raw;try{raw=JSON.parse(await file.text());}catch{throw new Error(uiText("无法读取这个 JSON 备份，请检查文件。"));}
      await this.perform(()=>this.repository.importBackup(raw),r=>uiMessage`已导入 ${r.added} 个网页，跳过 ${r.skipped} 个已有网址。`,false);
    }
  }
  async saveLinks(links){
    // Start permission request during the actual save/paste/drop gesture, not after storage awaits.
    let access=Promise.resolve(false);
    if(globalThis.chrome?.permissions?.request)try{access=Promise.resolve(requestPreviewAccess(links.map(link=>webUrl(link.url)))).catch(()=>false);}catch{}
    const result=await this.perform(()=>this.repository.add(links),r=>r.added?uiMessage`已保存 ${r.added} 个网页。`:r.restored?uiMessage`已恢复 ${r.restored} 个网页。`:uiText("这些网页已经收藏，保留了原日期和备注。"),false);
    if(globalThis.chrome?.permissions){await access;await this.autoPreview.enqueue(this.data.items.filter(item=>links.some(link=>webUrl(link.url)===item.url)),{force:true});await this.refresh();this.render();
      const missing=this.data.items.filter(item=>result.ids.includes(item.id)&&isPlaceholderTitle(item.title,item.url));
      if(missing.length)this.toast(uiText("链接已保存。可保留原网页打开，再点「生成网页摘要」读取标题和正文。"));
    }
    return result;
  }
  async action(name,id){
    if(name==='webSelectVisible'){this.matchingItems().slice(0,this.limit).forEach(item=>this.selected.add(item.id));this.render();return;}
    if(name==='webClearSelection'){this.selected.clear();this.render();return;}
    if(['webBulkDelete','webBulkRestore','webBulkRead','webBulkStar'].includes(name)){
      const ids=this.matchingItems().filter(item=>this.selected.has(item.id)).map(item=>item.id);if(!ids.length)return;
      const operations={webBulkDelete:'delete',webBulkRestore:'restore',webBulkRead:'read',webBulkStar:'star'};
      const execute=async()=>{await this.perform(()=>this.repository.updateMany(ids,operations[name]),n=>uiMessage`已处理 ${n} 个网页。`,name==='webBulkDelete'?()=>()=>this.perform(()=>this.repository.updateMany(ids,'restore'),uiText("所选网页已恢复。"),false):false);this.selected.clear();this.render();};
      if(name==='webBulkDelete')this.showDialog(uiText("将所选网页移入回收站？"),uiHtml`<p>将移除 ${ids.length} 张网页卡片，可在统一回收站中选择「网页收藏」恢复。书签库中的同网址书签继续保留。</p>`,uiText("移入回收站"),execute);else await execute();return;
    }
    if(name==='webSummarize'){
      const items=this.data.items.filter(item=>item.deletedAt==null&&!item.preview?.descriptionEdited);if(!items.length){this.toast(uiText("当前没有需要生成摘要的网页。"));return;}
      const allowed=requestPreviewAccess(items.map(item=>item.url));
      if(!await allowed){this.toast(uiText("已保留收藏；允许访问网页后，才可自动提取摘要。"));return;}
      this.toast(uiText("正在从网页内容中提取摘要…"));await this.autoPreview.enqueue(items,{force:true});
      await this.refresh();this.render();const count=this.data.items.filter(item=>item.deletedAt==null&&cleanPreview(item.preview).summary).length;this.toast(uiMessage`已有 ${count} 张卡片带有摘要。`);return;
    }
    if(name==='webEnrich'){
      const item=this.data.items.find(n=>n.id===id&&n.deletedAt==null);if(!item)throw new Error(uiText("卡片已变化，请刷新后再试。"));
      if(this.loadingPreviews.has(id))return;
      const allowed=requestPreviewAccess(item.url);
      this.loadingPreviews.add(id);const button=[...this.container.querySelectorAll('[data-action="webEnrich"]')].find(el=>el.dataset.id===id);if(button){button.disabled=true;}
      try{
        if(!await allowed){this.toast(uiText("未读取网页，原卡片继续保留。"));return;}
        this.toast(uiText("正在读取正文并生成摘要…"));
        await this.autoPreview.enqueue([item],{force:true});await this.refresh();
        const saved=this.data.items.find(row=>row.id===id);this.toast(cleanPreview(saved?.preview).summary?uiText("摘要已更新。"):uiText("网页暂时无法读取，收藏已保留。"));
      }finally{this.loadingPreviews.delete(id);this.render();}return;
    }
    if(name==='webPaste'){
      this.showDialog(uiText("粘贴网页或分享内容"),uiHtml`<p>可以粘贴完整网址，也可以粘贴从微信等应用复制的「标题＋链接」。会识别其中的网页地址。</p><label class="form-field">分享内容<textarea id="webShareText" rows="6" maxlength="100000" placeholder="一篇值得留住的文章&#10;https://mp.weixin.qq.com/s/…"></textarea></label>`,uiText("保存识别到的网页"),()=>this.saveLinks(parseWebDrop({plainText:document.querySelector('#webShareText').value})));return;
    }
    if(name==='webFilter'){if(id==='deleted'&&this.navigateTrash){this.navigateTrash();return;}this.selected.clear();this.filter=id;this.limit=24;this.render();return;}
    if(name==='webResetFilter'){if(this.mode!=='library'&&this.navigateLibrary){this.navigateLibrary();return;}this.selected.clear();this.filter='all';this.month='';this.limit=24;this.setSearch('');this.render();return;}
    if(name==='webMore'){this.limit+=24;this.render();return;}
    if(name==='webExport'){const data=await this.repository.read();this.download(JSON.stringify(collectionBackup(data),null,2),uiMessage`网页收藏备份-${localDay(Date.now())}.json`,'application/json;charset=utf-8');this.toast(uiText("网页卡片、日期和备注已导出。"));return;}
    if(name==='webImport'){this.container.querySelector('#webImportFile').click();return;}
    if(name==='webPurgeBackup'){const data=await this.repository.read();if(!data.purgeBackup)throw new Error(uiText("还没有清空前备份。"));this.download(JSON.stringify(collectionBackup(data.purgeBackup),null,2),uiText("网页收藏-清空前备份.json"),'application/json;charset=utf-8');return;}
    if(name==='webPurge'){
      await this.refresh();const count=this.data.items.filter(n=>n.deletedAt!=null).length,revision=this.data.revision;if(!count)return;
      this.showDialog(uiText("清空网页回收站？"),uiHtml`<p>将清空 ${count} 张已删除卡片。书签库里的内容会继续保留。</p><p>清空前会自动保存一份卡片备份，可从本页导出；清空后不能直接撤销。</p>`,uiText("永久清空"),()=>this.perform(()=>this.repository.purgeDeleted(revision),n=>uiMessage`已清空 ${n} 张卡片。`,false),true);return;
    }
    if(name==='webAdd'||name==='webEdit'){
      const item=name==='webEdit'?(await this.repository.read({light:true})).items.find(n=>n.id===id&&n.deletedAt==null):null;
      if(name==='webEdit'&&!item)throw new Error(uiText("网页卡片已变化，请刷新后再试。"));
      this.showDialog(item?uiText("编辑网页卡片"):uiText("保存一个好网页"),uiHtml`<label class="form-field">网页地址<input id="webUrl" type="url" required maxlength="8192" placeholder="https://…" value="${e(item?.url||'')}"></label><label class="form-field">标题<input id="webTitle" maxlength="500" placeholder="给网页起个容易找到的名字" value="${e(item?.title||'')}"></label><label class="form-field">内容摘要<textarea id="webDescription" rows="3" maxlength="1200" placeholder="一两句话，记住这页讲什么">${e(item?.preview?.summary||item?.preview?.description||'')}</textarea></label>${item?.preview?.cover||item?.preview?.coverRef?uiHtml`<label class="web-remove-cover"><input id="webRemoveCover" type="checkbox"> 移除当前封面</label>`:''}<label class="form-field">我的备注<textarea id="webNote" rows="3" maxlength="2000" placeholder="它有什么用？什么时候想再看？">${e(item?.note||'')}</textarea></label><p>保存在网页收藏中。需要时，可以另行加入 书签库。</p>`,item?uiText("保存修改"):uiText("保存网页"),async()=>{
        const details={url:document.querySelector('#webUrl').value,title:document.querySelector('#webTitle').value,note:document.querySelector('#webNote').value,description:document.querySelector('#webDescription').value,removeCover:Boolean(document.querySelector('#webRemoveCover')?.checked)};
        if(item){if(details.description===(item.preview?.summary||item.preview?.description||''))delete details.description;await this.perform(()=>this.repository.edit(id,details),uiText("网页卡片已更新。"),false);}else await this.saveLinks([{...details,titleEdited:Boolean(details.title.trim()),preview:{description:details.description,descriptionEdited:Boolean(details.description)}}]);
      });return;
    }
    const item=(await this.repository.read({light:true})).items.find(n=>n.id===id);if(!item)throw new Error(uiText("网页卡片已变化，请刷新后再试。"));
    if(name==='webStar'||name==='webRead'){await this.perform(()=>this.repository.toggle(id,name==='webStar'?'starred':'readAt'),r=>name==='webStar'?r.starred?uiText("已加入星标。"):uiText("已取消星标。"):r.readAt!=null?uiText("已标为已读。"):uiText("已标为未读。"),false);return;}
    if(name==='webDelete'){await this.perform(()=>this.repository.remove(id),uiText("网页已移入回收站，书签库继续保留。"),()=>()=>this.perform(()=>this.repository.restore(id),uiText("卡片已恢复。"),false));return;}
    if(name==='webRestore'){await this.perform(()=>this.repository.restore(id),uiText("网页卡片已恢复。"),false);return;}
    if(name==='webBookmark'){if(item.deletedAt!=null)throw new Error(uiText("请先恢复这张卡片。"));await this.addToBookmarks(item);}
  }
}

export function installWebDrop({doc=document,isVisible,isBlocked,onSave,onError}){
  let dragging=false;
  const finish=()=>{dragging=false;doc.body.classList.remove('is-web-dragging');};
  const accepts=event=>isVisible()&&Array.from(event.dataTransfer?.types||[]).some(type=>['text/uri-list','text/plain','text/html','text/x-moz-url','Files'].includes(type));
  const editable=target=>target?.closest?.('input,textarea,[contenteditable="true"],dialog,[data-drop-folder]');
  doc.addEventListener('dragover',event=>{
    if(!accepts(event)||editable(event.target))return;event.preventDefault();event.stopPropagation();
    if(isBlocked()){event.dataTransfer.dropEffect='none';return;}
    const effect=externalLinkDropEffect(event.dataTransfer);event.dataTransfer.dropEffect=effect;
    if(effect==='none'){finish();return;}
    dragging=true;doc.body.classList.add('is-web-dragging');
  },true);
  doc.addEventListener('drop',event=>{
    if(!accepts(event)||editable(event.target))return;event.preventDefault();event.stopPropagation();finish();
    if(isBlocked()){onError(uiText("请先完成当前操作，再拖入网页。"));return;}
    if(externalLinkDropEffect(event.dataTransfer)==='none'){onError(uiText("此拖动不允许复制或保存链接。请拖地址栏中的网址，或网页里的链接。"));return;}
    try{
      const payload={uriList:event.dataTransfer.getData('text/uri-list'),plainText:event.dataTransfer.getData('text/plain'),html:event.dataTransfer.getData('text/html'),mozUrl:event.dataTransfer.getData('text/x-moz-url')};
      if(Array.from(event.dataTransfer.types).includes('Files')&&!Object.values(payload).some(Boolean))throw new Error(uiText("没有收到网页地址。请在原应用中复制链接，再回到小屋粘贴；JSON 备份请使用导入按钮。"));
      const links=parseWebDrop(payload);
      Promise.resolve(onSave(links)).catch(error=>onError(error.message));
    }catch(error){onError(error.message);}
  },true);
  doc.addEventListener('paste',event=>{
    if(!isVisible()||!event.clipboardData)return;
    const target=event.target,payload={uriList:event.clipboardData.getData('text/uri-list'),plainText:event.clipboardData.getData('text/plain'),html:event.clipboardData.getData('text/html')};
    if(target?.id==='webUrl'){
      try{const links=parseWebDrop(payload);if(links.length!==1)return;event.preventDefault();target.value=links[0].url;const title=doc.querySelector('#webTitle');if(title&&!title.value)title.value=links[0].title;}catch{}
      return;
    }
    if(editable(target)||isBlocked()||!Object.values(payload).some(Boolean))return;
    try{const links=parseWebDrop(payload);event.preventDefault();event.stopPropagation();Promise.resolve(onSave(links)).catch(error=>onError(error.message));}catch(error){onError(error.message);}
  },true);
  doc.addEventListener('dragend',finish);
  doc.addEventListener('dragleave',event=>{if(!event.relatedTarget&&(event.clientX<=0||event.clientY<=0||event.clientX>=innerWidth||event.clientY>=innerHeight))finish();});
  return {cancel:finish,isActive:()=>dragging};
}
