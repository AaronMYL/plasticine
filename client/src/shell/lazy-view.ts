import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

type Loaded<P> = { default: ComponentType<P> };

const loaders: Array<() => Promise<unknown>> = [];

function pick<P>(module: Record<string, unknown>, name: string): ComponentType<P> {
  const component = module[name];
  if (typeof component !== 'function') {
    throw new Error(`懒加载的模块里没有「${name}」这个组件`);
  }
  return component as ComponentType<P>;
}

function settled<P>(value: Loaded<P>): Promise<Loaded<P>> {
  const thenable = {
    then(onFulfilled?: ((value: Loaded<P>) => unknown) | null): unknown {
      onFulfilled?.(value);
      return thenable;
    },
  };
  return thenable as unknown as Promise<Loaded<P>>;
}

export function lazyView<P extends object>(
  load: () => Promise<Record<string, unknown>>,
  name: string,
): LazyExoticComponent<ComponentType<P>> {
  let cached: ComponentType<P> | undefined;
  const resolve = async (): Promise<Loaded<P>> => {
    cached = pick<P>(await load(), name);
    return { default: cached };
  };
  loaders.push(resolve);
  return lazy(() => (cached === undefined ? resolve() : settled({ default: cached })));
}

export async function preloadLazyViews(): Promise<void> {
  await Promise.all(loaders.map((load) => load()));
}

