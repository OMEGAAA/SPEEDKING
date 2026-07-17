# SPEEDKING

GitHub Pages 上で動作するランキングアプリです。Cloud Firestore を使うと、同じ URL を開いた複数端末でランキングがリアルタイム同期されます。

## Firebase の初期設定

1. [Firebase コンソール](https://console.firebase.google.com/)でプロジェクトを作成します。
2. プロジェクトに Web アプリを追加し、表示された `firebaseConfig` の値を `firebase-config.js` に設定します。
3. 「Authentication」→「Sign-in method」で「匿名」を有効にします。
4. 「Firestore Database」でデータベースを作成します。本番環境モードを選択してください。
5. Firestore の「ルール」に `firestore.rules` の内容を貼り付けて公開します。
6. 変更を GitHub へ push し、GitHub Pages の反映後にページを開きます。

画面上部が「リアルタイム同期中」になれば接続完了です。旧版の `localStorage` にランキングが残っている端末では、初回接続時にそのデータを Firestore へ自動移行します。

## セキュリティ上の仕様

ランキングの読み取りは公開です。登録と削除には Firebase 匿名認証が必要で、登録値は Firestore Security Rules で検証されます。現状の画面仕様に合わせ、ページを開ける利用者は全記録を削除できます。管理者だけに削除を許可したい場合は、管理者ログインと権限ルールを追加してください。
