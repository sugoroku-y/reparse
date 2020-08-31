import {replace} from 'rexscan';
import {Parser, throwIndexedError} from './index';

function throwError(message?: string): never {
  throw new Error(message);
}

function assertMustBeNever(target: never, message?: string): never {
  throwError(message ?? 'target must be never');
}

type JSONBASE = null | boolean | number | string;
type JSONARRAY = Array<JSONVALUE>;
interface JSONOBJECT {
  [name: string]: JSONVALUE;
}
type JSONVALUE = JSONBASE | JSONOBJECT | JSONARRAY;

interface JsonContext {
  value?: JSONVALUE;
  add(value: JSONVALUE): JsonContext;
  colon(): JsonContext;
  comma(): JsonContext;
  closeSquareBracket(): JsonContext;
  closeCurlyBracket(): JsonContext;
  final(): JSONVALUE;
}

const DEQUOTE: Readonly<{[ch: string]: string}> = {
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  '"': '"',
  '/': '/',
  '\\': '\\',
};

function dequote(s: string, start?: number): string {
  // 先頭と末尾の`"`を除去してから置換
  return replace(
    s.slice(1, -1),
    /\\u([\s\S]{0,4})|\\(.)/g,
    ({index, 0: escaped, 1: hex, 2: ch}) => {
      if (hex) {
        // 文字コード指定のエスケープシーケンス
        if (hex.length !== 4 || /[^0-9a-fA-F]/.test(hex)) {
          // 4文字未満、もしくは16進文字以外があったらエラー
          throwIndexedError(
            (start ?? 0) + index,
            `Unexpected escape sequence: '${escaped}'`
          );
        }
        // 文字コードを文字に変換
        return String.fromCharCode(parseInt(hex, 16));
      }
      // DEQUOTEにない文字はエラー
      return (
        DEQUOTE[ch] ??
        throwIndexedError(
          (start ?? 0) + index,
          `Unexpected escape sequence: '${escaped}'`
        )
      );
    }
  );
}

function Typeof(value: JSONVALUE): string {
  if (value === null) return 'null';
  if (value === true || value === false) return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'string';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  assertMustBeNever(value, `Unknown value type: ${value}`);
}

function unexpectedCharacter(ch: string): never {
  throwError(`Unexpected character: \`${ch}\``);
}

function unexpectedValue(value: JSONVALUE): never {
  throwError(`Unexpected ${Typeof(value)}: ${value}`);
}

function unexpectedValueIfIsUndefined(target: unknown, value: JSONVALUE): void {
  if (target !== undefined) {
    unexpectedValue(value);
  }
}

function unexpectedVaueIfIn<T, S extends T>(
  target: T,
  candidates: ReadonlyArray<S>,
  value: JSONVALUE
): void {
  if (!candidates.some(c => c === target)) {
    unexpectedValue(value);
  }
}

function unexpectedCharacterIfIn<T, S extends T>(
  target: T,
  candidates: ReadonlyArray<S>,
  ch: string
): void {
  if (!candidates.some(c => c === target)) {
    unexpectedCharacter(ch);
  }
}

function unexpectedValueIfIsString(
  target: unknown,
  value: JSONVALUE
): asserts target is string {
  if (typeof target !== 'string') {
    unexpectedValue(value);
  }
}

class RootContext implements JsonContext {
  value?: JSONVALUE;
  add(value: JSONVALUE): JsonContext {
    unexpectedValueIfIsUndefined(this.value, value);
    this.value = value;
    return this;
  }
  colon(): JsonContext {
    unexpectedCharacter(':');
  }
  comma(): JsonContext {
    unexpectedCharacter(',');
  }
  closeSquareBracket(): JsonContext {
    unexpectedCharacter(']');
  }
  closeCurlyBracket(): JsonContext {
    unexpectedCharacter('}');
  }
  final(): JSONVALUE {
    if (this.value === undefined) {
      throwError('Unexpected end');
    }
    return this.value;
  }
}

