import {t as uiText,msg as uiMessage} from './i18n.js';
import {englishText} from './i18n.js';
import {findDuplicates,isLoose,folderContents,treeSignature} from './core.js';
import {analyzeBookmarks} from './analytics.js';

export const ORGANIZE_DEFAULTS={scopeId:'all',targetId:'',mode:'gentle',classify:true,dedupe:true,merge:true,empty:true,minGroup:2};
const normalized=name=>String(name||'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
const aliases={
  'AI 与模型':['ai','ai工具','ai 工具','人工智能','模型','模型库','机器学习','大模型'],
  '开发与技术':['开发工具','开发','编程','技术','代码','开发文档'],
  '工作与文档':['工作','工作文档','办公','文档'],
  '设计与创作':['设计灵感','设计','创作','设计素材','素材'],
  '学习与阅读':['慢慢读','阅读','学习','读书','课程','论文'],
  '生活与购物':['生活','购物','旅行','美食'],
  '影音与社区':['影音','视频','社区','音乐']
};
const folderLabel=node=>[node.path,node.title].filter(Boolean).join(' / ');
const matchesTopic=(folder,topic)=>[topic,englishText(topic)].some(name=>normalized(folder.title)===normalized(name))||(aliases[topic]||[]).some(alias=>normalized(alias)===normalized(folder.title));
function within(model,node,id){if(id==='all')return true;let n=node;while(n){if(n.id===id)return true;n=model.nodes.get(n.parentId);}return false;}
function protectedFolder(model,folder,meta){return folder.depth<=1||folder.folderType||folder.inTrash||folderContents(model,folder.id).ids.some(id=>{const n=model.nodes.get(id);return n.managed||id===meta.homeId||id===meta.trashId;});}

export function buildOrganizationPlan(model,{meta={},notes={},customTopics=[],settings={}}={}){
  const options={...ORGANIZE_DEFAULTS,...settings};
  const target=model.nodes.get(options.targetId);
  if(!target||target.url!==undefined||target.depth===0||target.managed||target.inTrash)throw new Error(uiText("请选择可写入的分类位置。"));
  if(options.scopeId!=='all'&&(!model.nodes.has(options.scopeId)||model.nodes.get(options.scopeId).inTrash))throw new Error(uiText("整理范围已变化，请重新选择。"));
  options.minGroup=Math.max(1,Math.min(20,Number(options.minGroup)||2));
  const books=model.bookmarks.filter(b=>!b.inTrash),scoped=books.filter(b=>within(model,b,options.scopeId)),steps=[],review=[],reserved=new Set(),mergeTargets=new Set();
  const folders=model.folders.filter(f=>!f.inTrash&&within(model,f,options.scopeId));
  // Only sibling folders with exactly the same normalized name are merged.
  if(options.merge){
    const groups=new Map();
    for(const f of folders){if(protectedFolder(model,f,meta)||!f.title.trim()||f.id===target.id)continue;const key=`${f.parentId}\0${normalized(f.title)}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(f);}
    for(const group of groups.values()){
      if(group.length<2)continue;
      const sorted=group.sort((a,b)=>a.index-b.index),keep=sorted[0];
      if(reserved.has(keep.id))continue;
      for(const source of sorted.slice(1)){
        const contents=folderContents(model,source.id);
        if(reserved.has(source.id)||contents.ids.includes(target.id)||!source.children?.length)continue;
        contents.ids.forEach(id=>reserved.add(id));mergeTargets.add(keep.id);
        steps.push({key:`merge:${source.id}`,type:'merge',id:source.id,title:source.title,from:folderLabel(source),to:folderLabel(keep),targetId:keep.id,reason:uiText("同一父目录下名称一致；内容移入保留目录，原空目录移入回收站"),moves:source.children.map(n=>({id:n.id,parentId:keep.id})),archiveIds:[source.id],bookmarkCount:contents.bookmarkCount,folderCount:contents.folderCount});
      }
    }
  }
  if(options.dedupe){
    for(const group of findDuplicates(scoped)){
      const rank=b=>(b.managed?1000:0)+(notes[b.id]?.text||notes[b.id]?.note?100:0)+(!isLoose(b,model)?10:0);
      const keep=[...group].sort((a,b)=>rank(b)-rank(a)||(a.dateAdded||0)-(b.dateAdded||0)||a.id.localeCompare(b.id))[0];
      for(const b of group){if(b.id===keep.id||b.managed||!within(model,b,options.scopeId)||reserved.has(b.id))continue;reserved.add(b.id);steps.push({key:`duplicate:${b.id}`,type:'dedupe',id:b.id,title:b.title,from:b.path,to:uiText("小屋回收站（仅本地）"),reason:uiMessage`网址完全一致；保留「${keep.title}」于 ${keep.path}`,keeperId:keep.id,archiveIds:[b.id],moves:[]});}
    }
  }
  const analysis=analyzeBookmarks(model,{notes,customTopics}),byId=new Map(analysis.items.map(item=>[item.id,item]));
  const topicsByFolder=new Map();
  for(const item of analysis.items){const b=model.nodes.get(item.id);if(b.managed||reserved.has(b.id)||!item.evidence.some(e=>!e.startsWith('文件夹：')))continue;let stats=topicsByFolder.get(b.parentId);if(!stats){stats={total:0,counts:new Map()};topicsByFolder.set(b.parentId,stats);}stats.total++;stats.counts.set(item.topicName,(stats.counts.get(item.topicName)||0)+1);}
  const targets=new Map(),pending=new Map();
  if(options.classify){
    for(const b of scoped){
      if(b.managed||reserved.has(b.id)||(options.mode!=='complete'&&!isLoose(b,model)&&b.parentId!==options.scopeId))continue;
      const item=byId.get(b.id);
      if(!item||item.topicId==='unknown'||!item.evidence.some(e=>!e.startsWith('文件夹：'))){review.push({id:b.id,title:b.title,reason:uiText("内容线索不足，保留原位置")});continue;}
      const topic=item.topicName,displayTopic=item.topicId.startsWith('builtin:')?uiText(topic):topic;
      if(b.parentId===target.id&&matchesTopic(target,topic))continue;
      if(!targets.has(topic)){
        const candidates=model.folders.filter(f=>f.id!==target.id&&f.depth>1&&!f.managed&&!f.inTrash&&!reserved.has(f.id)&&f.id!==meta.homeId&&within(model,f,target.id)).map(f=>{
          const stats=topicsByFolder.get(f.id),matches=matchesTopic(f,topic),count=stats?.counts.get(topic)||0;
          return {folder:f,score:matches?100:count>=2&&count/stats.total>=.75?50:0};
        }).filter(c=>c.score).sort((a,b)=>b.score-a.score||a.folder.depth-b.folder.depth||a.folder.index-b.folder.index);
        targets.set(topic,candidates[0]?.folder||null);
      }
      const destination=targets.get(topic);
      if(destination&&within(model,b,destination.id))continue;
      const step={key:`classify:${b.id}`,type:'classify',id:b.id,title:b.title,from:b.path,to:destination?folderLabel(destination):`${folderLabel(target)} / ${displayTopic}`,targetId:destination?.id||null,targetRef:destination?null:`topic:${topic}`,newTitle:destination?null:displayTopic,reason:item.evidence.join('；'),moves:[],archiveIds:[]};
      if(!pending.has(topic))pending.set(topic,[]);pending.get(topic).push(step);
    }
    for(const group of pending.values()){
      if(!group[0].targetId&&group.length<options.minGroup){for(const s of group)review.push({id:s.id,title:s.title,reason:uiMessage`同主题只有 ${group.length} 条，未达到建目录的 ${options.minGroup} 条门槛`});continue;}
      steps.push(...group);
    }
  }
  if(options.empty){for(const f of folders){if(f.id===target.id||f.children?.length||reserved.has(f.id)||mergeTargets.has(f.id)||protectedFolder(model,f,meta))continue;steps.push({key:`empty:${f.id}`,type:'empty',id:f.id,title:f.title,from:folderLabel(f),to:uiText("小屋回收站（仅本地）"),reason:uiText("当前为空目录；移入回收站后仍可还原"),moves:[],archiveIds:[f.id]});}}
  // Destination folders must never be archived by another step.
  const usedTargets=new Set(steps.map(s=>s.targetId).filter(Boolean));
  const safeSteps=steps.filter(s=>s.type!=='empty'||!usedTargets.has(s.id));
  return {schemaVersion:1,generatedAt:Date.now(),signature:treeSignature(model),homeId:meta.homeId,trashId:meta.trashId,settings:options,scanned:scoped.length,protectedCount:scoped.filter(b=>b.managed).length,steps:safeSteps,review};
}

export function organizationSummary(plan,keys){
  const selected=keys?new Set(keys):null,steps=plan.steps.filter(s=>!selected||selected.has(s.key)),counts={classify:0,dedupe:0,merge:0,empty:0};
  for(const s of steps)counts[s.type]++;
  return {...counts,total:steps.length,newFolders:new Set(steps.filter(s=>s.targetRef).map(s=>s.targetRef)).size,reusedFolders:new Set(steps.filter(s=>s.type==='classify').map(s=>s.targetId).filter(Boolean)).size};
}
