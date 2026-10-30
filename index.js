import { toTurbovecError } from './errors.js';
import {
  IdMapIndex as NativeIdMapIndex,
  TurboQuantIndex as NativeTurboQuantIndex,
} from './native.js';

const MEMORY_MUTATIONS = new Set(['add', 'addWithIds', 'remove', 'swapRemove']);

function wrapInstance(value, nativeClass) {
  if (!(value instanceof nativeClass)) return value;

  return new Proxy(value, {
    get(target, property) {
      if (property === Symbol.hasInstance) {
        return nativeClass[Symbol.hasInstance].bind(nativeClass);
      }

      let result;
      try {
        result = Reflect.get(target, property, target);
      } catch (error) {
        throw toTurbovecError(error);
      }

      if (typeof result !== 'function') return result;

      return (...args) => {
        try {
          return wrapResult(result.apply(target, args), nativeClass, target, property);
        } catch (error) {
          throw toTurbovecError(error);
        }
      };
    },
  });
}

function syncMemory(target, property) {
  if (!MEMORY_MUTATIONS.has(property)) return;
  target.syncExternalMemory();
}

function wrapResult(result, nativeClass, owner, property) {
  if (result && typeof result.then === 'function') {
    return result.then(
      (value) => {
        syncMemory(owner, property);
        return wrapInstance(value, nativeClass);
      },
      (error) => {
        throw toTurbovecError(error);
      },
    );
  }

  syncMemory(owner, property);
  return wrapInstance(result, nativeClass);
}

function wrapClass(nativeClass) {
  function Wrapped(...args) {
    if (!new.target) {
      throw new TypeError(`Class constructor ${nativeClass.name} cannot be invoked without 'new'`);
    }
    return wrapInstance(Reflect.construct(nativeClass, args), nativeClass);
  }

  Wrapped.prototype = nativeClass.prototype;

  Object.defineProperty(Wrapped, 'fromBytes', {
    configurable: true,
    value: (data) => {
      try {
        const instance = nativeClass.fromBytes(data);
        instance.syncExternalMemory();
        return wrapInstance(instance, nativeClass);
      } catch (error) {
        throw toTurbovecError(error);
      }
    },
    writable: true,
  });

  Object.defineProperty(Wrapped, 'load', {
    configurable: true,
    value: async (path) => {
      try {
        const instance = await nativeClass.load(path);
        instance.syncExternalMemory();
        return wrapInstance(instance, nativeClass);
      } catch (error) {
        throw toTurbovecError(error);
      }
    },
    writable: true,
  });

  Object.setPrototypeOf(Wrapped, nativeClass);

  return Wrapped;
}

export const TurboQuantIndex = wrapClass(NativeTurboQuantIndex);
export const IdMapIndex = wrapClass(NativeIdMapIndex);
