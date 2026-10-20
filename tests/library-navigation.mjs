// Disclosure arrows preview a paper in place. The suite title explicitly
// selects it, while playback has its own material-play control.
export async function expandLibraryCollection(page,collection){
 const button=page.locator(`[data-action="open-collection"][data-collection="${collection}"]`);
 await button.waitFor();if(await button.getAttribute('aria-expanded')!=='true')await button.click();
 const id=await button.getAttribute('aria-controls');if(id)await page.waitForFunction(id=>document.getElementById(id)?.dataset.motionState==='open',id);
}

export async function enterLibraryPaper(page,paper){
 const group=page.locator(`[data-action="open-paper"][data-paper="${paper}"]`),tried=new Set();
 const preferred=paper.startsWith('cet6')?'cet6':paper.startsWith('ielts')?'ielts':paper.startsWith('toefl')?'toefl':paper.startsWith('listenly-original')?'original':'imported';
 for(let attempt=0;attempt<24;attempt++){
  if(await group.count()){
   const collection=await group.evaluate(button=>button.closest('[data-library-collection]')?.dataset.libraryCollection);
   if(collection)await expandLibraryCollection(page,collection);
   if(await group.isVisible()){
    if(await group.getAttribute('aria-expanded')!=='true')await group.click();
    const id=await group.getAttribute('aria-controls');if(id)await page.waitForFunction(id=>document.getElementById(id)?.dataset.motionState==='open',id);return;
   }
  }
  const ids=await page.locator('[data-action="open-collection"]').evaluateAll(rows=>rows.map(row=>row.dataset.collection));
  const collection=(!tried.has(preferred)&&ids.includes(preferred)?preferred:ids.find(id=>!tried.has(id)));
  if(collection){tried.add(collection);await expandLibraryCollection(page,collection)}else{tried.clear();await page.waitForTimeout(150)}
 }
 await group.waitFor();throw new Error(`Paper ${paper} did not become available in the expanded library`);
}

export async function collapseLibraryPaper(page,paper){
 const button=page.locator(`[data-action="open-paper"][data-paper="${paper}"]`);
 if(await button.getAttribute('aria-expanded')==='true')await button.click();
 const id=await button.getAttribute('aria-controls');await page.waitForFunction(id=>document.getElementById(id)?.dataset.motionState==='closed',id);
}

export async function openLibraryArticle(page,paper,article){
 await enterLibraryPaper(page,paper);
 const selector=`[data-action="open"][data-paper="${paper}"]${article?`[data-article="${article}"]`:''}`;
 await page.locator(selector).first().click();
}

// Follow the same two gestures a person uses after the reader header was
// simplified: return home, then use the persistent navigation destination.
export async function clickAppControl(page,selector){
 if(/data-action=["\']nav["\']/.test(selector)&&/data-route=["\'](?:library|profile)["\']/.test(selector)&&!await page.locator(selector).count()){
  await page.locator('[data-action="nav"][data-route="home"]').first().click();
  await page.locator('.focus-card').waitFor();
 }
 await page.locator(selector).first().click();
 if(/set-filter|close-dialog/.test(selector))await page.waitForFunction(()=>!document.querySelector('.speed-shade.is-closing,.dialog-shade.is-closing'));
}

export const navigateToLibrary=page=>clickAppControl(page,'[data-action="nav"][data-route="library"]');
