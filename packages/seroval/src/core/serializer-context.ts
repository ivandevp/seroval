import type { Assignment, FlaggedObject } from './assignments';
import { resolveAssignments, resolveFlags } from './assignments';
import { Feature } from './compat';
import {
  CONSTANT_STRING,
  ERROR_CONSTRUCTOR_STRING,
  SYMBOL_STRING,
  SerovalNodeType,
  SerovalObjectFlags,
} from './constants';
import { REFERENCES_KEY } from './keys';
import type { Plugin, PluginAccessOptions, SerovalMode } from './plugin';
import { isValidIdentifier } from './shared';
import type {
  SerovalArrayNode,
  SerovalIndexedValueNode,
  SerovalNode,
  SerovalObjectRecordKey,
  SerovalObjectRecordNode,
  SerovalReferenceNode,
  SerovalObjectNode,
  SerovalNullConstructorNode,
  SerovalRegExpNode,
  SerovalDateNode,
  SerovalSetNode,
  SerovalMapNode,
  SerovalArrayBufferNode,
  SerovalTypedArrayNode,
  SerovalBigIntTypedArrayNode,
  SerovalDataViewNode,
  SerovalAggregateErrorNode,
  SerovalErrorNode,
  SerovalPromiseNode,
  SerovalWKSymbolNode,
  SerovalURLNode,
  SerovalURLSearchParamsNode,
  SerovalBlobNode,
  SerovalFileNode,
  SerovalHeadersNode,
  SerovalFormDataNode,
  SerovalBoxedNode,
  SerovalRequestNode,
  SerovalResponseNode,
  SerovalEventNode,
  SerovalCustomEventNode,
  SerovalDOMExceptionNode,
  SerovalPluginNode,
  SerovalPromiseConstructorNode,
  SerovalPromiseResolveNode,
  SerovalPromiseRejectNode,
  SerovalReadableStreamConstructorNode,
  SerovalReadableStreamEnqueueNode,
  SerovalReadableStreamErrorNode,
  SerovalReadableStreamCloseNode,
} from './types';
import {
  SerovalObjectRecordSpecialKey,
} from './types';

const NULL_CONSTRUCTOR = 'Object.create(null)';
const SET_CONSTRUCTOR = 'new Set';
const MAP_CONSTRUCTOR = 'new Map';

const PROMISE_RESOLVE = 'Promise.resolve';
const PROMISE_REJECT = 'Promise.reject';

export interface BaseSerializerContextOptions extends PluginAccessOptions {
  features: number;
  markedRefs: number[] | Set<number>;
}

export default abstract class BaseSerializerContext implements PluginAccessOptions {
  /**
   * @private
   */
  features: number;

  /**
   * To check if an object is synchronously referencing itself
   * @private
   */
  stack: number[] = [];

  /**
   * Array of object mutations
   * @private
   */
  flags: FlaggedObject[] = [];

  /**
   * Array of assignments to be done (used for recursion)
   * @private
   */
  assignments: Assignment[] = [];

  plugins?: Plugin<any, any>[] | undefined;

  /**
   * Refs that are...referenced
   * @private
   */
  marked: Set<number>;

  constructor(options: BaseSerializerContextOptions) {
    this.plugins = options.plugins;
    this.features = options.features;
    this.marked = new Set(options.markedRefs);
  }

  abstract readonly mode: SerovalMode;

  /**
   * A tiny function that tells if a reference
   * is to be accessed. This is a requirement for
   * deciding whether or not we should generate
   * an identifier for the object
   */
  protected markRef(id: number): void {
    this.marked.add(id);
  }

  protected isMarked(id: number): boolean {
    return this.marked.has(id);
  }

  /**
   * Converts the ID of a reference into a identifier string
   * that is used to refer to the object instance in the
   * generated script.
   */
  abstract getRefParam(id: number): string;

  protected pushObjectFlag(flag: SerovalObjectFlags, id: number): void {
    if (flag !== SerovalObjectFlags.None) {
      this.markRef(id);
      this.flags.push({
        type: flag,
        value: this.getRefParam(id),
      });
    }
  }

  protected resolvePatches(): string | undefined {
    const assignments = resolveAssignments(this.assignments);
    const flags = resolveFlags(this.flags);
    if (assignments) {
      if (flags) {
        return assignments + flags;
      }
      return assignments;
    }
    return flags;
  }

