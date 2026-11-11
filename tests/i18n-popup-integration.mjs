import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {setLanguage,LANGUAGE_KEY} from '../extension/i18n.js';

const [markup,boot]=await Promise.all(['popup.html','popup-boot.js'].map(file=>readFile(new URL('../extension/'+file,import.meta.url),'utf8')));
test('the cold popup translates immediately and opens the manager with all capture APIs unavailable',async()=>{
  const page=new JSDOM(markup,{url:'https://synthetic-cold-language.test/popup.html',runScripts:'outside-only'});
  Object.defineProperty(page.window.navigator,'language',{value:'en-US'});
  Object.defineProperty(page.window,'indexedDB',{get(){throw new Error('Do not open IndexedDB on the cold path');}});
  Object.defineProperty(page.window,'chrome',{get(){throw new Error('Do not access Chrome APIs on the cold path');}});
  const opened=[],close=page.window.close.bind(page.window);page.window.open=url=>opened.push(url);page.window.close=()=>{};
  try{
    page.window.eval(boot);assert.equal(page.window.document.documentElement.lang,'en');
    assert.equal(page.window.document.querySelector('#capturePage').textContent,'Save to Bookmark House');
    page.window.document.querySelector('#openHouse').click();await new Promise(resolve=>setTimeout(resolve,0));assert.deepEqual(opened,['manager.html']);
    assert.deepEqual([...page.window.document.querySelectorAll('script[src],link[rel="stylesheet"]')].map(node=>node.getAttribute('src')||node.getAttribute('href')).sort(),['popup-boot.js','popup.css']);
  }finally{close();}
});

test('switching popup language preserves a current page title and an unsaved note',async()=>{
  setLanguage('en',{persist:false});
  const page=new JSDOM(markup,{url:'chrome-extension://synthetic-popup-language/popup.html'});
  const preferences=new Map(),storage={getItem:key=>preferences.get(key)??null,setItem:(key,value)=>preferences.set(key,String(value))};
  Object.defineProperty(page.window,'localStorage',{value:storage,configurable:true});
  Object.assign(globalThis,{window:page.window,document:page.window.document,location:page.window.location,indexedDB:new IDBFactory()});
  Object.defineProperty(globalThis,'navigator',{value:page.window.navigator,configurable:true});
  Object.defineProperty(globalThis,'localStorage',{value:page.window.localStorage,configurable:true});
  globalThis.chrome={tabs:{query:async()=>[{id:1,url:'https://saved.test/article',title:'保存网页'}]},commands:{getAll:async()=>[]}};
  const $=selector=>document.querySelector(selector),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  try{
    await import(`../extension/popup.js?language-note=${Date.now()}`);
    for(let i=0;i<100&&$('#capturePage').disabled;i++)await wait(10);
    assert.equal($('#currentTitle').textContent,'保存网页');
    $('#captureNote').value='这段未提交备注必须保留';$('#captureNote').dispatchEvent(new page.window.Event('input',{bubbles:true}));
    const control=$('[data-language-select]');control.value='zh-CN';control.dispatchEvent(new page.window.Event('change',{bubbles:true}));
    assert.equal($('#currentTitle').textContent,'保存网页');assert.equal($('#captureNote').value,'这段未提交备注必须保留');assert.equal($('#capturePage').textContent,'保存到小屋');
    control.value='en';control.dispatchEvent(new page.window.Event('change',{bubbles:true}));
    assert.equal($('#currentTitle').textContent,'保存网页');assert.equal($('#captureNote').value,'这段未提交备注必须保留');assert.equal($('#capturePage').textContent,'Save to Bookmark House');assert.equal(localStorage.getItem(LANGUAGE_KEY),'en');
  }finally{delete globalThis.chrome;page.window.close();}
});
