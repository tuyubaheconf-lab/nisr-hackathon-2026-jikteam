import { useMemo, useState } from "react";
import type { Dataset, District } from "../lib/types";
import type { StringKey } from "../lib/i18n";
import { advise, defaultSettings, monthName, ymAdd, type Settings } from "../lib/advice";
import { formatRefresh, liveIndex, livePriceFor, type LiveFeed } from "../lib/live";
import { num, rwf, signed, shortRwf } from "../lib/format";
import { smsText } from "../lib/messages";
import PriceChart from "./PriceChart";

interface Props {
  data: Dataset;
  lang: "en" | "rw";
  live?: LiveFeed | null;
  t: (k: StringKey, vars?: Record<string, string | number>) => string;
}

const QUANTITIES = [100, 500, 1000, 5000];

export default function FarmerView({ data, lang, t, live }: Props) {
  const crops = data.crops.filter((c) => c.districts.length > 0);
  const [cropId, setCropId] = useState(crops[0]?.id ?? "");
  const crop = crops.find((c) => c.id === cropId) ?? crops[0];

  const districtsForCrop = data.districts
    .filter((d) => d.crops[crop?.id])
    .sort((a, b) => a.id.localeCompare(b.id));

  // open on a district that still reports real prices, so the first thing a
  // visitor sees is measured data rather than an estimate
  const liveDistricts = districtsForCrop.filter((d) => !d.crops[crop?.id ?? ""]?.estimated);
  const firstLive =
    liveDistricts.find((d) => !/camp/i.test(d.crops[crop?.id ?? ""]?.market ?? "")) ??
    liveDistricts[0] ??
    districtsForCrop[0];

  const [districtId, setDistrictId] = useState(firstLive?.id ?? "");
  const district =
    districtsForCrop.find((d) => d.id === districtId) ?? districtsForCrop[0];
  const cropData = district?.crops[crop?.id];

  const [quantity, setQuantity] = useState(500);
  const [settings, setSettings] = useState<Settings>(() =>
    crop ? defaultSettings(crop) : { storage: 3, interest: 0.12, lossPctMonth: 1.2, transport: 0 }
  );

  const nowParts = data.now.split("-");
  const nowYM: [number, number] = [Number(nowParts[0]), Number(nowParts[1])];

  // the month the farmer is standing in. Defaults to today, but the whole
  // point of a seasonal tool is that the answer changes through the year.
  const [decisionYM, setDecisionYM] = useState<[number, number]>(nowYM);
  const isNowYM = decisionYM[0] === nowYM[0] && decisionYM[1] === nowYM[1];

  // newest observation for this district+crop from the live feed
  const liveRow = useMemo(() => {
    if (!live || !district || !crop) return undefined;
    return liveIndex(live).get(`${district.id}|${crop.id}`);
  }, [live, district?.id, crop?.id]);

  // Replaces the model's price only for a month the model has not seen yet —
  // see livePriceFor(). Same-month observations are already inside the model.
  const livePriceToday = livePriceFor(liveRow, cropData);

  const advice = useMemo(
    () =>
      cropData
        ? advise(cropData, settings, quantity, decisionYM, isNowYM ? livePriceToday : undefined)
        : null,
    [cropData, settings, quantity, decisionYM, isNowYM, livePriceToday]
  );

  const monthChoices = useMemo(
    () =>
      cropData
        ? Array.from({ length: 12 }, (_, i) => {
            const ym = ymAdd(nowYM[0], nowYM[1], i);
            return {
              ym,
              advice: advise(cropData, settings, quantity, ym, i === 0 ? livePriceToday : undefined),
              isNow: i === 0,
            };
          })
        : [],
    [cropData, settings, quantity, nowYM[0], nowYM[1], livePriceToday]
  );

  if (!crop || !district || !cropData || !advice) {
    return <p className="note warn">No data available for this selection.</p>;
  }

  const tallest = Math.max(...cropData.index);
  const cheapestMonth = cropData.index.indexOf(Math.min(...cropData.index));
  const dearestMonth = cropData.index.indexOf(tallest);

  const onCrop = (id: string) => {
    setCropId(id);
    const next = data.districts.filter((d) => d.crops[id]).sort((a, b) => a.id.localeCompare(b.id));
    const liveAll = next.filter((d) => !d.crops[id].estimated);
    const live = liveAll.find((d) => !/camp/i.test(d.crops[id].market)) ?? liveAll[0] ?? next[0];
    setDistrictId(live?.id ?? "");
    const c = data.crops.find((x) => x.id === id);
    if (c) setSettings(defaultSettings(c));
  };

  const targetMonth = monthName(advice.best.ym, lang);
  const isHold = advice.action === "hold";
  const targetOffset =
    (advice.best.ym[0] - nowYM[0]) * 12 + (advice.best.ym[1] - nowYM[1]);
  const windowMonths =
    isHold && targetOffset >= 0 && targetOffset <= 8
      ? { fromIndex: targetOffset, toIndex: targetOffset }
      : null;
  const simulating = !isNowYM;

  const sms = smsText(lang, district.id, crop, advice, quantity);
  const tally = data.decision_by_crop[crop.id];
  const coverage = data.meta.coverage;

  return (
    <div className="stack">
      {coverage && (
        <p className="coverage-strip">
          <span className="badge grey">{lang === "en" ? "Coverage" : "Ahantu"}</span>{" "}
          {t("coverage.summary", {
            covered: coverage.covered_districts,
            total: coverage.total_districts,
            live: coverage.live_districts.length,
            markets: coverage.markets_reporting_2026,
          })}{" "}
          {coverage.missing_districts.length > 0 && (
            <> {t("coverage.unmodelled", { districts: coverage.missing_districts.join(", ") })}</>
          )}
        </p>
      )}

      {/* ---------- inputs ---------- */}
      <section className="card">
        <div className="card-title">{t("step.crop")}</div>
        <div className="chips">
          {crops.map((c) => (
            <button
              key={c.id}
              className="chip"
              aria-pressed={c.id === crop.id}
              onClick={() => onCrop(c.id)}
            >
              {lang === "en" ? c.name : c.rw}
              <span className="sub">{c.national_swing ? `±${Math.round(c.national_swing)}%` : ""}</span>
            </button>
          ))}
        </div>

        <div className="grid-2" style={{ marginTop: 16 }}>
          <div>
            <label className="field" htmlFor="district">
              {t("step.district")}
            </label>
            <select id="district" value={district.id} onChange={(e) => setDistrictId(e.target.value)}>
              {groupByProvince(districtsForCrop).map(([province, ds]) => (
                <optgroup key={province} label={province}>
                  {ds.map((d) => {
                    const c = d.crops[crop.id];
                    return (
                      <option key={d.id} value={d.id}>
                        {d.id} · {
                          c.estimated
                            ? t("dist.estimated", { asOf: c.as_of })
                            : t("dist.measured", { asOf: c.as_of })
                        }
                      </option>
                    );
                  })}
                </optgroup>
              ))}
            </select>
            <p className="small muted" style={{ marginTop: 6 }}>
              {t("step.districtHint")}
            </p>
          </div>
          <div>
            <label className="field" htmlFor="qty">
              {t("step.quantity")}
            </label>
            <div className="row">
              <input
                id="qty"
                type="number"
                min={10}
                step={10}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 0))}
                style={{ maxWidth: 140 }}
              />
              <span className="muted small">kg</span>
              <span className="muted small nowrap">
                ≈ {num(quantity / 100, 0)} {t("label.bags")}
              </span>
            </div>
            <div className="chips" style={{ marginTop: 8 }}>
              {QUANTITIES.map((q) => (
                <button key={q} className="chip" aria-pressed={quantity === q} onClick={() => setQuantity(q)}>
                  {q >= 1000 ? `${q / 1000} t` : `${q} kg`}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---------- verdict ---------- */}
      {live && (
        <p className="coverage-strip">
          <span className="badge grey">{t("live.badge")}</span>{" "}
          {t("live.status", {
            source: live.source === "esoko" ? "eSoko" : "WFP",
            when: formatRefresh(live.refreshed_at),
          })}
          {livePriceToday != null && liveRow ? (
            <>
              {" · "}
              {t("live.observed", {
                price: rwf(livePriceToday),
                market:
                  liveRow.markets && liveRow.markets > 1
                    ? `${liveRow.markets} ${lang === "en" ? "markets" : "amasoko"}`
                    : liveRow.market ?? district.id,
                ym: liveRow.ym,
              })}
            </>
          ) : null}
        </p>
      )}
      {cropData.estimated && (
        <p className="note warn">
          <span className="badge warn" style={{ marginRight: 8 }}>
            {lang === "en" ? "estimated" : "bigereranyijwe"}
          </span>
          {t("coverage.estimated", { district: district.id, asOf: cropData.as_of })}
        </p>
      )}

      <section className={`verdict ${isHold ? "hold" : "sell"}`}>
        <div className="kicker">{t("result.title")}</div>
        <div className="headline">
          {isHold ? `${t("result.hold")} ${advice.best.months}` : t("result.sell")}
        </div>
        <div className="kicker" style={{ marginTop: 6, opacity: 0.9 }}>
          {monthName(decisionYM, lang)}
        </div>
        <div className="subhead">
          {isHold
            ? t("result.holdFor", { n: advice.best.months, month: targetMonth })
            : reasonText(advice.reason, t)}{" "}
          {isHold && advice.reason === "hold_pays" ? ` ${t("reason.hold")}` : ""}
        </div>

        <div className="money">
          <div>
            <span>{t("result.priceToday")}</span>
            <strong>{rwf(advice.priceToday)}/kg</strong>
          </div>
          <div>
            <span>{t("result.priceExpected", { month: targetMonth })}</span>
            <strong>{rwf(advice.best.expectedPrice)}/kg</strong>
          </div>
          <div className={advice.best.netPerKg < 0 ? "neg" : ""}>
            <span>{isHold ? t("result.netPerKg") : t("result.netIfWaited")}</span>
            <strong>{signed(advice.best.netPerKg)} RWF/kg</strong>
          </div>
          <div className={advice.netForQuantity < 0 ? "neg" : ""}>
            <span>
              {isHold ? t("result.total", { kg: num(quantity) }) : t("result.netIfWaited")}
            </span>
            <strong>{shortRwf(advice.netForQuantity)}</strong>
          </div>
        </div>
      </section>

      {/* ---------- month the farmer is deciding in ---------- */}
      <section className="card">
        <div className="card-title">{t("step.month")}</div>
        <p className="section-p" style={{ marginBottom: 8 }}>
          {t("step.monthHint")}
        </p>
        <div className="chips">
          {monthChoices.map(({ ym, advice: a, isNow }) => {
            const active = ym[0] === decisionYM[0] && ym[1] === decisionYM[1];
            const holds = a.action === "hold";
            return (
              <button
                key={`${ym[0]}-${ym[1]}`}
                className="chip"
                aria-pressed={active}
                onClick={() => setDecisionYM(ym)}
                style={
                  !active && holds
                    ? { borderColor: "#1c7a4f", background: "#e6f0e8", color: "#0f3d2e" }
                    : undefined
                }
              >
                {monthName(ym, lang)}
                <span className="sub">
                  {isNow
                    ? lang === "en"
                      ? "now"
                      : "ubu"
                    : holds
                      ? `${t("result.hold")} ${a.best.months}`
                      : t("result.sell")}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <div className="grid-2">
        <div className="stack">
          {/* ---------- chart ---------- */}
          <section className="card">
            <div className="card-title">{t("chart.title")}</div>
            <PriceChart
              history={cropData.series}
              forecast={cropData.forecast}
              windowMonths={windowMonths}
              lang={lang}
              labels={{ observed: t("chart.observed"), forecast: t("chart.forecast"), window: t("chart.window") }}
            />
            <p className="small muted" style={{ marginTop: 8 }}>
              {t("chart.note", { market: cropData.market })}{" "}
              {cropData.estimated
                ? t("chart.estimated", { asOf: cropData.as_of })
                : t("chart.live", { price: rwf(cropData.now), asOf: cropData.as_of })}
            </p>
          </section>

          {/* ---------- money breakdown ---------- */}
          <section className="card">
            <div className="card-title">{t("result.breakdown")}</div>
            <div className="scroll-x">
              <table className="plain">
                <tbody>
                  <tr>
                    <td>{t("result.priceExpected", { month: targetMonth })}</td>
                    <td className="num">{rwf(advice.best.expectedPrice)}</td>
                  </tr>
                  <tr>
                    <td>{t("result.priceToday")}</td>
                    <td className="num">−{rwf(advice.priceToday)}</td>
                  </tr>
                  <tr>
                    <td>
                      {t("result.storage")} · {advice.best.months} {lang === "en" ? "months" : "amezi"}
                    </td>
                    <td className="num">−{num(advice.best.storage)}</td>
                  </tr>
                  <tr>
                    <td>{t("result.interest")}</td>
                    <td className="num">−{num(advice.best.interest)}</td>
                  </tr>
                  <tr>
                    <td>{t("result.loss")}</td>
                    <td className="num">−{num(advice.best.loss)}</td>
                  </tr>
                  {advice.best.transport > 0 && (
                    <tr>
                      <td>{t("result.transport")}</td>
                      <td className="num">−{num(advice.best.transport)}</td>
                    </tr>
                  )}
                  <tr className="total">
                    <td>{t("result.netPerKg")}</td>
                    <td className="num">{signed(advice.best.netPerKg)} /kg</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="note" style={{ marginTop: 10 }}>
              {t("result.threshold", { x: `${num(advice.thresholdPerKg)} RWF` })}
            </p>
            {simulating && (
              <p className="note warn" style={{ marginTop: 8 }}>
                {lang === "en"
                  ? `You are looking at ${monthName(decisionYM, lang)}, not today. The price shown is the model's price for that month.`
                  : `Urareba ${monthName(decisionYM, lang)}, ntabwo ari ubu.`}
              </p>
            )}
          </section>

          {/* ---------- trust ---------- */}
          <section className="card">
            <div className="card-title">{t("trust.title")}</div>
            {tally && tally.holds > 0 && tally.mean_pct_positive != null ? (
              <>
                <p style={{ marginBottom: 10 }}>
                  {tally.verdict === "pays" ? (
                    <span className="badge" style={{ marginRight: 8 }}>
                      {t("method.pays")}
                    </span>
                  ) : (
                    <span className="badge warn" style={{ marginRight: 8 }}>
                      {t("method.notPays")}
                    </span>
                  )}
                  {t("trust.backtest", { x: `${Math.round(tally.mean_pct_positive)}%` })}
                </p>
                <div className="kpi-grid">
                  <div className="kpi">
                    <span>{t("method.realised")}</span>
                    <strong>{signed(tally.mean_realised_per_kg ?? 0)}</strong>
                  </div>
                  <div className="kpi">
                    <span>{t("method.holds")}</span>
                    <strong>{tally.holds}</strong>
                  </div>
                  <div className="kpi">
                    <span>{t("method.positive")}</span>
                    <strong>{Math.round(tally.mean_pct_positive)}%</strong>
                  </div>
                </div>
                <p className="small muted" style={{ marginTop: 8 }}>
                  {t("trust.n", { n: tally.holds })}
                </p>
              </>
            ) : (
              <p className="note">{t("trust.none")}</p>
            )}
          </section>
        </div>

        {/* ---------- right rail ---------- */}
        <div className="stack">
          <section className="card">
            <div className="card-title">{t("costs.title")}</div>
            <p className="section-p">{t("costs.hint")}</p>

            <Slider
              label={t("costs.storage")}
              value={settings.storage}
              min={0}
              max={25}
              step={1}
              suffix=" RWF"
              onChange={(v) => setSettings({ ...settings, storage: v })}
            />
            <Slider
              label={t("costs.interest")}
              value={settings.interest * 100}
              min={0}
              max={30}
              step={1}
              suffix="%"
              onChange={(v) => setSettings({ ...settings, interest: v / 100 })}
            />
            <Slider
              label={t("costs.loss")}
              value={settings.lossPctMonth}
              min={0}
              max={6}
              step={0.1}
              suffix="%"
              onChange={(v) => setSettings({ ...settings, lossPctMonth: v })}
            />
            <Slider
              label={t("costs.transport")}
              value={settings.transport}
              min={0}
              max={60}
              step={1}
              suffix=" RWF"
              onChange={(v) => setSettings({ ...settings, transport: v })}
            />

            <button
              className="chip"
              style={{ marginTop: 12 }}
              onClick={() => setSettings(defaultSettings(crop))}
            >
              {t("costs.reset")}
            </button>
          </section>

          <section className="card">
            <div className="card-title">{t("board.calendar")}</div>
            <p className="section-p">{t("board.calendarHint")}</p>
            <MonthStrip
              index={cropData.index}
              lang={lang}
              currentMonth={nowYM[1]}
              targetMonth={isHold ? advice.best.ym[1] : null}
            />
            <div className="kpi-grid" style={{ marginTop: 12 }}>
              <div className="kpi">
                <span>{t("board.cheap")}</span>
                <strong>{monthName([nowYM[0], cheapestMonth + 1], lang)}</strong>
              </div>
              <div className="kpi">
                <span>{t("board.peak")}</span>
                <strong>{monthName([nowYM[0], dearestMonth + 1], lang)}</strong>
              </div>
              <div className="kpi">
                <span>{t("board.swing")}</span>
                <strong>{cropData.swing.toFixed(0)}%</strong>
              </div>
            </div>
            {!isHold && advice.nextWindow && (
              <p className="note" style={{ marginTop: 10 }}>
                {t("nextWindow", {
                  month: monthName(advice.nextWindow.ym, lang),
                })}
              </p>
            )}
          </section>

          <section className="card">
            <div className="card-title">{t("sms.title")}</div>
            <p className="section-p">{t("sms.note")}</p>
            <div className="phone">
              <div className="screen">
                <div className="status">
                  <span>SokoRyari</span>
                  <span>{new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
                <div className="bubble">{sms}</div>
              </div>
            </div>
            <a className="chip" href="#/phone" style={{ marginTop: 12, textDecoration: "none" }}>
              {t("sms.openPhone")} →
            </a>
            <p className="small muted" style={{ marginTop: 8 }}>
              {t("sms.ussd")} · {t("sms.ussdHint")}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

function reasonText(reason: string, t: (k: StringKey) => string): string {
  if (reason === "not_cheap_month") return t("reason.notCheap");
  if (reason === "thin_margin") return t("reason.thin");
  if (reason === "no_data") return t("reason.noData");
  return t("reason.hold");
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="slider">
      <label>{label}</label>
      <output>
        {value.toFixed(step < 1 ? 1 : 0)}
        {suffix}
      </output>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function MonthStrip({
  index,
  lang,
  currentMonth,
  targetMonth,
}: {
  index: number[];
  lang: "en" | "rw";
  currentMonth: number;
  targetMonth: number | null;
}) {
  const low = Math.min(...index);
  const high = Math.max(...index);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 3 }}>
      {index.map((v, i) => {
        const ratio = high > low ? (v - low) / (high - low) : 0;
        const color = `rgb(${Math.round(168 + (28 - 168) * (1 - ratio))}, ${Math.round(
          90 + (122 - 90) * (1 - ratio)
        )}, ${Math.round(18 + (79 - 18) * (1 - ratio))})`;
        const isCurrent = i + 1 === currentMonth;
        const isTarget = targetMonth === i + 1;
        return (
          <div key={i} style={{ textAlign: "center" }}>
            <div
              title={`${(v * 100).toFixed(0)}%`}
              style={{
                background: color,
                height: 42,
                borderRadius: 5,
                outline: isCurrent ? "3px solid #14231d" : isTarget ? "3px solid #f2c14e" : "none",
                outlineOffset: 1,
                opacity: 0.9,
              }}
            />
            <div style={{ fontSize: 10, marginTop: 2, color: "#77877e" }}>
              {(lang === "en" ? ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"] : ["M", "G", "W", "M", "G", "K", "N", "K", "N", "U", "G", "U"])[i]}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function groupByProvince(districts: District[]): [string, District[]][] {
  const groups = new Map<string, District[]>();
  for (const d of districts) {
    const province = d.province.replace(" Province", "");
    const bucket = groups.get(province);
    if (bucket) bucket.push(d);
    else groups.set(province, [d]);
  }
  return [...groups.entries()];
}
