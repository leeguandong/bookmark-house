import {externalLinkDropEffect} from './drag-transfer.js';
export const BOOKMARK_DRAG_TYPE='application/x-bookmark-house';

export function collectDraggedIds(model,id,selected=new Set()){
  const node=model.nodes.get(id);
  if(!node||node.url===undefined||node.managed||node.inTrash)throw new Error('这条书签暂不能拖动。');
  if(!selected.has(id))return [id];
  return model.bookmarks.filter(b=>selected.has(b.id)&&!b.managed&&!b.inTrash).map(b=>b.id);
}
export function dropFolder(model,id){
  const folder=model.nodes.get(id);
  if(!folder||folder.url!==undefined||folder.depth===0||folder.managed||folder.inTrash)throw new Error('请选择可写入的文件夹。');
  return folder;
}
export function moveDropIds(model,ids,folderId){
  dropFolder(model,folderId);
  return [...new Set(ids)].filter(id=>{
    const n=model.nodes.get(id);
    if(!n||n.url===undefined||n.managed||n.inTrash)throw new Error('拖动的书签已变化，请刷新后重试。');
    return n.parentId!==folderId;
  });
}
export function parseDroppedLinks({uriList='',plainText='',title=''}={}){
  const raw=(uriList||plainText).trim();
  if(!raw||raw.length>50000)throw new Error('请拖入有效的网页链接。');
  const lines=raw.split(/\r?\n/).map(s=>s.trim()).filter(s=>s&&!s.startsWith('#'));
  if(!lines.length||lines.length>50)throw new Error('每次最多拖入 50 个网页链接。');
  const seen=new Set(),links=[];
  for(const line of lines){let url;try{url=new URL(line);}catch{throw new Error('请拖入完整的 http 或 https 网页链接。');}
    if(!['http:','https:'].includes(url.protocol))throw new Error('这里只接收 http 或 https 网页链接。');
    if(seen.has(url.href))continue;seen.add(url.href);
    links.push({url:url.href,title:lines.length===1&&title.trim()?title.trim().slice(0,500):url.href});
  }
  return links;
}