  /**
   * Generates the inlined assignment for the reference
   * This is different from the assignments array as this one
   * signifies creation rather than mutation
   */
  protected createAssignment(
    source: string,
    value: string,
  ): void {
    this.assignments.push({
      t: 'index',
      s: source,
      k: undefined,
      v: value,
    });
  }

  protected createAddAssignment(
    ref: number,
    value: string,
  ): void {
    this.assignments.push({
      t: 'add',
      s: this.getRefParam(ref),
      k: undefined,
      v: value,
    });
  }

  protected createSetAssignment(
    ref: number,
    key: string,
    value: string,
  ): void {
    this.assignments.push({
      t: 'set',
      s: this.getRefParam(ref),
      k: key,
      v: value,
    });
  }

  protected createArrayAssign(
    ref: number,
    index: number | string,
    value: string,
  ): void {
    this.createAssignment(this.getRefParam(ref) + '[' + index + ']', value);
  }

  protected createObjectAssign(
    ref: number,
    key: string,
    value: string,
  ): void {
    this.markRef(ref);
    this.createAssignment(this.getRefParam(ref) + '.' + key, value);
  }

  /**
   * Seroval dedupes references by keeping only one of the reference,
   * and the rest reusing the id of the original.
   *
   * Normally, since serialization is depth-first process,
   * it should always be able to serialize the original before
   * the other references.
   *
   * However, Seroval also has another mechanism called "assignments" which
   * defers serialization when a reference is made inside a temporal
   * dead zone or when a recursion is detected. Most of the time, assignments
   * will only use the reference not the original, the only exception
   * here is Map which has a key-value pair, so there's a case where
   * only one of the two has the original, the other being a reference
   * that can cause an assignment to occur.
   *
   * `defer` will help us here by serializing the item without assigning
   * it the position it's supposed to be assigned. The next reference
   * will be replaced with the original.
   *
   * Take note that this only matters if the object in question has more than
   * one deduped reference in the entire tree.
   */
  deferred = new Map<number, string>();

  defer(id: number, value: string): void {
    this.deferred.set(id, value);
  }

  /**
   * Checks if the value is in the stack. Stack here is a reference
   * structure to know if a object is to be accessed in a TDZ.
   */
  isIndexedValueInStack(
    node: SerovalNode,
  ): boolean {
    return node.t === SerovalNodeType.IndexedValue && this.stack.includes(node.i);
  }

  protected abstract assignIndexedValue(
    id: number,
    value: string,
  ): string;

  protected serializeReference(
    node: SerovalReferenceNode,
  ): string {
    return this.assignIndexedValue(node.i, REFERENCES_KEY + '.get("' + node.s + '")');
  }

  protected getIterableAccess(): string {
    return this.features & Feature.ArrayPrototypeValues
      ? '.values()'
      : '[Symbol.iterator]()';
  }

  protected serializeIterable(
    node: SerovalNode,
  ): string {
    const parent = this.stack;
    this.stack = [];
    let serialized = this.serialize(node) + this.getIterableAccess();
    this.stack = parent;
    if (this.features & Feature.ArrowFunction) {
      serialized = '[Symbol.iterator]:()=>' + serialized;
    } else if (this.features & Feature.MethodShorthand) {
      serialized = '[Symbol.iterator](){return ' + serialized + '}';
    } else {
      serialized = '[Symbol.iterator]:function(){return ' + serialized + '}';
    }
    return serialized;
  }

  protected serializeArrayItem(
    id: number,
    item: SerovalNode | undefined,
    index: number,
  ): string {
    // Check if index is a hole
    if (item) {
      // Check if item is a parent
      if (this.isIndexedValueInStack(item)) {
        this.markRef(id);
        this.createArrayAssign(id, index, this.getRefParam((item as SerovalIndexedValueNode).i));
        return '';
      }
      return this.serialize(item);
    }
    return '';
  }

