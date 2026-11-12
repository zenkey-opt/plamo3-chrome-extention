# プライバシーポリシー

PLaMo 3 Translate Local（以下「この拡張機能」）は、Chrome の拡張機能です。翻訳は利用者の PC の中で行い、翻訳する文章を外部に送りません。このページでは、この拡張機能が扱うデータと、その扱い方を説明します。

最終更新：2026 年 11 月 12 日

## 扱うデータ

この拡張機能は次のデータを利用者の PC の中だけで扱います。開発者を含め、だれにも送りません。

- 翻訳する文章：選択したテキスト、翻訳するページの文章とタイトル、ポップアップに入力した文です。PC の中で動く翻訳モデルに渡して訳します。
- ページの言語：設定の「外国語のページを開いたとき」で「翻訳するか尋ねる」か「自動で翻訳する」を選んだときだけ、開いたページの本文の一部から、ブラウザの機能で言語を判定します。
- 訳文：同じ文を訳し直さないように、最近の訳文を拡張機能のメモリーに置きます。拡張機能のバックグラウンドの処理が止まると消えます。
- ポップアップの入力：入力中の文と言語の選択を、ブラウザを閉じるまで保持します。
- 設定：翻訳先の言語、文体、用語集、自動翻訳の対象外にしたサイトの一覧、ライセンスに同意した日時などを、ブラウザの拡張機能用の保存領域に保存します。
- 翻訳モデル：設定画面でダウンロードしたモデルを、拡張機能専用の保存領域に保存します。

## 通信

この拡張機能が通信するのは、設定画面でモデルのダウンロードを始めたときだけです。このとき、Hugging Face（huggingface.co）にある Preferred Networks の公式リポジトリから、モデルのファイルを取得します。要求に含まれるのはファイルの場所と取得する範囲で、翻訳する文章、ページの内容、設定は含みません。Hugging Face が受け取る IP アドレスなどの情報の扱いは、[Hugging Face のプライバシーポリシー](https://huggingface.co/privacy)に従います。

アクセス解析、広告、利用状況の収集は行いません。

## データの提供と販売

開発者は利用者のデータを受け取りません。第三者への提供や販売もしません。

## データの削除

ダウンロードしたモデルは、設定画面の「削除」で消せます。拡張機能を削除すると、設定とモデルを含め、この拡張機能が保存したデータはすべて消えます。

## Chrome ウェブストアのポリシー

この拡張機能によるデータの使用は、Limited Use の要件を含む Chrome ウェブストアのユーザーデータに関するポリシーに従います。

## 変更

このポリシーを変えるときは、このページを更新し、最終更新日を改めます。

## 問い合わせ

- GitHub の Issues：https://github.com/zenkey-opt/plamo3-chrome-extention/issues
- メール：dev@zenkey.net

---

# Privacy Policy

PLaMo 3 Translate Local ("the extension") is a Chrome extension. It translates on the user's own computer and does not send the text it translates anywhere. This page describes the data the extension handles and how it handles it.

Last updated: November 12, 2026

## Data the extension handles

The extension handles the following data only on the user's computer. It sends none of it to anyone, the developer included.

- Text to translate: selected text, the text and title of a page being translated, and text typed into the popup. It is passed to the translation model running on the computer.
- Page language: only when "翻訳するか尋ねる" (ask) or "自動で翻訳する" (translate automatically) is chosen for pages in another language, the browser's built-in language detection checks a part of the text of each page that is opened.
- Translations: recent translations are kept in the extension's memory so that the same text is not translated twice. They are gone when the extension's background process stops.
- Popup input: the text being typed and the chosen languages are kept until the browser closes.
- Settings: the target language, style, glossary, the sites excluded from automatic translation, the date the model licence was accepted and other settings are saved in the browser's storage for extensions.
- Translation model: the model downloaded on the options page is saved in the extension's own storage.

## Network

The extension connects to the network only when the user starts a model download on the options page. It then fetches the model files from Preferred Networks' official repository on Hugging Face (huggingface.co). The requests contain the file location and the byte range to fetch, not the text being translated, page content or settings. Information that Hugging Face receives, such as the IP address, is handled under the [Hugging Face Privacy Policy](https://huggingface.co/privacy).

The extension has no analytics, advertising or usage tracking.

## Sharing and sale

The developer receives no user data and does not share or sell any.

## Deleting data

A downloaded model can be removed with 削除 (Delete) on the options page. Uninstalling the extension removes its settings, models and everything else it stored.

## Chrome Web Store policy

The use of information by the extension adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Changes

When this policy changes, this page is updated together with the "Last updated" date.

## Contact

- GitHub Issues: https://github.com/zenkey-opt/plamo3-chrome-extention/issues
- Email: dev@zenkey.net
