import english from './locales/en.js';

export const LANGUAGE_KEY='bookmark-house-language';
const listeners=new Set(),documents=new WeakSet(),formatters=new Map();
const sources=new Map(Object.entries(english).map(([key,value])=>[value,key]));
export const normalizeLanguage=value=>/^zh(?:[-_]|$)/i.test(String(value||''))?'zh-CN':'en';
export function preferredLanguage(){
  try{const saved=globalThis.localStorage?.getItem(LANGUAGE_KEY);if(saved==='en'||saved==='zh-CN')return saved;}catch{}
  return normalizeLanguage(globalThis.navigator?.language||globalThis.chrome?.i18n?.getUILanguage?.()||'zh-CN');
}
let language=globalThis.window?.BookmarkHouseShell?.language||preferredLanguage();
export const locale=()=>language;
export const englishText=key=>english[key]??key;
export function t(key){const value=String(key??''),source=Object.hasOwn(english,value)?value:(sources.get(value)||value);return language==='en'&&Object.hasOwn(english,source)?english[source]:source;}
function pattern(strings){return strings.reduce((key,part,index)=>key+(index?'{'+(index-1)+'}':'')+part,'');}
const singular={webpages:'webpage',pages:'page',bookmarks:'bookmark',subfolders:'subfolder',folders:'folder',items:'item',cards:'card',saves:'save',steps:'step',pixels:'pixel'};
export function msg(strings,...values){
  let text=t(pattern(strings));
  if(language==='en')text=text.replace(/\{(\d+)\}(\s+)(webpages|pages|bookmarks|subfolders|folders|items|cards|saves|steps|pixels)\b/g,(match,index,space,noun)=>Number(values[index])===1?'{'+index+'}'+space+singular[noun]:match);
  return text.replace(/\{(\d+)\}/g,(_,index)=>String(values[index]??''));
}
const escape=value=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
// Translate authored static template segments before inserting values. Values may
// contain saved titles, notes or HTML: they are never searched or translated.
export function html(strings,...values){
  return strings.map((part,index)=>{
    const translated=language==='en'?part.replace(/[^<>"'\n]+/g,chunk=>{
      const key=chunk.trim();if(!Object.hasOwn(english,key))return chunk;
      let value=english[key];
      if(index&&Number(values[index-1])===1)value=value.replace(/^(\s*)(webpages|pages|bookmarks|subfolders|folders|items|cards|saves|steps|pixels)\b/,(_,space,noun)=>space+singular[noun]);
      if(/^\s/.test(chunk))value=value.trimStart();
      if(/\s$/.test(chunk))value=value.trimEnd();
      return chunk.slice(0,chunk.indexOf(key))+escape(value.replaceAll('&#10;','\n'))+chunk.slice(chunk.indexOf(key)+key.length);
    }):part;
    return translated+(index<values.length?String(values[index]??''):'');
  }).join('');
}
export function date(value,options={year:'numeric',month:'short',day:'numeric'}){
  const key=language+JSON.stringify(options);
  if(!formatters.has(key))formatters.set(key,new Intl.DateTimeFormat(language,options));
  return formatters.get(key).format(new Date(value));
}
export const number=value=>Number(value).toLocaleString(language);
export function applyLocale(doc=globalThis.document){
  if(!doc)return;doc.documentElement.lang=language;
  for(const element of doc.querySelectorAll('[data-i18n]')){
    element.textContent=t(element.dataset.i18n);
    if(element.hasAttribute('data-i18n-once')){element.removeAttribute('data-i18n');element.removeAttribute('data-i18n-once');}
  }
  for(const attr of ['title','placeholder','aria-label','alt'])for(const element of doc.querySelectorAll(`[data-i18n-${attr}]`))element.setAttribute(attr,t(element.getAttribute('data-i18n-'+attr)));
  for(const select of doc.querySelectorAll('[data-language-select]'))select.value=language;
  for(const element of doc.querySelectorAll('[data-locale-section]'))element.hidden=element.dataset.localeSection!==language;
}
export function onLanguageChange(listener){listeners.add(listener);return ()=>listeners.delete(listener);}
export function setLanguage(value,{persist=true,notify=true}={}){
  const next=normalizeLanguage(value),changed=next!==language;language=next;
  if(persist){
    try{globalThis.localStorage?.setItem(LANGUAGE_KEY,next);}catch{}
    try{const pending=globalThis.chrome?.runtime?.sendMessage?.({type:'bookmark-house-language',language:next});pending?.catch?.(()=>{});}catch{}
  }
  if(!changed||!notify)return next;
  for(const listener of [...listeners])listener(next);
  return next;
}
export function initLocale({document:doc=globalThis.document,window:win=doc?.defaultView}={}){
  if(!doc)return;applyLocale(doc);
  if(documents.has(doc))return;documents.add(doc);
  onLanguageChange(()=>{applyLocale(doc);win?.BookmarkHouseShell?.setLanguage(language,false);});
  doc.addEventListener('change',event=>{
    if(event.target.matches?.('[data-language-select]:not([data-shell-language])'))setLanguage(event.target.value);
  });
  win?.addEventListener('storage',event=>{if(event.key===LANGUAGE_KEY&&event.newValue)setLanguage(event.newValue,{persist:false});});
  win?.addEventListener('bookmark-house-language-change',event=>setLanguage(event.detail,{persist:false}));
}
export function folderTitle(folder){
  const types={'bookmarks-bar':'书签栏',other:'其他书签',mobile:'移动设备书签'};
  if(folder?.folderType&&types[folder.folderType])return t(types[folder.folderType]);
  if(folder?.depth===1&&['书签栏','Bookmarks bar','其他书签','Other bookmarks','移动设备书签','Mobile bookmarks'].includes(folder.title))return t({'Bookmarks bar':'书签栏','Other bookmarks':'其他书签','Mobile bookmarks':'移动设备书签'}[folder.title]||folder.title);
  return folder?.title||t('未命名文件夹');
}
