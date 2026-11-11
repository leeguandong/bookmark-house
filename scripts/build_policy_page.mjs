import fs from 'node:fs';
import {JSDOM} from 'jsdom';

const root=new URL('../',import.meta.url),target=new URL('docs/privacy/index.html',root);
const dom=new JSDOM(fs.readFileSync(new URL('extension/privacy.html',root),'utf8'));
const doc=dom.window.document;
doc.querySelectorAll('script,link[rel="icon"]').forEach(element=>element.remove());
const canonical=doc.createElement('link');canonical.rel='canonical';canonical.href='https://leeguandong.github.io/bookmark-house/privacy/';doc.head.append(canonical);
const style=doc.createElement('style');style.textContent=fs.readFileSync(new URL('extension/privacy.css',root),'utf8').replaceAll('\r\n','\n');
doc.querySelector('link[rel="stylesheet"]').replaceWith(style);
doc.querySelector('title').textContent='书签小屋 · 隐私政策 / Bookmark House · Privacy policy';
doc.querySelector('h1').textContent='隐私政策 / Privacy policy';
const languages=doc.createElement('p');languages.innerHTML='<a href="#chinese">简体中文</a> · <a href="#english">English</a>';
doc.querySelector('.language-control').replaceWith(languages);
const chinese=doc.querySelector('[data-locale-section="zh-CN"]'),english=doc.querySelector('[data-locale-section="en"]');
chinese.id='chinese';english.hidden=false;english.className='english';
const heading=doc.createElement('h2');heading.textContent='Privacy policy · English';
const date=doc.createElement('p');date.className='meta';date.textContent='Effective November 11, 2026 · Bookmark House Chrome extension';
english.prepend(heading,date);
for(const element of doc.querySelectorAll('*'))for(const attr of [...element.attributes])if(attr.name.startsWith('data-i18n')||attr.name==='data-locale-section')element.removeAttribute(attr.name);
const result='<!doctype html>\n'+doc.documentElement.outerHTML+'\n';
if(process.argv.includes('--check')){
  if(fs.readFileSync(target,'utf8').replaceAll('\r\n','\n')!==result)throw new Error('The policy snapshot is stale. Run npm run build:policy.');
}else fs.writeFileSync(target,result);
dom.window.close();
console.log(JSON.stringify({policy:'docs/privacy/index.html',languages:['zh-CN','en'],scripts:0,external_resources:0}));
