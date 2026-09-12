"use client";

import { useState } from "react";

interface Summary {
  slots: number;
  filled: number;
  computed?: number;
  unfilled: number;
  overflow: number;
  questions: number;
  errors: string[];
  changedRatio: number;
}

const nf = new Intl.NumberFormat("ko-KR");

export default function Home() {
  const [formFile, setFormFile] = useState<File | null>(null);
  const [srcFile, setSrcFile] = useState<File | null>(null);
  const [srcText, setSrcText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Summary | null>(null);

  const ready = !!formFile && (!!srcFile || srcText.trim() !== "");

  async function run() {
    if (!formFile) return;
    setError("");
    setDone(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("form", formFile);
      if (srcFile) fd.append("source", srcFile);
      if (srcText.trim()) fd.append("sourceText", srcText);

      const res = await fetch("/api/run", { method: "POST", body: fd });
      if (!res.ok) {
        const j = await res.json();
        throw new Error([j.error, ...(j.problems ?? [])].filter(Boolean).join(" · "));
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = formFile.name.replace(/\.hwpx$/i, "") + "_작성완료.hwpx";
      a.click();
      URL.revokeObjectURL(url);

      const head = res.headers.get("X-Run-Summary");
      if (head) setDone(JSON.parse(decodeURIComponent(head)) as Summary);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-bold tracking-tight">공문서 양식 자동 작성</h1>
      <p className="mt-1.5 text-sm text-neutral-600 dark:text-neutral-400">
        양식의 빈 칸에 자료를 채워 hwpx 파일 하나를 내려받습니다. 서식·글꼴·표는 원본 그대로입니다.
      </p>

      <div className="mt-8 space-y-5">
        <Field label="A · 채울 양식" sub="hwpx 공문서 서식">
          <input
            type="file"
            accept=".hwpx"
            onChange={(e) => setFormFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-neutral-900 file:px-3 file:py-1.5 file:text-sm file:text-white dark:file:bg-white dark:file:text-neutral-900"
          />
          {formFile && (
            <p className="mt-2 text-xs text-neutral-500">
              {formFile.name} · {nf.format(Math.round(formFile.size / 1024))} KB
            </p>
          )}
        </Field>

        <Field label="B · 가진 자료" sub="hwpx·txt 파일 또는 직접 붙여넣기">
          <input
            type="file"
            accept=".hwpx,.txt,.md,.csv,.json"
            onChange={(e) => setSrcFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-neutral-200 file:px-3 file:py-1.5 file:text-sm dark:file:bg-neutral-700 dark:file:text-white"
          />
          <textarea
            value={srcText}
            onChange={(e) => setSrcText(e.target.value)}
            rows={4}
            placeholder="또는 여기에 내용을 붙여넣으세요"
            className="mt-2 w-full resize-y rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-neutral-300"
          />
        </Field>

        <button
          onClick={run}
          disabled={!ready || busy}
          className="w-full rounded-md bg-neutral-900 px-4 py-3 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900"
        >
          {busy ? "채우는 중… (최대 1~2분)" : "채워서 내려받기"}
        </button>
      </div>

      {error && (
        <p className="mt-5 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {done && (
        <div className="mt-5 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm dark:border-emerald-900 dark:bg-emerald-950">
          <p className="font-medium text-emerald-900 dark:text-emerald-200">
            파일을 내려받았습니다 · 빈 칸 {done.slots}개 중 {done.filled}개 채움
            {done.computed ? ` (소계·합계 ${done.computed}개는 코드가 더함)` : ""}
          </p>
          <p className="mt-1 text-xs text-emerald-800 dark:text-emerald-400">
            근거가 없는 {done.unfilled}개는 지어내지 않고 비워뒀습니다
            {done.overflow > 0 && ` · 칸을 넘친 값 ${done.overflow}개는 확인이 필요합니다`}
            {done.questions > 0 && ` · 자료에 후보가 여럿인 칸 ${done.questions}개`}
            {` · 원본 대비 ${(done.changedRatio * 100).toFixed(2)}%만 변경`}
          </p>
          {done.errors.length > 0 && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
              일부 요청이 실패해 결과가 불완전합니다: {done.errors[0]}
            </p>
          )}
        </div>
      )}
    </main>
  );
}

function Field({
  label,
  sub,
  children,
}: {
  label: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <h2 className="text-sm font-semibold">{label}</h2>
      <p className="mb-3 text-xs text-neutral-500">{sub}</p>
      {children}
    </div>
  );
}
