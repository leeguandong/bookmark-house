import {cleanPreview} from './preview-data.js';
export {cleanPreview} from './preview-data.js';
import {summarizePage} from './page-summary.js';
import {xhsNoteId,isPlaceholderTitle,isXhsSiteDescription} from './page-identity.js';
const text=(value,max=500)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,max);
// Serialized by Chrome and run in the main frame only. Keep this self-contained.
export function readDocumentPreview(){
  const compact=(value,max=1200)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,max);
  const meta=key=>document.querySelector(`meta[property="${key}"],meta[name="${key}"]`)?.content||'';
  // Xiaohongshu renders the active note in a div overlay beside an unrelated
  // recommendation feed. Read only that note, never the feed or comments.
  if(/(^|\.)xiaohongshu\.com$/i.test(location.hostname)&&/^\/(?:explore|discovery\/item)\/[a-f\d]{24}(?:\/|$)/i.test(location.pathname)){
    const note=document.querySelector('#noteContainer'),heading=note?.querySelector('#detail-title'),body=note?.querySelector('#detail-desc');
    const rawTitle=compact(heading?.innerText??heading?.textContent??document.title,500).replace(/\s*[-—–|]\s*小红书\s*$/,'');
    const title=/^(?:小红书(?:\s*[-—–·|]\s*(?:你的生活指南|你的生活兴趣社区|标记我的生活))?|登录|安全验证)$/.test(rawTitle)?'':rawTitle;
    let description='',cover='';
    if(body){const clone=body.cloneNode(true);clone.querySelectorAll('a.tag,script,style,input,textarea,[contenteditable],button,[hidden],[aria-hidden="true"]').forEach(node=>node.remove());description=compact(clone.textContent,12000);}
    // Reuse a note image already loaded by the page. No remote image request;
    // cross-origin canvas restrictions are respected and failures are harmless.
    const picture=note?.querySelector('.media-container .swiper-slide[data-swiper-slide-index="0"] img');
    if(picture?.complete&&picture.naturalWidth>0&&picture.naturalHeight>0&&picture.naturalWidth*picture.naturalHeight<=40000000)try{
      const scale=Math.min(1,720/Math.max(picture.naturalWidth,picture.naturalHeight)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(picture.naturalWidth*scale));canvas.height=Math.max(1,Math.round(picture.naturalHeight*scale));canvas.getContext('2d').drawImage(picture,0,0,canvas.width,canvas.height);const data=canvas.toDataURL('image/jpeg',.66);if(data.length<=120000)cover=data;
    }catch{}
    return {url:location.href,title,description:compact(description),passages:description?[description]:[],siteName:'小红书',author:compact(note?.querySelector('.author .name, .author-container .name')?.textContent,150),publishedAt:compact(meta('article:published_time'),60),kind:'excerpt',cover,extractorVersion:3};
  }
  let description=meta('og:description')||meta('description')||meta('twitter:description'),kind='description';
  const selectors=['#js_content','[itemprop="articleBody"]','article','[role="article"]','.markdown-body','.article-content','.post-content','.entry-content','main','[role="main"]'];
  const root=selectors.map(selector=>document.querySelector(selector)).find(Boolean)||document.body,passages=[],seen=new Set();
  const blocked='nav,aside,header,footer,form,button,script,style,textarea,input,[contenteditable="true"],[hidden],[aria-hidden="true"],[role="navigation"],[role="menu"]';
  if(root)for(const node of [...root.querySelectorAll('p,li,pre,h2,h3')].slice(0,200)){
    if(node.closest(blocked)||node.querySelector('p,li,pre'))continue;
    const value=compact(node.innerText??node.textContent,1600),links=[...node.querySelectorAll('a')].reduce((n,a)=>n+compact(a.textContent).length,0);
    if(value.length<24||links>value.length*.65||seen.has(value))continue;
    seen.add(value);passages.push(value);if(passages.join('').length>=12000||passages.length>=60)break;
  }
  if(!passages.length&&root&&root!==document.body){
    const clone=root.cloneNode(true);clone.querySelectorAll(blocked).forEach(node=>node.remove());
    const value=compact(clone.textContent,12000);if(value.length>=45)passages.push(value);
  }
  if(!description&&passages.length){description=passages[0];kind='excerpt';}
  return {url:location.href,title:compact(meta('og:title')||meta('twitter:title')||document.title,500),description:compact(description),passages,siteName:compact(meta('og:site_name'),100),author:compact(meta('author')||meta('article:author'),150),publishedAt:compact(meta('article:published_time'),60),kind};
}

