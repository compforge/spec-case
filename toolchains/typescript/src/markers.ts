export interface CaseOptions {
  input?: string;
  expect?: string;
  forbid?: string;
}

export interface TmpOptions {
  until?: string;
}

export interface SpecOptions {
  id?: string;
}

/** A no-op decorator accepted on classes and class methods. */
export interface SymbolDecorator {
  <Class extends abstract new (...args: never[]) => unknown>(
    value: Class,
    context: ClassDecoratorContext<Class>,
  ): void;
  <This, Args extends unknown[], Result>(
    value: (this: This, ...args: Args) => Result,
    context: ClassMethodDecoratorContext<
      This,
      (this: This, ...args: Args) => Result
    >,
  ): void;
}

const NOOP_DECORATOR = (() => undefined) as SymbolDecorator;

export function Spec(
  _text: string,
  _options: SpecOptions = {},
): SymbolDecorator {
  return NOOP_DECORATOR;
}

export function Case(
  _id: string,
  _desc: string,
  _options: CaseOptions = {},
): SymbolDecorator {
  return NOOP_DECORATOR;
}

export function Why(_text: string): SymbolDecorator {
  return NOOP_DECORATOR;
}

export function Ideal(_text: string): SymbolDecorator {
  return NOOP_DECORATOR;
}

/** A temporary measure with an optional exit condition; no runtime behavior. */
export function Tmp(_text: string, _options: TmpOptions = {}): SymbolDecorator {
  return NOOP_DECORATOR;
}

export function Link(_ref: string): SymbolDecorator {
  return NOOP_DECORATOR;
}

export function Rule(_text: string): SymbolDecorator {
  return NOOP_DECORATOR;
}
