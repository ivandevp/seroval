/* eslint-disable no-await-in-loop */
import { BIGINT_FLAG, Feature } from '../compat';
import { serializeString } from '../string';
import type {
  BigIntTypedArrayValue,
  TypedArrayValue,
} from '../../types';
import UnsupportedTypeError from '../UnsupportedTypeError';
import {
  TRUE_NODE,
  FALSE_NODE,
  UNDEFINED_NODE,
  NULL_NODE,
} from '../literals';
import { hasReferenceID } from '../reference';
import {
  getErrorConstructor,
  getObjectFlag,
} from '../shared';
import type {
  SerovalAggregateErrorNode,
  SerovalArrayNode,
  SerovalBlobNode,
  SerovalBoxedNode,
  SerovalCustomEventNode,
  SerovalErrorNode,
  SerovalEventNode,
  SerovalFileNode,
  SerovalFormDataNode,
  SerovalHeadersNode,
  SerovalMapNode,
  SerovalNode,
  SerovalNullConstructorNode,
  SerovalObjectNode,
  SerovalObjectRecordKey,
  SerovalObjectRecordNode,
  SerovalPlainRecordNode,
  SerovalPromiseNode,
  SerovalRequestNode,
  SerovalResponseNode,
  SerovalSetNode,
} from '../types';
import {
  SerovalObjectRecordSpecialKey,
} from '../types';
import { SerovalNodeType } from '../constants';
import {
  createArrayBufferNode,
  createBigIntNode,
  createDateNode,
  createIndexedValueNode,
  createNumberNode,
  createReferenceNode,
  createRegExpNode,
  createStringNode,
} from '../base-primitives';
import { createDOMExceptionNode, createURLNode, createURLSearchParamsNode } from '../web-api';
import promiseToResult from '../promise-to-result';
import {
  createCustomEventOptions,
  createEventOptions,
  createRequestOptions,
  createResponseOptions,
} from '../constructors';
import type { VanillaParserContextOptions } from './vanilla-parser';
import VanillaParserContext from './vanilla-parser';

type ObjectLikeNode =
  | SerovalObjectNode
  | SerovalNullConstructorNode
  | SerovalPromiseNode;

export interface AsyncParserContextOptions extends VanillaParserContextOptions {
  // TODO any options?
}

export default class AsyncParserContext extends VanillaParserContext {
  constructor(options: Partial<AsyncParserContextOptions> = {}) {
    super(options);
  }

  private async parseItems(
    current: unknown[],
  ): Promise<SerovalNode[]> {
    const size = current.length;
    const nodes = new Array<SerovalNode>(size);
    const deferred = new Array<unknown>(size);
    let item: unknown;
    for (let i = 0; i < size; i++) {
      if (i in current) {
        item = current[i];
        if (this.isIterable(item)) {
          deferred[i] = item;
        } else {
          nodes[i] = await this.parse(item);
        }
      }
    }
    for (let i = 0; i < size; i++) {
      if (i in deferred) {
        nodes[i] = await this.parse(deferred[i]);
      }
    }
    return nodes;
  }

  private async parseArray(
    id: number,
    current: unknown[],
  ): Promise<SerovalArrayNode> {
    return {
      t: SerovalNodeType.Array,
      i: id,
      s: undefined,
      l: current.length,
      c: undefined,
      m: undefined,
      p: undefined,
      e: undefined,
      a: await this.parseItems(current),
      f: undefined,
      b: undefined,
      o: getObjectFlag(current),
    };
  }

  private async parseBoxed(
    id: number,
    current: object,
  ): Promise<SerovalBoxedNode> {
    return {
      t: SerovalNodeType.Boxed,
      i: id,
      s: undefined,
      l: undefined,
      c: undefined,
      m: undefined,
      p: undefined,
      e: undefined,
      a: undefined,
      f: await this.parse(current.valueOf()),
      b: undefined,
      o: undefined,
    };
  }

