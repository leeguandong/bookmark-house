// Covers and the last purge backup are separate records. The small index remains
// version 1; exports still contain complete cards and need no special importer.
import {HOME_CACHE_KEY,HOME_CACHE_LAYOUT_KEY,buildHomeCache} from './home-cache.js';
export const COLLECTION_LAYOUT_KEY='webCollectionLayoutV2';
export const COLLECTION_BACKUP_KEY='webCollectionPurgeV2';
const coverRefs=data=>new Set([...data.items.map(item=>item.preview?.coverRef),...(data.purgeBackup?.coverRefs||[]),...(data.purgeBackup?.items||[]).map(item=>item.preview?.coverRef)].filter(Boolean));

export function separateCollection(data,records,previous={items:[]}){
  const separate=item=>{
    if(!item.preview)return;
    if(item.preview.cover){
      const ref='webCover:'+crypto.randomUUID();
      records.put(ref,item.preview.cover);item.preview.coverRef=ref;
    }
    item.preview.cover='';
  };
  data.items.forEach(separate);
  if(data.purgeBackup?.items){
    data.purgeBackup.items.forEach(separate);
    records.put(COLLECTION_BACKUP_KEY,data.purgeBackup);
    data.purgeBackup={date:data.purgeBackup.date,count:data.purgeBackup.items.length,external:true,coverRefs:[...coverRefs(data.purgeBackup)]};
  }
  const retained=coverRefs(data);
  for(const ref of coverRefs(previous))if(!retained.has(ref))records.delete(ref);
  data.storageVersion=2;data.cacheToken=crypto.randomUUID();records.put(COLLECTION_LAYOUT_KEY,2);
  const snapshot=buildHomeCache(data);
  if(snapshot)records.put(HOME_CACHE_KEY,snapshot);else records.delete(HOME_CACHE_KEY);
  records.put(HOME_CACHE_LAYOUT_KEY,1);
  return data;
}

export function collectionLinks(key,value){
  if(!value||!Array.isArray(value.items))return [];
  return [...value.items.map(item=>item.preview?.coverRef).filter(Boolean),...(value.purgeBackup?.external?[COLLECTION_BACKUP_KEY]:[])];
}

export function hydrateCollection(data,values){
  if(data.purgeBackup?.external)data.purgeBackup=values.get(COLLECTION_BACKUP_KEY)||null;
  const items=[...data.items,...(data.purgeBackup?.items||[])];
  for(const item of items)if(item.preview?.coverRef){item.preview.cover=values.get(item.preview.coverRef)||'';delete item.preview.coverRef;}
  delete data.storageVersion;
  delete data.cacheToken;
  return data;
}
