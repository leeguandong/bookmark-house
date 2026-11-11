import {WebCollection,WEB_COLLECTION_KEY,demoWebCollection} from './web-collection.js';
import {WebCollectionView,installWebDrop} from './web-collection-view.js';
import {folderScope,scopedBooks,folderBackup} from './folder-view.js';
import {BookmarkEngine, flatten, suggestCategory, isLoose, safeOpenUrl, escapeHtml as e, exportHtml,folderContents,treeSignature} from './core.js';
import {createAdapter,DemoAdapter,demoTree} from './adapter.js';
import {BookmarkCache,watchBookmarkCache,cachedBookmarkModel} from './bookmark-cache.js';
import {bookmarkPreviewKey,bookmarkPreviewIndex,renderBookmarkCard} from './bookmark-cards.js';
import {removeFailedCover} from './collection-card.js';
import {waitForHomePreview} from './home-cache.js';
import {analyzeBookmarks,analysisFilterIds,analysisToHtml,parseTopicRules,topicRulesText} from './analytics.js';
import {renderAnalysisView} from './analytics-view.js';
import {ORGANIZE_DEFAULTS,buildOrganizationPlan,organizationSummary} from './organizer.js';
import {renderOrganizer} from './organizer-view.js';
import {installBookmarkDrag} from './bookmark-drag.js';
import {ensureSidebarLayout} from './sidebar-layout.js';
import {SHARED_VIEWS,webAnalysisModel,sourceBar,renderWebOrganizer,renderBackupCenter} from './library-tools.js';

const $ = selector => document.querySelector(selector);
const sidebarLayout=ensureSidebarLayout({document,window});
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const state = {view:'web',toolSource:'web',folderId:null,folderFilter:'all',query:'',sort:'recent',selected:new Set(),page:1,size:60,collapsed:new Set(),allSuggestions:false,busy:false,analysisScope:'all',analysisPeriod:'all',insight:null};
let engine, adapter, meta, model, active=[], duplicates=[], duplicateIds=new Set(), keepers=new Map(), filtered=[], dialogHandler, toastTimer;
let bookmarkCache,bookmarkSnapshot,folderRenderKey='';
let bookmarkPreviewToken=null,bookmarkPreviews=new Map();
let contentNotes={},customTopics=[],reportCache=null,reportCacheKey='';
let folderMenuTrigger=null;
let bookmarkDrag=null,dragRefreshPending=false,currentFolderScope=null,folderTreeInitialized=false;
let webCollection,webDrop,webChannel,toastUndoHandler=null;
let webRefreshJob=null,webRefreshAgain=false,webDirty=false,bookmarksDirty=false,syncTimer,bookmarksReady=false,resolveBookmarks;
const bookmarksLoaded=new Promise(resolve=>{resolveBookmarks=resolve;});
let webReady=false,resolveWeb;
const webLoaded=new Promise(resolve=>{resolveWeb=resolve;});
let organizationSettings=null,organizationPlan=null,organizationSelected=new Set(),organizationFilter='all',organizationPage=1,organizationStale=false,organizationContentSignature='',organizationLastResult='';
const viewInfo = {
  web:['网页收藏','值得再看的，都在这里。','网页卡片'],
  all:['所有书签','让每一次收藏，都能在需要时找到。','收藏清单'],
  recent:['最近添加','过去 30 天，新发现的好内容。','最近的收藏'],
  analysis:['内容分析','从收藏的内容线索，发现主题、来源与值得回顾的好内容。','分析概览'],
  duplicates:['重复检查','相同的网址，留下最合适的一份就够了。','重复清单'],
  organize:['整理中心','把归类、精简与目录收整，变成一份可以执行的方案。','整理方案'],
  trash:['回收站','按来源查看已删除内容，恢复或清理都更清楚。','回收站清单'],
  backup:['备份与导入','为网页收藏和 书签库，留一份可以带走的备份。','备份与导入'],
  loose:['待归类','为散落在书签栏和顶层文件夹的收藏，找个位置。','待归类清单']
};

function toast(message, undo=false) {
  clearTimeout(toastTimer); toastUndoHandler=typeof undo==='function'?undo:undo?()=>action('undo'):null; $('#toastMessage').textContent=message; $('#toastUndo').hidden=!toastUndoHandler; $('#toast').hidden=false;
  toastTimer=setTimeout(()=>$('#toast').hidden=true,9000);
}

async function refresh({web=true,fresh=true}={}) {
  bookmarksDirty=false;
  if(fresh)await bookmarkCache.invalidate();
  meta=await engine.meta();const cached=await bookmarkCache.read({fresh});bookmarkSnapshot=cached.snapshot;model=cachedBookmarkModel(bookmarkSnapshot,meta);
  if(state.view==='folder'&&(!model.nodes.has(state.folderId)||model.nodes.get(state.folderId).inTrash)){state.view='all';state.folderId=null;state.page=1;state.selected.clear();}
  if(state.analysisScope!=='all'&&(!model.nodes.has(state.analysisScope)||model.nodes.get(state.analysisScope).inTrash))state.analysisScope='all';
  [contentNotes,customTopics]=await Promise.all([adapter.store.get('contentNotes'),adapter.store.get('analysisTopics')]);contentNotes={...contentNotes,...await engine.trashNotes(meta)};customTopics||=[];reportCache=null;
  if(!organizationSettings)organizationSettings={...ORGANIZE_DEFAULTS,...await adapter.store.get('organizationSettings')};
  if(!model.nodes.has(organizationSettings.targetId)||model.nodes.get(organizationSettings.targetId).inTrash)organizationSettings.targetId=model.folders.find(f=>f.folderType==='bookmarks-bar'&&!f.managed)?.id||engine.primaryRoot(model)?.id;
  if(organizationSettings.scopeId!=='all'&&(!model.nodes.has(organizationSettings.scopeId)||model.nodes.get(organizationSettings.scopeId).inTrash))organizationSettings.scopeId='all';
  if(organizationPlan&&(organizationPlan.signature!==treeSignature(model)||organizationContentSignature!==JSON.stringify([contentNotes,customTopics])))organizationStale=true;
  active=bookmarkSnapshot.model.bookmarks;duplicates=bookmarkSnapshot.duplicates.map(group=>group.map(id=>model.nodes.get(id)));
  duplicateIds=new Set(duplicates.flat().map(b=>b.id));
  keepers=new Map();for(const group of duplicates){const keep=group.find(b=>b.managed)||group[0];for(const b of group)keepers.set(b.id,keep.id);}
  state.selected=new Set([...state.selected].filter(id=>model.nodes.has(id) && !model.nodes.get(id).managed));
  $('#navAll').textContent=active.length; $('#navTrash').textContent=trashItems().length;
  $('#undoButton').disabled=!(meta.pending || meta.history?.length);
  $('#undoButton').title=meta.pending?'恢复未完成的操作':meta.history?.length?`撤销：${meta.history.at(-1).label}`:'还没有可撤销的操作';
  $('#status').textContent=meta.purgePending?'上次清空记录尚未核对，请重新打开小屋重试。':meta.pending?'上次操作未完整完成。请点击“撤销上次操作”恢复；有外部修改的书签会保留现状。':'';
  if(!folderTreeInitialized){model.folders.filter(f=>f.depth>1&&!f.inTrash&&f.children?.some(child=>child.url===undefined)).forEach(f=>state.collapsed.add(f.id));folderTreeInitialized=true;}
  if(web&&webCollection)await webCollection.refresh();
  renderFolders(); render();
  return cached;
}

function refreshWeb(){
  webDirty=false;webRefreshAgain=true;
  if(!webRefreshJob)webRefreshJob=(async()=>{
    while(webRefreshAgain){
      webRefreshAgain=false;const previous=webCollection.data.revision;
      await webCollection.refresh();
      if(previous!==webCollection.data.revision)render();
    }
  })().finally(()=>{webRefreshJob=null;});
  return webRefreshJob;
}
function scheduleSync(){
  clearTimeout(syncTimer);syncTimer=setTimeout(async()=>{
    if(state.busy||$('#dialog').open||bookmarkDrag?.isActive()||webDrop?.isActive())return;
    try{if(bookmarksDirty&&bookmarksReady)await refresh({web:false,fresh:false});if(webDirty&&webReady)await refreshWeb();}catch(error){toast(error.message);}
  },120);
}

