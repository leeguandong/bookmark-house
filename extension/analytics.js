import {t as uiText,msg as uiMessage,html as uiHtml,locale as uiLocale,date as uiDate} from './i18n.js';
import {findDuplicates, isLoose, escapeHtml as e, safeOpenUrl,normalizedUrl} from './core.js';

export const DEFAULT_TOPICS = [
  {id:'ai',name:'AI 与模型',terms:['人工智能','机器学习','深度学习','大模型','模型库','超分辨率','pytorch','tensorflow','huggingface','modelscope','openai','chatgpt','claude','llm','diffusion']},
  {id:'dev',name:'开发与技术',terms:['开发','编程','代码','github','gitlab','stackoverflow','developer','javascript','typescript','python','docker','kubernetes','api','mdn']},
  {id:'work',name:'工作与文档',terms:['文档','工作','标注','验收','管理后台','项目','notion','feishu','lark','yinxiang','evernote','iflytek','xfchat','docs.google']},
  {id:'design',name:'设计与创作',terms:['设计','配色','素材','摄影','创作','figma','dribbble','behance','canva','pinterest','unsplash']},
  {id:'read',name:'学习与阅读',terms:['学习','阅读','教程','课程','论文','文献','读书','笔记','wikipedia','coursera','arxiv','readthedocs','douban','百科']},
  {id:'life',name:'生活与购物',terms:['生活','购物','旅行','旅游','美食','taobao','jd.com','amazon','meituan','ctrip','trip.com']},
  {id:'community',name:'影音与社区',terms:['视频','电影','音乐','社区','youtube','bilibili','zhihu','xiaohongshu','weibo','reddit','twitter','spotify','netflix']}
];
const STOP = new Set('the and for with from this that your you are was have has not our its into how what when why about using use used can will new get home com org net www http https html index page docs documentation official website 你的 我的 我们 这个 那个 一个 一些 什么 如何 可以 进行 使用 通过 已经 以及 相关 内容 首页 官网 官方 网站 页面 在线 收藏 书签 小屋 介绍 简介 更多 最新 分享 每日 以后 再看 测试 出来 全书 自由 每个 发现 空间'.split(/\s+/));
const SHORT = new Set(['ai','sr','ui','ux','js','3d']);
const DAY = 86400000;
const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined,{granularity:'word'}) : null;
const compare = (a,b) => b.count-a.count || a.name?.localeCompare(b.name,uiLocale()) || 0;
const percentage = (count,total) => total ? Math.round(count/total*1000)/10 : 0;

export function parseTopicRules(text) {
  const lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if(lines.length>20) throw new Error(uiText("最多可以定义 20 个自定义主题。"));
  const names=new Set();
  return lines.map(line=>{
    const divider=line.search(/[:：]/);
    if(divider<1) throw new Error(uiText("每行请使用“主题名称：关键词，关键词”的格式。"));
    const name=line.slice(0,divider).trim(),terms=[...new Set(line.slice(divider+1).split(/[,，;；]/).map(s=>s.trim().toLowerCase()).filter(Boolean))];
    if(!name||name.length>40||!terms.length||terms.length>30||terms.some(t=>t.length>60)) throw new Error(uiText("主题名称最多 40 字，每个主题需要 1–30 个关键词，每词最多 60 字。"));
    if(names.has(name.toLowerCase()))throw new Error(uiText("主题名称不能重复。"));
    if(DEFAULT_TOPICS.some(t=>t.name===name))throw new Error(uiText("请为自定义主题取更具体的名称，避免与内置主题重名。"));
    names.add(name.toLowerCase());return {id:`custom:${name.toLowerCase()}`,name,terms,custom:true};
  });
}

export function topicRulesText(topics) {return topics.map(t=>`${t.name}：${t.terms.join('，')}`).join('\n');}

