import { useMemo, useState } from "react";
import type { Dataset, Lang } from "../lib/types";
import type { StringKey } from "../lib/i18n";
import { advise, defaultSettings, monthName } from "../lib/advice";
import { num, signed } from "../lib/format";
import { smsText, ussdMenu } from "../lib/messages";
import { initialUssdState, ussdPress, type UssdState } from "../lib/ussd";

/**
 * A working simulation of the feature-phone product.
 *
 * Every number on this screen comes from the same decision engine the website
 * uses, applied to the same district dataset — so what a judge sees here is
 * what a caller would hear. What is simulated is the telecom hop: a real
 * deployment needs a short code from an aggregator, which is a commercial
 * agreement, not code. See docs/DATA_RELIABILITY.md.
 */

export default function PhoneView({
  data,
  lang,
  t,
}: {
  data: Dataset;
  lang: Lang;
  t: (k: StringKey, vars?: Record<string, string | number>) => string;
}) {
  const rw = lang === "rw";
  const crops = data.crops.filter((c) => c.districts.length > 0);

  const [session, setSession] = useState<UssdState>(() => initialUssdState(crops[0]?.id ?? ""));
  const { step, cropId, districtId, page, quantity } = session;
  const [log, setLog] = useState<string[]>([]);

  const crop = crops.find((c) => c.id === cropId) ?? crops[0];
  const districts = useMemo(
    () =>
      data.districts
        .filter((d) => d.crops[crop.id])
        .map((d) => d.id)
        .sort((a, b) => a.localeCompare(b)),
    [data, crop.id]
  );
  const district = data.districts.find((d) => d.id === districtId);
  const cropData = district?.crops[crop.id];

  const nowParts = data.now.split("-");
  const nowYM: [number, number] = [Number(nowParts[0]), Number(nowParts[1])];

  // The short code always answers for today. This clock exists only so the
  // other branch — the one that says HOLD — can be shown on stage in October
  // instead of waiting for February. It is labelled as a demo control.
  const [clock, setClock] = useState<[number, number]>(nowYM);
  const clockMonths = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => {
        const t = nowYM[0] * 12 + (nowYM[1] - 1) + i;
        return [Math.floor(t / 12), (t % 12) + 1] as [number, number];
      }),
    [nowYM[0], nowYM[1]]
  );

  const advice = useMemo(
    () => (cropData ? advise(cropData, defaultSettings(crop), quantity, clock) : null),
    [cropData, crop, quantity, clock]
  );

  const screen = useMemo(() => {
    if (step === "idle") {
      return [
        rw ? "*774*7#" : "*774*7#",
        "",
        rw ? "SokoRyari?" : "SokoRyari?",
        rw ? "Inama ku igiciro" : "Price advice",
        "",
        rw ? "Kanda AHARI" : "Press CALL",
        `00 ${rw ? "Guhagarika" : "Cancel"}`,
      ];
    }
    if (step === "crop") {
      return ussdMenu(lang, "crop", { crops: crops.map((c) => (rw ? c.rw : c.name)) });
    }
    if (step === "district") {
      return ussdMenu(lang, "district", { districts, page });
    }
    if (step === "quantity") return ussdMenu(lang, "quantity");
    return advice ? ussdMenu(lang, "result", { advice, district: districtId, quantityKg: quantity }) : [];
  }, [step, lang, rw, crops, districts, page, advice, districtId, quantity]);

  const sms = useMemo(
    () => (advice && district ? smsText(lang, district.id, crop, advice, quantity) : ""),
    [advice, district, crop, lang, quantity]
  );

  const press = (key: string) => {
    const next = ussdPress(session, key, {
      cropIds: crops.map((c) => c.id),
      districts,
    });
    if (next.step === "result" && session.step === "quantity") {
      setLog((l) => [...l.slice(-2), `${next.districtId} · ${next.quantity} kg`]);
    }
    setSession(next);
  };

  return (
    <div className="stack">
      <section className="card">
        <div className="card-title">{t("phone.title")}</div>
        <p className="section-p">{t("phone.intro")}</p>
        <div className="row" style={{ gap: 8 }}>
          <span className="badge">{t("phone.badge.working")}</span>
          <span className="badge grey">{t("phone.badge.dial")} *774*7#</span>
        </div>
      </section>

      <div className="grid-2">
        <div className="stack">
          <section className="card">
            <div className="card-title">{t("phone.how")}</div>
            <ol className="how-list">
              <li>{t("phone.how.1")}</li>
              <li>{t("phone.how.2")}</li>
              <li>{t("phone.how.3")}</li>
            </ol>
            <p className="note good" style={{ marginTop: 12 }}>
              {t("phone.sameEngine")}
            </p>
          </section>

          <section className="card">
            <div className="card-title">{t("phone.real.title")}</div>
            <p className="section-p" style={{ marginBottom: 8 }}>
              {t("phone.real.body")}
            </p>
            <div className="scroll-x">
              <table className="plain">
                <tbody>
                  <tr>
                    <td>{t("phone.real.need")}</td>
                    <td>{t("phone.real.needValue")}</td>
                  </tr>
                  <tr>
                    <td>{t("phone.real.cost")}</td>
                    <td>{t("phone.real.costValue")}</td>
                  </tr>
                  <tr>
                    <td>{t("phone.real.time")}</td>
                    <td>{t("phone.real.timeValue")}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="small muted" style={{ marginTop: 10 }}>
              {t("phone.real.honest")}
            </p>
          </section>

          {sms && (
            <section className="card">
              <div className="card-title">{t("phone.sms.title")}</div>
              <p className="section-p">{t("phone.sms.note", { n: sms.length })}</p>
              <div className="bubble sms-bubble">{sms}</div>
            </section>
          )}
        </div>

        {/* the handset */}
        <div className="stack">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <label className="field" htmlFor="clock" style={{ margin: 0 }}>
              {t("phone.clock")}
            </label>
            <select
              id="clock"
              value={`${clock[0]}-${clock[1]}`}
              onChange={(e) => {
                const [y, m] = e.target.value.split("-").map(Number);
                setClock([y, m]);
              }}
              style={{ maxWidth: 180 }}
            >
              {clockMonths.map((ym) => (
                <option key={`${ym[0]}-${ym[1]}`} value={`${ym[0]}-${ym[1]}`}>
                  {monthName(ym, lang)}
                </option>
              ))}
            </select>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            {t("phone.clockHint")}
          </p>

          <div className="handset">
            <div className="handset-top">
              <span>SokoRyari</span>
              <span className="dot" />
            </div>
            <div className={`handset-screen ${step === "result" ? "final" : ""}`}>
              {screen.map((line, i) => (
                <div key={i} className={i === 0 ? "line head" : "line"}>
                  {line || "\u00a0"}
                </div>
              ))}
            </div>
            <div className="handset-actions">
              <button
                className="key ghost"
                onClick={() => setSession(initialUssdState(cropId))}
                aria-label="End"
              >
                {rw ? "Hagarika" : "End"}
              </button>
              <button
                className="key call"
                onClick={() => setSession({ ...initialUssdState(cropId), step: "crop" })}
              >
                {rw ? "Kanda" : "CALL"}
              </button>
            </div>
            <div className="keypad" role="group" aria-label="Keypad">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((k) => (
                <button
                  key={k}
                  className="keypad-key"
                  onClick={() => press(k)}
                  disabled={k === "*" || k === "#"}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>

          {step === "result" && advice && district && (
            <section className="card">
              <div className="card-title">{t("phone.result.title")}</div>
              <p style={{ marginBottom: 12 }}>
                <strong>{district.id}</strong> · {rw ? crop.rw : crop.name} ·{" "}
                {num(quantity)} kg
              </p>
              <div className={`verdict ${advice.action === "hold" ? "hold" : "sell"}`}>
                <div className="kicker">{t("result.title")}</div>
                <div className="headline">
                  {advice.action === "hold"
                    ? `${t("result.hold")} ${advice.best.months}`
                    : t("result.sell")}
                </div>
                <div className="subhead">
                  {advice.action === "hold"
                    ? t("result.holdFor", {
                        n: advice.best.months,
                        month: monthName(advice.best.ym, lang),
                      })
                    : t("phone.result.sellNote")}
                </div>
                <div className="money">
                  <div>
                    <span>{t("result.priceToday")}</span>
                    <strong>{num(advice.priceToday)}/kg</strong>
                  </div>
                  <div className={advice.best.netPerKg < 0 ? "neg" : ""}>
                    <span>{t("result.netPerKg")}</span>
                    <strong>{signed(Math.round(advice.best.netPerKg))}/kg</strong>
                  </div>
                </div>
              </div>
              <p className="small muted" style={{ marginTop: 10 }}>
                {t("phone.result.foot", { market: cropData?.market ?? "" })}{" "}
                {monthName(clock, lang)}
                {clock[0] !== nowYM[0] || clock[1] !== nowYM[1] ? ` · ${t("phone.clockDemo")}` : ""}
              </p>
            </section>
          )}

          {step === "idle" && (
            <p className="note">{t("phone.idleHint")}</p>
          )}
          {log.length > 0 && (
            <p className="small muted">
              {t("phone.log")}: {log.join(" · ")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