function decode(value){
  return text(String(value||'').replace(/<[^>]*>/g,' ').replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi,(_,key)=>{
    if(key[0]!=='#')return {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '}[key.toLowerCase()];
    const n=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):parseInt(key.slice(1),10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';
  }),1200);
}
export function parsePagePreview(html,url){
  // Parse strings only: never mount untrusted HTML or load its scripts/resources.
  const source=String(html).slice(0,2000000).replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,''),metas=new Map();
  for(const match of source.matchAll(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)){
    const attrs={};for(const a of match[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))attrs[a[1].toLowerCase()]=decode(a[2]??a[3]??a[4]);
    const key=(attrs.property||attrs.name||'').toLowerCase();if(key&&!metas.has(key))metas.set(key,attrs.content||'');
  }
  const get=(...keys)=>keys.map(key=>metas.get(key)).find(Boolean)||'';
  let description=get('og:description','description','twitter:description'),kind='description';
  let title=get('og:title','twitter:title')||decode(source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  if(xhsNoteId(url)){
    // Public HTML sometimes contains just the login shell. Do not describe the
    // website itself as if it were this note, or scrape the surrounding feed.
    const field=id=>{const opening=new RegExp(`<([a-z][\\w:-]*)\\b[^>]*\\bid\\s*=\\s*["']${id}["'][^>]*>`,'i').exec(source);if(!opening)return '';const tail=source.slice(opening.index+opening[0].length),tags=new RegExp(`<\\/?${opening[1]}\\b[^>]*>`,'gi');let depth=1;for(const found of tail.matchAll(tags)){depth+=found[0][1]==='/'?-1:1;if(!depth)return tail.slice(0,found.index);}return '';};
    title=decode(field('detail-title'))||title;title=title.replace(/\s*[-—–|]\s*小红书\s*$/,'');if(isPlaceholderTitle(title,url))title='';
    const body=decode(field('detail-desc').replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi,''));
    description=body||(isXhsSiteDescription(description)?'':description);
    const passages=body?[body]:[];
    return {title,description,summary:summarizePage({title,description,passages}),passages,siteName:'小红书',author:get('author','article:author'),publishedAt:get('article:published_time'),kind:body?'excerpt':'description',imageUrl:'',extractorVersion:3};
  }
  const content=source.replace(/<(nav|aside|header|footer|form|button)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'');
  // Prefer a semantic article, including common div-based WeChat/CMS bodies.
  const opening=/<(article|main)\b[^>]*>|<(div|section)\b[^>]*(?:id|class|itemprop)\s*=\s*["'][^"']*(?:js_content|articleBody|markdown-body|article-content|post-content|entry-content)[^"']*["'][^>]*>/i.exec(content);
  let article='';
  if(opening){const tag=opening[1]||opening[2],tail=content.slice(opening.index+opening[0].length),tags=new RegExp(`<\\/?${tag}\\b[^>]*>`,'gi');let depth=1,end=tail.length;for(const found of tail.matchAll(tags)){depth+=found[0][1]==='/'?-1:1;if(!depth){end=found.index;break;}}article=tail.slice(0,end);}
  const passages=[...(article||content).matchAll(/<(p|li|pre)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)].slice(0,100).filter(p=>!/<a\b/i.test(p[2])||decode(p[2].replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi,'')).length>decode(p[2]).length*.35).map(p=>decode(p[2])).filter(p=>p.length>=24).slice(0,60);
  if(!passages.length&&article){const value=decode(article);if(value.length>=45)passages.push(value);}
  // JSON-LD is data, never evaluated. Some sites put the article only here.
  const visit=(value,depth=0)=>{if(!value||typeof value!=='object'||depth>5)return;if(typeof value.articleBody==='string')passages.push(text(value.articleBody,12000));for(const child of Object.values(value).slice(0,50))if(typeof child==='object')for(const item of Array.isArray(child)?child.slice(0,20):[child])visit(item,depth+1);};
  if(!passages.length)for(const script of String(html).matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){if(script[1].length<=200000)try{visit(JSON.parse(script[1]));}catch{}}
  if(!description&&passages.length){description=passages[0];kind='excerpt';}
  let imageUrl='';try{const image=new URL(get('og:image','twitter:image'),url);if(get('og:image','twitter:image')&&['https:','http:'].includes(image.protocol))imageUrl=image.href;}catch{}
  return {title,description,summary:summarizePage({title,description,passages}),passages,siteName:get('og:site_name'),author:get('author','article:author'),publishedAt:get('article:published_time'),kind,imageUrl};
}

