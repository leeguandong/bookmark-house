import {onLanguageChange} from './i18n.js';
import {t as uiText,msg as uiMessage,html as uiHtml,locale as uiLocale,date as uiDate,number as uiNumber} from './i18n.js';
const STORAGE_KEY='bookmark-house.sidebar-layout.v1';
const DEFAULT_WIDTH=244,MIN_WIDTH=220,MAX_WIDTH=480,RAIL_WIDTH=72,MOBILE_BREAKPOINT=760;
const layouts=new WeakMap();
export function ensureSidebarLayout(options){
  if(!layouts.has(options.document))layouts.set(options.document,installSidebarLayout(options));
  return layouts.get(options.document);
}

// Layout preferences are independent of bookmark and collection data.
export function installSidebarLayout({document,window}){
  const body=document.body,sidebar=document.querySelector('#appSidebar');
  const handle=document.querySelector('#sidebarResize'),toggle=document.querySelector('#mobileMenu');
  const backdrop=document.querySelector('#sidebarBackdrop'),section=document.querySelector('#bookmarkSection');
  let width=DEFAULT_WIDTH,collapsed=false,drag=null;
  const listeners=[];
  const listen=(target,type,fn,options)=>{target.addEventListener(type,fn,options);listeners.push(()=>target.removeEventListener(type,fn,options));};
  const mobile=()=>window.innerWidth<=MOBILE_BREAKPOINT;
  const maxWidth=()=>Math.max(MIN_WIDTH,Math.min(MAX_WIDTH,window.innerWidth-520));
  const clamp=value=>Math.round(Math.max(MIN_WIDTH,Math.min(maxWidth(),value)));
  try{
    const saved=JSON.parse(window.localStorage.getItem(STORAGE_KEY)||'null');
    if(saved&&typeof saved.width==='number'&&Number.isFinite(saved.width))width=Math.max(MIN_WIDTH,Math.min(MAX_WIDTH,saved.width));
    collapsed=saved?.collapsed===true;
  }catch{/* Storage may be disabled; layout controls still work. */}
  function save(){try{window.localStorage.setItem(STORAGE_KEY,JSON.stringify({width,collapsed}));}catch{}}
  function apply(){
  for(const button of sidebar.querySelectorAll('.sidebar-primary .nav-item,.sidebar-tools .nav-item')){
    const label=button.querySelector('span')?.textContent||'';
    button.setAttribute('aria-label',label);button.title=label;
  }

    const small=mobile(),rail=!small&&collapsed,effective=rail?RAIL_WIDTH:clamp(width);
    body.classList.toggle('sidebar-collapsed',rail);
    body.style.setProperty('--sidebar-width',`${effective}px`);
    body.style.setProperty('--sidebar-half',`${small?0:effective/2}px`);
    const expanded=small?body.classList.contains('sidebar-open'):!collapsed;
    const label=expanded?uiText("收起侧边栏"):uiText("展开侧边栏");
    toggle.setAttribute('aria-expanded',String(expanded));
    toggle.setAttribute('aria-label',label);toggle.title=label;
    sidebar.inert=small&&!expanded;
    handle.hidden=small||rail;
    handle.setAttribute('aria-valuemax',String(maxWidth()));
    handle.setAttribute('aria-valuenow',String(clamp(width)));
    handle.setAttribute('aria-valuetext',uiMessage`${clamp(width)} 像素`);
    section.querySelector('summary').title=rail?uiText("展开书签库"):uiText("书签库");
  }
  function closeMobile(){body.classList.remove('sidebar-open');apply();}
  function expand(){collapsed=false;if(mobile())body.classList.add('sidebar-open');apply();save();}
  function finish(commit){
    if(!drag)return;
    const previous=drag;drag=null;
    if(!commit)width=previous.originalWidth;
    body.classList.remove('sidebar-resizing');
    if(handle.hasPointerCapture?.(previous.id))handle.releasePointerCapture(previous.id);
    apply();if(commit)save();
  }
  listen(toggle,'click',()=>{
    if(mobile())body.classList.toggle('sidebar-open');else{collapsed=!collapsed;save();}
    apply();
  });
  listen(backdrop,'click',()=>{closeMobile();toggle.focus();});
  listen(section.querySelector('summary'),'click',event=>{
    if(!mobile()&&collapsed){event.preventDefault();expand();section.open=true;}
  });
  listen(handle,'pointerdown',event=>{
    if(event.button!==0||mobile()||collapsed||drag)return;
    event.preventDefault();handle.focus();
    drag={id:event.pointerId,startX:event.clientX,startWidth:clamp(width),originalWidth:width};
    handle.setPointerCapture?.(event.pointerId);body.classList.add('sidebar-resizing');
  });
  listen(document,'pointermove',event=>{
    if(!drag||event.pointerId!==drag.id)return;
    width=clamp(drag.startWidth+event.clientX-drag.startX);apply();
  });
  listen(document,'pointerup',event=>{if(drag&&event.pointerId===drag.id)finish(true);});
  listen(document,'pointercancel',event=>{if(drag&&event.pointerId===drag.id)finish(false);});
  listen(handle,'lostpointercapture',()=>finish(false));
  listen(window,'blur',()=>finish(false));
  listen(handle,'dblclick',()=>{width=DEFAULT_WIDTH;apply();save();});
  listen(handle,'keydown',event=>{
    if(mobile()||collapsed||drag)return;
    const step=event.shiftKey?40:16;
    const target={ArrowLeft:clamp(width)-step,ArrowRight:clamp(width)+step,Home:MIN_WIDTH,End:maxWidth(),Enter:DEFAULT_WIDTH}[event.key];
    if(target===undefined)return;
    event.preventDefault();width=clamp(target);apply();save();
  });
  listen(document,'keydown',event=>{
    if(event.key!=='Escape')return;
    if(drag){event.preventDefault();event.stopImmediatePropagation();finish(false);}
    else if(mobile()&&body.classList.contains('sidebar-open')&&!document.querySelector('dialog[open]')){
      event.preventDefault();event.stopImmediatePropagation();closeMobile();toggle.focus();
    }
  },true);
  listen(window,'resize',()=>{finish(false);if(!mobile())body.classList.remove('sidebar-open');apply();});
  listeners.push(onLanguageChange(apply));
  apply();
  return {expand,closeMobile,destroy(){finish(false);listeners.forEach(remove=>remove());}};
}