  protected serializeArray(
    node: SerovalArrayNode,
  ): string {
    const id = node.i;
    if (node.l) {
      this.stack.push(id);
      // This is different than Map and Set
      // because we also need to serialize
      // the holes of the Array
      const list = node.a;
      let values = this.serializeArrayItem(id, list[0], 0);
      let isHoley = values === '';
      for (let i = 1, len = node.l, item: string; i < len; i++) {
        item = this.serializeArrayItem(id, list[i], i);
        values += ',' + item;
        isHoley = item === '';
      }
      this.stack.pop();
      this.pushObjectFlag(node.o, node.i);
      return this.assignIndexedValue(id, '[' + values + (isHoley ? ',]' : ']'));
    }
    return this.assignIndexedValue(id, '[]');
  }

  protected serializeProperty(
    id: number,
    key: SerovalObjectRecordKey,
    val: SerovalNode,
  ): string {
    // Only reason this is a switch is so that
    // in the future, maybe other Symbols are going
    // to be introduced and/or has merit to be added
    // E.g. Symbol.asyncIterator
    switch (key) {
      case SerovalObjectRecordSpecialKey.SymbolIterator:
        return this.serializeIterable(val);
      default: {
        const check = Number(key);
        // Test if key is a valid number or JS identifier
        // so that we don't have to serialize the key and wrap with brackets
        // eslint-disable-next-line no-self-compare
        const isIdentifier = check >= 0 || check !== check || isValidIdentifier(key);
        if (this.isIndexedValueInStack(val)) {
          const refParam = this.getRefParam((val as SerovalIndexedValueNode).i);
          this.markRef(id);
          if (isIdentifier) {
            this.createObjectAssign(id, key, refParam);
          } else {
            this.createArrayAssign(id, isIdentifier ? key : ('"' + key + '"'), refParam);
          }
          return '';
        }
        return (isIdentifier ? key : ('"' + key + '"')) + ':' + this.serialize(val);
      }
    }
  }

  protected serializeProperties(
    sourceID: number,
    node: SerovalObjectRecordNode,
  ): string {
    const len = node.s;
    if (len) {
      this.stack.push(sourceID);
      const keys = node.k;
      const values = node.v;
      let result = this.serializeProperty(sourceID, keys[0], values[0]);
      for (let i = 1, item = result; i < len; i++) {
        result += (item && ',') + (item = this.serializeProperty(sourceID, keys[i], values[i]));
      }
      this.stack.pop();
      return '{' + result + '}';
    }
    return '{}';
  }

  protected serializeObject(
    node: SerovalObjectNode,
  ): string {
    this.pushObjectFlag(node.o, node.i);
    return this.assignIndexedValue(node.i, this.serializeProperties(node.i, node.p));
  }

  protected serializeWithObjectAssign(
    value: SerovalObjectRecordNode,
    id: number,
    serialized: string,
  ): string {
    const fields = this.serializeProperties(id, value);
    if (fields !== '{}') {
      return 'Object.assign(' + serialized + ',' + fields + ')';
    }
    return serialized;
  }

  protected serializeAssignment(
    sourceID: number,
    mainAssignments: Assignment[],
    key: SerovalObjectRecordKey,
    value: SerovalNode,
  ): void {
    switch (key) {
      case SerovalObjectRecordSpecialKey.SymbolIterator: {
        const parent = this.stack;
        this.stack = [];
        const serialized = this.serialize(value) + this.getIterableAccess();
        this.stack = parent;
        const parentAssignment = this.assignments;
        this.assignments = mainAssignments;
        this.createArrayAssign(
          sourceID,
          'Symbol.iterator',
          this.features & Feature.ArrowFunction
            ? '()=>' + serialized
            : 'function(){return ' + serialized + '}',
        );
        this.assignments = parentAssignment;
      }
        break;
      default: {
        const serialized = this.serialize(value);
        const check = Number(key);
        // Test if key is a valid number or JS identifier
        // so that we don't have to serialize the key and wrap with brackets
        // eslint-disable-next-line no-self-compare
        const isIdentifier = check >= 0 || check !== check || isValidIdentifier(key);
        if (this.isIndexedValueInStack(value)) {
          if (isIdentifier) {
            this.createObjectAssign(sourceID, key, serialized);
          } else {
            this.createArrayAssign(sourceID, isIdentifier ? key : ('"' + key + '"'), serialized);
          }
        } else {
          const parentAssignment = this.assignments;
          this.assignments = mainAssignments;
          if (isIdentifier) {
            this.createObjectAssign(sourceID, key, serialized);
          } else {
            this.createArrayAssign(sourceID, isIdentifier ? key : ('"' + key + '"'), serialized);
          }
          this.assignments = parentAssignment;
        }
      }
    }
  }

