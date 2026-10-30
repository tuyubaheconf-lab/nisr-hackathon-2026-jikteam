import { useMemo, useState } from "react";
import type { Dataset, District } from "../lib/types";
import type { StringKey } from "../lib/i18n";
import { advise, defaultSettings, monthName, ymAdd } from "../lib/advice";
import { num, rwf, shortRwf, signed } from "../lib/format";
import DistrictMap from "./DistrictMap";

interface Props {
  data: Dataset;
  lang: "en" | "rw";
  t: (k: StringKey, vars?: Record<string, string | number>) => string;
}

export default function BoardView({ data, lang, t }: Props) {
  const crops = data.crops.filter((c) => c.districts.length > 0);
  const [cropId, setCropId] = useState(crops[0]?.id ?? "");
  const crop = crops.find((c) => c.id === cropId) ?? crops[0];
  const [selected, setSelected] = useState<string>(data.districts[0]?.id ?? "");
  const [tonnes, setTonnes] = useState(100);
  const [monthOffset, setMonthOffset] = useState(0);

  const nowParts = data.now.split("-");
  const nowYM: [number, number] = [Number(nowParts[0]), Number(nowParts[1])];
  const decisionYM = ymAdd(nowYM[0], nowYM[1], monthOffset);

  const rows = useMemo(() => {
    return data.districts
      .filter((d) => d.crops[crop?.id])
      .map((d) => {
        const c = d.crops[crop.id];
        const s = defaultSettings(crop);
        const a = advise(c, s, 1000, decisionYM);
        return { district: d, crop: c, advice: a };
      })
      .sort((a, b) => b.advice.best.netPerKg - a.advice.best.netPerKg);
  }, [data.districts, crop, decisionYM]);

  if (!crop) return <p className="note warn">No crops available.</p>;

  const holding = rows.filter((r) => r.advice.action === "hold");
  const selectedRow = rows.find((r) => r.district.id === selected) ?? rows[0];

  const statusOf = (d: District) => {
    const r = rows.find((x) => x.district.id === d.id);
    if (!r) return { status: "none" as const, estimated: false };
    return {
      status: r.advice.action === "hold" ? ("hold" as const) : ("sell" as const),
      estimated: r.crop.estimated,
    };
  };

  // the impact figure must obey the advice: if we say sell, waiting has no value
  const wouldHold = selectedRow?.advice.action === "hold";
  const perKg = wouldHold ? (selectedRow?.advice.best.netPerKg ?? 0) : 0;
  const perTonne = perKg * 1000;
  const total = perTonne * tonnes;

  return (
    <div className="stack">
      <section className="card">
        <div className="card-title">{t("board.crop")}</div>
        <div className="chips">
          {crops.map((c) => (
            <button key={c.id} className="chip" aria-pressed={c.id === crop.id} onClick={() => setCropId(c.id)}>
              {lang === "en" ? c.name : c.rw}
            </button>
          ))}
        </div>
        <div className="card-title" style={{ marginTop: 16 }}>
          {t("board.month")}
        </div>
        <div className="chips">
          {Array.from({ length: 12 }, (_, i) => {
            const ym = ymAdd(nowYM[0], nowYM[1], i);
            return (
              <button
                key={`${ym[0]}-${ym[1]}`}
                className="chip"
                aria-pressed={i === monthOffset}
                onClick={() => setMonthOffset(i)}
              >
                {monthName(ym, lang)}
              </button>
            );
          })}
        </div>
        <p className="section-p" style={{ marginTop: 12, marginBottom: 0 }}>
          {t("board.subtitle")} — {holding.length} / {rows.length}{" "}
          {lang === "en"
            ? `districts are worth storing in ${monthName(decisionYM, lang)}.`
            : `uturere dukwiriye kubika mu ${monthName(decisionYM, lang)}.`}
        </p>
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-title">{t("board.mapTitle")}</div>
          <DistrictMap
            districts={rows.map((r) => r.district)}
            statusOf={statusOf}
            onPick={(d) => setSelected(d.id)}
            labels={{ hold: t("board.legend.hold"), sell: t("board.legend.sell"), estimated: t("board.legend.estimated") }}
          />
        </section>

        <section className="card">
          <div className="card-title">{t("board.impact")}</div>
          <p className="section-p">{t("board.impactHint")}</p>
          <label className="field" htmlFor="district-pick">
            {t("board.district")}
          </label>
          <select id="district-pick" value={selectedRow?.district.id} onChange={(e) => setSelected(e.target.value)}>
            {rows.map((r) => (
              <option key={r.district.id} value={r.district.id}>
                {r.district.id}
              </option>
            ))}
          </select>

          <div className="slider" style={{ marginTop: 10 }}>
            <label>{t("board.tonnes")}</label>
            <output>{num(tonnes)} t</output>
            <input
              type="range"
              min={1}
              max={1000}
              step={1}
              value={tonnes}
              onChange={(e) => setTonnes(Number(e.target.value))}
            />
          </div>

          <div className="kpi-grid" style={{ marginTop: 10 }}>
            <div className="kpi">
              <span>{t("board.perTonne")}</span>
              <strong>{wouldHold ? `${signed(perTonne)} RWF` : "—"}</strong>
            </div>
            <div className="kpi">
              <span>{t("board.totalValue")}</span>
              <strong>{wouldHold ? shortRwf(total) : "0 RWF"}</strong>
            </div>
          </div>
          {!wouldHold && (
            <p className="note warn" style={{ marginTop: 10 }}>
              {lang === "en"
                ? `${selectedRow?.district.id ?? "This district"} is not in a storage month. We advise selling, so there is no storage gain to report — waiting here has historically cost money, not made it.`
                : `Aka karere ntabwo kiri mu gihe cyo kubika. Dutanga inama yo kugurisha.`}
            </p>
          )}
          {selectedRow && (
            <p className="small muted" style={{ marginTop: 8 }}>
              {selectedRow.district.id} · {rwf(selectedRow.advice.priceToday)}/kg ·{" "}
              {selectedRow.advice.action === "hold"
                ? `${lang === "en" ? "hold" : "tegereza"} ${selectedRow.advice.best.months} → ${monthName(
                    selectedRow.advice.best.ym,
                    lang
                  )}`
                : lang === "en"
                  ? "sell now"
                  : "gurisha ubu"}
            </p>
          )}
        </section>
      </div>

      <section className="card">
        <div className="card-title">{t("board.table")}</div>
        <div className="scroll-x">
          <table className="plain">
            <thead>
              <tr>
                <th>{t("board.district")}</th>
                <th className="num">{t("board.price")}</th>
                <th>{t("board.cheap")}</th>
                <th>{t("board.peak")}</th>
                <th className="num">{t("board.swing")}</th>
                <th>{t("board.advice")}</th>
                <th className="num">{t("result.netPerKg")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ district, crop: c, advice }) => {
                const lo = c.index.indexOf(Math.min(...c.index)) + 1;
                const hi = c.index.indexOf(Math.max(...c.index)) + 1;
                return (
                  <tr key={district.id} style={{ cursor: "pointer" }} onClick={() => setSelected(district.id)}>
                    <td>
                      {district.id}
                      {c.estimated && <span className="badge warn" style={{ marginLeft: 6 }}>est</span>}
                    </td>
                    <td className="num">{num(advice.priceToday)}</td>
                    <td>{monthName([2000, lo], lang).split(" ")[0]}</td>
                    <td>{monthName([2000, hi], lang).split(" ")[0]}</td>
                    <td className="num">{c.swing.toFixed(0)}%</td>
                    <td>
                      {advice.action === "hold" ? (
                        <span className="badge">
                          {t("result.hold")} {advice.best.months}
                        </span>
                      ) : (
                        <span className="badge warn">{t("result.sell")}</span>
                      )}
                    </td>
                    <td className={`num ${advice.best.netPerKg < 0 ? "muted" : ""}`}>{signed(advice.best.netPerKg)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
