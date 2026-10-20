// Crossfade rendered appearances instead of animating the wallpaper under
// every glass filter. The new view stays live; audio and controls are not cloned.
const root=document.documentElement;
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const duration=300;
let initialized=false,timer=0,pending=null,wallpaper=null,forwardedTap=null,nativeSequence=0;

function complete(transaction=pending){
  if(!transaction||transaction!==pending)return;
  clearTimeout(timer);timer=0;pending=null;
  // Restore the original appearance under a reversed snapshot before release.
  if(root.dataset.theme!==transaction.theme)root.dataset.theme=transaction.theme;
  transaction.view?.skipTransition();
  if(transaction.renderer==='native'){
    try{window.Android.finishThemeTransition(transaction.nativeId)}catch{}
  }
  delete root.dataset.themeTransition;
  delete root.dataset.themeRenderer;
  delete root.dataset.themeFrom;
  transaction.callback?.();
}

function wallpaperEnded(event){
  if(pending?.renderer!=='fallback'||event.target!==wallpaper||event.propertyName!=='opacity')return;
  const target=pending.theme==='dark'?1:0;
  if(Math.abs(Number(getComputedStyle(wallpaper).opacity)-target)<.001)complete();
}

function cssFade(transaction){
  transaction.renderer='fallback';root.dataset.themeRenderer='fallback';
  const night=document.querySelector('.wallpaper-night');
  if(night!==wallpaper){
    wallpaper?.removeEventListener('transitionend',wallpaperEnded);
    wallpaper=night;wallpaper?.addEventListener('transitionend',wallpaperEnded);
  }
  root.dataset.theme=transaction.theme;
  timer=setTimeout(()=>complete(transaction),duration+100);
}

function directAnimation(transaction){
  const animation=transaction.animation;if(!animation)return;
  const forward=transaction.theme!==transaction.from;
  // A new ViewTransition would skip the old one to its endpoint and flash.
  // Reversing this same animation preserves the currently composited mixture.
  animation.updatePlaybackRate(forward?1:-1);
  if(!forward&&Number(animation.currentTime)<=0){complete(transaction);return}
  animation.play();
  animation.finished.then(()=>complete(transaction),()=>{});
}

// Android animates one captured bitmap in its host view. The WebView commits
// its new palette once, under that bitmap; no live full-page snapshot or CSS
// backdrop interpolation runs for every frame of the fade.
function nativeAnimation(transaction){
  if(!transaction.nativeReady||!transaction.applied)return;
  clearTimeout(timer);timer=setTimeout(()=>complete(transaction),1800);
  try{window.Android.animateThemeTransition(transaction.nativeId,transaction.theme===transaction.from)}
  catch{complete(transaction)}
}

window.listenlyThemeNativeReady=(id,ok)=>{
  const transaction=pending;
  if(transaction?.renderer!=='native'||transaction.nativeId!==id)return;
  clearTimeout(timer);
  if(!ok||transaction.theme===transaction.from){complete(transaction);return}
  transaction.nativeReady=true;
  transaction.applied=transaction.theme;
  root.dataset.theme=transaction.applied;
  nativeAnimation(transaction);
};

window.listenlyThemeNativeEnd=(id,toOriginal)=>{
  const transaction=pending;
  if(transaction?.renderer!=='native'||transaction.nativeId!==id)return;
  if(toOriginal===(transaction.theme===transaction.from))complete(transaction);
  else nativeAnimation(transaction);
};

