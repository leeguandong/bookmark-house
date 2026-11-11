export function xhsNoteId(value){
  try{const url=new URL(value);if(!/(^|\.)xiaohongshu\.com$/i.test(url.hostname))return '';return /^\/(?:explore|discovery\/item)\/([a-f\d]{24})(?:\/|$)/i.exec(url.pathname)?.[1].toLowerCase()||'';}catch{return '';}
}

// Tracking parameters can differ between a saved link and its open tab. Only
// recognized note routes may match by ID; other pages retain exact URL matching.
export function sameSavedPage(left,right){
  if(left===right)return true;
  try{return new URL(left).origin===new URL(right).origin&&Boolean(xhsNoteId(left))&&xhsNoteId(left)===xhsNoteId(right);}catch{return false;}
}

export function isPlaceholderTitle(title,url){
  const value=String(title||'').replace(/\s+/g,' ').trim();
  if(!value)return true;
  try{const host=new URL(url).hostname;if([url,host,host.replace(/^www\./,'')].includes(value))return true;}catch{}
  return Boolean(xhsNoteId(url))&&/^(?:小红书(?:\s*[-—–·|]\s*(?:你的生活指南|你的生活兴趣社区|标记我的生活))?|登录(?:\s*[-—–·|]\s*小红书)?)$/.test(value);
}

export function isXhsSiteDescription(value){
  return /^(?:小红书是|小红书作为)|你的生活(?:指南|兴趣社区)|标记我的生活|登录(?:后|即可|小红书)|扫码登录|安全验证|访问频次异常/.test(String(value||'').trim());
}

export function cardTitle(item){
  if(item.titleEdited||!isPlaceholderTitle(item.title,item.url))return item.title;
  const id=xhsNoteId(item.url);
  return id?`小红书笔记 · ${id.slice(-8)}`:item.title||new URL(item.url).hostname;
}
