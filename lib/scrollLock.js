/**
 * One place that locks page scrolling while an overlay is open.
 *
 * Each overlay used to save document.body.style.overflow and put that saved
 * value back when it closed. With two overlays open (a dialog over a drawer)
 * closing in a different order than they opened, the last one restored a stale
 * "hidden" and the page stayed locked until a full reload.
 *
 * Here the page is locked while ANY lock is held and restored once, when the
 * last one is released, whatever the order. Each release works once only.
 *
 * Usage inside an effect:   return lockScroll();
 */
let holders = 0;
let original = "";

export function lockScroll() {
  if (typeof document === "undefined") return () => {};
  if (holders === 0) {
    original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  holders += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders -= 1;
    if (holders <= 0) {
      holders = 0;
      document.body.style.overflow = original;
    }
  };
}
