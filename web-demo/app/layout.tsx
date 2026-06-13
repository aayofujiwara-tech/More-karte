import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '盛れカルテ Web Demo',
  description: '自撮りスコアリング PoC（ブラウザ版）',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="bg-gradient-to-b from-pink-50 to-white min-h-screen">
        {children}
      </body>
    </html>
  );
}
