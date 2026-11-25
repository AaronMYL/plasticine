# 审查清单

提交前自查与评审他人改动共用本清单。自动化项已由 `npm run check` 守卫，以下重点人工核对：

## 模块与结构
- [ ] 新文件放置在职责对应的模块中（见 [structure.md](structure.md)），不随意堆进 `util/` 或 `app/`。
- [ ] 业务规则留在业务包，`state/` 仅做存取，`app/` 仅做路由、校验与响应组装。
- [ ] 单文件单一职责；复用已有函数、组件和令牌，不为未出现的需求预写抽象。

## 代码、注释与类型
- [ ] 外部输入均过 schema 校验；无 `any`，无空 `catch`。
- [ ] 无冗余行内注释、无中文注释；仅在模块/公共接口保留简洁英文 JSDoc；例外行使用英文 `allow-exception: <reason>` 或 `// Invariant: <reason>`。
- [ ] 长任务支持取消（`AbortSignal`），定时器与订阅已清理。

## 测试与数据
- [ ] 新功能与修复均附带英文标题的行为测试，使用真实临时 SQLite，无无条件跳过。
- [ ] `npm run check` 全绿；界面改动已自查桌面与手机截图。
- [ ] 共享 schema 位于 `agent/shared/`；破坏性迁移与接口变更已提前确认并演练；副作用带幂等标识。

## 安全与提交
- [ ] 无密钥、令牌、密码或真人资料泄露（`node scripts/scan-tests.ts` 通过）。
- [ ] Commit 信息为简洁英文（首行 ≤ 72 字符，无中文、无 `Co-Authored-By`），作者 `AaronMYL`。
