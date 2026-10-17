import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceSpring} from '../app/src/main/assets/web/glass.js';

test('a released control rebounds and settles without a linear or permanent scale',()=>{
  let position=.94,velocity=0,peak=position;
  for(let i=0;i<180;i++){
    ({position,velocity}=advanceSpring(position,velocity,1,1/60,480,24));peak=Math.max(peak,position);
  }
  assert.ok(peak>1.003&&peak<1.025,'release visibly crosses neutral once, within a controlled range');
  assert.ok(Math.abs(position-1)<1e-6&&Math.abs(velocity)<1e-6,'the control returns to its exact neutral size');
});

test('an interrupted lens retains velocity while changing destination',()=>{
  let position=50,velocity=0;
  for(let i=0;i<4;i++)({position,velocity}=advanceSpring(position,velocity,150,1/60));
  const before=position,speed=velocity;
  ({position,velocity}=advanceSpring(position,velocity,50,1/120));
  assert.ok(speed>0&&velocity>0,'reversing the target does not discard existing momentum');
  assert.ok(position>before&&position-before<speed/60,'the first frame continues smoothly before reversing');
  for(let i=0;i<180;i++)({position,velocity}=advanceSpring(position,velocity,50,1/60));
  assert.ok(Math.abs(position-50)<1e-5&&Math.abs(velocity)<1e-5);
});

test('slow frames remain stable and a suspended tab cannot create a giant jump',()=>{
  const ordinary=advanceSpring(50,120,150,.064),suspended=advanceSpring(50,120,150,15);
  assert.deepEqual(suspended,ordinary,'elapsed time is bounded after background suspension');
  for(const frame of [1/144,1/60,1/30,.064]){
    let position=0,velocity=0;
    for(let i=0;i<240;i++)({position,velocity}=advanceSpring(position,velocity,200,frame));
    assert.ok(Number.isFinite(position)&&Number.isFinite(velocity));
    assert.ok(Math.abs(position-200)<.001,'all supported frame rates converge on the same target');
  }
});