class ArrayContext implements JsonContext {
  /**
   * 配列のjson表記内での状態を示す。
   * - `'INITIAL'` 初期状態
   * - `'VALUE'` 値が指定された状態
   * - `'COMMA'` 値と値の区切りの`,`の位置
   * ```plantuml
   * (*)-down->INITIAL
   * note right: `[`: 配列開始
   * INITIAL -down-> VALUE
   * note right: 値
   * VALUE -> COMMA
   * note left: `,`: 値と値の区切り
   * COMMA -> VALUE
   * VALUE -down-> CLOSE
   * note right: `]`: 配列終了\nプログラム上は存在しない
   * INITIAL -down-> CLOSE
   * CLOSE -down-> (*)
   * ```
   *
   * @type {('INITIAL' | 'VALUE' | 'COMMA')}
   * @memberof ArrayContext
   */
  state: 'INITIAL' | 'VALUE' | 'COMMA' = 'INITIAL';
  value: JSONARRAY = [];
  constructor(
    private readonly save: JsonContext,
    public readonly start: number
  ) {
    save.add(this.value);
  }
  add(value: JSONVALUE): JsonContext {
    unexpectedVaueIfIn(this.state, ['INITIAL', 'COMMA'] as const, value);
    this.value.push(value);
    this.state = 'VALUE';
    return this;
  }
  comma(): JsonContext {
    unexpectedCharacterIfIn(this.state, ['VALUE'] as const, ',');
    this.state = 'COMMA';
    return this;
  }
  closeSquareBracket(): JsonContext {
    unexpectedCharacterIfIn(this.state, ['INITIAL', 'VALUE'] as const, ']');
    return this.save;
  }
  colon(): JsonContext {
    unexpectedCharacter(':');
  }
  closeCurlyBracket(): JsonContext {
    unexpectedCharacter('}');
  }
  final(): JSONVALUE {
    throwIndexedError(this.start, 'Unmatched `[`');
  }
}

class ObjectContext implements JsonContext {
  /**
   * オブジェクトのjson表記内での状態を示す。
   * - `'INITIAL'` 初期状態
   * - `'NAME'` プロパティ名が指定された状態
   * - `'COLON'` プロパティ名と値の区切りの`:`の位置
   * - `'VALUE'` 値が指定された状態
   * - `'COMMA'` 値とプロパティ名の区切りの`,`の位置
   * ```plantuml
   * (*)-down->INITIAL
   * note right: `{`: オブジェクト開始
   * INITIAL -down-> NAME
   * note right: プロパティ名
   * NAME -down-> COLON
   * note right: `:`:名前と値の区切り
   * COLON -down-> VALUE
   * note right: 値
   * VALUE -up-> COMMA
   * COMMA -> NAME
   * VALUE -down-> CLOSE
   * note right: `}`: オブジェクト終了\nプログラム上は存在しない
   * INITIAL -down-> CLOSE
   * CLOSE -down-> (*)
   * ```
   * @type {('INITIAL' | 'NAME' | 'COLON' | 'VALUE' | 'COMMA')}
   * @memberof ObjectContext
   */
  state: 'INITIAL' | 'NAME' | 'COLON' | 'VALUE' | 'COMMA' = 'INITIAL';
  value: JSONOBJECT = {};
  name: string | undefined;
  constructor(
    private readonly save: JsonContext,
    public readonly start: number
  ) {
    save.add(this.value);
  }
  add(value: JSONVALUE): JsonContext {
    switch (this.state) {
      case 'INITIAL':
      case 'COMMA':
        unexpectedValueIfIsString(value, value);
        unexpectedValueIfIsUndefined(this.name, value);
        this.name = value;
        this.state = 'NAME';
        break;
      case 'COLON':
        unexpectedValueIfIsString(this.name, value);
        this.value[this.name] = value;
        this.state = 'VALUE';
        this.name = undefined;
        break;
      default:
        unexpectedValue(value);
    }
    return this;
  }
  colon(): JsonContext {
    unexpectedCharacterIfIn(this.state, ['NAME'] as const, ':');
    this.state = 'COLON';
    return this;
  }
  comma(): JsonContext {
    unexpectedCharacterIfIn(this.state, ['VALUE'] as const, ',');
    this.state = 'COMMA';
    return this;
  }
  closeCurlyBracket(): JsonContext {
    unexpectedCharacterIfIn(this.state, ['INITIAL', 'VALUE'] as const, '}');
    return this.save;
  }
  closeSquareBracket(): JsonContext {
    unexpectedCharacter(']');
  }
  final(): JSONVALUE {
    throwIndexedError(this.start, 'Unmatched `{`');
  }
}

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

