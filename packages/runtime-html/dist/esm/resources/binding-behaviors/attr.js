var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { bindingBehavior } from '@aurelia/runtime';
import { attrAccessor } from '../../observation/data-attribute-accessor.js';
let AttrBindingBehavior = class AttrBindingBehavior {
    bind(flags, _scope, _hostScope, binding) {
        binding.targetObserver = attrAccessor;
    }
    unbind(flags, _scope, _hostScope, binding) {
        return;
    }
};
AttrBindingBehavior = __decorate([
    bindingBehavior('attr')
], AttrBindingBehavior);
export { AttrBindingBehavior };
//# sourceMappingURL=attr.js.map