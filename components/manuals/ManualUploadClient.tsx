"use client";

import { useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { useRouter } from "next/navigation";

type Frame = { timestamp: string; url: string; index: number };
type StepDraft = {
  title: string;
  description: string;
  warning: string;
  relatedPath: string;
  screenshot: string;
  videoTimestamp: string;
};

const ROLE_OPTIONS = ["원장", "행정", "강사", "조교"];
// 무조건 N초마다 캡처하지 않고(섹션18), 짧은 간격으로 샘플링한 뒤 화면이
// 의미 있게 바뀐 지점만 남긴다. SAMPLE_INTERVAL이 촘촘할수록 전환을 놓치지
// 않지만 분석 시간이 늘어나므로 1초로 절충한다.
const SAMPLE_INTERVAL_SEC = 1;
const MAX_FRAMES = 20;
const DIFF_THRESHOLD = 18; // 0~255 평균 밝기 차이 기준, 경험적으로 정한 값

function formatTimestamp(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function ManualUploadClient() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [stage, setStage] = useState<"pick" | "extracting" | "uploading" | "analyzing" | "review">("pick");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [targetRoles, setTargetRoles] = useState<string[]>([]);
  const [summary, setSummary] = useState("");
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [videoUrl, setVideoUrl] = useState("");
  const [saving, setSaving] = useState(false);

  function toggleRole(role: string) {
    setTargetRoles((cur) => (cur.includes(role) ? cur.filter((r) => r !== role) : [...cur, role]));
  }

  async function extractFrames(file: File): Promise<{ frames: { blob: Blob; timestamp: string }[]; duration: number }> {
    const video = videoRef.current!;
    const canvas = canvasRef.current!;
    const diffCanvas = document.createElement("canvas");
    diffCanvas.width = 64;
    diffCanvas.height = 36;
    const diffCtx = diffCanvas.getContext("2d")!;

    video.src = URL.createObjectURL(file);
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("영상을 불러오지 못했습니다."));
    });
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d")!;

    const duration = video.duration;
    let lastPixels: Uint8ClampedArray | null = null;
    const frames: { blob: Blob; timestamp: string }[] = [];

    for (let t = 0; t < duration && frames.length < MAX_FRAMES; t += SAMPLE_INTERVAL_SEC) {
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        video.currentTime = t;
      });
      diffCtx.drawImage(video, 0, 0, diffCanvas.width, diffCanvas.height);
      const pixels = diffCtx.getImageData(0, 0, diffCanvas.width, diffCanvas.height).data;

      let changed = lastPixels === null;
      if (lastPixels) {
        let diffSum = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          diffSum += Math.abs(pixels[i] - lastPixels[i]);
        }
        const avgDiff = diffSum / (pixels.length / 4);
        changed = avgDiff > DIFF_THRESHOLD;
      }

      if (changed) {
        lastPixels = pixels;
        ctx.drawImage(video, 0, 0);
        const blob: Blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b as Blob), "image/png"));
        frames.push({ blob, timestamp: formatTimestamp(t) });
        setProgress(`화면 전환 지점 ${frames.length}개 발견 (${formatTimestamp(t)} / ${formatTimestamp(duration)})`);
      }
    }
    return { frames, duration };
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setStage("extracting");
    try {
      const { frames: rawFrames } = await extractFrames(file);
      if (rawFrames.length === 0) throw new Error("화면 전환을 감지하지 못했습니다. 다른 영상으로 시도해주세요.");

      setStage("uploading");
      setProgress("영상 업로드 중...");
      const videoBlob = await upload(`manuals/${Date.now()}-${file.name}`, file, {
        access: "public",
        handleUploadUrl: "/api/manuals/upload-url",
        multipart: true,
      });
      setVideoUrl(videoBlob.url);

      const frames: Frame[] = [];
      for (let i = 0; i < rawFrames.length; i++) {
        setProgress(`스크린샷 업로드 중 (${i + 1}/${rawFrames.length})`);
        const result = await upload(`manuals/${Date.now()}-frame-${i}.png`, rawFrames[i].blob, {
          access: "public",
          handleUploadUrl: "/api/manuals/upload-url",
        });
        frames.push({ timestamp: rawFrames[i].timestamp, url: result.url, index: i });
      }

      setStage("analyzing");
      setProgress("AI가 단계를 분석하는 중...");
      const res = await fetch("/api/manuals/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frames: frames.map((f) => ({ timestamp: f.timestamp, url: f.url })) }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "AI 분석에 실패했습니다.");

      setSummary(data.summary ?? "");
      setSteps(
        (data.steps ?? []).map((s: any) => ({
          title: s.title ?? "",
          description: s.description ?? "",
          warning: s.warning ?? "",
          relatedPath: s.relatedPath ?? "",
          screenshot: frames[s.frameIndex]?.url ?? frames[0]?.url ?? "",
          videoTimestamp: frames[s.frameIndex]?.timestamp ?? "",
        }))
      );
      setTitle(file.name.replace(/\.[^.]+$/, ""));
      setStage("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "처리 중 오류가 발생했습니다.");
      setStage("pick");
    }
  }

  function updateStep(i: number, patch: Partial<StepDraft>) {
    setSteps((cur) => cur.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function removeStep(i: number) {
    setSteps((cur) => cur.filter((_, idx) => idx !== i));
  }
  function moveStep(i: number, dir: -1 | 1) {
    setSteps((cur) => {
      const next = [...cur];
      const j = i + dir;
      if (j < 0 || j >= next.length) return cur;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function submit() {
    if (!title.trim() || steps.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/manuals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, category, targetRoles, summary, sourceVideoUrl: videoUrl, steps }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.message ?? "저장에 실패했습니다.");
      router.push(`/director/manuals/${data.id}/review`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2>화면녹화로 매뉴얼 만들기</h2>
      <p className="muted">아이폰/iPad/Windows 기본 화면 녹화로 찍은 mp4/mov/webm 파일을 올리면, 화면이 바뀌는 지점을 찾아 AI가 단계별 매뉴얼 초안을 만듭니다. 음성은 분석하지 않습니다.</p>

      <video ref={videoRef} style={{ display: "none" }} muted playsInline />
      <canvas ref={canvasRef} style={{ display: "none" }} />

      {stage === "pick" && (
        <input type="file" accept="video/mp4,video/quicktime,video/webm" onChange={handleFile} />
      )}
      {(stage === "extracting" || stage === "uploading" || stage === "analyzing") && (
        <p className="muted">⏳ {progress}</p>
      )}
      {error && <p className="error-text">{error}</p>}

      {stage === "review" && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          <p className="success-box">개인정보 포함 가능 — 스크린샷에 학생 이름/연락처/성적 등이 보이면 아래에서 해당 단계의 스크린샷을 제거해주세요.</p>
          <label>
            제목
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} style={{ width: "100%" }} />
          </label>
          <label>
            카테고리
            <input type="text" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="예: 업무처리, 상담, 시험대비" />
          </label>
          <div>
            대상 역할:{" "}
            {ROLE_OPTIONS.map((r) => (
              <label key={r} style={{ marginRight: 10 }}>
                <input type="checkbox" checked={targetRoles.includes(r)} onChange={() => toggleRole(r)} /> {r}
              </label>
            ))}
          </div>
          <label>
            요약
            <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} style={{ width: "100%" }} />
          </label>

          <h3 style={{ fontWeight: 600 }}>단계 ({steps.length})</h3>
          {steps.map((s, i) => (
            <div key={i} className="card" style={{ padding: 12 }}>
              <div style={{ display: "flex", gap: 12 }}>
                {s.screenshot ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.screenshot} alt="" style={{ width: 140, height: "auto", borderRadius: 6, flexShrink: 0 }} />
                ) : (
                  <div className="muted" style={{ width: 140, flexShrink: 0 }}>스크린샷 없음</div>
                )}
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                  <input type="text" value={s.title} onChange={(e) => updateStep(i, { title: e.target.value })} placeholder="단계 제목" />
                  <textarea value={s.description} onChange={(e) => updateStep(i, { description: e.target.value })} rows={2} placeholder="설명" />
                  <input type="text" value={s.warning} onChange={(e) => updateStep(i, { warning: e.target.value })} placeholder="주의사항 (선택)" />
                  <input type="text" value={s.relatedPath} onChange={(e) => updateStep(i, { relatedPath: e.target.value })} placeholder="관련 경로 (예: /director/tasks)" />
                  <div style={{ display: "flex", gap: 6 }}>
                    <button type="button" className="secondary" onClick={() => moveStep(i, -1)}>위로</button>
                    <button type="button" className="secondary" onClick={() => moveStep(i, 1)}>아래로</button>
                    {s.screenshot && (
                      <button type="button" className="secondary" onClick={() => updateStep(i, { screenshot: "" })}>
                        스크린샷 제외(개인정보)
                      </button>
                    )}
                    <button type="button" className="secondary" onClick={() => removeStep(i)}>단계 삭제</button>
                  </div>
                </div>
              </div>
            </div>
          ))}

          <button type="button" disabled={saving || !title.trim() || steps.length === 0} onClick={submit}>
            {saving ? "저장 중..." : "초안 등록 (검토 화면으로 이동)"}
          </button>
        </div>
      )}
    </div>
  );
}
