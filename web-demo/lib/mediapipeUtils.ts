import type { FaceData } from './scoring';

const LM = {
  MOUTH_LEFT:       61,
  MOUTH_RIGHT:      291,
  LEFT_EYE_OUTER:   33,
  LEFT_EYE_INNER:   133,
  LEFT_EYE_TOP:     159,
  LEFT_EYE_BOTTOM:  145,
  RIGHT_EYE_OUTER:  362,
  RIGHT_EYE_INNER:  263,
  RIGHT_EYE_TOP:    386,
  RIGHT_EYE_BOTTOM: 374,
  NOSE_TIP:         4,
  LEFT_FACE_EDGE:   234,
  RIGHT_FACE_EDGE:  454,
  CHIN:             152,
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

  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const lm of lms) {
    if (lm.x < minX) minX = lm.x;
    if (lm.x > maxX) maxX = lm.x;
    if (lm.y < minY) minY = lm.y;
    if (lm.y > maxY) maxY = lm.y;
  }
  const bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  const faceH = bounds.height;

  const ml = lms[LM.MOUTH_LEFT];
  const mr = lms[LM.MOUTH_RIGHT];
  const le = lms[LM.LEFT_EYE_OUTER];
  const re = lms[LM.RIGHT_EYE_OUTER];

  const mouthCornerDiffY = faceH > 0 ? Math.abs(ml.y - mr.y) / faceH : undefined;
  const eyeDiffY         = faceH > 0 ? Math.abs(le.y - re.y) / faceH : undefined;
  const rollAngle        = Math.atan2(re.y - le.y, re.x - le.x) * (180 / Math.PI);

  // Yaw: 左右顔端から鼻先の距離比
  const noseTip   = lms[LM.NOSE_TIP];
  const leftEdge  = lms[LM.LEFT_FACE_EDGE];
  const rightEdge = lms[LM.RIGHT_FACE_EDGE];
  const totalW    = rightEdge.x - leftEdge.x;
  const leftDist  = noseTip.x - leftEdge.x;
  const rightDist = rightEdge.x - noseTip.x;
  const yawAngle  = totalW > 0 ? ((rightDist - leftDist) / totalW) * 45 : 0;

  // Pitch: 鼻先の目-顎間での相対位置（正=上向き）
  const chin     = lms[LM.CHIN];
  const eyeMidY  = (le.y + re.y) / 2;
  const eyeChinH = chin.y - eyeMidY;
  const noseRelY = eyeChinH > 0 ? (noseTip.y - eyeMidY) / eyeChinH : 0.40;
  const pitchAngle = (noseRelY - 0.40) * -120;

  // EAR per eye
  const leTop = lms[LM.LEFT_EYE_TOP],   leBot = lms[LM.LEFT_EYE_BOTTOM];
  const leOut = lms[LM.LEFT_EYE_OUTER], leIn  = lms[LM.LEFT_EYE_INNER];
  const reTop = lms[LM.RIGHT_EYE_TOP],  reBot = lms[LM.RIGHT_EYE_BOTTOM];
  const reOut = lms[LM.RIGHT_EYE_OUTER],reIn  = lms[LM.RIGHT_EYE_INNER];

  const leftEAR  = Math.abs(leTop.y - leBot.y) / (Math.abs(leOut.x - leIn.x) + 1e-6);
  const rightEAR = Math.abs(reTop.y - reBot.y) / (Math.abs(reOut.x - reIn.x) + 1e-6);

  let smileScore:   number | undefined;
  let eyeOpenScore: number | undefined;
  let leftSmile:    number | undefined;
  let rightSmile:   number | undefined;

  if (result.faceBlendshapes && result.faceBlendshapes.length > 0) {
    const cats = result.faceBlendshapes[0].categories;
    const find = (name: string) =>
      cats.find((c) => c.categoryName === name)?.score ?? 0;

    leftSmile    = find('mouthSmileLeft');
    rightSmile   = find('mouthSmileRight');
    smileScore   = (leftSmile + rightSmile) / 2;
    eyeOpenScore = 1 - (find('eyeBlinkLeft') + find('eyeBlinkRight')) / 2;
  } else {
    eyeOpenScore = Math.min(1, (leftEAR + rightEAR) / 2 / 0.25);
    const mouthCenterY = (ml.y + mr.y) / 2;
    const noseRoot = lms[168];
    const relativeDrop = faceH > 0 ? (mouthCenterY - noseRoot.y) / faceH : 0.5;
    smileScore = Math.max(0, Math.min(1, (relativeDrop - 0.35) * 5));
  }

  return {
    hasFace: true,
    bounds,
    rollAngle,
    pitchAngle,
    yawAngle,
    smileScore,
    eyeOpenScore,
    mouthCornerDiffY,
    eyeDiffY,
    landmarkCount: lms.length,
    leftEAR,
    rightEAR,
    leftSmile,
    rightSmile,
  };
}
