# Cloud SQL 初期化

Cloud SQL の PostgreSQL インスタンス作成後、ローカルから Cloud SQL Auth Proxy を起動し、次で初期化します。

```bash
psql "$DATABASE_URL" -f infra/database/001_initial.sql
```

このスキーマはユーザーIDを Firebase UID に固定し、すべての API クエリで `user_id` 条件を必須にする前提です。
