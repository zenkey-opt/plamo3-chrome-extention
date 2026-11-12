# Store listing タブと Distribution タブ

## manifest から入る項目

ダッシュボードでは変えられません。変えるときは manifest を直し、バージョンを上げた ZIP をアップロードします。

| 項目 | 値 |
| --- | --- |
| 名前 | PLaMo 3 Translate Local |
| 概要 | PLaMo 3 Translate をブラウザの中で動かして、選択テキスト・ページ・入力文を翻訳する非公式の拡張機能です。原文を外部に送りません。Built with PLaMo |

## Store listing タブ

| 項目 | 値 |
| --- | --- |
| Description | 下の「説明」の枠の中をそのまま貼ります |
| Category | Tools |
| Language | 日本語 |
| Store icon | `extension/icons/icon128.png` |
| Screenshots | `images/1-selection.png` から `images/5-options.png` までの 5 枚を番号の順に |
| Small promo tile | `images/promo-440x280.png` |
| Homepage URL | https://github.com/zenkey-opt/plamo3-chrome-extention |
| Support URL | https://github.com/zenkey-opt/plamo3-chrome-extention/issues |
| Mature content | オフ |

Marquee promo tile と YouTube の動画は任意なので、用意していません。カテゴリは、ストアにある PLaMo の拡張機能がどれも Tools に入っているのに合わせました。

### スクリーンショット

| ファイル | 写っているもの |
| --- | --- |
| `1-selection.png` | 選んだ段落の下に出た訳文のカード |
| `2-page.png` | ページの文章を訳文に置き換えたところ |
| `3-bilingual.png` | 原文と訳文を並べたところ |
| `4-popup.png` | ツールバーのポップアップで、入力した文を訳したところ |
| `5-options.png` | モデルをダウンロードする前に、ライセンスの要点を示した設定画面 |

撮影には `demo/article.html` を使いました。英文はこのリポジトリのために書いたもので、サイトの名前とリンクは架空です。ポップアップはページとは別のウィンドウに開くので、`4-popup.png` はポップアップの画像をページの画像に重ねて作っています。カードとポップアップに出ている秒数と tok/s は、RTX 2080 SUPER で 2B のモデルを使った 1 回の値です。

### 説明

```text
Preferred Networks がオープンウェイトで公開した翻訳用の言語モデル PLaMo 3 Translate を、ブラウザの中で動かして翻訳する拡張機能です。翻訳は PC の中で行い、翻訳する文章を外部のサーバーに送りません。

■ できること
・選択したテキストを翻訳：右クリックの「PLaMo で翻訳」か Alt+T で、選んだ文の近くに訳文を出します。
・ページを翻訳：Alt+P かポップアップのボタンで、ページの文章を訳文に置き換えます。原文と訳文を並べる表示も選べます。リンク、太字、コードなどはそのまま残り、「原文に戻す」で元のページに戻ります。
・入力した文を翻訳：ツールバーのアイコンを押して文を入力すると、入力が止まったところで翻訳します。
・外国語のページを開いたときに、翻訳するか尋ねたり、自動で翻訳したりできます。設定で選んだときだけ動き、そのときにすべてのサイトへのアクセスの許可を求めます。
・原文が日本語なら英語に、それ以外は日本語に訳します。訳す先は 53 言語から選べます。文体と用語集も設定できます。

■ 必要なもの
・Chrome 137 以降。chrome://gpu で WebGPU が Hardware accelerated になっていること
・VRAM：2B のモデルで約 2.1 GB、0.8B のモデルで約 0.6 GB
・保存領域：2B のモデルで 1.81 GB、0.8B のモデルで 573 MB

■ はじめに
モデルは拡張機能に含まれていません。インストールすると設定画面が開きます。使うモデルの「ダウンロード」を押し、PLaMo コミュニティライセンス契約の要点を読んで同意すると、Hugging Face にある Preferred Networks の公式リポジトリからダウンロードします。モデルは拡張機能専用の保存領域に置き、拡張機能を削除すると一緒に消えます。

■ 通信とデータ
通信するのは、モデルを Hugging Face からダウンロードするときだけです。翻訳する文章、ページの内容、設定は PC の外に送りません。詳しくはプライバシーポリシーをご覧ください。
https://github.com/zenkey-opt/plamo3-chrome-extention/blob/master/PRIVACY.md

■ ライセンス
Built with PLaMo
翻訳モデルは株式会社 Preferred Networks の PLaMo 3 Translate で、PLaMo コミュニティライセンス契約で公開されています。私的使用と学術用途は無償で、登録も要りません。事業での利用など商業目的で使うには、PFN への事前の登録などの条件があります。契約の要点と全文は、設定画面の「ライセンス」から読めます。
この拡張機能は個人が開発した非公式のもので、Preferred Networks が提供、承認、保証しているものではありません。「PLaMo」は株式会社 Preferred Networks の商標です。

ソースコード：https://github.com/zenkey-opt/plamo3-chrome-extention
```

## Distribution タブ

| 項目 | 値 |
| --- | --- |
| In-app purchases | なし |
| Visibility | Public。公開の前に自分で確かめるなら Unlisted か Private |
| Regions | All regions |
