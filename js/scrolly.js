"use strict";
/* ===========================================================================
   Scroll driven chapters.

   A chapter is a sticky visual next to a column of `.step` blocks. Whichever
   step sits closest to the middle of the viewport is the current one: it gets
   `.on`, and the chapter's handler redraws the visual for it. The two cards
   either side get `.near`, because the steps sit close enough now that three
   of them share the screen and the middle one has to win on more than being
   the only thing in frame.

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

  /* How much closer to the middle a card has to be before it takes the focus
     from the one that holds it, as a fraction of the viewport height. The
     cards are a third of a screen apart, so without this dead band a few
     pixels of scroll flip which one is lit and the column flickers under a
     trackpad. With it the lit card holds until the reader has clearly
     committed to the next one, and the handoff reads as one decision. */
  const HYSTERESIS = 0.08;

  function register(rootId, handler){
    const root = document.getElementById(rootId);
    if (!root) return;
    const ch = {root, handler, steps:[...root.querySelectorAll(".step")],
                sticky:root.querySelector(".sticky"),
                col:root.querySelector(".steps"),
                active:-1};
    chapters.push(ch);
    return ch;
  }

  /* Where the middle of the READING area is, which is not always the middle of
     the viewport. At desk width the visual sits beside the cards and the two
     agree. Stacked on a phone the pinned figure owns the top of the screen, so
     the card crossing the middle of the viewport is the card hidden behind the
     figure: there the band starts under it. The test is geometric (same left
     edge, same width means one on top of the other) rather than a media query
     repeated in JS, which would drift the first time the breakpoint moves. */
  function midline(ch){
    const h = window.innerHeight;
    if (!ch.sticky || !ch.col) return h * 0.5;
    const s = ch.sticky.getBoundingClientRect();
    const c = ch.col.getBoundingClientRect();
    if (Math.abs(s.left - c.left) > 4 || Math.abs(s.width - c.width) > 4)
      return h * 0.5;
    const top = Math.min(Math.max(s.bottom, 0), h * 0.7);
    return top + (h - top) * 0.5;
  }

  function measure(){
    queued = false;
    for (const ch of chapters){
      if (!ch.steps.length) continue;
      /* offsetParent is null for anything inside a hidden part, so a chapter
         in a part the reader is not looking at costs one property read. */
      if (!ch.root.offsetParent) continue;
      const box = ch.root.getBoundingClientRect();
      if (box.bottom < -200 || box.top > window.innerHeight + 200) continue;

      const mid = midline(ch);
      let best = 0, bestd = Infinity;
      ch.steps.forEach((el, i) => {
        const r = el.getBoundingClientRect();
        const d = Math.abs((r.top + r.bottom) / 2 - mid);
        if (d < bestd){ bestd = d; best = i; }
      });
      /* The card that already holds the focus keeps it until the challenger
         beats it by the dead band. A jump (a part switch, an anchor) clears
         `active` first, so this only ever damps ordinary scrolling. */
      if (ch.active >= 0 && best !== ch.active){
        const r = ch.steps[ch.active].getBoundingClientRect();
        const held = Math.abs((r.top + r.bottom) / 2 - mid);
        if (held - bestd < window.innerHeight * HYSTERESIS) best = ch.active;
      }
      if (best !== ch.active){
        ch.steps.forEach((el, i) => {
          el.classList.toggle("on", i === best);
          el.classList.toggle("near", Math.abs(i - best) === 1);
        });
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
