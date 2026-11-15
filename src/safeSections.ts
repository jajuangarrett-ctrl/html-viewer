/** Reader-owned navigation only. Never evaluates document handlers or scripts. */
export function safeSectionsBootstrap(): string {
  return `
 const installSafeSections=()=>{
  const candidates=[...document.querySelectorAll('[data-fjg-section-toggle],#sectionMenuButton')];
  // Older exports have a plain Sections button rather than the newer marker.
  if(!candidates.length)for(const b of document.querySelectorAll('button'))if(/^(show |hide )?sections$/i.test(b.textContent.trim()))candidates.push(b);
  const entries=[],seen=new Set();
  const add=(target,label)=>{if(!target||seen.has(target)||!label.trim()||target.closest('nav,aside,[hidden],[inert],[aria-hidden="true"]')||!target.getClientRects().length)return;seen.add(target);entries.push({target,label:label.trim().slice(0,200)});};
  const toc=document.querySelector('nav.toc,nav[aria-label*="section" i],nav[aria-label*="contents" i]');
  if(toc)for(const a of toc.querySelectorAll('[data-fjg-href^="#"]'))try{add(document.getElementById(decodeURIComponent(a.getAttribute('data-fjg-href').slice(1))),a.textContent)}catch{}
  if(!entries.length)for(const h of document.querySelectorAll('main h1,main h2,main h3,article h1,article h2,article h3,h2[id],h3[id]'))add(h,h.textContent);
  if(!entries.length)return;
  if(toc){toc.hidden=true;toc.style.setProperty('display','none','important');}
  // Keep the page's visible control, but remove duplicate toggle markers.
  let toggle=candidates.find(e=>visible(e));for(const extra of candidates)if(extra!==toggle)extra.removeAttribute('data-fjg-section-toggle');
  if(!toggle){toggle=document.createElement('button');toggle.type='button';toggle.textContent='Sections';document.body.prepend(toggle);}
  toggle.setAttribute('data-fjg-section-toggle','');toggle.style.setProperty('touch-action','none');
  toggle.style.setProperty('min-height','44px');toggle.style.setProperty('min-width','44px');
  const host=document.createElement('div');host.setAttribute('data-fjg-safe-sections','');document.body.append(host);
  const shadow=host.attachShadow({mode:'open'}),style=document.createElement('style');
  style.textContent=':host{all:initial!important;position:fixed!important;inset:0!important;z-index:2147483646!important;pointer-events:none!important;font:16px system-ui!important;color:#172033!important}*{box-sizing:border-box}nav{pointer-events:auto;position:absolute;left:0;top:0;bottom:0;width:min(280px,85vw);overflow:auto;background:#fff;color:#172033;border-right:1px solid #aaa;padding:8px;overscroll-behavior:contain}button{font:inherit;min-height:44px;border:0;border-radius:6px;background:transparent;color:inherit;padding:10px;text-align:left;width:100%;cursor:pointer}button:hover,button:focus-visible{background:#e8edf3}button[aria-current]{background:#e1efff}.shade{position:absolute;inset:0;background:#0005;pointer-events:auto}[hidden]{display:none!important}@media(min-width:640px){.shade{display:none}}';shadow.append(style);
  const shade=document.createElement('div');shade.className='shade';const nav=document.createElement('nav');nav.setAttribute('aria-label','Page sections');const close=document.createElement('button');close.textContent='Hide sections';nav.append(close);shadow.append(shade,nav);
  const controls=[];let wide=innerWidth>=640,wideOpen=true,compactOpen=false;
  const oldPadding=document.documentElement.style.getPropertyValue('padding-left'),oldPriority=document.documentElement.style.getPropertyPriority('padding-left');
  const shown=()=>wide?wideOpen:compactOpen;
  const reading=()=>[...document.querySelectorAll('main h1,main h2,main p,main li,article p')].filter(e=>!toc?.contains(e)).find(e=>e.getBoundingClientRect().bottom>12);
  const render=()=>{const open=shown();nav.hidden=shade.hidden=!open;toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',open?'Hide sections':'Show sections');
   if(wide&&open)document.documentElement.style.setProperty('padding-left','280px','important');else if(oldPadding)document.documentElement.style.setProperty('padding-left',oldPadding,oldPriority);else document.documentElement.style.removeProperty('padding-left');};
  const set=open=>{const anchor=reading(),top=anchor?.getBoundingClientRect().top;if(wide)wideOpen=open;else compactOpen=open;render();if(anchor&&top!==undefined)scrollBy(0,anchor.getBoundingClientRect().top-top);report();};
  for(const entry of entries){const b=document.createElement('button');b.textContent=entry.label;b.addEventListener('click',()=>{if(!wide)set(false);entry.target.scrollIntoView({block:'start'});for(const item of controls)item.removeAttribute('aria-current');b.setAttribute('aria-current','location');});controls.push(b);nav.append(b);}
  toggle.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();if(suppress){suppress=false;return;}set(!shown());},true);
  close.addEventListener('click',()=>{set(false);toggle.focus({preventScroll:true})});shade.addEventListener('click',()=>set(false));
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&shown()){set(false);toggle.focus({preventScroll:true})}});
  let x=0,y=0,suppress=false;toggle.addEventListener('pointerdown',e=>{x=e.clientX;y=e.clientY;(()=>{try{toggle.setPointerCapture(e.pointerId)}catch{}})()});toggle.addEventListener('pointerup',e=>{const dx=e.clientX-x,dy=e.clientY-y;if(Math.abs(dx)>40&&Math.abs(dx)>Math.abs(dy)*1.5){suppress=true;set(dx>0);setTimeout(()=>suppress=false,250)}});toggle.addEventListener('pointercancel',()=>suppress=false);
  addEventListener('resize',()=>{const next=innerWidth>=640;if(next!==wide){const anchor=reading(),top=anchor?.getBoundingClientRect().top;wide=next;render();if(anchor&&top!==undefined)scrollBy(0,anchor.getBoundingClientRect().top-top);}});render();
 };
 `;
}
