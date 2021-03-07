"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PropertyBinding = void 0;
const runtime_1 = require("@aurelia/runtime");
const binding_utils_js_1 = require("./binding-utils.js");
// BindingMode is not a const enum (and therefore not inlined), so assigning them to a variable to save a member accessor is a minor perf tweak
const { oneTime, toView, fromView } = runtime_1.BindingMode;
// pre-combining flags for bitwise checks is a minor perf tweak
const toViewOrOneTime = toView | oneTime;
const updateTaskOpts = {
    reusable: false,
    preempt: true,
};
class PropertyBinding {
    constructor(sourceExpression, target, targetProperty, mode, observerLocator, locator, taskQueue) {
        this.sourceExpression = sourceExpression;
        this.target = target;
        this.targetProperty = targetProperty;
        this.mode = mode;
        this.observerLocator = observerLocator;
        this.locator = locator;
        this.taskQueue = taskQueue;
        this.interceptor = this;
        this.isBound = false;
        this.$scope = void 0;
        this.$hostScope = null;
        this.targetObserver = void 0;
        this.persistentFlags = 0 /* none */;
        this.task = null;
        this.targetSubscriber = null;
    }
    updateTarget(value, flags) {
        flags |= this.persistentFlags;
        this.targetObserver.setValue(value, flags, this.target, this.targetProperty);
    }
    updateSource(value, flags) {
        flags |= this.persistentFlags;
        this.sourceExpression.assign(flags, this.$scope, this.$hostScope, this.locator, value);
    }
    handleChange(newValue, _previousValue, flags) {
        if (!this.isBound) {
            return;
        }
        flags |= this.persistentFlags;
        const targetObserver = this.targetObserver;
        const interceptor = this.interceptor;
        const sourceExpression = this.sourceExpression;
        const $scope = this.$scope;
        const locator = this.locator;
        // Alpha: during bind a simple strategy for bind is always flush immediately
        // todo:
        //  (1). determine whether this should be the behavior
        //  (2). if not, then fix tests to reflect the changes/platform to properly yield all with aurelia.start()
        const shouldQueueFlush = (flags & 2 /* fromBind */) === 0 && (targetObserver.type & 4 /* Layout */) > 0;
        const obsRecord = this.obs;
        // if the only observable is an AccessScope then we can assume the passed-in newValue is the correct and latest value
        if (sourceExpression.$kind !== 10082 /* AccessScope */ || obsRecord.count > 1) {
            // todo: in VC expressions, from view also requires connect
            const shouldConnect = this.mode > oneTime;
            if (shouldConnect) {
                obsRecord.version++;
            }
            newValue = sourceExpression.evaluate(flags, $scope, this.$hostScope, locator, interceptor);
            if (shouldConnect) {
                obsRecord.clear(false);
            }
        }
        if (shouldQueueFlush) {
            // Queue the new one before canceling the old one, to prevent early yield
            const task = this.task;
            this.task = this.taskQueue.queueTask(() => {
                interceptor.updateTarget(newValue, flags);
                this.task = null;
            }, updateTaskOpts);
            task === null || task === void 0 ? void 0 : task.cancel();
        }
        else {
            interceptor.updateTarget(newValue, flags);
        }
    }
    $bind(flags, scope, hostScope) {
        var _a;
        if (this.isBound) {
            if (this.$scope === scope) {
                return;
            }
            this.interceptor.$unbind(flags | 2 /* fromBind */);
        }
        // Force property binding to always be strict
        flags |= 1 /* isStrictBindingStrategy */;
        // Store flags which we can only receive during $bind and need to pass on
        // to the AST during evaluate/connect/assign
        this.persistentFlags = flags & 961 /* persistentBindingFlags */;
        this.$scope = scope;
        this.$hostScope = hostScope;
        let sourceExpression = this.sourceExpression;
        if (sourceExpression.hasBind) {
            sourceExpression.bind(flags, scope, hostScope, this.interceptor);
        }
        const $mode = this.mode;
        let targetObserver = this.targetObserver;
        if (!targetObserver) {
            const observerLocator = this.observerLocator;
            if ($mode & fromView) {
                targetObserver = observerLocator.getObserver(this.target, this.targetProperty);
            }
            else {
                targetObserver = observerLocator.getAccessor(this.target, this.targetProperty);
            }
            this.targetObserver = targetObserver;
        }
        // during bind, binding behavior might have changed sourceExpression
        // deepscan-disable-next-line
        sourceExpression = this.sourceExpression;
        const interceptor = this.interceptor;
        const shouldConnect = ($mode & toView) > 0;
        if ($mode & toViewOrOneTime) {
            interceptor.updateTarget(sourceExpression.evaluate(flags, scope, this.$hostScope, this.locator, shouldConnect ? interceptor : null), flags);
        }
        if ($mode & fromView) {
            targetObserver.subscribe((_a = this.targetSubscriber) !== null && _a !== void 0 ? _a : (this.targetSubscriber = new binding_utils_js_1.BindingTargetSubscriber(interceptor)));
            if (!shouldConnect) {
                interceptor.updateSource(targetObserver.getValue(this.target, this.targetProperty), flags);
            }
        }
        this.isBound = true;
    }
    $unbind(flags) {
        if (!this.isBound) {
            return;
        }
        this.persistentFlags = 0 /* none */;
        if (this.sourceExpression.hasUnbind) {
            this.sourceExpression.unbind(flags, this.$scope, this.$hostScope, this.interceptor);
        }
        this.$scope = void 0;
        this.$hostScope = null;
        const task = this.task;
        if (this.targetSubscriber) {
            this.targetObserver.unsubscribe(this.targetSubscriber);
        }
        if (task != null) {
            task.cancel();
            this.task = null;
        }
        this.obs.clear(true);
        this.isBound = false;
    }
}
exports.PropertyBinding = PropertyBinding;
runtime_1.connectable(PropertyBinding);
//# sourceMappingURL=property-binding.js.map