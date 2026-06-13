'use client';

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type ChangeEvent,
} from 'react';
import { extractFaceData } from '@/lib/mediapipeUtils';
import {
  calcTotalScore,
  getRank,
  RETOUCH_LABELS,
  RETOUCH_WARN,
  LIGHT_LABELS,
  type FaceData,
} from '@/lib/scoring';

// MediaPipe CDN の WASM とモデルファイル
const WASM_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

type Tab = 'camera' | 'upload';

const RANK_GRAD: Record<string, string> = {
  SS: 'from-yellow-400 to-amber-500',
  S:  'from-yellow-300 to-yellow-400',
  A:  'from-green-400 to-emerald-500',
  B:  'from-teal-400 to-green-400',
  C:  'from-orange-300 to-orange-400',
  D:  'from-red-300 to-red-400',
  E:  'from-gray-300 to-gray-400',
};

export default function FaceScorer() {
  // ── デテクター ──────────────────────────────────────────────
  const [detectorReady, setDetectorReady] = useState(false);
  const [detectorError, setDetectorError] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const detectorRef     = useRef<any>(null);
  const detectorModeRef = useRef<'VIDEO' | 'IMAGE'>('VIDEO');

  // ── UI 状態 ──────────────────────────────────────────────────
  const [tab,          setTab]          = useState<Tab>('camera');
  const [faceData,     setFaceData]     = useState<FaceData>({ hasFace: false });
  const [retouchLevel, setRetouchLevel] = useState(2);
  const [lightLevel,   setLightLevel]   = useState(3);
  const [showRaw,      setShowRaw]      = useState(false);

  // ── カメラ ───────────────────────────────────────────────────
  const videoRef     = useRef<HTMLVideoElement>(null);
  const streamRef    = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);
  const [streamActive, setStreamActive] = useState(false);
  const [cameraError,  setCameraError]  = useState<string | null>(null);

  // ── アップロード ──────────────────────────────────────────────
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);

  // ── MediaPipe 初期化 ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function build(delegate: 'GPU' | 'CPU') {
      const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
      const resolver = await FilesetResolver.forVisionTasks(WASM_URL);
      return FaceLandmarker.createFromOptions(resolver, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        outputFaceBlendshapes: true,
        runningMode: 'VIDEO',
        numFaces: 1,
      });
    }

    (async () => {
      try {
        const det = await build('GPU');
        if (!cancelled) { detectorRef.current = det; setDetectorReady(true); }
      } catch {
        try {
          const det = await build('CPU');
          if (!cancelled) { detectorRef.current = det; setDetectorReady(true); }
        } catch {
          if (!cancelled)
            setDetectorError('顔検出モデルの読み込みに失敗しました。ページを再読み込みしてください。');
        }
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // ── モード切り替え（VIDEO ↔ IMAGE）──────────────────────────
  const ensureMode = useCallback(async (mode: 'VIDEO' | 'IMAGE') => {
    const det = detectorRef.current;
    if (!det || detectorModeRef.current === mode) return;
    await det.setOptions({ runningMode: mode });
    detectorModeRef.current = mode;
  }, []);

  // ── カメラ起動 ────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    if (!detectorRef.current || !videoRef.current) return;
    setCameraError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('このブラウザはカメラに対応していません');
      return;
    }

    try {
      await ensureMode('VIDEO');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setStreamActive(true);
    } catch (e) {
      const err = e as DOMException;
      setCameraError(
        err.name === 'NotAllowedError'
          ? 'カメラへのアクセスを許可してください'
          : 'カメラの起動に失敗しました',
      );
    }
  }, [ensureMode]);

  // ── カメラ停止 ────────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStreamActive(false);
  }, []);

  // ── 検出ループ（カメラ用）────────────────────────────────────
  useEffect(() => {
    if (tab !== 'camera' || !detectorReady || !streamActive) return;

    let frameId: number;
    const loop = (ts: number) => {
      const video = videoRef.current;
      const det   = detectorRef.current;
      if (video && det && video.readyState >= 2 && !video.paused) {
        try {
          const result = det.detectForVideo(video, ts);
          setFaceData(extractFaceData(result));
        } catch {
          // 単発フレームエラーは無視
        }
      }
      frameId = requestAnimationFrame(loop);
    };

    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, [tab, detectorReady, streamActive]);

  // ── タブ切り替え ──────────────────────────────────────────────
  useEffect(() => {
    if (tab === 'camera') {
      setUploadedImageUrl(null);
      setFaceData({ hasFace: false });
      if (detectorReady) startCamera();
    } else {
      stopCamera();
      setFaceData({ hasFace: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // デテクター準備完了時にカメラを起動
  useEffect(() => {
    if (detectorReady && tab === 'camera') startCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectorReady]);

  // アンマウント時クリーンアップ
  useEffect(() => () => { stopCamera(); }, [stopCamera]);

  // ── 画像アップロード ──────────────────────────────────────────
  const handleFileChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !detectorRef.current) return;
      e.target.value = ''; // 同一ファイル再選択を可能に

      const reader = new FileReader();
      reader.onload = async (ev) => {
        const dataUrl = ev.target?.result as string;
        setUploadedImageUrl(dataUrl);
        setFaceData({ hasFace: false });

        await ensureMode('IMAGE');

        const img = new Image();
        img.onload = () => {
          try {
            const result = detectorRef.current.detect(img);
            setFaceData(extractFaceData(result));
          } catch (err) {
            console.error('Face detection error:', err);
          }
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    },
    [ensureMode],
  );

  // ── スコア ────────────────────────────────────────────────────
  const scores = calcTotalScore(faceData, retouchLevel, lightLevel);
  const rank   = getRank(scores.total);

  const totalColor =
    scores.total >= 80 ? 'text-yellow-600' :
    scores.total >= 60 ? 'text-green-600'  :
    scores.total >= 40 ? 'text-orange-500' : 'text-red-500';

  // ── レンダリング ──────────────────────────────────────────────
  return (
    <div className="pb-10">
      {/* ヘッダー */}
      <header className="bg-gradient-to-r from-pink-400 to-rose-400 text-white px-4 py-3 shadow">
        <h1 className="text-lg font-bold tracking-wide">盛れカルテ</h1>
        <p className="text-xs text-pink-100">自撮りスコアリング Web Demo（MediaPipe）</p>
      </header>

      {/* 初期化バナー */}
      {!detectorReady && !detectorError && (
        <div className="bg-pink-50 border-b border-pink-100 px-4 py-2 text-xs text-pink-600 flex items-center gap-2">
          <span className="inline-block animate-spin">⏳</span>
          顔検出モデルを読み込んでいます…（初回は数秒かかります）
        </div>
      )}
      {detectorError && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2 text-xs text-red-600">
          ⚠️ {detectorError}
        </div>
      )}

      {/* タブ */}
      <div className="flex bg-white border-b border-gray-200">
        {(['camera', 'upload'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
              tab === t
                ? 'text-pink-600 border-b-2 border-pink-500'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'camera' ? '📷 カメラ' : '🖼️ 画像アップロード'}
          </button>
        ))}
      </div>

      {/* カメラエリア */}
      {tab === 'camera' && (
        <div className="relative bg-black" style={{ aspectRatio: '4/3' }}>
          {/* style で鏡像表示（検出は元フレームで実行）*/}
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            style={{ transform: 'scaleX(-1)' }}
            muted
            playsInline
          />
          {!streamActive && !cameraError && (
            <div className="absolute inset-0 flex items-center justify-center text-white text-sm opacity-80">
              {detectorReady ? 'カメラを起動中…' : 'モデル読み込み中…'}
            </div>
          )}
          {cameraError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 bg-black/70">
              <p className="text-white text-sm text-center">{cameraError}</p>
              <button
                onClick={startCamera}
                className="bg-pink-500 hover:bg-pink-600 text-white px-5 py-2 rounded-full text-sm"
              >
                再試行
              </button>
            </div>
          )}
          {faceData.hasFace && (
            <span className="absolute top-2 right-2 bg-green-500/90 text-white text-xs px-2 py-0.5 rounded-full">
              顔検出中
            </span>
          )}
        </div>
      )}

      {/* アップロードエリア */}
      {tab === 'upload' && (
        <div className="bg-gray-50">
          {uploadedImageUrl ? (
            <div className="relative">
              {/* next/image は data URL に未対応のため <img> を使用 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={uploadedImageUrl}
                alt="アップロード画像"
                className="w-full max-h-72 object-contain bg-black"
              />
              <span className={`absolute top-2 right-2 text-white text-xs px-2 py-0.5 rounded-full ${
                faceData.hasFace ? 'bg-green-500/90' : 'bg-gray-500/80'
              }`}>
                {faceData.hasFace ? '顔検出済み' : '顔が見つかりません'}
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-14 px-4 text-gray-400">
              <div className="text-5xl mb-3">🤳</div>
              <p className="text-sm">自撮り写真をアップロードしてください</p>
            </div>
          )}
          <div className="p-3">
            <label className={`block w-full text-center py-2.5 rounded-full text-sm font-semibold transition-colors ${
              detectorReady
                ? 'bg-pink-500 hover:bg-pink-600 active:bg-pink-700 text-white cursor-pointer'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}>
              {uploadedImageUrl ? '別の写真を選ぶ' : '写真を選ぶ'}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
                disabled={!detectorReady}
              />
            </label>
          </div>
        </div>
      )}

      {/* スコアパネル */}
      <div className="bg-white px-4 pt-4 pb-3">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1">
            <p className="text-xs text-gray-400 mb-0.5">盛れスコア</p>
            <div className="flex items-end gap-1">
              <span className={`text-4xl font-black leading-none ${totalColor}`}>
                {Math.round(scores.total)}
              </span>
              <span className="text-sm text-gray-400 pb-0.5">/100</span>
            </div>
          </div>
          <div className={`w-14 h-14 rounded-full bg-gradient-to-br ${RANK_GRAD[rank] ?? RANK_GRAD.E} flex items-center justify-center shadow`}>
            <span className="text-white text-xl font-black">{rank}</span>
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            faceData.hasFace ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'
          }`}>
            {faceData.hasFace ? '顔あり' : '顔なし'}
          </span>
        </div>

        <div className="space-y-2">
          <ScoreBar label="構図整合性" score={scores.composition} max={40} color="bg-blue-400" />
          <ScoreBar label="光の質"     score={scores.light}        max={25} color="bg-yellow-400" />
          <ScoreBar label="加工適正度" score={scores.retouching}   max={20} color="bg-pink-400" />
          <ScoreBar label="表情"       score={scores.expression}   max={15} color="bg-green-400" />
        </div>
      </div>

      {/* 自己申告セレクタ */}
      <div className="bg-white border-t border-gray-100 px-4 py-3">
        <Selector
          label="加工度（自己申告）"
          options={RETOUCH_LABELS}
          selected={retouchLevel}
          onSelect={setRetouchLevel}
        />
        {RETOUCH_WARN[retouchLevel] && (
          <p className="text-xs text-red-500 -mt-1 mb-2">
            ⚠️ 加工しすぎは「写真詐欺」リスクあり（パネルマジック注意）
          </p>
        )}
        <Selector
          label="光の状態（自己申告）"
          options={LIGHT_LABELS}
          selected={lightLevel}
          onSelect={setLightLevel}
        />
      </div>

      {/* アドバイス */}
      {scores.advice.length > 0 && (
        <div className="mx-4 mt-3 bg-amber-50 border border-amber-200 rounded-xl p-3">
          <p className="text-xs font-semibold text-amber-700 mb-1.5">アドバイス</p>
          <ul className="space-y-1">
            {scores.advice.map((a, i) => (
              <li key={i} className="text-xs text-gray-700 flex gap-1.5">
                <span className="text-amber-500 mt-0.5 flex-shrink-0">•</span>
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 生データ（折りたたみ）*/}
      <div className="px-4 mt-3">
        <button
          onClick={() => setShowRaw(!showRaw)}
          className="w-full text-xs text-gray-400 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
        >
          {showRaw ? '▲ 生データを隠す' : '▼ 生データ（検出値）を表示'}
        </button>

        {showRaw && (
          <div className="mt-2 bg-gray-50 rounded-lg p-3 text-xs font-mono text-gray-600 space-y-0.5 overflow-x-auto">
            <p>顔検出: {faceData.hasFace ? 'あり' : 'なし'}</p>
            {faceData.hasFace && (
              <>
                <p>bounds  w={faceData.bounds?.width.toFixed(3)} h={faceData.bounds?.height.toFixed(3)}</p>
                <p>roll角  {faceData.rollAngle?.toFixed(2)}°</p>
                <p>笑顔度  {faceData.smileScore?.toFixed(3)}</p>
                <p>開眼度  {faceData.eyeOpenScore?.toFixed(3)}</p>
                <p>口角Y差 {faceData.mouthCornerDiffY?.toFixed(4)} (正規化)</p>
                <p>目Y差   {faceData.eyeDiffY?.toFixed(4)} (正規化)</p>
                <p>ランドマーク数 {faceData.landmarkCount}</p>
              </>
            )}
          </div>
        )}
      </div>

      <p className="text-center text-xs text-gray-300 mt-8 pb-4">盛れカルテ Web Demo — PoC版</p>
    </div>
  );
}

function ScoreBar({
  label,
  score,
  max,
  color,
}: {
  label: string;
  score: number;
  max: number;
  color: string;
}) {
  const pct = Math.min(100, (score / max) * 100);
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-600 w-20 flex-shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-gray-500 w-10 text-right flex-shrink-0">
        {Math.round(score)}/{max}
      </span>
    </div>
  );
}

function Selector({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: string[];
  selected: number;
  onSelect: (i: number) => void;
}) {
  return (
    <div className="mb-2">
      <p className="text-xs text-gray-500 mb-1.5">{label}</p>
      <div className="flex gap-1">
        {options.map((opt, i) => (
          <button
            key={i}
            onClick={() => onSelect(i)}
            className={`flex-1 py-1.5 text-xs rounded-full border transition-colors ${
              selected === i
                ? 'bg-pink-500 border-pink-500 text-white font-semibold'
                : 'bg-white border-gray-200 text-gray-600 hover:border-pink-300'
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}
