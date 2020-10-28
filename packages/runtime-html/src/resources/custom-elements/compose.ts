import { Constructable, nextId, emptyArray, onResolve } from '@aurelia/kernel';
import { BindingMode, LifecycleFlags, bindable } from '@aurelia/runtime';
import { createElement, CompositionPlan } from '../../create-element';
import { IInstruction } from '../../definitions';
import { HydrateElementInstruction, Instruction } from '../../instructions';
import { ControllerVisitor, ICustomElementController, ICustomElementViewModel, IHydratedController, IHydratedParentController, ISyntheticView, MountStrategy } from '../../lifecycle';
import { IPlatform } from '../../platform';
import { getCompositionContext } from '../../templating/composition-context';
import { IViewFactory } from '../../templating/view';
import { customElement, CustomElementDefinition } from '../custom-element';

export type Subject = IViewFactory | ISyntheticView | CompositionPlan | Constructable | CustomElementDefinition;
export type MaybeSubjectPromise = Subject | Promise<Subject> | undefined;

function toLookup(
  acc: Record<string, Instruction>,
  item: IInstruction & { to?: string },
): Record<string, Instruction> {
  const to = item.to;
  if (to !== void 0 && to !== 'subject' && to !== 'composing') {
    acc[to] = item as Instruction;
  }

  return acc;
}

@customElement({ name: 'au-compose', template: null, containerless: true })
export class Compose implements ICustomElementViewModel {
  public readonly id: number = nextId('au$component');

  @bindable public subject?: MaybeSubjectPromise = void 0;
  @bindable({ mode: BindingMode.fromView }) public composing: boolean = false;

  public view?: ISyntheticView = void 0;

  private readonly properties: Record<string, Instruction>;

  private lastSubject?: MaybeSubjectPromise = void 0;

  public readonly $controller!: ICustomElementController<this>; // This is set by the controller after this instance is constructed

  public constructor(
    @IPlatform private readonly p: IPlatform,
    @IInstruction instruction: HydrateElementInstruction,
  ) {
    this.properties = instruction.instructions.reduce(toLookup, {});
  }

  public afterAttach(
    initiator: IHydratedController,
    parent: IHydratedParentController | null,
    flags: LifecycleFlags,
  ): void | Promise<void> {
    const { subject, view } = this;
    if (view === void 0 || this.lastSubject !== subject) {
      this.lastSubject = subject;
      this.composing = true;

      return this.compose(void 0, subject, initiator, flags);
    }

    return this.compose(view, subject, initiator, flags);
  }

  public afterUnbind(
    initiator: IHydratedController,
    parent: IHydratedParentController | null,
    flags: LifecycleFlags,
  ): void | Promise<void> {
    return this.deactivate(this.view, initiator, flags);
  }

  public subjectChanged(
    newValue: Subject | Promise<Subject>,
    previousValue: Subject | Promise<Subject>,
    flags: LifecycleFlags,
  ): void {
    const { $controller } = this;
    if (!$controller.isActive) {
      return;
    }
    if (this.lastSubject === newValue) {
      return;
    }

    this.lastSubject = newValue;
    this.composing = true;

    flags |= $controller.flags;
    const ret = onResolve(
      this.deactivate(this.view, null, flags),
      () => {
        // TODO(fkleuver): handle & test race condition
        return this.compose(void 0, newValue, null, flags);
      },
    );
    if (ret instanceof Promise) { ret.catch(err => { throw err; }); }
  }

  private compose(
    view: ISyntheticView | undefined | Promise<ISyntheticView | undefined>,
    subject: MaybeSubjectPromise,
    initiator: IHydratedController | null,
    flags: LifecycleFlags,
  ): void | Promise<void> {
    return onResolve(
      view === void 0
      ? onResolve(subject, resolvedSubject => {
        return this.resolveView(resolvedSubject, flags);
      })
      : view,
      resolvedView => {
        return this.activate(resolvedView, initiator, flags);
      },
    );
  }

  private deactivate(
    view: ISyntheticView | undefined,
    initiator: IHydratedController | null,
    flags: LifecycleFlags,
  ): void | Promise<void> {
    return view?.deactivate(initiator ?? view, this.$controller, flags);
  }

  private activate(
    view: ISyntheticView | undefined,
    initiator: IHydratedController | null,
    flags: LifecycleFlags,
  ): void | Promise<void> {
    const { $controller } = this;
    return onResolve(
      view?.activate(initiator ?? view, $controller, flags, $controller.scope, $controller.hostScope),
      () => {
        this.composing = false;
      },
    );
  }

  private resolveView(subject: Subject | undefined, flags: LifecycleFlags): ISyntheticView | undefined {
    const view = this.provideViewFor(subject, flags);

    if (view) {
      view.setLocation(this.$controller.projector!.host, MountStrategy.insertBefore);
      view.lockScope(this.$controller.scope);
      return view;
    }

    return void 0;
  }

  private provideViewFor(subject: Subject | undefined, flags: LifecycleFlags): ISyntheticView | undefined {
    if (!subject) {
      return void 0;
    }

    if (isController(subject)) { // IController
      return subject;
    }

    if ('createView' in subject) { // CompositionPlan
      return subject.createView(this.$controller.context!);
    }

    if ('create' in subject) { // IViewFactory
      return subject.create(flags);
    }

    if ('template' in subject) { // Raw Template Definition
      const definition = CustomElementDefinition.getOrCreate(subject);
      return getCompositionContext(definition, this.$controller.context!).getViewFactory().create(flags);
    }

    // Constructable (Custom Element Constructor)
    return createElement(
      this.p,
      subject,
      this.properties,
      this.$controller.projector === void 0
        ? emptyArray
        : this.$controller.projector.children
    ).createView(this.$controller.context!);
  }

  public dispose(): void {
    this.view?.dispose();
    this.view = (void 0)!;
  }

  public accept(visitor: ControllerVisitor): void | true {
    if (this.view?.accept(visitor) === true) {
      return true;
    }
  }
}

function isController(subject: Subject): subject is ISyntheticView {
  return 'lockScope' in subject;
}
