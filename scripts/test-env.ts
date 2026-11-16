// 测试统一用上海时区（项目规矩）：`npm test` 用 --import 带上这个文件，不靠跑的人记得在命令前写 TZ=Asia/Shanghai。
// 11-15 有一次在美国中部时区的机器上没带时区跑整套检查，一条日期断言差了一天，被误当成偶发失败。
process.env['TZ'] = 'Asia/Shanghai';
