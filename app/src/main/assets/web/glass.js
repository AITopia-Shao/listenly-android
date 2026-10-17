// Shared, interruptible motion for the small controls in the WebView.  State is
// kept outside the DOM so replacing a reader panel does not reset its lens.
const SEGMENTS='.theme-control,.mode-control,.display-controls';
const PRESSES='button,[role="button"],summary,a[href],[data-action]';
const STATIC_LENSES='.transport-pill,.speed-btn,.big-play,.row-play,.glass-symbol,.speed-popover,.dialog';
const SVG='http://www.w3.org/2000/svg';
const groups=new Map(),presses=new Map(),pointers=new Map(),filters=new Map();
let observer=null,mountedRoot=null,scheduled=0,motionFrame=0,motionTime=0,optics=null,defs=null,filterNumber=0,reduced=null;
const removers=[];

export function advanceSpring(position,velocity,target,elapsed,stiffness=460,damping=31){
  const duration=Math.min(.064,Math.max(0,elapsed)),steps=Math.max(1,Math.ceil(duration*120)),dt=duration/steps;
  for(let i=0;i<steps;i++){velocity+=((target-position)*stiffness-velocity*damping)*dt;position+=velocity*dt}
  return {position,velocity};
}

// A small delayed strain lets the surface trail its motion instead of changing
// from rigid to stretched in a single frame. It also releases softly at rest.
export function advanceViscousStrain(position,velocity,motionVelocity,elapsed){
  const target=Math.max(-1,Math.min(1,motionVelocity/1050));
  return advanceSpring(position,velocity,target,elapsed,210,25);
}

function isReduced(){return !!(reduced&&reduced.matches)}
function all(root,selector){const nodes=Array.from(root.querySelectorAll(selector));if(root.nodeType===1&&root.matches(selector))nodes.unshift(root);return nodes}
function listen(target,event,fn,options){target.addEventListener(event,fn,options);removers.push(()=>target.removeEventListener(event,fn,options))}
function ensureDefs(){
  if(defs&&optics&&optics.isConnected)return;
  optics=document.createElementNS(SVG,'svg');optics.setAttribute('class','glass-optics');optics.setAttribute('width','0');optics.setAttribute('height','0');optics.setAttribute('aria-hidden','true');optics.setAttribute('focusable','false');
  // Inline styles also protect this zero-size SVG from the app's icon rules.
  optics.style.cssText='position:absolute!important;width:0!important;height:0!important;overflow:hidden!important;pointer-events:none!important;left:0;top:0';
  defs=document.createElementNS(SVG,'defs');optics.appendChild(defs);document.body.appendChild(optics);
}

