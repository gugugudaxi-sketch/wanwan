# 弯弯 Android 本地版

包名 `app.wanwan.personal`，Android 8.0 及以上。网页资源内置，API 地址由用户自行配置。Font Awesome、Dexie 4.0.11、JSZip 3.10.1 内置；Flaticon 字体和用户配置的网络资源仍需要联网。

设置 → Android 保活与消息弹窗：后台保活、系统通知、当前聊天通知、测试通知、电池限制和通知频道入口。原有网页强力保活为音频方案，Android 保活为独立原生前台服务。系统强制停止后不能继续接收消息；该功能不是远程推送服务。

左右水平滑动 85px 以上返回，纵向滚动、多指、输入框、横向滚动区域和桌面分页不拦截。返回调用页面原有按钮，保留保存和清理逻辑。Android 返回键采用相同逻辑。

系统通知来自数据库成功提交的新角色消息，每条独立显示，支持私聊和群聊，导入的旧消息不通知。点击通知进入相应聊天。通知开关默认关闭，测试按钮可以单独请求系统权限。头像优先使用角色头像，没有头像则显示名称首字。系统是否显示横幅由系统通知频道控制。

## 构建

安装 JDK、Python 3、Android SDK platform 35 / build-tools 35 和 Eclipse ECJ。设置 `ANDROID_BUILD_TOOLS`、`ANDROID_JAR`、`ECJ_JAR`、`WANWAN_KEYSTORE`、`WANWAN_STORE_PASS`，可选 `WANWAN_KEY_ALIAS`（默认 wanwan），执行 `python3 android/scripts/build.py`。输出 `android/build/WanWan-1.1.0.apk`。

构建不修改网页源文件，Dexie 与 JSZip 使用内置副本（各自许可证见 vendor）。私钥不提交公开仓库；后续覆盖安装必须使用同一私钥和递增 versionCode。

网页与 APK 使用独立数据空间，需要手动导出并导入存档。不要清除应用数据。

## 本次验证

原生 Java 编译、APK 对齐与 v2/v3 签名校验通过。`android/tests/mobile.cjs` 使用 fake-indexeddb + 实际 Dexie 事务验证左右手势、防误触、私聊/群聊新消息、旧消息/用户消息/回滚事务过滤。运行时设置 `FAKE_INDEXEDDB_MODULE` 指向 fake-indexeddb 模块。

本环境没有可用安卓模拟器，尚未完成安卓真机测试；系统后台策略、通知横幅、文件选择器和覆盖安装应在手机上验证。

## 1.1.0（2026-10-21）

- 引用消息兼容中文/英文引号、全角括号、常见冒号与跨行引用，普通文本仍按换行拆气泡。
- AI 私聊和群聊表情包入库时保存挂载图片；旧私聊消息缺少图片时按需加载挂载库，保留原始消息文字。
- 明确外卖赠送由角色付款、外卖代付由用户付款；赠送消息补齐应用内模拟订单号与配送时间线。不会把代付静默改成赠送，也不进行真实购物或支付。
- 设置新增「提示词与生成参数」：179 项内置模板，覆盖微信、线下见面、NPC、记忆、他的手机、Instagram、iCity、书城、橙光、狼人杀、打工、任意门，以及辅助上下文/格式纠错。支持搜索、分类、原文查看、变量说明、最近填充值、编辑、单项恢复、导入导出。
- 24 个生成入口支持独立覆盖 model、temperature、top_p、max_tokens、frequency_penalty、presence_penalty、系统提示词角色与响应格式。留空保持原功能行为；不同模型支持的参数范围由 API 决定。
- 模板保存至 db.config，同时以 localStorage 作启动镜像。保存模板会重载应用，使模块初始化常量也生效。各会话已有的人设、世界书、心声/状态栏设置仍通过变量动态填入。
- 最近实际请求仅保留在内存，不包含 API 地址/密钥，可能包含用户人设、聊天记录与图片数据；修改配置导出仅含自定义模板和参数。

### 验证

`android/tests/chat-prompts.cjs` 使用 Happy DOM 与 fake-indexeddb，按 index.html 顺序加载全部应用脚本，检查引用、表情包、赠送/代付、179 项模板、覆盖参数真实进入请求体及设置编辑界面。运行需设置 HAPPY_DOM_MODULE 指向 happy-dom/lib/index.js，FAKE_INDEXEDDB_MODULE 指向 fake-indexeddb 模块。

原有 mobile.cjs 手势与通知事务测试通过。对比原模板表达式的默认展开行为（含空值、数字）通过。APK 本地编译、对齐和签名校验通过；没有执行安卓真机或真实付费模型请求测试。
