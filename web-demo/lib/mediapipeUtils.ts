import type { FaceData } from './scoring';

// MediaPipe Face Landmarker 478点メッシュのキーランドマーク
const LM = {
  MOUTH_LEFT:      61,
  MOUTH_RIGHT:     291,
  LEFT_EYE_OUTER:  33,
  LEFT_EYE_INNER:  133,
  LEFT_EYE_TOP:    159,
  LEFT_EYE_BOTTOM: 145,
  RIGHT_EYE_OUTER: 362,
  RIGHT_EYE_INNER: 263,
  RIGHT_EYE_TOP:   386,
  RIGHT_EYE_BOTTOM:374,
} as const;

type Landmark = { x: number; y: number; z: number };

export function extractFaceData(result: {
  faceLandmarks?: Landmark[][];
  faceBlendshapes?: { categories: { categoryName: string; score: number }[] }[];
}): FaceData {
  if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
    return { hasFace: false };
  }

  const lms = result.faceLandmarks[0];
  if (lms.length < 400) return { hasFace: false };

  // バウンディングボックスを全ランドマークから算出（正規化 0-1 座標）
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const lm of lms) {
    if (lm.x < minX) minX = lm.x;
    if (lm.x > maxX) maxX = lm.x;
    if (lm.y < minY) minY = lm.y;
    if (lm.y > maxY) maxY = lm.y;
  }
  const bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  const faceH = bounds.height;

  // 左右対称性（顔の高さで正規化）
  const ml = lms[LM.MOUTH_LEFT];
  const mr = lms[LM.MOUTH_RIGHT];
  const le = lms[LM.LEFT_EYE_OUTER];
  const re = lms[LM.RIGHT_EYE_OUTER];

  const mouthCornerDiffY = faceH > 0 ? Math.abs(ml.y - mr.y) / faceH : undefined;
  const eyeDiffY         = faceH > 0 ? Math.abs(le.y - re.y) / faceH : undefined;

  // ロール角（度）= 左右の目の傾き
  const rollAngle = Math.atan2(re.y - le.y, re.x - le.x) * (180 / Math.PI);

  // 表情: ブレンドシェイプ優先、なければ EAR ベースのフォールバック
  let smileScore:   number | undefined;
  let eyeOpenScore: number | undefined;

  if (result.faceBlendshapes && result.faceBlendshapes.length > 0) {
    const cats = result.faceBlendshapes[0].categories;
    const find = (name: string) =>
      cats.find((c) => c.categoryName === name)?.score ?? 0;

    smileScore   = (find('mouthSmileLeft') + find('mouthSmileRight')) / 2;
    eyeOpenScore = 1 - (find('eyeBlinkLeft') + find('eyeBlinkRight')) / 2;
  } else {
    // EAR フォールバック
    const leTop = lms[LM.LEFT_EYE_TOP],  leBot = lms[LM.LEFT_EYE_BOTTOM];
    const leOut = lms[LM.LEFT_EYE_OUTER], leIn  = lms[LM.LEFT_EYE_INNER];
    const reTop = lms[LM.RIGHT_EYE_TOP],  reBot = lms[LM.RIGHT_EYE_BOTTOM];
    const reOut = lms[LM.RIGHT_EYE_OUTER],reIn  = lms[LM.RIGHT_EYE_INNER];

    const leftEAR  = Math.abs(leTop.y - leBot.y) / (Math.abs(leOut.x - leIn.x) + 1e-6);
    const rightEAR = Math.abs(reTop.y - reBot.y) / (Math.abs(reOut.x - reIn.x) + 1e-6);
    eyeOpenScore = Math.min(1, (leftEAR + rightEAR) / 2 / 0.25);

    // 口角の高さ vs. 顔中央を笑顔の近似値として利用
    const mouthCenterY = (ml.y + mr.y) / 2;
    const noseRoot = lms[168]; // 眉間あたり
    const relativeDrop = faceH > 0 ? (mouthCenterY - noseRoot.y) / faceH : 0.5;
    smileScore = Math.max(0, Math.min(1, (relativeDrop - 0.35) * 5));
  }

  return {
    hasFace: true,
    bounds,
    rollAngle,
    smileScore,
    eyeOpenScore,
    mouthCornerDiffY,
    eyeDiffY,
    landmarkCount: lms.length,
  };
}
