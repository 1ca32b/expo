import { ensureNativeModulesAreInstalled } from './requireNativeModule';
ensureNativeModulesAreInstalled();
/**
 * @deprecated Deprecated as of SDK 51 in favor of the default import.
 * @hidden
 */
export const EventEmitter = globalThis.expo.EventEmitter;
/**
 * A class that provides a consistent API for emitting and listening to events.
 * It shares many concepts with other emitter APIs, such as Node's EventEmitter and `fbemitter`.
 * When the event is emitted, all of the functions attached to that specific event are called *synchronously*.
 * Any values returned by the called listeners are *ignored* and discarded.
 * Its implementation is written in C++ and common for all the platforms.
 */
export default globalThis.expo.EventEmitter;
//# sourceMappingURL=EventEmitter.js.map