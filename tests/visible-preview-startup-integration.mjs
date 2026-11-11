import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {WebCollectionView} from '../extension/web-collection-view.js';

test('opening a collection reads no remote pages; only rendered cards are checked later and hidden views do no work',async()=>{
  const page=new JSDOM('<section id="cards"></section>',{pretendToBeVisual:true,url:'https://synthetic.test/'});
  const previousChrome=globalThis.chrome;globalThis.chrome={permissions:{}};
  const now=Date.now(),data={version:1,revision:1,cacheToken:'visible-cards',items:Array.from({length:80},(_,i)=>({id:'item-'+i,url:'https://pages.test/'+i,title:'文章 '+i,savedAt:now-i,starred:false,readAt:null,deletedAt:null,note:'',preview:{}}))};
  const container=page.window.document.querySelector('#cards'),view=new WebCollectionView({container,repository:{read:async()=>data,covers:async()=>new Map()},getModel:()=>({bookmarks:[]}),getSearch:()=>'',onCount:()=>{}}),reads=[];
  view.autoPreview.read=async url=>{reads.push(url);return null;};
  try{
    await view.refresh();assert.equal(reads.length,0,'metadata loading does not initiate page extraction');
    view.render();assert.equal(reads.length,0,'cards render before extraction');
    container.hidden=true;await new Promise(resolve=>setTimeout(resolve,900));assert.equal(reads.length,0,'leaving the collection cancels pending startup extraction');
    container.hidden=false;view.render();
    for(let i=0;i<150&&reads.length<24;i++)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(reads.length,24,'older cards beyond the displayed first page are not queued');
    assert.deepEqual(new Set(reads),new Set(data.items.slice(0,24).map(item=>item.url)));
    await view.autoPreview.job;
  }finally{clearTimeout(view.previewTimer);globalThis.chrome=previousChrome;page.window.close();}
});
