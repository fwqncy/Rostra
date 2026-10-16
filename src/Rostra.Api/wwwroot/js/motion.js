// Motion: GSAP for choreography. Everything here respects reduced motion (OS setting or Settings → Motion).
import { gsap } from '/vendor/gsap/index.js';
import { $, $$, reducedMotion } from './core.js';

export { gsap };

/** New page: its blocks rise into place one after another. */
export function revealPage(container) {
  if (!container || reducedMotion()) return;
  const items = [...container.children].filter((el) => !el.hidden);
  gsap.fromTo(items, { y: 14, autoAlpha: 0 }, {
    y: 0, autoAlpha: 1, duration: 0.55, ease: 'power3.out', stagger: 0.05, clearProps: 'transform,opacity,visibility',
  });
}

export function revealList(nodes) {
  if (reducedMotion() || !nodes?.length) return;
  gsap.fromTo([...nodes], { y: 10, autoAlpha: 0 }, {
    y: 0, autoAlpha: 1, duration: 0.45, ease: 'power2.out', stagger: 0.06, clearProps: 'transform,opacity,visibility',
  });
}

/** Counts a number up from zero, writing it with the given formatter. */
export function countUp(el, to, format) {
  if (!el) return;
  if (reducedMotion()) { el.textContent = format(to); return; }
  const o = { v: 0 };
  gsap.to(o, { v: to, duration: 0.9, ease: 'power2.out', onUpdate: () => { el.textContent = format(o.v); }, onComplete: () => { el.textContent = format(to); } });
}

/** The sidebar vine draws itself in, then its leaves unfurl. */
export function drawVine(svg) {
  if (!svg) return;
  const stem = $('.vine-stem', svg);
  const leaves = $$('.vine-leaf', svg);
  if (reducedMotion() || !stem) return;
  const length = stem.getTotalLength();
  gsap.set(stem, { strokeDasharray: length, strokeDashoffset: length });
  gsap.set(leaves, { scale: 0, transformOrigin: '0% 100%', transformBox: 'fill-box' });
  gsap.timeline({ delay: 0.3 })
    .to(stem, { strokeDashoffset: 0, duration: 2.2, ease: 'power2.inOut' })
    .to(leaves, { scale: 1, duration: 0.6, ease: 'back.out(2)', stagger: 0.25 }, '-=1.6');
}

/** Sign-in: the title surfaces out of the dark, then the tagline, then the cards. */
export function introLogin() {
  if (reducedMotion()) return;
  gsap.timeline({ defaults: { ease: 'power3.out' } })
    .from('.hero-names .eyebrow', { autoAlpha: 0, y: -6, duration: 0.8, stagger: 0.15 }, 0.2)
    .from('.hero-the', { autoAlpha: 0, y: 18, duration: 0.9 }, 0.35)
    .from('.hero-word', { autoAlpha: 0, y: 40, scale: 0.96, filter: 'blur(6px)', duration: 1.4, clearProps: 'filter' }, 0.5)
    .from('.hero-tagline', { autoAlpha: 0, y: 10, duration: 0.9 }, 1.1)
    .from('.hero-stamp', { autoAlpha: 0, rotate: -40, scale: 0.6, duration: 1, ease: 'back.out(1.6)' }, 1.3)
    // Opacity only (never visibility), so the form works from the very first frame.
    .from('.auth-card', { opacity: 0, y: 16, duration: 0.6, clearProps: 'transform,opacity' }, 0);
}
