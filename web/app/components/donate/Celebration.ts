/** Confetti burst on a confirmed donation (port of static/app.js confettiBurst). */
export function confettiBurst() {
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
    const parts = Array.from({ length: 160 }, (_, i) => ({
      x: W / 2 + (Math.random() - 0.5) * W * 0.3,
      y: H * 0.4,
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
