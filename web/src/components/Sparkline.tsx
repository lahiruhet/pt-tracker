import { useRef, useState } from "react";
import { kg, shortDate } from "../lib/format";

/** Single-series weight trend. Tap or drag across it to read each session's weight. */
export function Sparkline({ points, height = 56 }: { points: { date: string; kg: number }[]; height?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 300;
  const H = height;
  const pad = 6;
  const min = Math.min(...points.map((p) => p.kg));
  const max = Math.max(...points.map((p) => p.kg));
  const span = max - min || 1;
  const xs = points.map((_, i) => (points.length === 1 ? W / 2 : pad + (i * (W - pad * 2)) / (points.length - 1)));
  const ys = points.map((p) => (max === min ? H / 2 : H - pad - ((p.kg - min) / span) * (H - pad * 2)));
  const d = xs.map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const last = points.length - 1;
  const active = hover ?? last;

  const pick = (clientX: number) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const x = ((clientX - box.left) / box.width) * W;
    let best = 0;
    xs.forEach((px, i) => Math.abs(px - x) < Math.abs(xs[best] - x) && (best = i));
    setHover(best);
  };

  return (
    <div className="relative select-none">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-14 w-full touch-pan-y"
        style={{ height }}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerMove={(e) => (e.buttons || e.pointerType === "mouse") && pick(e.clientX)}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`Weight from ${kg(points[0].kg)} to ${kg(points[last].kg)}`}
      >
        <line x1={0} x2={W} y1={H - 1} y2={H - 1} stroke="var(--line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {points.length > 1 && (
          <path d={d} fill="none" stroke="var(--chart)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        )}
        {hover !== null && (
          <line x1={xs[hover]} x2={xs[hover]} y1={0} y2={H} stroke="var(--fg-3)" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {/* Dots are HTML so they stay round when the SVG stretches. */}
      {[active].map((i) => (
        <span
          key={i}
          className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--chart)] ring-2 ring-surface"
          style={{ left: `${(xs[i] / W) * 100}%`, top: (ys[i] / H) * height }}
        />
      ))}
      {hover !== null && (
        <div
          className="pointer-events-none absolute -top-8 z-10 -translate-x-1/2 rounded-lg bg-fg px-2 py-1 text-[12px] font-semibold whitespace-nowrap text-bg"
          style={{ left: `${Math.min(88, Math.max(12, (xs[hover] / W) * 100))}%` }}
        >
          {kg(points[hover].kg)} · {shortDate(points[hover].date)}
        </div>
      )}
    </div>
  );
}