function refraction(width,height,radius,bend){
  width=Math.max(1,Math.round(width));height=Math.max(1,Math.round(height));radius=Math.max(1,Math.min(radius,width/2,height/2));
  const key=[width,height,Math.round(radius*10),bend].join(':');if(filters.has(key))return filters.get(key);
  ensureDefs();const density=width*height>80000?1:2,canvas=document.createElement('canvas');canvas.width=width*density;canvas.height=height*density;
  const context=canvas.getContext('2d');if(!context)return '';
  const pixels=context.createImageData(canvas.width,canvas.height),halfWidth=width/2,halfHeight=height/2,rim=Math.min(10,radius);
  for(let row=0;row<canvas.height;row++)for(let col=0;col<canvas.width;col++){
    const px=(col+.5)/density-halfWidth,py=(row+.5)/density-halfHeight,qx=Math.abs(px)-(halfWidth-radius),qy=Math.abs(py)-(halfHeight-radius),ox=Math.max(qx,0),oy=Math.max(qy,0),length=Math.hypot(ox,oy),distance=length+Math.min(Math.max(qx,qy),0)-radius;
    const edge=Math.max(0,1-Math.max(0,-distance)/rim),amount=distance<=0?bend*edge*edge:0;
    let nx=0,ny=0;if(length>0){nx=ox/length*Math.sign(px);ny=oy/length*Math.sign(py)}else if(qx>qy)nx=Math.sign(px);else ny=Math.sign(py);
    const i=(row*canvas.width+col)*4;pixels.data[i]=Math.round(128-nx*amount/24*255);pixels.data[i+1]=Math.round(128-ny*amount/24*255);pixels.data[i+2]=128;pixels.data[i+3]=255;
  }
  context.putImageData(pixels,0,0);const filter=document.createElementNS(SVG,'filter'),id=`glass-refraction-${++filterNumber}`;
  for(const [name,value] of Object.entries({id,x:0,y:0,width,height,filterUnits:'userSpaceOnUse','color-interpolation-filters':'sRGB'}))filter.setAttribute(name,String(value));
  const map=document.createElementNS(SVG,'feImage');for(const [name,value] of Object.entries({x:0,y:0,width,height,preserveAspectRatio:'none',result:'lens-map'}))map.setAttribute(name,String(value));
  const url=canvas.toDataURL();map.setAttribute('href',url);map.setAttributeNS('http://www.w3.org/1999/xlink','href',url);
  const displacement=document.createElementNS(SVG,'feDisplacementMap');for(const [name,value] of Object.entries({in:'SourceGraphic',in2:'lens-map',scale:24,xChannelSelector:'R',yChannelSelector:'G'}))displacement.setAttribute(name,String(value));
  filter.appendChild(map);filter.appendChild(displacement);defs.appendChild(filter);const value=`url(#${id})`;filters.set(key,value);return value;
}

export function ensureLens(element,radius){
  if(!element||!element.isConnected)return;
  const css=getComputedStyle(element),isSpeed=element.classList.contains('speed-btn'),rawX=css.getPropertyValue('--lens-inset-x').trim(),rawY=css.getPropertyValue('--lens-inset-y').trim(),insetX=rawX?parseFloat(rawX)||0:0,insetY=rawY?parseFloat(rawY)||0:isSpeed?6:0,width=element.offsetWidth-insetX*2,height=element.offsetHeight-insetY*2;
  if(width<=0||height<=0)return;
  const round=radius||parseFloat(css.getPropertyValue('--lens-radius'))||parseFloat(css.borderTopLeftRadius)||Math.min(18,height/2),bend=width*height>12000?3:6;
  const value=refraction(width,height,round,bend);if(value&&element.style.getPropertyValue('--lens-filter')!==value)element.style.setProperty('--lens-filter',value);
}

