export type FaceData = {
  hasFace: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
  rollAngle?: number;
  pitchAngle?: number;        // 度: 正=上向き, 負=下向き
  yawAngle?: number;          // 度: 正=右向き, 負=左向き
  smileScore?: number;
  eyeOpenScore?: number;
  mouthCornerDiffY?: number;
  eyeDiffY?: number;
  landmarkCount?: number;
  leftEAR?: number;
  rightEAR?: number;
  leftSmile?: number;
  rightSmile?: number;
};

export type ScoreResult = {
  composition: number;    // /40
  light: number;          // /25
  retouching: number;     // /20
  expression: number;     // /15
  total: number;          // /100
  advice: string[];
  retouchWarning: boolean;
};

// 加工度：山型評価（普通=最高点、強烈=大幅減点＋警告）
export const RETOUCH_LABELS = ['なし', '軽め', '普通', '強め', '強烈'];
export const RETOUCH_SCORES = [8, 16, 20, 14, 4];
export const RETOUCH_WARN   = [false, false, false, false, true];

// 光の質：自己申告の5段階
export const LIGHT_LABELS = ['暗い', 'やや暗い', '普通', '明るい', '最高'];
export const LIGHT_SCORES  = [5, 12, 18, 22, 25];

// ── 構図整合性（40点）──────────────────────────────────────────
// 方針: 絶対角度を正解とする評価は行わない。
//       技術的失敗（画面占有率の異常・左右非対称・極端な傾き）のみ減点。
export function calcCompositionScore(data: FaceData): { score: number; advice: string[] } {
  if (!data.hasFace || !data.bounds) return { score: 0, advice: [] };

  const advice: string[] = [];
  let score = 40;

  // 顔の画面占有率（bounds は 0-1 正規化座標）
  const area = data.bounds.width * data.bounds.height;
  if (area < 0.04) {
    score -= 15;
    advice.push('もう少し近づいて撮影してみましょう');
  } else if (area > 0.45) {
    score -= 10;
    advice.push('少し離れると全体のバランスが良くなります');
  }

  // 左右対称性（顔の高さで正規化済みの差分を使用）
  if (data.mouthCornerDiffY != null && data.eyeDiffY != null) {
    const asymmetry = (data.mouthCornerDiffY + data.eyeDiffY) / 2;
    if (asymmetry > 0.12) {
      score -= 12;
      advice.push('水平を保って撮影するとより整った印象になります');
    } else if (asymmetry > 0.06) {
      score -= 5;
    }
  }

  // ロール角（極端な傾きのみ減点）
  if (data.rollAngle != null) {
    const roll = Math.abs(data.rollAngle);
    if (roll > 30) {
      score -= 10;
      advice.push('カメラの傾きを抑えると安定した構図になります');
    } else if (roll > 15) {
      score -= 5;
    }
  }

  return { score: Math.max(0, Math.min(40, score)), advice };
}

// ── 表情（15点）────────────────────────────────────────────────
export function calcExpressionScore(data: FaceData): { score: number; advice: string[] } {
  if (!data.hasFace) return { score: 0, advice: [] };

  const advice: string[] = [];
  const smile   = data.smileScore   ?? 0;
  const eyeOpen = data.eyeOpenScore ?? 0.5;

  // 笑顔 0-10pt + 開眼 0-5pt
  const score = Math.min(15, smile * 10 + eyeOpen * 5);

  if (smile < 0.3)   advice.push('もう少し笑顔にするとより魅力的に見えます');
  if (eyeOpen < 0.4) advice.push('目をしっかり開いて撮ってみましょう');

  return { score, advice };
}

// ── 合計スコア計算 ───────────────────────────────────────────
export function calcTotalScore(
  faceData: FaceData,
  retouchLevel: number,
  lightLevel: number
): ScoreResult {
  const comp  = calcCompositionScore(faceData);
  const expr  = calcExpressionScore(faceData);
  const rs    = RETOUCH_SCORES[retouchLevel] ?? 0;
  const ls    = LIGHT_SCORES[lightLevel]     ?? 0;

  return {
    composition:    comp.score,
    light:          ls,
    retouching:     rs,
    expression:     expr.score,
    total:          comp.score + ls + rs + expr.score,
    advice:         [...comp.advice, ...expr.advice],
    retouchWarning: RETOUCH_WARN[retouchLevel] ?? false,
  };
}

export function getRank(total: number): string {
  if (total >= 90) return 'SS';
  if (total >= 80) return 'S';
  if (total >= 70) return 'A';
  if (total >= 60) return 'B';
  if (total >= 50) return 'C';
  if (total >= 40) return 'D';
  return 'E';
}