function renderFolders() {
  closeFolderMenu();
  const key=JSON.stringify([bookmarkSnapshot?.token,state.view,state.folderId,[...state.collapsed]]);
  if(key===folderRenderKey)return;
  const counts=bookmarkSnapshot?.counts||new Map();
  const roots=model.folders.filter(f=>f.depth===1);
  function folder(f) {
    if(f.inTrash) return '';
    const children=(f.children||[]).filter(c=>c.url===undefined&&c.id!==meta.trashId);
    return `<div class="folder-branch"><div class="folder-row" data-drop-folder="${e(f.id)}"><button class="folder-toggle ${children.length?'':'empty'} ${state.collapsed.has(f.id)?'':'expanded'}" data-toggle-folder="${e(f.id)}" aria-label="${state.collapsed.has(f.id)?'展开':'收起'} ${e(f.title)}" aria-expanded="${!state.collapsed.has(f.id)}">${icon('chevron')}</button><button class="folder-button ${state.view==='folder'&&state.folderId===f.id?'active':''}" data-folder="${e(f.id)}" aria-haspopup="menu" aria-controls="folderMenu" aria-expanded="false" title="${e(f.path?f.path+' / '+f.title:f.title)}">${icon('folder')}<span class="folder-name">${e(f.title||'未命名文件夹')}</span><small>${counts.get(f.id)||0}</small></button></div>${children.length?`<div class="folder-children" ${state.collapsed.has(f.id)?'hidden':''}>${children.map(c=>folder(model.nodes.get(c.id))).join('')}</div>`:''}</div>`;
  }
  const html=roots.map(folder).join('')||'<div class="empty-state">暂无文件夹</div>';
  if($('#folders').innerHTML!==html)$('#folders').innerHTML=html;
  folderRenderKey=key;
}

function descendantsOf(id) {
  const ids=new Set(); const visit=n=>{ids.add(n.id);(n.children||[]).forEach(visit);};
  const node=model.nodes.get(id);if(node)visit(node);return ids;
}
function trashItems(){return meta.trashId?[...model.nodes.values()].filter(node=>node.parentId===meta.trashId):[];}
function computeFiltered() {
  let items=state.view==='trash'?trashItems():[...active];
  if(state.view==='insight'){const ids=new Set(state.insight?.ids||[]);items=items.filter(b=>ids.has(b.id));}
  if(state.view==='folder')items=scopedBooks(currentFolderScope,state.folderFilter);
  if(state.view==='recent') items=items.filter(b=>b.dateAdded>=Date.now()-30*86400000);
  if(state.view==='duplicates') items=items.filter(b=>duplicateIds.has(b.id));
  if(state.view==='loose') items=items.filter(b=>!b.managed&&isLoose(b,model));
  if(state.view==='organize') items=items.filter(b=>!b.managed&&suggestCategory(b)&&(state.allSuggestions||isLoose(b,model))&&!(b.parentId===meta.homeId || (model.nodes.get(b.parentId)?.parentId===meta.homeId && model.nodes.get(b.parentId)?.title===suggestCategory(b))));
  const terms=state.query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if(terms.length) items=items.filter(b=>{const nodes=b.url===undefined?folderContents(model,b.id).ids.map(id=>model.nodes.get(id)):[b];const text=nodes.map(n=>{const shared=n.url?bookmarkPreviews.get(bookmarkPreviewKey(n.url)):null;return `${n.title} ${n.url||''} ${n.path||''} ${contentNotes[n.id]?.text||''} ${contentNotes[n.id]?.note||''} ${shared?.title||''} ${shared?.preview?.summary||shared?.preview?.description||''} ${shared?.note||''}`;}).join(' ').toLocaleLowerCase();return terms.every(term=>text.includes(term));});
  if(isDuplicateView()) items.sort((a,b)=>a.url.localeCompare(b.url)|| (a.dateAdded||0)-(b.dateAdded||0));
  else if(state.sort==='title') items.sort((a,b)=>a.title.localeCompare(b.title,'zh-CN',{numeric:true}));
  else if(state.sort==='domain') items.sort((a,b)=>domain(a.url).localeCompare(domain(b.url)) || a.title.localeCompare(b.title));
  else items.sort((a,b)=>(b.dateAdded||0)-(a.dateAdded||0));
  if(state.view==='trash')items.sort((a,b)=>Number(a.url!==undefined)-Number(b.url!==undefined));
  return items;
}

function domain(url) { try {return new URL(url).hostname.replace(/^www\./,'')||new URL(url).protocol;}catch{return '未知网址';} }

function currentReport() {
  const key=JSON.stringify([state.toolSource,webCollection?.data.revision,state.analysisScope,state.analysisPeriod,state.query]);
  if(reportCache&&reportCacheKey===key)return reportCache;
  const webSource=state.toolSource==='web',webContext=webSource?webAnalysisModel(webCollection.data):null,reportModel=webContext?.model||model,reportNotes=webContext?.notes||contentNotes;
  let books=[...reportModel.bookmarks];
  if(!webSource&&state.analysisScope!=='all'){const ids=descendantsOf(state.analysisScope);books=books.filter(b=>ids.has(b.id));}
  if(state.analysisPeriod!=='all'){const limit=Date.now()-Number(state.analysisPeriod)*86400000;books=books.filter(b=>Number.isFinite(b.dateAdded)&&b.dateAdded>=limit&&b.dateAdded<=Date.now());}
  const terms=state.query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if(terms.length)books=books.filter(b=>terms.every(term=>`${b.title} ${b.url} ${b.path} ${reportNotes[b.id]?.text||''} ${reportNotes[b.id]?.note||''}`.toLowerCase().includes(term)));
  reportCache=analyzeBookmarks({...reportModel,bookmarks:books},{notes:reportNotes,customTopics});reportCache.source=state.toolSource;if(webSource)reportCache.summary.unread=books.filter(item=>item.readAt==null).length;reportCache.scope={folder:webSource?'全部网页收藏':state.analysisScope==='all'?'全部书签':model.nodes.get(state.analysisScope)?.title||'已移除的文件夹',period:state.analysisPeriod,query:state.query};if(webSource)reportCache.basis='网页卡片的标题、网址、已有摘要与备注；主题按本地规则识别，不在分析时额外请求网页。';reportCacheKey=key;return reportCache;
}

function showAnalysis() {
  const report=currentReport();
  const options=model.folders.filter(f=>f.depth>0&&!f.inTrash).map(f=>`<option value="${e(f.id)}" ${state.analysisScope===f.id?'selected':''}>${e((f.path?f.path+' / ':'')+f.title)}</option>`).join('');
  $('#analysisPanel').innerHTML=renderAnalysisView(report,{folderOptions:options,scope:state.analysisScope,period:state.analysisPeriod,query:state.query,source:state.toolSource});
}

function makeOrganizationPlan(){
  organizationPlan=buildOrganizationPlan(model,{meta,notes:contentNotes,customTopics,settings:organizationSettings});
  organizationSelected=new Set(organizationPlan.steps.map(s=>s.key));organizationFilter='all';organizationPage=1;organizationStale=false;organizationContentSignature=JSON.stringify([contentNotes,customTopics]);
}
function showOrganizer(){
  if(state.toolSource==='web'){$('#organizerPanel').innerHTML=renderWebOrganizer(webCollection.data,currentReport());return;}
  $('#organizerPanel').innerHTML=renderOrganizer({model,settings:organizationSettings,plan:organizationPlan,selected:organizationSelected,filter:organizationFilter,page:organizationPage,stale:organizationStale,canUndo:Boolean(meta.pending||meta.history?.length),lastResult:organizationLastResult});
}

