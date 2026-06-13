type Lm = { x: number; y: number; z: number };
type Pt = { x: number; y: number };

// Key landmark indices from the 478-point MediaPipe face mesh
export const KEY_LM_INDICES = [
  // Left eye  (positions 0-3 in keyLandmarks array)
  33, 133, 159, 145,
  // Right eye (positions 4-7)
  362, 263, 386, 374,
  // Eyebrows
  70, 107, 336, 296,
  // Nose (tip, bridge, bottom, L/R nostril)
  4, 168, 2, 98, 327,
  // Mouth (L corner, R corner, upper center, lower center)
  61, 291, 13, 14,
  // Chin
  152,
  // Face contour (L edge, R edge, forehead, L/R lower cheek)
  234, 454, 10, 93, 323,
] as const;

// Indices *within* the keyLandmarks array used as normalization reference
const IDX_LEFT_EYE_OUTER  = 0; // original landmark 33
const IDX_RIGHT_EYE_OUTER = 4; // original landmark 362

function normalize(keyLms: Lm[]): Pt[] | null {
  if (keyLms.length < KEY_LM_INDICES.length) return null;
  const le  = keyLms[IDX_LEFT_EYE_OUTER];
  const re  = keyLms[IDX_RIGHT_EYE_OUTER];
  const ipd = Math.hypot(re.x - le.x, re.y - le.y);
  if (ipd < 1e-6) return null;
  const cx = (le.x + re.x) / 2;
  const cy = (le.y + re.y) / 2;
  return keyLms.map((lm) => ({
    x: (lm.x - cx) / ipd,
    y: (lm.y - cy) / ipd,
  }));
}

export function averageBaseline(samples: Lm[][]): Lm[] | null {
  if (!samples.length) return null;
  const k   = samples[0].length;
  const avg = samples[0].map(() => ({ x: 0, y: 0, z: 0 }));
  for (const s of samples) {
    for (let i = 0; i < k; i++) {
      avg[i].x += s[i].x;
      avg[i].y += s[i].y;
      avg[i].z += s[i].z;
    }
  }
  const n = samples.length;
  return avg.map((p) => ({ x: p.x / n, y: p.y / n, z: p.z / n }));
}

// Returns 0 (no change) – 100 (very different)
export function calcChangeScore(current: Lm[], baseline: Lm[]): number | null {
  const cur = normalize(current);
  const bas = normalize(baseline);
  if (!cur || !bas) return null;
  let sumSq = 0;
  for (let i = 0; i < cur.length; i++) {
    const dx = cur[i].x - bas[i].x;
    const dy = cur[i].y - bas[i].y;
    sumSq += dx * dx + dy * dy;
  }
  const rmse = Math.sqrt(sumSq / cur.length);
  // RMSE is in IPD units; scale empirically (0.00 → 0, ~0.29 → 100)
  return Math.min(100, Math.round(rmse * 350));
}
