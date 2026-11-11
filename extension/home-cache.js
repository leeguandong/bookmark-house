import {localDay} from './collection-list.js';
export const HOME_CACHE_KEY='webHomeSnapshotV1',HOME_CACHE_LAYOUT_KEY='webHomeSnapshotLayoutV1';
const LIMIT=24,MAX_CHARS=160000;
const recent=(a,b)=>b.savedAt-a.savedAt||a.id.localeCompare(b.id);
const validItem=item=>item&&typeof item.id==='string'&&typeof item.url==='string'&&/^https?:\/\//.test(item.url)&&Number.isFinite(item.savedAt)&&item.savedAt>=0&&item.savedAt<=253402300799999;

// A derived first page, committed in the same transaction as the collection.
// Covers remain separate; the cache never becomes a source for writes or exports.
export function buildHomeCache(data){
  const items=[],months=new Set(),counts={all:0,unread:0,starred:0,read:0,deleted:0};
  for(const item of data.items){
    if(!validItem(item))return null;
    if(item.deletedAt!=null){counts.deleted++;continue;}
    counts.all++;counts[item.readAt==null?'unread':'read']++;if(item.starred)counts.starred++;
    months.add(localDay(item.savedAt).slice(0,7));
    if(items.length<LIMIT||recent(item,items.at(-1))<0){items.push(item);items.sort(recent);if(items.length>LIMIT)items.pop();}
  }
  const snapshot={version:1,revision:data.revision,token:data.cacheToken,items,summary:{counts,months:[...months].sort().reverse()},cachedAt:Date.now(),timezone:new Date().getTimezoneOffset()};
  let size=JSON.stringify(snapshot).length;
  while(size>MAX_CHARS&&items.length){items.pop();size=JSON.stringify(snapshot).length;}
  return items.length||!counts.all?snapshot:null;
}
export function validHomeCache(value){
  try{return Boolean(value?.version===1&&typeof value.token==='string'&&Number.isInteger(value.revision)&&value.revision>=0&&Array.isArray(value.items)&&value.items.length<=LIMIT&&value.items.every(item=>validItem(item)&&['http:','https:'].includes(new URL(item.url).protocol)&&item.deletedAt==null)&&value.summary?.counts?.all>=value.items.length&&['all','unread','starred','read','deleted'].every(key=>Number.isInteger(value.summary.counts[key])&&value.summary.counts[key]>=0)&&Array.isArray(value.summary.months)&&value.summary.months.every(month=>/^\d{4}-\d{2}$/.test(month))&&value.timezone===new Date().getTimezoneOffset()&&JSON.stringify(value).length<=MAX_CHARS);}catch{return false;}
}
let handoff=null;
let previewReady=Promise.resolve();
export function prepareHomePreview(job){previewReady=job;}
export function waitForHomePreview(){return previewReady;}
export function rememberHomePreview(panel,snapshot){handoff={panel,snapshot};}
export function takeHomePreview(panel){const result=handoff?.panel===panel?handoff.snapshot:null;handoff=null;return result;}
export function releaseHomeControls(panel){
  panel.removeAttribute('aria-busy');
  for(const control of panel.querySelectorAll('[data-home-pending]')){control.disabled=false;control.removeAttribute('data-home-pending');}
}
