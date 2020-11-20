import { Constructable } from '@aurelia/kernel';
import type { IWatcher } from './watcher-switcher.js';
export declare type IDepCollectionFn<TType extends object, TReturn = unknown> = (vm: TType, watcher: IWatcher) => TReturn;
export declare type IWatcherCallback<TType extends object, TValue = unknown> = (this: TType, newValue: TValue, oldValue: TValue, vm: TType) => unknown;
export interface IWatchDefinition<T extends object = object> {
    expression: PropertyKey | IDepCollectionFn<T>;
    callback: keyof T | IWatcherCallback<T>;
}
declare type AnyMethod<R = unknown> = (...args: unknown[]) => R;
declare type WatchClassDecorator<T extends object> = <K extends Constructable<T>>(target: K) => void;
declare type WatchMethodDecorator<T> = <R, K extends AnyMethod<R> = AnyMethod<R>>(target: T, key: string | symbol, descriptor: TypedPropertyDescriptor<K>) => TypedPropertyDescriptor<K>;
declare type MethodsOf<Type> = {
    [Key in keyof Type]: Type[Key] extends AnyMethod ? Key : never;
}[keyof Type];
export declare function watch<T extends object, D = unknown>(expressionOrPropertyAccessFn: PropertyKey, changeHandlerOrCallback: MethodsOf<T> | IWatcherCallback<T, D>): WatchClassDecorator<T>;
export declare function watch<T extends object, D = unknown>(expressionOrPropertyAccessFn: IDepCollectionFn<T, D>, changeHandlerOrCallback: MethodsOf<T> | IWatcherCallback<T, D>): WatchClassDecorator<T>;
export declare function watch<T extends object = object, D = unknown>(expressionOrPropertyAccessFn: PropertyKey | IDepCollectionFn<T, D>): WatchMethodDecorator<T>;
export declare const Watch: {
    name: string;
    add(Type: Constructable, definition: IWatchDefinition): void;
    getAnnotation(Type: Constructable): IWatchDefinition[];
};
export {};
//# sourceMappingURL=watch.d.ts.map