function isDuplicateView(){return state.view==='duplicates'||state.view==='folder'&&state.folderFilter==='duplicates';}
function renderScopeStats(){
  currentFolderScope=state.view==='folder'?folderScope(model,state.folderId):null;
  const scope=currentFolderScope;
  const cards=scope?[
    ['目录内收藏',scope.books.length,'包含本目录及所有子文件夹'],
    ['子文件夹',scope.folderCount,'当前目录下的全部层级'],
    ['目录内重复',scope.extraCopies,'只比较此目录范围内的网址'],
    ['本层收藏',scope.direct.length,'直接放在当前文件夹的书签']
  ]:[
    ['全部收藏',active.length,'那些不想错过的好内容'],
    ['文件夹',model.folders.filter(f=>f.depth>1&&!f.inTrash).length,'为不同兴趣留个位置'],
    ['可精简重复',duplicates.reduce((n,g)=>n+g.length-1,0),'每个网址至少保留一份'],
    ['待归类',active.filter(b=>!b.managed&&isLoose(b,model)).length,'还散落在顶层的书签']
  ];
  ['Total','Folders','Duplicates','Loose'].forEach((name,i)=>{
    $('#stat'+name).textContent=cards[i][1].toLocaleString();$('#stat'+name+'Label').textContent=cards[i][0];$('#stat'+name+'Hint').textContent=cards[i][2];
    const card=$('#stat'+name).closest('button'),filter=['all',null,'duplicates','direct'][i];
    if(scope&&filter)card.setAttribute('aria-pressed',String(state.folderFilter===filter));else card.removeAttribute('aria-pressed');
  });
  $('.stats').setAttribute('aria-label',scope?'当前目录概况':'全部书签概况');
  $('#headingBackupLabel').textContent=scope?'备份此文件夹':'备份书签';
  $('#headingOrganizeLabel').textContent=scope?'整理此文件夹':'开始整理';
  $('#headingOrganize').disabled=Boolean(scope?.folder.managed);
  $('#headingOrganize').title=scope?.folder.managed?'受管理的文件夹无法整理。':scope?'只整理当前目录及其子文件夹':'打开自动整理工作台';
}

