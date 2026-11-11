import {t as uiText} from './i18n.js';
export {localDay,collectionItems,groupByDay} from './collection-list.js';
import {webUrl} from './web-address.js';
export {webUrl,currentWebPage} from './web-address.js';
import {cleanPreview} from './page-preview.js';
import {isPlaceholderTitle,isXhsSiteDescription} from './page-identity.js';
import {COLLECTION_LAYOUT_KEY,separateCollection,hydrateCollection,collectionLinks} from './collection-storage.js';
import {HOME_CACHE_LAYOUT_KEY} from './home-cache.js';
export const WEB_COLLECTION_KEY='webCollectionV1';
const MAX_ITEMS=20000,MAX_LINKS=50;
const copy=value=>structuredClone(value);
const sourceId=crypto.randomUUID();

const titleFor=(value,url)=>String(value||'').trim().replace(/\s+/g,' ').slice(0,500)||new URL(url).hostname.replace(/^www\./,'');
const noteFor=value=>String(value||'').trim().slice(0,2000);
const validTime=value=>Number.isFinite(value)&&value>=0&&value<=253402300799999;
function mergePreview(oldPreview,newPreview){
  const old=cleanPreview(oldPreview),next=cleanPreview(newPreview),merged={...old};
  if(oldPreview?.coverRef)merged.coverRef=oldPreview.coverRef;
  if(next.extractorVersion===3&&next.siteName==='小红书'&&!old.descriptionEdited){
    if(isXhsSiteDescription(merged.description))merged.description='';
    if(isXhsSiteDescription(merged.summary)){merged.summary='';merged.summaryVersion=0;}
  }
  for(const key of ['siteName','author','publishedAt','cover','capturedAt'])if(next[key])merged[key]=next[key];
  if(next.extractorVersion&&(next.summary||!merged.summary))merged.extractorVersion=next.extractorVersion;
  if(next.description&&!old.descriptionEdited){merged.description=next.description;merged.kind=next.kind;merged.descriptionEdited=next.descriptionEdited;}
  if(next.summary&&!old.descriptionEdited){merged.summary=next.summary;merged.summaryVersion=next.summaryVersion;}
  return merged;
}
function stateFor(raw){
  if(!raw)return {version:1,revision:0,items:[],purgeBackup:null};
  if(raw.version!==1||!Array.isArray(raw.items))throw new Error(uiText("网页收藏数据格式暂不支持，请先导出备份。"));
  return copy(raw);
}
function cleanItem(item,now,idFactory){
  if(!item||typeof item!=='object')throw new Error(uiText("备份中包含无效的网页卡片。"));
  const url=webUrl(item.url),savedAt=item.savedAt??now;
  if(!validTime(savedAt)||item.createdAt!==undefined&&!validTime(item.createdAt)||item.updatedAt!==undefined&&!validTime(item.updatedAt)||item.deletedAt!=null&&!validTime(item.deletedAt)||item.readAt!=null&&!validTime(item.readAt))throw new Error(uiText("网页收藏的日期格式不正确。"));
  return {id:idFactory(),url,title:titleFor(item.title,url),titleEdited:Boolean(item.titleEdited),note:noteFor(item.note),preview:cleanPreview(item.preview),savedAt,createdAt:item.createdAt??savedAt,updatedAt:item.updatedAt??now,readAt:item.readAt??null,starred:Boolean(item.starred),deletedAt:item.deletedAt??null};
}

