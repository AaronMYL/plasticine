// 客户端读的构建期环境变量（vite 只把 VITE_ 开头的交给前端）。写出来，读的时候就有类型，不是 any。

interface ImportMetaEnv {
  /** http：连真服务端；fake：内存假实现；不设时生产构建用 http、dev 用 fake（见 api/select-api.ts）。 */
  readonly VITE_PLASTICINE_API?: string;
}
