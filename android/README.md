# 弯弯 Android 本地版

包名 `app.wanwan.personal`，Android 8.0 及以上。网页资源内置，API 地址由用户自行配置。Font Awesome、Dexie 4.0.11、JSZip 3.10.1 内置；Flaticon 字体和用户配置的网络资源仍需要联网。

设置 → Android 保活与消息弹窗：后台保活、系统通知、当前聊天通知、测试通知、电池限制和通知频道入口。原有网页强力保活为音频方案，Android 保活为独立原生前台服务。系统强制停止后不能继续接收消息；该功能不是远程推送服务。

左右水平滑动 85px 以上返回，纵向滚动、多指、输入框、横向滚动区域和桌面分页不拦截。返回调用页面原有按钮，保留保存和清理逻辑。Android 返回键采用相同逻辑。

系统通知来自数据库成功提交的新角色消息，每条独立显示，支持私聊和群聊，导入的旧消息不通知。点击通知进入相应聊天。通知开关默认关闭，测试按钮可以单独请求系统权限。头像优先使用角色头像，没有头像则显示名称首字。系统是否显示横幅由系统通知频道控制。

## 构建

安装 JDK、Python 3、Android SDK platform 35 / build-tools 35 和 Eclipse ECJ。设置 `ANDROID_BUILD_TOOLS`、`ANDROID_JAR`、`ECJ_JAR`、`WANWAN_KEYSTORE`、`WANWAN_STORE_PASS`，可选 `WANWAN_KEY_ALIAS`（默认 wanwan），执行 `python3 android/scripts/build.py`。输出 `android/build/WanWan-1.0.0.apk`。

构建不修改网页源文件，Dexie 与 JSZip 使用内置副本（各自许可证见 vendor）。私钥不提交公开仓库；后续覆盖安装必须使用同一私钥和递增 versionCode。

网页与 APK 使用独立数据空间，需要手动导出并导入存档。不要清除应用数据。

## 本次验证

原生 Java 编译、APK 对齐与 v2/v3 签名校验通过。`android/tests/mobile.cjs` 使用 fake-indexeddb + 实际 Dexie 事务验证左右手势、防误触、私聊/群聊新消息、旧消息/用户消息/回滚事务过滤。运行时设置 `FAKE_INDEXEDDB_MODULE` 指向 fake-indexeddb 模块。

本环境没有可用安卓模拟器，尚未完成安卓真机测试；系统后台策略、通知横幅、文件选择器和覆盖安装应在手机上验证。
