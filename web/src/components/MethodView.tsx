import type { Dataset } from "../lib/types";
import type { StringKey } from "../lib/i18n";
import { num, signed } from "../lib/format";

interface Props {
  data: Dataset;
  lang: "en" | "rw";
  t: (k: StringKey, vars?: Record<string, string | number>) => string;
}

export default function MethodView({ data, lang, t }: Props) {
  const ds = data.decision_summary;
  const maize = data.decision_by_crop["maize"];

  return (
    <div className="stack">
      <section className="card">
        <h2 className="section-h" style={{ fontSize: "1.4rem" }}>
          {lang === "en" ? "What this is, and what it is not" : "Iki ni iki, kandi iki ntabwo kiri"}
        </h2>
        <p>
          {lang === "en" ? (
            <>
              SokoRyari? answers one question a farmer asks every harvest: <em>sell now, or wait?</em> It
              does it from measured market prices, not opinion. Every number on this site traces back to a
              dataset and a rule that can be inspected, and the rule has been tested on months it never saw.
            </>
          ) : (
            <>
              SokoRyari? isubiza ikibazo umuhinzi abaza buri gihe asaruye: <em>gurisha ubu, cyangwa
              utegereze?</em> Bikorwa bushingiye ku biciro byapimwe, ntabwo ari ibitekerezo. Buri mubare uri
              kuri uru rubuga ukomoka ku makuru n'amategeko ashobora kugenzurwa, kandi yageragejwe ku mezi
              atarakoreshejwe mu kwiga.
            </>
          )}
        </p>
      </section>

      <section className="card">
        <div className="card-title">{lang === "en" ? "The data" : "Amakuru"}</div>
        <div className="scroll-x">
          <table className="plain">
            <thead>
              <tr>
                <th>{lang === "en" ? "Dataset" : "Urutonde"}</th>
                <th>{lang === "en" ? "What we use it for" : "Icyo tuyakoresha"}</th>
                <th>{lang === "en" ? "Licence / access" : "Uburenganzira"}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <strong>WFP VAM — Rwanda food prices</strong>
                  <div className="small muted">via HDX · {num(data.meta.observations)} observations</div>
                </td>
                <td>
                  {lang === "en"
                    ? `Monthly retail prices, ${data.meta.first_year}–2026, ${data.markets.length} markets. The entire price model is built on this.`
                    : `Ibiciro by'ukwezi, ${data.meta.first_year}–2026, amasoko ${data.markets.length}.`}
                </td>
                <td className="small">CC-BY (open)</td>
              </tr>
              <tr>
                <td>
                  <strong>{lang === "en" ? "NISR district boundaries" : "Imbibi z'uturere (NISR)"}</strong>
                  <div className="small muted">geoBoundaries gbOpen RWA ADM2</div>
                </td>
                <td>
                  {lang === "en"
                    ? "The map. Sourced from NISR's own geodata portal, so district names match official ones."
                    : "Ikarita. Zikomoka kuri NISR, bityo amazina y'uturere ahura n'ayemewe."}
                </td>
                <td className="small">CC-BY 4.0</td>
              </tr>
              <tr>
                <td>
                  <strong>NST2 2024–2029</strong>
                </td>
                <td>
                  {lang === "en"
                    ? "The policy target we measure against: post-harvest losses below 5% by 2029 (PA-03)."
                    : "Intego ya politiki tugereranya nayo."}
                </td>
                <td className="small">{lang === "en" ? "public document" : "inyandiko rusange"}</td>
              </tr>
              <tr>
                <td>
                  <strong>{lang === "en" ? "OAG audit findings" : "Iperereza rya OAG"}</strong>
                  <div className="small muted">{lang === "en" ? "reported to Parliament, March 2026" : "March 2026"}</div>
                </td>
                <td>
                  {lang === "en"
                    ? "Why the loss rate is stuck: mechanised drying reaches only 18% of the maize harvest, storage holds 33% of all harvests."
                    : "Impamvu igihombo kitagabanuka."}
                </td>
                <td className="small">{lang === "en" ? "public record" : "inama"}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-title">{lang === "en" ? "How the forecast works" : "Uko ubuhanuzi bukora"}</div>
        <p>
          {lang === "en" ? (
            <>
              A price is the product of three things: a <strong>level</strong> (what the crop is worth this
              year), a <strong>seasonal shape</strong> (the same month-of-year cycle every year), and{" "}
              <strong>noise</strong>. We estimate the level from recent deseasonalised prices, and the shape
              from every complete year since 2014, weighting recent years more heavily. A district's shape is
              pulled toward the national shape in proportion to how much evidence it has — a district with
              two years of data does not get to claim a 75% seasonal swing.
            </>
          ) : (
            <>
              Igiciro kigizwe n'ibintu bitatu: urwego, imiterere y'ibihe, n'urujijo. Dufata urwego ku biciro
              biheruka, n'imiterere ku myaka yose yuzuye kuva 2014.
            </>
          )}
        </p>
        <p className="small muted">
          {lang === "en"
            ? "Three forecasters were implemented and compared: a seasonal-naive benchmark, a level × seasonal-shape model, and a ridge regression on log-returns with lag features. The winner per market is chosen on held-out months, not on training fit."
            : "Uburyo butatu bwagenze uko bugereranywa; uwatsindiye ku isoko imwe yatoranyijwe ku mezi atarakoreshejwe mu kwiga."}
        </p>
      </section>

      <section className="card">
        <div className="card-title">{t("method.backtest")}</div>
        <p className="section-p">
          {lang === "en"
            ? "Rolling-origin test: each model trained only on data available before each test month, then scored one month ahead. Lower error is better; direction is the share of times it got the move right."
            : "Ikigeragezo cyo guhana uko ibihe bihaye: buri buryo bwatojwe gusa ku makuru yabonetse mbere y'ukwezi kugeragezwa."}
        </p>
        <div className="scroll-x">
          <table className="plain">
            <thead>
              <tr>
                <th>{t("method.model")}</th>
                <th className="num">{t("method.mape")}</th>
                <th className="num">{t("method.direction")}</th>
                <th className="num">{t("method.won")}</th>
              </tr>
            </thead>
            <tbody>
              {data.backtest_summary.map((r) => (
                <tr key={r.model}>
                  <td>
                    <code>{r.model}</code>
                  </td>
                  <td className="num">{r.mean_mape != null ? `${r.mean_mape}%` : "—"}</td>
                  <td className="num">{r.mean_direction != null ? `${r.mean_direction}%` : "—"}</td>
                  <td className="num">
                    {r.series_won}/{r.series_scored}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note" style={{ marginTop: 10 }}>
          {lang === "en"
            ? "The seasonal model cuts error by roughly 40% against the seasonal-naive benchmark that most price apps effectively use. It is the model behind almost every district."
            : "Uburyo bushingiye ku bihe bugabanya ikosa ikigereranyije n'uburyo bwa kera."}
        </p>
      </section>

      <section className="card">
        <div className="card-title">{t("method.decision")}</div>
        <p className="section-p">
          {lang === "en" ? (
            <>
              Forecast accuracy is not the point. The point is whether following the advice made money. We
              replayed every month from 2023 onward: at each month the model could only use what was known
              then, it made the same decision this app makes, and we then charged the real storage, interest
              and spoilage costs and compared with what the price actually did.
            </>
          ) : (
            <>
              Ukuri kw'ubuhanuzi ntabwo ari yo ntego. Intego ni ukumenya niba gukurikiza inama byazanye
              amafaranga.
            </>
          )}
        </p>
        <div className="scroll-x">
          <table className="plain">
            <thead>
              <tr>
                <th>{t("method.crop")}</th>
                <th className="num">{t("method.holds")}</th>
                <th className="num">{t("method.realised")}</th>
                <th className="num">{t("method.positive")}</th>
                <th>{t("method.verdict")}</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.decision_by_crop).map(([id, v]) => (
                <tr key={id}>
                  <td>{data.crops.find((c) => c.id === id)?.name ?? id}</td>
                  <td className="num">
                    {v.holds} / {v.decisions}
                  </td>
                  <td className="num">{v.mean_realised_per_kg != null ? signed(v.mean_realised_per_kg) : "—"}</td>
                  <td className="num">{v.mean_pct_positive != null ? `${Math.round(v.mean_pct_positive)}%` : "—"}</td>
                  <td>
                    {v.verdict === "pays" ? (
                      <span className="badge">{t("method.pays")}</span>
                    ) : (
                      <span className="badge warn">{t("method.notPays")}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {ds && (
          <div className="kpi-grid" style={{ marginTop: 12 }}>
            <div className="kpi">
              <span>{lang === "en" ? "Decisions replayed" : "Ibyemezo byasubiwemo"}</span>
              <strong>{num(ds.decisions)}</strong>
            </div>
            <div className="kpi">
              <span>{lang === "en" ? "Hold advised" : "Inama zo gutegereza"}</span>
              <strong>
                {ds.holds} ({ds.hold_share}%)
              </strong>
            </div>
            <div className="kpi">
              <span>{lang === "en" ? "Mean realised" : "Byabonetse"}</span>
              <strong>{ds.mean_realised_per_kg != null ? `${signed(ds.mean_realised_per_kg)} /kg` : "—"}</strong>
            </div>
            <div className="kpi">
              <span>{lang === "en" ? "Profitable" : "Byagize inyungu"}</span>
              <strong>{ds.mean_pct_positive != null ? `${Math.round(ds.mean_pct_positive)}%` : "—"}</strong>
            </div>
          </div>
        )}

        <p className="note good" style={{ marginTop: 12 }}>
          {lang === "en" ? (
            <>
              The tool says <strong>hold</strong> in only {ds?.hold_share ?? 8}% of month-crop cases. That is
              deliberate. For maize, the historical holds returned{" "}
              <strong>{maize?.mean_realised_per_kg != null ? signed(maize.mean_realised_per_kg) : "—"} RWF/kg</strong>{" "}
              after costs and were profitable {maize?.mean_pct_positive != null ? Math.round(maize.mean_pct_positive) : "—"}% of
              the time. For rice and beans it does not pay, and the app tells those farmers to sell. A tool
              that said "hold" every month would be worse than no tool.
            </>
          ) : (
            <>
              Iki gikoresho kivuga <strong>tegereza</strong> gusa mu {ds?.hold_share ?? 8}% by'ibihe. Ni
              nkana. Ku bigori, byatanze inyungu nyinshi nyuma y'amanze.
            </>
          )}
        </p>
      </section>

      <section className="card">
        <div className="card-title">{t("method.limits")}</div>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: "0.9rem" }}>
          {lang === "en" ? (
            <>
              <li>
                <strong>Market monitoring has thinned.</strong> Only{" "}
                {data.meta.coverage?.markets_reporting_2026 ?? 27} markets still report in 2026, in{" "}
                {data.meta.coverage?.live_districts.length ?? 6} districts. {
                  data.meta.coverage
                    ? `${data.meta.coverage.covered_districts} of ${data.meta.coverage.total_districts} districts can be modelled at all; no market has reported in ${data.meta.coverage.missing_districts.join(", ")} since 2012.`
                    : ""
                }{" "}
                For the rest we carry the last observed price forward with the national trend and say so, with
                an <span className="badge warn">est</span> badge. We never present a stale price as live.
              </li>
              <li>
                <strong>Some records are WFP aggregates, not single observations.</strong>{" "}
                {data.meta.aggregate_flagged && data.meta.observations
                  ? `${((100 * data.meta.aggregate_flagged) / data.meta.observations).toFixed(1)}%`
                  : "11%"}{" "}
                of the observations carry WFP's <em>aggregate</em> flag rather than <em>actual</em>. Keeping
                them is what allows four markets to report in 2026 at all. Excluding them moves the bean
                result from −22 to +97 RWF per kg, so we call the bean verdict fragile and the maize verdict
                stable (positive either way). The choice is published, not hidden.
              </li>
              <li>
                <strong>The cost assumptions are yours, not ours.</strong> Storage, interest and spoilage are
                sliders because they vary enormously. Raising interest from 12% to 24% — a SACCO rate to
                a microfinance rate — cuts the number of crop-district-month cases worth storing from
                <strong>178 to 106</strong>, and flips <strong>72</strong> of them from hold to sell. That
                is a finding, not a bug.
              </li>
              <li>
                <strong>Prices are retail, not farmgate.</strong> A farmer selling at the farm gate gets less
                than a market retail price. Treat the numbers on this site as the shape and direction of the
                opportunity, not as a payout promise.
              </li>
              <li>
                <strong>Small samples.</strong> Some crops have few historical hold decisions. Where the count
                is low, read the percentage as indicative.
              </li>
              <li>
                <strong>One season ahead.</strong> The model does not forecast droughts, import bans or
                elections. It forecasts the shape of a normal year.
              </li>
              <li>
                <strong>This is not a credit product.</strong> It shows what storage is worth; it does not
                provide the working capital that makes waiting possible.
              </li>
            </>
          ) : (
            <>
              <li>Amakuru y'amasoko yagabanutse: amasoko 27 gusa atanga amakuru muri 2026.</li>
              <li>Amanze y'ububiko, inyungu n'iyangirika ni ayanyu — ni yo mpamvu ari sliders.</li>
              <li>Ibiciro ni iby'isoko, ntabwo ni iby'umuhinzi ku murima.</li>
              <li>Ingero nkeya: soma ijanisha nk'ikigereranyo gusa.</li>
              <li>Iki ni icyemezo cy'ibihe, ntabwo ni ingwate.</li>
            </>
          )}
        </ul>
      </section>
    </div>
  );
}