test('json-parser#1', () => {
  expect(JSON_parse('null')).toBeNull();
  expect(JSON_parse('true')).toBe(true);
  expect(JSON_parse('false')).toBe(false);
  expect(JSON_parse('0')).toBe(0);
  expect(JSON_parse('-1')).toBe(-1);
  expect(JSON_parse('12.345')).toBeCloseTo(12.345, 5);
  expect(JSON_parse('12.345e-5')).toBeCloseTo(12.345e-5, 5);
  expect(JSON_parse('12.345e+5')).toBeCloseTo(12.345e5, 5);
  expect(JSON_parse('""')).toBe('');
  expect(JSON_parse('"abc"')).toBe('abc');
  expect(JSON_parse('"abc\\r\\n\\b\\f\\t\\"\\\\\\/\\u3042"')).toBe(
    'abc\r\n\b\f\t"\\/あ'
  );
  expect(JSON_parse('[]')).toEqual([]);
  expect(JSON_parse('{}')).toEqual({});
  expect(JSON_parse('{ }')).toEqual({});
});

test('json-parser#2', () => {
  let target;
  target = {};
  expect(JSON_parse(JSON.stringify(target))).toEqual(target);
  target = {abc: true};
  expect(JSON_parse(JSON.stringify(target))).toEqual(target);
  target = {
    abc: [{def: 'string', mno: 567}, {ghi: {jkl: [1234, true, null, false]}}],
  };
  expect(JSON_parse(JSON.stringify(target))).toEqual(target);
  expect(
    JSON_parse(`
  {
    "abc": [
      {
        "def": "string",
        "mno": 567
      },
      {
        "ghi": {
          "jkl": [
            1234,
            true,
            null,
            false
          ]
        }
      }
    ]
  }
  `)
  ).toEqual(target);
});

test('json-parser#3', () => {
  expect(() => JSON_parse('')).toThrow('Unexpected end');
  expect(() => JSON_parse('[')).toThrow('Unmatch');
  expect(() => JSON_parse('{')).toThrow('Unmatch');
  expect(() => JSON_parse('[{')).toThrow('Unmatch');
  expect(() => JSON_parse('[[')).toThrow('Unmatch');
  expect(() => JSON_parse('[}')).toThrow('Unexpected character');
  expect(() => JSON_parse('[:')).toThrow('Unexpected character');
  expect(() => JSON_parse('[,')).toThrow('Unexpected character');
  expect(() => JSON_parse('{[')).toThrow('Unexpected array');
  expect(() => JSON_parse('{{')).toThrow('Unexpected object');
  expect(() => JSON_parse('{]')).toThrow('Unexpected character');
  expect(() => JSON_parse('{:')).toThrow('Unexpected character');
  expect(() => JSON_parse('{,')).toThrow('Unexpected character');
  expect(() => JSON_parse('"')).toThrow('Unrecognized token');
  expect(() => JSON_parse('"\\u304"')).toThrow('Unexpected escape sequence:');
  expect(() => JSON_parse('"\\uG"')).toThrow('Unexpected escape sequence:');
  expect(() => JSON_parse('"abc" null')).toThrow('Unexpected null');
  expect(() => JSON_parse('"abc" true')).toThrow('Unexpected boolean');
  expect(() => JSON_parse('"abc" false')).toThrow('Unexpected boolean');
  expect(() => JSON_parse('"abc" 123')).toThrow('Unexpected number');
  expect(() => JSON_parse('"abc" "123"')).toThrow('Unexpected string');
  expect(() => JSON_parse('"abc" []')).toThrow('Unexpected array');
  expect(() => JSON_parse('"abc" {}')).toThrow('Unexpected object');
  expect(() => JSON_parse('["abc" {}]')).toThrow('Unexpected object');
  expect(() => JSON_parse(':')).toThrow('Unexpected character');
  expect(() => JSON_parse(',')).toThrow('Unexpected character');
  expect(() => JSON_parse(']')).toThrow('Unexpected character');
  expect(() => JSON_parse('}')).toThrow('Unexpected character');
  expect(() => JSON_parse('{"abc" null}')).toThrow('Unexpected null');
  expect(() => JSON_parse('{"abc": "" null}')).toThrow('Unexpected null');
  expect(() =>
    JSON_parse(`
  {
    "abc": [
      {
        "def": "string",
        "mno": 567
      },
      {
        "ghi": {
          "jkl": [
            1234,
            true,
            null
            false
          ]
        }
      }
    ]
  }
  `)
  ).toThrow('Unexpected boolean: false(line: 14):');
});
