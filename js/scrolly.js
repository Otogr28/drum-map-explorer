"use strict";
/* ===========================================================================
   Scroll driven chapters.

   A chapter is a sticky visual next to a column of `.step` blocks. Whichever
   step sits closest to the middle of the viewport is the current one: it gets
   `.on`, and the chapter's handler redraws the visual for it.

   The measurement is a plain rect check on animation frames rather than an
   IntersectionObserver, because the question here is "which step is nearest
   the middle" and not "did something cross an edge". Thirty rects a frame
   costs nothing and it cannot land in the state where two neighbours are both
   intersecting and neither wins.

   The scroll is NEVER captured. A reader who keeps swiping keeps moving, which
   is what a phone held at a poster session needs.
   =========================================================================== */

const Scrolly = (() => {
  const chapters = [];
  let queued = false;

  function register(rootId, handler){
    const root = document.getElementById(rootId);
    if (!root) return;
    const ch = {root, handler, steps:[...root.querySelectorAll(".step")],
                active:-1};
    chapters.push(ch);
    return ch;
  }

  function measure(){
    queued = false;
    const mid = window.innerHeight * 0.5;
    for (const ch of chapters){
      if (!ch.steps.length) continue;
      /* offsetParent is null for anything inside a hidden part, so a chapter
         in a part the reader is not looking at costs one property read. */
      if (!ch.root.offsetParent) continue;
      const box = ch.root.getBoundingClientRect();
      if (box.bottom < -200 || box.top > window.innerHeight + 200) continue;

      let best = 0, bestd = Infinity;
      ch.steps.forEach((el, i) => {
        const r = el.getBoundingClientRect();
        const d = Math.abs((r.top + r.bottom) / 2 - mid);
        if (d < bestd){ bestd = d; best = i; }
      });
      if (best !== ch.active){
        ch.steps.forEach((el, i) => el.classList.toggle("on", i === best));
        ch.active = best;
        try { ch.handler(best, ch.steps[best]); }
        catch (e) { console.error("scrolly handler", e); }
      }
    }
  }

  function schedule(){
    if (queued) return;
    queued = true;
    requestAnimationFrame(measure);
  }

  /* After a part switch every rect the last pass measured is stale, and the
     handlers have to fire again so the visuals match the steps now on screen. */
  function reset(){
    for (const ch of chapters) ch.active = -1;
    schedule();
  }

  window.addEventListener("scroll", schedule, {passive:true});
  window.addEventListener("resize", schedule, {passive:true});

  return {register, reset, schedule,
          active:(rootId)=>{
            const ch = chapters.find(c=>c.root.id === rootId);
            return ch ? ch.active : -1;
          }};
})();
