import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Button,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import {
  useFaceDetector,
  FaceDetectionOptions,
} from 'react-native-vision-camera-face-detector';
import { useRunOnJS } from 'react-native-worklets-core';

// 検証目的：顔検出データからスコアリングロジックを試算
// 構図整合性(40)・光の質(25)・加工適正度(20)・表情(15) の4軸

const faceDetectionOptions: FaceDetectionOptions = {
  performanceMode: 'accurate',
  landmarkMode: 'all',
  contourMode: 'all',
  classificationMode: 'all',
  trackingEnabled: false,
  windowWidth: 1,
  windowHeight: 1,
};

type FaceSummary = {
  hasFace: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
  headEulerAngleX?: number;
  headEulerAngleY?: number;
  headEulerAngleZ?: number;
  leftEyeOpenProbability?: number;
  rightEyeOpenProbability?: number;
  smilingProbability?: number;
  landmarkKeys?: string[];
  contourKeys?: string[];
  mouthCornerDiffY?: number;
  eyeDiffY?: number;
};

// ---- スコアリングロジック ----

function calcCompositionScore(s: FaceSummary): { score: number; advice: string[] } {
  if (!s.hasFace || !s.bounds) return { score: 0, advice: [] };
  const advice: string[] = [];
  let score = 40;

  // 画面占有率（windowWidth/Height=1 なので bounds は 0〜1 の正規化座標）
  const area = s.bounds.width * s.bounds.height;
  if (area < 0.04) {
    score -= 15;
    advice.push('もう少し近づいて撮影してみましょう');
  } else if (area > 0.45) {
    score -= 10;
    advice.push('少し離れると全体のバランスが良くなります');
  }

  // 左右対称性（口角・目のY座標差分を顔の高さで正規化）
  if (
    s.mouthCornerDiffY != null &&
    s.eyeDiffY != null &&
    s.bounds.height > 0
  ) {
    const mouthNorm = s.mouthCornerDiffY / s.bounds.height;
    const eyeNorm = s.eyeDiffY / s.bounds.height;
    const asymmetry = (mouthNorm + eyeNorm) / 2;
    if (asymmetry > 0.12) {
      score -= 12;
      advice.push('水平を保って撮影するとより整った印象になります');
    } else if (asymmetry > 0.06) {
      score -= 5;
    }
  }

  // ロール角（極端な傾き減点）
  if (s.headEulerAngleZ != null) {
    const roll = Math.abs(s.headEulerAngleZ);
    if (roll > 30) {
      score -= 10;
      advice.push('カメラの傾きを抑えると安定した構図になります');
    } else if (roll > 15) {
      score -= 5;
    }
  }

  return { score: Math.max(0, Math.min(40, score)), advice };
}

function calcExpressionScore(s: FaceSummary): { score: number; advice: string[] } {
  if (!s.hasFace) return { score: 0, advice: [] };
  const advice: string[] = [];

  const smile = s.smilingProbability ?? 0;
  const eyeOpen =
    ((s.leftEyeOpenProbability ?? 0) + (s.rightEyeOpenProbability ?? 0)) / 2;

  // 笑顔度 0〜10pt + 開眼度 0〜5pt
  const score = Math.min(15, smile * 10 + eyeOpen * 5);

  if (smile < 0.3) advice.push('もう少し笑顔にするとより魅力的に見えます');
  if (eyeOpen < 0.5) advice.push('目をしっかり開いて撮ってみましょう');

  return { score, advice };
}

// 加工度：適正範囲に山型。「強烈」はパネルマジック警告
const RETOUCH_LABELS = ['なし', '軽め', '普通', '強め', '強烈'];
const RETOUCH_SCORES = [8, 16, 20, 14, 4];
const RETOUCH_WARN = [false, false, false, false, true];

// 光の質：自己申告の5段階
const LIGHT_LABELS = ['暗い', 'やや暗い', '普通', '明るい', '最高'];
const LIGHT_SCORES = [5, 12, 18, 22, 25];

function getRank(total: number): string {
  if (total >= 90) return 'SS';
  if (total >= 80) return 'S';
  if (total >= 70) return 'A';
  if (total >= 60) return 'B';
  if (total >= 50) return 'C';
  if (total >= 40) return 'D';
  return 'E';
}

function getRankColor(total: number): string {
  if (total >= 80) return '#FFB300';
  if (total >= 60) return '#43A047';
  if (total >= 40) return '#FB8C00';
  return '#E53935';
}

