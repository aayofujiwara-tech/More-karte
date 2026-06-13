import dynamic from 'next/dynamic';

const FaceScorer = dynamic(() => import('@/components/FaceScorer'), {
  ssr: false,
  loading: () => (
    <div className="flex flex-col items-center justify-center min-h-screen gap-3 text-pink-400">
      <span className="text-4xl animate-spin">⏳</span>
      <p className="text-sm">アプリを読み込み中…</p>
    </div>
  ),
});

export default function Home() {
  return (
    <main className="max-w-md mx-auto">
      <FaceScorer />
    </main>
  );
}