function createGroup(key){
  return {key,element:null,lens:null,buttons:[],centers:[],x:0,velocity:0,strain:0,strainVelocity:0,target:0,width:0,barWidth:0,height:0,top:0,active:-1,moving:false,initialized:false,detachedAt:0};
}
function groupKey(element){return element.classList.contains('theme-control')?'theme':element.classList.contains('mode-control')?'mode':'display'}
function paintGroup(group){
  if(!group.lens||!group.element.isConnected)return;
  const energy=Math.min(1,Math.abs(group.strain)),stretch=1+energy*.18,squash=1-energy*.12,lean=group.strain*1.6,extent=(group.width*stretch+group.height*Math.abs(Math.tan(lean*Math.PI/180)))/2,center=Math.max(extent+1,Math.min(group.barWidth-extent-1,group.x));
  group.lens.style.transform=`translate3d(${center-group.width/2}px,0,0) scale(${stretch},${squash}) skewX(${lean}deg)`;
  group.element.style.setProperty('--segment-velocity',String(energy));
  group.buttons.forEach((button,index)=>{const emphasis=Math.pow(Math.max(0,1-Math.abs(center-group.centers[index])/Math.max(1,group.width*.8)),2);button.style.setProperty('--lens-emphasis',String(emphasis));button.style.setProperty('--lens-scale',String(1+emphasis*.045));button.style.setProperty('--lens-weight',String(400+emphasis*200));button.style.setProperty('--lens-contrast',String(emphasis))});
}
function pressKey(element){
  if(element.id)return `id:${element.id}`;
  const action=element.getAttribute('data-action');if(!action)return '';
  return `${element.tagName}:${Object.keys(element.dataset).filter(key=>key!=='glassPress').sort().map(key=>`${key}=${element.dataset[key]}`).join('|')}`;
}
function syncGroup(group,element){
  const changed=group.element!==element,wasPresent=!!(group.element&&!group.detachedAt),oldWidth=group.barWidth;
  group.element=element;group.buttons=Array.from(element.children).filter(child=>child.tagName==='BUTTON');
  if(!group.buttons.length)return;
  if(changed){group.lens=document.createElement('span');group.lens.className='glass-segment-lens';group.lens.setAttribute('aria-hidden','true');element.insertBefore(group.lens,element.firstChild)}
  const css=getComputedStyle(element),leftBorder=parseFloat(css.borderLeftWidth)||0,topBorder=parseFloat(css.borderTopWidth)||0,inset=parseFloat(css.getPropertyValue('--segment-inset'))||3,first=group.buttons[0];
  const bounds=element.getBoundingClientRect();group.barWidth=element.clientWidth;group.height=Math.max(1,first.offsetHeight-inset*2);group.width=Math.max(1,first.offsetWidth-inset*2);
  group.centers=group.buttons.map(button=>{const r=button.getBoundingClientRect();return r.left-bounds.left-leftBorder+r.width/2});
  const firstBounds=first.getBoundingClientRect();group.top=firstBounds.top-bounds.top-topBorder+(firstBounds.height-group.height)/2;
  group.lens.style.cssText=`position:absolute;left:0;top:${group.top}px;width:${group.width}px;height:${group.height}px;pointer-events:none`;
  const filter=refraction(group.width,group.height,group.height/2,6);if(filter)group.lens.style.setProperty('--lens-filter',filter);
  const selected=group.buttons.findIndex(button=>button.classList.contains('active')||button.getAttribute('aria-pressed')==='true'),index=selected<0?0:selected;
  group.target=group.centers[index];
  if(changed&&oldWidth>0&&wasPresent){group.x*=group.barWidth/oldWidth;group.velocity*=group.barWidth/oldWidth}
  const recentlyDetached=group.detachedAt&&performance.now()-group.detachedAt<180;
  if(!group.initialized||isReduced()||(changed&&!wasPresent&&!recentlyDetached)){group.x=group.target;group.velocity=group.strain=group.strainVelocity=0;group.moving=false}
  else group.moving=Math.abs(group.x-group.target)>.08||Math.abs(group.velocity)>1||Math.abs(group.strain)>.001||Math.abs(group.strainVelocity)>.01;
  group.active=index;group.initialized=true;group.detachedAt=0;paintGroup(group);if(group.moving)requestMotion();
}

