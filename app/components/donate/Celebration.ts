/** Confetti burst on a confirmed donation (port of static/app.js confettiBurst). Only for
 * donations: the vote's own moments are gold. With `from` (the Donate button, #129) it
 * bursts out of that element, while it is on screen; otherwise from the screen's middle. */
export function confettiBurst(from?: Element | null) {
  try {
    const c = document.createElement("canvas");
    const W = globalThis.innerWidth, H = globalThis.innerHeight;
    c.width = W;
    c.height = H;
    c.style.cssText = "position:fixed;inset:0;z-index:100;pointer-events:none";
    document.body.appendChild(c);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const colors = ["#ff3b38", "#00ff88", "#5ac8fa", "#f0b429", "#ffffff", "#5cb75a"];
    const r = from?.getBoundingClientRect();
    const seen = r && r.width > 0 && r.bottom > 0 && r.top < H;
    const x0 = seen ? r.left + r.width / 2 : W / 2;
    const spread = seen ? r.width : W * 0.3;
    const y0 = seen ? r.top + r.height / 2 : H * 0.4;
    const parts = Array.from({ length: 160 }, (_, i) => ({
      x: x0 + (Math.random() - 0.5) * spread,
      y: y0,
      vx: (Math.random() - 0.5) * 16,
      vy: -(Math.random() * 14 + 6),
      w: 5 + Math.random() * 6,
      h: 8 + Math.random() * 8,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: colors[i % colors.length],
    }));
    let frame = 0;
    const tick = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.globalAlpha = frame < 140 ? 1 : Math.max(0, 1 - (frame - 140) / 40);
      for (const p of parts) {
        p.vy += 0.35;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      frame++;
      if (frame < 180) requestAnimationFrame(tick);
      else c.remove();
    };
    tick();
  } catch { /* decorative */ }
}
