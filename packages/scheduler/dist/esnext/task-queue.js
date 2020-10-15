import { createExposedPromise, defaultQueueTaskOptions, } from './types';
import { Task, } from './task';
import { enter, trace, leave, } from './log';
export class TaskQueue {
    constructor(now, priority, scheduler, flushRequestorFactory) {
        this.now = now;
        this.priority = priority;
        this.scheduler = scheduler;
        this.processingSize = 0;
        this.processingHead = void 0;
        this.processingTail = void 0;
        this.suspenderTask = void 0;
        this.pendingAsyncCount = 0;
        this.pendingSize = 0;
        this.pendingHead = void 0;
        this.pendingTail = void 0;
        this.delayedSize = 0;
        this.delayedHead = void 0;
        this.delayedTail = void 0;
        this.flushRequested = false;
        this.yieldPromise = void 0;
        this.taskPool = [];
        this.taskPoolSize = 0;
        this.lastRequest = 0;
        this.microTaskRequestFlushTask = null;
        this.flushRequestor = flushRequestorFactory.create(this);
        this.requestFlush = this.requestFlush.bind(this);
    }
    get isEmpty() {
        return this.processingSize === 0 && this.pendingSize === 0 && this.delayedSize === 0;
    }
    /**
     * Persistent tasks will re-queue themselves indefinitely until they are explicitly canceled,
     * so we consider them 'infinite work' whereas non-persistent (one-off) tasks are 'finite work'.
     *
     * This `hasNoMoreFiniteWork` getters returns true if either all remaining tasks are persistent, or if there are no more tasks.
     *
     * If that is the case, we can resolve the promise that was created when `yield()` is called.
     */
    get hasNoMoreFiniteWork() {
        if (this.pendingAsyncCount > 0) {
            return false;
        }
        let cur = this.processingHead;
        while (cur !== void 0) {
            if (!cur.persistent) {
                return false;
            }
            cur = cur.next;
        }
        cur = this.pendingHead;
        while (cur !== void 0) {
            if (!cur.persistent) {
                return false;
            }
            cur = cur.next;
        }
        cur = this.delayedHead;
        while (cur !== void 0) {
            if (!cur.persistent) {
                return false;
            }
            cur = cur.next;
        }
        return true;
    }
    flush() {
        enter(this, 'flush');
        if (this.microTaskRequestFlushTask !== null) {
            // This may only exist if this is a microtask queue, in which case the macrotask queue is used to poll
            // async task readiness state and/or re-queue persistent microtasks.
            this.microTaskRequestFlushTask.cancel();
            this.microTaskRequestFlushTask = null;
        }
        this.flushRequested = false;
        // Only process normally if we are *not* currently waiting for an async task to finish
        if (this.suspenderTask === void 0) {
            if (this.pendingSize > 0) {
                this.movePendingToProcessing();
            }
            if (this.delayedSize > 0) {
                this.moveDelayedToProcessing();
            }
            let cur;
            while (this.processingSize > 0) {
                cur = this.processingHead;
                cur.run();
                // If it's still running, it can only be an async task
                if (cur.status === 'running') {
                    if (cur.suspend === true) {
                        this.suspenderTask = cur;
                        this.requestFlushClamped();
                        leave(this, 'flush early async');
                        return;
                    }
                    else {
                        ++this.pendingAsyncCount;
                    }
                }
            }
            if (this.pendingSize > 0) {
                this.movePendingToProcessing();
            }
            if (this.delayedSize > 0) {
                this.moveDelayedToProcessing();
            }
            if (this.processingSize > 0) {
                this.requestFlush();
            }
            else if (this.delayedSize > 0 || this.pendingAsyncCount > 0) {
                this.requestFlushClamped();
            }
            if (this.yieldPromise !== void 0 &&
                this.hasNoMoreFiniteWork) {
                const p = this.yieldPromise;
                this.yieldPromise = void 0;
                p.resolve();
            }
        }
        else {
            // If we are still waiting for an async task to finish, just schedule the next flush and do nothing else.
            // Should the task finish before the next flush is invoked,
            // the callback to `completeAsyncTask` will have reset `this.suspenderTask` back to undefined so processing can return back to normal next flush.
            this.requestFlushClamped();
        }
        leave(this, 'flush full');
    }
    /**
     * Cancel the next flush cycle (and/or the macrotask that schedules the next flush cycle, in case this is a microtask queue), if it was requested.
     *
     * This operation is idempotent and will do nothing if no flush is scheduled.
     */
    cancel() {
        enter(this, 'cancel');
        if (this.microTaskRequestFlushTask !== null) {
            this.microTaskRequestFlushTask.cancel();
            this.microTaskRequestFlushTask = null;
        }
        if (this.flushRequested) {
            this.flushRequestor.cancel();
            this.flushRequested = false;
        }
        leave(this, 'cancel');
    }
    /**
     * Returns a promise that, when awaited, resolves when:
     * - all *non*-persistent (including async) tasks have finished;
     * - the last-added persistent task has run exactly once;
     *
     * This operation is idempotent: the same promise will be returned until it resolves.
     *
     * If `yield()` is called multiple times in a row when there are one or more persistent tasks in the queue, each call will await exactly one cycle of those tasks.
     */
    async yield() {
        enter(this, 'yield');
        if (this.isEmpty) {
            leave(this, 'yield empty');
        }
        else {
            if (this.yieldPromise === void 0) {
                trace(this, 'yield - creating promise');
                this.yieldPromise = createExposedPromise();
            }
            await this.yieldPromise;
            leave(this, 'yield task');
        }
    }
    queueTask(callback, opts) {
        enter(this, 'queueTask');
        const { delay, preempt, persistent, reusable, suspend } = { ...defaultQueueTaskOptions, ...opts };
        if (preempt) {
            if (delay > 0) {
                throw new Error(`Invalid arguments: preempt cannot be combined with a greater-than-zero delay`);
            }
            if (persistent) {
                throw new Error(`Invalid arguments: preempt cannot be combined with persistent`);
            }
        }
        if (persistent && this.priority === 0 /* microTask */) {
            throw new Error(`Invalid arguments: cannot queue persistent tasks on the micro task queue`);
        }
        if (this.processingSize === 0) {
            this.requestFlush();
        }
        const time = this.now();
        let task;
        if (reusable) {
            const taskPool = this.taskPool;
            const index = this.taskPoolSize - 1;
            if (index >= 0) {
                task = taskPool[index];
                taskPool[index] = (void 0);
                this.taskPoolSize = index;
                task.reuse(time, delay, preempt, persistent, suspend, callback);
            }
            else {
                task = new Task(this, time, time + delay, preempt, persistent, suspend, reusable, callback);
            }
        }
        else {
            task = new Task(this, time, time + delay, preempt, persistent, suspend, reusable, callback);
        }
        if (preempt) {
            if (this.processingSize++ === 0) {
                this.processingHead = this.processingTail = task;
            }
            else {
                this.processingTail = (task.prev = this.processingTail).next = task;
            }
        }
        else if (delay === 0) {
            if (this.pendingSize++ === 0) {
                this.pendingHead = this.pendingTail = task;
            }
            else {
                this.pendingTail = (task.prev = this.pendingTail).next = task;
            }
        }
        else {
            if (this.delayedSize++ === 0) {
                this.delayedHead = this.delayedTail = task;
            }
            else {
                this.delayedTail = (task.prev = this.delayedTail).next = task;
            }
        }
        leave(this, 'queueTask');
        return task;
    }
    /**
     * Take this task from the taskQueue it's currently queued to, and add it to this queue.
     */
    take(task) {
        enter(this, 'take');
        if (task.status !== 'pending') {
            leave(this, 'take error');
            throw new Error('Can only take pending tasks.');
        }
        if (this.processingSize === 0) {
            this.requestFlush();
        }
        task.taskQueue.remove(task);
        if (task.preempt) {
            this.addToProcessing(task);
        }
        else if (task.queueTime <= this.now()) {
            this.addToPending(task);
        }
        else {
            this.addToDelayed(task);
        }
        leave(this, 'take');
    }
    /**
     * Remove the task from this queue.
     */
    remove(task) {
        enter(this, 'remove');
        if (task.preempt) {
            // Fast path - preempt task can only ever end up in the processing queue
            this.removeFromProcessing(task);
            leave(this, 'remove processing fast');
            return;
        }
        if (task.queueTime > this.now()) {
            // Fast path - task with queueTime in the future can only ever be in the delayed queue
            this.removeFromDelayed(task);
            leave(this, 'remove delayed fast');
            return;
        }
        // Scan everything (we can make this faster by using the queueTime property, but this is good enough for now)
        let cur = this.processingHead;
        while (cur !== void 0) {
            if (cur === task) {
                this.removeFromProcessing(task);
                leave(this, 'remove processing slow');
                return;
            }
            cur = cur.next;
        }
        cur = this.pendingHead;
        while (cur !== void 0) {
            if (cur === task) {
                this.removeFromPending(task);
                leave(this, 'remove pending slow');
                return;
            }
            cur = cur.next;
        }
        cur = this.delayedHead;
        while (cur !== void 0) {
            if (cur === task) {
                this.removeFromDelayed(task);
                leave(this, 'remove delayed slow');
                return;
            }
            cur = cur.next;
        }
        leave(this, 'remove error');
        throw new Error(`Task #${task.id} could not be found`);
    }
    /**
     * Return a reusable task to the shared task pool.
     * The next queued callback will reuse this task object instead of creating a new one, to save overhead of creating additional objects.
     */
    returnToPool(task) {
        trace(this, 'returnToPool');
        this.taskPool[this.taskPoolSize++] = task;
    }
    /**
     * Reset the persistent task back to its pending state, preparing it for being invoked again on the next flush.
     */
    resetPersistentTask(task) {
        enter(this, 'resetPersistentTask');
        task.reset(this.now());
        if (task.createdTime === task.queueTime) {
            if (this.pendingSize++ === 0) {
                this.pendingHead = this.pendingTail = task;
                task.prev = task.next = void 0;
            }
            else {
                this.pendingTail = (task.prev = this.pendingTail).next = task;
                task.next = void 0;
            }
        }
        else {
            if (this.delayedSize++ === 0) {
                this.delayedHead = this.delayedTail = task;
                task.prev = task.next = void 0;
            }
            else {
                this.delayedTail = (task.prev = this.delayedTail).next = task;
                task.next = void 0;
            }
        }
        leave(this, 'resetPersistentTask');
    }
    /**
     * Notify the queue that this async task has had its promise resolved, so that the queue can proceed with consecutive tasks on the next flush.
     */
    completeAsyncTask(task) {
        var _a;
        enter(this, 'completeAsyncTask');
        if (task.suspend === true) {
            if (this.suspenderTask !== task) {
                leave(this, 'completeAsyncTask error');
                throw new Error(`Async task completion mismatch: suspenderTask=${(_a = this.suspenderTask) === null || _a === void 0 ? void 0 : _a.id}, task=${task.id}`);
            }
            this.suspenderTask = void 0;
        }
        else {
            --this.pendingAsyncCount;
        }
        if (this.yieldPromise !== void 0 &&
            this.hasNoMoreFiniteWork) {
            const p = this.yieldPromise;
            this.yieldPromise = void 0;
            p.resolve();
        }
        if (this.isEmpty) {
            this.cancel();
        }
        leave(this, 'completeAsyncTask');
    }
    finish(task) {
        enter(this, 'finish');
        if (task.next !== void 0) {
            task.next.prev = task.prev;
        }
        if (task.prev !== void 0) {
            task.prev.next = task.next;
        }
        leave(this, 'finish');
    }
    removeFromProcessing(task) {
        enter(this, 'removeFromProcessing');
        if (this.processingHead === task) {
            this.processingHead = task.next;
        }
        if (this.processingTail === task) {
            this.processingTail = task.prev;
        }
        --this.processingSize;
        this.finish(task);
        leave(this, 'removeFromProcessing');
    }
    removeFromPending(task) {
        enter(this, 'removeFromPending');
        if (this.pendingHead === task) {
            this.pendingHead = task.next;
        }
        if (this.pendingTail === task) {
            this.pendingTail = task.prev;
        }
        --this.pendingSize;
        this.finish(task);
        leave(this, 'removeFromPending');
    }
    removeFromDelayed(task) {
        enter(this, 'removeFromDelayed');
        if (this.delayedHead === task) {
            this.delayedHead = task.next;
        }
        if (this.delayedTail === task) {
            this.delayedTail = task.prev;
        }
        --this.delayedSize;
        this.finish(task);
        leave(this, 'removeFromDelayed');
    }
    addToProcessing(task) {
        enter(this, 'addToProcessing');
        if (this.processingSize++ === 0) {
            this.processingHead = this.processingTail = task;
        }
        else {
            this.processingTail = (task.prev = this.processingTail).next = task;
        }
        leave(this, 'addToProcessing');
    }
    addToPending(task) {
        enter(this, 'addToPending');
        if (this.pendingSize++ === 0) {
            this.pendingHead = this.pendingTail = task;
        }
        else {
            this.pendingTail = (task.prev = this.pendingTail).next = task;
        }
        leave(this, 'addToPending');
    }
    addToDelayed(task) {
        enter(this, 'addToDelayed');
        if (this.delayedSize++ === 0) {
            this.delayedHead = this.delayedTail = task;
        }
        else {
            this.delayedTail = (task.prev = this.delayedTail).next = task;
        }
        leave(this, 'addToDelayed');
    }
    movePendingToProcessing() {
        enter(this, 'movePendingToProcessing');
        // Add the previously pending tasks to the currently processing tasks
        if (this.processingSize === 0) {
            this.processingHead = this.pendingHead;
            this.processingTail = this.pendingTail;
            this.processingSize = this.pendingSize;
        }
        else {
            this.processingTail.next = this.pendingHead;
            this.processingTail = this.pendingTail;
            this.processingSize += this.pendingSize;
        }
        this.pendingHead = void 0;
        this.pendingTail = void 0;
        this.pendingSize = 0;
        leave(this, 'movePendingToProcessing');
    }
    moveDelayedToProcessing() {
        enter(this, 'moveDelayedToProcessing');
        const time = this.now();
        // Add any delayed tasks whose delay have expired to the currently processing tasks
        const delayedHead = this.delayedHead;
        if (delayedHead.queueTime <= time) {
            let delayedTail = delayedHead;
            let next = delayedTail.next;
            let count = 1;
            while (next !== void 0 && next.queueTime <= time) {
                delayedTail = next;
                next = delayedTail.next;
                ++count;
            }
            if (this.processingSize === 0) {
                this.processingHead = delayedHead;
                this.processingTail = delayedTail;
                this.processingSize = count;
            }
            else {
                this.processingTail.next = delayedHead;
                this.processingTail = delayedTail;
                this.processingSize += count;
            }
            this.delayedHead = next;
            this.delayedSize -= count;
            if (this.delayedSize === 0) {
                this.delayedTail = void 0;
            }
        }
        leave(this, 'moveDelayedToProcessing');
    }
    requestFlush() {
        enter(this, 'requestFlush');
        if (this.microTaskRequestFlushTask !== null) {
            this.microTaskRequestFlushTask.cancel();
            this.microTaskRequestFlushTask = null;
        }
        if (!this.flushRequested) {
            this.flushRequested = true;
            this.lastRequest = this.now();
            this.flushRequestor.request();
        }
        leave(this, 'requestFlush');
    }
    requestFlushClamped() {
        enter(this, 'requestFlushClamped');
        if (this.priority <= 0 /* microTask */) {
            // MicroTasks are not clamped so we have to clamp them with setTimeout or they'll block forever
            this.microTaskRequestFlushTask = this.scheduler.queueMacroTask(this.requestFlush, microTaskRequestFlushTaskOptions);
        }
        else {
            // Otherwise just let this queue handle itself
            this.requestFlush();
        }
        leave(this, 'requestFlushClamped');
    }
}
const microTaskRequestFlushTaskOptions = {
    delay: 0,
    preempt: true,
    persistent: false,
    reusable: true,
    suspend: false,
};
//# sourceMappingURL=task-queue.js.map