function wordTokens(text) {
  const input=String(text||'').toLowerCase().slice(0,40000).replace(/https?:\/\/\S+/g,' ');
  const words=segmenter ? Array.from(segmenter.segment(input),s=>s.isWordLike?s.segment:'') : input.match(/[a-z][a-z0-9+#.-]{1,30}|[\u4e00-\u9fff]{2,8}/g)||[];
  return words.filter(w=>!STOP.has(w)&&w.length>=2&&w.length<=30&&!/^\d+$/.test(w)&&(!/^[a-z]+$/.test(w)||w.length>=3||SHORT.has(w)));
}
function termMatcher(term) {
  if(/[\u4e00-\u9fff]/.test(term))return text=>text.includes(term);
  const escaped=term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const regex=new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`,'i');
  return text=>regex.test(text);
}
export function sourceName(url) {
  try {const u=new URL(url);if(u.protocol==='file:')return '本地文件';return u.hostname.replace(/^www\./,'')||'其他协议';}catch{return '无法解析的网址';}
}
function urlContext(url) {
  try {const u=new URL(url);let path=u.pathname;try{path=decodeURIComponent(path);}catch{}return `${u.hostname} ${path.slice(0,1000)}`.toLowerCase();}catch{return '';}
}
export function contentExcerpts(text,title='') {
  if(!text?.trim()) return [];
  const titleWords=new Set(wordTokens(title));
  const sentences=(text.match(/[^。！？!?\n]+[。！？!?]?/gu)||[]).map((text,index)=>({text:text.trim().slice(0,260),index})).filter(s=>s.text.length>=12);
  const frequency=new Map();for(const word of wordTokens(text))frequency.set(word,(frequency.get(word)||0)+1);
  const scored=sentences.map(s=>({...s,score:[...new Set(wordTokens(s.text))].reduce((n,w)=>n+Math.min(frequency.get(w)||0,5)+(titleWords.has(w)?3:0),0)/Math.sqrt(Math.max(1,s.text.length))}));
  return scored.sort((a,b)=>b.score-a.score).slice(0,3).sort((a,b)=>a.index-b.index).map(s=>s.text);
}

export function analyzeBookmarks(model, {notes={},customTopics=[],now=Date.now()}={}) {
  const books=model.bookmarks.filter(b=>!b.inTrash),total=books.length;
  const definitions=[...customTopics,...DEFAULT_TOPICS.map(t=>({...t,id:`builtin:${t.id}`}))].map(t=>({...t,matchers:t.terms.map(term=>({term,match:termMatcher(term)}))}));
  const topicMap=new Map(definitions.map(t=>[t.id,{id:t.id,name:t.name,custom:Boolean(t.custom),ids:[],evidence:new Set()}]));
  topicMap.set('unknown',{id:'unknown',name:'待识别主题',ids:[],evidence:new Set()});
  const sources=new Map(),keywords=new Map(),folders=new Map(),items=[],monthMap=new Map();
  const current=new Date(now),months=Array.from({length:12},(_,i)=>{const date=new Date(current.getFullYear(),current.getMonth()-11+i,1);return {key:`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`,label:uiDate(date,{month:'short'}),count:0,ids:[]};});
  months.forEach(m=>monthMap.set(m.key,m));
  const issues={loose:[],old:[],stale:[],unknownUse:[],weakTitle:[],duplicates:[],outdatedContent:[]};
  let withContent=0,validUse=0,unknownDates=0;
  for(const b of books){
    const saved=notes[b.id]||{},outdatedContent=Boolean(saved.url&&normalizedUrl(saved.url)!==normalizedUrl(b.url)&&(saved.text||saved.note)),body=outdatedContent?'':String(saved.text||''),note=outdatedContent?'':String(saved.note||'');
    if(outdatedContent)issues.outdatedContent.push(b.id);
    const contexts=[{name:'标题',text:String(b.title||'').toLowerCase(),weight:4},{name:'网址路径',text:urlContext(b.url),weight:2},{name:'文件夹',text:String(b.path||'').toLowerCase(),weight:1},{name:'补充内容',text:`${body} ${note}`.toLowerCase(),weight:2}];
    let winner=null,best=0,evidence=[];
    for(const t of definitions){let score=0,hits=[];for(const {term,match} of t.matchers){for(const context of contexts){if(context.text&&match(context.text)){score+=context.weight;hits.push(`${context.name}：${term}`);}}}if(score>0&&t.custom)score+=0.25;if(score>best){best=score;winner=t;evidence=[...new Set(hits)].slice(0,4);}}
    const topicId=winner?.id||'unknown',topic=topicMap.get(topicId);topic.ids.push(b.id);evidence.forEach(x=>topic.evidence.add(x));
    const source=sourceName(b.url);if(!sources.has(source))sources.set(source,{name:source,ids:[]});sources.get(source).ids.push(b.id);
    if(!folders.has(b.parentId))folders.set(b.parentId,{id:b.parentId,name:b.path||'顶层文件夹',ids:[]});folders.get(b.parentId).ids.push(b.id);
    for(const term of new Set(wordTokens(`${b.title||''} ${body} ${note}`))){if(!keywords.has(term))keywords.set(term,{term,ids:[]});keywords.get(term).ids.push(b.id);}
    if(isLoose(b,model)&&!b.managed)issues.loose.push(b.id);
    const added=b.dateAdded,used=b.dateLastUsed;
    if(Number.isFinite(added)&&added>0&&added<=now){const d=new Date(added),key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;const bucket=monthMap.get(key);if(bucket){bucket.count++;bucket.ids.push(b.id);}if(added<=now-180*DAY)issues.old.push(b.id);}else unknownDates++;
    if(Number.isFinite(used)&&used>0&&used<=now){validUse++;if(used<=now-90*DAY)issues.stale.push(b.id);}else issues.unknownUse.push(b.id);
    if(!(b.title||'').trim()||/^(untitled|无标题|新建标签页|new tab|https?:\/\/\S+)$/i.test((b.title||'').trim()))issues.weakTitle.push(b.id);
    if(body.trim())withContent++;
    items.push({id:b.id,title:b.title,url:b.url,path:b.path,topicId,topicName:topic.name,evidence,hasContent:Boolean(body.trim()),outdatedContent,excerpts:body.trim()?contentExcerpts(body,b.title):[],note:note.slice(0,2000)});
  }
  const groups=findDuplicates(books);for(const group of groups){const keep=group.find(b=>b.managed)||group[0];issues.duplicates.push(...group.filter(b=>b.id!==keep.id&&!b.managed).map(b=>b.id));}
  const topics=[...topicMap.values()].filter(t=>t.ids.length).map(t=>({...t,count:t.ids.length,share:percentage(t.ids.length,total),evidence:[...t.evidence].slice(0,6)})).sort(compare);
  const domains=[...sources.values()].map(d=>({...d,count:d.ids.length,share:percentage(d.ids.length,total)})).sort(compare);
  const folderRows=[...folders.values()].map(d=>({...d,count:d.ids.length,share:percentage(d.ids.length,total)})).sort(compare);
  const meaningfulTerms=new Set(definitions.flatMap(t=>t.terms.map(term=>term.toLowerCase())));
  const keywordRows=[...keywords.values()].map(k=>({...k,count:k.ids.length,score:k.ids.length*Math.log(1+Math.max(1,total)/k.ids.length)})).sort((a,b)=>b.score-a.score||Number(meaningfulTerms.has(b.term))-Number(meaningfulTerms.has(a.term))||a.term.localeCompare(b.term)).slice(0,30);
  const recognized=total-(topicMap.get('unknown')?.ids.length||0),leading=topics.find(t=>t.id!=='unknown');
  const insights=[];
  if(leading)insights.push(uiMessage`按现有线索，“${leading.custom?leading.name:uiText(leading.name)}”是数量最多的主题，包含 ${leading.count} 条，占当前范围的 ${leading.share}%。`);
  if(domains[0])insights.push(uiMessage`收藏最多的来源是 ${domains[0].name}：${domains[0].count} 条，占 ${domains[0].share}%。`);
  if(total&&recognized<total)insights.push(uiMessage`${total-recognized} 条尚无明确主题，可补充正文或添加自定义主题词。`);
  if(issues.old.length)insights.push(uiMessage`${issues.old.length} 条收藏已超过 180 天，适合挑选回顾；收藏时间不能证明是否已读。`);
  return {schemaVersion:1,generatedAt:now,basis:uiText("标题、网址路径、文件夹与用户主动补充的正文/笔记；规则匹配与本地分词，未抓取网页正文。"),summary:{total,sources:domains.length,recognized,coverage:percentage(recognized,total),withContent,duplicateGroups:groups.length,duplicateCopies:groups.reduce((n,g)=>n+g.length-1,0),knownLastUsed:validUse,unknownLastUsed:issues.unknownUse.length,unknownDates},topics,domains,folders:folderRows,keywords:keywordRows,months,issues,insights,items};
}

export function analysisFilterIds(report,type,key) {
  if(type==='topic')return report.topics.find(t=>t.id===key)?.ids||[];
  if(type==='source')return report.domains.find(t=>t.name===key)?.ids||[];
  if(type==='folder')return report.folders.find(t=>t.id===key)?.ids||[];
  if(type==='keyword')return report.keywords.find(t=>t.term===key)?.ids||[];
  if(type==='month')return report.months.find(t=>t.key===key)?.ids||[];
  if(type==='content')return report.items.filter(t=>t.hasContent).map(t=>t.id);
  return report.issues[key]||[];
}

export function analysisToHtml(report) {
  report=localizedAnalysis(report);
  const list=rows=>`<ul>${rows.map(text=>`<li>${e(text)}</li>`).join('')}</ul>`;
  const table=(head,rows)=>`<table><thead><tr>${head.map(t=>`<th>${e(t)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(t=>`<td>${e(t)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  return uiHtml`<!doctype html><html lang="${uiLocale()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>书签小屋 · 分析报告</title><style>body{max-width:1000px;margin:45px auto;padding:0 24px;font:14px/1.9 system-ui,sans-serif;color:#294b3b;background:#fafbf7}h1{font-size:30px}h2{margin-top:34px;font-size:19px}p,small{color:#53664f}table{border-collapse:collapse;width:100%;background:white}td,th{padding:11px;text-align:left;border-bottom:1px solid #c6d1c0}th{background:#eef3e6}a{color:#315f45}article{padding:14px 20px;background:white;border:1px solid #e4eadd;border-radius:10px;margin:12px 0}blockquote{margin:10px 0;padding-left:15px;border-left:3px solid #829c68}li{margin:6px 0}</style></head><body><h1>你的收藏，在关注什么？</h1><p>${e(new Date(report.generatedAt).toLocaleString(uiLocale()))} · ${report.summary.total} 条收藏 · ${report.summary.sources} 个来源</p><p>分析范围：${e(report.scope?.folder||uiText("当前收藏"))} · ${report.source==='web'?uiText("网页收藏"):uiText("书签库")}</p><p>${e(report.basis)}</p><h2>收藏观察</h2>${list(report.insights)}<h2>主题分布</h2>${table([uiText("主题"),uiText("数量"),uiText("占比"),uiText("命中线索")],report.topics.map(t=>[t.name,t.count,`${t.share}%`,t.evidence.join('；')||uiText("暂无匹配")]))}<h2>高频关键词</h2>${table([uiText("关键词"),uiText("涉及收藏数")],report.keywords.map(k=>[k.term,k.count]))}<h2>网站来源</h2>${table([uiText("来源"),uiText("数量"),uiText("占比")],report.domains.map(t=>[t.name,t.count,`${t.share}%`]))}<h2>最近十二个月的收藏</h2>${table([uiText("月份"),uiText("数量")],report.months.map(m=>[m.key,m.count]))}<h2>整理与回顾线索</h2>${list([uiMessage`待归类 ${report.issues.loose.length} 条；可选择的重复副本 ${report.issues.duplicates.length} 条。`,uiMessage`收藏超过 180 天 ${report.issues.old.length} 条；有明确记录且 90 天未打开 ${report.issues.stale.length} 条。`,uiMessage`访问记录未知 ${report.summary.unknownLastUsed} 条，不能据此判断未读。`])}<h2>收藏与命中依据</h2>${report.items.map(item=>{const href=safeOpenUrl(item.url);return `<article><strong>${href?`<a href="${e(href)}" target="_blank" rel="noopener noreferrer">${e(item.title||uiText("未命名书签"))}</a>`:e(item.title||uiText("未命名书签"))}</strong><p>${e(item.topicName)} · ${e(item.path)}<br>${e(item.evidence.join('；')||uiText("未匹配主题词"))}</p>${item.excerpts.map(text=>`<blockquote>${e(text)}</blockquote>`).join('')}${item.note?uiHtml`<p>笔记：${e(item.note)}</p>`:''}</article>`;}).join('')}<small>报告在本地生成。摘句来自当前收藏已有的摘要或补充文本；主题结果是线索推断，可通过自定义主题修正。</small></body></html>`;
}

export function evidenceText(value){
  return String(value).split('；').map(part=>{const match=/^(标题|网址路径|文件夹|补充内容)：(.*)$/s.exec(part);return match?uiText(match[1])+': '+match[2]:part;}).join(uiLocale()==='en'?'; ':'；');
}
export function localizedAnalysis(report){
  if(uiLocale()!=='en')return report;
  return {...report,basis:uiText(report.basis),
    topics:report.topics.map(topic=>({...topic,name:topic.custom?topic.name:uiText(topic.name),evidence:topic.evidence.map(evidenceText)})),
    items:report.items.map(item=>({...item,topicName:item.topicId.startsWith('custom:')?item.topicName:uiText(item.topicName),evidence:item.evidence.map(evidenceText)})),
    months:report.months.map(month=>({...month,label:uiDate(month.key+'-01T12:00:00',{month:'short'})}))};
}
