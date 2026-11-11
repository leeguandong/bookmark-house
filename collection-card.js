import {escapeHtml as e} from './display-utils.js';
import {cleanPreview} from './preview-data.js';
import {cardTitle,xhsNoteId,isXhsSiteDescription} from './page-identity.js';

const icon=name=>`<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;

// One presentation model for web saves and native bookmarks. It contains only
// existing metadata; image bytes are loaded separately from the local cache.
export function collectionCardData(item){
  let domain='网址';try{const url=new URL(item.url);domain=url.hostname.replace(/^www\./,'')||url.protocol;}catch{}
  const title=cardTitle(item),preview=cleanPreview(item.preview);
  const coverRef=/^webCover:[a-z\d-]+$/i.test(item.preview?.coverRef||'')?item.preview.coverRef:'';
  if(xhsNoteId(item.url)){preview.siteName='小红书';if(!preview.descriptionEdited&&isXhsSiteDescription(preview.summary))preview.summary='';}
  return {title,preview,coverRef,hasCover:Boolean(preview.cover||coverRef),domain,
    letter:domain[0]?.toUpperCase()||'W',tone:[...domain].reduce((total,char)=>total+char.charCodeAt(0),0)%5};
}

export function renderCollectionCover({title,preview,coverRef,hasCover},href,bookmarkId){
  // Never make a remote image request or turn a retained script URL into a link.
  if(!hasCover||!/^https?:\/\//i.test(href||''))return '';
  const drag=bookmarkId===undefined?'':bookmarkId?` draggable="true" data-drag-bookmark="${e(bookmarkId)}"`:' draggable="false"';
  return `<a class="web-card-cover" href="${e(href)}" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-label="打开 ${e(title)}"${drag}><img ${preview.cover?`src="${e(preview.cover)}"`:''} ${coverRef?`data-cover-ref="${e(coverRef)}"`:''} alt="${e(title)}的本地预览" loading="lazy" decoding="async"></a>`;
}

export function renderCollectionCopy({preview},note=''){
  return `${preview.summary?`<div class="web-card-summary"><span class="web-content-label ${preview.descriptionEdited?'':'sr-only'}">${preview.descriptionEdited?'我的摘要':'内容摘要'}</span><p>${e(preview.summary)}</p></div>`:''}
      ${preview.author||preview.publishedAt?`<p class="web-byline">${[preview.author,preview.publishedAt.match(/^\d{4}-\d{2}-\d{2}/)?.[0]].filter(Boolean).map(e).join(' · ')}</p>`:''}
      ${note?`<div class="web-card-note"><span class="web-content-label">${icon('note')}我的想法</span><p>${e(note)}</p></div>`:''}`;
}

export function removeFailedCover(image){
  if(!image?.matches?.('.web-card-cover img'))return;
  image.closest('.web-card')?.classList.remove('has-cover');image.closest('.web-card-cover')?.remove();
}
