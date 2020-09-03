import {scan} from 'rexscan';

function throwError(message: string): never {
  throw new Error(message);
}

function unreachable(): never {
  // この関数は実行されないはず
  /* istanbul ignore next */
  throwError('It should be unreachable here.');
}

function assertIsNotUndefined<T>(target: T | undefined): asserts target is T {
  // この関数の実行時にはtargetはundefinedではないので、以下の条件式は常に偽
  /* istanbul ignore next */
  if (target === undefined) {
    // 上記のためここには来ない
    /* istanbul ignore next */
    throwError('target must not be undefined');
  }
}

class IndexedError extends Error {
  name = 'IndexedError';
  constructor(public index: number, message: string) {
    super(message);
  }
}

export function throwIndexedError(index: number, message: string): never {
  throw new IndexedError(index, message);
}

/**
 * ファイルの内容と先頭からのインデックスから行番号、桁数、その行の内容を返す。
 *
 * @param {string} content ファイルの内容
 * @param {number} index 先頭からのインデックス
 * @returns {{lineNo: number; columnNo: number; line: string}}
 */
function getLineInfo(
  content: string,
  index: number
): {lineNo: number; columnNo: number; line: string} {
  let lineNo = 1;
  for (const {index: lineIndex, lastIndex, 1: line} of scan(
    /([^\r\n]*)(?:\r?\n|$)/gy,
    content
  )) {
    if (index <= lastIndex) {
      return {lineNo, columnNo: index - lineIndex, line};
    }
    ++lineNo;
  }
  // インデックスが見つからないことはないのでここには来ない
  /* istanbul ignore next */
  unreachable();
}

type ParserAction<CONTEXT> = (
  token: string,
  context: CONTEXT,
  index: number
) => CONTEXT;

/**
 * 文字列を解析する
 *
 * @export
 * @class Parser
 * @template T
 * @template CONTEXT
 */
export class Parser<CONTEXT> {
  private readonly re: RegExp;
  private readonly actions: {
    readonly [type: string]: ParserAction<CONTEXT>;
  };
  constructor(
    tokens: ReadonlyArray<Readonly<[RegExp, ParserAction<CONTEXT>]>>
  ) {
    const patterns: string[] = [];
    const actions: {
      [type: string]: ParserAction<CONTEXT>;
    } = {};
    let index = 0;
    for (const [pattern, action] of tokens) {
      const type = `pattern${++index}`;
      patterns.push(`(?<${type}>${pattern.source})`);
      actions[type] = action;
    }
    this.re = new RegExp(patterns.join('|'), 'gy');
    this.actions = actions;
  }
  parse(content: string, context: CONTEXT): CONTEXT {
    const g = scan(this.re, content);
    try {
      for (const {index, groups, 0: matched} of g) {
        // this.reには名前付きキャプチャを指定しているので、groupsはundefinedではないはず
        assertIsNotUndefined(groups);
        // match.groupsの中からマッチしたパターンの名前を取得
        const type = (Object.entries(groups).find(
          ([, value]) => value !== undefined
        ) ??
          // this.reの名前付きキャプチャのどれかのパターンにマッチしているので、必ず見つかるはず
          /* istanbul ignore next */
          unreachable())[0];
        const action = this.actions[type];
        // 名前付きキャプチャの名前に対応するアクションが登録されているので、this.actions[type]は存在しているはず
        assertIsNotUndefined(action);
        // マッチしたパターンのアクションを実行
        context = action(matched, context, index);
      }
      if (g.lastIndex < content.length) {
        // 最後まで到達できなかったと言うことはエラー
        throwIndexedError(g.lastIndex, `Unrecognized token`);
      }
    } catch (ex) {
      const {lineNo, columnNo, line} = getLineInfo(
        content,
        ex.index ??
          g.index ??
          // g.indexがundefinedということは終端までたどり着いているのに、エラーということは有り得ない
          /* istanbul ignore next */
          g.lastIndex
      );
      throwError(`${ex.message}${
        line.length !== content.length ? `(line: ${lineNo})` : ''
      }:
  ${line}
  ${' '.repeat(columnNo)}^`);
    }
    return context;
  }
}
