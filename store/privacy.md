# Privacy タブと Test instructions タブ

審査担当者が読む欄なので、枠の中の英文を貼ります。枠の下に、日本語で内容を書いています。

## Single purpose

```text
Translate text in the browser with PLaMo 3 Translate, a translation model that the extension runs on the user's own computer with WebAssembly and WebGPU: selected text, whole web pages and text typed into the popup. The text is not sent to any server.
```

選択したテキスト、ページ、ポップアップに入力した文を、利用者の PC で動かす翻訳モデル PLaMo 3 Translate で翻訳します。文章をサーバーに送りません。

## Permission justification

### contextMenus

```text
Adds two items to the right-click menu: translate the selected text, and translate the page.
```

右クリックのメニューに、選択したテキストの翻訳とページの翻訳を加えます。

### storage

```text
Saves the user's settings (target language, style, glossary, sites to skip) and the date the model licence was accepted. Session storage keeps the popup's input until the browser closes.
```

設定と、モデルのライセンスに同意した日時を保存します。ポップアップの入力はブラウザを閉じるまで一時的な保存領域に置きます。

### unlimitedStorage

```text
The user downloads the translation model (573 MB or 1.81 GB) into the extension's Origin Private File System, where it stays for later use.
```

利用者がダウンロードする翻訳モデルは 573 MB か 1.81 GB あり、拡張機能専用の保存領域に置きます。

### activeTab

```text
Translates the current tab when the user asks for it from the toolbar popup, the right-click menu or a keyboard shortcut (Alt+T, Alt+P), without access to every site.
```

ポップアップ、右クリックのメニュー、ショートカットで頼まれたときに、開いているタブを翻訳します。すべてのサイトへのアクセスは要りません。

### scripting

```text
Injects the translation scripts into the tab the user asked to translate. If the user turns on the option for pages in another language and grants the optional site access, registers a small script that detects the page language in the browser.
```

翻訳を頼まれたタブに、翻訳用のスクリプトを入れます。外国語のページの設定をオンにして、すべてのサイトへのアクセスを許可したときは、ページの言語を判定する小さなスクリプトを登録します。

### offscreen

```text
Hosts the inference engine (llama.cpp compiled to WebAssembly, using WebGPU). The engine runs in a dedicated Web Worker, which an extension service worker cannot start, and keeps the model loaded between translations.
```

推論エンジンを動かす文書を開きます。エンジンは専用の Web Worker で動き、拡張機能のサービスワーカーからは Worker を起動できません。この文書は翻訳と翻訳のあいだもモデルを読み込んだままにします。

### Host permissions

```text
huggingface.co, *.hf.co and *.huggingface.co: download the model files from the official Preferred Networks repositories on Hugging Face (pfnet) when the user clicks Download on the options page. Hugging Face redirects the file downloads to its *.hf.co hosts.
http://*/* and https://*/* are optional. They are requested only when the user turns on the option for pages in another language, to run content/detect.js, which detects the page language locally with chrome.i18n.detectLanguage. Turning the option off removes the access.
```

Hugging Face の 3 つのホストは、利用者が設定画面でダウンロードを押したときに、PFN の公式リポジトリからモデルを取得するために使います。すべてのサイトへのアクセスは任意の権限で、外国語のページの設定をオンにしたときだけ求めます。ページの言語はブラウザの中で判定し、設定をオフにすると権限も外します。

## Are you using remote code?

「No, I am not using Remote code」を選びます。2026 年 11 月 12 日の画面には、この質問がありませんでした。質問と理由を書く欄があれば、次を貼ります。

```text
All JavaScript and WebAssembly is in the package, including the inference engine (vendor/wllama, built from wllama and llama.cpp with the build scripts and patches in the public repository). The only files downloaded at run time are the model weights (GGUF), which are data. The extension builds the prompt itself (lib/pfml.js) and does not run the chat template stored in the model file.
```

JavaScript と WebAssembly は、すべてパッケージに入っています。実行中にダウンロードするのはモデルの重みだけで、これはデータです。プロンプトは拡張機能のコードが組み立て、モデルのファイルに入っているチャットテンプレートは実行しません。

## Data usage

- 集めるデータの種類は「Website content」だけにチェックを入れます。ストアのページには「ウェブサイトのコンテンツ」を扱うと表示されます。翻訳する文章は PC の中だけで扱いますが、Chrome ウェブストアの FAQ は、端末の中だけで処理するデータも開示するよう求めています。
- 3 つの宣言にはすべてチェックを入れます。ストアのページには次のように表示されます。
  - 承認されている以外の用途で第三者に販売しないこと
  - アイテムの中心機能と関係のない目的で使用または転送しないこと
  - 信用力を判断する目的または融資目的で使用または転送しないこと
- Privacy policy の URL：https://github.com/zenkey-opt/plamo3-chrome-extention/blob/master/PRIVACY.md

## Test instructions

入力は任意です。審査担当者が拡張機能を試すときの手順で、早く試せる 0.8B のモデルを使います。追加の手順の欄は 500 文字までです。ユーザー名とパスワードの欄は空けておきます。

```text
No account needed. The UI is in Japanese. Needs a GPU with WebGPU (chrome://gpu: "WebGPU: Hardware accelerated"); without it the CPU fallback is very slow.
1. The options page opens on install. Click ダウンロード on the 0.8B row (573 MB), then 同意してダウンロード. When done, select the 0.8B row.
2. On an English page, select a sentence and press Alt+T, or right-click > "PLaMo で翻訳".
3. Alt+P translates the page; press it again to restore.
4. Click the toolbar icon and type English text.
```
