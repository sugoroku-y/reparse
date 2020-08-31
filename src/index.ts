import {scan, replace} from 'rexscan';

function throwError(message: string): never {
  throw new Error(message);
}

function assert(condition: unknown, message?: string) {
  if (!condition) {
    throwError(message ?? 'Assertion failed!');
  }
}

function unreachable(message?: string): never {
  throwError(message ?? 'It should be unreachable here.');
}

function assertNonNull<T>(
  target: T | null | undefined,
  message?: string
): asserts target is T {
  assert(target !== null && target !== undefined, message);
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
  unreachable(
    `out of bounds: index: ${index}, content.length: ${content.length}`
  );
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
        assertNonNull(
          groups,
          'this.reには名前付きキャプチャを指定しているので、groupsはundefinedではないはず'
        );
        // match.groupsの中からマッチしたパターンの名前を取得
        const type = Object.entries(groups).find(
          ([, value]) => value !== undefined
        )?.[0];
        assertNonNull(
          type,
          'this.reの名前付きキャプチャのどれかのパターンにマッチしているので、typeはundefinedではないはず'
        );
        const action = this.actions[type];
        assertNonNull(
          action,
          '名前付きキャプチャの名前に対応するアクションが登録されているので、this.actions[type]は存在しているはず'
        );
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
        ex.index ?? g.index ?? g.lastIndex
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