  private async parseProperties(
    properties: Record<string, unknown>,
  ): Promise<SerovalObjectRecordNode> {
    const keys = Object.keys(properties);
    let size = keys.length;
    const keyNodes = new Array<SerovalObjectRecordKey>(size);
    const valueNodes = new Array<SerovalNode>(size);
    const deferredKeys = new Array<SerovalObjectRecordKey>(size);
    const deferredValues = new Array<unknown>(size);
    let deferredSize = 0;
    let nodesSize = 0;
    let item: unknown;
    let escaped: SerovalObjectRecordKey;
    for (const key of keys) {
      item = properties[key];
      escaped = serializeString(key);
      if (this.isIterable(item)) {
        deferredKeys[deferredSize] = escaped;
        deferredValues[deferredSize] = item;
        deferredSize++;
      } else {
        keyNodes[nodesSize] = escaped;
        valueNodes[nodesSize] = await this.parse(item);
        nodesSize++;
      }
    }
    for (let i = 0; i < deferredSize; i++) {
      keyNodes[nodesSize + i] = deferredKeys[i];
      valueNodes[nodesSize + i] = await this.parse(deferredValues[i]);
    }
    if (this.features & Feature.Symbol) {
      if (Symbol.iterator in properties) {
        keyNodes[size] = SerovalObjectRecordSpecialKey.SymbolIterator;
        const items = Array.from(properties as Iterable<unknown>);
        valueNodes[size] = await this.parseArray(
          this.createIndexedValue(items),
          items,
        );
        size++;
      }
    }
    return {
      k: keyNodes,
      v: valueNodes,
      s: size,
    };
  }

  private async parsePlainObject(
    id: number,
    current: Record<string, unknown>,
    empty: boolean,
  ): Promise<ObjectLikeNode> {
    return {
      t: empty ? SerovalNodeType.NullConstructor : SerovalNodeType.Object,
      i: id,
      s: undefined,
      l: undefined,
      c: undefined,
      m: undefined,
      p: await this.parseProperties(current),
      e: undefined,
      a: undefined,
      f: undefined,
      b: undefined,
      o: getObjectFlag(current),
    };
  }

  private async parseError(
    id: number,
    current: Error,
  ): Promise<SerovalErrorNode> {
    const options = this.getErrorOptions(current);
    const optionsNode = options
      ? await this.parseProperties(options)
      : undefined;
    return {
      t: SerovalNodeType.Error,
      i: id,
      s: getErrorConstructor(current),
      l: undefined,
      c: undefined,
      m: serializeString(current.message),
      p: optionsNode,
      e: undefined,
      a: undefined,
      f: undefined,
      b: undefined,
      o: undefined,
    };
  }

  private async parseMap(
    id: number,
    current: Map<unknown, unknown>,
  ): Promise<SerovalMapNode> {
    const len = current.size;
    const keyNodes = new Array<SerovalNode>(len);
    const valueNodes = new Array<SerovalNode>(len);
    const deferredKey = new Array<unknown>(len);
    const deferredValue = new Array<unknown>(len);
    let deferredSize = 0;
    let nodeSize = 0;
    for (const [key, value] of current.entries()) {
      // Either key or value might be an iterable
      if (this.isIterable(key) || this.isIterable(value)) {
        deferredKey[deferredSize] = key;
        deferredValue[deferredSize] = value;
        deferredSize++;
      } else {
        keyNodes[nodeSize] = await this.parse(key);
        valueNodes[nodeSize] = await this.parse(value);
        nodeSize++;
      }
    }
    for (let i = 0; i < deferredSize; i++) {
      keyNodes[nodeSize + i] = await this.parse(deferredKey[i]);
      valueNodes[nodeSize + i] = await this.parse(deferredValue[i]);
    }
    return {
      t: SerovalNodeType.Map,
      i: id,
      s: undefined,
      l: undefined,
      c: undefined,
      m: undefined,
      p: undefined,
      e: { k: keyNodes, v: valueNodes, s: len },
      a: undefined,
      f: undefined,
      b: undefined,
      o: undefined,
    };
  }

