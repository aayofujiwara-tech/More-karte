'use client';

import {
  useState, useEffect, useRef, useCallback, type ChangeEvent,
} from 'react';
import { extractFaceData } from '@/lib/mediapipeUtils';
import {
  calcTotalScore, getRank,
  RETOUCH_LABELS, RETOUCH_WARN, LIGHT_LABELS,
  type FaceData,
} from '@/lib/scoring';
import { calcDominantFace } from '@/lib/dominantFace';

const WASM_URL  = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

type Mode      = 'score' | 'dominant' | 'angle';
type InputType = 'camera' | 'upload';

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
  const [detectorReady, setDetectorReady] = useState(false);
  const [detectorError, setDetectorError] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const detectorRef     = useRef<any>(null);
  const detectorModeRef = useRef<'VIDEO' | 'IMAGE'>('VIDEO');

  const [mode,         setMode]         = useState<Mode>('score');
  const [inputType,    setInputType]    = useState<InputType>('camera');
  const [faceData,     setFaceData]     = useState<FaceData>({ hasFace: false });
  const [retouchLevel, setRetouchLevel] = useState(2);
  const [lightLevel,   setLightLevel]   = useState(3);
  const [showRaw,      setShowRaw]      = useState(false);

  const videoRef     = useRef<HTMLVideoElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const streamRef    = useRef<MediaStream | null>(null);
  const [streamActive, setStreamActive] = useState(false);
  const [cameraError,  setCameraError]  = useState<string | null>(null);

  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);

  const needsCamera = mode !== 'score' || inputType === 'camera';

  // MediaPipe 初期化
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

  const ensureMode = useCallback(async (m: 'VIDEO' | 'IMAGE') => {
    const det = detectorRef.current;
    if (!det || detectorModeRef.current === m) return;
    await det.setOptions({ runningMode: m });
    detectorModeRef.current = m;
  }, []);

  const startCamera = useCallback(async () => {
    if (!detectorRef.current || !videoRef.current) return;
    if (streamRef.current) return; // 既に起動中
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

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStreamActive(false);
  }, []);

  // 検出ループ
  useEffect(() => {
    const nc = mode !== 'score' || inputType === 'camera';
    if (!nc || !detectorReady || !streamActive) return;

    let frameId: number;
    const loop = (ts: number) => {
      const video  = videoRef.current;
      const det    = detectorRef.current;
      const canvas = canvasRef.current;
      if (video && det && video.readyState >= 2 && !video.paused) {
        try {
          const result = det.detectForVideo(video, ts);
          const fd = extractFaceData(result);
          setFaceData(fd);
          if (mode === 'angle' && canvas) {
            if (canvas.width !== (video.videoWidth || 640))
              canvas.width = video.videoWidth || 640;
            if (canvas.height !== (video.videoHeight || 480))
              canvas.height = video.videoHeight || 480;
            drawAngleOverlay(canvas, fd);
          }
        } catch {
          /* 単発フレームエラーは無視 */
        }
      }
      frameId = requestAnimationFrame(loop);
    };
    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, [mode, inputType, detectorReady, streamActive]);

  // モード / inputType 切替
  useEffect(() => {
    const nc = mode !== 'score' || inputType === 'camera';
    if (nc) {
      setUploadedImageUrl(null);
      setFaceData({ hasFace: false });
      if (detectorReady) startCamera();
    } else {
      stopCamera();
      setFaceData({ hasFace: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, inputType]);

  // デテクター準備完了時
  useEffect(() => {
    if (detectorReady && needsCamera) startCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectorReady]);

  useEffect(() => () => { stopCamera(); }, [stopCamera]);

  // 画像アップロード
  const handleFileChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !detectorRef.current) return;
      e.target.value = '';
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

  const scores          = calcTotalScore(faceData, retouchLevel, lightLevel);
  const rank            = getRank(scores.total);
  const dominantResult  = calcDominantFace(faceData);
  const showVideoArea   = mode !== 'score' || inputType === 'camera';

  const totalColor =
    scores.total >= 80 ? 'text-yellow-600' :
    scores.total >= 60 ? 'text-green-600'  :
    scores.total >= 40 ? 'text-orange-500' : 'text-red-500';

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

      {/* メインモードタブ */}
      <div className="flex bg-white border-b border-gray-200">
        {([
          ['score',    '📊 スコア診断'],
          ['dominant', '✨ 利き顔チェック'],
          ['angle',    '📐 角度モード'],
        ] as [Mode, string][]).map(([m, label]) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
              mode === m
                ? 'text-pink-600 border-b-2 border-pink-500'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* スコアモード: カメラ/アップロード サブタブ */}
      {mode === 'score' && (
        <div className="flex bg-white border-b border-gray-100">
          {([['camera', '📷 カメラ'], ['upload', '🖼️ アップロード']] as [InputType, string][]).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setInputType(t)}
              className={`flex-1 py-2 text-xs font-medium transition-colors ${
                inputType === t
                  ? 'text-rose-500 border-b-2 border-rose-400'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* 映像エリア */}
      {showVideoArea && (
        <div className="relative bg-black" style={{ aspectRatio: '4/3' }}>
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            style={{ transform: 'scaleX(-1)' }}
            muted
            playsInline
          />
          {mode === 'angle' && (
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full pointer-events-none"
              style={{ transform: 'scaleX(-1)' }}
            />
          )}
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

      {/* アップロードエリア（スコアモードのみ）*/}
      {mode === 'score' && inputType === 'upload' && (
        <div className="bg-gray-50">
          {uploadedImageUrl ? (
            <div className="relative">
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
                type="file" accept="image/*" className="hidden"
                onChange={handleFileChange} disabled={!detectorReady}
              />
            </label>
          </div>
        </div>
      )}

      {/* ══ スコア診断パネル ══ */}
      {mode === 'score' && (
        <>
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
                    <p>pitch角 {faceData.pitchAngle?.toFixed(2)}°</p>
                    <p>yaw角   {faceData.yawAngle?.toFixed(2)}°</p>
                    <p>笑顔度  {faceData.smileScore?.toFixed(3)}</p>
                    <p>開眼度  {faceData.eyeOpenScore?.toFixed(3)}</p>
                    <p>左EAR   {faceData.leftEAR?.toFixed(3)}</p>
                    <p>右EAR   {faceData.rightEAR?.toFixed(3)}</p>
                    <p>左smile {faceData.leftSmile?.toFixed(3)}</p>
                    <p>右smile {faceData.rightSmile?.toFixed(3)}</p>
                    <p>ランドマーク数 {faceData.landmarkCount}</p>
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* ══ 利き顔チェックパネル ══ */}
      {mode === 'dominant' && (
        <div className="px-4 pt-4 space-y-3">
          {!faceData.hasFace ? (
            <div className="bg-pink-50 rounded-xl p-6 text-center">
              <p className="text-4xl mb-2">👤</p>
              <p className="text-sm text-pink-400">顔をカメラに映してください</p>
            </div>
          ) : dominantResult ? (
            <>
              <div className={`rounded-xl p-5 text-center ${
                dominantResult.dominant === 'balanced' ? 'bg-purple-50' :
                dominantResult.dominant === 'left'     ? 'bg-pink-50'   : 'bg-rose-50'
              }`}>
                <p className="text-2xl font-black mb-2">
                  {dominantResult.dominant === 'balanced' ? '⚖️ 両面均等'
                   : dominantResult.dominant === 'left'   ? '← 左顔が利き顔'
                   :                                        '右顔が利き顔 →'}
                </p>
                <p className="text-xs text-gray-600 leading-relaxed">{dominantResult.advice}</p>
              </div>

              <div className="bg-white rounded-xl p-4 space-y-3">
                <p className="text-xs font-semibold text-gray-500">顔スコア比較</p>
                {[
                  { label: '左顔', score: dominantResult.leftScore,  color: 'from-pink-400 to-rose-400' },
                  { label: '右顔', score: dominantResult.rightScore, color: 'from-purple-400 to-blue-400' },
                ].map(({ label, score, color }) => (
                  <div key={label} className="flex gap-2 items-center">
                    <span className="text-xs text-gray-500 w-8 text-right">{label}</span>
                    <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full bg-gradient-to-r ${color} rounded-full transition-all duration-500`}
                        style={{ width: `${score}%` }}
                      />
                    </div>
                    <span className="text-xs font-bold text-gray-600 w-7 text-right">{score}</span>
                  </div>
                ))}
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                <p className="text-xs font-semibold text-amber-700 mb-1.5">検出内容</p>
                <ul className="space-y-1">
                  {dominantResult.detail.map((d, i) => (
                    <li key={i} className="text-xs text-gray-700 flex gap-1.5">
                      <span className="text-amber-400 flex-shrink-0">•</span>{d}
                    </li>
                  ))}
                </ul>
              </div>

              <p className="text-xs text-gray-400 text-center px-2 pb-2">
                ※この判定は顔の微細な非対称性をもとにした参考値です。様々な角度で撮影して確認してみてください。
              </p>
            </>
          ) : null}
        </div>
      )}

      {/* ══ 角度モードパネル ══ */}
      {mode === 'angle' && (
        <div className="px-4 pt-4 space-y-3">
          {!faceData.hasFace ? (
            <div className="bg-blue-50 rounded-xl p-6 text-center">
              <p className="text-4xl mb-2">📐</p>
              <p className="text-sm text-blue-400">顔をカメラに映してください</p>
              <p className="text-xs text-gray-400 mt-2">グリッド線は三分割法のガイドです</p>
            </div>
          ) : (
            <>
              <div className="bg-white rounded-xl p-4 grid grid-cols-3 gap-3">
                {([
                  { label: 'Roll（傾き）',   value: faceData.rollAngle,  good: 10 },
                  { label: 'Yaw（左右）',    value: faceData.yawAngle,   good: 15 },
                  { label: 'Pitch（上下）',  value: faceData.pitchAngle, good: 20 },
                ] as { label: string; value?: number; good: number }[]).map(({ label, value, good }) => {
                  const v = value ?? 0;
                  const ok = Math.abs(v) <= good;
                  return (
                    <div key={label} className="text-center">
                      <p className="text-xs text-gray-400 mb-1">{label}</p>
                      <p className={`text-xl font-black ${ok ? 'text-green-500' : 'text-orange-500'}`}>
                        {v > 0 ? '+' : ''}{v.toFixed(1)}°
                      </p>
                      <p className={`text-xs mt-0.5 ${ok ? 'text-green-400' : 'text-orange-400'}`}>
                        {ok ? '良好' : '要確認'}
                      </p>
                    </div>
                  );
                })}
              </div>

              {faceData.bounds && (
                <div className="bg-white rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-gray-500">顔の画面占有率</p>
                    <span className="text-xs font-bold text-gray-600">
                      {(faceData.bounds.width * faceData.bounds.height * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-blue-400 to-cyan-400 rounded-full transition-all"
                      style={{ width: `${Math.min(100, faceData.bounds.width * faceData.bounds.height * 350)}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">推奨: 10〜35%程度</p>
                </div>
              )}

              {(() => {
                const tips = getAngleTips(faceData);
                return tips.length === 0 ? (
                  <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                    <p className="text-green-600 font-semibold text-sm">いい感じです！</p>
                    <p className="text-xs text-green-400 mt-0.5">角度・位置ともにバランスが取れています</p>
                  </div>
                ) : (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                    <p className="text-xs font-semibold text-blue-700 mb-1.5">ガイド</p>
                    <ul className="space-y-1">
                      {tips.map((tip, i) => (
                        <li key={i} className="text-xs text-gray-700 flex gap-1.5">
                          <span className="text-blue-400 flex-shrink-0">•</span>{tip}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })()}

              <p className="text-xs text-gray-400 text-center pb-2">
                ※グリッドの交点（三分割法）付近に顔を配置するとバランスが取れます
              </p>
            </>
          )}
        </div>
      )}

      <p className="text-center text-xs text-gray-300 mt-8 pb-4">盛れカルテ Web Demo — PoC版</p>
    </div>
  );
}

// ─── Canvas描画 ────────────────────────────────────────────

function drawRulesGrid(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width: w, height: h } = canvas;

  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 6]);
  for (const frac of [1 / 3, 2 / 3]) {
    ctx.beginPath(); ctx.moveTo(0, h * frac);   ctx.lineTo(w, h * frac);   ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w * frac, 0);   ctx.lineTo(w * frac, h);   ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 2;
  for (const xf of [1 / 3, 2 / 3]) {
    for (const yf of [1 / 3, 2 / 3]) {
      ctx.beginPath();
      ctx.arc(w * xf, h * yf, 7, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

function drawAngleOverlay(canvas: HTMLCanvasElement, fd: FaceData) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);
  drawRulesGrid(canvas);

  if (!fd.hasFace || !fd.bounds) return;

  const cx = (fd.bounds.x + fd.bounds.width  / 2) * w;
  const cy = (fd.bounds.y + fd.bounds.height / 2) * h;

  ctx.strokeStyle = 'rgba(255, 80, 130, 0.9)';
  ctx.lineWidth = 2.5;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(cx, cy, 14, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 20, cy); ctx.lineTo(cx + 20, cy); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy - 20); ctx.lineTo(cx, cy + 20); ctx.stroke();
}

// ─── 角度アドバイス ─────────────────────────────────────────

function getAngleTips(fd: FaceData): string[] {
  const tips: string[] = [];
  const roll  = fd.rollAngle  ?? 0;
  const yaw   = fd.yawAngle   ?? 0;
  const pitch = fd.pitchAngle ?? 0;

  if (Math.abs(roll) > 20)
    tips.push('カメラの傾きが大きめです。水平に近づけるとすっきりした印象になります');
  else if (Math.abs(roll) > 10)
    tips.push('ほんの少しカメラが傾いています');

  if (Math.abs(yaw) > 25)
    tips.push('横を向きすぎかもしれません。少し正面寄りにするとバランスが取れます');

  if (pitch > 20)
    tips.push('少し下を向くと自然な表情になりやすいです');
  else if (pitch < -15)
    tips.push('カメラを少し上げると顔がシャープに見えやすいです（やや見上げる角度がおすすめ）');

  if (fd.bounds) {
    const area = fd.bounds.width * fd.bounds.height;
    if (area < 0.06)
      tips.push('もう少しカメラに近づいてみましょう');
    else if (area > 0.40)
      tips.push('少し離れると全体のバランスが取りやすくなります');

    const cx = fd.bounds.x + fd.bounds.width  / 2;
    const cy = fd.bounds.y + fd.bounds.height / 2;
    let minDist = Infinity;
    for (const xf of [1 / 3, 2 / 3]) {
      for (const yf of [1 / 3, 2 / 3]) {
        const d = Math.hypot(cx - xf, cy - yf);
        if (d < minDist) minDist = d;
      }
    }
    if (minDist > 0.15)
      tips.push('三分割法のグリッド交点付近に顔を合わせると映えやすくなります');
  }

  return tips;
}

// ─── サブコンポーネント ─────────────────────────────────────

function ScoreBar({ label, score, max, color }: {
  label: string; score: number; max: number; color: string;
}) {
  const pct = Math.min(100, (score / max) * 100);
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-600 w-20 flex-shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-300 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-500 w-10 text-right flex-shrink-0">{Math.round(score)}/{max}</span>
    </div>
  );
}

function Selector({ label, options, selected, onSelect }: {
  label: string; options: string[]; selected: number; onSelect: (i: number) => void;
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
