import { useEffect, useRef, useState } from "react";
import { api, basename, type SearchResult } from "../ipc";

interface Props {
  workspace: string | null;
  onOpenHit: (path: string, lineNo: number) => void;
}

export default function SearchPanel({ workspace, onOpenHit }: Props) {
  const [q, setQ] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeqRef = useRef(0);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!workspace || !q) {
      searchSeqRef.current++;
      setResult(null);
      setError("");
      return;
    }
    timer.current = setTimeout(() => {
      const seq = ++searchSeqRef.current;
      void api
        .searchWorkspace(workspace, q, { caseSensitive, wholeWord, useRegex })
        .then((r) => {
          if (seq !== searchSeqRef.current) return;
          setResult(r);
          setError("");
        })
        .catch((e) => {
          if (seq !== searchSeqRef.current) return;
          setResult(null);
          setError(String(e));
        });
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      searchSeqRef.current++;
    };
  }, [q, caseSensitive, wholeWord, useRegex, workspace]);

  if (!workspace) return <div className="panel-empty">跨文件搜索<br />请先打开文件夹</div>;

  const groups: { path: string; hits: SearchResult["hits"] }[] = [];
  for (const h of result?.hits ?? []) {
    const g = groups[groups.length - 1];
    if (g && g.path === h.path) g.hits.push(h);
    else groups.push({ path: h.path, hits: [h] });
  }

  return (
    <div className="search-panel">
      <div className="search-box">
        <input
          value={q}
          placeholder="跨文件搜索…"
          aria-label="跨文件搜索关键词"
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
        <div className="search-flags">
          <button aria-pressed={caseSensitive} className={caseSensitive ? "on" : ""} title="区分大小写" onClick={() => setCaseSensitive((v) => !v)}>Aa</button>
          <button aria-pressed={wholeWord} className={wholeWord ? "on" : ""} title="全词匹配" onClick={() => setWholeWord((v) => !v)}>ab</button>
          <button aria-pressed={useRegex} className={useRegex ? "on" : ""} title="正则表达式" onClick={() => setUseRegex((v) => !v)}>.*</button>
        </div>
      </div>
      {error && <div className="search-error">{error}</div>}
      <div className="search-results">
        {groups.map((g) => (
          <div key={g.path} className="search-group">
            <div className="search-file" title={g.path}>
              {basename(g.path)} <span className="search-count">{g.hits.length}</span>
            </div>
            {g.hits.map((h, i) => (
              <button key={i} className="search-hit" onClick={() => onOpenHit(g.path, h.line_no)}>
                <span className="search-lineno">{h.line_no}</span>
                <span className="search-line">{h.line}</span>
              </button>
            ))}
          </div>
        ))}
        {result && !result.hits.length && !error && <div className="panel-empty">无命中</div>}
      </div>
      {result && (
        <div className="search-stats">
          {result.hits.length} 处命中 · {result.files_scanned} 文件 · {result.elapsed_ms}ms
          {result.truncated && " · 已截断"}
        </div>
      )}
    </div>
  );
}