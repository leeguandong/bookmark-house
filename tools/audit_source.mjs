// Offline scan of the exact Git index/working files. Never prints matched values.
import {createEngine} from '@secretlint/node';
import {execFileSync} from 'node:child_process';
import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const staged=process.argv.includes('--staged');
const skip=new Set(['.git','node_modules','__pycache__','audit-output']);
const engine=await createEngine({cwd:root,formatter:'json',color:false,maskSecrets:true});
let names;
try{
  const args=staged?['diff','--cached','--name-only','--diff-filter=ACMR','-z']:['ls-files','-z'];
  names=execFileSync('git',args,{cwd:root,stdio:['ignore','pipe','ignore']}).toString('utf8').split('\0').filter(Boolean);
}catch{
  if(staged)throw new Error('Staged audit requires a Git repository');
  const walk=async(dir)=>{
    const items=[];
    for(const entry of await readdir(dir,{withFileTypes:true})){
      if(skip.has(entry.name))continue;
      const full=path.join(dir,entry.name);
      if(entry.isDirectory())items.push(...await walk(full));
      else if(entry.isFile())items.push(path.relative(root,full).split(path.sep).join('/'));
    }
    return items;
  };
  names=await walk(root);
}
const findings=[];let scanned=0,binary=0;
for(const name of names.sort()){
  const bytes=staged?execFileSync('git',['show',':'+name],{cwd:root,maxBuffer:10*1024*1024}):await readFile(path.join(root,name));
  if(bytes.includes(0)||/\.(png|jpe?g|gif|ico)$/i.test(name)){binary++;continue;}
  scanned++;
  const result=await engine.executeOnContent({content:bytes.toString('utf8'),filePath:path.join(root,name)});
  const parsed=JSON.parse(result.output);
  // JSON formatters may retain original source: report only allowlisted metadata.
  if(!Array.isArray(parsed))throw new Error('Unexpected scanner output');
  const messages=parsed.flatMap(item=>item.messages||[]);
  if(!result.ok&&!messages.length)throw new Error('Scanner failed without a structured finding');
  for(const message of messages)findings.push({file:name,line:message.line??message.loc?.start?.line??null,rule:message.ruleId??'secretlint'});
}
console.log(JSON.stringify({scanner:'Secretlint',version:'13.1.0',mode:staged?'staged':'files',scanned_text_files:scanned,binary_files:binary,findings}));
process.exitCode=findings.length?1:0;