export class WebCollection {
  constructor(store,{now=()=>Date.now(),id=()=>crypto.randomUUID()}={}){this.store=store;this.now=now;this.id=id;this.sourceId=sourceId;this.split=Boolean(store.getMany&&store.getLinked&&store.update);}
  async prepare(){
    if(!this.split)return;
    if(!this.preparing)this.preparing=(async()=>{
      const layouts=await this.store.getMany([COLLECTION_LAYOUT_KEY,HOME_CACHE_LAYOUT_KEY]);
      if(layouts.get(COLLECTION_LAYOUT_KEY)===2&&layouts.get(HOME_CACHE_LAYOUT_KEY)===1)return;
      await this.store.update(WEB_COLLECTION_KEY,(raw,records)=>separateCollection(stateFor(raw),records,raw||{items:[]}));
    })().catch(error=>{this.preparing=null;throw error;});
    return this.preparing;
  }
  async read({light=false}={}){
    await this.prepare();
    if(this.split&&!light){
      const values=await this.store.getLinked(WEB_COLLECTION_KEY,collectionLinks);
      return hydrateCollection(stateFor(values.get(WEB_COLLECTION_KEY)),values);
    }
    return stateFor(await this.store.get(WEB_COLLECTION_KEY));
  }
  async covers(refs){return this.split?this.store.getMany(refs):new Map();}
  async change(fn){
    await this.prepare();let result,revision;
    const transform=(raw,records)=>{const data=stateFor(raw);result=copy(fn(data));revision=++data.revision;return this.split?separateCollection(data,records,raw||{items:[]}):data;};
    if(this.store.update)await this.store.update(WEB_COLLECTION_KEY,transform);
    else {
      const execute=async()=>{const data=transform(await this.store.get(WEB_COLLECTION_KEY));await this.store.set(WEB_COLLECTION_KEY,data);};
      if(globalThis.navigator?.locks)await navigator.locks.request('bookmark-house-web-collection',execute);else await execute();
    }
    // Storage is committed before another view is notified or success is shown.
    if(typeof BroadcastChannel!=='undefined'){const channel=new BroadcastChannel('bookmark-house-web-collection');channel.postMessage({changed:true,source:this.sourceId,revision});channel.close();}
    return copy(result);
  }
  async add(links){
    if(!Array.isArray(links)||!links.length||links.length>MAX_LINKS)throw new Error(uiText("每次可以保存 1–50 个网页链接。"));
    const prepared=links.map(link=>{const url=webUrl(link?.url);return {url,title:link?.title,titleEdited:Boolean(link?.titleEdited),note:link?.note,preview:cleanPreview(link?.preview)};});
    return this.change(data=>{
      const result={added:0,existing:0,restored:0,ids:[]},seen=new Set(),now=this.now();
      for(const link of prepared){
        if(seen.has(link.url))continue;seen.add(link.url);
        const existing=data.items.find(item=>item.url===link.url);
        if(existing){
          if(existing.deletedAt!=null){existing.deletedAt=null;existing.savedAt=now;existing.updatedAt=now;existing.readAt=null;result.restored++;}
          else result.existing++;
          if(link.title&&!existing.titleEdited&&isPlaceholderTitle(existing.title,existing.url)&&!isPlaceholderTitle(link.title,link.url)){existing.title=titleFor(link.title,link.url);existing.updatedAt=now;}
          existing.preview=mergePreview(existing.preview,link.preview);existing.updatedAt=now;
          result.ids.push(existing.id);continue;
        }
        if(data.items.length>=MAX_ITEMS)throw new Error(uiText("收藏数量已达 20000 条，请先导出并清理不需要的内容。"));
        const item=cleanItem({...link,savedAt:now},now,this.id);data.items.push(item);result.added++;result.ids.push(item.id);
      }
      return result;
    });
  }
  async saveCapture(link,{note}={}){
    const url=webUrl(link?.url),preview=cleanPreview(link?.preview);
    // Resolve duplicates, merge captured content and update an explicitly edited
    // note in one fresh transaction. A popup never writes from its stale lookup.
    return this.change(data=>{
      const now=this.now();let item=data.items.find(row=>row.url===url);
      const result={added:0,existing:0,restored:0,ids:[]};
      if(item){
        if(item.deletedAt!=null){item.deletedAt=null;item.savedAt=now;item.readAt=null;result.restored=1;}else result.existing=1;
        if(link.title&&!item.titleEdited&&isPlaceholderTitle(item.title,url)&&!isPlaceholderTitle(link.title,url))item.title=titleFor(link.title,url);
        item.preview=mergePreview(item.preview,preview);if(note!==undefined)item.note=noteFor(note);item.updatedAt=now;
      }else{
        if(data.items.length>=MAX_ITEMS)throw new Error(uiText("收藏数量已达 20000 条，请先导出并清理不需要的内容。"));
        item=cleanItem({...link,url,preview,note:note??'',savedAt:now},now,this.id);data.items.push(item);result.added=1;
      }
      result.ids.push(item.id);result.item=item;return result;
    });
  }
  async edit(id,changes){
    const url=webUrl(changes.url),title=titleFor(changes.title,url),note=noteFor(changes.note);
    return this.change(data=>{const item=data.items.find(n=>n.id===id&&n.deletedAt==null);if(!item)throw new Error(uiText("网页卡片已变化，请刷新后再试。"));
      if(data.items.some(n=>n.id!==id&&n.url===url))throw new Error(uiText("这个网址已在网页收藏中，请先检查现有卡片。"));
      const preview=url===item.url?cleanPreview(item.preview):cleanPreview();
      if(url===item.url&&item.preview?.coverRef)preview.coverRef=item.preview.coverRef;
      if(changes.description!==undefined){preview.description=String(changes.description||'').trim().slice(0,1200);preview.descriptionEdited=true;preview.summary=preview.description;preview.summaryVersion=2;}
      if(changes.removeCover){preview.cover='';delete preview.coverRef;}
      const titleEdited=Boolean(item.titleEdited)||title!==item.title;
      Object.assign(item,{url,title,titleEdited,note,preview,updatedAt:this.now()});return item;
    });
  }
  async enrich(id,url,details){
    const preview=cleanPreview(details);
    return this.change(data=>{const item=data.items.find(n=>n.id===id&&n.deletedAt==null&&n.url===url);if(!item)throw new Error(uiText("卡片已被修改或移除，未覆盖现有内容。"));
      if(details.title&&!item.titleEdited&&isPlaceholderTitle(item.title,url)&&!isPlaceholderTitle(details.title,url))item.title=titleFor(details.title,url);
      item.preview=mergePreview(item.preview,preview);item.updatedAt=this.now();return item;
    });
  }
  async toggle(id,field){
    if(!['starred','readAt'].includes(field))throw new Error(uiText("操作不支持。"));
    return this.change(data=>{const item=data.items.find(n=>n.id===id&&n.deletedAt==null);if(!item)throw new Error(uiText("网页卡片已变化，请刷新后再试。"));item[field]=field==='starred'?!item.starred:item.readAt==null?this.now():null;item.updatedAt=this.now();return item;});
  }
  async remove(id){return this.change(data=>{const item=data.items.find(n=>n.id===id&&n.deletedAt==null);if(!item)throw new Error(uiText("网页卡片已变化，请刷新后再试。"));item.deletedAt=this.now();item.updatedAt=this.now();return item;});}
  async updateMany(ids,operation){
    if(!Array.isArray(ids)||!ids.length||ids.length>MAX_ITEMS||!['delete','restore','read','unread','star','unstar'].includes(operation))throw new Error(uiText("请选择网页和有效的批量操作。"));
    const selected=new Set(ids);
    return this.change(data=>{
      const items=data.items.filter(item=>selected.has(item.id));
      if(items.length!==selected.size||items.some(item=>(item.deletedAt!=null)!==(operation==='restore')))throw new Error(uiText("所选网页已变化，请重新选择后再操作。"));
      const now=this.now();
      for(const item of items){
        if(operation==='delete')item.deletedAt=now;
        if(operation==='restore')item.deletedAt=null;
        if(operation==='read'||operation==='unread')item.readAt=operation==='read'?(item.readAt??now):null;
        if(operation==='star'||operation==='unstar')item.starred=operation==='star';
        item.updatedAt=now;
      }
      return items.length;
    });
  }
  async restore(id){return this.change(data=>{const item=data.items.find(n=>n.id===id&&n.deletedAt!=null);if(!item)throw new Error(uiText("这张卡片已不在已删除列表中。"));item.deletedAt=null;item.updatedAt=this.now();return item;});}
  async purgeDeleted(revision){return this.change(data=>{
    if(data.revision!==revision)throw new Error(uiText("网页收藏已变化，请重新核对后再清空。"));
    const removed=data.items.filter(n=>n.deletedAt!=null);if(!removed.length)return 0;
    data.purgeBackup={date:this.now(),items:copy(removed)};data.items=data.items.filter(n=>n.deletedAt==null);return removed.length;
  });}
  async importBackup(raw){
    if(!raw||raw.type!=='bookmark-house-web-collection'||raw.version!==1||!Array.isArray(raw.items)||raw.items.length>MAX_ITEMS)throw new Error(uiText("请选择书签小屋导出的网页收藏 JSON 备份。"));
    const now=this.now(),items=raw.items.map(item=>cleanItem(item,now,this.id));
    return this.change(data=>{const urls=new Set(data.items.map(n=>n.url));let added=0,skipped=0;for(const item of items){if(urls.has(item.url)){skipped++;continue;}if(data.items.length>=MAX_ITEMS)throw new Error(uiText("导入后将超过 20000 条收藏，已停止导入。"));urls.add(item.url);data.items.push(item);added++;}return {added,skipped};});
  }
}

