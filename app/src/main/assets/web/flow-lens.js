// One moving piece of glass belongs to a list, rather than to each row. Layout
// coordinates stay in the list's content space, so scrolling never moves the
// lens away from the sentence or material it belongs to.
import {advanceSpring,advanceViscousStrain,ensureLens} from './glass.js';

const lists=new Map();
const measuredElements=new Map();
const emphasisValues=new WeakMap(),pendingLists=new Set(),pendingRoots=new Set();
let mountedRoot=null,observer=null,layoutObserver=null,reduced=null,scheduled=0,frame=0,lastTime=0,ticking=false;
const removers=[];

export function flowEmphasis(center,height,itemCenter,itemHeight){
  const reach=Math.max(height,itemHeight)*.7+10;
  return Math.pow(Math.max(0,1-Math.abs(center-itemCenter)/reach),2);
}

function isReduced(){return !!(reduced&&reduced.matches)}
function all(root,selector){const nodes=Array.from(root.querySelectorAll(selector));if(root.nodeType===1&&root.matches(selector))nodes.unshift(root);return nodes}
function keyFor(element){return element.getAttribute('data-flow-list')||'flow'}
function selected(item){return item.classList.contains('is-selected')||item.classList.contains('selected')||item.classList.contains('active')||item.getAttribute('aria-current')==='true'||item.getAttribute('aria-checked')==='true'||item.getAttribute('data-selected')==='true'}
function itemsFor(element){return Array.from(element.querySelectorAll('[data-flow-item]')).filter(item=>item.closest('[data-flow-list]')===element)}
function layoutBounds(item,list){
  let left=0,top=0,node=item;
  while(node&&node!==list){left+=node.offsetLeft;top+=node.offsetTop;node=node.offsetParent}
  if(node!==list){const itemBounds=item.getBoundingClientRect(),listBounds=list.getBoundingClientRect();left=itemBounds.left-listBounds.left+list.scrollLeft-list.clientLeft;top=itemBounds.top-listBounds.top+list.scrollTop-list.clientTop}
  return {left,top,width:item.offsetWidth,height:item.offsetHeight};
}
function unwatchLayout(state){
  if(!state.observed)return;
  state.observed.forEach(element=>{if(layoutObserver)layoutObserver.unobserve(element);measuredElements.delete(element)});state.observed.clear();
}
function watchLayout(state){
  if(!layoutObserver)return;
  const next=new Set([state.element,...state.items]);
  if(!state.observed)state.observed=new Set();
  state.observed.forEach(element=>{if(!next.has(element)){layoutObserver.unobserve(element);measuredElements.delete(element)}});
  next.forEach(element=>{
    if(!state.observed.has(element))layoutObserver.observe(element);
  });state.observed=next;
  measuredElements.set(state.element,{state,width:state.listWidth,height:state.listHeight});
  state.metrics.forEach(metric=>measuredElements.set(metric.item,{state,width:metric.width,height:metric.height}));
}
function geometryChanged(state){
  return state.metrics.some(metric=>{
    if(!metric.item.isConnected)return true;
    const bounds=layoutBounds(metric.item,state.element);
    return ['left','top','width','height'].some(property=>Math.abs(bounds[property]-metric[property])>.5);
  });
}
function flushSync(){
  scheduled=0;const roots=Array.from(pendingRoots),states=Array.from(pendingLists);pendingRoots.clear();pendingLists.clear();
  roots.forEach(root=>{if(root.isConnected)syncFlowLenses(root)});states.forEach(state=>{if(state.element?.isConnected)syncList(state,state.element,false)});
  cleanDetached();
}
function scheduleSync(state){if(state)pendingLists.add(state);if(!scheduled)scheduled=requestAnimationFrame(flushSync)}
function emphasis(item,value){
  value=Math.round(value*10000)/10000;if(emphasisValues.get(item)===value)return;emphasisValues.set(item,value);
  item.style.setProperty('--lens-emphasis',String(value));
  item.style.setProperty('--lens-scale',String(1+value*.025));
  item.style.setProperty('--lens-weight',String(400+value*180));
  item.style.setProperty('--lens-contrast',String(value));
}
function paint(state){
  if(!state.lens||!state.element.isConnected)return;
  if(!state.target){if(state.visible!==false){state.lens.style.opacity='0';state.visible=false}state.metrics.forEach(metric=>emphasis(metric.item,0));return}
  const strength=Math.min(1,Math.abs(state.strain)),stretch=1+strength*.105,squash=1-strength*.045,width=Math.max(1,Math.min(state.containerWidth,state.width)),height=Math.max(1,state.height),extent=(height*stretch+width*Math.abs(Math.tan(state.strain*.65*Math.PI/180)))/2;
  const x=Math.max(width/2,Math.min(state.containerWidth-width/2,state.x)),y=Math.max(extent,Math.min(Math.max(extent,state.contentHeight-extent),state.y));
  if(state.paintedWidth!==width){state.lens.style.width=`${width}px`;state.paintedWidth=width}if(state.paintedHeight!==height){state.lens.style.height=`${height}px`;state.paintedHeight=height}
  state.lens.style.transform=`translate3d(${x-width/2}px,${y-height/2}px,0) scale(${squash},${stretch}) skewY(${state.strain*.65}deg)`;
  if(state.visible!==true){state.lens.style.opacity='1';state.visible=true}state.element.style.setProperty('--flow-velocity',String(strength));
  state.metrics.forEach(metric=>emphasis(metric.item,flowEmphasis(y,height,metric.top+metric.height/2,metric.height)));
}
function mapSettled(state){
  if(Math.abs(state.mapWidth-state.width)<.5&&Math.abs(state.mapHeight-state.height)<.5)return;
  ensureLens(state.lens,state.radius);state.mapWidth=state.width;state.mapHeight=state.height;
}
function snap(state){
  state.x=state.target.x;state.y=state.target.y;state.width=state.target.width;state.height=state.target.height;
  state.vx=state.vy=state.vw=state.vh=state.strain=state.strainVelocity=0;state.moving=false;paint(state);mapSettled(state);
}
function requestMotion(){if(!frame&&!ticking){lastTime=0;frame=requestAnimationFrame(tick)}}
function tick(time){
  frame=0;ticking=true;const elapsed=Math.min(.064,Math.max(.001,(time-(lastTime||time-16.667))/1000));lastTime=time;let moving=false;
  lists.forEach(state=>{
    if(!state.element||!state.element.isConnected){state.moving=false;return}
    if(!state.moving||!state.target)return;
    if(isReduced()){snap(state);return}
    for(const [property,velocity] of [['x','vx'],['y','vy'],['width','vw'],['height','vh']]){
      const next=advanceSpring(state[property],state[velocity],state.target[property],elapsed,property==='height'?380:460,31);state[property]=next.position;state[velocity]=next.velocity;
    }
    const strain=advanceViscousStrain(state.strain,state.strainVelocity,state.vy,elapsed);state.strain=strain.position;state.strainVelocity=strain.velocity;
    const settled=['x','y','width','height'].every(property=>Math.abs(state[property]-state.target[property])<.08)&&Math.max(Math.abs(state.vx),Math.abs(state.vy),Math.abs(state.vw),Math.abs(state.vh))<1&&Math.abs(state.strain)<.001&&Math.abs(state.strainVelocity)<.01;
    if(settled&&!layoutObserver&&geometryChanged(state))syncList(state,state.element,true);
    else if(settled)snap(state);else paint(state);moving=moving||state.moving;
  });
  ticking=false;if(moving)frame=requestAnimationFrame(tick);else lastTime=0;
}
function syncList(state,element,force){
  const changed=state.element!==element,missingLens=!state.lens||state.lens.parentNode!==element,items=itemsFor(element),active=items.find(selected)||null;
  const changedItems=items.length!==state.items.length||items.some((item,index)=>item!==state.items[index]);
  if(!changed&&!missingLens&&!changedItems&&!force&&!state.dirty&&active===state.active)return;
  state.element=element;state.items=items;state.active=active;state.dirty=false;state.itemsDirty=false;
  if(changed||missingLens){state.lens=document.createElement('span');state.lens.className='flow-lens';state.lens.setAttribute('aria-hidden','true');element.insertBefore(state.lens,element.firstChild);state.mapWidth=state.mapHeight=-1;state.paintedWidth=state.paintedHeight=state.visible=null}
  const css=getComputedStyle(element),insetX=parseFloat(css.getPropertyValue('--flow-inset-x'))||0,insetY=parseFloat(css.getPropertyValue('--flow-inset-y'))||0;
  state.radius=parseFloat(css.getPropertyValue('--flow-lens-radius'))||18;
  state.metrics=items.map(item=>({item,...layoutBounds(item,element)}));
  state.contentHeight=state.metrics.reduce((bottom,metric)=>Math.max(bottom,metric.top+metric.height),0);
  state.containerWidth=element.clientWidth;state.listWidth=element.offsetWidth;state.listHeight=element.offsetHeight;
  // Cache sizes before paint changes the variable font weight. Observing every
  // row also catches an earlier sentence shrinking and moving the active one.
  watchLayout(state);
  const metric=state.metrics.find(item=>item.item===active);
  if(!metric){state.target=null;state.moving=false;paint(state);return}
  const width=Math.max(1,metric.width-insetX*2),height=Math.max(1,metric.height-insetY*2);
  state.target={x:metric.left+metric.width/2,y:metric.top+metric.height/2,width,height};
  if(!state.initialized||isReduced()){
    state.initialized=true;snap(state);
    if(!layoutObserver&&geometryChanged(state)){state.dirty=true;scheduleSync(state)}
  }else{
    // A replacement DOM keeps both position and momentum for this same list.
    // Different article lists use different keys and start on their own row.
    state.moving=true;paint(state);if(state.mapWidth<0)mapSettled(state);requestMotion();
  }
}

