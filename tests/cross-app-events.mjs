// Synthetic DOM events only; no connection to WeChat or any live browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {installWebDrop} from '../extension/web-collection-view.js';
function setup(){
  const page=new JSDOM('<body><section id="webPanel"><div id="drop">拖进来</div></section><input id="webUrl"><input id="webTitle"><textarea id="note"></textarea><div data-drop-folder="1" id="folder">Chrome 文件夹</div></body>');
  const saved=[],errors=[];let visible=true,blocked=false;
  globalThis.innerWidth=1200;globalThis.innerHeight=900;
  installWebDrop({doc:page.window.document,isVisible:()=>visible,isBlocked:()=>blocked,onSave:links=>saved.push(links),onError:message=>errors.push(message)});
  function send(type,target,payload,types=Object.keys(payload),effectAllowed='uninitialized'){
    const event=new page.window.Event(type,{bubbles:true,cancelable:true});const data={types,effectAllowed,dropEffect:'none',getData:key=>payload[key]||''};Object.defineProperty(event,type==='paste'?'clipboardData':'dataTransfer',{value:data});page.window.document.querySelector(target).dispatchEvent(event);return event;
  }
  return {page,saved,errors,send,hide(){visible=false;},block(){blocked=true;}};
}
test('drop accepts text plus preview-file metadata without attempting to read files',()=>{
  const f=setup();const event=f.send('drop','#drop',{'text/plain':'文章标题\nhttps://mp.weixin.qq.com/s/sample'},['Files','text/plain']);assert.equal(event.defaultPrevented,true);assert.equal(f.saved.length,1);assert.equal(f.saved[0][0].title,'文章标题');assert.equal(f.errors.length,0);f.page.window.close();
});
test('explicit paste into the collection saves share text while normal text fields keep normal paste behavior',()=>{
  const f=setup();const event=f.send('paste','body',{'text/plain':'微信中发现的文章\nhttps://mp.weixin.qq.com/s/sample'});assert.equal(event.defaultPrevented,true);assert.equal(f.saved[0][0].title,'微信中发现的文章');const note=f.send('paste','#note',{'text/plain':'一段笔记 https://example.com/'});assert.equal(note.defaultPrevented,false);assert.equal(f.saved.length,1);f.page.window.close();
});
test('pasting a share message into the URL field fills a clean URL and title without auto-saving',()=>{
  const f=setup();f.block();const event=f.send('paste','#webUrl',{'text/plain':'【链接】一篇教程\nhttps://mp.weixin.qq.com/s/tutorial'});assert.equal(event.defaultPrevented,true);assert.equal(f.page.window.document.querySelector('#webUrl').value,'https://mp.weixin.qq.com/s/tutorial');assert.equal(f.page.window.document.querySelector('#webTitle').value,'一篇教程');assert.equal(f.saved.length,0);
  f.page.window.document.querySelector('#webTitle').value='自己输入的标题';f.send('paste','#webUrl',{'text/plain':'另一个标题 https://example.com/'});assert.equal(f.page.window.document.querySelector('#webTitle').value,'自己输入的标题');f.page.window.close();
});
test('hidden collection, open modal and actual bookmark folder drops do not get captured by the card inbox',()=>{
  const f=setup();f.hide();const event=f.send('paste','body',{'text/plain':'https://example.com/'});assert.equal(event.defaultPrevented,false);assert.equal(f.saved.length,0);f.page.window.close();
  const g=setup();g.block();g.send('paste','body',{'text/plain':'https://example.com/'});assert.equal(g.saved.length,0);g.page.window.close();
  const h=setup();const folder=h.send('drop','#folder',{'text/uri-list':'https://example.com/'});assert.equal(folder.defaultPrevented,false);assert.equal(h.saved.length,0);h.page.window.close();
});
test('an app that only sends an image or file receives a clear copy-link fallback, not a fabricated URL',()=>{
  const f=setup();f.send('drop','#drop',{},['Files']);assert.equal(f.saved.length,0);assert.ok(f.errors[0].includes('复制链接'));f.page.window.close();
});
test('native link-only drag feedback agrees with the source allowed operation',()=>{
  const f=setup(),payload={'text/uri-list':'https://example.com/native-link'};const over=f.send('dragover','#drop',payload,['text/uri-list'],'link');assert.equal(over.dataTransfer.dropEffect,'link');assert.equal(over.defaultPrevented,true);f.send('drop','#drop',payload,['text/uri-list'],'link');assert.equal(f.saved.length,1);f.page.window.close();
});
test('move-only native drag is refused without writing a card',()=>{
  const f=setup(),payload={'text/uri-list':'https://example.com/native-move'};const over=f.send('dragover','#drop',payload,['text/uri-list'],'move');assert.equal(over.dataTransfer.dropEffect,'none');f.send('drop','#drop',payload,['text/uri-list'],'move');assert.equal(f.saved.length,0);assert.ok(f.errors[0].includes('不允许'));f.page.window.close();
});
