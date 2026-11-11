// Tests the actual cold shell with its controller unavailable, not save-button timing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
function chinesePopup(...args){const page=new JSDOM(...args);Object.defineProperty(page.window.navigator,'language',{value:'zh-CN',configurable:true});return page;}
const root=new URL('../extension/',import.meta.url);
const [html,boot,css]=await Promise.all(['popup.html','popup-boot.js','popup.css'].map(name=>readFile(new URL(name,root))));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const release=JSON.parse(await readFile(new URL('manifest.json',root),'utf8')).version;

test('popup shell reaches load and opens the manager without controller, storage, or webpage APIs',async()=>{
  const opened=[];let loadComplete=false,closed=0;
  const page=chinesePopup(html.toString(),{url:'https://synthetic-popup.test/popup.html',runScripts:'outside-only'});
  const initialAssets=[...page.window.document.querySelectorAll('script[src],link[rel="stylesheet"]')].map(node=>node.getAttribute('src')||node.getAttribute('href'));
  page.window.addEventListener('load',()=>{loadComplete=true;});
  page.window.open=(url,target,features)=>opened.push({url,target,features});page.window.close=()=>closed++;
  Object.defineProperty(page.window,'indexedDB',{get(){throw new Error('storage must not be opened by the cold shell');}});
  Object.defineProperty(page.window,'chrome',{get(){throw new Error('webpage APIs must not be called by the cold shell');}});
  page.window.eval(boot.toString());
  try{
    for(let i=0;i<100&&!loadComplete;i++)await wait(10);
    assert.equal(loadComplete,true);assert.equal(page.window.document.readyState,'complete');
    assert.deepEqual(initialAssets.sort(),['popup-boot.js','popup.css']);
    assert.equal(page.window.document.querySelector('#popupVersion').textContent,'v'+release);
    page.window.document.querySelector('#popupVersion').click();
    assert.equal(page.window.document.querySelector('#popupStartupInfo').hidden,false);
    assert.ok(page.window.document.querySelector('#popupStartupInfo').textContent.includes('不包含 Chrome 创建窗口之前的等待'));
    page.window.document.querySelector('#openHouse').click();await wait(0);
    assert.equal(opened.length,1);assert.equal(opened[0].url,'manager.html');assert.equal(closed,1);
    assert.equal(page.window.document.querySelector('#capturePage').disabled,true,'capture waits for the controller while the window is already available');
  }finally{page.window.close();}
});

test('controller failure retains the working collection shortcut and provides an explanation',async()=>{
  const page=chinesePopup(html.toString(),{url:'https://synthetic-popup.test/popup.html',runScripts:'outside-only'});
  try{
    page.window.eval(boot.toString());page.window.dispatchEvent(new page.window.Event('load'));
    for(let i=0;i<50&&!page.window.document.querySelector('script[type="module"]');i++)await wait(5);
    const controller=page.window.document.querySelector('script[type="module"]');assert.ok(controller);
    controller.dispatchEvent(new page.window.Event('error'));
    assert.ok(page.window.document.querySelector('#popupStatus').textContent.includes('可先打开我的收藏'));
    assert.equal(page.window.document.querySelector('#openHouse').disabled,false);
  }finally{page.window.close();}
});
