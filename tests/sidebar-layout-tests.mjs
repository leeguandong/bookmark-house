import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {installSidebarLayout} from '../extension/sidebar-layout.js';
const html=await readFile(new URL('../extension/manager.html',import.meta.url),'utf8');
const key='bookmark-house.sidebar-layout.v1';
function fixture({saved=null,size=1440,blocked=false}={}){
  const dom=new JSDOM(html,{url:'http://sidebar-test.invalid/manager.html',pretendToBeVisual:true});
  const {window}=dom,{document}=window;
  window.innerWidth=size;
  if(saved!==null)window.localStorage.setItem(key,saved);
  if(blocked)Object.defineProperty(window,'localStorage',{get(){throw new Error('Storage disabled');}});
  const layout=installSidebarLayout({document,window}),handle=document.querySelector('#sidebarResize');
  const event=(target,type,props)=>{const e=new window.Event(type,{bubbles:true,cancelable:true});Object.assign(e,props);target.dispatchEvent(e);return e;};
  return {window,document,handle,layout,click:()=>document.querySelector('#mobileMenu').click(),value:()=>Number(handle.getAttribute('aria-valuenow')),saved:()=>JSON.parse(window.localStorage.getItem(key)),resize:n=>{window.innerWidth=n;window.dispatchEvent(new window.Event('resize'));},event,close:()=>{layout.destroy();window.close();}};
}
test('dragging follows pointer movement, bounds width and restores saved expanded width after collapse',()=>{
  const f=fixture();try{
    f.event(f.handle,'pointerdown',{button:0,pointerId:1,clientX:244});
    f.event(f.document,'pointermove',{pointerId:2,clientX:400});assert.equal(f.value(),244);
    f.event(f.document,'pointermove',{pointerId:1,clientX:360});assert.equal(f.value(),360);
    f.event(f.document,'pointerup',{pointerId:1});assert.equal(f.saved().width,360);
    f.click();assert.equal(f.document.body.style.getPropertyValue('--sidebar-width'),'72px');assert.equal(f.handle.hidden,true);
    f.click();assert.equal(f.document.body.style.getPropertyValue('--sidebar-width'),'360px');
    f.event(f.handle,'pointerdown',{button:0,pointerId:3,clientX:360});
    f.event(f.document,'pointermove',{pointerId:3,clientX:4000});assert.equal(f.value(),480);
    f.event(f.document,'pointermove',{pointerId:3,clientX:-1000});assert.equal(f.value(),220);
    f.event(f.document,'pointerup',{pointerId:3});assert.equal(f.saved().width,220);
  }finally{f.close();}
});
test('Escape, pointer cancellation and blur abandon an unfinished resize',()=>{
  const f=fixture();try{
    for(const stop of ['Escape','pointercancel','blur']){
      f.event(f.handle,'pointerdown',{button:0,pointerId:1,clientX:244});
      f.event(f.document,'pointermove',{pointerId:1,clientX:420});assert.equal(f.value(),420);
      if(stop==='Escape')f.event(f.document,'keydown',{key:'Escape'});
      else if(stop==='blur')f.window.dispatchEvent(new f.window.Event('blur'));
      else f.event(f.document,stop,{pointerId:1});
      assert.equal(f.value(),244);assert.equal(f.document.body.classList.contains('sidebar-resizing'),false);assert.equal(f.saved(),null);
    }
  }finally{f.close();}
});
test('saved layout survives reinstall; a small viewport does not overwrite the preferred desktop width',()=>{
  const f=fixture({saved:JSON.stringify({width:440,collapsed:true})});try{
    assert.equal(f.document.body.classList.contains('sidebar-collapsed'),true);
    f.resize(390);assert.equal(f.document.querySelector('#appSidebar').inert,true);assert.equal(f.handle.hidden,true);
    f.click();assert.equal(f.document.querySelector('#appSidebar').inert,false);
    f.document.querySelector('#sidebarBackdrop').click();assert.equal(f.document.querySelector('#mobileMenu').getAttribute('aria-expanded'),'false');
    f.resize(900);f.click();assert.equal(f.value(),380);assert.equal(f.saved().width,440);
    f.resize(1440);assert.equal(f.value(),440);
    f.layout.destroy();const again=installSidebarLayout(f);assert.equal(f.value(),440);assert.equal(f.document.body.classList.contains('sidebar-collapsed'),false);again.destroy();
  }finally{f.close();}
});
test('icon rail opens folders, keyboard resizing and double click reset work without touching collections',()=>{
  const f=fixture();try{
    f.window.localStorage.setItem('collection-sentinel','unchanged');f.click();
    f.document.querySelector('#bookmarkSection>summary').click();assert.equal(f.document.querySelector('#bookmarkSection').open,true);assert.equal(f.document.body.classList.contains('sidebar-collapsed'),false);
    f.event(f.handle,'keydown',{key:'ArrowRight'});assert.equal(f.value(),260);
    f.event(f.handle,'keydown',{key:'ArrowRight',shiftKey:true});assert.equal(f.value(),300);
    f.handle.dispatchEvent(new f.window.MouseEvent('dblclick',{bubbles:true}));assert.equal(f.value(),244);assert.equal(f.saved().width,244);
    assert.equal(f.window.localStorage.getItem('collection-sentinel'),'unchanged');
  }finally{f.close();}
});
test('malformed or blocked preference storage leaves layout usable',()=>{
  for(const options of [{saved:'invalid json'},{saved:JSON.stringify({width:'5000',collapsed:'false'})},{blocked:true}]){
    const f=fixture(options);try{assert.equal(f.value(),244);f.click();f.click();assert.equal(f.value(),244);}finally{f.close();}
  }
});
