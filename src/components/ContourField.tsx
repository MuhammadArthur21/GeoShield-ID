import { useEffect, useRef } from "react";

interface ContourFieldProps {
  className?: string;
}

export default function ContourField({ className = "" }: ContourFieldProps) {
  const field = useRef<SVGSVGElement>(null);
  const frame = useRef(0);

  useEffect(() => {
    const svg = field.current;
    const target = svg?.parentElement;
    if (!svg || !target || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let latestX = 0;
    let latestY = 0;
    const draw = () => {
      svg.style.setProperty("--contour-x", `${latestX.toFixed(1)}px`);
      svg.style.setProperty("--contour-y", `${latestY.toFixed(1)}px`);
      frame.current = 0;
    };
    const schedule = (x: number, y: number) => {
      latestX = Math.max(-7, Math.min(7, x));
      latestY = Math.max(-6, Math.min(6, y));
      if (!frame.current) frame.current = window.requestAnimationFrame(draw);
    };
    const onPointer = (event: PointerEvent) => {
      const bounds = svg.getBoundingClientRect();
      schedule(((event.clientX - bounds.left) / bounds.width - .5) * -12, ((event.clientY - bounds.top) / bounds.height - .5) * -10);
    };
    const onScroll = () => {
      const bounds = svg.getBoundingClientRect();
      schedule(0, Math.sin((window.scrollY + bounds.top) * .004) * 3);
    };
    target.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      target.removeEventListener("pointermove", onPointer);
      window.removeEventListener("scroll", onScroll);
      if (frame.current) window.cancelAnimationFrame(frame.current);
    };
  }, []);

  return <svg ref={field} className={`contour-field ${className}`} viewBox="0 0 900 360" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <g className="contour-lines">
      <path d="M-90 244C31 215 61 76 210 67c116-7 142 61 239 49 128-17 143-126 293-101 88 15 129 92 205 82" />
      <path d="M-78 273C42 246 82 103 215 95c105-7 143 65 240 52 117-15 154-119 280-99 79 13 127 75 219 72" />
      <path d="M-70 302C61 270 101 131 224 124c92-5 145 66 234 52 109-17 164-106 276-87 75 13 137 72 222 63" />
      <path d="M-43 333C74 298 124 158 236 154c84-3 141 61 218 47 96-17 169-92 264-73 80 16 140 70 225 48" />
      <path d="M-8 360C98 322 151 189 249 183c75-4 126 53 195 39 84-17 164-76 248-57 79 18 138 55 238 22" />
      <path d="M96 202C145 148 181 116 236 119c54 3 76 40 129 34 58-7 92-56 155-46 48 8 73 41 112 37" />
      <path d="M121 219C164 171 193 140 240 143c46 3 74 39 121 33 51-7 91-48 145-39 42 7 66 34 104 31" />
      <path d="M148 237C180 197 206 168 245 168c39 0 68 34 107 29 43-6 80-38 125-30 34 6 59 27 91 24" />
    </g>
  </svg>;
}
