import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {renderBookmarkCard,bookmarkPreviewIndex,bookmarkPreviewKey} from '../extension/bookmark-cards.js';
import {renderWebCollection} from '../extension/web-collection-render.js';

const date=1762000000000,url='https://www.xiaohongshu.com/explore/abcdef0123456789abcdef01';
const first={id:'saved-one',url,title:'第一篇：安静的阅读空间',note:'把这份空间设计留给下一次整理。',savedAt:date,createdAt:date,updatedAt:date,readAt:null,deletedAt:null,starred:false,
  preview:{summary:'从采光、材质与收纳开始，安排一个能专注阅读的角落。'.repeat(9),siteName:'小红书',author:'示例作者',publishedAt:'2026-10-30',coverRef:'webCover:fixture-a'}};
const dom=html=>new JSDOM(html).window.document;

test('native bookmark uses the same cover, full summary, byline and note markup as the web card',()=>{
  const bookmark={id:'native-one',title:'xiaohongshu.com',url:url+'?xsec_source=bookmark',dateAdded:date};
  const index=bookmarkPreviewIndex([first]);
  const native=dom(renderBookmarkCard(bookmark,{sharedItem:index.get(bookmarkPreviewKey(bookmark.url)),folderPath:'书签栏 / 阅读'}));
  const web=dom(renderWebCollection({items:[first],revision:1}));
  for(const selector of ['.web-card-summary','.web-byline','.web-card-note'])assert.equal(native.querySelector(selector).outerHTML,web.querySelector(selector).outerHTML,selector);
  assert.equal(native.querySelector('.web-card-title').textContent,first.title);assert.ok(native.querySelector('.web-card-summary p').textContent.length>180,'the native view no longer truncates to 180 characters');
  assert.equal(native.querySelector('.web-card-cover img').dataset.coverRef,'webCover:fixture-a');assert.equal(native.querySelector('.web-card-cover img').getAttribute('src'),null,'metadata contains no eager image bytes');
  assert.equal(native.querySelector('.web-card-cover').dataset.dragBookmark,bookmark.id);assert.equal(native.querySelector('.web-card-title').href,bookmark.url);
  assert.equal(bookmark.title,'xiaohongshu.com','display title never renames the native bookmark');
  assert.equal(native.querySelector('[data-action="webDelete"]'),null);assert.ok(native.querySelector('[data-action="archiveOne"]'));
});

test('sharing parameters and note routes match, while different notes, origins and normal query pages remain independent',()=>{
  const second={...first,id:'saved-two',url:url.replace(/01$/,'02'),title:'第二篇：另一份内容',preview:{summary:'和阅读空间无关的另一篇内容',coverRef:'webCover:fixture-b'}};
  const index=bookmarkPreviewIndex([first,second,{...first,id:'deleted',deletedAt:date,updatedAt:date+1}]);
  const route='https://www.xiaohongshu.com/discovery/item/abcdef0123456789abcdef01?xsec_token=another';
  assert.equal(index.get(bookmarkPreviewKey(route)).id,first.id);assert.equal(index.get(bookmarkPreviewKey(second.url)).id,second.id);
  assert.notEqual(bookmarkPreviewKey(route),bookmarkPreviewKey('https://evil.test/discovery/item/abcdef0123456789abcdef01'));
  assert.notEqual(bookmarkPreviewKey('https://example.com/?id=1'),bookmarkPreviewKey('https://example.com/?id=2'));
  const page=dom(renderBookmarkCard({id:'two',url:second.url,title:'我的自定义标题'},{sharedItem:index.get(bookmarkPreviewKey(second.url))}));
  assert.equal(page.querySelector('.web-card-title').textContent,'我的自定义标题');assert.equal(page.querySelector('img').dataset.coverRef,'webCover:fixture-b');assert.ok(!page.body.textContent.includes('采光'));
});

test('web cards retain selected state and edited descriptions',()=>{
  const data={revision:1,items:[first,{...first,id:'deleted',url:'https://example.com/',title:'另一张卡片',readAt:date,preview:{descriptionEdited:true,description:'我的摘要',cover:'data:image/png;base64,AAAA'}}]};
  const page=dom(renderWebCollection(data,{selected:new Set([first.id])}));
  assert.equal(page.querySelectorAll('.web-card').length,2);
  assert.equal(page.querySelectorAll('input[type="checkbox"]:checked').length,1);
  assert.match(page.body.textContent,/我的摘要/);
});
