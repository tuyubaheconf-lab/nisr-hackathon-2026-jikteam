export const rwf = (n: number): string =>
  `${Math.round(n).toLocaleString("en-US")} RWF`;

export const num = (n: number, dp = 0): string =>
  n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

export const signed = (n: number, dp = 0): string =>
  `${n >= 0 ? "+" : "−"}${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  })}`;

export const pct = (n: number, dp = 0): string => `${n.toFixed(dp)}%`;

export const shortRwf = (n: number): string => {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M RWF`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)}k RWF`;
  return `${Math.round(n)} RWF`;
};