function pressState(element,kind){
  let state=presses.get(element);if(!state){state={element,kind,key:pressKey(element),position:1,velocity:0,target:1,held:new Set(),inside:new Map(),moving:false};presses.set(element,state)}
  if(kind==='button')element.setAttribute('data-glass-press','');return state;
}
function paintPress(state){const property=state.kind==='range'?'--thumb-scale':'--press-scale';state.element.style.setProperty(property,String(state.position));if(state.kind==='range'){const shell=state.element.closest('.seek-shell');if(shell)shell.style.setProperty(property,String(state.position))}}
function targetPress(state,down){
  const target=down?state.kind==='range'?1.6:state.element.offsetWidth>180?.985:.94:1;if(state.target===target)return;state.target=target;
  if(isReduced()){state.position=state.target;state.velocity=0;state.moving=false;paintPress(state)}else{state.moving=true;requestMotion()}
}
function requestMotion(){if(!motionFrame){motionTime=0;motionFrame=requestAnimationFrame(tick)}}
function tick(time){
  motionFrame=0;const elapsed=Math.min(.064,Math.max(.001,(time-(motionTime||time-16.667))/1000));motionTime=time;let moving=false;
  groups.forEach(group=>{
    if(!group.element||!group.element.isConnected){if(!group.detachedAt)group.detachedAt=performance.now();group.moving=false;return}
    if(!group.moving)return;const next=advanceSpring(group.x,group.velocity,group.target,elapsed);group.x=next.position;group.velocity=next.velocity;
    const strain=advanceViscousStrain(group.strain,group.strainVelocity,group.velocity,elapsed);group.strain=strain.position;group.strainVelocity=strain.velocity;
    if(isReduced()||(Math.abs(group.target-group.x)<.08&&Math.abs(group.velocity)<1&&Math.abs(group.strain)<.001&&Math.abs(group.strainVelocity)<.01)){group.x=group.target;group.velocity=group.strain=group.strainVelocity=0;group.moving=false}paintGroup(group);moving=moving||group.moving;
  });
  presses.forEach((state,element)=>{
    if(!element.isConnected){presses.delete(element);return}if(!state.moving)return;
    const next=advanceSpring(state.position,state.velocity,state.target,elapsed,state.target===1?480:650,state.target===1?24:38);state.position=next.position;state.velocity=next.velocity;
    if(isReduced()||(Math.abs(state.target-state.position)<.0004&&Math.abs(state.velocity)<.004)){state.position=state.target;state.velocity=0;state.moving=false}paintPress(state);moving=moving||state.moving;
    if(!state.moving&&!state.held.size&&state.target===1)presses.delete(element);
  });
  if(moving)motionFrame=requestAnimationFrame(tick);else motionTime=0;
}
function targetFrom(event){
  const target=event.target;if(!target||!target.closest)return null;
  const range=target.closest('input[type="range"]');if(range&&!range.disabled)return pressState(range,'range');
  const button=target.closest(PRESSES);if(!button||button.disabled||button.getAttribute('aria-disabled')==='true')return null;return pressState(button,'button');
}
export function isRangeInteracting(){return Array.from(pointers.values()).some(state=>state.kind==='range')}
function down(event,id){
  const state=targetFrom(event);if(!state)return;if(pointers.has(id))up(id);
  if(!state.held.size){
    const rect=state.element.getBoundingClientRect(),scale=state.kind==='button'?state.position||1:1,width=rect.width/scale,height=rect.height/scale;
    // Hit testing follows the original touch target, never its pressed scale.
    state.hitRect={left:rect.left+(rect.width-width)/2,right:rect.left+(rect.width+width)/2,top:rect.top+(rect.height-height)/2,bottom:rect.top+(rect.height+height)/2};
  }
  pointers.set(id,state);state.held.add(id);state.inside.set(id,true);targetPress(state,true);
}
function up(id){
  const state=pointers.get(id);if(!state)return;const wasRange=state.kind==='range';pointers.delete(id);state.held.delete(id);state.inside.delete(id);targetPress(state,Array.from(state.inside.values()).some(Boolean));
  if(wasRange&&!isRangeInteracting())window.dispatchEvent(new CustomEvent('listenly-seek-release'));
}
function releaseAll(){Array.from(pointers.keys()).forEach(up)}
function changed(){if(isReduced()){syncGlass(mountedRoot||document);return}if(!scheduled)scheduled=requestAnimationFrame(()=>{scheduled=0;syncGlass(mountedRoot||document)})}

