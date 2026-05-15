# 間取り図 3Dビジュアライザー

間取り図をアップロードしてAIで解析、3D表示・手動編集して共有URLを発行するWebアプリです。

## 機能

- 間取り図（PNG/JPG）をドラッグ&ドロップでアップロード
- Claude AIが部屋の配置を自動解析し3D表示
- 部屋の名前・サイズ・位置をリアルタイム編集
- 3Dビューア上でドラッグ移動
- 保存して共有URLを発行（認証不要）
- スマホ対応（タッチ操作・ピンチズーム）

## セットアップ

### 1. Supabaseプロジェクト作成

1. [Supabase](https://supabase.com) にアクセスしてアカウント作成
2. 「New project」からプロジェクトを作成
3. Settingsページで `URL` と `anon key` を取得

### 2. DBテーブル作成

Supabase Dashboard の SQL Editor で以下を実行：

```sql
CREATE TABLE models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rooms JSONB NOT NULL,
  image_url TEXT,
  note TEXT,
  created_at TIMESTAMP DEFAULT now()
);
```

Row Level Security（RLS）ポリシーを追加：

```sql
ALTER TABLE models ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read" ON models FOR SELECT USING (true);
CREATE POLICY "Public insert" ON models FOR INSERT WITH CHECK (true);
```

### 3. Storageバケット作成

1. Supabase Dashboard → Storage → 「New bucket」
2. バケット名：`floorplan-images`
3. 「Public bucket」にチェックを入れて作成
4. Policiesタブで以下を追加：

```sql
CREATE POLICY "Public upload" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'floorplan-images');
CREATE POLICY "Public read" ON storage.objects FOR SELECT USING (bucket_id = 'floorplan-images');
```

### 4. 環境変数の設定

`.env.local.example` を `.env.local` にコピーして値を設定：

```bash
cp .env.local.example .env.local
```

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
ANTHROPIC_API_KEY=sk-ant-...
```

| 変数名 | 取得場所 |
|--------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon/public key |
| `ANTHROPIC_API_KEY` | [Anthropic Console](https://console.anthropic.com) → API Keys |

### 5. ローカル開発

```bash
npm install
npm run dev
```

`http://localhost:3000` でアクセス

## Vercelデプロイ

1. GitHubにリポジトリをプッシュ
2. [Vercel](https://vercel.com) にアクセスし「Add New Project」
3. GitHubリポジトリを選択してインポート
4. **Environment Variables** に以下を追加：
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `ANTHROPIC_API_KEY`
5. 「Deploy」をクリック

> `ANTHROPIC_API_KEY` はサーバーサイドのみで使用されます。  
> `NEXT_PUBLIC_` プレフィックスの変数はクライアントにも公開されますが、Supabaseの anon key は RLS で保護されるため問題ありません。

## 技術スタック

- **フレームワーク**: Next.js 14（App Router）
- **3D描画**: Three.js
- **AI解析**: Anthropic SDK（claude-sonnet-4-20250514）
- **DB/Storage**: Supabase（PostgreSQL + Storage）
- **スタイル**: Tailwind CSS
- **デプロイ**: Vercel
