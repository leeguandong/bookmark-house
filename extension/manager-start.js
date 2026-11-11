import {LocalStore} from './local-store.js';
import {HOME_CACHE_KEY,validHomeCache,rememberHomePreview,prepareHomePreview} from './home-cache.js';
import {renderWebCollection} from './web-collection-render.js';
import {cleanPreview} from './preview-data.js';
import {ensureSidebarLayout} from './sidebar-layout.js';

const panel=document.querySelector('#webPanel');
ensureSidebarLayout({document,window});
async function showCachedHome(){
  const store=new LocalStore(location.protocol==='chrome-extension:'?'bookmark-house':'bookmark-house-demo');
  try{
    const snapshot=await store.get(HOME_CACHE_KEY);if(!validHomeCache(snapshot))return;
    panel.innerHTML=renderWebCollection(snapshot,{summary:snapshot.summary,limit:snapshot.items.length||24});
    // Cached links and layout controls work immediately. Data-changing controls
    // become available only after the authoritative collection has been read.
    panel.setAttribute('aria-busy','true');
    for(const control of panel.querySelectorAll('button,input,select'))if(!control.disabled){control.disabled=true;control.dataset.homePending='';}
    const counts=snapshot.summary.counts;
    for(const [id,value] of [['navWeb',counts.all],['navWebStarred',counts.starred]])document.getElementById(id).textContent=value;
    rememberHomePreview(panel,snapshot);
    const images=[...panel.querySelectorAll('img[data-cover-ref]')];
    store.getMany(images.map(image=>image.dataset.coverRef)).then(covers=>{
      for(const image of images)if(image.isConnected){const cover=cleanPreview({cover:covers.get(image.dataset.coverRef)}).cover;if(cover)image.src=cover;}
    }).catch(()=>{});
    // Let the cached first page paint before the manager takes over the page.
    await new Promise(resolve=>{
      const timer=setTimeout(resolve,80);
      requestAnimationFrame(()=>{clearTimeout(timer);setTimeout(resolve,0);});
    });
  }catch{/* Derived caches are optional; the normal startup remains authoritative. */}
  finally{store.ready.then(db=>db.close()).catch(()=>{});}
}
const preview=showCachedHome();prepareHomePreview(preview);
// Load the manager module graph while IndexedDB reads the cached first page.
export const startup=import('./manager.js').catch(error=>{
  document.body.inert=false;document.querySelector('#status').textContent=`小屋暂时无法打开，请刷新后重试。${error.message}`;
});