  private async parseSet(
    id: number,
    current: Set<unknown>,
  ): Promise<SerovalSetNode> {
    const len = current.size;
    const nodes = new Array<SerovalNode>(len);
    const deferred = new Array<unknown>(len);
    let deferredSize = 0;
    let nodeSize = 0;
    for (const item of current.keys()) {
      // Iterables are lazy, so the evaluation must be deferred
      if (this.isIterable(item)) {
        deferred[deferredSize++] = item;
      } else {
        nodes[nodeSize++] = await this.parse(item);
      }
    }
    // Parse deferred items
    for (let i = 0; i < deferredSize; i++) {
      nodes[nodeSize + i] = await this.parse(deferred[i]);
    }
    return {
      t: SerovalNodeType.Set,
      i: id,
      s: undefined,
      l: len,
      c: undefined,
      m: undefined,
      p: undefined,
      e: undefined,
      a: nodes,
      f: undefined,
      b: undefined,
      o: undefined,
    };
  }

  private async parseBlob(
    id: number,
    current: Blob,
  ): Promise<SerovalBlobNode> {
    return {
      t: SerovalNodeType.Blob,
      i: id,
      s: undefined,
      l: undefined,
      c: serializeString(current.type),
      m: undefined,
      p: undefined,
      e: undefined,
      f: await this.parse(await current.arrayBuffer()),
      a: undefined,
      b: undefined,
      o: undefined,
    };
  }

  private async parseFile(
    id: number,
    current: File,
  ): Promise<SerovalFileNode> {
    return {
      t: SerovalNodeType.File,
      i: id,
      s: undefined,
      l: undefined,
      c: serializeString(current.type),
      m: serializeString(current.name),
      p: undefined,
      e: undefined,
      f: await this.parse(await current.arrayBuffer()),
      a: undefined,
      b: current.lastModified,
      o: undefined,
    };
  }

  private async parsePlainProperties(
    properties: Record<string, unknown>,
  ): Promise<SerovalPlainRecordNode> {
    const keys = Object.keys(properties);
    const size = keys.length;
    const keyNodes = new Array<string>(size);
    const valueNodes = new Array<SerovalNode>(size);
    const deferredKeys = new Array<string>(size);
    const deferredValues = new Array<unknown>(size);
    let deferredSize = 0;
    let nodesSize = 0;
    let item: unknown;
    let escaped: string;
    for (const key of keys) {
      item = properties[key];
      escaped = serializeString(key);
      if (this.isIterable(item)) {
        deferredKeys[deferredSize] = escaped;
        deferredValues[deferredSize] = item;
        deferredSize++;
      } else {
        keyNodes[nodesSize] = escaped;
        valueNodes[nodesSize] = await this.parse(item);
        nodesSize++;
      }
    }
    for (let i = 0; i < deferredSize; i++) {
      keyNodes[nodesSize + i] = deferredKeys[i];
      valueNodes[nodesSize + i] = await this.parse(deferredValues[i]);
    }
    return {
      k: keyNodes,
      v: valueNodes,
      s: size,
    };
  }

  private async parseHeaders(
    id: number,
    current: Headers,
  ): Promise<SerovalHeadersNode> {
    const items: Record<string, string> = {};
    current.forEach((value, key) => {
      items[key] = value;
    });
    return {
      t: SerovalNodeType.Headers,
      i: id,
      s: undefined,
      l: undefined,
      c: undefined,
      m: undefined,
      p: undefined,
      e: await this.parsePlainProperties(items),
      a: undefined,
      f: undefined,
      b: undefined,
      o: undefined,
    };
  }

  private async parseFormData(
    id: number,
    current: FormData,
  ): Promise<SerovalFormDataNode> {
    const items: Record<string, FormDataEntryValue> = {};
    current.forEach((value, key) => {
      items[key] = value;
    });
    return {
      t: SerovalNodeType.FormData,
      i: id,
      s: undefined,
      l: undefined,
      c: undefined,
      m: undefined,
      p: undefined,
      e: await this.parsePlainProperties(items),
      a: undefined,
      f: undefined,
      b: undefined,
      o: undefined,
    };
  }

