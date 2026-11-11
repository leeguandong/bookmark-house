import {t as uiText} from './i18n.js';
import {LocalStore} from './local-store.js';
export {LocalStore} from './local-store.js';

export function demoTree() {
  const now = Date.now(), root = {id:'0',title:'',children:[{id:'1',parentId:'0',title:uiText("书签栏"),folderType:'bookmarks-bar',children:[]},{id:'2',parentId:'0',title:uiText("其他书签"),folderType:'other',children:[]}]};
  let n = 10;
  const folder = (parent,title) => { const f = {id:String(n++),parentId:parent.id,title,children:[]}; parent.children.push(f); return f; };
  const bookmark = (parent,title,url,days=0,lastUsedDays=null) => {const item={id:String(n++),parentId:parent.id,title,url,dateAdded:now-days*86400000};if(lastUsedDays!==null)item.dateLastUsed=now-lastUsedDays*86400000;parent.children.push(item);};
  const bar = root.children[0], other = root.children[1], development = folder(bar,uiText("开发工具")), design = folder(bar,uiText("设计灵感")), reading = folder(other,uiText("慢慢读"));
  bookmark(development,uiText("GitHub · 代码与灵感"),'https://github.com/',300,120);
  bookmark(development,'MDN Web Docs','https://developer.mozilla.org/zh-CN/',210,5);
  bookmark(development,'Docker Documentation','https://docs.docker.com/',160,95);
  bookmark(design,uiText("Figma — 把想法画出来"),'https://www.figma.com/',260,3);
  bookmark(design,uiText("Dribbble · 每日灵感"),'https://dribbble.com/',120);
  bookmark(reading,uiText("维基百科 · 自由的百科全书"),'https://zh.wikipedia.org/',450);
  bookmark(reading,uiText("豆瓣读书"),'https://book.douban.com/',95);
  bookmark(bar,uiText("Hugging Face · 模型与数据集"),'https://huggingface.co/',0);
  bookmark(bar,uiText("魔搭社区 · 模型库"),'https://www.modelscope.cn/models',1);
  bookmark(bar,'GitHub','https://github.com/',2);
  bookmark(bar,uiText("Notion · 我的工作空间"),'https://www.notion.so/',3);
  bookmark(bar,'Figma','https://www.figma.com/',4);
  bookmark(other,uiText("PyTorch · 机器学习框架"),'https://pytorch.org/',5);
  bookmark(other,uiText("Unsplash · 摄影素材"),'https://unsplash.com/',6);
  bookmark(other,uiText("哔哩哔哩"),'https://www.bilibili.com/',7);
  bookmark(other,uiText("知乎 · 发现好问题"),'https://www.zhihu.com/',8);
  bookmark(other,uiText("Coursera · 在线课程"),'https://www.coursera.org/',12);
  bookmark(other,uiText("周末旅行计划"),'https://www.trip.com/',13);
  bookmark(other,uiText("以后再看"),'https://example.com/interesting',14);
  return [root];
}

// Runs only on the local preview. It never reads the browser's bookmarks.
export class DemoAdapter {
  constructor(tree = demoTree(), persist = async () => {}) { this.tree=structuredClone(tree); this.persist=persist; this.next=1000; this.reindex(); }
  reindex() { this.map=new Map(); const visit = node => { this.map.set(node.id,node); this.next=Math.max(this.next,Number(node.id)+1 || 1000); (node.children || []).forEach((c,i) => { c.parentId=node.id; c.index=i; visit(c); }); }; this.tree.forEach(visit); }
  async save() { this.reindex(); await this.persist(this.tree); }
  async getTree() { return structuredClone(this.tree); }
  async get(ids) { return (Array.isArray(ids)?ids:[ids]).map(id => { if(!this.map.has(id)) throw new Error(uiText("书签不存在")); return structuredClone(this.map.get(id)); }); }
  async getChildren(id) { if(!this.map.has(id)) throw new Error(uiText("文件夹不存在")); return structuredClone(this.map.get(id).children || []); }
  async create(details) { const parent=this.map.get(details.parentId); if(!parent || !parent.children) throw new Error(uiText("无效文件夹")); const node={...details,id:String(this.next++),dateAdded:Date.now()}; if(details.url===undefined) node.children=[]; parent.children.splice(details.index ?? parent.children.length,0,node); await this.save(); return structuredClone(node); }
  async move(id,destination) { const node=this.map.get(id), parent=this.map.get(destination.parentId); if(!node || !parent?.children) throw new Error(uiText("无效移动")); const old=this.map.get(node.parentId); old.children.splice(old.children.findIndex(n=>n.id===id),1); parent.children.splice(destination.index ?? parent.children.length,0,node); await this.save(); return structuredClone(node); }
  async update(id,changes) { const n=this.map.get(id); if(!n) throw new Error(uiText("书签不存在")); Object.assign(n,changes); await this.save(); return structuredClone(n); }
  async remove(id) {const n=this.map.get(id);if(!n)throw new Error(uiText("项目不存在"));if(n.children?.length)throw new Error(uiText("只能删除空文件夹"));const p=this.map.get(n.parentId);if(!p)throw new Error(uiText("不能删除根目录"));p.children.splice(p.children.findIndex(c=>c.id===id),1);await this.save();}
  async removeTree(id) {const n=this.map.get(id);if(!n?.children)throw new Error(uiText("无效文件夹"));const p=this.map.get(n.parentId);if(!p)throw new Error(uiText("不能删除根目录"));p.children.splice(p.children.findIndex(c=>c.id===id),1);await this.save();}
}

export async function createAdapter() {
  const isExtension = location.protocol === 'chrome-extension:';
  if (isExtension && !globalThis.chrome?.bookmarks?.getTree) throw new Error(uiText("扩展尚未获得书签权限，请在扩展管理页检查权限后重新打开。"));
  const store = new LocalStore(isExtension ? 'bookmark-house' : 'bookmark-house-demo');
  if (isExtension) return {api:chrome.bookmarks,store,demo:false};
  const stored = await store.get('demoTree');
  return {api:new DemoAdapter(stored || demoTree(),tree=>store.set('demoTree',tree)),store,demo:true};
}
