import { onMount, onCleanup } from 'solid-js';

export function WavesCanvas(props) {
  let canvasRef;

  onMount(() => {
    const canvas = canvasRef;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    let w = 0;
    let h = 0;
    let rafId = 0;
    let energy = 0.25;

    const layers = [
      { amp: 76, freq: 0.0027, speed: 0.0013, phase: 0.0, yRatio: 0.72, alpha: 0.35, width: 2.4, hueShift: 0 },
      { amp: 59, freq: 0.0037, speed: -0.0016, phase: 1.7, yRatio: 0.77, alpha: 0.26, width: 1.6, hueShift: 14 },
      { amp: 91, freq: 0.0019, speed: 0.0010, phase: 3.1, yRatio: 0.81, alpha: 0.22, width: 1.4, hueShift: -52 },
      { amp: 39, freq: 0.0052, speed: 0.0021, phase: 4.8, yRatio: 0.84, alpha: 0.34, width: 1.4, hueShift: 26 },
    ];

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let initialized = false;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (initialized && motionQuery.matches) draw(0);
    }

    function draw(now) {
      ctx.clearRect(0, 0, w, h);

      const reduced = motionQuery.matches;
      const target = props.targetEnergy?.() ?? 0.34;
      const baseHue = props.hue?.() ?? 344;
      const bpm = props.bpm?.() ?? 112;
      const pulse = reduced ? 0 : (props.consumePulse?.() ?? 0);

      energy = reduced ? 0.35 : energy + (target - energy) * 0.04;

      const beatHz = bpm / 60;
      const tSec = now * 0.001;
      const beat = reduced
        ? 0.75
        : 0.55 +
          0.28 * Math.pow(0.5 + 0.5 * Math.sin(tSec * Math.PI * 2 * beatHz), 2.4) +
          0.17 * Math.sin(tSec * Math.PI * beatHz * 0.5 + 1.1);

      const dynamic = (0.2 + energy * beat + pulse * 0.65) * Math.min(1.5, h / 720);
      const step = Math.max(8, Math.floor(w / 140));
      const tAnim = reduced ? 0 : now;

      for (const layer of layers) {
        const baseY = h * layer.yRatio;
        const hue = (baseHue + layer.hueShift + 360) % 360;

        const gradFill = ctx.createLinearGradient(0, baseY - 60, 0, h);
        gradFill.addColorStop(0, `hsla(${hue}, 80%, 66%, ${layer.alpha * 0.34})`);
        gradFill.addColorStop(1, `hsla(${hue}, 80%, 50%, 0)`);

        const gradStroke = ctx.createLinearGradient(0, 0, w, 0);
        gradStroke.addColorStop(0, `hsla(${hue}, 85%, 70%, 0)`);
        gradStroke.addColorStop(0.18, `hsla(${hue}, 85%, 72%, ${layer.alpha * 1.4})`);
        gradStroke.addColorStop(0.55, `hsla(${(hue + 40) % 360}, 90%, 76%, ${layer.alpha * 1.65})`);
        gradStroke.addColorStop(0.86, `hsla(${(hue + 80) % 360}, 85%, 70%, ${layer.alpha * 0.7})`);
        gradStroke.addColorStop(1, `hsla(${hue}, 85%, 70%, 0)`);

        ctx.beginPath();
        for (let x = 0; x <= w + step; x += step) {
          const nx = x / w;
          const envelope = Math.sin(nx * Math.PI);
          const y =
            baseY +
            Math.sin(x * layer.freq + tAnim * layer.speed + layer.phase) * layer.amp * dynamic * envelope +
            Math.sin(x * layer.freq * 2.15 - tAnim * layer.speed * 1.35 + layer.phase) * (layer.amp * 0.38) * dynamic * envelope;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }

        ctx.strokeStyle = gradStroke;
        ctx.lineWidth = layer.width;
        ctx.stroke();

        ctx.lineTo(w, h);
        ctx.lineTo(0, h);
        ctx.closePath();
        ctx.fillStyle = gradFill;
        ctx.fill();
      }

      if (!reduced) {
        rafId = requestAnimationFrame(draw);
      }
    }

    const startOrRender = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(draw);
    };

    resize();
    initialized = true;
    window.addEventListener('resize', resize);
    startOrRender();
    motionQuery.addEventListener('change', startOrRender);

    onCleanup(() => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      motionQuery.removeEventListener('change', startOrRender);
    });
  });

  return <canvas ref={canvasRef} id="waves-canvas" class="tv-waves" aria-hidden="true" />;
}
