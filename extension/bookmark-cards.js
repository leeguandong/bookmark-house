import {t as uiText,html as uiHtml,locale as uiLocale} from './i18n.js';
import {escapeHtml as e,normalizedUrl} from './display-utils.js';
import {safeOpenUrl} from './core.js';
import {xhsNoteId,isPlaceholderTitle} from './page-identity.js';
import {collectionCardData,renderCollectionCover,renderCollectionCopy} from './collection-card.js';

const icon=name=>`<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const dateFormat=new Intl.DateTimeFormat(uiLocale(),{year:'numeric',month:'2-digit',day:'2-digit'});
const text=value=>String(value||'').trim();

export function bookmarkPreviewKey(url){
  const noteId=xhsNoteId(url);
  // Only recognized note routes may ignore tracking parameters. Different
  // notes, sites and ordinary query URLs keep their own preview content.
  return noteId?`xhs:${new URL(url).origin}:${noteId}`:normalizedUrl(url);
}
export function bookmarkPreviewIndex(items=[]){
  const index=new Map();
  for(const item of items){
    if(item.deletedAt!=null)continue;
    const key=bookmarkPreviewKey(item.url),previous=index.get(key);
    if(!previous||(item.updatedAt||0)>(previous.updatedAt||0))index.set(key,item);
  }
  return index;
}

export function renderBookmarkCard(item,{selected=false,note={},sharedItem,category='',duplicateLabel='',folderPath='',contents=null}={}){
  const isFolder=item.url===undefined,shared=isFolder?{}:sharedItem||{};
  let title=item.title||(isFolder?uiText("未命名文件夹"):uiText("未命名书签"));
  if(!isFolder&&isPlaceholderTitle(item.title,item.url)&&text(shared.title))title=shared.title;
  const preview={...shared.preview};
  if(text(note.text)){preview.description=note.text;preview.descriptionEdited=true;}
  const presentation=collectionCardData({url:item.url,title,preview,titleEdited:isFolder});title=presentation.title;
  const {domain,letter,tone}=presentation,canDrag=!isFolder&&!item.managed&&!item.inTrash,href=isFolder?'':safeOpenUrl(item.url);
  const displayNote=Object.hasOwn(note,'note')?text(note.note):text(shared.note),hasNote=Boolean(text(note.note)||text(note.text));
  const cover=isFolder?'':renderCollectionCover(presentation,href,canDrag?item.id:null);
  const badge=isFolder?uiText("文件夹"):item.managed?uiText("受管理"):duplicateLabel||category;
  const badgeClass=duplicateLabel===uiText("建议保留")?' is-keeper':duplicateLabel?' is-duplicate':'';
  const date=new Date(item.dateAdded),dateValid=Number.isFinite(item.dateAdded)&&!Number.isNaN(date.getTime());
  const dateHtml=dateValid?uiHtml`<time datetime="${e(date.toISOString())}" title="收藏于 ${e(dateFormat.format(date))}">${e(dateFormat.format(date))} 收藏</time>`:'';
  const titleHtml=isFolder?uiHtml`<button class="web-card-title bookmark-card-title" data-action="inspectTrashFolder" data-id="${e(item.id)}" aria-label="查看已删除文件夹 ${e(title)}">${e(title)}</button>`
    :href?`<a class="web-card-title bookmark-card-title" href="${e(href)}" target="_blank" rel="noopener noreferrer" draggable="${canDrag}" title="${e(title)}">${e(title)}</a>`
      :uiHtml`<span class="web-card-title bookmark-card-title" title="此协议仅保留，无法从此页面运行">${e(title)}</span>`;
  const action=(name,label,symbol,{disabled=false,classes=''}={})=>`<button class="icon-button ${classes}" data-action="${name}" data-id="${e(item.id)}" title="${e(label)}" aria-label="${e(label)} ${e(title)}" ${disabled?'disabled':''}>${icon(symbol)}</button>`;
  const actions=isFolder?action('restoreOne',uiText("还原文件夹"),'undo'):
    action('contentNote',uiText("正文与笔记"),'note',{classes:hasNote?'has-content':''})+
    (!item.inTrash?action('edit',uiText("编辑书签"),'edit',{disabled:item.managed}):'')+
    action(item.inTrash?'restoreOne':'moveOne',item.inTrash?uiText("还原书签"):uiText("移动书签"),item.inTrash?'undo':'arrow',{disabled:item.managed})+
    (!item.inTrash?action('archiveOne',uiText("删除书签"),'trash',{disabled:item.managed,classes:'delete-bookmark'}):'');
  const source=isFolder?uiText("已删除的文件夹"):presentation.preview.siteName||domain;
  return uiHtml`<article class="web-card bookmark-card tone-${tone}${selected?' selected is-selected':''}${isFolder?' bookmark-folder-card':''}${cover?' has-cover':''}" data-bookmark-card="${e(item.id)}" role="listitem" aria-label="${e(title)}">
    ${cover}
    <div class="web-card-body">
      <div class="web-card-top"><label class="web-select bookmark-card-select" title="选择${isFolder?uiText("文件夹"):uiText("书签")}"><input type="checkbox" data-select="${e(item.id)}" aria-label="选择${isFolder?uiText("文件夹 "): ' '}${e(title)}" ${selected?'checked':''} ${item.managed?'disabled':''}></label><span class="web-site-icon" aria-hidden="true">${isFolder?icon('folder'):e(letter)}</span><div class="web-source"><span class="web-site-name" title="${e(item.url||source)}">${e(source)}</span>${!isFolder&&source!==domain?`<span class="web-domain">${e(domain)}</span>`:''}</div></div>
      <div class="bookmark-card-content${canDrag?' can-drag':''}" ${canDrag?`draggable="true" data-drag-bookmark="${e(item.id)}"`:''}>
        <h3 class="bookmark-card-heading">${titleHtml}</h3>
        ${isFolder?uiHtml`<p class="bookmark-card-excerpt">${contents?.bookmarkCount||0} 条书签 · ${contents?.folderCount||0} 个子文件夹</p>`:renderCollectionCopy(presentation,displayNote)}
        ${!isFolder&&!presentation.preview.summary&&!displayNote?`<p class="bookmark-card-address" title="${e(item.url)}">${e(String(item.url).replace(/^https?:\/\//,''))}</p>`:''}
      </div>
      <div class="web-card-meta bookmark-card-details">${dateHtml}${badge?`<span class="bookmark-card-chip${badgeClass}">${e(badge)}</span>`:''}</div>
      <footer class="web-card-actions bookmark-card-footer"><span class="bookmark-card-folder" title="${e(folderPath||uiText("根目录"))}">${icon('folder')}<span>${e(folderPath||uiText("根目录"))}</span></span><div class="bookmark-card-actions">${actions}</div></footer>
    </div>
  </article>`;
}