export async function thumbnail(blob){
  if(!['image/jpeg','image/png','image/webp'].includes(blob.type)||blob.size>2000000)return '';
  if(typeof createImageBitmap!=='function'||typeof OffscreenCanvas!=='function')return '';
  const bitmap=await createImageBitmap(blob);
  try{
    if(!bitmap.width||!bitmap.height||bitmap.width*bitmap.height>40000000)return '';
    const width=Math.min(bitmap.width,720),height=Math.round(width*Math.min(bitmap.height/bitmap.width,9/16)),canvas=new OffscreenCanvas(width,height);
    canvas.getContext('2d').drawImage(bitmap,0,0,bitmap.width,Math.min(bitmap.height,bitmap.width*9/16),0,0,width,height);
    const small=await canvas.convertToBlob({type:'image/jpeg',quality:.66});if(small.size>85000)return '';
    const bytes=new Uint8Array(await small.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    return `data:image/jpeg;base64,${btoa(binary)}`;
  }finally{bitmap.close();}
}

const originPattern=url=>{const u=new URL(url);return `${u.protocol}//${u.hostname}/*`;};
async function limitedBlob(response,max){
  if(!response.ok)throw new Error(`网页暂时无法读取（${response.status}）。`);
  if(Number(response.headers.get('content-length'))>max)throw new Error('网页内容太大，请用工具栏保存当前页面。');
  const reader=response.body?.getReader();if(!reader)throw new Error('无法读取网页响应。');
  const chunks=[];let length=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>max){await reader.cancel();throw new Error('网页内容太大，请用工具栏保存当前页面。');}chunks.push(value);}}finally{reader.releaseLock();}
  return new Blob(chunks,{type:(response.headers.get('content-type')||'').split(';')[0]});
}
export function requestPreviewAccess(url,permissions=globalThis.chrome?.permissions){
  if(!permissions)throw new Error('请在已安装的 Chrome 扩展中使用补全内容。');
  // Invoke directly during the click, before any storage or network await.
  return permissions.request({origins:[...new Set((Array.isArray(url)?url:[url]).map(originPattern))]});
}
export async function loadPagePreview(url,{permissions=globalThis.chrome?.permissions,request=globalThis.fetch}={}){
  const page=new URL(url);if(!['http:','https:'].includes(page.protocol))throw new Error('只能读取普通网页。');
  if(!permissions||!await permissions.contains({origins:[originPattern(url)]}))return null;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{
    const options={credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',signal:controller.signal};
    const response=await request(url,options),type=response.headers.get('content-type')||'';
    if(!/text\/html|application\/xhtml\+xml/i.test(type))throw new Error('此链接没有可读取的网页简介，请在编辑中补充。');
    const blob=await limitedBlob(response,2000000),html=new TextDecoder(/charset\s*=\s*([\w-]+)/i.exec(type)?.[1]||'utf-8').decode(await blob.arrayBuffer()),details=parsePagePreview(html,url);
    let cover='';
    // Only the granted origin may supply a cover; third-party image servers are not contacted.
    if(details.imageUrl&&new URL(details.imageUrl).origin===page.origin){try{cover=await thumbnail(await limitedBlob(await request(details.imageUrl,options),2000000));}catch{}}
    if(!details.title&&!details.description&&!cover)throw new Error('网页没有提供简介。可打开原网页，用工具栏保存，或手动填写简介。');
    return {title:details.title,...cleanPreview({...details,cover,capturedAt:Date.now()})};
  }catch(error){if(error.name==='AbortError')throw new Error('读取超时，链接已保留，请稍后重试。');if(error instanceof TypeError)throw new Error('网站拒绝读取或发生跳转。可打开原网页，用工具栏保存内容。');throw error;}
  finally{clearTimeout(timer);}
}