  protected serializeAssignments(
    sourceID: number,
    node: SerovalObjectRecordNode,
  ): string | undefined {
    const len = node.s;
    if (len) {
      this.stack.push(sourceID);
      const mainAssignments: Assignment[] = [];
      const keys = node.k;
      const values = node.v;
      for (let i = 0; i < len; i++) {
        this.serializeAssignment(sourceID, mainAssignments, keys[i], values[i]);
      }
      this.stack.pop();
      return resolveAssignments(mainAssignments);
    }
    return undefined;
  }

  protected serializeDictionary(
    i: number,
    p: SerovalObjectRecordNode | undefined,
    init: string,
  ): string {
    if (p) {
      if (this.features & Feature.ObjectAssign) {
        init = this.serializeWithObjectAssign(p, i, init);
      } else {
        this.markRef(i);
        const assignments = this.serializeAssignments(i, p);
        if (assignments) {
          return '(' + this.assignIndexedValue(i, init) + ',' + assignments + this.getRefParam(i) + ')';
        }
      }
    }
    return this.assignIndexedValue(i, init);
  }

  protected serializeNullConstructor(
    node: SerovalNullConstructorNode,
  ): string {
    this.pushObjectFlag(node.o, node.i);
    return this.serializeDictionary(node.i, node.p, NULL_CONSTRUCTOR);
  }

  protected serializeDate(
    node: SerovalDateNode,
  ): string {
    return this.assignIndexedValue(node.i, 'new Date("' + node.s + '")');
  }

  protected serializeRegExp(
    node: SerovalRegExpNode,
  ): string {
    return this.assignIndexedValue(node.i, '/' + node.c + '/' + node.m);
  }

  protected serializeSetItem(
    id: number,
    item: SerovalNode,
  ): string {
    if (this.isIndexedValueInStack(item)) {
      this.markRef(id);
      this.createAddAssignment(id, this.getRefParam((item as SerovalIndexedValueNode).i));
      return '';
    }
    return this.serialize(item);
  }

  protected serializeSet(
    node: SerovalSetNode,
  ): string {
    let serialized = SET_CONSTRUCTOR;
    const size = node.l;
    const id = node.i;
    if (size) {
      const items = node.a;
      this.stack.push(id);
      let result = this.serializeSetItem(id, items[0]);
      for (let i = 1, item = result; i < size; i++) {
        result += (item && ',') + (item = this.serializeSetItem(id, items[i]));
      }
      this.stack.pop();
      if (result) {
        serialized += '([' + result + '])';
      }
    }
    return this.assignIndexedValue(id, serialized);
  }

  protected serializeMapEntry(
    id: number,
    key: SerovalNode,
    val: SerovalNode,
  ): string {
    if (this.isIndexedValueInStack(key)) {
      // Create reference for the map instance
      const keyRef = this.getRefParam(id);
      this.markRef(id);
      // Check if value is a parent
      if (this.isIndexedValueInStack(val)) {
        const valueRef = this.getRefParam((val as SerovalIndexedValueNode).i);
        // Register an assignment since
        // both key and value are a parent of this
        // Map instance
        this.createSetAssignment(id, keyRef, valueRef);
        return '';
      }
      // Reset the stack
      // This is required because the serialized
      // value is no longer part of the expression
      // tree and has been moved to the deferred
      // assignment
      const parent = this.stack;
      this.stack = [];
      if (val.t !== SerovalNodeType.IndexedValue && val.i != null && this.isMarked(val.i)) {
        this.defer(val.i, this.serialize(val));
        this.createSetAssignment(id, keyRef, this.getRefParam(val.i));
      } else {
        this.createSetAssignment(id, keyRef, this.serialize(val));
      }
      this.stack = parent;
      return '';
    }
    if (this.isIndexedValueInStack(val)) {
      // Create ref for the Map instance
      const valueRef = this.getRefParam((val as SerovalIndexedValueNode).i);
      this.markRef(id);
      // Reset stack for the key serialization
      const parent = this.stack;
      this.stack = [];
      if (val.t !== SerovalNodeType.IndexedValue && val.i != null && this.isMarked(val.i)) {
        this.defer(val.i, this.serialize(val));
        this.createSetAssignment(id, this.getRefParam(val.i), valueRef);
      } else {
        this.createSetAssignment(id, this.serialize(key), valueRef);
      }
      this.stack = parent;
      return '';
    }

    return '[' + this.serialize(key) + ',' + this.serialize(val) + ']';
  }