  private async parseRequest(
    id: number,
    current: Request,
  ): Promise<SerovalRequestNode> {
    return {
      t: SerovalNodeType.Request,
      i: id,
      s: serializeString(current.url),
      l: undefined,
      c: undefined,
      m: undefined,
      p: undefined,
      e: undefined,
      f: await this.parseObject(
        createRequestOptions(current, current.body ? await current.clone().arrayBuffer() : null),
      ),
      a: undefined,
      b: undefined,
      o: undefined,
    };
  }

  private async parseResponse(
    id: number,
    current: Response,
  ): Promise<SerovalResponseNode> {
    return {
      t: SerovalNodeType.Response,
      i: id,
      s: undefined,
      l: undefined,
      c: undefined,
      m: undefined,
      p: undefined,
      e: undefined,
      f: undefined,
      a: [
        current.body
          ? this.parseArrayBuffer(await current.clone().arrayBuffer())
          : NULL_NODE,
        await this.parseObject(createResponseOptions(current)),
      ],
      b: undefined,
      o: undefined,
    };
  }

  private async parseEvent(
    id: number,
    current: Event,
  ): Promise<SerovalEventNode> {
    return {
      t: SerovalNodeType.Event,
      i: id,
      s: serializeString(current.type),
      l: undefined,
      c: undefined,
      m: undefined,
      p: undefined,
      e: undefined,
      a: undefined,
      f: await this.parseObject(createEventOptions(current)),
      b: undefined,
      o: undefined,
    };
  }

  private async parseCustomEvent(
    id: number,
    current: CustomEvent,
  ): Promise<SerovalCustomEventNode> {
    return {
      t: SerovalNodeType.CustomEvent,
      i: id,
      s: serializeString(current.type),
      l: undefined,
      c: undefined,
      m: undefined,
      p: undefined,
      e: undefined,
      a: undefined,
      f: await this.parseObject(createCustomEventOptions(current)),
      b: undefined,
      o: undefined,
    };
  }

  private async parseAggregateError(
    id: number,
    current: AggregateError,
  ): Promise<SerovalAggregateErrorNode> {
    const options = this.getErrorOptions(current);
    const optionsNode = options
      ? await this.parseProperties(options)
      : undefined;
    return {
      t: SerovalNodeType.AggregateError,
      i: id,
      s: undefined,
      l: undefined,
      c: undefined,
      m: serializeString(current.message),
      p: optionsNode,
      e: undefined,
      a: undefined,
      f: undefined,
      b: undefined,
      o: undefined,
    };
  }

  private async parsePromise(
    id: number,
    current: Promise<unknown>,
  ): Promise<SerovalPromiseNode> {
    const [status, result] = await promiseToResult(current);
    return {
      t: SerovalNodeType.Promise,
      i: id,
      s: status,
      l: undefined,
      c: undefined,
      m: undefined,
      p: undefined,
      e: undefined,
      a: undefined,
      f: await this.parse(result),
      b: undefined,
      o: undefined,
    };
  }

