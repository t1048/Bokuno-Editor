# Bokuno-Editor

Tauri、React、CodeMirrorで構築された軽量なクロスプラットフォーム対応デスクトップコードエディタです。

## 機能

- **多言語サポート** - JavaScript、Markdown、Python、Rust
- **シンタックスハイライト** - CodeMirror 6を採用
- **ダークテーマ** - One Darkテーマ搭載
- **検索機能** - 置換付きのコード検索
- **デスクトップネイティブ** - Tauriによるネイティブパフォーマンス

## 技術スタック

- **フロントエンド**: React 19 + TypeScript + Vite
- **エディタ**: CodeMirror 6
- **バックエンド**: Tauri 2 (Rust)
- **スタイリング**: Tailwind CSS

## はじめに

### 前提条件

- Node.js 18以上
- Rust（最新安定版）
- npm または pnpm

### インストール

```bash
# 依存関係をインストール
npm install

# 開発モードで実行
npm run tauri dev

# 本番ビルド
npm run tauri build
```

## スクリーンショット

![Bokuno-Editor](src/assets/hero.png)

## ライセンス

MIT
