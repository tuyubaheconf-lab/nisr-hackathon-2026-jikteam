import { useEffect, useMemo, useState } from "react";
import type { Dataset, Lang } from "./lib/types";
import { translator } from "./lib/i18n";
import { fetchLive, formatRefresh, type LiveFeed } from "./lib/live";
import FarmerView from "./components/FarmerView";
import BoardView from "./components/BoardView";
import MethodView from "./components/MethodView";
import PhoneView from "./components/PhoneView";

type Page = "advice" | "board" | "phone" | "method";

const PAGES: Page[] = ["advice", "board", "phone", "method"];
const NAV: Record<Page, string> = {
  advice: "nav.advice",
  board: "nav.board",
  phone: "nav.phone",
  method: "nav.method",
};

const readPage = (): Page => {
  const h = window.location.hash.replace("#/", "").replace("#", "");
  return (PAGES as string[]).includes(h) ? (h as Page) : "advice";
};

export default function App() {
  const [data, setData] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<LiveFeed | null>(null);
  const [lang, setLang] = useState<Lang>("en");
  const [page, setPage] = useState<Page>(readPage);

  useEffect(() => {
    const onHash = () => setPage(readPage());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("./data/data.json")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: Dataset) => alive && setData(d))
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, []);

  // The live feed is a bonus, not a dependency: if it never answers, the
  // page is identical to what it was before, just less fresh.
  useEffect(() => {
    let alive = true;
    fetchLive().then((f) => alive && setLive(f));
    return () => {
      alive = false;
    };
  }, []);

  const t = useMemo(() => translator(lang), [lang]);

  const go = (p: Page) => {
    window.location.hash = `#/${p}`;
    setPage(p);
  };

  return (
    <div className="app">
      <header className="top">
        <div className="wrap top-inner">
          <div className="brand">
            <h1>{t("app.name")}</h1>
            <span className="tagline">{t("app.tagline")}</span>
          </div>
          <div className="top-actions">
            <div className="lang-toggle" role="group" aria-label="Language">
              <button aria-pressed={lang === "en"} onClick={() => setLang("en")}>
                EN
              </button>
              <button aria-pressed={lang === "rw"} onClick={() => setLang("rw")}>
                RW
              </button>
            </div>
          </div>
        </div>
        <div className="wrap" style={{ padding: 0 }}>
          <nav className="tabs">
            {PAGES.map((p) => (
              <a
                key={p}
                href={`#/${p}`}
                className={page === p ? "active" : ""}
                onClick={(e) => {
                  e.preventDefault();
                  go(p);
                }}
              >
                {t(NAV[p] as "nav.advice")}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <main>
        <div className="wrap">
          {error && (
            <p className="note warn">
              Could not load the price data ({error}). Run <code>npm run build</code> after{" "}
              <code>python pipeline/build.py</code>.
            </p>
          )}
          {!data && !error && <div className="loading">Loading prices…</div>}
          {data && page === "advice" && <FarmerView data={data} lang={lang} t={t} live={live} />}
          {data && page === "board" && <BoardView data={data} lang={lang} t={t} />}
          {data && page === "phone" && <PhoneView data={data} lang={lang} t={t} />}
          {data && page === "method" && <MethodView data={data} lang={lang} t={t} />}
        </div>
      </main>

      <footer className="foot">
        <div className="wrap">
          <p>
            {t("footer.built")} {t("footer.data")}
          </p>
          <p className="small">
            {t("disclaimer")} · Data updated {data?.meta.generated ?? "—"}.
            {live && (
              <>
                {" "}
                {t("live.foot", {
                  source: live.source === "esoko" ? "eSoko" : "WFP",
                  asOf: live.as_of || "—",
                  when: formatRefresh(live.refreshed_at),
                })}
              </>
            )}
          </p>
        </div>
      </footer>
    </div>
  );
}