function syncCollectionNavigation(filter,data){
  if(!webReady)return;
  const items=data.items.filter(item=>item.deletedAt==null);
  $('#navWeb').textContent=items.length;$('#navWebStarred').textContent=items.filter(item=>item.starred).length;$('#navTrash').textContent=trashItems().length+data.items.length-items.length;
  document.querySelectorAll('[data-web-nav]').forEach(button=>{const selected=state.view==='web'&&button.dataset.webNav===filter;button.classList.toggle('active',selected);if(selected)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  if(state.view!=='web')return;
  const labels={all:['网页收藏','值得再看的，都在这里。'],starred:['星标收藏','留下特别喜欢的，随时回来重温。'],unread:['未读内容','还没有标为已读的网页收藏。'],read:['已读内容','读过的好内容，也值得再次发现。'],deleted:['已删除','暂时收起的收藏，可以随时恢复。']};
  const info=labels[filter]||labels.all;$('#pageTitle').textContent=info[0];$('#breadcrumbTitle').textContent=info[0];$('#pageDescription').textContent=info[1];
}

function render() {
  if(state.view!=='folder')currentFolderScope=null;
  if(state.view!=='web'&&!SHARED_VIEWS.has(state.view)&&state.view!=='backup')renderScopeStats();
  document.querySelectorAll('[data-view]').forEach(b=>{if(b.classList.contains('nav-item')) b.classList.toggle('active',b.dataset.view===state.view);});
  const info=state.view==='folder'?[currentFolderScope.folder.title||'文件夹',`当前目录及子文件夹，共 ${currentFolderScope.books.length} 条收藏 · ${currentFolderScope.folderCount} 个子文件夹`,state.folderFilter==='duplicates'?'目录内重复书签':state.folderFilter==='direct'?'本层收藏':'目录收藏']:state.view==='insight'?[state.insight?.label||'分析结果','来自书签分析的对应收藏；你可以继续搜索、补充内容或手动整理。','对应收藏']:viewInfo[state.view];
  $('#pageTitle').textContent=info[0];
  $('#breadcrumbTitle').textContent=info[0];$('#pageDescription').textContent=info[1];$('#listTitle').textContent=info[2];
  const isWeb=state.view==='web',isAnalysis=state.view==='analysis',isOrganizer=state.view==='organize',isBackup=state.view==='backup',shared=SHARED_VIEWS.has(state.view),webTool=shared&&state.toolSource==='web',webList=isWeb||webTool&&['trash','duplicates','insight'].includes(state.view);$('#webPanel').hidden=!webList;$('#webHeadingActions').hidden=!isWeb;$('#bookmarkHeadingActions').hidden=isWeb||webTool||isAnalysis||isBackup||state.view==='trash';document.body.dataset.currentView=state.view;$('#analysisPanel').hidden=!isAnalysis;$('#organizerPanel').hidden=!isOrganizer;$('.stats').hidden=isWeb||shared||isBackup;$('.collection-panel').hidden=webList||isAnalysis||isOrganizer||isBackup;$('.bottom-note').hidden=isWeb||webTool||isAnalysis||isBackup;
  $('#toolSourceBar').hidden=!shared;$('#backupPanel').hidden=!isBackup;
  if(webTool&&isOrganizer)$('#pageDescription').textContent='按主题回顾、补充摘要，批量处理阅读状态与收藏。';
  if(state.view==='insight')$('#pageDescription').textContent=webTool?'来自内容分析的网页收藏，可继续多选、编辑或整理。':'来自书签库内容分析的结果，可继续搜索、编辑或整理。';
  if(shared)$('#toolSourceBar').innerHTML=sourceBar({source:state.toolSource,view:state.view,webCount:webCollection.data.items.filter(item=>state.view==='trash'?item.deletedAt!=null:item.deletedAt==null).length,bookmarkCount:state.view==='trash'?trashItems().length:active.length});
  $('#pageEyebrow').textContent=isWeb?'YOUR LIBRARY':shared?'COLLECTION TOOLS':isBackup?'KEEP A COPY':'YOUR BOOKMARKS';
  if(webCollection&&!webList)syncCollectionNavigation(webCollection.filter,webCollection.data);
  $('#emptyTrashButton').hidden=state.view!=='trash'||webTool;$('#emptyTrashButton').disabled=!trashItems().length||Boolean(meta.pending||meta.purgePending);$('#emptyTrashButton').lastChild.textContent='清空书签回收站';
  $('#search').disabled=isOrganizer||isBackup;$('#search').placeholder=isOrganizer?'在下方选择整理范围…':isBackup?'选择需要导出的收藏类型…':isWeb||webTool?'搜索网页标题、摘要或备注…':'搜索书签、文件夹或正文…';
  $('#search').setAttribute('aria-label',isWeb||webTool?'搜索网页收藏':'搜索书签');
  $('#headingOrganize').hidden=isOrganizer;
  if(isBackup){$('#backupPanel').innerHTML=renderBackupCenter();return;}
  if(webList){webCollection.mode=isWeb?'library':state.view;webCollection.insightIds=state.view==='insight'?new Set(state.insight?.ids||[]):null;if(!isWeb)webCollection.filter=state.view==='trash'?'deleted':'all';if(webReady)webCollection.render();return;}
  if(isAnalysis){showAnalysis();return;}
  if(isOrganizer){showOrganizer();return;}
  const context=$('#contextBar');
  context.hidden=!(state.view==='folder'&&state.folderFilter!=='all')&&!['duplicates','organize','trash','insight'].includes(state.view);
  if(state.view==='folder'&&state.folderFilter!=='all')context.innerHTML=`<p>${state.folderFilter==='duplicates'?`当前目录内有 ${currentFolderScope.duplicates.length} 组重复网址，可精简 ${currentFolderScope.extraCopies} 条；目录外的收藏不参与比较。`:'只显示直接放在当前文件夹中的书签。'}</p><div>${state.folderFilter==='duplicates'&&currentFolderScope.extraCopies?'<button class="text-button" data-action="selectDuplicates">选择可精简项 →</button>':''}<button class="text-button" data-action="folderAll">查看目录全部收藏 →</button></div>`;
  if(state.view==='insight')context.innerHTML='<p>这里是所选分析线索对应的书签。分析没有移动或修改它们。</p><button class="text-button" data-view="analysis">返回书签分析 →</button>';
  if(state.view==='duplicates') context.innerHTML=`<p>发现 ${duplicates.length} 组相同网址。保留较早的一份；受管理的书签优先保留。你可以逐项调整选择。</p><button class="text-button" data-action="selectDuplicates">选择可精简项 ${icon('arrow')}</button>`;
  if(state.view==='organize') context.innerHTML=`<p>归类到“书签小屋 / 对应主题”，优先放在“其他书签”下。无法识别的书签保留原位。</p><label>范围<select id="suggestionScope" aria-label="整理建议范围"><option value="loose" ${state.allSuggestions?'':'selected'}>未分类书签</option><option value="all" ${state.allSuggestions?'selected':''}>所有可整理书签</option></select></label>`;
  if(state.view==='trash') context.innerHTML=`<div><p>这里只保存在当前小屋中，浏览器的书签页不会显示回收站。文件夹及内部层级可一起还原。回收站不随 Chrome 同步，卸载扩展前请导出备份。</p>${meta.lastPurgeDate?'<button class="text-button" data-action="exportTrashBackup">导出清空前备份 →</button>':''}${meta.privateTrashMigratedAt?'<button class="text-button" data-action="exportMigrationBackup">导出旧版迁移前备份 →</button>':''}</div>`;
  const token=webCollection.data.cacheToken||webCollection.data.revision;
  if(bookmarkPreviewToken!==token){bookmarkPreviews=bookmarkPreviewIndex(webCollection.data.items);bookmarkPreviewToken=token;}
  filtered=computeFiltered();state.page=Math.min(state.page,Math.max(1,Math.ceil(filtered.length/state.size)));
  $('#sort').disabled=isDuplicateView();$('#sort').title=isDuplicateView()?'重复书签按相同网址分组':'';
  $('#listCount').textContent=filtered.length.toLocaleString();
  const visible=filtered.slice((state.page-1)*state.size,state.page*state.size);
  if(!visible.length) $('#list').innerHTML=`<div class="empty-state">${icon(state.view==='trash'?'trash':isDuplicateView()?'copy':'book')}<strong>${state.query?'没有找到匹配的收藏':isDuplicateView()?'干干净净，没有重复':state.view==='trash'?'回收站还是空的':state.view==='organize'?'这里已经井井有条':'这里还没有收藏'}</strong>${state.query?'试试更短的关键词，或搜索网站域名。':state.view==='organize'?'可以切换整理范围，或手动移动其他书签。':'你的好发现，会在这里等你。'}</div>`;
  else {
    $('#list').innerHTML=`<div class="bookmark-selection-row"><label><input type="checkbox" id="selectPage" aria-label="${state.view==='trash'?'选择本页项目':'选择本页书签'}">选择本页</label><span>${icon(state.view==='trash'?'undo':'folder')}${state.view==='trash'?'还原后回到原文件夹':'拖动卡片到左侧文件夹'}</span></div><div class="web-card-grid bookmark-grid" role="list" aria-label="${state.view==='trash'?'已删除的书签与文件夹':'书签卡片'}">${visible.map(bookmarkCard).join('')}</div>`;
  }
  webCollection.loadVisibleCovers($('#list')).catch(()=>{});
  const eligible=visible.filter(b=>!b.managed), pageCheck=$('#selectPage');
  if(pageCheck){pageCheck.checked=eligible.length>0&&eligible.every(b=>state.selected.has(b.id));pageCheck.indeterminate=eligible.some(b=>state.selected.has(b.id))&&!pageCheck.checked;pageCheck.disabled=!eligible.length;}
  $('#bulkbar').hidden=!state.selected.size;$('#selectedCount').textContent=state.selected.size;
  $('#archiveButton').hidden=state.view==='trash';$('#restoreButton').hidden=state.view!=='trash';$('#applyCategory').hidden=state.view==='trash';
  $('#bulkbar [data-action="move"]').hidden=state.view==='trash';
  $('#resultDescription').textContent=filtered.length?`显示 ${(state.page-1)*state.size+1}–${Math.min(state.page*state.size,filtered.length)} 项，共 ${filtered.length.toLocaleString()} 项`:'共 0 项';
  $('#pageNumber').textContent=`${state.page} / ${Math.max(1,Math.ceil(filtered.length/state.size))}`;
  $('#previousPage').disabled=state.page<=1;$('#nextPage').disabled=state.page*state.size>=filtered.length;
}

function bookmarkCard(b) {
  let folderPath=b.inTrash?b.originalPath||'原位置已不可用':b.path,contents=null;
  if(b.url===undefined){
    contents=folderContents(model,b.id);
    const original=meta.privateTrash.find(entry=>entry.id===b.id)?.position||meta.originals?.[b.id];
    folderPath=original?.path||model.nodes.get(original?.parentId)?.title||'原位置不可用';
  }
  return renderBookmarkCard(b,{
    selected:state.selected.has(b.id),note:contentNotes[b.id],sharedItem:b.url?bookmarkPreviews.get(bookmarkPreviewKey(b.url)):null,
    category:b.url?suggestCategory(b):'',duplicateLabel:isDuplicateView()?(b.id===(currentFolderScope?.keepers||keepers).get(b.id)?'建议保留':'重复收藏'):'',folderPath,contents
  });
}

function closeFolderMenu(restoreFocus=false){
  const menu=$('#folderMenu');if(!menu)return;menu.hidden=true;
  folderMenuTrigger?.setAttribute('aria-expanded','false');
  if(restoreFocus&&folderMenuTrigger?.isConnected)folderMenuTrigger.focus();
  folderMenuTrigger=null;
}
function openFolderMenu(id,anchor,point=null){
  const menu=$('#folderMenu');if(!anchor)return;
  closeFolderMenu();folderMenuTrigger=anchor;
  let reason='';try{engine.validateFolder(model,id,meta);}catch(error){reason=error.message;}
  const remove=$('#folderDeleteMenu'),note=$('#folderMenuNote');
  remove.dataset.id=id;remove.disabled=Boolean(reason);remove.title=reason;
  note.textContent=reason;note.hidden=!reason;
  menu.hidden=false;anchor.setAttribute('aria-expanded','true');
  const rect=anchor.getBoundingClientRect(),left=point?.x??rect.left,top=point?.y??rect.bottom+5;
  menu.style.left=`${Math.max(8,Math.min(left,innerWidth-menu.offsetWidth-8))}px`;menu.style.top=`${Math.max(8,Math.min(top,innerHeight-menu.offsetHeight-8))}px`;
  (reason?menu:remove).focus();
}

function go(view,folderId=null) {webDrop?.cancel();if(SHARED_VIEWS.has(view)&&!SHARED_VIEWS.has(state.view)&&state.view!=='backup')state.toolSource=state.view==='web'?'web':'bookmarks';if(['all','recent','folder','loose'].includes(view)){state.toolSource='bookmarks';$('#bookmarkSection').open=true;}if(view==='web'){state.toolSource='web';if(webCollection?.filter==='deleted')webCollection.filter='all';}webCollection?.selected.clear();if(webCollection)webCollection.month='';state.view=view;state.folderId=folderId;state.folderFilter='all';state.page=1;state.query='';state.selected.clear();$('#search').value='';if(view==='organize'&&state.toolSource==='web'){state.analysisScope='all';state.analysisPeriod='all';}if(view==='organize'&&state.toolSource==='bookmarks'&&!organizationPlan)makeOrganizationPlan();sidebarLayout.closeMobile();if($('#bookmarkSection').open)renderFolders();render();}
function folderOptions(selected) {return model.folders.filter(f=>f.depth>0&&!f.managed&&!f.inTrash).map(f=>`<option value="${e(f.id)}" ${f.id===selected?'selected':''}>${e((f.path?f.path+' / ':'')+(f.title||'未命名文件夹'))}</option>`).join('');}
function chosen(one) {return one?[one]:[...state.selected];}

function showDialog(title,body,confirmText,handler,danger=false) {
  $('#dialogTitle').textContent=title;$('#dialogBody').innerHTML=body;$('#dialogConfirm').textContent=confirmText;$('#dialogError').textContent='';dialogHandler=handler;$('#dialog').showModal();
  $('#dialogConfirm').classList.toggle('danger',danger);
  const field=$('#dialogBody input, #dialogBody select, #dialogBody textarea');if(field)field.focus();
}
async function locked(fn) {return navigator.locks?navigator.locks.request('bookmark-house-write',fn):fn();}
async function perform(fn,message,undo=true,source='bookmarks') {
  if(state.busy)return;
  state.busy=true;document.body.classList.add('is-busy');document.body.setAttribute('aria-busy','true');
  try {const result=await locked(fn);state.selected.clear();if(source==='web')await refreshWeb();else await refresh({web:false});toast(typeof message==='function'?message(result):message,typeof undo==='function'?undo(result):undo);return result;}
  finally {state.busy=false;document.body.classList.remove('is-busy');document.body.setAttribute('aria-busy','false');if(webDirty||bookmarksDirty)scheduleSync();}
}
function download(data,name,type='text/html;charset=utf-8') {const blob=new Blob([data],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}

async function action(name,id,anchor) {
  if(state.busy)return;
  if(name.startsWith('web')&&name!=='webReview')return webCollection.action(name,id);
  if(name==='sharedSummarize')return webCollection.action('webSummarize');
  if(name==='sharedWebImport'){go('web');return webCollection.action('webImport');}
  if(name==='webReview'){if(!['missing','read'].includes(id))return;const items=webCollection.data.items.filter(item=>item.deletedAt==null);state.insight={label:id==='missing'?'还没有摘要':'已经读过',ids:items.filter(item=>id==='missing'?!item.preview?.summary:item.readAt!=null).map(item=>item.id)};go('insight');return;}
  if(name==='statScope'||name==='folderAll'){
    const metric=name==='folderAll'?'total':id;
    if(metric==='folders')return action('focusFolders');
    if(state.view==='folder'){
      state.folderFilter=metric==='duplicates'?'duplicates':metric==='direct'?'direct':'all';state.query='';state.page=1;state.selected.clear();$('#search').value='';render();
    }else go(metric==='duplicates'?'duplicates':metric==='direct'?'loose':'all');
    return;
  }
  if(name==='organizeCurrent'){
    await refresh();const folder=state.view==='folder'?folderScope(model,state.folderId).folder:null;
    if(folder?.managed)throw new Error('受管理的文件夹无法整理。');
    const oldScope=organizationSettings.scopeId;
    organizationSettings={...organizationSettings,scopeId:folder?.id||'all',targetId:folder?.id||(organizationSettings.targetId===oldScope?engine.bookmarksBar(model)?.id||engine.primaryRoot(model)?.id:organizationSettings.targetId)};
    makeOrganizationPlan();organizationLastResult='';go('organize');return;
  }
  if(name==='exportMigrationBackup'){const saved=await adapter.store.get('privateTrashMigrationBackup');if(!saved){toast('迁移前备份暂不可用');return;}download(exportHtml(saved.tree),`回收站迁移前备份-${new Date(saved.date).toISOString().slice(0,10)}.html`);toast('旧版迁移前备份已导出');return;}
  if(name==='exportTrashBackup'){const saved=await adapter.store.get('trashBackup');if(!saved){toast('还没有清空前备份');return;}download(exportHtml(saved.tree),`清空前书签备份-${new Date(saved.date).toISOString().slice(0,10)}.html`);toast('已导出清空前的完整书签备份');return;}
  if(name==='emptyTrash'){
    await locked(()=>engine.recoverTrashPurge());await refresh();const preview=await engine.getTrashPreview();if(!preview.itemCount){toast('回收站已经是空的');return;}
    showDialog('清空 书签库回收站？',`<p>将永久删除回收站中的全部内容，包括文件夹里的书签。</p><ul class="dialog-summary"><li><span>顶层项目</span><strong>${preview.itemCount} 项</strong></li><li><span>书签总数</span><strong>${preview.bookmarkCount} 条</strong></li><li><span>文件夹总数（含子文件夹）</span><strong>${preview.folderCount} 个</strong></li></ul><p class="purge-warning">此操作仅清除小屋内的回收站记录，无法撤销，不影响 Chrome 中现有的书签。清空前会自动保存备份，之后可导出并通过 Chrome 导入恢复。</p><button type="button" class="text-button" data-action="backup">先导出当前完整书签备份 →</button>`,'永久清空',async()=>{await perform(()=>engine.emptyTrash(preview),result=>result.failed||result.remaining?`已删除 ${result.deletedBookmarks} 条书签、${result.deletedFolders} 个文件夹；仍有 ${result.remaining} 项保留，请刷新检查。`:`回收站已清空：删除 ${result.deletedBookmarks} 条书签、${result.deletedFolders} 个文件夹。`,false);organizationLastResult='';},true);return;
  }
  if(name==='generateOrganization'){await refresh();makeOrganizationPlan();await adapter.store.set('organizationSettings',organizationSettings);showOrganizer();toast(`已生成 ${organizationPlan.steps.length} 项整理步骤`);return;}
  if(name==='selectOrganization'||name==='clearOrganization'){if(!organizationPlan)return;const steps=organizationPlan.steps.filter(s=>organizationFilter==='all'||organizationFilter==='review'||s.type===organizationFilter);for(const s of steps){if(name==='selectOrganization')organizationSelected.add(s.key);else organizationSelected.delete(s.key);}showOrganizer();return;}
  if(name==='previousOrganization'||name==='nextOrganization'){organizationPage=Math.max(1,organizationPage+(name==='nextOrganization'?1:-1));showOrganizer();return;}
  if(name==='exportOrganization'){if(!organizationPlan)return;download(JSON.stringify({...organizationPlan,signature:undefined,selectedKeys:[...organizationSelected]},null,2),'书签小屋-自动整理方案.json','application/json;charset=utf-8');toast('整理方案已导出');return;}
  if(name==='applyOrganization'){
    await refresh();if(organizationStale){toast('书签或偏好已变化，请重新生成整理方案');return;}const plan=organizationPlan,keys=[...organizationSelected],summary=organizationSummary(plan,keys);if(!summary.total)return;
    showDialog('执行自动整理？',`<p>将直接调整当前 Chrome 的真实书签与目录。</p><ul class="dialog-summary"><li><span>自动归类书签</span><strong>${summary.classify} 条</strong></li><li><span>重复副本移入回收站</span><strong>${summary.dedupe} 条</strong></li><li><span>合并同名目录</span><strong>${summary.merge} 个</strong></li><li><span>空目录移入回收站</span><strong>${summary.empty} 个</strong></li><li><span>新建分类目录</span><strong>${summary.newFolders} 个</strong></li></ul><p>自动保存操作前备份；整份方案记录为一次操作，可一键撤销。没有选中的项目保留原位。</p>`,'执行整理',async()=>{
      await perform(()=>engine.applyOrganization(plan,keys),'自动整理已完成，可撤销整份方案');organizationLastResult=`归类 ${summary.classify} 条，精简重复 ${summary.dedupe} 条，合并 ${summary.merge} 个目录，收起 ${summary.empty} 个空目录。`;makeOrganizationPlan();showOrganizer();
    });return;
  }
  if(name==='archiveFolder'){
    closeFolderMenu(true);const folder=engine.validateFolder(model,id,meta),contents=folderContents(model,id);
    showDialog('删除文件夹？',`<p>将「${e(folder.title||'未命名文件夹')}」整个移入回收站。</p><ul class="dialog-summary"><li><span>其中的书签</span><strong>${contents.bookmarkCount} 条</strong></li><li><span>其中的子文件夹</span><strong>${contents.folderCount} 个</strong></li></ul><p>文件夹会从 Chrome 移除并保存在小屋内部，原有层级、正文和笔记一起保留。可在回收站还原，也可以撤销本次操作。</p>`,'移入回收站',async()=>{await perform(()=>engine.archiveFolder(id),'文件夹及其中的内容已移入回收站');});return;
  }
  if(name==='inspectTrashFolder'){
    const folder=model.nodes.get(id);if(!folder?.inTrash)return;const contents=folderContents(model,id),rows=contents.ids.slice(1,81).map(childId=>{const node=model.nodes.get(childId);return `<li>${icon(node.url===undefined?'folder':'book')}<span>${e(node.title||'未命名项目')}</span></li>`;}).join('');
    showDialog(folder.title||'回收站文件夹',`<p>包含 ${contents.bookmarkCount} 条书签、${contents.folderCount} 个子文件夹。还原时会保留内部层级。</p>${rows?`<ul class="folder-preview-list">${rows}</ul>${contents.ids.length>81?'<p>仅展示前 80 项，其余内容也会一起还原。</p>':''}`:'<p>这是一个空文件夹。</p>'}`,'还原整个文件夹',async()=>{await perform(()=>engine.restore([id]),'整个文件夹已还原');});return;
  }
  if(name==='refresh'){await refresh();toast('书签已更新');return;}
  if(name==='resetDemo'&&adapter.demo){await perform(async()=>{const tree=demoTree();await adapter.store.set('demoTree',tree);await adapter.store.set('meta',{history:[],originals:{}});await adapter.store.set('backup',null);await adapter.store.set('contentNotes',{});await adapter.store.set('analysisTopics',[]);await webCollection.repository.change(data=>{const revision=data.revision;Object.assign(data,demoWebCollection(),{revision});});adapter.api=new DemoAdapter(tree,t=>adapter.store.set('demoTree',t));engine=new BookmarkEngine(adapter.api,adapter.store);bookmarkCache=new BookmarkCache(adapter.api,adapter.store);state.view='web';state.folderId=null;state.page=1;state.query='';$('#search').value='';state.analysisScope='all';state.analysisPeriod='all';},'示例已重置',false);return;}
  if(name==='topicRules'){
    showDialog('定义你的分析主题',`<p>每行一个主题，格式为“名称：关键词，关键词”。支持中英文，最多 20 个主题。主题只用于分析，不会移动书签。</p><label class="form-field">自定义主题<textarea id="topicRules" rows="7" maxlength="40000" placeholder="超分辨率：超分，super resolution，bsrgan，swinir&#10;无痕改字：改字，inpainting，text editing">${e(topicRulesText(customTopics))}</textarea></label><p>内置主题继续生效；自定义主题在同分时优先。清空后保存可恢复仅使用内置主题。</p>`,'保存主题',async()=>{const topics=parseTopicRules($('#topicRules').value);await perform(()=>adapter.store.set('analysisTopics',topics),'分析主题已更新',false);});return;
  }
  if(name==='contentNote'){
    const b=model.nodes.get(id);if(!b)return;const saved=contentNotes[id]||{};
    showDialog('补充正文与笔记',`<p>${e(b.title||'未命名书签')}</p><label class="form-field">文章正文或已有摘要<textarea id="contentText" rows="8" maxlength="40000" placeholder="粘贴文章正文，参与主题分析、关键词提取和正文摘句。">${e(saved.text||'')}</textarea></label><label class="form-field">我的理解与笔记<textarea id="contentNote" rows="3" maxlength="2000" placeholder="这条收藏解决什么问题？什么时候会用到？">${e(saved.note||'')}</textarea></label><p>内容仅保存到当前扩展的本地空间；没有正文时也可以只写笔记。</p><button type="button" class="text-button" data-action="exportNotes">导出全部正文与笔记备份 →</button>`,'保存内容',async()=>{const entry={text:$('#contentText').value,note:$('#contentNote').value,updatedAt:Date.now(),url:b.url,title:b.title};await perform(async()=>{if(b.inTrash){await engine.saveTrashNote(id,entry);return;}const notes=await adapter.store.get('contentNotes')||{};if(entry.text.trim()||entry.note.trim())notes[id]=entry;else delete notes[id];await adapter.store.set('contentNotes',notes);},'正文与笔记已保存，分析已更新',false);});return;
  }
  if(name==='exportNotes'){download(JSON.stringify({version:1,exportedAt:Date.now(),notes:contentNotes,topics:customTopics},null,2),'书签小屋-正文与主题备份.json','application/json;charset=utf-8');toast('正文、笔记和自定义主题已导出');return;}
  if(name==='exportAnalysis'||name==='exportAnalysisJson'){
    const report=currentReport();if(name==='exportAnalysis')download(analysisToHtml(report),`${state.toolSource==='web'?'网页收藏':'书签库'}分析报告-${new Date().toISOString().slice(0,10)}.html`);else download(JSON.stringify(report,null,2),`${state.toolSource==='web'?'网页收藏':'书签库'}分析报告-${new Date().toISOString().slice(0,10)}.json`,'application/json;charset=utf-8');toast('已生成当前筛选范围的本地分析报告');return;
  }
  if(name==='clearSelection'){state.selected.clear();render();return;}
  if(name==='focusFolders'){sidebarLayout.expand();$('#bookmarkSection').open=true;$('#folders').scrollIntoView({block:'nearest'});$('#folders button[data-folder]')?.focus();return;}
  if(name==='previous'||name==='next'){state.page+=name==='next'?1:-1;render();return;}
  if(name==='selectAllResults'){filtered.filter(b=>!b.managed).forEach(b=>state.selected.add(b.id));render();return;}
  if(name==='selectDuplicates'){
    state.selected.clear();const visibleIds=new Set(filtered.map(b=>b.id));
    for(const group of currentFolderScope?.duplicates||duplicates){const keep=group.find(b=>b.managed)||group[0];group.filter(b=>b.id!==keep.id&&!b.managed&&visibleIds.has(b.id)).forEach(b=>state.selected.add(b.id));}
    render();if(!state.selected.size)toast('没有可精简的重复项');return;
  }
  if(name==='backup'){
    const folderId=state.view==='folder'?state.folderId:null;
    const tree=folderId?folderBackup(await engine.model(),folderId):await engine.backupTree();
    const label=folderId?(tree[0].title||'文件夹').replace(/[\\/:*?"<>|\x00-\x1f]/g,'-').slice(0,80):'书签小屋';
    download(exportHtml(tree),`${label}备份-${new Date().toISOString().slice(0,10)}.html`);toast(folderId?'已备份此文件夹及其子文件夹':'已生成可导入 Chrome 的 HTML 备份');return;
  }
  if(name==='exportBefore'){const saved=await adapter.store.get('backup');if(!saved){toast('还没有操作前备份，可以先使用右上角“备份书签”。');return;}download(exportHtml(saved.tree),`操作前备份-${new Date(saved.date).toISOString().replace(/[:.]/g,'-')}.html`);toast('已导出最近一次操作前的完整备份');return;}
  if(name==='undo'){
    await perform(()=>engine.undo(),r=>r.failed?`已恢复 ${r.restored} 项；${r.failed} 项存在外部变化，已保留现状和恢复记录。`:`已撤销，恢复 ${r.restored} 项。`,false);organizationLastResult='';if(state.view==='organize'){makeOrganizationPlan();showOrganizer();}return;
  }
  if(name==='newFolder'){
    const defaultId=state.view==='folder'?state.folderId:engine.primaryRoot(model)?.id;
    showDialog('新建文件夹',`<label class="form-field">文件夹名称<input id="folderName" required maxlength="100" placeholder="给新收藏留个位置"></label><label class="form-field">放在哪里<select id="folderParent">${folderOptions(defaultId)}</select></label>`,'创建文件夹',async()=>{await perform(()=>engine.createFolder($('#folderParent').value,$('#folderName').value),'文件夹已创建',false);});return;
  }
  if(name==='edit'){
    const b=model.nodes.get(id);if(!b)return;
    showDialog('编辑书签',`<label class="form-field">名称<input id="bookmarkTitle" required value="${e(b.title)}"></label><label class="form-field">网址<input id="bookmarkUrl" required value="${e(b.url)}"></label>`,'保存修改',async()=>{await perform(()=>engine.edit(id,$('#bookmarkTitle').value.trim(),$('#bookmarkUrl').value.trim()),n=>n?'书签已更新':'内容没有变化');});return;
  }
  const ids=chosen(['moveOne','restoreOne','archiveOne'].includes(name)?id:null);if(!ids.length){toast('请先选择书签');return;}
  if(name==='move'||name==='moveOne'){
    showDialog(`移动 ${ids.length} 个书签`,`<p>书签将保留原名称与网址，移动后可撤销。</p><label class="form-field">目标文件夹<select id="destination">${folderOptions(engine.primaryRoot(model)?.id)}</select></label>`,'确认移动',async()=>{await perform(()=>engine.move(ids,$('#destination').value),n=>`已移动 ${n} 个书签`);});return;
  }
  if(name==='categorize'){
    const counts=new Map();ids.forEach(id=>{const c=suggestCategory(model.nodes.get(id));if(c)counts.set(c,(counts.get(c)||0)+1);});
    const count=[...counts.values()].reduce((a,b)=>a+b,0);
    if(!count){toast('这些书签没有明确的主题，建议手动选择文件夹。');return;}
    showDialog('确认分类建议',`<p>将 ${count} 个书签移到“书签小屋”下的主题文件夹。其他书签保留原位。</p><ul class="dialog-summary">${[...counts].map(([c,n])=>`<li><span>${e(c)}</span><strong>${n} 项</strong></li>`).join('')}</ul><p>分类依据是标题和网址关键词，你可以在完成后继续调整。</p>`,'应用分类',async()=>{await perform(()=>engine.categorize(ids),n=>`已为 ${n} 个书签找到新位置`);});return;
  }
  if(name==='archive'||name==='archiveOne'){
    showDialog(`移入回收站？`,`<p>选中的 ${ids.length} 个书签会从 Chrome 移除并保存到小屋内部回收站。你可以随时还原，或撤销本次操作。</p>`,'移入回收站',async()=>{await perform(()=>engine.archive(ids),n=>`已将 ${n} 个书签移入回收站`);});return;
  }
  if(name==='restore'||name==='restoreOne'){
    const folders=ids.filter(selected=>model.nodes.get(selected)?.url===undefined).length;
    showDialog('还原所选项目',`<p>将 ${ids.length} 个项目放回原位置，其中有 ${folders} 个文件夹。${folders?'文件夹及内部全部内容会一起还原。':''}</p><p>原位置已移除或不可写入时，放回可用的顶层文件夹。还原会在书签库中重新建立书签，正文和笔记一并保留。</p>`,'确认还原',async()=>{await perform(()=>engine.restore(ids),n=>`已还原 ${n} 个项目`);});
  }
}

document.addEventListener('contextmenu',event=>{
  const row=event.target.closest('#folders .folder-row');if(!row)return;
  event.preventDefault();if(state.busy||$('#dialog').open||!bookmarksReady)return;
  const anchor=row.querySelector('[data-folder]');
  openFolderMenu(anchor.dataset.folder,anchor,event.clientX||event.clientY?{x:event.clientX,y:event.clientY}:null);
});
document.addEventListener('click',async event=>{
  const view=event.target.closest('[data-view]'),folder=event.target.closest('[data-folder]'),toggle=event.target.closest('[data-toggle-folder]'),button=event.target.closest('[data-action]'),analysis=event.target.closest('[data-analysis-type]'),organizationFilterButton=event.target.closest('[data-organize-filter]');
  try {
    document.querySelectorAll('.web-card-menu[open]').forEach(menu=>{if(!menu.contains(event.target)||button)menu.open=false;});
    if(!event.target.closest('#folderMenu'))closeFolderMenu();
    if(state.busy)return;
    const source=event.target.closest('[data-tool-source]'),webNav=event.target.closest('[data-web-nav]'),webAction=button?.dataset.action.startsWith('web');
    // Ordinary links, scrolling and sidebar layout never wait for data reads.
    if(!view&&!folder&&!toggle&&!button&&!analysis&&!organizationFilterButton&&!source&&!webNav)return;
    if(!webReady&&(webNav||webAction||source||analysis||view&&(['web','backup'].includes(view.dataset.view)||SHARED_VIEWS.has(view.dataset.view)))){await webLoaded;if(!webReady)return;}
    if(!bookmarksReady&&!webNav&&!webAction){await bookmarksLoaded;if(!bookmarksReady)return;}
    if(source){state.toolSource=source.dataset.toolSource;state.analysisScope='all';state.analysisPeriod='all';reportCache=null;go(state.view==='insight'?'analysis':state.view);return;}
    if(webNav){webCollection.filter=webNav.dataset.webNav;webCollection.month='';webCollection.limit=24;go('web');return;}
    if(organizationFilterButton){organizationFilter=organizationFilterButton.dataset.organizeFilter;organizationPage=1;showOrganizer();return;}
    if(analysis){event.preventDefault();const report=currentReport(),type=analysis.dataset.analysisType,key=analysis.dataset.analysisKey;state.insight={label:analysis.dataset.analysisLabel,ids:analysisFilterIds(report,type,key)};go('insight');return;}
    if(view){go(view.dataset.view);return;}
    if(folder){state.collapsed.delete(folder.dataset.folder);go('folder',folder.dataset.folder);return;}
    if(toggle){const id=toggle.dataset.toggleFolder;state.collapsed.has(id)?state.collapsed.delete(id):state.collapsed.add(id);renderFolders();return;}
    if(button)await action(button.dataset.action,button.dataset.id,button);
  } catch(error){toast(error.message,false);if(engine)await refresh().catch(()=>{});}
});
document.addEventListener('change',async event=>{
  if(state.busy)return;const target=event.target;
  if(target.id.startsWith('web')||target.dataset.webSelect){try{await webCollection.change(event);}catch(error){toast(error.message);}return;}
  if(target.dataset.organizeSelect){target.checked?organizationSelected.add(target.dataset.organizeSelect):organizationSelected.delete(target.dataset.organizeSelect);showOrganizer();return;}
  const organizationFields={organizeScope:'scopeId',organizeMode:'mode',organizeTarget:'targetId',organizeMinimum:'minGroup'};
  if(organizationFields[target.id]||target.dataset.organizeSetting){const key=organizationFields[target.id]||target.dataset.organizeSetting;organizationSettings[key]=target.dataset.organizeSetting?target.checked:target.value;organizationStale=Boolean(organizationPlan);adapter.store.set('organizationSettings',organizationSettings).catch(error=>toast(error.message));showOrganizer();return;}
  if(target.dataset.select){const id=target.dataset.select;target.checked?state.selected.add(id):state.selected.delete(id);render();[...document.querySelectorAll('[data-select]')].find(input=>input.dataset.select===id)?.focus({preventScroll:true});}
  if(target.id==='selectPage'){filtered.slice((state.page-1)*state.size,state.page*state.size).filter(b=>!b.managed).forEach(b=>target.checked?state.selected.add(b.id):state.selected.delete(b.id));render();$('#selectPage')?.focus({preventScroll:true});}
  if(target.id==='sort'){state.sort=target.value;state.page=1;render();}
  if(target.id==='suggestionScope'){state.allSuggestions=target.value==='all';state.page=1;state.selected.clear();render();}
  if(target.id==='analysisScope'){state.analysisScope=target.value;showAnalysis();}
  if(target.id==='analysisPeriod'){state.analysisPeriod=target.value;showAnalysis();}
});
let searchTimer;
$('#search').addEventListener('input',event=>{state.query=event.target.value;state.page=1;if(webCollection)webCollection.limit=24;state.selected.clear();clearTimeout(searchTimer);searchTimer=setTimeout(()=>{if(model)render();},180);});
document.addEventListener('keydown',event=>{
  if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){
    const anchor=event.target.closest('#folders [data-folder]');
    if(anchor&&!state.busy&&!$('#dialog').open&&bookmarksReady){event.preventDefault();openFolderMenu(anchor.dataset.folder,anchor);return;}
  }
  if(event.key==='Tab'&&!$('#folderMenu').hidden)closeFolderMenu();
  if(event.key==='Escape'){const menu=document.querySelector('.web-card-menu[open]');if(menu){event.preventDefault();menu.open=false;menu.querySelector('summary').focus();return;}}
  if(event.key==='Escape'&&webDrop?.isActive()){event.preventDefault();webDrop.cancel();return;}
  if(event.key==='Escape'&&bookmarkDrag?.isActive()){event.preventDefault();bookmarkDrag.cancel();return;}
  if(event.key==='Escape'&&!$('#folderMenu').hidden){event.preventDefault();closeFolderMenu(true);return;}
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();$('#search').focus();$('#search').select();}
  if(event.key==='Escape'&&!$('#dialog').open&&model){state.selected.clear();webCollection?.selected.clear();sidebarLayout.closeMobile();render();}
});
$('#dialogForm').addEventListener('submit',async event=>{event.preventDefault();if(state.busy)return;$('#dialogError').textContent='';try{await dialogHandler();$('#dialog').close();}catch(error){$('#dialogError').textContent=error.message;await refresh().catch(()=>{});}});
$('#list').addEventListener('error',event=>removeFailedCover(event.target),true);
$('#dialogCancel').addEventListener('click',()=>{if(!state.busy)$('#dialog').close();});
$('#dialogCancelX').addEventListener('click',()=>{if(!state.busy)$('#dialog').close();});
$('#dialog').addEventListener('cancel',event=>{if(state.busy)event.preventDefault();});
$('#toastClose').addEventListener('click',()=>$('#toast').hidden=true);
$('#toastUndo').addEventListener('click',()=>{if(toastUndoHandler)Promise.resolve(toastUndoHandler()).catch(error=>toast(error.message));});
window.addEventListener('resize',()=>closeFolderMenu());
document.addEventListener('scroll',()=>closeFolderMenu(),true);

async function loadNativeBookmarks() {
  try {
    engine.onProgress=progress=>{$('#status').textContent=`正在${progress.label}：${progress.completed} / ${progress.total}`;};
    const startupMeta=await engine.meta();
    // Normal openings are read-only and do not queue behind a writer in another tab.
    // Recovery and migration still acquire the write lock and re-read their own state.
    if(startupMeta.purgePending)await locked(()=>engine.recoverTrashPurge());
    if(startupMeta.privateTrashVersion!==1){await locked(()=>engine.migratePrivateTrash());await bookmarkCache.invalidate();}
    const initialBookmarks=await refresh({web:false,fresh:false});bookmarksReady=true;resolveBookmarks();
    bookmarkDrag=installBookmarkDrag({
      folderTree:$('#folders'),getModel:()=>model,getSelected:()=>state.selected,
      blockedReason:()=>state.busy?'请等待当前操作完成。':meta.pending||meta.purgePending?'请先处理上次未完成的操作。':$('#dialog').open?'请先关闭当前弹窗。':'',
      onMove:async(ids,folder)=>{await perform(()=>engine.move(ids,folder.id),n=>n?`已将 ${n} 条书签移入「${folder.title}」`:'这些书签已经在目标文件夹中。',n=>n>0);},
      onCreate:async(links,folder)=>{await perform(()=>engine.addBookmarks(links,folder.id),n=>n?`已将 ${n} 个网页链接收藏到「${folder.title}」`:'目标文件夹中已收藏这些链接。',n=>n>0);},
      onExpand:id=>{
        if(!state.collapsed.has(id))return;state.collapsed.delete(id);
        const row=[...$('#folders').querySelectorAll('[data-drop-folder]')].find(el=>el.dataset.dropFolder===id),children=row?.parentElement.querySelector(':scope > .folder-children'),toggle=row?.querySelector('[data-toggle-folder]');
        if(children)children.hidden=false;if(toggle){toggle.classList.add('expanded');toggle.setAttribute('aria-expanded','true');toggle.setAttribute('aria-label',`收起 ${model.nodes.get(id)?.title||'文件夹'}`);}
      },
      onError:message=>{toast(message,false);if(!state.busy)refresh().catch(()=>{});},
      onFinish:()=>{if(dragRefreshPending){dragRefreshPending=false;refresh().catch(error=>toast(error.message));}}
    });
    if(webDirty||bookmarksDirty)scheduleSync();
    // The cached library is usable immediately. Verify later to catch missed
    // events and last-used dates, which do not emit bookmark change events.
    if(initialBookmarks.fromCache)setTimeout(async()=>{
      try{
        const {snapshot}=await bookmarkCache.read({fresh:true});
        if(snapshot.token!==bookmarkSnapshot.token){bookmarksDirty=true;scheduleSync();}
      }catch(error){console.warn('书签小屋：稍后核对书签库',error.message);}
    },800);
  }catch(error){resolveBookmarks();$('#status').textContent=`书签库暂时无法读取：${error.message}`;}
}

async function start() {
  try {
    await waitForHomePreview();
    adapter=await createAdapter();engine=new BookmarkEngine(adapter.api,adapter.store);$('#demoBanner').hidden=!adapter.demo;
    bookmarkCache=new BookmarkCache(adapter.api,adapter.store);
    if(!adapter.demo)watchBookmarkCache(bookmarkCache,{prewarm:false,onChange:()=>{bookmarksDirty=true;scheduleSync();}});
    const repository=new WebCollection(adapter.store);
    if(adapter.demo&&!await adapter.store.get(WEB_COLLECTION_KEY))await adapter.store.set(WEB_COLLECTION_KEY,demoWebCollection());
    webCollection=new WebCollectionView({container:$('#webPanel'),repository,getModel:()=>model,getSearch:()=>state.query,setSearch:value=>{state.query=value;$('#search').value=value;},onCount:count=>{$('#navWeb').textContent=count;},onRender:(filter,data)=>syncCollectionNavigation(filter,data),onDataChange:()=>refreshWeb(),navigateTrash:()=>{state.toolSource='web';go('trash');},navigateLibrary:()=>go('web'),showDialog,toast,perform:(fn,message,undo)=>perform(fn,message,undo,'web'),download,
      addToBookmarks:async item=>{await bookmarksLoaded;if(!bookmarksReady)return;showDialog('同时加入 书签库',`<p>「${e(item.title)}」会加入你选择的书签目录，网页卡片继续保留。</p><label class="form-field">书签文件夹<select id="webBookmarkFolder">${folderOptions(engine.bookmarksBar(model)?.id||engine.primaryRoot(model)?.id)}</select></label>`,'加入书签',()=>perform(()=>engine.addBookmarks([{url:item.url,title:item.title}],$('#webBookmarkFolder').value),n=>n?'已加入 书签库，网页卡片继续保留。':'该文件夹里已有此网址，网页卡片继续保留。'));}
    });
    webDrop=installWebDrop({isVisible:()=>state.view==='web',isBlocked:()=>state.busy||$('#dialog').open,onSave:async links=>{await webLoaded;if(!webReady)throw new Error('网页收藏暂时无法读取，请刷新后重试。');return webCollection.saveLinks(links);},onError:message=>toast(message)});
    meta={history:[]};model=flatten([]);
    if(typeof BroadcastChannel!=='undefined'){webChannel=new BroadcastChannel('bookmark-house-web-collection');webChannel.onmessage=event=>{
      if(event.data?.source===repository.sourceId||event.data?.revision<=webCollection.data.revision)return;
      webDirty=true;scheduleSync();
    };}
    window.addEventListener('focus',()=>{webDirty=true;scheduleSync();});
    $('#dialog').addEventListener('close',()=>{if(webDirty||bookmarksDirty)scheduleSync();});
    document.addEventListener('dragend',()=>{if(webDirty||bookmarksDirty)scheduleSync();});
    if(webDirty||bookmarksDirty)scheduleSync();
    // Native folders and the full web collection load independently. A slow
    // card read must not keep an already-cached bookmark library unavailable.
    loadNativeBookmarks();
    await webCollection.refresh();webReady=true;webCollection.adoptCachedHome();render();document.body.inert=false;resolveWeb();
    if(webDirty||bookmarksDirty)scheduleSync();
  }catch(error){
    document.body.inert=false;resolveWeb();
    if(!engine)resolveBookmarks();
    $('#status').textContent=`网页收藏暂时无法打开，请刷新后重试。${error.message}`;
  }
}
start();
