import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {t,msg,html,setLanguage,locale,normalizeLanguage,date,folderTitle} from '../extension/i18n.js';
import {groupByDay} from '../extension/collection-list.js';
import {analyzeBookmarks,localizedAnalysis,parseTopicRules} from '../extension/analytics.js';
import {flatten} from '../extension/core.js';

test('Chinese and English normalize predictably and translate in both directions',()=>{
  assert.equal(normalizeLanguage('zh-TW'),'zh-CN');assert.equal(normalizeLanguage('en-GB'),'en');
  setLanguage('en',{persist:false});assert.equal(t('保存网页'),'Save webpage');
  assert.equal(msg`已保存 ${1} 个网页。`,'Saved 1 webpage.');
  setLanguage('zh-CN',{persist:false});assert.equal(t('Save webpage'),'保存网页');
});

test('authored HTML is translated before interpolation; saved content is never searched',()=>{
  setLanguage('en',{persist:false});
  const saved='保存网页 <img src=x onerror=alert(1)>',escaped='保存网页 &lt;img src=x onerror=alert(1)&gt;';
  const result=html`<button title="保存网页">保存网页</button><p>${escaped}</p>`;
  assert.match(result,/>Save webpage<\/button>/);assert.ok(result.includes(escaped));assert.ok(!result.includes('<img'));
  assert.equal(html`<p>${saved}</p>`,`<p>${saved}</p>`,'the helper must not reinterpret or modify interpolated values');
  assert.equal(msg`当前网页已切换，请重新打开收藏入口。`,'The active webpage has changed. Reopen the save popup.');
});

test('dates follow the selected locale without changing grouping keys',()=>{
  const timestamp=new Date(2026,10,1,12).getTime(),now=new Date(2026,10,11,12).getTime();
  setLanguage('en',{persist:false});assert.match(date(timestamp,{month:'long',day:'numeric'}),/November/);
  const english=groupByDay([{savedAt:timestamp}],now)[0];assert.equal(english.label,'November 1');
  setLanguage('zh-CN',{persist:false});const chinese=groupByDay([{savedAt:timestamp}],now)[0];
  assert.equal(chinese.key,english.key);assert.match(chinese.label,/11月1日/);
});

test('native root labels can change language while custom folder names stay intact',()=>{
  setLanguage('en',{persist:false});assert.equal(folderTitle({title:'书签栏',depth:1}),'Bookmarks bar');
  assert.equal(folderTitle({title:'书签栏',depth:2}),'书签栏');assert.equal(folderTitle({title:'保存网页',depth:2}),'保存网页');
});

test('analysis keeps stable IDs and original matching evidence, and preserves custom topic names',()=>{
  setLanguage('en',{persist:false});
  const model=flatten([{id:'0',title:'',children:[{id:'1',title:'书签栏',children:[{id:'2',title:'我的内容',url:'https://example.test/custom',dateAdded:Date.now()}]}]}]);
  const topics=parseTopicRules('我的主题：我的内容'),report=analyzeBookmarks(model,{customTopics:topics});
  const shown=localizedAnalysis(report);
  assert.equal(shown.topics[0].name,'我的主题');assert.equal(shown.topics[0].id,report.topics[0].id);
  assert.ok(report.items[0].evidence[0].startsWith('标题：'));assert.ok(shown.items[0].evidence[0].startsWith('Title:'));
  assert.equal(shown.items[0].title,'我的内容');assert.equal(shown.items[0].topicName,'我的主题');
  setLanguage('zh-CN',{persist:false});
});

test('native Chrome locale messages cover the same manifest keys without extra permissions',async()=>{
  const load=async path=>JSON.parse(await readFile(new URL('../extension/'+path,import.meta.url),'utf8'));
  const [manifest,en,zh]=await Promise.all([load('manifest.json'),load('_locales/en/messages.json'),load('_locales/zh_CN/messages.json')]);
  assert.equal(manifest.default_locale,'en');assert.deepEqual(Object.keys(en),Object.keys(zh));
  assert.equal(en.extensionName.message.startsWith('Bookmark House'),true);
  assert.deepEqual(manifest.permissions,['bookmarks','activeTab','contextMenus','scripting']);
  for(const value of [manifest.name,manifest.description,manifest.action.default_title,manifest.commands['save-current-page'].description]){
    const key=/^__MSG_(.+)__$/.exec(value)[1];assert.ok(en[key]?.message);assert.ok(zh[key]?.message);
  }
});
