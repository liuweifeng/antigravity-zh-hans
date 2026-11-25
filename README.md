# antigravity-zh-hans

给 [Antigravity](https://antigravity.google)（Google 的智能体桌面应用，macOS）做简体中文界面的工具链与译文。

当前针对 2.35.1（内置 `language_server` 1.11.0），已验证可正常启动并显示中文。

## Antigravity 没有语言包

- `Resources/app.asar` 只有 Electron 主进程（菜单、托盘），没有正文文案。
- 界面由 `Resources/bin/language_server` 在 `https://127.0.0.1:<port>/` 提供，bundle 是一个
  zip（`main.js` 12.8 MB + 两个 page bundle），嵌在 188 MB 的 Go 二进制里，用 Closure
  Compiler 压缩，英文直接写在代码里。
- 没有 i18next / react-intl / 语言包目录，改系统语言不会改变界面。

## 替换机制

`language_server --help` 里有一个官方开关：

```
-web_bundle_path string
    Directory or .zip holding the compiled web UI to serve, in preference
    to the bundle compiled into this binary.
```

把 bundle 解到目录、改完，再让 `language_server` 带上这个参数即可。不需要改签名、不需要重打包二进制。

`tools/install.sh` 用最小侵入的方式实现：把 `Resources/bin/language_server` 换成同名 shell
包装脚本，转发原有参数并追加 `--web_bundle_path`；原二进制改名为 `language_server.real`。
`tools/uninstall.sh` 一条命令还原。

## 目录

```
bundle/pristine/     从二进制里解出的原始 UI（生成物，不入库）
web/                 套用译文后的 UI（生成物，不入库）
catalog/
  strings.json       提取的静态文案（值、次数、上下文）
  strings.csv        同上，带 zh 空列，便于表格里校对
translations/
  zh-Hans.json       合并后的完整译文（生成物，入库）
  zh-Hans.demo.json  人工精选词条（优先级最高）
  zh-Hans.extra.json 人工补充的界面词条（优先级最高）
  templates.json     含 ${} 的整句模板译文
  allow-presentation.json  允许在展示位置翻译的"同名路由键"白名单
  glossary.md        术语表
tools/
  extract-bundle.mjs   从 language_server 定位并解出 zip
  extract-strings.mjs  提取静态文案，生成 catalog/
  find-missing.mjs     找出还未翻译的界面字符串
  find-templates.mjs   找出需要整句翻译的模板字符串
  merge-translations.mjs  合并批次译文 + 校验占位符
  patch.mjs            按 AST 生成 web/（只改展示位置）
  build.sh             解包 -> 套用 -> 语法自检
  preview.sh           不碰 Antigravity，单独起预览服务
  install.sh           安装（包装 language_server）
  uninstall.sh         还原
docs/plans/            设计与验证记录
```

## 用法

```sh
npm install
node tools/extract-bundle.mjs          # 解出原始 bundle
node tools/merge-translations.mjs      # 合并 work/ 下的批次译文
./tools/build.sh                       # 生成 web/ 并做语法自检

./tools/preview.sh "$PWD/web"          # https://127.0.0.1:8899/（自签证书）
./tools/install.sh "$PWD/web"          # 或装到固定目录，见下
./tools/uninstall.sh
```

安装到固定位置（推荐，仓库移动/删除也不影响）：

```sh
mkdir -p "$HOME/Library/Application Support/Antigravity/zh-web"
rsync -a --delete web/ "$HOME/Library/Application Support/Antigravity/zh-web/"
./tools/install.sh "$HOME/Library/Application Support/Antigravity/zh-web"
```

重启 Antigravity 生效。

## 翻译是怎么套上去的

`patch.mjs` 解析 bundle 的 AST，只替换"展示位置"的字符串：

- `title` / `label` / `description` / `placeholder` / `tooltip` / `aria-label` / children 等；
- `createElement` 的参数、三元/逻辑表达式里的整句、函数参数里的界面文案；
- 含 `${}` 的模板按 `translations/templates.json` 整句替换，要求占位符顺序一致。

不替换：比较运算、`switch` 的测试值、对象键、`id`/`screen`/`name`/`value` 等标识字段、
`className`/`style`、`rel`/`target`/`aria-*` 属性、`data-*`、正则与选择器、`use client` 之类指令。

少数值既是显示文案又是路由/枚举键（例如 `Customizations`、`Projects`），默认跳过；
确认安全后加入 `translations/allow-presentation.json` 即可只翻译展示位置。

### 服务端文案与运行时覆盖层

设置页的导航项、部分设置说明、人设文案和公告来自 Go 的 `language_server`（协议下发），
不在前端 bundle 里，改 bundle 无法覆盖。为此构建时会往 `main.js` 末尾追加一个运行时覆盖层
（`tools/overlay.mjs`）：

- 用完整译文表做精确匹配，替换文本节点与 `aria-label` / `placeholder` / `title` / `alt`；
- `MutationObserver` 跟随 React 重新渲染；
- 跳过 `code` / `pre` / 输入框 / 可编辑区 / Monaco 编辑器，避免动到用户内容和代码。

覆盖层只能整句精确匹配，含动态数字的句子（如"额度将在 5 天 15 小时后刷新"）和数值不同时匹配不到。

## 覆盖率（2.35.1）

- 静态文案：3575 条全部有译文，实际替换 7905 处 / 5948 条不同字符串。
- 补充词表：2547 条界面/设置/提示语（另 1130 条是库内部字符串、CSS、正则等，未翻译）。
- 模板字符串：人工整理 50 条整句（问候语、耗时、计数等）。
- 技术常量按原样保留（identity），合并统计里约 1100 条。

## 已知遗留

- 设置页导航与部分说明来自服务端，靠运行时覆盖层翻译；其中带动态数字的句子匹配不到。
- `Projects`、`Workspaces` 等个别侧栏标题由数组/路由值渲染，可能仍显示英文。
- 少数与 `aria-label` 比较的文案（`Delete`、`Cancel`）保持英文，避免破坏对话框逻辑。
- 含占位符顺序需要调换的模板（如 "{0} for {1}" 译成 "{1} 的 {0}"）暂不支持，只能保持原顺序。
- 自动更新会整体替换 `.app`，包装脚本失效；更新后重跑 extract / merge / build / install。

## 许可

译文与工具为本仓库原创；Antigravity 的界面代码与文案版权归 Google 所有，本仓库不包含其二进制或原始 bundle。
