/**
 * The homepage's "$ raised" total counts from HERO_COUNT_FROM to the board's
 * amount. It starts at first paint, before any module loads, instead of staying
 * invisible until the app has the board.
 *
 * An inline script right after the amount (Hero renders it; only on "/") draws
 * an overlay over it: the overlay sits in <body>, outside React's tree, so the
 * hydration never sees a changed node. It shows HERO_COUNT_FROM and creeps up
 * (at most 10% more, below the real total) while the board loads, and reads the
 * early board response itself (early-fetch.ts; a clone, before the app reads
 * the original): the count runs to the exact amount as soon as the data lands,
 * even before the app hydrates. Hero then counts on from the overlay's number
 * and removes it. A failed or missing response fades the overlay out, so it
 * never holds a number that is not the board's. Reduced motion: no overlay
 * (Hero's own count, from the same start, once the amount is known).
 */

declare global {
  var __heroCount: HeroCount | undefined;
}

export interface HeroCount {
  /** The number on screen now. */
  value(): number;
  /** Removes the overlay. */
  stop(): void;
}

/** Where the homepage's count starts: a total the board is known to have passed
 * (Nov 2026: $655k), so the first number on screen is never more than was raised.
 * Below it (should the total ever drop), the count runs down to the amount. */
export const HERO_COUNT_FROM = 500_000;

const BOARD_PATH = "/api/board";

/** Plain ES2017, no imports: it runs as written from the prerendered HTML. */
export const HERO_COUNT_SCRIPT = [
  "(function(){",
  "if(location.pathname!=='/'||matchMedia('(prefers-reduced-motion: reduce)').matches)return;",
  `var p=window.__early&&window.__early[${JSON.stringify(BOARD_PATH)}];`,
  "var s=document.currentScript,a=s&&s.previousElementSibling;if(!p||!a)return;",
  `var f=${HERO_COUNT_FROM},t0=performance.now(),v=f,fin=null,done=false;`,
  "var fmt=new Intl.NumberFormat('en-US',{maximumFractionDigits:0});",
  "var o=document.createElement('div');",
  "o.className=a.className.replace(/(^|\\s)(opacity-0|transition-\\S+|duration-\\S+)(?=\\s|$)/g,' ');",
  "o.setAttribute('aria-hidden','true');",
  "o.style.cssText='position:absolute;margin:0;text-align:center;pointer-events:none';",
  "document.body.appendChild(o);",
  "function place(){var r=a.getBoundingClientRect();",
  "o.style.top=r.top+scrollY+'px';o.style.left=r.left+scrollX+'px';o.style.width=r.width+'px'}",
  // A frame's timestamp can be a little before t0 (or the finish's start): clamp,
  // or the eased value dips below where it started.
  "function ease(k){k=Math.max(0,Math.min(1,k));return 1-Math.pow(1-k,3)}",
  // While loading: from f, slowing toward f*1.1 over 8 s. With the amount: there in 1 s.
  "function frame(now){if(done)return;place();",
  "v=fin?fin.from+(fin.to-fin.from)*ease((now-fin.t)/1000):f*(1+.1*ease((now-t0)/8000));",
  "o.textContent='$'+fmt.format(Math.round(v));requestAnimationFrame(frame)}",
  "place();o.textContent='$'+fmt.format(f);requestAnimationFrame(frame);",
  "function stop(){done=true;o.remove()}",
  "function fail(){if(!fin)fin={from:v,to:v,t:0};o.style.transition='opacity .4s';o.style.opacity='0';setTimeout(stop,450)}",
  "var timer=setTimeout(function(){if(!fin)fail()},20000);",
  "p.then(function(r){if(!r.ok)throw 0;return r.clone().json()}).then(function(b){",
  "var R=b&&b.totals&&b.totals.raised;if(typeof R!=='number')throw 0;",
  "clearTimeout(timer);fin={from:v,to:Math.round(R),t:performance.now()}",
  "}).catch(fail);",
  "window.__heroCount={value:function(){return Math.round(v)},stop:stop};",
  "})()",
].join("");
