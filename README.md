# Antigravity 汉化工作区

对象：`/Applications/Antigravity.app` 2.35.1（Electron 外壳 + Google `language_server` 1.11.0 提供的 Web UI）。

## 结论：没有独立语言包

Antigravity 的界面文案全部编译进 Web UI bundle：

- `Resources/app.asar` 只有 Electron 主进程代码（菜单、托盘），几乎无正文文案。
- 界面由 `Resources/bin/language_server` 在 `https://127.0.0.1:<port>/` 提供。
- 该 bundle 是一个 zip（`main.js` 12.8 MB + `page_agent_bundle.js` + `page_facade_bundle.js`），嵌在 188 MB 的 Go 二进制里，用 Closure Compiler 压缩，英文字符串写死在代码中。
- 没有 i18next / react-intl / 语言包目录，切换系统语言不会改变界面。

## 干净的替换入口

`language_server --help` 里有：

```
-web_bundle_path string
    Directory or .zip holding the compiled web UI to serve, in preference
    to the bundle compiled into this binary.
```

实测：把 bundle 解到目录，改一个字符串，用该参数启动，`https://127.0.0.1:8899/main.js` 返回的就是改过的内容（HTTP 200）。所以汉化不需要改签名、不需要重打包二进制。

## 目录

```
bundle/pristine/     从二进制里解出的原始 UI（供比对 / 重新生成）
web/                 生成的汉化版 UI（install.sh 会指向这里）
catalog/strings.json 提取出的静态文案（值、出现次数、所在文件、上下文）
catalog/strings.csv  同上，带空白的 zh 列，适合表格里翻译
translations/        翻译表 {英文: 中文}
tools/
  extract-bundle.mjs 从 language_server 定位并解出 zip
  extract-strings.mjs 从 bundle 里提取静态文案，生成 catalog/
  patch.mjs          按 AST 只替换展示型字符串，重新生成 web/
  preview.sh         不动 Antigravity，单独起一个预览服务
  install.sh         包装 language_server，让它带 -web_bundle_path
  uninstall.sh       还原
```

## 用法

```sh
npm install
node tools/extract-bundle.mjs                 # 出新版本后重新提取
node tools/patch.mjs --map translations/zh-Hans.json
./tools/preview.sh "$PWD/web"                 # 打开 https://127.0.0.1:8899/
./tools/install.sh "$PWD/web"                 # 装到 Antigravity，重启应用生效
./tools/uninstall.sh                          # 还原
```

`install.sh` 只做一件事：把 `Resources/bin/language_server` 换成同名 shell 包装脚本，
转发参数并追加 `--web_bundle_path`。原二进制改名 `language_server.real`，
`uninstall.sh` 一条命令还原。app.asar 与签名二进制都不动。

## 翻译时的约束

`patch.mjs` 只替换「展示位置」的字符串（title / label / description / placeholder /
aria-label / createElement children 等），比较、switch、对象键、选择器一律不动。

少数值既是显示文案又是路由/枚举键（例如 `Customizations`、`Notifications`、`Code Search`），
两处必须同时改才不破坏导航，而它们的 key 又被注册表 `.get()` 使用，因此默认跳过；
这类值列在 patch 输出的 `left untranslated because app logic compares them` 里。

含 `${}` 的模板字符串暂不处理（`main.js` 里约 2300 个 quasi，多数来自第三方库），
需要时单独做「整句重组」而不是逐段替换。

## 版本升级

Antigravity 自动更新会整体替换 `.app`，包装脚本和汉化目录都会失效。
更新后重跑 `extract-bundle.mjs` + `patch.mjs` + `install.sh` 即可；
翻译表按英文字符串做键，跨版本可复用，patch 会报告未命中的条目。
