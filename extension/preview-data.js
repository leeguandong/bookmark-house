import {summarizePage} from './page-summary.js';
const text=(value,max=500)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,max);
export function cleanPreview(raw={}){
  if(!raw||typeof raw!=='object')raw={};
  const cover=String(raw.cover||'');
  const description=text(raw.description,1200),summary=raw.descriptionEdited?description:text(raw.summary,420)||summarizePage({...raw,description});
  return {description,summary,summaryVersion:summary?2:0,extractorVersion:raw.extractorVersion===3?3:0,siteName:text(raw.siteName,100),author:text(raw.author,150),publishedAt:text(raw.publishedAt,60),kind:raw.kind==='excerpt'?'excerpt':'description',cover:/^data:image\/(?:jpeg|png|webp);base64,[a-z\d+/]+=*$/i.test(cover)&&cover.length<=120000?cover:'',capturedAt:Number.isFinite(raw.capturedAt)&&raw.capturedAt>=0&&raw.capturedAt<=253402300799999?raw.capturedAt:null,descriptionEdited:Boolean(raw.descriptionEdited)};
}