  protected serializeMap(
    node: SerovalMapNode,
  ): string {
    let serialized = MAP_CONSTRUCTOR;
    const size = node.e.s;
    const id = node.i;
    if (size) {
      const keys = node.e.k;
      const vals = node.e.v;
      this.stack.push(id);
      let result = this.serializeMapEntry(id, keys[0], vals[0]);
      for (let i = 1, item = result; i < size; i++) {
        result += (item && ',') + (item = this.serializeMapEntry(id, keys[i], vals[i]));
      }
      this.stack.pop();
      // Check if there are any values
      // so that the empty Map constructor
      // can be used instead
      if (result) {
        serialized += '([' + result + '])';
      }
    }
    return this.assignIndexedValue(id, serialized);
  }

  protected serializeArrayBuffer(
    node: SerovalArrayBufferNode,
  ): string {
    let result = 'new Uint8Array(';
    const buffer = node.s;
    const len = buffer.length;
    if (len) {
      result += '[';
      for (let i = 0; i < len; i++) {
        result += ((i > 0) ? ',' : '') + buffer[i];
      }
      result += ']';
    }
    return this.assignIndexedValue(node.i, result + ').buffer');
  }

  protected serializeTypedArray(
    node: SerovalTypedArrayNode | SerovalBigIntTypedArrayNode,
  ): string {
    return this.assignIndexedValue(
      node.i,
      'new ' + node.c + '(' + this.serialize(node.f) + ',' + node.b + ',' + node.l + ')',
    );
  }

  protected serializeDataView(
    node: SerovalDataViewNode,
  ): string {
    return this.assignIndexedValue(
      node.i,
      'new DataView(' + this.serialize(node.f) + ',' + node.b + ',' + node.l + ')',
    );
  }

  protected serializeAggregateError(
    node: SerovalAggregateErrorNode,
  ): string {
  // Serialize the required arguments
    const id = node.i;
    this.stack.push(id);
    const serialized = 'new AggregateError([],"' + node.m + '")';
    this.stack.pop();
    // `AggregateError` might've been extended
    // either through class or custom properties
    // Make sure to assign extra properties
    return this.serializeDictionary(id, node.p, serialized);
  }

  protected serializeError(
    node: SerovalErrorNode,
  ): string {
    return this.serializeDictionary(node.i, node.p, 'new ' + ERROR_CONSTRUCTOR_STRING[node.s] + '("' + node.m + '")');
  }

  protected serializePromise(
    node: SerovalPromiseNode,
  ): string {
    let serialized: string;
    // Check if resolved value is a parent expression
    const fulfilled = node.f;
    const id = node.i;
    const constructor = node.s ? PROMISE_RESOLVE : PROMISE_REJECT;
    if (this.isIndexedValueInStack(fulfilled)) {
      // A Promise trick, reference the value
      // inside the `then` expression so that
      // the Promise evaluates after the parent
      // has initialized
      const ref = this.getRefParam((fulfilled as SerovalIndexedValueNode).i);
      if (this.features & Feature.ArrowFunction) {
        if (node.s) {
          serialized = constructor + '().then(()=>' + ref + ')';
        } else {
          serialized = constructor + '().catch(()=>{throw ' + ref + '})';
        }
      } else if (node.s) {
        serialized = constructor + '().then(function(){return ' + ref + '})';
      } else {
        serialized = constructor + '().catch(function(){throw ' + ref + '})';
      }
    } else {
      this.stack.push(id);
      const result = this.serialize(fulfilled);
      this.stack.pop();
      // just inline the value/reference here
      serialized = constructor + '(' + result + ')';
    }
    return this.assignIndexedValue(id, serialized);
  }

  protected serializeWKSymbol(
    node: SerovalWKSymbolNode,
  ): string {
    return this.assignIndexedValue(node.i, SYMBOL_STRING[node.s]);
  }

