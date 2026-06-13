import type { FaceData } from './scoring';

export type DominantFaceResult = {
  dominant: 'left' | 'right' | 'balanced';
  leftScore: number;
  rightScore: number;
  advice: string;
  detail: string[];
};

export function calcDominantFace(data: FaceData): DominantFaceResult | null {
  if (!data.hasFace) return null;

  let leftScore  = 50;
  let rightScore = 50;
  const detail: string[] = [];

  // 目の開き（EAR）比較
  if (data.leftEAR != null && data.rightEAR != null) {
    const diff = data.leftEAR - data.rightEAR;
    if (Math.abs(diff) > 0.015) {
      const pts = Math.min(15, Math.abs(diff) * 200);
      if (diff > 0) {
        leftScore  += pts;
        detail.push('左目がやや大きく開いている');
      } else {
        rightScore += pts;
        detail.push('右目がやや大きく開いている');
      }
    }
  }

  // 口角の上がり比較（blendshape）
  if (data.leftSmile != null && data.rightSmile != null) {
    const diff = data.leftSmile - data.rightSmile;
    if (Math.abs(diff) > 0.04) {
      const pts = Math.min(15, Math.abs(diff) * 150);
      if (diff > 0) {
        leftScore  += pts;
        detail.push('左の口角がやや上がっている');
      } else {
        rightScore += pts;
        detail.push('右の口角がやや上がっている');
      }
    }
  }

  const diff = Math.abs(leftScore - rightScore);
  const dominant: 'left' | 'right' | 'balanced' =
    diff < 4 ? 'balanced' : leftScore > rightScore ? 'left' : 'right';

  let advice: string;
  switch (dominant) {
    case 'left':
      advice = '左顔が利き顔の可能性があります。自撮り時は左側をカメラに向けると写りやすい傾向があります。';
      break;
    case 'right':
      advice = '右顔が利き顔の可能性があります。自撮り時は右側をカメラに向けると写りやすい傾向があります。';
      break;
    default:
      advice = '左右のバランスが良好です。どちらの角度でもバランスよく盛れます！';
  }

  if (detail.length === 0) {
    detail.push('大きな左右差は検出されませんでした');
  }

  return {
    dominant,
    leftScore:  Math.round(leftScore),
    rightScore: Math.round(rightScore),
    advice,
    detail,
  };
}
