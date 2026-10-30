import type { PricePoint, YM } from "../lib/types";

interface Props {
  history: PricePoint[];
  forecast: PricePoint[];
  /** months of the forecast to shade as the recommended storage window */
  windowMonths?: { fromIndex: number; toIndex: number } | null;
  lang: "en" | "rw";
  labels: { observed: string; forecast: string; window: string };
}

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_RW = ["Mut", "Gash", "Wer", "Mat", "Gic", "Kam", "Nya", "Kan", "Nze", "Ukw", "Ugu", "Uku"];

const t = (ym: YM) => ym[0] * 12 + (ym[1] - 1);

export default function PriceChart({ history, forecast, windowMonths, lang, labels }: Props) {
  const hist = history ?? [];
  const fore = forecast ?? [];
  if (hist.length + fore.length < 4) {
    return <p className="note warn">Not enough price history to draw a chart.</p>;
  }

  const W = 640;
  const H = 260;
  const padL = 46;
  const padR = 12;
  const padT = 14;
  const padB = 30;

  const all = [...hist, ...fore];
  const xs = all.map(([y, m]) => t([y, m]));
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const ys = all.map((p) => p[2]);
  const yMinRaw = Math.min(...ys);
  const yMaxRaw = Math.max(...ys);
  const padY = (yMaxRaw - yMinRaw) * 0.14 || yMaxRaw * 0.1 || 1;
  const y0 = Math.max(0, yMinRaw - padY);
  const y1 = yMaxRaw + padY;

  const sx = (v: number) => padL + ((v - x0) / Math.max(1, x1 - x0)) * (W - padL - padR);
  const sy = (v: number) => H - padB - ((v - y0) / Math.max(1, y1 - y0)) * (H - padT - padB);

  const histPath = hist.map(([y, m, p], i) => `${i === 0 ? "M" : "L"}${sx(t([y, m])).toFixed(1)},${sy(p).toFixed(1)}`).join(" ");
  const bridge =
    hist.length && fore.length
      ? `M${sx(t([hist[hist.length - 1][0], hist[hist.length - 1][1]])).toFixed(1)},${sy(hist[hist.length - 1][2]).toFixed(1)} `
      : "";
  const forePath =
    bridge +
    fore
      .map(([y, m, p], i) => `${i === 0 && !bridge ? "M" : "L"}${sx(t([y, m])).toFixed(1)},${sy(p).toFixed(1)}`)
      .join(" ");

  const firstFore = fore[0] ? t([fore[0][0], fore[0][1]]) : x1;
  const areaPath =
    hist.length > 1
      ? `${histPath} L${sx(t([hist[hist.length - 1][0], hist[hist.length - 1][1]])).toFixed(1)},${sy(y0).toFixed(1)} L${sx(
          t([hist[0][0], hist[0][1]])
        ).toFixed(1)},${sy(y0).toFixed(1)} Z`
      : "";

  // x ticks roughly every 4 months
  const ticks: number[] = [];
  for (let v = x0; v <= x1; v += 1) {
    const m = v % 12;
    if (m === 0 || m === 4 || m === 8) ticks.push(v);
  }

  const yTicks = 4;
  const monthNames = lang === "en" ? MONTHS_EN : MONTHS_RW;

  let windowRect = null;
  if (windowMonths && fore.length) {
    const a = fore[windowMonths.fromIndex];
    const b = fore[windowMonths.toIndex] ?? fore[fore.length - 1];
    if (a && b) {
      const xa = sx(t([a[0], a[1]]));
      const xb = sx(t([b[0], b[1]]));
      windowRect = (
        <rect
          x={Math.min(xa, xb)}
          y={padT}
          width={Math.max(6, Math.abs(xb - xa))}
          height={H - padT - padB}
          fill="#1c7a4f"
          opacity="0.1"
        />
      );
    }
  }

  return (
    <div className="chart-wrap">
      <div className="chart-legend">
        <span>
          <i style={{ background: "#1c7a4f" }} />
          {labels.observed}
        </span>
        <span>
          <i style={{ background: "#a85a12" }} />
          {labels.forecast}
        </span>
        {windowMonths && (
          <span>
            <i style={{ background: "#1c7a4f", opacity: 0.3 }} />
            {labels.window}
          </span>
        )}
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${labels.observed} / ${labels.forecast}`}>
        {Array.from({ length: yTicks + 1 }, (_, i) => {
          const v = y0 + ((y1 - y0) * i) / yTicks;
          const y = sy(v);
          return (
            <g key={`y${i}`}>
              <line className="grid-line" x1={padL} x2={W - padR} y1={y} y2={y} />
              <text x={padL - 6} y={y + 3} textAnchor="end">
                {Math.round(v).toLocaleString()}
              </text>
            </g>
          );
        })}

        {windowRect}

        {areaPath && <path d={areaPath} fill="#1c7a4f" opacity="0.07" />}
        <path d={histPath} fill="none" stroke="#1c7a4f" strokeWidth="2.2" strokeLinejoin="round" />
        <path d={forePath} fill="none" stroke="#a85a12" strokeWidth="2.2" strokeDasharray="6 5" strokeLinejoin="round" />

        <line className="axis" x1={sx(firstFore)} x2={sx(firstFore)} y1={padT} y2={H - padB} strokeDasharray="3 4" />

        {ticks.map((v) => (
          <g key={`x${v}`}>
            <line className="axis" x1={sx(v)} x2={sx(v)} y1={H - padB} y2={H - padB + 4} />
            <text x={sx(v)} y={H - padB + 16} textAnchor="middle">
              {monthNames[v % 12]}
            </text>
          </g>
        ))}

        {hist.length > 0 && (
          <circle
            cx={sx(t([hist[hist.length - 1][0], hist[hist.length - 1][1]]))}
            cy={sy(hist[hist.length - 1][2])}
            r="3.6"
            fill="#1c7a4f"
            stroke="#fff"
            strokeWidth="1.4"
          />
        )}
      </svg>
    </div>
  );
}
