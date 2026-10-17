import test from 'node:test';
import assert from 'node:assert/strict';
import {playbackModes,normalizePlaybackMode,playbackModeDetails,nextPlaybackMode,nextPlaybackArticle} from '../app/src/main/assets/web/playback-modes.js';

const passages=[
  {id:'a',audio:{intensive:'a.wav'}},
  {id:'text-only',audio:{}},
  {id:'b',audio:{exam:'b.wav'}},
  {id:'c',audio:{intensive:'c.wav'}}
];

test('unknown saved modes migrate to sequential playback',()=>{
  for(const mode of [undefined,null,'loop',{},42])assert.equal(normalizePlaybackMode(mode),'sequential');
  for(const mode of playbackModes)assert.equal(normalizePlaybackMode(mode.id),mode.id);
});

test('the mode button cycles through all three accessible choices',()=>{
  const ids=[];let mode='sequential';
  for(let i=0;i<3;i++){ids.push(mode);assert.ok(playbackModeDetails(mode).label);mode=nextPlaybackMode(mode)}
  assert.deepEqual(ids,['sequential','repeat','shuffle']);assert.equal(mode,'sequential');
});

test('sequential playback follows paper order and skips text-only passages',()=>{
  assert.equal(nextPlaybackArticle(passages,'a','sequential'),passages[2]);
  assert.equal(nextPlaybackArticle(passages,'b','sequential'),passages[3]);
  assert.equal(nextPlaybackArticle(passages,'c','sequential'),passages[0]);
});

test('a missing current passage starts at the first playable passage',()=>{
  assert.equal(nextPlaybackArticle(passages,'deleted','sequential'),passages[0]);
  assert.equal(nextPlaybackArticle(passages,'text-only','repeat'),passages[0]);
});

test('single passage repeat retains the same passage',()=>{
  assert.equal(nextPlaybackArticle(passages,'b','repeat'),passages[2]);
});

test('shuffle excludes the current passage without reordering the paper',()=>{
  const original=passages.slice();
  assert.equal(nextPlaybackArticle(passages,'b','shuffle',()=>0),passages[0]);
  assert.equal(nextPlaybackArticle(passages,'b','shuffle',()=>.9999),passages[3]);
  assert.deepEqual(passages,original);
});

test('shuffle handles random endpoint and invalid values without losing playback',()=>{
  for(const value of [1,2,Infinity,NaN,-1]){
    const next=nextPlaybackArticle(passages,'b','shuffle',()=>value);
    assert.ok(next&&next.id!=='b');
  }
});

test('a single available passage remains playable in every mode',()=>{
  for(const mode of playbackModes)assert.equal(nextPlaybackArticle([passages[0]],'a',mode.id),passages[0]);
});

test('empty or text-only papers have no queued recording',()=>{
  for(const items of [undefined,[],[passages[1]]])assert.equal(nextPlaybackArticle(items,'a','sequential'),null);
});
