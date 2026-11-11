import {findDuplicates,folderContents} from './core.js';

// Folder overview, list filters and export share the same subtree boundary.
export function folderScope(model,id){
  const folder=model.nodes.get(id);
  if(!folder||folder.url!==undefined||folder.inTrash||folder.depth===0)throw new Error('文件夹已变化，请刷新后再试。');
  const contents=folderContents(model,id),ids=new Set(contents.ids);
  const books=model.bookmarks.filter(b=>!b.inTrash&&ids.has(b.id));
  const direct=books.filter(b=>b.parentId===id),duplicates=findDuplicates(books),duplicateIds=new Set(),keepers=new Map();
  for(const group of duplicates){const keeper=group.find(b=>b.managed)||group[0];for(const b of group){duplicateIds.add(b.id);keepers.set(b.id,keeper.id);}}
  return {folder,ids,books,direct,duplicates,duplicateIds,keepers,folderCount:contents.folderCount,extraCopies:duplicates.reduce((total,group)=>total+group.length-1,0)};
}

export function scopedBooks(scope,filter='all'){
  if(filter==='duplicates')return scope.books.filter(b=>scope.duplicateIds.has(b.id));
  if(filter==='direct')return scope.direct;
  return scope.books;
}

export function folderBackup(model,id){return [structuredClone(folderScope(model,id).folder)];}
