// A critically damped entrance with a small, controlled spring settle. Closing
// disables input immediately; its visible departure never delays the action.
const motions = new WeakMap();
export function animateOverlay(element, closing = false, onFinish) {
  const prior = motions.get(element);
  if (prior) cancelAnimationFrame(prior.frame);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    element.style.opacity = closing ? '0' : '1';
    element.style.transform = 'none'; onFinish?.(); return;
  }
  const motion = {x:prior?.x ?? (closing ? 1 : 0), velocity:prior?.velocity || 0, frame:0, time:performance.now()};
  const target = closing ? 0 : 1;
  element.dataset.motionState = closing ? 'closing' : 'opening';
  function paint() {
    element.style.opacity = String(Math.max(0, Math.min(1, motion.x * 1.65)));
    element.style.transform = `translateY(${(1-motion.x)*7}px) scale(${.94 + .06*motion.x})`;
  }
  function tick(now) {
    let left = Math.min(.05, (now-motion.time)/1000); motion.time = now;
    while (left > 0) {
      const dt = Math.min(left, 1/120); left -= dt;
      motion.velocity += ((target-motion.x)*590-motion.velocity*(closing?44:34))*dt;
      motion.x += motion.velocity*dt;
    }
    paint();
    if (Math.abs(target-motion.x)<.001 && Math.abs(motion.velocity)<.01) {
      motion.x = target; paint(); motions.delete(element);
      element.dataset.motionState = closing ? 'closed' : 'open'; onFinish?.();
    } else motion.frame=requestAnimationFrame(tick);
  }
  motions.set(element, motion); paint(); motion.frame=requestAnimationFrame(tick);
}
export function dismissOverlay(shade, panel, onFinish) {
  if (!shade || shade.classList.contains('is-closing')) return;
  shade.classList.add('is-closing'); shade.style.pointerEvents = 'none'; shade.setAttribute('aria-hidden','true');
  panel?.removeAttribute('role'); panel?.removeAttribute('id');
  shade.querySelectorAll('button,input,[tabindex]').forEach(button => { button.tabIndex=-1; button.disabled=true; });
  animateOverlay(panel, true, () => { shade.remove(); onFinish?.(); });
}
