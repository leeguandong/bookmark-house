import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';
import {JSDOM} from 'jsdom';
import english from '../extension/locales/en.js';

const root=path.resolve(fileURLToPath(new URL('../extension',import.meta.url)));
let references=0;
function check(key,location){
  if(!/[\u3400-\u9fff]/.test(key))return;
  assert.ok(Object.hasOwn(english,key),`Missing English message in ${location}: ${key}`);references++;
}
for(const [key,value] of Object.entries(english)){
  assert.ok(typeof value==='string'&&value.length,`Empty English translation: ${key}`);
  assert.ok(!/[\u3400-\u9fff]/.test(value),`Chinese text in an English message: ${key}`);
  assert.deepEqual([...key.matchAll(/\{\d+\}/g)].map(m=>m[0]).sort(),[...value.matchAll(/\{\d+\}/g)].map(m=>m[0]).sort(),`Placeholder mismatch: ${key}`);
}
for(const file of fs.readdirSync(root).filter(name=>name.endsWith('.js'))){
  const ast=parse(fs.readFileSync(path.join(root,file),'utf8'),{ecmaVersion:'latest',sourceType:'module'});
  function walk(node){
    if(!node?.type)return;
    if(node.type==='CallExpression'&&['uiText','bootText'].includes(node.callee.name)&&typeof node.arguments[0]?.value==='string')check(node.arguments[0].value,file);
    if(node.type==='TaggedTemplateExpression'&&['uiMessage','bootMessage'].includes(node.tag.name))check(node.quasi.quasis.map((part,index)=>part.value.cooked+(index<node.quasi.expressions.length?'{'+index+'}':'')).join(''),file);
    if(node.type==='TaggedTemplateExpression'&&node.tag.name==='uiHtml')for(const part of node.quasi.quasis)for(const match of part.value.cooked.matchAll(/[^<>"'\n]+/g))check(match[0].trim(),file);
    for(const value of Object.values(node))if(Array.isArray(value))value.forEach(walk);else if(value?.type)walk(value);
  }
  walk(ast);
}
for(const file of fs.readdirSync(root).filter(name=>name.endsWith('.html'))){
  const dom=new JSDOM(fs.readFileSync(path.join(root,file),'utf8'));
  for(const element of dom.window.document.querySelectorAll('*'))for(const attr of element.attributes)if(attr.name==='data-i18n'||attr.name.startsWith('data-i18n-')&&attr.name!=='data-i18n-once')check(attr.value,file);
  dom.window.close();
}
console.log(JSON.stringify({english_messages:Object.keys(english).length,checked_references:references,languages:['zh-CN','en']}));
