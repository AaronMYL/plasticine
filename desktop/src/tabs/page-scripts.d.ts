declare module 'plasticine:page-scripts' {
  export function circlePage(): Promise<string | null>;
  export function pageOperate(request: unknown): Promise<string>;
}
