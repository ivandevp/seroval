import assert from '../assert';
import { Feature } from '../compat';
import { ParserContext, createIndexedValue } from '../context';
import { serializeString } from '../string';
import { BigIntTypedArrayValue, TypedArrayValue } from '../types';
import {
  INFINITY_NODE,
  NEG_INFINITY_NODE,
  NAN_NODE,
  NEG_ZERO_NODE,
} from './constants';
import { getReferenceID } from './reference';
import { INV_SYMBOL_REF, WellKnownSymbols } from './symbols';
import {
  SerovalBigIntNode,
  SerovalBigIntTypedArrayNode,
  SerovalDateNode,
  SerovalNodeType,
  SerovalIndexedValueNode,
  SerovalRegExpNode,
  SerovalStringNode,
  SerovalTypedArrayNode,
  SerovalWKSymbolNode,
  SerovalReferenceNode,
  SerovalArrayBufferNode,
  SerovalDataViewNode,
  SerovalNode,
} from './types';

export function createNumberNode(value: number): SerovalNode {
  switch (value) {
    case Infinity:
      return INFINITY_NODE;
    case -Infinity:
      return NEG_INFINITY_NODE;
    default:
      // eslint-disable-next-line no-self-compare
      if (value !== value) {
        return NAN_NODE;
      }
      if (Object.is(value, -0)) {
        return NEG_ZERO_NODE;
      }
      return {
        t: SerovalNodeType.Number,
        i: undefined,
        s: value,
        l: undefined,
        c: undefined,
        m: undefined,
        d: undefined,
        a: undefined,
        f: undefined,
        b: undefined,
      };
  }
}

export function createStringNode(value: string): SerovalStringNode {
  return {
    t: SerovalNodeType.String,
    i: undefined,
    s: serializeString(value),
    l: undefined,
    c: undefined,
    m: undefined,
    d: undefined,
    a: undefined,
    f: undefined,
    b: undefined,
  };
}

export function createBigIntNode(
  ctx: ParserContext,
  current: bigint,
): SerovalBigIntNode {
  assert(ctx.features & Feature.BigInt, 'Unsupported type "BigInt"');
  return {
    t: SerovalNodeType.BigInt,
    i: undefined,
    s: '' + current,
    l: undefined,
    c: undefined,
    m: undefined,
    d: undefined,
    a: undefined,
    f: undefined,
    b: undefined,
  };
}

export function createIndexedValueNode(id: number): SerovalIndexedValueNode {
  return {
    t: SerovalNodeType.IndexedValue,
    i: id,
    s: undefined,
    l: undefined,
    c: undefined,
    m: undefined,
    d: undefined,
    a: undefined,
    f: undefined,
    b: undefined,
  };
}

export function createDateNode(id: number, current: Date): SerovalDateNode {
  return {
    t: SerovalNodeType.Date,
    i: id,
    s: current.toISOString(),
    l: undefined,
    c: undefined,
    m: undefined,
    d: undefined,
    f: undefined,
    a: undefined,
    b: undefined,
  };
}

export function createRegExpNode(id: number, current: RegExp): SerovalRegExpNode {
  return {
    t: SerovalNodeType.RegExp,
    i: id,
    s: undefined,
    l: undefined,
    c: current.source,
    m: current.flags,
    d: undefined,
    a: undefined,
    f: undefined,
    b: undefined,
  };
}

export function createArrayBufferNode(
  id: number,
  current: ArrayBuffer,
): SerovalArrayBufferNode {
  const bytes = new Uint8Array(current);
  const len = bytes.length;
  const values = new Array<number>(len);
  for (let i = 0; i < len; i++) {
    values[i] = bytes[i];
  }
  return {
    t: SerovalNodeType.ArrayBuffer,
    i: id,
    s: values,
    l: undefined,
    c: undefined,
    m: undefined,
    d: undefined,
    a: undefined,
    f: undefined,
    b: undefined,
  };
}

export function serializeArrayBuffer(
  ctx: ParserContext,
  current: ArrayBuffer,
) {
  const id = createIndexedValue(ctx, current);
  if (ctx.markedRefs.has(id)) {
    return createIndexedValueNode(id);
  }
  return createArrayBufferNode(id, current);
}

export function createTypedArrayNode(
  ctx: ParserContext,
  id: number,
  current: TypedArrayValue,
): SerovalTypedArrayNode {
  const constructor = current.constructor.name;
  assert(ctx.features & Feature.TypedArray, `Unsupported value type "${constructor}"`);
  return {
    t: SerovalNodeType.TypedArray,
    i: id,
    s: undefined,
    l: current.length,
    c: constructor,
    m: undefined,
    d: undefined,
    a: undefined,
    f: serializeArrayBuffer(ctx, current.buffer),
    b: current.byteOffset,
  };
}

const BIGINT_FLAG = Feature.BigIntTypedArray | Feature.BigInt;

export function createBigIntTypedArrayNode(
  ctx: ParserContext,
  id: number,
  current: BigIntTypedArrayValue,
): SerovalBigIntTypedArrayNode {
  const constructor = current.constructor.name;
  assert(
    (ctx.features & BIGINT_FLAG) === BIGINT_FLAG,
    `Unsupported value type "${constructor}"`,
  );
  return {
    t: SerovalNodeType.BigIntTypedArray,
    i: id,
    s: undefined,
    l: current.length,
    c: constructor,
    m: undefined,
    d: undefined,
    a: undefined,
    f: serializeArrayBuffer(ctx, current.buffer),
    b: current.byteOffset,
  };
}

export function createWKSymbolNode(
  ctx: ParserContext,
  current: WellKnownSymbols,
): SerovalWKSymbolNode {
  assert(ctx.features & Feature.Symbol, 'Unsupported type "symbol"');
  assert(current in INV_SYMBOL_REF, 'seroval only supports well-known symbols');
  return {
    t: SerovalNodeType.WKSymbol,
    i: undefined,
    s: INV_SYMBOL_REF[current],
    l: undefined,
    c: undefined,
    m: undefined,
    d: undefined,
    a: undefined,
    f: undefined,
    b: undefined,
  };
}

export function createReferenceNode<T>(
  id: number,
  ref: T,
): SerovalReferenceNode {
  return {
    t: SerovalNodeType.Reference,
    i: id,
    s: serializeString(getReferenceID(ref)),
    l: undefined,
    c: undefined,
    m: undefined,
    d: undefined,
    a: undefined,
    f: undefined,
    b: undefined,
  };
}

export function createDataViewNode(
  ctx: ParserContext,
  id: number,
  current: DataView,
): SerovalDataViewNode {
  return {
    t: SerovalNodeType.DataView,
    i: id,
    s: undefined,
    l: current.byteLength,
    c: undefined,
    m: undefined,
    d: undefined,
    a: undefined,
    f: serializeArrayBuffer(ctx, current.buffer),
    b: current.byteOffset,
  };
}