  protected serializeURL(
    node: SerovalURLNode,
  ): string {
    return this.assignIndexedValue(node.i, 'new URL("' + node.s + '")');
  }

  protected serializeURLSearchParams(
    node: SerovalURLSearchParamsNode,
  ): string {
    return this.assignIndexedValue(
      node.i,
      node.s ? 'new URLSearchParams("' + node.s + '")' : 'new URLSearchParams',
    );
  }

  protected serializeBlob(
    node: SerovalBlobNode,
  ): string {
    return this.assignIndexedValue(
      node.i,
      'new Blob([' + this.serialize(node.f) + '],{type:"' + node.c + '"})',
    );
  }

  protected serializeFile(
    node: SerovalFileNode,
  ): string {
    return this.assignIndexedValue(
      node.i,
      'new File([' + this.serialize(node.f) + '],"' + node.m + '",{type:"' + node.c + '",lastModified:' + node.b + '})',
    );
  }

  protected serializeHeaders(
    node: SerovalHeadersNode,
  ): string {
    return this.assignIndexedValue(
      node.i,
      'new Headers(' + this.serializeProperties(node.i, node.e) + ')',
    );
  }

  protected serializeFormDataEntry(id: number, key: string, value: SerovalNode): string {
    return this.getRefParam(id) + '.append("' + key + '",' + this.serialize(value) + ')';
  }

  protected serializeFormDataEntries(
    node: SerovalFormDataNode,
    size: number,
  ): string {
    const keys = node.e.k;
    const vals = node.e.v;
    const id = node.i;
    let result = this.serializeFormDataEntry(id, keys[0], vals[0]);
    for (let i = 1; i < size; i++) {
      result += ',' + this.serializeFormDataEntry(id, keys[i], vals[i]);
    }
    return result;
  }

  protected serializeFormData(
    node: SerovalFormDataNode,
  ): string {
    const size = node.e.s;
    const id = node.i;
    if (size) {
      this.markRef(id);
    }
    const result = this.assignIndexedValue(id, 'new FormData()');
    if (size) {
      const entries = this.serializeFormDataEntries(node, size);
      return '(' + result + ',' + (entries ? entries + ',' : '') + this.getRefParam(id) + ')';
    }
    return result;
  }

  protected serializeBoxed(
    node: SerovalBoxedNode,
  ): string {
    return this.assignIndexedValue(node.i, 'Object(' + this.serialize(node.f) + ')');
  }

  protected serializeRequest(
    node: SerovalRequestNode,
  ): string {
    return this.assignIndexedValue(node.i, 'new Request("' + node.s + '",' + this.serialize(node.f) + ')');
  }

  protected serializeResponse(
    node: SerovalResponseNode,
  ): string {
    return this.assignIndexedValue(
      node.i,
      'new Response(' + this.serialize(node.a[0]) + ',' + this.serialize(node.a[1]) + ')',
    );
  }

  protected serializeEvent(
    node: SerovalEventNode,
  ): string {
    return this.assignIndexedValue(
      node.i,
      'new Event("' + node.s + '",' + this.serialize(node.f) + ')',
    );
  }

  protected serializeCustomEvent(
    node: SerovalCustomEventNode,
  ): string {
    return this.assignIndexedValue(
      node.i,
      'new CustomEvent("' + node.s + '",' + this.serialize(node.f) + ')',
    );
  }

  protected serializeDOMException(
    node: SerovalDOMExceptionNode,
  ): string {
    return this.assignIndexedValue(
      node.i,
      'new DOMException("' + node.s + '","' + node.c + '")',
    );
  }

  protected serializePlugin(
    node: SerovalPluginNode,
  ): string {
    if (this.plugins) {
      for (let i = 0, len = this.plugins.length; i < len; i++) {
        const plugin = this.plugins[i];
        if (plugin.tag === node.c) {
          return plugin.serialize(node.s, this, {
            id: node.i,
          });
        }
      }
    }
    throw new Error('Missing plugin for tag "' + node.c + '".');
  }

  protected abstract serializePromiseConstructor(
    node: SerovalPromiseConstructorNode,
  ): string;

