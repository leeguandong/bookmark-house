// Small address helpers can run before collection and capture modules load.
export function webUrl(raw){
  const text=String(raw||'').trim();if(!text||text.length>8192)throw new Error('请填写完整的 http 或 https 网页地址。');
  let url;try{url=new URL(text);}catch{throw new Error('请填写完整的 http 或 https 网页地址。');}
  if(!['http:','https:'].includes(url.protocol))throw new Error('这里只保存 http 或 https 网页链接。');
  return url.href;
}
export async function currentWebPage(tabs){
  const [tab]=await tabs.query({active:true,currentWindow:true});
  if(!tab?.url)throw new Error('此页面无法直接收藏。请打开普通网页，再点击小屋图标。');
  const url=webUrl(tab.url);return {url,title:tab.title||new URL(url).hostname};
}
