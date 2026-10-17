// Both images stay behind the entire app, including dialogs and the player.
// The manifest is replaced only in local personal builds; public builds use
// the project's own vector gradients and never redistribute third-party art.
export async function mountWallpaper(){
  let scene=document.querySelector('#wallpaper-scene');
  if(!scene){scene=document.createElement('div');scene.id='wallpaper-scene';scene.setAttribute('aria-hidden','true');scene.innerHTML='<div class="wallpaper-day"></div><div class="wallpaper-night"></div><div class="wallpaper-wash"></div>';document.body.insertBefore(scene,document.body.firstChild)}
  try{
    const response=await fetch('wallpapers.json');if(!response.ok)return;
    const source=await response.json();
    const safe=value=>typeof value==='string'&&/^wallpapers\/[a-z0-9_-]+\.(?:svg|png|webp|jpg)$/.test(value);
    if(!safe(source.day)||!safe(source.night))return;
    const images=await Promise.all([source.day,source.night].map(path=>new Promise(resolve=>{const image=new Image();image.onload=()=>resolve({path,ok:true});image.onerror=()=>resolve({path,ok:false});image.src=path})));
    if(images.every(image=>image.ok)){
      scene.querySelector('.wallpaper-day').style.backgroundImage=`url("${source.day}")`;
      scene.querySelector('.wallpaper-night').style.backgroundImage=`url("${source.night}")`;
      scene.dataset.profile=source.profile||'original';
    }
  }catch{}
}