export function transitionTheme(value,onFinish){
  const theme=value==='dark'?'dark':'light';
  if(!initialized||reduced.matches){
    initialized=true;
    if(pending){pending.theme=theme;pending.callback=onFinish;complete()}
    else{root.dataset.theme=theme;onFinish?.()}
    return;
  }
  if(pending){
    pending.callback=onFinish;if(pending.theme===theme)return;
    pending.theme=theme;
    if(pending.renderer==='native')nativeAnimation(pending);
    else if(pending.renderer==='composite')directAnimation(pending);
    else{clearTimeout(timer);cssFade(pending)}
    return;
  }
  if(root.dataset.theme===theme){onFinish?.();return}
  const transaction={theme,from:root.dataset.theme||'light',callback:onFinish};
  pending=transaction;root.dataset.themeTransition='true';
  const bridge=window.Android;
  if(typeof bridge?.beginThemeTransition==='function'&&typeof bridge.animateThemeTransition==='function'&&typeof bridge.finishThemeTransition==='function'){
    transaction.renderer='native';transaction.nativeId=++nativeSequence;
    root.dataset.themeRenderer='native';root.dataset.themeFrom=transaction.from;
    timer=setTimeout(()=>complete(transaction),1800);
    try{if(bridge.beginThemeTransition(transaction.nativeId)!==false)return}catch{}
    clearTimeout(timer);complete(transaction);return;
  }
  if(typeof document.startViewTransition!=='function'||typeof Animation==='undefined'||!Animation.prototype.updatePlaybackRate){cssFade(transaction);return}
  transaction.renderer='composite';root.dataset.themeRenderer='composite';
  root.dataset.themeFrom=transaction.from;
  // Captured descendants are excluded from Blink hit testing even when the
  // snapshot overlay has pointer-events:none. Cache the few visible profile
  // controls once, before capture, rather than measuring the page each frame.
  transaction.controls=[...document.querySelectorAll('button:not(:disabled),a[href]')].map(element=>({element,rect:element.getBoundingClientRect()})).filter(({rect})=>rect.width&&rect.height&&rect.bottom>0&&rect.top<innerHeight);
  try{
    transaction.view=document.startViewTransition(()=>{
      // The capture callback can arrive after cancellation or a rapid retap.
      if(pending===transaction)root.dataset.theme=transaction.theme;
    });
    transaction.view.ready.then(()=>{
      if(pending!==transaction)return;
      transaction.animation=document.getAnimations().find(animation=>animation.effect?.pseudoElement==='::view-transition-new(root)');
      if(!transaction.animation){complete(transaction);return}
      directAnimation(transaction);
    },()=>complete(transaction));
    transaction.view.finished.then(()=>complete(transaction),()=>complete(transaction));
    timer=setTimeout(()=>complete(transaction),1500);
  }catch{cssFade(transaction)}
}

const motionChanged=()=>{if(reduced.matches&&pending)complete()};
if(reduced.addEventListener)reduced.addEventListener('change',motionChanged);
else if(reduced.addListener)reduced.addListener(motionChanged);
// Keep real taps operative while the browser presents captured appearances.
// The original pointer remains trusted; the forwarded DOM events deliberately
// are ordinary synthetic events and still use the existing application handler.
document.addEventListener('pointerdown',event=>{
  if(!event.isTrusted)return;forwardedTap=null;
  if(pending?.renderer==='native'){
    if(!event.target.closest?.('[data-action="theme"]'))complete();
    return;
  }
  if(pending?.renderer!=='composite')return;
  const transaction=pending;
  const hit=transaction.controls?.find(({rect})=>event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom);
  if(hit&&!hit.element.contains(event.target)){
    forwardedTap={...hit,pointerId:event.pointerId,x:event.clientX,y:event.clientY};
    if(!hit.element.matches('[data-action="theme"]'))complete(transaction);
    hit.element.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:event.pointerId,pointerType:event.pointerType,clientX:event.clientX,clientY:event.clientY,button:event.button,buttons:event.buttons}));
  }else if(!event.target.closest?.('[data-action="theme"]'))complete(transaction);
},true);
document.addEventListener('click',event=>{
  if(!event.isTrusted||!forwardedTap)return;
  const tap=forwardedTap;forwardedTap=null;
  if(tap.element.contains(event.target))return;
  event.preventDefault();event.stopImmediatePropagation();
  if(tap.element.isConnected&&!tap.element.disabled&&Math.hypot(event.clientX-tap.x,event.clientY-tap.y)<12)tap.element.click();
},true);
window.addEventListener('pointercancel',()=>{forwardedTap=null},true);
window.addEventListener('pointermove',event=>{if(forwardedTap&&Math.hypot(event.clientX-forwardedTap.x,event.clientY-forwardedTap.y)>12)forwardedTap=null},{capture:true,passive:true});
document.addEventListener('keydown',event=>{if(pending&&!event.target.closest?.('[data-action="theme"]'))complete()},true);
document.addEventListener('visibilitychange',()=>{if(document.hidden&&pending)complete()});
window.addEventListener('resize',()=>{if(pending&&pending.renderer!=='fallback')complete()},{passive:true});
