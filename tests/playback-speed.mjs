import assert from 'node:assert/strict';

// Independent expectations for the user-visible order. Never read the app's
// rate list to decide what constitutes a correct result.
export const playbackRates=[1,1.25,1.5,1.75,2];
export const nextRate=rate=>playbackRates[(playbackRates.indexOf(rate)+1)%playbackRates.length];

export async function assertSpeed(page,rate,selector='[data-action="speed"]'){
 assert.equal(await page.locator('#audio').evaluate(audio=>audio.playbackRate),rate,'the decoded recording uses the displayed rate');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('listenly.state.v1')).speed),rate,'the applied rate is persisted');
 assert.match((await page.locator(selector).first().innerText()).trim(),new RegExp(`^${String(rate).replace('.','\\.')}\\s*×$`),'the audio control displays its applied rate');
 assert.equal(await page.locator('.speed-popover:not(.filter-popover),[data-action="set-speed"]').count(),0,'speed cycling creates no choice menu');
 assert.notEqual(await page.locator(selector).first().getAttribute('aria-haspopup'),'menu','speed is a direct action rather than a menu trigger');
}

export async function cycleSpeedTo(page,rate,selector='[data-action="speed"]'){
 assert.ok(playbackRates.includes(rate),'requested fixture rate belongs to the public cycle');
 for(let attempt=0;attempt<playbackRates.length;attempt++){
  const current=await page.locator('#audio').evaluate(audio=>audio.playbackRate);
  if(current===rate){await assertSpeed(page,rate,selector);return}
  const expected=nextRate(current);await page.locator(selector).first().click();await assertSpeed(page,expected,selector);
 }
 assert.fail(`The playback control could not cycle to ${rate}`);
}
