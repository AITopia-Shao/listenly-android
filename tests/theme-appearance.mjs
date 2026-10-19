// Serializable browser reader. A View Transition blends an old capture with a
// live new capture; the live body's CSS is already at its endpoint. Read the
// real pseudo-element alpha rather than mistaking endpoint CSS for a flash.
// theme-compositor.test.mjs independently checks this mapping against PNG pixels.
export function readThemeAppearance(){
 const root=document.documentElement,body=getComputedStyle(document.body),renderer=root.dataset.themeRenderer||'settled',theme=root.dataset.theme==='dark'?'dark':'light',from=root.dataset.themeFrom==='dark'?'dark':'light';
 const animation=document.getAnimations().find(item=>item.effect?.pseudoElement==='::view-transition-new(root)'),night=document.querySelector('.wallpaper-night');
 let alpha=null,visibleNight=night?Number(getComputedStyle(night).opacity):theme==='dark'?1:0,background=body.backgroundColor;
 if(renderer==='composite'){
  alpha=animation?Number(getComputedStyle(root,'::view-transition-new(root)').opacity):0;
  if(!Number.isFinite(alpha))alpha=0;alpha=Math.max(0,Math.min(1,alpha));
  const oldNight=from==='dark'?1:0,newNight=theme==='dark'?1:0;
  visibleNight=oldNight+(newNight-oldNight)*alpha;
  const gray=Math.round(250*(1-visibleNight));background=`rgb(${gray}, ${gray}, ${gray})`;
 }
 return {time:performance.now(),renderer,theme,from,background,rawBackground:body.backgroundColor,color:body.color,night:visibleNight,rawNight:night?Number(getComputedStyle(night).opacity):null,pseudoOpacity:alpha,animationTime:animation?Number(animation.currentTime):null,animationRate:animation?.playbackRate??null,animationState:animation?.playState??null,pending:root.hasAttribute('data-theme-transition')};
}

export async function installThemeAppearanceReader(page){
 await page.addInitScript(`window.__themeAppearanceRead=(${readThemeAppearance.toString()});`);
}
