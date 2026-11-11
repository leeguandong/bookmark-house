export function localDay(timestamp){const date=new Date(timestamp);return `${String(date.getFullYear()).padStart(4,'0')}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
export function collectionItems(data,{filter='all',query='',month='',sort='newest'}={}){
  const terms=query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return data.items.filter(item=>{
    if(filter==='deleted'?item.deletedAt==null:item.deletedAt!=null)return false;
    if(filter==='unread'&&item.readAt!=null||filter==='read'&&item.readAt==null||filter==='starred'&&!item.starred)return false;
    if(month&&!localDay(item.savedAt).startsWith(month))return false;
    if(!terms.length)return true;
    const text=`${item.title} ${item.url} ${item.note} ${item.preview?.summary||''} ${item.preview?.description||''} ${item.preview?.siteName||''} ${item.preview?.author||''}`.toLocaleLowerCase();return terms.every(term=>text.includes(term));
  }).sort((a,b)=>(sort==='oldest'?a.savedAt-b.savedAt:b.savedAt-a.savedAt)||a.id.localeCompare(b.id));
}
export function groupByDay(items,now=Date.now()){
  const today=localDay(now),yesterday=new Date(now);yesterday.setDate(yesterday.getDate()-1);const previous=localDay(yesterday.getTime()),groups=[];
  for(const item of items){const key=localDay(item.savedAt);let group=groups.at(-1);if(group?.key!==key){const date=new Date(item.savedAt),year=date.getFullYear()===new Date(now).getFullYear()?'':`${date.getFullYear()}年`;group={key,label:key===today?'今天':key===previous?'昨天':`${year}${date.getMonth()+1}月${date.getDate()}日`,items:[]};groups.push(group);}group.items.push(item);}
  return groups;
}
