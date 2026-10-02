import { useEffect, useRef, useState } from "react";

interface MetricCardProps {
  title: string;
  value: string;
  caption: string;
  numericValue?: number;
}

export default function MetricCard({ title, value, caption, numericValue }: MetricCardProps) {
  const [display, setDisplay] = useState(value);
  const previous = useRef(0);

  useEffect(() => {
    if (numericValue === undefined) {
      setDisplay(value);
      previous.current = 0;
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(numericValue.toLocaleString("id-ID"));
      previous.current = numericValue;
      return;
    }
    const startValue = previous.current;
    const startTime = performance.now();
    let frame = 0;
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startTime) / 520);
      const eased = 1 - (1 - progress) ** 3;
      const next = Math.round(startValue + (numericValue - startValue) * eased);
      setDisplay(next.toLocaleString("id-ID"));
      if (progress < 1) frame = window.requestAnimationFrame(animate);
      else previous.current = numericValue;
    };
    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [numericValue, value]);

  return <article className="metric-card"><span>{title}</span><b aria-hidden={numericValue !== undefined}>{display}</b>{numericValue !== undefined && <span className="sr-only" aria-live="polite">{numericValue.toLocaleString("id-ID")}</span>}<small>{caption}</small></article>;
}
