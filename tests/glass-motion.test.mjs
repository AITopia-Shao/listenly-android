import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceSpring,advanceViscousStrain} from '../app/src/main/assets/web/glass.js';
import {flowEmphasis} from '../app/src/main/assets/web/flow-lens.js';

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

test('a moving lens develops a slight delayed strain and releases it smoothly',()=>{
  let position=0,velocity=0;
  ({position,velocity}=advanceViscousStrain(position,velocity,1400,1/60));
  assert.ok(position>0&&position<.12,'the first moving frame does not instantly stretch the surface to full strain');
  for(let i=0;i<20;i++)({position,velocity}=advanceViscousStrain(position,velocity,1400,1/60));
  assert.ok(position>.8&&position<1.05,'continuous travel develops bounded deformation');
  const held=position;
  ({position,velocity}=advanceViscousStrain(position,velocity,0,1/60));
  assert.ok(position>held*.8,'the surface retains a soft tail rather than snapping rigid');
  for(let i=0;i<180;i++)({position,velocity}=advanceViscousStrain(position,velocity,0,1/60));
  assert.ok(Math.abs(position)<1e-6&&Math.abs(velocity)<1e-6,'deformation settles completely without an idle animation');
});

test('reversing motion preserves the material deformation until it can turn',()=>{
  let position=.7,velocity=.4;
  const next=advanceViscousStrain(position,velocity,-1400,1/120);
  assert.ok(next.position>.65,'a direction change keeps a continuous surface');
  ({position,velocity}=next);
  for(let i=0;i<100;i++)({position,velocity}=advanceViscousStrain(position,velocity,-1400,1/60));
  assert.ok(Math.abs(position+1)<.001,'the delayed strain eventually follows the new direction');
});

test('text emphasis follows the moving lens center instead of a discrete selected class',()=>{
  assert.equal(flowEmphasis(100,60,100,60),1);
  assert.equal(flowEmphasis(100,60,200,60),0);
  const before=flowEmphasis(100,60,160,60),during=flowEmphasis(135,60,160,60),after=flowEmphasis(160,60,160,60);
  assert.ok(before<during&&during<after,'the approaching row becomes progressively heavier and clearer');
  for(const height of [30,60,180,400])for(const center of [-100,0,100,500]){
    const value=flowEmphasis(center,height,100,60);assert.ok(value>=0&&value<=1,'multiline sentence heights keep text effects within their range');
  }
});
