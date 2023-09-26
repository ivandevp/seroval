import { describe, it, expect } from 'vitest';
import {
  compileJSON,
  crossSerialize,
  crossSerializeAsync,
  crossSerializeStream,
  deserialize,
  Feature,
  fromJSON,
  serialize,
  serializeAsync,
  toJSON,
  toJSONAsync,
} from '../src';

describe('Iterable', () => {
  describe('serialize', () => {
    it('supports Iterables', () => {
      const example = {
        title: 'Hello World',
        * [Symbol.iterator](): unknown {
          yield 1;
          yield 2;
          yield 3;
        },
      };
      const result = serialize(example);
      expect(result).toMatchSnapshot();
      const back = deserialize<Iterable<number> & { title: string }>(result);
      expect(back.title).toBe(example.title);
      expect(Symbol.iterator in back).toBeTruthy();
      const iterator = back[Symbol.iterator]();
      expect(iterator.next().value).toBe(1);
      expect(iterator.next().value).toBe(2);
      expect(iterator.next().value).toBe(3);
    });
  });
  describe('serializeAsync', () => {
    it('supports Iterables', async () => {
      const example = Promise.resolve({
        title: 'Hello World',
        * [Symbol.iterator]() {
          yield 1;
          yield 2;
          yield 3;
        },
      });
      const result = await serializeAsync(example);
      expect(result).toMatchSnapshot();
      const back = await deserialize<typeof example>(result);
      expect(back.title).toBe((await example).title);
      expect(Symbol.iterator in back).toBeTruthy();
      const iterator = back[Symbol.iterator]();
      expect(iterator.next().value).toBe(1);
      expect(iterator.next().value).toBe(2);
      expect(iterator.next().value).toBe(3);
    });
  });
  describe('toJSON', () => {
    it('supports Iterables', () => {
      const example = {
        title: 'Hello World',
        * [Symbol.iterator](): unknown {
          yield 1;
          yield 2;
          yield 3;
        },
      };
      const result = toJSON(example);
      expect(JSON.stringify(result)).toMatchSnapshot();
      const back = fromJSON<Iterable<number> & { title: string }>(result);
      expect(back.title).toBe(example.title);
      expect(Symbol.iterator in back).toBeTruthy();
      const iterator = back[Symbol.iterator]();
      expect(iterator.next().value).toBe(1);
      expect(iterator.next().value).toBe(2);
      expect(iterator.next().value).toBe(3);
    });
  });
  describe('toJSONAsync', () => {
    it('supports Iterables', async () => {
      const example = Promise.resolve({
        title: 'Hello World',
        * [Symbol.iterator]() {
          yield 1;
          yield 2;
          yield 3;
        },
      });
      const result = await toJSONAsync(example);
      expect(JSON.stringify(result)).toMatchSnapshot();
      const back = await fromJSON<typeof example>(result);
      expect(back.title).toBe((await example).title);
      expect(Symbol.iterator in back).toBeTruthy();
      const iterator = back[Symbol.iterator]();
      expect(iterator.next().value).toBe(1);
      expect(iterator.next().value).toBe(2);
      expect(iterator.next().value).toBe(3);
    });
  });
  describe('crossSerialize', () => {
    it('supports Iterables', () => {
      const example = {
        title: 'Hello World',
        * [Symbol.iterator](): unknown {
          yield 1;
          yield 2;
          yield 3;
        },
      };
      const result = crossSerialize(example);
      expect(result).toMatchSnapshot();
    });
    describe('scoped', () => {
      it('supports Iterables', () => {
        const example = {
          title: 'Hello World',
          * [Symbol.iterator](): unknown {
            yield 1;
            yield 2;
            yield 3;
          },
        };
        const result = crossSerialize(example, { scopeId: 'example' });
        expect(result).toMatchSnapshot();
      });
    });
  });
  describe('crossSerializeAsync', () => {
    it('supports Iterables', async () => {
      const example = Promise.resolve({
        title: 'Hello World',
        * [Symbol.iterator]() {
          yield 1;
          yield 2;
          yield 3;
        },
      });
      const result = await crossSerializeAsync(example);
      expect(result).toMatchSnapshot();
    });
    describe('scoped', () => {
      it('supports Iterables', async () => {
        const example = Promise.resolve({
          title: 'Hello World',
          * [Symbol.iterator]() {
            yield 1;
            yield 2;
            yield 3;
          },
        });
        const result = await crossSerializeAsync(example, { scopeId: 'example' });
        expect(result).toMatchSnapshot();
      });
    });
  });
  describe('crossSerializeStream', () => {
    it('supports Iterables', async () => new Promise<void>((done) => {
      const example = Promise.resolve({
        title: 'Hello World',
        * [Symbol.iterator]() {
          yield 1;
          yield 2;
          yield 3;
        },
      });
      crossSerializeStream(example, {
        onSerialize(data) {
          expect(data).toMatchSnapshot();
        },
        onDone() {
          done();
        },
      });
    }));
    describe('scoped', () => {
      it('supports Iterables', async () => new Promise<void>((done) => {
        const example = Promise.resolve({
          title: 'Hello World',
          * [Symbol.iterator]() {
            yield 1;
            yield 2;
            yield 3;
          },
        });
        crossSerializeStream(example, {
          scopeId: 'example',
          onSerialize(data) {
            expect(data).toMatchSnapshot();
          },
          onDone() {
            done();
          },
        });
      }));
    });
  });
  describe('compat', () => {
    it('should use Symbol.iterator instead of Array.values.', () => {
      const example = {
        * [Symbol.iterator](): unknown {
          yield example;
        },
      };
      expect(serialize(example, {
        disabledFeatures: Feature.ArrayPrototypeValues,
      })).toMatchSnapshot();
    });
    it('should use method shorthand instead of arrow functions.', () => {
      const example = {
        * [Symbol.iterator](): unknown {
          yield example;
        },
      };
      expect(serialize(example, {
        disabledFeatures: Feature.ArrowFunction,
      })).toMatchSnapshot();
    });
    it('should use functions instead of method shorthand.', () => {
      const example = {
        * [Symbol.iterator](): unknown {
          yield example;
        },
      };
      expect(serialize(example, {
        disabledFeatures: Feature.MethodShorthand | Feature.ArrowFunction,
      })).toMatchSnapshot();
    });
  });
  describe('compat#toJSON', () => {
    it('should use Symbol.iterator instead of Array.values.', () => {
      const example = {
        * [Symbol.iterator](): unknown {
          yield example;
        },
      };
      const result = toJSON(example, {
        disabledFeatures: Feature.ArrayPrototypeValues,
      });
      expect(JSON.stringify(result)).toMatchSnapshot();
      expect(compileJSON(result)).toMatchSnapshot();
    });
    it('should use method shorthand instead of arrow functions.', () => {
      const example = {
        * [Symbol.iterator](): unknown {
          yield example;
        },
      };
      const result = toJSON(example, {
        disabledFeatures: Feature.ArrowFunction,
      });
      expect(JSON.stringify(result)).toMatchSnapshot();
      expect(compileJSON(result)).toMatchSnapshot();
    });
    it('should use functions instead of method shorthand.', () => {
      const example = {
        * [Symbol.iterator](): unknown {
          yield example;
        },
      };
      const result = toJSON(example, {
        disabledFeatures: Feature.MethodShorthand | Feature.ArrowFunction,
      });
      expect(JSON.stringify(result)).toMatchSnapshot();
      expect(compileJSON(result)).toMatchSnapshot();
    });
  });
});