export function collectionBackup(data,now=Date.now()){return {type:'bookmark-house-web-collection',version:1,exportedAt:now,items:copy(data.items)};}

function decodeText(value){return String(value).replace(/<[^>]*>/g,' ').replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi,(_,entity)=>{if(entity[0]==='#'){const number=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):parseInt(entity.slice(1),10);return number>0&&number<=0x10ffff?String.fromCodePoint(number):'';}return {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '}[entity.toLowerCase()];}).replace(/\s+/g,' ').trim();}
const SHARE_URL=/https?:\/\/[^\s<>"'“”‘’《》【】「」『』，。；！？、（）]+/gi;
function shareTitle(value){return String(value||'').replace(/^\s*(?:(?:\[链接\]|【链接】)\s*|(?:网页|文章|标题|链接|分享|网址|地址)\s*[:：]\s*)+/,'').replace(/^[\s:：,，;；()（）\[\]<>《》"'“”]+|[\s:：,，;；()（）\[\]<>《》"'“”]+$/g,'').trim().slice(0,500);}
function sharedLinks(text){
  if(/(?:^|\s)(?:javascript|vbscript|data|file|chrome|about|weixin|wxwork|ftp):/i.test(text))throw new Error(uiText("分享内容中含有不支持的地址，请仅保留网页链接。"));
  const lines=text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean),matches=[...text.matchAll(SHARE_URL)],links=[];
  if(!matches.length||matches.length>MAX_LINKS)throw new Error(uiText("请复制或拖入完整的网页链接，每次最多 50 条。"));
  for(let i=0;i<lines.length;i++){
    const found=[...lines[i].matchAll(SHARE_URL)];
    for(const match of found){
      let raw=match[0];
      for(const [open,close]of [['(',')'],['[',']']])while(raw.endsWith(close)&&raw.split(close).length>raw.split(open).length)raw=raw.slice(0,-1);
      if(lines[i]!==match[0])raw=raw.replace(/[.,;!:]+$/,'');
      const url=webUrl(raw);let title='';
      if(found.length===1){
        title=shareTitle(lines[i].replace(match[0],''));
        if(!title&&i>0&&!/https?:\/\//i.test(lines[i-1]))title=shareTitle(lines[i-1]);
        if(!title&&matches.length===1&&i+1<lines.length&&!/https?:\/\//i.test(lines[i+1]))title=shareTitle(lines[i+1]);
      }
      links.push({url,title});
    }
  }
  return links;
}
export function parseWebDrop({uriList='',plainText='',html='',mozUrl=''}={}){
  if([uriList,plainText,mozUrl].some(value=>value.length>100000)||html.length>256000)throw new Error(uiText("拖入的内容太长，请改为粘贴网页链接。"));
  const titles=new Map(),htmlLinks=[];
  // Inspect only anchor strings. Never insert or load dropped HTML/resources.
  for(const match of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi)){
    try{const url=webUrl(decodeText(match[1]??match[2]??match[3]));titles.set(url,decodeText(match[4]));htmlLinks.push(url);}catch{}
  }
  const moz=mozUrl.split(/\r?\n/);if(moz[0])try{titles.set(webUrl(moz[0]),moz[1]||'');}catch{}
  let plain=[];if(plainText.trim()){
    if(uriList||moz[0]){try{plain=sharedLinks(plainText);}catch{}}
    else {try{plain=sharedLinks(plainText);}catch(error){if(!htmlLinks.length)throw error;}}
  }
  for(const item of plain)if(item.title&&!titles.has(item.url))titles.set(item.url,item.title);
  const raw=uriList||moz[0],lines=raw?raw.split(/\r?\n/).map(s=>s.trim()).filter(s=>s&&!s.startsWith('#')):plain.length?plain.map(item=>item.url):htmlLinks;
  if(!lines.length||lines.length>MAX_LINKS)throw new Error(uiText("请拖入网页链接，每次最多 50 条。"));
  if(lines.length===1&&plainText.trim()&&!/https?:\/\//i.test(plainText)&&!titles.has(webUrl(lines[0])))titles.set(webUrl(lines[0]),shareTitle(plainText));
  const result=[],seen=new Set();for(const line of lines){const url=webUrl(line);if(seen.has(url))continue;seen.add(url);result.push({url,title:titles.get(url)||''});}
  return result;
}

export function demoWebCollection(now=Date.now()){
  const rows=[[uiText("MDN Web Docs · 把 Web 的基础读扎实"),'https://developer.mozilla.org/zh-CN/',uiText("想把有用的页面留在这里，慢慢读。"),0,true],[uiText("Figma · 今天发现的一点设计灵感"),'https://www.figma.com/',uiText("界面和交互灵感，留给下一次创作。"),0,false],[uiText("Hugging Face · 模型与数据集"),'https://huggingface.co/',uiText("下次做实验时回来看看。"),1,true],[uiText("GitHub · 从好项目里找到新想法"),'https://github.com/',uiText("记录有意思的开源项目。"),1,false],[uiText("维基百科 · 给好奇心留个入口"),'https://zh.wikipedia.org/',uiText("一个可以继续延伸的阅读起点。"),3,false]];
  const previews=[
    {siteName:'MDN Web Docs',description:uiText("从 HTML 的语义结构，到 CSS 布局与 JavaScript 交互。把常用的开发参考留在手边，遇到问题时随时回来查阅。")},
    {siteName:'Figma',description:uiText("把灵感变成可以讨论的设计。从界面草图、组件系统到交互原型，在同一个空间里逐步完善产品体验。")},
    {siteName:'Hugging Face',description:uiText("探索开源模型、数据集和社区应用。比较模型的用途与运行方式，为下一次实验找到合适的起点。")},
    {siteName:'GitHub',description:uiText("值得研究的项目，值得记录的实现。阅读源码与项目文档，把有用的想法带回自己的工作。")},
    {siteName:uiText("维基百科"),description:uiText("从一个词条开始，沿着参考资料与相关主题继续阅读。把偶然的好奇，变成更完整的知识脉络。")}
  ];
  return {version:1,revision:0,purgeBackup:null,items:rows.map(([title,url,note,days,starred],i)=>{const date=new Date(now);date.setDate(date.getDate()-(i===2?0:days));date.setHours(14-i,20+i,0,0);return {id:`demo-web-${i}`,title,url,note:i===1?note:'',preview:cleanPreview(previews[i]),starred,savedAt:date.getTime(),createdAt:date.getTime(),updatedAt:date.getTime(),readAt:i===3?date.getTime():null,deletedAt:null};})};
}
