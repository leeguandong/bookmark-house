import {escapeHtml as e,findDuplicates} from './core.js';
import {cleanPreview} from './page-preview.js';

export const SHARED_VIEWS=new Set(['analysis','organize','duplicates','trash','insight']);
export function webAnalysisModel(data){
  const folders=[['starred','星标收藏'],['unread','未读收藏'],['read','已读收藏']].map(([id,title])=>({id:`web-group:${id}`,title,depth:2,children:[]}));
  const nodes=new Map(folders.map(folder=>[folder.id,folder])),notes={};
  const bookmarks=data.items.filter(item=>item.deletedAt==null).map(item=>{
    const preview=cleanPreview(item.preview),group=item.starred?'starred':item.readAt==null?'unread':'read',parent=nodes.get(`web-group:${group}`);
    const row={id:item.id,title:item.title,url:item.url,dateAdded:item.savedAt,readAt:item.readAt,parentId:parent.id,path:parent.title,managed:false,inTrash:false};
    notes[row.id]={url:item.url,text:preview.summary||preview.description,note:item.note};nodes.set(row.id,row);return row;
  });
  return {model:{nodes,folders,bookmarks},notes};
}
export function webDuplicateGroups(data){return findDuplicates(data.items.filter(item=>item.deletedAt==null).map(item=>({...item,dateAdded:item.savedAt})));}
export function sourceBar({source,view,webCount,bookmarkCount}){
  const label=view==='trash'?'回收站来源':'处理来源';
  return `<div class="tool-source-tabs" role="group" aria-label="${label}"><span>${label}</span><button data-tool-source="web" class="${source==='web'?'active':''}" aria-pressed="${source==='web'}">网页收藏 <b>${webCount}</b></button><button data-tool-source="bookmarks" class="${source==='bookmarks'?'active':''}" aria-pressed="${source==='bookmarks'}">书签库 <b>${bookmarkCount}</b></button></div><p class="tool-source-note">${view==='trash'?'只恢复或清空当前来源的内容。':view==='duplicates'?'只比较同一来源中完全一致的网址；同时保存为网页卡片和书签库链接不算重复。':source==='web'?'使用卡片的标题、已有摘要与备注，整理自己的阅读收藏。':'管理书签库中的链接与文件夹，变动会同步到浏览器。'}</p>`;
}
export function renderWebOrganizer(data,report){
  const items=data.items.filter(item=>item.deletedAt==null),unread=items.filter(item=>item.readAt==null).length,missing=items.filter(item=>!cleanPreview(item.preview).summary).length;
  return `<div class="library-organizer"><div class="organize-intro"><div class="eyebrow">A LITTLE MORE ORDER</div><h2>让保存的网页，重新被读到</h2><p>按主题找到相关内容，再批量标记阅读状态、加星或移入回收站。</p><div class="library-actions"><button class="button primary" data-action="sharedSummarize">生成网页摘要</button><button class="button secondary" data-view="duplicates">检查重复</button></div></div><div class="library-review-grid"><button data-action="webReview" data-id="missing"><span>还没有摘要</span><strong>${missing}</strong><small>检查标题、补充内容 →</small></button><button data-action="webReview" data-id="read"><span>已经读过</span><strong>${items.length-unread}</strong><small>回顾、加星或收整 →</small></button></div><section class="analysis-card"><div class="analysis-card-heading"><div><h2>按主题整理</h2><p>根据已有内容自动识别主题，点击后可批量操作。</p></div><button class="text-button" data-action="topicRules">调整主题词 →</button></div><div class="library-topic-grid">${report.topics.map(topic=>`<button data-analysis-type="topic" data-analysis-key="${e(topic.id)}" data-analysis-label="${e(topic.name)}"><span>${e(topic.name)}</span><b>${topic.count}</b><small>查看相关网页 →</small></button>`).join('')||'<p class="analysis-empty">保存网页后，这里会出现可整理的内容。</p>'}</div></section></div>`;
}
export function renderBackupCenter(){
  return `<div class="library-backups"><section class="analysis-card"><h2>网页收藏</h2><p>保存卡片、摘要、封面、备注、日期与阅读状态。</p><div class="library-actions"><button class="button primary" data-action="webExport">导出网页收藏</button><button class="button secondary" data-action="sharedWebImport">导入卡片备份</button></div><small>JSON 格式 · 还原到书签小屋</small></section><section class="analysis-card"><h2>书签库</h2><p>保留书签网址和文件夹层级，可通过 Chrome 导入。</p><div class="library-actions"><button class="button primary" data-action="backup">导出 书签库</button><button class="button secondary" data-action="exportBefore">导出操作前备份</button></div><small>HTML 格式 · 包含可恢复的书签记录</small></section></div>`;
}
