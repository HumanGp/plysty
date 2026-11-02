
/**
 * Base class enforcing one instance per concrete subclass.
 *
 * Usage:
 *   class Foo extends Singleton { constructor(opts) { super(); ... } }
 *   const foo = Foo.getInstance(opts);   // first call constructs
 *   Foo.getInstance();                    // returns same instance
 *
 * Notes:
 *  - `super()` must be called first in the subclass ctor.
 *  - State lives on the instance; the *config* is only used on first construction.
 *    Subsequent getInstance(opts) calls ignore opts unless you call `resetInstance()`.
 *  - Subclasses can override `static get instanceKey()` if you ever want
 *    multiple singletons of the same class (keyed by tenant, etc.).
 */
export class Singleton {
  static #registry = new Map();

  constructor() {
    // Prevent direct `new Foo()` — only getInstance() may construct.
    // We check against the concrete subclass's stored class reference,
    // not `this`, so subclass constructors work normally.
    const cls = new.target;
    const record = Singleton.#registry.get(cls);
    if (!record || record.constructing !== true) {
      throw new Error(
        `${cls.name} is a singleton; use ${cls.name}.getInstance() instead of new.`,
      );
    }
  }

  /**
   * Return (or lazily create) the singleton instance for this class.
   * The first call must pass whatever constructor arguments the subclass needs.
   * Later calls ignore arguments.
   *
   * @param {...any} args
   * @returns {InstanceType<typeof this>}
   */
  static getInstance(...args) {
    const cls = this;
    const key = this.instanceKey ?? cls;

    if (!Singleton.#registry.has(key)) {
      const record = { constructing: true, instance: null };
      Singleton.#registry.set(key, record);
      try {
        record.instance = new cls(...args);
      } finally {
        record.constructing = false;
      }
    } else if (Singleton.#registry.get(key).instance === null) {
      // Defensive: previous construction threw; clear and retry once.
      Singleton.#registry.delete(key);
      return cls.getInstance(...args);
    }

    return Singleton.#registry.get(key).instance;
  }

  /** Whether getInstance() has already built the instance. */
  static hasInstance() {
    const key = this.instanceKey ?? this;
    return Singleton.#registry.has(key) && Singleton.#registry.get(key).instance !== null;
  }

  /**
   * Drop the current instance. Next getInstance() constructs a fresh one.
   * Call the subclass's `disconnect()`/`close()` first if it holds resources.
   */
  static resetInstance() {
    const key = this.instanceKey ?? this;
    Singleton.#registry.delete(key);
  }
}
