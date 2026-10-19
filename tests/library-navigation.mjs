// Entering a paper/article previews it. Selection remains a separate right-hand
// explicit selection action, while playback has its own material-play control.
export async function enterLibraryPaper(page,paper){
 const group=page.locator(`[data-action="open-paper"][data-paper="${paper}"]`);
 const tried=new Set(),preferred=paper.startsWith('cet6')?'cet6':paper.startsWith('ielts')?'ielts':paper.startsWith('toefl')?'toefl':paper.startsWith('listenly-original')?'original':'imported';
 for(let attempt=0;attempt<12;attempt++){
  if(await group.count()){await group.first().click();return}
  if(await page.locator(`#library-list [data-action="open"][data-paper="${paper}"]`).count())return;
  const back=page.locator('[data-action="library-back"]');
  if(await back.count()&&!await page.locator('[data-action="open-collection"]').count()){await back.first().click();continue}
  const ids=await page.locator('[data-action="open-collection"]').evaluateAll(rows=>rows.map(row=>row.dataset.collection));
  const collection=(!tried.has(preferred)&&ids.includes(preferred)?preferred:ids.find(id=>!tried.has(id)));
  if(collection){tried.add(collection);await page.locator(`[data-action="open-collection"][data-collection="${collection}"]`).click()}
  else{tried.clear();await page.waitForTimeout(150)}
 }
 await group.first().waitFor();await group.first().click();
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
