import {cleanPreview,readDocumentPreview,loadPagePreview} from './page-preview.js';
import {sameSavedPage,xhsNoteId,isPlaceholderTitle} from './page-identity.js';
const pattern=url=>{const u=new URL(url);return `${u.protocol}//${u.hostname}/*`;};
const ATTEMPTS_KEY='webPreviewAttemptsV1',RETRY_DELAY=30*60*1000;
export async function readSavedPage(url,api=globalThis.chrome){
  if(!api?.permissions||!await api.permissions.contains({origins:[pattern(url)]}))return null;
  // A rendered, already-open page also works for dynamic or signed-in articles.
  if(api.tabs?.query&&api.scripting?.executeScript){
    try{
      const tabs=await api.tabs.query({url:[pattern(url)]}),target=tabs.find(tab=>sameSavedPage(tab.url,url));
      if(target){const results=await api.scripting.executeScript({target:{tabId:target.id},func:readDocumentPreview});const page=results.find(row=>row.frameId===0||row.frameId===undefined)?.result;
        if(page&&sameSavedPage(page.url,url)){const preview=cleanPreview({...page,capturedAt:Date.now()}),title=!isPlaceholderTitle(page.title,url)?page.title:!isPlaceholderTitle(target.title,url)?target.title:'';if(preview.summary||preview.cover||title)return {title,...preview};}
      }
    }catch{}
  }
  return loadPagePreview(url,{permissions:api.permissions});
}

export class AutoPreview {
  constructor(repository,onChange,{read=readSavedPage,now=()=>Date.now()}={}){this.repository=repository;this.onChange=onChange;this.read=read;this.now=now;this.pending=[];this.attempted=new Set();this.inFlight=new Set();this.queued=new Set();this.running=false;this.retryState={};}
  async enqueue(items,{force=false}={}){
    this.ready??=Promise.resolve(this.repository.store?.get(ATTEMPTS_KEY)).then(value=>{this.retryState=value||{};}).catch(()=>{});
    await this.ready;
    const added=[];
    for(const item of items){
      const key=item.id+'\n'+item.url;
      if(this.inFlight.has(key)||this.queued.has(key))continue;
      const needsNoteUpgrade=xhsNoteId(item.url)&&item.preview?.extractorVersion!==3;
      if(item.deletedAt!=null||!force&&(this.attempted.has(key)||this.retryState[key]?.retryAt>this.now()||item.preview?.descriptionEdited||!needsNoteUpgrade&&item.preview?.summaryVersion===2&&item.preview?.summary&&!isPlaceholderTitle(item.title,item.url)))continue;
      if(force)this.attempted.delete(key);
      if(this.attempted.has(key))continue;this.attempted.add(key);this.queued.add(key);this.pending.push({id:item.id,url:item.url});added.push(item.id);
    }
    if(!this.running)this.job=this.drain();return this.job||Promise.resolve();
  }
  async drain(){
    this.running=true;
    try{while(this.pending.length){const batch=this.pending.splice(0,2),outcomes={};let changed=false;await Promise.allSettled(batch.map(async item=>{
      const key=item.id+'\n'+item.url;this.queued.delete(key);this.inFlight.add(key);
      try{const details=await this.read(item.url);if(!details||!details.summary&&!details.description&&!details.cover&&isPlaceholderTitle(details.title,item.url))return;
        await this.repository.enrich(item.id,item.url,details);changed=true;
      }finally{
        this.inFlight.delete(key);
        outcomes[key]={retryAt:this.now()+RETRY_DELAY};
      }
    }));
      Object.assign(this.retryState,outcomes);
      const store=this.repository.store;
      if(store)try{
        const merge=raw=>Object.fromEntries(Object.entries({...raw,...outcomes}).filter(([,value])=>value.retryAt>this.now()).sort((a,b)=>b[1].retryAt-a[1].retryAt).slice(0,2000));
        if(store.update)await store.update(ATTEMPTS_KEY,merge);else await store.set(ATTEMPTS_KEY,merge(await store.get(ATTEMPTS_KEY)));
      }catch{} // A retry hint must never prevent saving or displaying a card.
      if(changed)await this.onChange();
    }}finally{this.running=false;}
  }
}