export function installBookmarkDrag({doc=document,folderTree,getModel,getSelected,blockedReason,onMove,onCreate,onExpand,onError,onFinish=()=>{}}){
  let source=null,hover=null,expandTimer=null,scrollFrame=null,scrollSpeed=0,suppressClickUntil=0;
  const status=doc.querySelector('#dragStatus');
  const types=transfer=>Array.from(transfer?.types||[]);
  const hasPayload=transfer=>Boolean(source)||types(transfer).some(t=>[BOOKMARK_DRAG_TYPE,'text/uri-list','text/plain'].includes(t));
  const message=text=>{if(status){if(status.textContent!==text)status.textContent=text;status.hidden=false;}doc.body.classList.add('is-bookmark-dragging');};
  function clearHover(){clearTimeout(expandTimer);expandTimer=null;hover?.classList.remove('drop-ready','drop-blocked');hover=null;scrollSpeed=0;if(scrollFrame)cancelAnimationFrame(scrollFrame);scrollFrame=null;}
  function finish(){const wasActive=Boolean(source)||!status?.hidden;clearHover();source=null;doc.querySelectorAll('.drag-source').forEach(el=>el.classList.remove('drag-source'));doc.body.classList.remove('is-bookmark-dragging');if(status)status.hidden=true;if(wasActive){suppressClickUntil=Date.now()+300;onFinish();}}
  function scroll(){if(!scrollSpeed){scrollFrame=null;return;}folderTree.scrollTop+=scrollSpeed;scrollFrame=requestAnimationFrame(scroll);}
  function setScroll(event){const rect=folderTree.getBoundingClientRect();scrollSpeed=event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom?(event.clientY<rect.top+36?-9:event.clientY>rect.bottom-36?9:0):0;if(scrollSpeed&&!scrollFrame)scrollFrame=requestAnimationFrame(scroll);}
  function dragStart(event){
    const cell=event.target.closest('[data-drag-bookmark]');if(!cell)return;
    try{
      const blocked=blockedReason();if(blocked)throw new Error(blocked);
      const model=getModel(),ids=collectDraggedIds(model,cell.dataset.dragBookmark,getSelected());
      source={ids,token:crypto.randomUUID()};event.dataTransfer.effectAllowed='copyMove';event.dataTransfer.setData(BOOKMARK_DRAG_TYPE,source.token);
      event.dataTransfer.setData('text/uri-list',ids.map(id=>model.nodes.get(id).url).join('\r\n'));
      event.dataTransfer.setData('text/plain',ids.map(id=>model.nodes.get(id).url).join('\n'));
      cell.closest('[data-bookmark-card],tr')?.classList.add('drag-source');message(`拖到左侧文件夹，移动 ${ids.length} 条书签`);
    }catch(error){event.preventDefault();finish();onError(error.message);}
  }
  function dragOver(event){
    if(types(event.dataTransfer).includes('Files')){event.preventDefault();event.dataTransfer.dropEffect='none';return;}
    if(!hasPayload(event.dataTransfer))return;
    if(!source&&event.target.closest('input,textarea,[contenteditable="true"]'))return;
    event.preventDefault();const target=event.target.closest('[data-drop-folder]');
    if(!target||!folderTree.contains(target)){clearHover();event.dataTransfer.dropEffect='none';message(source?`拖到左侧文件夹，移动 ${source.ids.length} 条书签`:'将网页链接拖到左侧文件夹即可收藏');return;}
    const id=target.dataset.dropFolder;
    try{
      const blocked=blockedReason();if(blocked)throw new Error(blocked);
      const folder=dropFolder(getModel(),id);
      if(hover!==target){clearHover();hover=target;hover.classList.add('drop-ready');expandTimer=setTimeout(()=>{onExpand(id);expandTimer=null;},650);}
      if(source&&!moveDropIds(getModel(),source.ids,id).length)throw new Error('这些书签已在此目录；停留可展开子文件夹。');
      hover.classList.remove('drop-blocked');hover.classList.add('drop-ready');
      const effect=source?'move':externalLinkDropEffect(event.dataTransfer);if(effect==='none')throw new Error('此来源不允许复制或保存链接，请改拖网页中的链接。');
      event.dataTransfer.dropEffect=effect;message(source?`松开即可将 ${source.ids.length} 条书签移入「${folder.title}」`:`松开即可将网页链接收藏到「${folder.title}」`);setScroll(event);
    }catch(error){if(hover!==target){clearHover();hover=target;}hover.classList.remove('drop-ready');hover.classList.add('drop-blocked');event.dataTransfer.dropEffect='none';message(error.message);}
  }
  async function drop(event){
    const transfer=event.dataTransfer,target=event.target.closest('[data-drop-folder]');
    if(types(transfer).includes('Files')){event.preventDefault();finish();if(target)onError('请拖入网页链接，文件暂不支持。');return;}
    if(!hasPayload(transfer))return;
    if(!source&&event.target.closest('input,textarea,[contenteditable="true"]'))return;
    event.preventDefault();const ownSource=source,token=transfer.getData(BOOKMARK_DRAG_TYPE),uriList=transfer.getData('text/uri-list'),plainText=transfer.getData('text/plain');
    finish();if(!target||!folderTree.contains(target))return;
    try{
      const blocked=blockedReason();if(blocked)throw new Error(blocked);
      const model=getModel(),folder=dropFolder(model,target.dataset.dropFolder);
      if(ownSource){
        if(token!==ownSource.token)throw new Error('拖拽数据已失效，请重新拖动。');
        const ids=moveDropIds(model,ownSource.ids,folder.id);if(!ids.length){onError('这些书签已经在该文件夹中。');return;}
        await onMove(ids,folder);
      }else await onCreate(parseDroppedLinks({uriList,plainText}),folder);
    }catch(error){onError(error.message);}
  }
  function leave(event){if(!event.relatedTarget&&!(event.clientX>0&&event.clientY>0&&event.clientX<innerWidth&&event.clientY<innerHeight)){clearHover();if(!source){if(status)status.hidden=true;doc.body.classList.remove('is-bookmark-dragging');}}}
  function click(event){if(Date.now()<suppressClickUntil){event.preventDefault();event.stopImmediatePropagation();}}
  doc.addEventListener('dragstart',dragStart);doc.addEventListener('dragover',dragOver);doc.addEventListener('drop',drop);doc.addEventListener('dragend',finish);doc.addEventListener('dragleave',leave);doc.addEventListener('click',click,true);
  return {isActive:()=>Boolean(source)||Boolean(status&&!status.hidden),cancel:finish};
}
