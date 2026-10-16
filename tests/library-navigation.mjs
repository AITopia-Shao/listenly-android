// Entering a paper/article previews it. Selection remains a separate right-hand
// circle action, while playback has its own material-play control.
export async function enterLibraryPaper(page,paper){
 const group=page.locator(`[data-action="open-paper"][data-paper="${paper}"]`);
 if(await group.count()){await group.first().click();return}
 if(await page.locator(`#library-list [data-action="open"][data-paper="${paper}"]`).count())return;
 const back=page.locator('[data-action="library-back"]');
 if(await back.count())await back.first().click();
 // An IndexedDB-backed import may still be finishing when the root is shown.
 await group.first().waitFor();
 await group.first().click();
}

export async function openLibraryArticle(page,paper,article){
 await enterLibraryPaper(page,paper);
 const selector=`[data-action="open"][data-paper="${paper}"]${article?`[data-article="${article}"]`:''}`;
 await page.locator(selector).first().click();
}
