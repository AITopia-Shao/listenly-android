// Legacy decoder-retry checks need to hold a genuine media end long enough to
// test an explicit user replay. Production queue behavior is exercised without
// this observer by playback-modes-browser.test.mjs. No ended event is fabricated.
export function installReplayEndIsolation(){
 window.__holdReplayQueue=true;
 window.__isolatedReplayEnds=[];
 document.addEventListener('ended',event=>{
  if(!window.__holdReplayQueue||!event.target||event.target.id!=='audio')return;
  const audio=event.target;
  window.__isolatedReplayEnds.push({src:audio.currentSrc,time:audio.currentTime,duration:audio.duration,ended:audio.ended,trusted:event.isTrusted});
  event.stopImmediatePropagation();
  // A pause notification refreshes controls and saves the real endpoint. This
  // deliberately skips completion credit, which has its own non-isolated tests.
  audio.dispatchEvent(new Event('pause'));
 },true);
}
export const replayIsolationDescription='Test-only capture observer holds genuine decoder ends and emits a pause notification, isolating explicit replay/reopen checks from automatic queue advance; completion credit and production ended handlers are covered independently without isolation.';
