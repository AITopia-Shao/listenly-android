import test from 'node:test';
import assert from 'node:assert/strict';
import {mapAudioTime} from '../app/src/main/assets/web/alignment.js';

const timeline=[{clipStart:0,clipEnd:80,articleStart:0},{clipStart:80,clipEnd:90,articleStart:120}];
test('question context and its separated prompt align back to article timestamps',()=>{
  assert.equal(mapAudioTime(30,timeline),30);
  assert.equal(mapAudioTime(84,timeline),124);
  assert.equal(mapAudioTime(80,timeline),120,'a joined prompt starts at its own article timestamp');
  assert.equal(mapAudioTime(124,timeline,'articleToClip'),84);
});
test('other-question timestamps map to closest available boundary without seeking outside a clip',()=>{
  assert.equal(mapAudioTime(115,timeline,'articleToClip'),80);
  assert.equal(mapAudioTime(140,timeline,'articleToClip'),90);
  assert.equal(mapAudioTime(95,timeline),130);
});
test('untimed or invalid imported clips retain their independent saved playback position',()=>{
  assert.equal(mapAudioTime(10,undefined),undefined);
  assert.equal(mapAudioTime(10,[{clipStart:0,clipEnd:Infinity,articleStart:0}]),undefined);
});
