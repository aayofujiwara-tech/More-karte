# 盛れカルテ 技術検証プロジェクト（PoC）

## 目的

スコアリングロジックの確定を待たず、「顔検出ライブラリから何が取得できるか」を確認する。
評価ロジック（重み付け・正面/斜めの扱いなど）が決まっていなくても進められる範囲。

## 確認するデータ

- `landmarks`：目・耳・鼻・頬・口などの座標一覧（どのキーが取れるか）
- `contours`：顔・目・眉・唇などの輪郭点（どのキーが取れるか）
- `headEulerAngleX/Y/Z`（pitch/yaw/roll）：参考値として記録するのみ。スコアの主軸にはしない
- `leftEyeOpenProbability` / `rightEyeOpenProbability`：開眼度
- `smilingProbability`：笑顔度
- `bounds`：顔の画面占有率算出用
- 左右の口角・目のY座標差分：左右対称性評価の検証用に簡易計算

## セットアップ手順

### 1. 前提

- Node.js（LTS推奨）
- iOS実機/Macでビルドする場合: Xcode, CocoaPods
- Android実機/エミュレータでビルドする場合: Android Studio

### 2. プロジェクト作成

このプロジェクト一式（package.json, app.json, babel.config.js, App.tsx）を
新規ディレクトリに配置するか、以下で新規作成して上書きする。

```bash
npx create-expo-app@latest morekarte-poc --template blank-typescript
cd morekarte-poc
```

その後、本プロジェクトの package.json の dependencies / devDependencies、
app.json、babel.config.js、App.tsx の内容で上書き。

### 3. 依存パッケージのインストール

```bash
npm install
# または
npx expo install react-native-vision-camera react-native-vision-camera-face-detector @shopify/react-native-skia react-native-worklets-core react-native-reanimated
```

### 4. ネイティブプロジェクトの生成（prebuild）

Expo Goでは動作しない（カメラ・顔検出はネイティブモジュール）ため、
Dev Clientとしてビルドする。

```bash
npx expo prebuild
```

### 5. 実機ビルド・起動

#### Android
```bash
npx expo run:android
```

#### iOS（Macが必要）
```bash
npx expo run:ios
```

初回はCocoaPodsのインストールに時間がかかる場合がある。
エラーが出た場合は `cd ios && pod install` を試す。

## 確認項目チェックリスト

実機（フロントカメラ）で顔を映し、画面下部のオーバーレイに以下が表示されることを確認:

- [ ] 顔検出: あり / なし が切り替わる
- [ ] 角度（pitch/yaw/roll）が数値として表示される
- [ ] 開眼度・笑顔度が0〜1の範囲で表示される
- [ ] landmarksのキー一覧に MOUTH_LEFT, MOUTH_RIGHT, LEFT_EYE, RIGHT_EYE などが含まれる
- [ ] contoursのキー一覧に FACE, UPPER_LIP_TOP などが含まれる
- [ ] 口角・目の高さ差分が数値として表示される
- [ ] iOS / Android 両方でビルドが通る

## 確認後のフィードバック観点

- 正面を向いた状態と、横を向いた状態で、口角・目の高さ差分の値はどう変化するか
- 顔のサイズ（カメラからの距離）を変えたとき、boundsの値はどう変化するか（画面占有率の計算に使えるか）
- 笑顔度・開眼度は、実際の表情の変化に対して感覚的に納得感のある値が出るか

## 既知の注意点

- 上記のプロパティ名（landmarks.MOUTH_LEFT など）はライブラリのバージョンによって
  キー名や構造が異なる可能性がある。実際に取得した `rawLog`（生データ）の表示内容を見て、
  正しいキー名に読み替えること。
- iOS側のビルドはCocoaPods関連のエラーが出やすいポイント。エラーメッセージをそのまま
  共有してもらえれば対処方針を一緒に考える。
