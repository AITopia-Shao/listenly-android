// Change the palette only at its endpoints. Actual CSS colors and wallpaper
// opacity interpolate in the browser, without invalidating every inherited
// custom property on every animation frame or replacing any live controls.
const root=document.documentElement;
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const duration=300;
let initialized=false,timer=0,pending=null,wallpaper=null;

function complete(){
  clearTimeout(timer);timer=0;
  const callback=pending?.callback;pending=null;
  delete root.dataset.themeTransition;
  callback?.();
}

function wallpaperSettled(){
  return !wallpaper||Math.abs(Number(getComputedStyle(wallpaper).opacity)-(pending?.theme==='dark'?1:0))<.001;
}

function wallpaperEnded(event){
  if(pending&&event.target===wallpaper&&event.propertyName==='opacity'&&wallpaperSettled())complete();
}

export function transitionTheme(value,onFinish){
  const theme=value==='dark'?'dark':'light';
  if(!initialized||reduced.matches){
    initialized=true;clearTimeout(timer);pending=null;
    delete root.dataset.themeTransition;
    if(root.dataset.theme!==theme)root.dataset.theme=theme;
    onFinish?.();return;
  }
  // Re-selecting an appearance does not restart its native transition. The
  // latest completion callback still belongs to the current application state.
  if(root.dataset.theme===theme){
    if(pending)pending.callback=onFinish;else onFinish?.();
    return;
  }
  clearTimeout(timer);
  const night=document.querySelector('.wallpaper-night');
  if(night!==wallpaper){
    wallpaper?.removeEventListener('transitionend',wallpaperEnded);
    wallpaper=night;wallpaper?.addEventListener('transitionend',wallpaperEnded);
  }
  pending={theme,callback:onFinish};
  root.dataset.themeTransition='true';
  root.dataset.theme=theme;
  // CSS reversals continue at the currently displayed color/opacity and may
  // finish sooner than a full transition. A timer covers hidden documents and
  // old WebViews that do not deliver transitionend reliably.
  timer=setTimeout(complete,duration+100);
}

const motionChanged=()=>{if(reduced.matches&&pending)complete()};
if(reduced.addEventListener)reduced.addEventListener('change',motionChanged);
else if(reduced.addListener)reduced.addListener(motionChanged);