  private async parseObject(
    current: object | null,
  ): Promise<SerovalNode> {
    if (!current) {
      return NULL_NODE;
    }
    // Non-primitive values needs a reference ID
    // mostly because the values themselves are stateful
    const id = this.createIndexedValue(current);
    if (this.marked.has(id)) {
      return createIndexedValueNode(id);
    }
    if (hasReferenceID(current)) {
      return createReferenceNode(id, current);
    }
    if (Array.isArray(current)) {
      return this.parseArray(id, current);
    }
    const currentClass = current.constructor;
    switch (currentClass) {
      case Object:
        return this.parsePlainObject(
          id,
          current as Record<string, unknown>,
          false,
        );
      case undefined:
        return this.parsePlainObject(
          id,
          current as Record<string, unknown>,
          true,
        );
      case Date:
        return createDateNode(id, current as unknown as Date);
      case RegExp:
        return createRegExpNode(id, current as unknown as RegExp);
      case Error:
      case EvalError:
      case RangeError:
      case ReferenceError:
      case SyntaxError:
      case TypeError:
      case URIError:
        return this.parseError(id, current as unknown as Error);
      case Number:
      case Boolean:
      case String:
      case BigInt:
        return this.parseBoxed(id, current);
      default:
        break;
    }
    // Typed Arrays
    if (this.features & Feature.TypedArray) {
      switch (currentClass) {
        case ArrayBuffer:
          return createArrayBufferNode(id, current as unknown as ArrayBuffer);
        case Int8Array:
        case Int16Array:
        case Int32Array:
        case Uint8Array:
        case Uint16Array:
        case Uint32Array:
        case Uint8ClampedArray:
        case Float32Array:
        case Float64Array:
          return this.parseTypedArray(id, current as unknown as TypedArrayValue);
        case DataView:
          return this.parseDataView(id, current as unknown as DataView);
        default:
          break;
      }
    }
    // BigInt Typed Arrays
    if ((this.features & BIGINT_FLAG) === BIGINT_FLAG) {
      switch (currentClass) {
        case BigInt64Array:
        case BigUint64Array:
          return this.parseBigIntTypedArray(id, current as unknown as BigIntTypedArrayValue);
        default:
          break;
      }
    }
    // ES Collection
    if (this.features & Feature.Map && currentClass === Map) {
      return this.parseMap(
        id,
        current as unknown as Map<unknown, unknown>,
      );
    }
    if (this.features & Feature.Set && currentClass === Set) {
      return this.parseSet(
        id,
        current as unknown as Set<unknown>,
      );
    }
    // Web APIs
    if (this.features & Feature.WebAPI) {
      switch (currentClass) {
        case URL:
          return createURLNode(id, current as unknown as URL);
        case URLSearchParams:
          return createURLSearchParamsNode(id, current as unknown as URLSearchParams);
        case Blob:
          return this.parseBlob(id, current as unknown as Blob);
        case File:
          return this.parseFile(id, current as unknown as File);
        case Headers:
          return this.parseHeaders(id, current as unknown as Headers);
        case FormData:
          return this.parseFormData(id, current as unknown as FormData);
        case Request:
          return this.parseRequest(id, current as unknown as Request);
        case Response:
          return this.parseResponse(id, current as unknown as Response);
        case Event:
          return this.parseEvent(id, current as unknown as Event);
        case CustomEvent:
          return this.parseCustomEvent(id, current as unknown as CustomEvent);
        case DOMException:
          return createDOMExceptionNode(id, current as unknown as DOMException);
        default:
          break;
      }
    }
    if (
      (this.features & Feature.AggregateError)
      && (currentClass === AggregateError || current instanceof AggregateError)
    ) {
      return this.parseAggregateError(id, current as unknown as AggregateError);
    }
    // Promises
    if (
      (this.features & Feature.Promise)
      && (currentClass === Promise || current instanceof Promise)
    ) {
      return this.parsePromise(id, current as unknown as Promise<unknown>);
    }
    // Slow path. We only need to handle Errors and Iterators
    // since they have very broad implementations.
    if (current instanceof Error) {
      return this.parseError(id, current);
    }
    // Generator functions don't have a global constructor
    // despite existing
    if (this.features & Feature.Symbol && Symbol.iterator in current) {
      return this.parsePlainObject(id, current, !!currentClass);
    }
    throw new UnsupportedTypeError(current);
  }

  async parse<T>(current: T): Promise<SerovalNode> {
    const t = typeof current;
    if (this.features & Feature.BigInt && t === 'bigint') {
      return createBigIntNode(current as bigint);
    }
    switch (t) {
      case 'boolean':
        return current ? TRUE_NODE : FALSE_NODE;
      case 'undefined':
        return UNDEFINED_NODE;
      case 'string':
        return createStringNode(current as string);
      case 'number':
        return createNumberNode(current as number);
      case 'object':
        return this.parseObject(current as object);
      case 'symbol':
        return this.parseSymbol(current as symbol);
      case 'function':
        return this.parseFunction(current);
      default:
        throw new UnsupportedTypeError(current);
    }
  }
}