// ---- コンポーネント ----

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
  const pct = Math.min(1, score / max);
  return (
    <View style={bar.row}>
      <Text style={bar.label}>{label}</Text>
      <View style={bar.track}>
        <View
          style={[bar.fill, { width: `${pct * 100}%` as any, backgroundColor: color }]}
        />
      </View>
      <Text style={bar.value}>
        {score.toFixed(0)}/{max}
      </Text>
    </View>
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
    <>
      <Text style={s.selectorLabel}>{label}</Text>
      <View style={s.selectorRow}>
        {options.map((opt, i) => (
          <TouchableOpacity
            key={i}
            style={[s.selectorBtn, selected === i && s.selectorBtnActive]}
            onPress={() => onSelect(i)}
          >
            <Text
              style={[s.selectorBtnText, selected === i && s.selectorBtnTextActive]}
            >
              {opt}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </>
  );
}

export default function App() {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('front');
  const { detectFaces } = useFaceDetector(faceDetectionOptions);

  const [summary, setSummary] = useState<FaceSummary>({ hasFace: false });
  const [rawLog, setRawLog] = useState('');
  const [retouchLevel, setRetouchLevel] = useState(2);
  const [lightLevel, setLightLevel] = useState(3);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission]);

  const updateSummary = useRunOnJS((faceJson: string) => {
    try {
      const faces = JSON.parse(faceJson);
      if (!faces || faces.length === 0) {
        setSummary({ hasFace: false });
        setRawLog('顔が検出されていません');
        return;
      }
      const face = faces[0];
      const landmarks = face.landmarks || {};
      const contours = face.contours || {};

      let mouthCornerDiffY: number | undefined;
      let eyeDiffY: number | undefined;
      if (landmarks.MOUTH_LEFT && landmarks.MOUTH_RIGHT) {
        mouthCornerDiffY = Math.abs(landmarks.MOUTH_LEFT.y - landmarks.MOUTH_RIGHT.y);
      }
      if (landmarks.LEFT_EYE && landmarks.RIGHT_EYE) {
        eyeDiffY = Math.abs(landmarks.LEFT_EYE.y - landmarks.RIGHT_EYE.y);
      }

      setSummary({
        hasFace: true,
        bounds: face.bounds,
        headEulerAngleX: face.pitchAngle ?? face.headEulerAngleX,
        headEulerAngleY: face.yawAngle ?? face.headEulerAngleY,
        headEulerAngleZ: face.rollAngle ?? face.headEulerAngleZ,
        leftEyeOpenProbability: face.leftEyeOpenProbability,
        rightEyeOpenProbability: face.rightEyeOpenProbability,
        smilingProbability: face.smilingProbability,
        landmarkKeys: Object.keys(landmarks),
        contourKeys: Object.keys(contours),
        mouthCornerDiffY,
        eyeDiffY,
      });
      setRawLog(JSON.stringify(face, null, 2));
    } catch (e) {
      setRawLog('parse error: ' + String(e));
    }
  }, []);

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      const faces = detectFaces(frame);
      updateSummary(JSON.stringify(faces));
    },
    [detectFaces]
  );

  // スコア計算
  const compResult = calcCompositionScore(summary);
  const exprResult = calcExpressionScore(summary);
  const retouchScore = RETOUCH_SCORES[retouchLevel];
  const retouchWarn = RETOUCH_WARN[retouchLevel];
  const lightScore = LIGHT_SCORES[lightLevel];
  const total = compResult.score + lightScore + retouchScore + exprResult.score;
  const allAdvice = [...compResult.advice, ...exprResult.advice];
  const rank = getRank(total);
  const rankColor = getRankColor(total);

  if (!hasPermission) {
    return (
      <View style={s.center}>
        <Text style={s.permText}>カメラ権限が必要です</Text>
        <Button title="権限をリクエスト" onPress={requestPermission} />
      </View>
    );
  }

  if (!device) {
    return (
      <View style={s.center}>
        <Text style={s.permText}>カメラデバイスが見つかりません</Text>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <Camera
        style={s.camera}
        device={device}
        isActive={true}
        frameProcessor={frameProcessor}
      />

      <ScrollView style={s.overlay} contentContainerStyle={s.overlayContent}>
        {/* ヘッダー：合計スコア + ランクバッジ */}
        <View style={s.headerRow}>
          <View style={s.headerLeft}>
            <Text style={s.scoreLabel}>盛れスコア</Text>
            <View style={s.scoreRow}>
              <Text style={[s.scoreNum, { color: rankColor }]}>
                {total.toFixed(0)}
              </Text>
              <Text style={s.scoreMax}>/100</Text>
            </View>
          </View>
          <View style={[s.rankBadge, { backgroundColor: rankColor }]}>
            <Text style={s.rankText}>{rank}</Text>
          </View>
          <Text style={s.faceStatus}>
            {summary.hasFace ? '顔検出中' : '顔を映してください'}
          </Text>
        </View>

        {/* スコアバー */}
        <View style={s.barsWrap}>
          <ScoreBar label="構図整合性" score={compResult.score} max={40} color="#4C9BE8" />
          <ScoreBar label="光の質" score={lightScore} max={25} color="#F5C518" />
          <ScoreBar label="加工適正度" score={retouchScore} max={20} color="#E891B7" />
          <ScoreBar label="表情" score={exprResult.score} max={15} color="#66BB6A" />
        </View>

        {/* 自己申告セレクタ */}
        <Selector
          label="加工度（自己申告）"
          options={RETOUCH_LABELS}
          selected={retouchLevel}
          onSelect={setRetouchLevel}
        />
        {retouchWarn && (
          <Text style={s.warn}>
            加工しすぎは「写真詐欺」のリスクがあります
          </Text>
        )}

        <Selector
          label="光の状態（自己申告）"
          options={LIGHT_LABELS}
          selected={lightLevel}
          onSelect={setLightLevel}
        />

        {/* アドバイス */}
        {allAdvice.length > 0 && (
          <View style={s.adviceBox}>
            <Text style={s.adviceTitle}>アドバイス</Text>
            {allAdvice.map((a, i) => (
              <Text key={i} style={s.adviceItem}>
                {'•'} {a}
              </Text>
            ))}
          </View>
        )}

        {/* 生データ */}
        <TouchableOpacity
          style={s.toggleBtn}
          onPress={() => setShowRaw(!showRaw)}
        >
          <Text style={s.toggleBtnText}>
            {showRaw ? '▲ 生データを隠す' : '▼ 生データを表示'}
          </Text>
        </TouchableOpacity>

        {showRaw && (
          <View>
            <Text style={s.rawSection}>--- 角度（参考値）---</Text>
            <Text style={s.rawText}>
              pitch(X): {summary.headEulerAngleX?.toFixed(2)}
              {'  '}yaw(Y): {summary.headEulerAngleY?.toFixed(2)}
              {'  '}roll(Z): {summary.headEulerAngleZ?.toFixed(2)}
            </Text>
            <Text style={s.rawSection}>--- landmarks ---</Text>
            <Text style={s.rawText}>{summary.landmarkKeys?.join(', ')}</Text>
            <Text style={s.rawSection}>--- contours ---</Text>
            <Text style={s.rawText}>{summary.contourKeys?.join(', ')}</Text>
            <Text style={s.rawSection}>--- 生データ(1件目) ---</Text>
            <Text style={s.rawText}>{rawLog}</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const bar = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginVertical: 2 },
  label: { width: 72, fontSize: 11, color: '#444' },
  track: {
    flex: 1,
    height: 8,
    backgroundColor: '#E0E0E0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 4 },
  value: { width: 38, fontSize: 11, textAlign: 'right', color: '#666' },
});

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  permText: { color: '#fff', marginBottom: 12 },

  overlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: '58%',
    backgroundColor: 'rgba(255,255,255,0.96)',
  },
  overlayContent: { padding: 12, paddingBottom: 24 },

  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  headerLeft: { flex: 1 },
  scoreLabel: { fontSize: 11, color: '#888' },
  scoreRow: { flexDirection: 'row', alignItems: 'flex-end' },
  scoreNum: { fontSize: 30, fontWeight: '700', lineHeight: 34 },
  scoreMax: { fontSize: 14, color: '#888', marginBottom: 2, marginLeft: 2 },
  rankBadge: {
    width: 46,
    height: 46,
    borderRadius: 23,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  rankText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  faceStatus: { fontSize: 10, color: '#777', textAlign: 'right', flexShrink: 1 },

  barsWrap: { marginBottom: 8 },

  selectorLabel: { fontSize: 11, color: '#555', marginTop: 6, marginBottom: 3 },
  selectorRow: { flexDirection: 'row', marginBottom: 2 },
  selectorBtn: {
    flex: 1,
    marginRight: 3,
    paddingVertical: 5,
    borderRadius: 4,
    backgroundColor: '#F0F0F0',
    alignItems: 'center',
  },
  selectorBtnActive: { backgroundColor: '#E891B7' },
  selectorBtnText: { fontSize: 10, color: '#666' },
  selectorBtnTextActive: { color: '#fff', fontWeight: '600' },

  warn: { fontSize: 11, color: '#E53935', marginBottom: 4 },

  adviceBox: {
    backgroundColor: '#FFF8E1',
    padding: 8,
    borderRadius: 6,
    marginTop: 6,
  },
  adviceTitle: { fontSize: 11, fontWeight: '600', color: '#F57F17', marginBottom: 2 },
  adviceItem: { fontSize: 11, color: '#555', lineHeight: 17 },

  toggleBtn: { marginTop: 8, alignItems: 'center', paddingVertical: 4 },
  toggleBtnText: { fontSize: 11, color: '#999' },
  rawSection: { marginTop: 6, fontSize: 11, fontWeight: '500', color: '#555' },
  rawText: { fontSize: 9, fontFamily: 'monospace', color: '#555' },
});
