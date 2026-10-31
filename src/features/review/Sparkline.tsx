// A tiny bar chart drawn straight from a column's summary (FR-009). Hand-written SVG, no chart
// library, so a hundred cards stay light (plan.md, research.md R12).

export interface SparklineProps {
  /** Bar heights between 0 and 1. */
  bars: number[];
  /** Accessible description. */
  label: string;
}

const WIDTH = 120;
const HEIGHT = 32;
const GAP = 1;

export function Sparkline({ bars, label }: SparklineProps) {
  if (bars.length === 0) return null;
  const barWidth = Math.max(1, WIDTH / bars.length - GAP);
  return (
    <svg className="sparkline" width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={label}>
      {bars.map((value, i) => {
        const h = Math.max(1, value * HEIGHT);
        return <rect key={i} className="sparkline-bar" x={i * (barWidth + GAP)} y={HEIGHT - h} width={barWidth} height={h} />;
      })}
    </svg>
  );
}
