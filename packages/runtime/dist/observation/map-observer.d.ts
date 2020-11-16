import { CollectionKind, ICollectionObserver, IObservedMap, ICollectionIndexObserver, AccessorType, ILifecycle, LifecycleFlags } from '../observation.js';
import { CollectionSizeObserver } from './collection-size-observer.js';
export declare function enableMapObservation(): void;
export declare function disableMapObservation(): void;
export interface MapObserver extends ICollectionObserver<CollectionKind.map> {
}
export declare class MapObserver {
    inBatch: boolean;
    type: AccessorType;
    constructor(lifecycle: ILifecycle, map: IObservedMap);
    notify(): void;
    getLengthObserver(): CollectionSizeObserver;
    getIndexObserver(index: number): ICollectionIndexObserver;
    flushBatch(flags: LifecycleFlags): void;
}
export declare function getMapObserver(lifecycle: ILifecycle, map: IObservedMap): MapObserver;
//# sourceMappingURL=map-observer.d.ts.map