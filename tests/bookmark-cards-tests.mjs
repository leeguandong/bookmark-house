import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {renderBookmarkCard,bookmarkPreviewIndex,bookmarkPreviewKey} from '../extension/bookmark-cards.js';
import {collectionCardData} from '../extension/collection-card.js';

const item={id:'one',title:'标题 <script>alert(1)</script>',url:'https://example.com/article',dateAdded:1762000000000};
test('cards retain safe links and real text, escape all content and load no remote images',()=>{
  const page=new JSDOM(renderBookmarkCard(item,{selected:true,note:{note:'我的笔记 <img src=x onerror=alert(1)>'},sharedItem:{preview:{summary:'共享摘要'}},folderPath:'工作 / <参考>',category:'学习与阅读'}));
  const d=page.window.document;
  assert.equal(d.querySelectorAll('script,img').length,0);assert.equal(d.querySelector('a').href,item.url);assert.equal(d.querySelector('a').rel,'noopener noreferrer');
  assert.ok(d.querySelector('.web-card-note p').textContent.includes('<img'));assert.equal(d.querySelector('.web-card-summary p').textContent,'共享摘要');
  assert.ok(d.querySelector('[data-select]').checked);assert.equal(d.querySelector('.bookmark-card.selected')?.getAttribute('data-bookmark-card'),'one');
  assert.ok(d.querySelector('[data-drag-bookmark]'));assert.equal(d.querySelectorAll('[data-action]').length,4);assert.equal(d.querySelector('.bookmark-card-folder').textContent,'工作 / <参考>');page.window.close();
});

test('missing summaries use the exact address; protected and unsafe bookmarks never gain destructive or runnable controls',()=>{
  const page=new JSDOM(renderBookmarkCard({...item,managed:true,url:'javascript:alert(1)'},{duplicateLabel:'建议保留'})),d=page.window.document;
  assert.equal(d.querySelector('a'),null);assert.equal(d.querySelector('[data-drag-bookmark]'),null);assert.equal(d.querySelector('[data-select]').disabled,true);
  assert.equal(d.querySelector('[data-action="archiveOne"]').disabled,true);assert.equal(d.querySelector('[data-action="edit"]').disabled,true);assert.equal(d.querySelector('[data-action="moveOne"]').disabled,true);
  assert.equal(d.querySelector('.bookmark-card-chip').textContent,'受管理');assert.equal(d.querySelector('.bookmark-card-excerpt'),null);assert.equal(d.querySelector('.bookmark-card-address').textContent,'javascript:alert(1)');
  assert.ok(!d.body.textContent.includes('待补全'));page.window.close();
});

test('shared preview text ignores deleted cards and generic Xiaohongshu descriptions, honors edited descriptions and remains bounded',()=>{
  const xhs='https://www.xiaohongshu.com/explore/abcdef0123456789abcdef01';
  const index=bookmarkPreviewIndex([
    {url:'https://example.com',deletedAt:1,note:'已删除笔记'},
    {url:'https://example.com/',preview:{summary:'已有摘要'}},
    {url:xhs,preview:{summary:'小红书是年轻人的生活方式平台，你的生活指南'}},
    {url:'https://edited.test/',preview:{descriptionEdited:true,description:'手动改好的简介',summary:'旧摘要'}},
    {url:'https://note.test/',note:' '.repeat(3),preview:{summary:'长'.repeat(1000)}}
  ]);
  assert.equal(collectionCardData(index.get('https://example.com/')).preview.summary,'已有摘要');assert.equal(collectionCardData(index.get(bookmarkPreviewKey(xhs))).preview.summary,'');assert.equal(collectionCardData(index.get('https://edited.test/')).preview.summary,'手动改好的简介');assert.equal(collectionCardData(index.get('https://note.test/')).preview.summary.length,420);
  const html=renderBookmarkCard(item,{note:{note:'  ',text:'完整正文中的第一段'},sharedItem:{preview:{summary:'共享摘要'}}});assert.ok(html.includes('完整正文中的第一段'));assert.ok(!html.includes('共享摘要'));
});

test('trash folder cards show contents and restore controls, while duplicate cards distinguish keepers',()=>{
  const page=new JSDOM(renderBookmarkCard({id:'trash:one',title:'原文件夹',inTrash:true},{contents:{bookmarkCount:5,folderCount:2},folderPath:'书签栏 / 工作'})),d=page.window.document;
  assert.equal(d.querySelector('[data-drag-bookmark]'),null);assert.ok(d.querySelector('.bookmark-card-excerpt').textContent.includes('5 条书签 · 2 个子文件夹'));assert.ok(d.querySelector('[data-action="inspectTrashFolder"]'));assert.ok(d.querySelector('[data-action="restoreOne"]'));assert.equal(d.querySelector('[data-action="archiveOne"]'),null);page.window.close();
  assert.ok(renderBookmarkCard(item,{duplicateLabel:'建议保留'}).includes('is-keeper'));assert.ok(renderBookmarkCard(item,{duplicateLabel:'重复收藏'}).includes('is-duplicate'));
});
