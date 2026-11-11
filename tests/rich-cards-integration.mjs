// Simulated extension and DOM checks; these never inspect the user's browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readDocumentPreview,thumbnail} from '../extension/page-preview.js';
import {capturePageDetails} from '../extension/quick-capture.js';
import {WebCollection} from '../extension/web-collection.js';
import {WebCollectionView} from '../extension/web-collection-view.js';
class Store{value=null;async get(){return structuredClone(this.value);}async set(k,v){this.value=structuredClone(v);}}
test('in-page extraction reads metadata or an article excerpt and skips navigation and form fields',()=>{
  const long='这是一段真实文章的开头，说明在复杂的网页当中，我们仍然应该找到与文章本身有关的内容而不是导航、广告和表单。';
  const dom=new JSDOM(`<title>文档标题</title><meta property="og:title" content="文章标题"><meta name="description" content="网页的真实简介"><main><input value="private"><p>${long}</p></main>`,{url:'https://example.com/a'});
  globalThis.document=dom.window.document;globalThis.location=dom.window.location;
  let result=readDocumentPreview();assert.equal(result.description,'网页的真实简介');assert.equal(result.title,'文章标题');
  document.querySelector('meta[name="description"]').remove();result=readDocumentPreview();assert.equal(result.description,long);assert.equal(result.kind,'excerpt');assert.ok(!JSON.stringify(result).includes('private'));dom.window.close();
});
test('optional screenshots are downscaled, stay local, and are discarded if the active tab changed',async()=>{
  const calls=[],draws=[];let screenshots=0,changed=false;
  globalThis.createImageBitmap=async()=>({width:1920,height:1080,close(){}});
  globalThis.OffscreenCanvas=class{constructor(w,h){calls.push([w,h]);}getContext(){return {drawImage(...args){draws.push(args);}};}async convertToBlob(options){assert.equal(options.type,'image/jpeg');return new Blob([new Uint8Array([1,2,3])],{type:'image/jpeg'});}};
  try{
    const tab={id:1,windowId:7,url:'https://a.test/',title:'文章'};
    const api={tabs:{async query(){return [{...tab,id:changed?2:1}];},async captureVisibleTab(windowId,options){screenshots++;assert.equal(windowId,7);assert.equal(options.format,'jpeg');return 'data:image/jpeg;base64,AQID';}}};
    let result=await capturePageDetails(tab,{api,snapshot:false});assert.equal(screenshots,0);assert.equal(result.preview.cover,'');
    result=await capturePageDetails(tab,{api,snapshot:true});assert.equal(result.preview.cover,'data:image/jpeg;base64,AQID');assert.deepEqual(calls[0],[720,405]);assert.equal(draws[0][7],720);
    changed=true;result=await capturePageDetails(tab,{api,snapshot:true});assert.equal(result.preview.cover,'');assert.equal(screenshots,1);
    changed=false;api.tabs.captureVisibleTab=async()=>{changed=true;return 'data:image/jpeg;base64,AQID';};result=await capturePageDetails(tab,{api,snapshot:true});assert.equal(result.preview.cover,'');
    assert.equal(await thumbnail(new Blob(['svg'],{type:'image/svg+xml'})),'');
  }finally{delete globalThis.createImageBitmap;delete globalThis.OffscreenCanvas;}
});
test('old-card enrichment asks for one site, saves real content and leaves original notes and date intact',async()=>{
  const dom=new JSDOM('<div id="cards"></div>',{url:'chrome-extension://test/manager.html'});globalThis.document=dom.window.document;const repository=new WebCollection(new Store()),{ids}=await repository.add([{url:'https://a.test/article',note:'留住这段想法'}]);const before=(await repository.read()).items[0];
  let allowed=true,requests=0,fetches=0;const messages=[];const originalFetch=globalThis.fetch;
  globalThis.chrome={permissions:{request(options){requests++;assert.deepEqual(options,{origins:['https://a.test/*']});return Promise.resolve(allowed);},async contains(){return allowed;}}};
  globalThis.fetch=async()=>{fetches++;return new Response('<meta property="og:title" content="真正的文章标题"><meta name="description" content="这是来自网页的真实简介">',{headers:{'content-type':'text/html'}});};
  const view=new WebCollectionView({container:document.querySelector('#cards'),repository,onCount(){},getSearch:()=>'',getModel:()=>({bookmarks:[]}),toast:message=>messages.push(message),async perform(fn){const result=await fn();await view.refresh();view.render();return result;}});
  try{
    await view.refresh();view.render();await view.action('webEnrich',ids[0]);let item=(await repository.read()).items[0];assert.equal(requests,1);assert.equal(fetches,1);assert.equal(item.savedAt,before.savedAt);assert.equal(item.note,before.note);assert.equal(item.title,'真正的文章标题');assert.ok(document.querySelector('.web-card-summary').textContent.includes('真实简介'));assert.equal(document.querySelectorAll('.web-card-note').length,1);
    allowed=false;const revision=(await repository.read()).revision;await view.action('webEnrich',ids[0]);assert.equal((await repository.read()).revision,revision);assert.equal(fetches,1);assert.ok(messages.at(-1).includes('原卡片继续保留'));
  }finally{globalThis.fetch=originalFetch;delete globalThis.chrome;dom.window.close();}
});
test('broken local cover is removed cleanly rather than leaving an empty image frame',async()=>{
  const dom=new JSDOM('<div id="cards"></div>');globalThis.document=dom.window.document;const repository=new WebCollection(new Store());await repository.add([{url:'https://a.test/',preview:{cover:'data:image/jpeg;base64,AAAA'}}]);
  const view=new WebCollectionView({container:document.querySelector('#cards'),repository,onCount(){},getSearch:()=>'',getModel:()=>({bookmarks:[]})});await view.refresh();view.render();document.querySelector('img').dispatchEvent(new dom.window.Event('error'));assert.equal(document.querySelector('.web-card-cover'),null);assert.ok(!document.querySelector('.web-card').classList.contains('has-cover'));dom.window.close();
});
test('saving a link starts site access during the gesture and fills its card with a body summary automatically',async()=>{
  const dom=new JSDOM('<div id="cards"></div>');globalThis.document=dom.window.document;const repository=new WebCollection(new Store()),events=[],originalFetch=globalThis.fetch;let fetches=0;
  const body='这篇文章解释研究资料的整理方法，建议按项目记录资料用途，并且通过定期回顾决定哪些内容仍然值得保留。每次保存文章时写下使用场景，可以帮助下一次查找时更快理解收藏的价值。';
  globalThis.chrome={permissions:{request(){events.push('request');return Promise.resolve(true);},async contains(){return true;}}};
  globalThis.fetch=async()=>{fetches++;return new Response(`<title>研究资料</title><meta name="description" content="欢迎访问我们的网站"><article><p>${body}</p></article>`,{headers:{'content-type':'text/html'}});};
  const originalAdd=repository.add.bind(repository);repository.add=async links=>{events.push('save');return originalAdd(links);};
  const view=new WebCollectionView({container:document.querySelector('#cards'),repository,onCount(){},getSearch:()=>'',getModel:()=>({bookmarks:[]}),toast(){},async perform(fn){const result=await fn();await view.refresh();view.render();return result;}});
  try{await view.saveLinks([{url:'https://a.test/new',title:'研究资料'}]);const [item]=(await repository.read()).items;assert.deepEqual(events.slice(0,2),['request','save']);assert.equal(fetches,1);assert.ok(item.preview.summary.includes('整理方法'));assert.ok(!item.preview.summary.includes('欢迎访问'));assert.ok(document.querySelector('.web-card-summary').textContent.includes('整理方法'));assert.ok(!document.body.textContent.includes('内容待补全'));}finally{globalThis.fetch=originalFetch;delete globalThis.chrome;dom.window.close();}
});
