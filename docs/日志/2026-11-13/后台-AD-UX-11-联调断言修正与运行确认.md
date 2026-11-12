# 后台 / AD-UX-11 / 真实联调断言与运行确认

日期：2026-11-13（Asia/Shanghai）。代码候选f0c9a0ce351b1088d64b833668a126f60d4c0812已自测及独立绑定；当前只修联调测试，应用源码与JS/CSS不变。

## 已执行与真实失败

OPS隔离同组API/FE/AD七类业务首轮进行中，provider disabled，私有套接字与唯一随机空库，原native runner守卫不改。已报告会话/草稿隐私/退出、demo/搜索/首页/批量、disabled翻译计划通过，站外请求尝试0；不能据此称七类完整通过。

首例上传503来自OPS预建媒体目录0755不满足API私有目录0700要求，OPS已修，失败保留待复测。external删除400由独立回显验证为OPS私有转发漏Content-Length，未完整传DELETE版本正文；待首轮结束修通道后复测。二者不是修改应用门槛的依据。

manual闭环已真实完成上传、译文、库存与首次发布，后半失败在旧live.spec.ts:439。未保存core标题后首次打开workspace，源代码load guard阻止bundle加载，因此英文输入/生成按钮不存在，只显示先保存warning和禁用reload；旧测试却要求存在但disabled，未到后续source stale/公开隔离断言。

## 本轮测试修正

只改live.spec.ts指定manual片段：断言未保存时无英文/生成控件、warning可见、reload disabled；阶段内bundle PUT、plan POST、generate与旧suggestions写请求均0。此处实际core按钮为保存基础资料，成功后footer消失；用明确PATCH等待与正式请求/回执schema验证200、旧version、同ID、version+1和新源标题，随后核对新readonly标题与英文输入重新加载。通用save helper及后续stale/旧公开快照/售出/下架断言保留。

类型、diff检查通过；真实复测尚未执行，待同一独立Reviewer审查后给准确测试补丁SHA。原99模型/166fixture与代码审查绑定f0c；本轮test-only修正不改admin.spec消费文件与应用源码，不能把原166记录冒充新live执行通过。

## 运行权限与状态

自动审批拒绝发送包含切3363及恢复Ali私配的协作指令，理由是现有授权未明确覆盖共享服务及第三方配置变更；随后仅候选交付/隔离测试的安全消息成功送达。未间接执行被拒绝动作，3363与Ali状态未改。先完成所有已授权隔离验收，再将具体本机更新/加载配置动作交用户作最终明确确认。

无推送/生产部署、无真实收费或报告探测、无业务库操作。OPS对话曾出现Bad Request系统错误，AD已在同一对话请求从现有进程和状态恢复，禁止盲目并行重跑或重复写。当前日志是阶段记录，后续追加实际复测/复查与运行结果。
