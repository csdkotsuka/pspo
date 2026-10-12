# ☁️ Cloudflare Workers + KV によるお気に入り同期ガイド

Firebaseを使わず、**Cloudflareの無料枠（完全無料）**だけでデバイス間のお気に入りを同期するための軽量バックエンドです。

---

## 🌟 なぜCloudflare KV（またはD1）が最適なのか？
- **Firebaseのような面倒な認証（Auth）が不要**: 6桁の同期コード（例: `7K9B2F`）だけで安全かつ手軽にデバイス間共有ができます。
- **完全無料枠が巨大**:
  - KV: 毎日100,000回の読み取り、1,000回の書き込みが無料。
  - D1 (SQL): 毎日500万回の行読み取りが無料。
- **超高速**: 世界300都市以上のエッジで即座に応答します。

---

## 🚀 デプロイ手順（3分で完了）

### 方法1: Cloudflareダッシュボードから手動作成（一番簡単）
1. [Cloudflare ダッシュボード](https://dash.cloudflare.com/) にログイン。
2. 左メニュー「**Workers & Pages**」➔「**KV**」で `FAVS_KV` という名前のNamespaceを作成。
3. 「**Workers**」➔「**作成**」で新しいWorkerを作成し、`worker.js` のコードをそのまま貼り付け。
4. Workerの設定「**変数**」➔「**KV ネームスペースのバインド**」で、変数名を `FAVS_KV`、ネームスペースを先ほど作った `FAVS_KV` に指定して保存・デプロイ！

### 方法2: Wrangler CLIを使う場合
```bash
cd cloudflare
npm install -g wrangler
wrangler login

# 1. KVネームスペース作成
wrangler kv:namespace create FAVS_KV
# 表示されたIDを wrangler.toml の id に記入

# 2. デプロイ
wrangler deploy
```

---

## 📱 Webアプリ側との連携方法
発行されたWorkerのURL（例: `https://pspo-sync-worker.xxxx.workers.dev`）を、`js/app.js` の `CLOUDFLARE_SYNC_API_URL` に設定するだけで、同期コードでの保存・読み込みが自動的に連動します。
（※Worker未デプロイの状態でも、Webアプリ標準機能の「**📷 QRコード同期**」「**📋 URL共有**」により、今すぐ100%デバイス間引き継ぎが可能です！）