  protected abstract serializePromiseResolve(
    node: SerovalPromiseResolveNode,
  ): string;

  protected abstract serializePromiseReject(
    node: SerovalPromiseRejectNode,
  ): string;

  protected abstract serializeReadableStreamConstructor(
    node: SerovalReadableStreamConstructorNode,
  ): string;

  protected abstract serializeReadableStreamEnqueue(
    node: SerovalReadableStreamEnqueueNode,
  ): string;

  protected abstract serializeReadableStreamError(
    node: SerovalReadableStreamErrorNode,
  ): string;

  protected abstract serializeReadableStreamClose(
    node: SerovalReadableStreamCloseNode,
  ): string;

  serialize(node: SerovalNode): string {
    switch (node.t) {
      case SerovalNodeType.Constant:
        return CONSTANT_STRING[node.s];
      case SerovalNodeType.Number:
        return '' + node.s;
      case SerovalNodeType.String:
        return '"' + node.s + '"';
      case SerovalNodeType.BigInt:
        return node.s + 'n';
      case SerovalNodeType.IndexedValue:
        if (this.deferred.has(node.i)) {
          const result = this.deferred.get(node.i) || '';
          this.deferred.delete(node.i);
          return result;
        }
        return this.getRefParam(node.i);
      case SerovalNodeType.Reference:
        return this.serializeReference(node);
      case SerovalNodeType.Array:
        return this.serializeArray(node);
      case SerovalNodeType.Object:
        return this.serializeObject(node);
      case SerovalNodeType.NullConstructor:
        return this.serializeNullConstructor(node);
      case SerovalNodeType.Date:
        return this.serializeDate(node);
      case SerovalNodeType.RegExp:
        return this.serializeRegExp(node);
      case SerovalNodeType.Set:
        return this.serializeSet(node);
      case SerovalNodeType.Map:
        return this.serializeMap(node);
      case SerovalNodeType.ArrayBuffer:
        return this.serializeArrayBuffer(node);
      case SerovalNodeType.BigIntTypedArray:
      case SerovalNodeType.TypedArray:
        return this.serializeTypedArray(node);
      case SerovalNodeType.DataView:
        return this.serializeDataView(node);
      case SerovalNodeType.AggregateError:
        return this.serializeAggregateError(node);
      case SerovalNodeType.Error:
        return this.serializeError(node);
      case SerovalNodeType.Promise:
        return this.serializePromise(node);
      case SerovalNodeType.WKSymbol:
        return this.serializeWKSymbol(node);
      case SerovalNodeType.URL:
        return this.serializeURL(node);
      case SerovalNodeType.URLSearchParams:
        return this.serializeURLSearchParams(node);
      case SerovalNodeType.Blob:
        return this.serializeBlob(node);
      case SerovalNodeType.File:
        return this.serializeFile(node);
      case SerovalNodeType.Headers:
        return this.serializeHeaders(node);
      case SerovalNodeType.FormData:
        return this.serializeFormData(node);
      case SerovalNodeType.Boxed:
        return this.serializeBoxed(node);
      case SerovalNodeType.PromiseConstructor:
        return this.serializePromiseConstructor(node);
      case SerovalNodeType.PromiseResolve:
        return this.serializePromiseResolve(node);
      case SerovalNodeType.PromiseReject:
        return this.serializePromiseReject(node);
      case SerovalNodeType.ReadableStreamConstructor:
        return this.serializeReadableStreamConstructor(node);
      case SerovalNodeType.ReadableStreamEnqueue:
        return this.serializeReadableStreamEnqueue(node);
      case SerovalNodeType.ReadableStreamError:
        return this.serializeReadableStreamError(node);
      case SerovalNodeType.ReadableStreamClose:
        return this.serializeReadableStreamClose(node);
      case SerovalNodeType.Request:
        return this.serializeRequest(node);
      case SerovalNodeType.Response:
        return this.serializeResponse(node);
      case SerovalNodeType.Event:
        return this.serializeEvent(node);
      case SerovalNodeType.CustomEvent:
        return this.serializeCustomEvent(node);
      case SerovalNodeType.DOMException:
        return this.serializeDOMException(node);
      case SerovalNodeType.Plugin:
        return this.serializePlugin(node);
      default:
        throw new Error('invariant');
    }
  }
}
