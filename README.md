# PLaMo 3 Translate Local

Preferred Networks が 2026 年 11 月 5 日にオープンウェイトで公開した翻訳特化 LLM **PLaMo 3 Translate** を、ブラウザの中だけで動かす非公式の Chrome 拡張機能です。
推論は llama.cpp を WebAssembly と WebGPU で動かす [wllama](https://github.com/ngxson/wllama) で行い、サーバーもネイティブアプリも要りません。
原文と訳文は PC の外に出ません。通信するのは、初回にモデルを huggingface.co から取得するときだけです。
動作確認は Brave 1.99、Chromium 157 で行っています。

## できること

| 操作 | 方法 |
| --- | --- |
| 選択テキストを翻訳 | 右クリック「PLaMo で翻訳」、**Alt+T** |
| ページを翻訳、原文に戻す | **Alt+P**、ポップアップ、右クリック、何も選択していないときの Alt+T |
| 入力した文を翻訳 | ツールバーのアイコン。入力が止まると翻訳し、Ctrl+Enter ですぐ翻訳 |
| 外国語のページで翻訳を提案、自動で翻訳 | 設定画面の「外国語のページを開いたとき」 |

- 翻訳の向きは自動です。原文が日本語なら英語へ、それ以外は日本語へ訳します。向きは設定で変えられます。53 言語に対応しています。
- ページ翻訳はリンク・太字・コードなどのインライン要素を保ったまま訳文に置き換えます。ボタンやリンクは元の要素をそのまま使うので、動作も変わりません。「原文に戻す」で DOM が元と完全に一致することを、テストページで確かめています。
- 画面内と少し先だけを順に翻訳し、スクロールや後から追加された内容にも追従します。
- 設定画面で、文体、用語集、ページタイトルを文脈として渡すかどうかを選べます。

## 必要なもの

- Chrome 137 以降、または Brave など Chromium 137 以降のブラウザ。`chrome://gpu` で WebGPU が Hardware accelerated になっていること
- VRAM：2B で約 2.1 GB、0.8B で約 0.6 GB
- 保存領域：2B で 1.81 GB、0.8B で 573 MB。拡張機能専用の領域 OPFS に置き、拡張機能を削除すると一緒に消えます

## セットアップ

1. `chrome://extensions` でデベロッパーモードをオンにし、「パッケージ化されていない拡張機能を読み込む」で `extension` フォルダを選びます。Brave でも同じ URL で開けます。
2. 自動で開く設定画面で、使うモデルの「ダウンロード」を押します。Hugging Face の pfnet 公式リポジトリから一度だけ取得し、途中で止まっても、もう一度押せば続きから再開します。最初のダウンロードの前に、PLaMo コミュニティライセンス契約への同意を求めます。
3. 翻訳するときにモデルを自動で読み込みます。初回は 5〜8 秒かかります。10 分使わなければモデルを解放して VRAM を返します。この時間は設定で変えられます。

拡張 ID は manifest の `key` で `bhkpaambekhpdikhkccbfdappiogpgnc` に固定しています。

## 外国語のページ

設定画面の「外国語のページを開いたとき」で選びます。初期値は「何もしない」です。

- 翻訳するか尋ねる：翻訳先と違う言語のページを開くと、右下に「日本語に翻訳」のボタンを出します。「このサイトでは尋ねない」を押すと、そのサイトを対象外にします。
- 自動で翻訳する：そのようなページを開くと、すぐにページ翻訳を始めます。

次の場合は何もしません。

- バックグラウンドで開いたタブ。表示されたときに判定します
- `translate="no"` や `<meta name="google" content="notranslate">` で翻訳しないよう指定しているページ
- 対象外のサイト。設定画面の一覧で編集でき、ポップアップのチェックボックスでも切り替えられます
- モデルをまだダウンロードしていないとき

ページの言語を調べるには、すべてのサイトで小さなスクリプト `content/detect.js` を動かす必要があります。
そのため、「尋ねる」か「自動」を選んだときに、ブラウザがすべてのサイトへのアクセス許可を求めます。
必須ではない権限なので、インストールのときには求めません。判定はブラウザの中の `chrome.i18n.detectLanguage` で行い、ページの内容は外部に送りません。
「何もしない」に戻すと、この許可も外します。本文の抜き出しと判定にかかった時間は、テストページで 1 ページあたり 1 ms 未満でした。

ページ内の移動だけで中身が入れ替わるサイトでは、最初に開いたときだけ判定します。
ブラウザ自体の翻訳の提案と重なるときは、`chrome://settings/languages` でブラウザの翻訳をオフにできます。Brave では `brave://settings/languages` の「Brave 翻訳を使用する」です。

## 構成

```
extension/               ブラウザに読み込むフォルダ（これだけで完結）
  manifest.json          MV3。CSP に 'wasm-unsafe-eval'（WebAssembly 用）
  background.js          キュー・キャッシュ・UI との仲介・オフスクリーン文書の管理
  offscreen/engine.js    推論エンジン（wllama）とモデルのダウンロード
  vendor/wllama/         wllama のビルド（tools/vendor-wllama.mjs で生成。出所とハッシュは VERSION.json）
  lib/models.js          モデル定義（HF リポジトリ・ファイル名）
  lib/store.js           OPFS 上のモデル保存（32 MB ずつ分割）
  lib/pfml.js langs.js settings.js
  lib/browser.js         動いているブラウザ（Brave / Chrome）に合わせた内部ページの表記
  content/page.js        ページ翻訳（<xN> プレースホルダでインライン要素を保持）
  content/detect.js      ページの言語の判定（「外国語のページを開いたとき」を選んでいるときだけ登録）
  content/selection.js   選択翻訳カード
  popup/ options/ ui/    ポップアップと設定画面
  licenses/              ライセンス画面、PLaMo コミュニティライセンス契約の写し、THIRD-PARTY-NOTICES.txt
tools/
  build-wllama.sh        wllama の wasm を再ビルド（emsdk 4.0.20 + emdawnwebgpu、パッチ適用。作業場所は .work/）
  wllama-patches/        wllama と llama.cpp（ggml-webgpu）へのパッチ（下の「仕組みメモ」）
  vendor-wllama.mjs      ビルドを extension/vendor/wllama に取り込む（MV3 向けの書き換え込み）
  gen-notices.mjs        wasm に入っているソフトウェアのライセンス表示（THIRD-PARTY-NOTICES.txt）を生成
  make-icons.py          アイコン（藍の地に白の「訳」、Noto Sans JP）を生成。Pillow が必要
tests/                   隔離したテスト用ブラウザを CDP で動かす検証スクリプトとテストページ
```

## 速度（実測、RTX 2080 SUPER）

`tests/bench_speed.mjs`（`tests/fixtures/bench_texts.json` の英文を日本語へ。毎回新しい文）で測った値です。

| 項目 | 2B Q4_K_M | 0.8B Q4_K_M |
| --- | --- | --- |
| 短文 1 文（中央値） | 0.12 秒 | 0.07 秒 |
| 3〜4 文（中央値） | 0.74〜0.75 秒 | 0.40 秒 |
| 長めの 1 段落（中央値、出力 約 140 トークン） | 1.7 秒 | 0.90 秒 |
| ページの 24 要素（8 並列） | 1.8〜1.9 秒 | 0.90〜0.97 秒 |
| 33 要素をまとめて | 5.6〜5.8 秒 | 2.8〜2.9 秒 |
| 生成（1 文ずつ） | 87〜98 tok/s | 154〜175 tok/s |
| プロンプト処理 | 1.7〜2.1 ms/トークン | 0.7〜1.0 ms/トークン |
| 約 1,100 トークンの入力（出力 約 1,400 トークン、`tests/long_text_test.mjs`） | 18.5〜18.6 秒 | — |
| Wikipedia「Machine translation」画面内の本文 2 段落（ページ翻訳、`tests/page_test.mjs`） | 5.7 秒 | — |
| 同じ画面内の 126 要素すべて | 12.9 秒 | — |
| モデル読み込み（ダウンロード済み） | 4.3〜4.5 秒（GPU に 25/25 層） | 2.8〜2.9 秒 |

表は v0.2.1 の値です（ゲームなど GPU を使うほかのアプリがない状態）。同じ日に v0.2.0 と交互に測った比較（2B）：

| 項目 | v0.2.0（4 並列） | v0.2.1（8 並列・パッチ 0007） |
| --- | --- | --- |
| ページの 24 要素 | 2.85〜2.88 秒 | 1.81〜1.87 秒（−36%） |
| 33 要素をまとめて | 8.2〜8.3 秒 | 5.6〜5.8 秒（−31%） |
| Wikipedia 画面内の 126 要素すべて | 17.4 秒 | 12.9 秒（−26%） |
| 長めの 1 段落 | 1.92 秒 | 1.66〜1.68 秒（−13%） |
| 約 1,100 トークンの入力 | 20.4〜21.1 秒 | 18.5〜18.6 秒（−11%） |
| 生成（1 文ずつ） | 84〜97 tok/s | 87〜98 tok/s |

0.8B はページの 24 要素が 1.31〜1.33 → 0.90〜0.97 秒（−30%）、33 要素が 3.8〜3.9 → 2.8〜2.9 秒（−26%）。
Wikipedia の最初の 2 段落（5.7 秒）はどちらも同じです。ゲームが GPU を使っている間に測ったときも、ページ翻訳は
同じくらい（−35〜38%）短くなりました。絶対値は日によって 1 割ほど変わる（v0.2.0 のページの 24 要素は以前 2.6 秒、
この比較では 2.9 秒）ので、版を比べるときは同じ日に交互に測ります。

モデルのダウンロードは 1.81 GB で約 1 分でした（この PC の回線）。

v0.2.0 の最初の版（2B）は短文 0.45 秒、ページの 24 要素 20.8 秒、生成 約 48 tok/s、Wikipedia の 2 段落 30.6 秒でした。
v0.1（ネイティブ CUDA の llama-server）は生成 約 140 tok/s で、ブラウザ内実行の 1 文ずつの生成はその 2/3 程度です。

## 仕組みメモ

- 推論はオフスクリーン文書（`offscreen/engine.html`）で実行し、サービスワーカーとはポートで通信します。
- MV3 の拡張ページは `blob:` の Worker を起動できないため、wllama が実行時に組み立てる Worker を
  `vendor-wllama.mjs` が静的ファイル（`llama-worker.js`）に書き出し、起動部分を書き換えています。
- 1.8 GB のファイルを拡張に同梱して読むとブラウザごと落ちるため（検証済み）、モデルは同梱せず
  HF から Range 指定で 32 MB ずつ取得して OPFS に保存し、読み込み時に `new File([...parts])` で連結します。
- プロンプトキャッシュを無効化したビルドを使用（パッチ）。WebGPU では保存のたびに GPU からの読み戻しが発生して
  1 回 約 11 秒止まり、翻訳では同じプロンプトが来ないので利点がないため。
- `swa_full: true`。PLaMo 3 はスライディングウィンドウ注意のモデルで、既定ではプロンプトの末尾ごとに状態を保存し、
  GPU からの読み戻しが連続していました。SWA のキャッシュは 2048 × 8 スロットで元から全 8192 セルを使うので、
  メモリは増えません。
- ggml-webgpu へのパッチ（`tools/wllama-patches/llama.cpp/`。0001〜0006 は計算の中身と順序を変えない作り、
  0007 は足し合わせる順序だけが変わる）：
  - 0001：トークンごとに作り直していた bind group を使い回し、パラメータの書き込みを 1 回にまとめる。
  - 0003：「後正規化 → 残差の加算 → 次の正規化」（5 演算）を 1 回のディスパッチにまとめる。
  - 0004：K-quant の mat-vec で、行の短い行列（K = 2560 = 10 ブロック）のワークグループを 256 → 160 スレッドにする
    （16 ブロック分のスレッドを立てて 6 ブロック分が遊んでいた）。主にプロンプト処理が速くなる（4.4 → 3.8 ms/トークン）。
  - 0005：CPU 側で GPU を待つのを 1 トークンにつき 1 回（logits の読み出し）だけにする。元は 1 トークンあたり
    21 回待っていた（`tests/worker_timeline.mjs`）。Chrome では、待つものがなくても 1 回 0.1〜0.2 ms、GPU の処理が
    終わってから気づくまで 2〜4 ms かかる（`tests/gpu_latency_probe2.js`）。WebGPU ではキューが順序を保証するので、
    待たなくても結果は同じ（長いプロンプトでは 256 コマンドバッファごとに待って、積み上がる量だけ抑える）。
  - 0002：GPU プロファイル用ビルド（`GGML_WEBGPU_GPU_PROFILE`）でシェーダーごとの時間を定期的に出す。
    通常のビルドには入らない。
  - 0006：mat-vec（行列 × 少数のベクトル）のシェーダーを 16 列（16 トークン）まで使う。元は 4 列までで、
    5 トークン以上のバッチは遅い汎用の行列積に回っていた。
  - 0007：Q4_K / Q6_K の mat-vec を、32〜64 スレッドのワークグループで各スレッドが多くのブロックを受け持つ
    形にする。元は 1 スレッド 1 ブロックで、列（同時に処理するトークン）ごとの集計（サブグループの和と
    2 回のバリア）が内積と同じくらいかかり、トークンを束ねてもほとんど速くならなかった。1 要素あたりの計算式は
    同じで、行の部分和を足す順序だけが変わる。
- 0001〜0006 は訳文がパッチ前と同じことを確認済み（`tests/compare_bench.mjs`：2B・0.8B それぞれ 66 件、
  約 1,100 トークンの長文 1 件）。貪欲デコードなので、計算が少しでも変われば普通はどこかの訳文がずれます。
  0007 は足す順序が変わるため、一部の訳文がずれます。1 文ずつ訳した 33 件で 2B は 1 件、0.8B は 3 件。ずれた所は
  どれも上位 2 候補の確率がほぼ並んでいた箇所（確率の比 1.02〜1.16）で、トークンごとの対数確率の差は平均 0.004
  （2B）・0.006（0.8B）でした。同じシェーダーでワークグループの大きさだけを変えた対照（足す順序だけが変わる）も
  1 件・3 件、平均 0.003・0.005 と同程度です（`tests/logprob_compare.mjs`）。活性化を int8 に量子化し直す経路なので、
  末尾の桁の違いで丸めが 1 段ずれることがあるためです。
- `n_ubatch 8` で同時に訳す数（スロット）も 8。0006・0007 で 8 トークンのバッチも mat-vec の速い経路に乗るため
  （0007 前は 4 並列・`n_ubatch 4` が最速でした）。12〜16 並列はページ翻訳がさらに 1 割弱速くなりますが、
  ページ翻訳中にほかの文を訳すと待たされる時間が延びるので 8 にしています。
- CPU スレッドは 1（全層 GPU なので増やしても空回りするだけ）。
- モデルカード推奨どおり PFML3 プロンプトを自前で組んで送信（`temperature 0`, `repeat_penalty 1.0`,
  stop = `<|plamo:tag|>`, `<|plamo:bos|>`）。原文中の `<|plamo:` は無害化してから渡します。
- ページ翻訳ではインライン要素を属性なしの `<x0>…</x0>` に置き換えて渡し、返ってきたタグで元の要素に戻します。
  タグが崩れた段落は原文を残して下に訳を表示（併記）します。「[1]」のように文字を含まない要素は 1 個のタグにまとめます。
- GitHub のファイル一覧のように「リンク文字列 = URL の末尾」のリンクは名前とみなして翻訳しません。

## wllama を更新するとき

```
bash tools/build-wllama.sh                                              # .work/ に emsdk とソースを取得してビルド（パッチ適用）
node tools/vendor-wllama.mjs --wasm-dir .work/wsrc/build --reuse-index  # wasm とグルー（llama-worker.js）を差し替え
node tools/vendor-wllama.mjs --wasm-dir .work/wsrc/build                # wllama 本体（index.js）ごと取り込み直すとき
node tools/gen-notices.mjs                                              # ライセンス表示を作り直す（.work のソースから）
```

`build-wllama.sh` 冒頭のコミット（wllama / llama.cpp）を変えると別バージョンになります。

速度を測るとき（隔離したテスト用ブラウザ、`tests/launch-test-browser.sh`）：

```
bash tests/use-build.sh                       # .work/wsrc/build をテスト用コピーに入れて再読み込み
node tests/bench_speed.mjs <名前> <出力.json>   # MODEL=0.8b-q4km で 0.8B
node tests/compare_bench.mjs a.json b.json    # 訳文の一致と速度の比較
node tests/worker_timeline.mjs                # 1 トークンの内訳（CPU・エンコード・GPU 待ち）
BUILD_DIR=build-prof EXTRA_CMAKE_ARGS=-DGGML_WEBGPU_GPU_PROFILE=ON bash tools/build-wllama.sh
bash tests/use-build.sh build-prof && node tests/gpu_profile.mjs   # シェーダーごとの GPU 時間
bash tests/ab-configs.sh 'a|4|4|unified|8192|off' 'b|8|8|unified|8192|off'   # スロット数・バッチ・KV の A/B
bash tests/use-shader-hook.sh '<json>'        # シェーダーを再ビルドせずに差し替えて測る（tests/shader-variants.js）
bash tests/use-logprobs.sh on && node tests/logprob_compare.mjs run a   # 訳文のトークンごとの確率（diff a b で比較）
```
（`gpu_profile.mjs` は `BROWSER_EXTRA_FLAGS=--enable-webgpu-developer-features` で起動したテスト用ブラウザで。
そうしないとタイムスタンプが 0.1 ms 単位に丸められます）

テスト用ブラウザは `--load-extension` で拡張機能を読み込みます。Chrome の正式版は 137 からこのフラグを受け付けないため、
既定では Brave を使います。`BROWSER` に Chromium や Chrome for Testing の実行ファイルを指定することもできます。
窓は画面の外（`TEST_WINDOW_POS`、既定は 4000,100）に開きます。

## トラブルシュート

- 状態が「モデル未ダウンロード」：設定画面で「ダウンロード」。
- 実行環境が「CPU（WebAssembly）」：WebGPU が使えていません（`chrome://gpu` を確認）。CPU では非常に遅くなります。
- ショートカットが「未設定」：他の拡張やブラウザのキーと衝突しています。`chrome://extensions/shortcuts` で割り当ててください。

Brave では `chrome://` の代わりに `brave://` でも開けます。設定画面の案内は、Brave で動いているときは `brave://`、
それ以外では `chrome://` で表示します。

## ライセンス

**Built with PLaMo.** 翻訳モデルには、株式会社 Preferred Networks（PFN）の PLaMo 3 Translate を使っています。
この拡張機能は個人が開発した非公式のもので、PFN が提供・承認・保証しているものではありません。
「PLaMo」は株式会社 Preferred Networks の商標です。

### 翻訳モデル（PLaMo 3 Translate）

[PLaMo コミュニティライセンス契約](https://plamo.preferredai.jp/info/plamo-community-license-ja)
（[English](https://plamo.preferredai.jp/info/plamo-community-license-en)）で公開されています。
モデルはこの拡張機能に含まれず、初回に利用者の PC が Hugging Face の公式リポジトリ（pfnet）から直接ダウンロードします。
モデルリポジトリに同梱されている契約書（2026 年 11 月 9 日改定版）の写しを `extension/licenses/` に置いています。
拡張機能の設定画面の「ライセンス」からも読めます。

使う人に関係する主な条件（要点の抜粋。正確な条件は契約の全文で確認してください）：

- モデルをダウンロードして使うと、この契約が適用されます（前文、第 11 条）。使う人は 18 歳以上（または居住国で単独で契約できる
  年齢）であることが条件です。満たさない場合は、親権者などの同意が必要です（第 2 条）。
- 私的使用と学術用途なら、無償で登録も要りません（第 1 条、第 3 条）。
- 事業での利用や営利目的の利用は「商業目的」にあたります。組織の中での利用も商業目的に含まれます（第 1 条 10 号）。
  商業目的で使う条件は、事前に [PFN の登録フォーム](https://forms.gle/mTL8tBLrMYXKNZD56)で登録することと、
  本人または関係会社の直近の事業年度の収入・売上が 10 億円以下であることです。
  満たさない場合は、PFN から商業用のライセンスを別に取得する必要があります（第 3 条 3 項）。
- PLaMo 3 Translate のように翻訳だけをするモデル（契約でいう「変換モデル」）の訳文は、PLaMo の出力だと明示しなくても公表できます。
  ただし、書籍・論文など独立した長文の公表物の全部や実質的な部分に使うときは、奥付・謝辞・末尾などに
  PLaMo を翻訳に使ったことを書きます（第 5 条 2 項）。
- 訳文で学習したモデルにも、この契約が適用されます（第 5 条 3 項）。訳文や、訳文を含むデータセットを
  人に渡したり公開したりするときは、それで学習したモデルにもこの契約が適用されることを、相手にわかる形で表示する必要があります（第 5 条 4 項）。
- モデルと訳文は現状のまま提供され、PFN は正確さなどを保証しません。法律・医療・金融・人物評価などの重要な判断で、
  訳文を唯一の根拠にしてはいけません（第 7 条）。

### 同梱しているソフトウェア

推論エンジン（`extension/vendor/wllama/`）に含まれるソフトウェアと、その著作権表示・ライセンス全文は
`extension/licenses/THIRD-PARTY-NOTICES.txt` にまとめています（`node tools/gen-notices.mjs` で、ビルドに使ったソースから生成）。

| ソフトウェア | ライセンス |
| --- | --- |
| [wllama](https://github.com/ngxson/wllama) | MIT |
| [llama.cpp](https://github.com/ggml-org/llama.cpp) / ggml（WebGPU 向けのパッチを含む） | MIT |
| JSON for Modern C++（nlohmann/json） | MIT |
| Emscripten（ランタイム、WebGPU バインディング） | MIT / University of Illinois/NCSA |
| musl libc | MIT |
| Dawn（webgpu_cpp） | BSD 3-Clause |
| stb_image、miniaudio（llama.cpp のマルチモーダル用。この拡張では使っていません） | パブリックドメイン / MIT 系 |
| LLVM libc++ など | Apache 2.0（LLVM 例外付き） |
