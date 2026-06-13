import dynamic from 'next/dynamic';

// MediaPipe と camera API はブラウザ限定のため SSR を無効化
const FaceScorer = dynamic(() => import('@/components/FaceScorer'), { ssr: false });

export default function Home() {
  return (
    <main className="max-w-md mx-auto">
      <FaceScorer />
    </main>
  );
}
