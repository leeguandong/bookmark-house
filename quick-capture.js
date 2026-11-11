import {webUrl} from './web-address.js';
import {readDocumentPreview,cleanPreview,thumbnail} from './page-preview.js';
import {readSavedPage} from './auto-preview.js';

export async function capturePageDetails(tab,{api=globalThis.chrome,snapshot=false,timeoutMs=1800}={}){
  const base=contextCapture({},tab);let details={},cover='';
  const deadline=Date.now()+Math.max(0,timeoutMs);let timedOut=false;
  const optional=async operation=>{
    const remaining=deadline-Date.now();if(remaining<=0){timedOut=true;return;}
    let timer;
    try{return await Promise.race([Promise.resolve().then(operation).catch(()=>undefined),new Promise(resolve=>{timer=setTimeout(()=>{timedOut=true;resolve();},remaining);})]);}
    finally{clearTimeout(timer);}
  };
  if(api?.scripting?.executeScript&&Number.isInteger(tab.id)){
    try{const results=await optional(()=>api.scripting.executeScript({target:{tabId:tab.id},func:readDocumentPreview,injectImmediately:true}));const page=results?.find(result=>result.frameId===0||result.frameId===undefined)?.result;if(page&&webUrl(page.url)===base.url)details=page;}catch{}
  }
  if(snapshot&&!details.cover&&api?.tabs?.captureVisibleTab&&Number.isInteger(tab.windowId)){
    try{
      const matches=async()=>{const [active]=await api.tabs.query({active:true,windowId:tab.windowId});return active?.id===tab.id&&active.url===base.url;};
      if(await optional(matches)){
        const data=await optional(()=>api.tabs.captureVisibleTab(tab.windowId,{format:'jpeg',quality:45}));
        if(data&&await optional(matches)){
          const binary=atob(data.split(',')[1]),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));cover=await optional(()=>thumbnail(new Blob([bytes],{type:'image/jpeg'})))||'';
        }
      }
    }catch{}
  }
  return {...base,title:details.title||base.title,preview:cleanPreview({...details,cover:details.cover||cover,capturedAt:Date.now()}),...(timedOut?{contentTimedOut:true}:{})};
}

export function contextCapture(info={},tab={}){
  const url=webUrl(info.linkUrl||info.pageUrl||tab.url);
  // A containing page's title is not the destination title of a clicked link.
  const title=info.linkUrl?(info.selectionText?.trim()||new URL(url).hostname.replace(/^www\./,'')):(tab.title||new URL(url).hostname);
  return {url,title};
}
export async function captureActivePage(repository,tabs){
  const [tab]=await tabs.query({active:true,currentWindow:true});
  if(!tab?.url)throw new Error('当前页面无法直接收藏，请在普通网页中使用。');
  const details=await capturePageDetails(tab),result=await repository.add([details]);
  return {tabId:tab.id,result};
}
export async function captureContextLink(repository,info,tab){
  const details=info.linkUrl?contextCapture(info,tab):await capturePageDetails({...tab,url:info.pageUrl||tab?.url});
  if(info.linkUrl)try{const preview=await readSavedPage(details.url);if(preview){details.preview=preview;if(!info.selectionText)details.title=preview.title||details.title;}}catch{}
  const result=await repository.add([details]);
  return {tabId:tab?.id,result};
}
export function captureMessage(result){return result.added?'已保存到网页收藏':result.restored?'已恢复到网页收藏':'这个网页已经收藏';}