function cleanDetached(){
  lists.forEach(state=>{
    if(state.element&&!state.element.isConnected){
      unwatchLayout(state);state.moving=false;state.element=null;state.lens=null;state.items=[];state.metrics=[];state.active=null;
    }
  });
}
export function syncFlowLenses(root=mountedRoot||document,force=false){
  all(root,'[data-flow-list]').forEach(element=>{
    const key=keyFor(element);let state=lists.get(key);
    if(!state){state={key,element:null,lens:null,items:[],metrics:[],active:null,target:null,x:0,y:0,width:1,height:1,vx:0,vy:0,vw:0,vh:0,strain:0,strainVelocity:0,initialized:false,moving:false,dirty:false,mapWidth:-1,mapHeight:-1};lists.set(key,state)}
    syncList(state,element,force);
  });
  cleanDetached();
}

export function mountFlowLenses(root=document){
  if(observer){syncFlowLenses(root);return}
  mountedRoot=root;reduced=matchMedia('(prefers-reduced-motion: reduce)');
  if(typeof ResizeObserver==='function')layoutObserver=new ResizeObserver(entries=>{
    entries.forEach(entry=>{const measured=measuredElements.get(entry.target);if(!measured)return;const width=entry.target.offsetWidth,height=entry.target.offsetHeight;if(width!==measured.width||height!==measured.height){measured.width=width;measured.height=height;measured.state.dirty=true;scheduleSync(measured.state)}});
  });
  const changed=records=>{
    let cleanup=false;
    records.forEach(record=>{
      const target=record.target.nodeType===1?record.target:record.target.parentElement,list=target?.closest('[data-flow-list]'),state=list&&lists.get(keyFor(list));
      if(record.type==='attributes'){if(state&&state.element===list)scheduleSync(state);return}
      const generated=node=>node.nodeType===1&&(node.classList.contains('flow-lens')||node.closest('.glass-optics,.nav-optics'));
      if(state&&state.element===list&&[...record.addedNodes,...record.removedNodes].some(node=>!generated(node))){state.dirty=true;state.itemsDirty=true;scheduleSync(state)}
      record.addedNodes.forEach(node=>{if(node.nodeType!==1||generated(node))return;if(node.matches('[data-flow-list]')||node.querySelector('[data-flow-list]')){pendingRoots.add(node);scheduleSync()}});
      if(Array.from(record.removedNodes).some(node=>node.nodeType===1&&!generated(node)))cleanup=true;
    });
    if(cleanup)scheduleSync();
  };
  observer=new MutationObserver(changed);observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['class','aria-current','aria-checked','data-selected']});
  const resize=()=>syncFlowLenses(mountedRoot,true),reduce=()=>{syncFlowLenses(mountedRoot,true);lists.forEach(state=>{if(state.target&&isReduced())snap(state)})};
  window.addEventListener('resize',resize);removers.push(()=>window.removeEventListener('resize',resize));
  if(reduced.addEventListener){reduced.addEventListener('change',reduce);removers.push(()=>reduced.removeEventListener('change',reduce))}else if(reduced.addListener){reduced.addListener(reduce);removers.push(()=>reduced.removeListener(reduce))}
  // Image and font loads can change sentence wrapping without a window resize.
  const relayout=()=>{lists.forEach(state=>{if(state.element?.isConnected){state.dirty=true;scheduleSync(state)}})};
  root.addEventListener('load',relayout,true);removers.push(()=>root.removeEventListener('load',relayout,true));
  if(document.fonts&&document.fonts.ready)document.fonts.ready.then(()=>{if(observer)relayout()});
  syncFlowLenses(root);
}

export function disposeFlowLenses(){
  if(observer)observer.disconnect();observer=null;if(layoutObserver)layoutObserver.disconnect();layoutObserver=null;measuredElements.clear();removers.splice(0).forEach(remove=>remove());if(scheduled)cancelAnimationFrame(scheduled);if(frame)cancelAnimationFrame(frame);scheduled=frame=lastTime=0;ticking=false;
  lists.forEach(state=>{if(state.lens)state.lens.remove();state.items.forEach(item=>['--lens-emphasis','--lens-scale','--lens-weight','--lens-contrast'].forEach(property=>item.style.removeProperty(property)))});
  lists.clear();mountedRoot=null;reduced=null;
  pendingLists.clear();pendingRoots.clear();
}
