import assert from 'node:assert/strict';
import {readFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const extension=path.join(root,'extension');
const manifest=JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8'));
const metadata=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
assert.equal(manifest.manifest_version,3);
assert.equal(manifest.version,metadata.version,'Manifest and npm versions must match');
assert.equal(manifest.background.type,'module');
assert.equal(metadata.license,'MIT');
const files=[];
async function walk(dir){
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    assert.ok(!entry.isSymbolicLink(),`Symlinks are not allowed: ${full}`);
    if(entry.isDirectory())await walk(full);else if(entry.isFile())files.push(full);
  }
}
await walk(extension);
let references=0;
async function resource(owner,reference,boundary=extension){
  if(!reference||reference.startsWith('#')||/^[a-z][a-z\d+.-]*:/i.test(reference)||reference.startsWith('//'))return;
  const clean=decodeURIComponent(reference.split(/[?#]/)[0]);
  const target=path.resolve(path.dirname(owner),clean);
  assert.ok(target.startsWith(boundary+path.sep),`Resource escapes its directory: ${reference}`);
  assert.ok((await stat(target)).isFile(),`Missing file: ${reference}`);
  references++;
}
const manifestRefs=[manifest.options_page,manifest.background.service_worker,manifest.action.default_popup,...Object.values(manifest.icons),...Object.values(manifest.action.default_icon)];
for(const ref of manifestRefs)await resource(path.join(extension,'manifest.json'),ref);
for(const file of files){
  if(!/\.(js|html|css)$/.test(file))continue;
  const value=await readFile(file,'utf8');
  if(file.endsWith('.js')){
    for(const match of value.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(['"])(\.[^'"]+)\1/g))await resource(file,match[2]);
  }else if(file.endsWith('.html')){
    for(const match of value.matchAll(/\b(?:src|href)\s*=\s*['"]([^'"]+)['"]/g))await resource(file,match[1]);
  }else{
    for(const match of value.matchAll(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/g))await resource(file,match[1]);
  }
}
const docs=[path.join(root,'README.md'),path.join(root,'README.en.md'),path.join(root,'CONTRIBUTING.md'),path.join(root,'SECURITY.md'),...(await readdir(path.join(root,'docs'))).filter(name=>name.endsWith('.md')).map(name=>path.join(root,'docs',name))];
for(const file of docs){
  const value=await readFile(file,'utf8');
  for(const match of value.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g))await resource(file,match[1],root);
}
console.log(JSON.stringify({version:manifest.version,runtime_files:files.length,checked_references:references,documentation_files:docs.length}));
