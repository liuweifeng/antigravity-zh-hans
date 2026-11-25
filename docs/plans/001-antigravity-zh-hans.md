# 001 · Antigravity 汉化

## 目标

让 `/Applications/Antigravity.app`（2.35.1）的界面显示简体中文，且不改动签名的
Go 二进制与 app.asar，应用更新后能快速重做。

## 结论（已验证）

Antigravity 没有语言包。界面是 Closure 编译的 Web UI bundle（`main.js` 12.8 MB +
两个 page bundle），zip 嵌在 `Resources/bin/language_server` 里，文案写死在代码中。

`language_server` 自带 `-web_bundle_path`（目录或 zip），优先于内嵌 bundle。
实测：解出 bundle → 改字符串 → 带该参数启动 → `GET /main.js` 返回修改后的内容，HTTP 200。

## 范围

- 提取静态文案：`catalog/strings.json`、`catalog/strings.csv`（3575 条，4551 次出现）。
- 生成汉化 bundle：`tools/patch.mjs`，按 AST 只替换展示型字符串。
- 安装：包装 `language_server`，可一条命令还原。
- 不处理：含 `${}` 的模板字符串（约 2300 个 quasi，多为第三方库），
  动态拼接的句子，以及同时充当路由键的界面名（默认跳过并报告）。

## 决策

1. 用 `-web_bundle_path` 外挂目录，不改二进制、不改 asar：可还原、可版本迭代。
2. 安装方式用 shell 包装脚本，而不是重打包 app.asar：改动面最小，`uninstall` 只做一次 mv。
3. 替换按 AST 节点进行，不做全局字符串替换：避免破坏比较、switch、对象键、选择器。
4. 翻译表以英文字符串为键，跨版本复用；patch 报告未命中条目。

## 步骤

- [x] 定位文案载体（zip in Go binary）
- [x] 验证 `-web_bundle_path` 生效
- [x] 提取并按上下文清洗词表
- [x] AST 安全替换 + 生成 web/
- [x] 包装脚本安装 / 还原，实测服务返回中文
- [x] 翻译全量词表（3575 条 + 补充 2547 条 + 单字 305 条）
- [x] 整句模板支持（templates.json）
- [x] 无头 Chrome 加载页面验证：首页中文正常渲染
- [x] 设置页核对：导航与设置项来自服务端，补运行时覆盖层
- [ ] 逐屏人工校对（弹窗、命令面板）、带动态数字的句子

## 验证记录

- `GET https://127.0.0.1:8899/` → 200，`Serving UI bundle from filesystem: .../web`
- `GET /main.js` → 200，12798660 字节，含「设置」「关闭」「返回」，语法可编译
- 包装脚本 `--stamp` 正常，带真实 Electron 参数启动后同样返回汉化 bundle
- `uninstall.sh` 后原二进制恢复，`--stamp` 正常
- 无头 Chrome 带 bootstrap token 打开首页，文本为「新对话 / 自定义 / 暂无对话 / 设置 /
  嘿，Weifeng，今天想构建点什么？/ 无项目 / 有任何问题尽管问，@ 可提及」，React 正常渲染

## 风险

- 自动更新会替换整个 `.app`，包装脚本失效；重跑 extract/build/install 即可。
- 少数文案同时是路由/枚举键，默认保持英文；强制翻译需同时改两侧。
- 代码签名不受影响（只替换资源目录下的可执行包装脚本），但 macOS 首次启动
  若报「已损坏」，`xattr -dr com.apple.quarantine` 或重新 `codesign -f -s -` 可解。
