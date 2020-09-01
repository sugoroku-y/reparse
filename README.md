# reparse

正規表現を使った簡易パーザークラスです。

[![Build Status](https://travis-ci.org/sugoroku-y/reparse.svg?branch=master)](https://travis-ci.org/sugoroku-y/reparse)
[![MIT License](http://img.shields.io/badge/license-MIT-blue.svg?style=flat)](LICENSE)

```ts
const jsonParser = new Parser<JsonContext>([
  // null
  [/null/, (_, context) => context.add(null)],
  // 真偽値
  [/true/, (_, context) => context.add(true)],
  [/false/, (_, context) => context.add(false)],
  // 数値
  [
    /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?/g,
    (matched, context) => context.add(+matched),
  ],
  // 文字列
  [
    /"[^"\\]*(?:\\.[^"\\]*)*"/g,
    (matched, context, index) => context.add(dequote(matched, index)),
  ],
  // `[`が来たらコンテキストを配列用に切り替え
  [/\[/, (_, context, index) => new ArrayContext(context, index)],
  // `{`が来たらコンテキストをオブジェクト用に切り替え
  [/\{/, (_, context, index) => new ObjectContext(context, index)],
  // 配列、オブジェクトの終了
  [/\]/, (_, context) => context.closeSquareBracket()],
  [/\}/, (_, context) => context.closeCurlyBracket()],
  // 値の区切り
  [/,/, (_, context) => context.comma()],
  // プロパティ名と値の区切り
  [/:/, (_, context) => context.colon()],
  // 空白文字は無視
  [/\s+/, (_, context) => context],
]);

function JSON_parse(s: string): JSONVALUE {
  return jsonParser.parse(s, new RootContext()).final();
}
```

