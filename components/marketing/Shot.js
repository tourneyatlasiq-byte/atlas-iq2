/**
 * A product screenshot. Always renders intrinsic width and height so the page
 * does not shift while it loads, and serves the @2x file to sharp screens.
 * Display size is set by CSS (inline `style` width or the surrounding layout).
 */
export function Shot({ shot, className = "", style, eager = false }) {
  return (
    <img
      className={`st-shot ${className}`.trim()}
      src={shot.src}
      srcSet={`${shot.src} 1x, ${shot.src2x} 2x`}
      width={shot.w}
      height={shot.h}
      alt={shot.alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      style={style}
    />
  );
}