export function syncGlass(root=mountedRoot||document){
  const present=new Set();all(root,SEGMENTS).forEach(element=>{const key=groupKey(element);present.add(key);let group=groups.get(key);if(!group){group=createGroup(key);groups.set(key,group)}syncGroup(group,element)});
  groups.forEach((group,key)=>{if(!present.has(key)&&group.element&&!group.element.isConnected){if(!group.detachedAt)group.detachedAt=performance.now();group.moving=false}});
  const targets=all(root,PRESSES),fresh=new Map();targets.forEach(element=>{if(!element.hasAttribute('data-glass-press'))element.setAttribute('data-glass-press','');const key=pressKey(element);if(key&&!fresh.has(key))fresh.set(key,element)});
  // A mode/display click replaces its panel after pointerup. Transfer the
  // released spring to the corresponding new button rather than snapping it.
  presses.forEach((state,old)=>{if(old.isConnected||!state.key)return;const replacement=fresh.get(state.key);if(!replacement||presses.has(replacement))return;presses.delete(old);state.element=replacement;presses.set(replacement,state);paintPress(state)});
  all(root,STATIC_LENSES).forEach(element=>ensureLens(element));
}

export function mountGlass(root=document){
  if(observer){syncGlass(root);return}
  mountedRoot=root;reduced=matchMedia('(prefers-reduced-motion: reduce)');
  if(window.PointerEvent){
    listen(window,'pointerdown',event=>{if(event.pointerType==='mouse'&&event.button!==0)return;down(event,event.pointerId)},true);
    listen(window,'pointerup',event=>up(event.pointerId),true);listen(window,'pointercancel',event=>up(event.pointerId),true);
    listen(window,'pointermove',event=>{const state=pointers.get(event.pointerId);if(!state||state.kind==='range')return;const rect=state.hitRect,inside=event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom;state.inside.set(event.pointerId,inside);targetPress(state,Array.from(state.inside.values()).some(Boolean))},true);
  }else{
    listen(window,'mousedown',event=>{if(event.button===0)down(event,'mouse')},true);listen(window,'mouseup',()=>up('mouse'),true);
    listen(window,'touchstart',event=>{Array.from(event.changedTouches).forEach(touch=>down({target:touch.target},`touch-${touch.identifier}`))},{capture:true,passive:true});
    ['touchend','touchcancel'].forEach(type=>listen(window,type,event=>Array.from(event.changedTouches).forEach(touch=>up(`touch-${touch.identifier}`)),{capture:true,passive:true}));
  }
  listen(window,'keydown',event=>{if(event.repeat||!['Enter',' '].includes(event.key))return;down(event,`key-${event.key}`)},true);
  listen(window,'keyup',event=>up(`key-${event.key}`),true);listen(window,'blur',releaseAll);listen(document,'visibilitychange',()=>{if(document.hidden)releaseAll()});
  listen(window,'resize',()=>{syncGlass(mountedRoot||document)});
  const reduce=()=>{releaseAll();syncGlass(mountedRoot||document);presses.forEach(state=>{state.position=state.target;state.velocity=0;state.moving=false;paintPress(state)})};
  if(reduced.addEventListener)listen(reduced,'change',reduce);else if(reduced.addListener){reduced.addListener(reduce);removers.push(()=>reduced.removeListener(reduce))}
  observer=new MutationObserver(changed);observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['class','aria-pressed','aria-checked','data-current']});syncGlass(root);
}

export function disposeGlass(){
  if(observer)observer.disconnect();observer=null;removers.splice(0).forEach(remove=>remove());if(scheduled)cancelAnimationFrame(scheduled);if(motionFrame)cancelAnimationFrame(motionFrame);scheduled=0;motionFrame=0;motionTime=0;mountedRoot=null;
  groups.forEach(group=>{if(group.lens)group.lens.remove()});presses.forEach(state=>{state.element.style.removeProperty('--press-scale');state.element.style.removeProperty('--thumb-scale');const shell=state.element.closest('.seek-shell');if(shell)shell.style.removeProperty('--thumb-scale')});
  groups.clear();presses.clear();pointers.clear();filters.clear();if(optics)optics.remove();optics=null;defs=null;
}
