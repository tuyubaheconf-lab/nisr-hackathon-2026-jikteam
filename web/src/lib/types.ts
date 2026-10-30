export type Lang = "en" | "rw";

export type YM = [number, number];
export type PricePoint = [number, number, number]; // [year, month, RWF/kg]

export interface ModelScore {
  mae: number;
  mape: number | null;
  direction: number | null;
  n: number;
}

export interface DecisionBacktest {
  decisions: number;
  holds: number;
  hold_share: number;
  mean_realised: number | null;
  median_realised?: number | null;
  pct_positive: number | null;
  mean_expected: number | null;
  mean_horizon: number | null;
}

export interface DistrictCrop {
  index: number[]; // 12 month multipliers, 1.0 = annual average
  series: PricePoint[]; // recent observed months
  forecast: PricePoint[]; // next 9 months, starting at data.now
  now: number; // latest observed price, RWF/kg
  as_of: string; // "2026-08"
  estimated: boolean; // true when the district stopped reporting
  level: number; // deseasonalised annual level
  market: string;
  model: string;
  swing: number; // peak-to-trough %
  live: boolean;
  backtest: { best: string | null; models: Record<string, ModelScore> };
  decision: DecisionBacktest | null;
}

export interface District {
  id: string;
  province: string;
  /** null only for a district with no price series at all */
  lat: number | null;
  lon: number | null;
  crops: Record<string, DistrictCrop>;
  /** carried so the map is complete, but there is nothing to advise on */
  unmodelled?: boolean;
}

export interface Crop {
  id: string;
  name: string;
  rw: string;
  storage_rwf_kg_month: number;
  loss_pct_month: number;
  transport_rwf_kg: number;
  national_swing: number | null;
  national_index: number[];
  districts: string[];
}

export interface DecisionTally {
  cells: number;
  decisions: number;
  holds: number;
  hold_share: number;
  mean_realised_per_kg: number | null;
  mean_pct_positive: number | null;
  mean_expected_per_kg: number | null;
  mean_horizon: number | null;
  verdict?: "pays" | "does_not_pay";
}

export interface Dataset {
  meta: {
    generated: string;
    source_prices: string;
    source_boundaries: string;
    observations: number;
    aggregate_flagged?: number;
    first_year: number;
    district_min_months?: number;
    coverage?: {
      total_districts: number;
      covered_districts: number;
      missing_districts: string[];
      live_districts: string[];
      markets_reporting_2026: number;
    };
  };
  now: string;
  crops: Crop[];
  districts: District[];
  markets: { name: string; district: string; lat: number; lon: number; last: string; n: number }[];
  backtest_summary: { model: string; mean_mape: number | null; mean_direction: number | null; series_won: number; series_scored: number }[];
  decision_summary: DecisionTally | null;
  decision_by_crop: Record<string, DecisionTally>;
}
