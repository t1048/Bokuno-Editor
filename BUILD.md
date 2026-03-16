# Bokuno-Editor ビルド手順書

## 概要

このドキュメントでは、「僕の考えた最強のテキストエディタ」のビルド手順を説明します。

## 必要な環境

### 必須ソフトウェア

| ソフトウェア | バージョン | 確認コマンド |
|------------|-----------|-------------|
| Node.js | v18.0.0 以上 | `node --version` |
| npm | v9.0.0 以上 | `npm --version` |
| Rust | v1.70.0 以上 | `rustc --version` |
| Cargo | v1.70.0 以上 | `cargo --version` |

### Windows固有の要件

- Windows 10 以上
- Visual Studio 2019 以降（または Build Tools for Visual Studio）
- WebView2 ランタイム（Windows 10/11には標準搭載）

## プロジェクト構造

```
Bokuno-Editor/
├── src/                    # React フロントエンドソース
│   ├── components/         # Reactコンポーネント
│   ├── App.tsx            # メインアプリケーション
│   ├── App.css            # アプリケーションスタイル
│   ├── index.css          # グローバルスタイル
│   └── main.tsx           # エントリーポイント
├── src-tauri/             # Rust バックエンドソース
│   ├── src/
│   │   └── lib.rs         # Rustコアロジック
│   ├── Cargo.toml         # Rust依存関係
│   └── tauri.conf.json    # Tauri設定
├── dist/                  # ビルド出力（フロントエンド）
├── package.json           # Node.js依存関係
└── vite.config.ts         # Vite設定
```

## ビルド手順

### 1. 依存関係のインストール

```bash
# Node.js依存関係のインストール
npm install

# Tauri CLIのインストール（グローバル）
npm install -g @tauri-apps/cli
```

### 2. 開発モードでの実行

開発中はホットリロード付きでアプリケーションを実行できます：

```bash
# フロントエンドとバックエンドを同時に起動
npm run tauri dev
```

または

```bash
# フロントエンドのみ（Vite開発サーバー）
npm run dev

# 別ターミナルでRustバックエンド
npm run tauri dev
```

### 3. フロントエンドのみのビルド

```bash
# TypeScriptのコンパイルとViteビルド
npm run build
```

ビルド成果物は `dist/` ディレクトリに出力されます。

### 4. Rustバックエンドのビルド

```bash
cd src-tauri

# デバッグビルド
cargo build

# リリースビルド（最適化済み）
cargo build --release
```

`src-tauri/target/debug/app.exe` を直接実行する場合は、必ず先に `npm run build` で `dist/` を生成してください。

推奨手順：

```bash
# プロジェクトルートでフロントエンドをビルド
npm run build

# Rustデバッグビルド
cd src-tauri
cargo build

# 直接起動
./target/debug/app.exe
```

### 5. アプリケーションのパッケージング

#### Windowsインストーラーの作成

```bash
# NSISインストーラーの作成
npm run tauri build -- --target nsis

# MSIインストーラーの作成
npm run tauri build -- --target msi

# 両方作成
npm run tauri build
```

ビルド成果物の場所：
- `src-tauri/target/release/bundle/nsis/`
- `src-tauri/target/release/bundle/msi/`

## コマンド一覧

| コマンド | 説明 |
|---------|------|
| `npm run dev` | Vite開発サーバーの起動 |
| `npm run build` | フロントエンドの本番ビルド |
| `npm run preview` | 本番ビルドのプレビュー |
| `npm run tauri dev` | Tauriアプリの開発モード実行 |
| `npm run tauri build` | Tauriアプリの本番ビルド |
| `cargo build` | Rustのデバッグビルド |
| `cargo build --release` | Rustのリリースビルド |

## トラブルシューティング

### ビルドエラー：Rustコンパイルエラー

```bash
# Rustツールチェーンの更新
rustup update

# 依存関係のクリーン
rm -rf src-tauri/target
```

### ビルドエラー：Node.jsモジュールエラー

```bash
# node_modulesの削除と再インストール
rm -rf node_modules package-lock.json
npm install
```

### ビルドエラー：WebView2関連

WindowsでWebView2ランタイムが見つからない場合：

1. [WebView2ランタイム](https://developer.microsoft.com/ja-jp/microsoft-edge/webview2/)をダウンロード
2. Evergreen Standalone Installerを実行

### パッケージングエラー：WiXツールセット

MSIビルドに失敗する場合：

```bash
# WiXツールセットのインストール（Windows）
# https://wixtoolset.org/releases/ からダウンロード
```

## 設定ファイル

### tauri.conf.json

主要な設定項目：

```json
{
  "productName": "Bokuno-Editor",
  "version": "0.1.0",
  "identifier": "com.bokuno-Editor.app",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:5173"
  },
  "app": {
    "windows": [
      {
        "title": "Bokuno-Editor",
        "width": 1200,
        "height": 800
      }
    ]
  }
}
```

### Cargo.toml

Rust依存関係の管理：

```toml
[dependencies]
tauri = { version = "2.10.3" }
ignore = "0.4"      # 高速検索用
regex = "1.10"      # 正規表現検索用
tokio = { version = "1.35", features = ["rt-multi-thread", "fs"] }
```

## パフォーマンス最適化

### リリースビルドの最適化

`src-tauri/Cargo.toml`に以下を追加：

```toml
[profile.release]
panic = "abort"
codegen-units = 1
lto = true
opt-level = 3
strip = true
```

### バイナリサイズの削減

```bash
# UPXによる圧縮（オプション）
upx --best src-tauri/target/release/bundle/nsis/*.exe
```

## 配布用アーカイブの作成

```bash
# Windows用ZIPアーカイブ
cd src-tauri/target/release
zip -r ../../../Bokuno-Editor-windows.zip Bokuno-Editor.exe

# インストーラー付きZIP
cd src-tauri/target/release/bundle
zip -r ../../../Bokuno-Editor-installer.zip nsis/*.exe msi/*.msi
```

## 開発ワークフロー

1. **コード編集**: `src/` および `src-tauri/src/` のファイルを編集
2. **開発サーバー**: `npm run tauri dev` で変更を確認
3. **ビルドテスト**: `npm run build` でフロントエンドビルドを確認
4. **リリースビルド**: `npm run tauri build` でインストーラーを作成
5. **テスト**: 作成したインストーラーで動作確認

## 参考リンク

- [Tauri Documentation](https://tauri.app/v1/guides/)
- [Vite Documentation](https://vitejs.dev/guide/)
- [Rust Documentation](https://www.rust-lang.org/learn)
- [CodeMirror 6 Documentation](https://codemirror.net/docs/)

---

**最終更新**: 2025年3月16日
