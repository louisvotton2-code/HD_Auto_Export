# AD-EXT-06 员工操作追溯

2026-11-13。角色AD，共同基线 `8523c851fe7cc64a4c32ea428ea7a293d6501510`；独立工作树 `docs/private/ad-ext06-worktree`，分支 `codex/admin-ext06`。未修改根目录既有脏树。正式契约采用BE `272380280d4d3cd2f9f96c5206e77231de5bae61`，本分支等价cherry-pick `b3deb35`；继续接BE第二／三切片abe74a5／6e177e8（本树等价2f79538／fac1815）；API实现由BE提供，OPS唯一集成人。

## 范围

- 新 `modules/activity` 复用正式摘要、事件与游标schema，不另造DTO。
- 员工车辆列表／回收站／详情、三方目录／详情提供只读历史；read角色不需进入write编辑器。
- 创建与最近人工修改、首次系统导入／批次与最近同步独立。历史姓名＋稳定ID、北京时间与UTC原值、版本和字段差异可展开。
- 只展示BE给出的差异；未知／无差异、null／未记录／空串／false／0分别显示，完整文本及稳定图片ID无截断，不执行HTML或URL。
- 关闭／换车／401中止读取、清除或隔离旧数据，403与读取失败不伪装无历史；刷新回第一页，查看不改变本地未保存输入。
- 无账号管理／审计写入／自动翻译／导入／持续调度新动作。正式导入状态已接ingestion-status：raw／canonical／public及received／applied独立，只有读取成功才显示调度关闭；旧样本批次另列。供应商原档按需目录／正文读取，包含hash、语言、类型和历史时间；共享bulk只显示hash，全文作为文本／JSON，不执行HTML或URL。

## 自测与限制

本机Node24及pnpm使用既有私有runtime。开工hooks:check通过，依赖由OPS唯一串行离线安装，锁文件未变。后台类型、103单元、构建通过。新6项浏览器契约模拟曾因测试选择器、关闭按钮中文名称和summary fixture缺字段失败，保留失败日志；修正后6/6通过，补充中文字段标签后的最终成品6/6复测通过；workspace28项与静态边界通过，桌面／320截图已检查，3319释放。

证据在忽略目录 `docs/private/ad-ext06-evidence/`：admin-check*.log、admin-build*.log、activity-browser*.log及桌面／320截图。首次受限端口EPERM未启动服务；随后授权的隔离3319浏览器测试仅拦截合成API，不访问真实员工／车源或付费翻译。它不证明BE事务、身份伪造、409／回放和生产权限通过；两隔离员工真实验收由BE／OPS完成。

初次独立Reviewer ad_ext06_review发现1项P2：员工维护的external副本不应隐藏创建员工／时间。已区分员工车辆与自动挂牌入口，补列表／详情／回收站定向测试，同一Reviewer复查关闭，新增部分未发现可确认P0／P1／P2。

第二／三切片后重跑类型、103单元及构建通过；新9项浏览器加3项受影响旧页面回归首轮10过2失败：external副本测试错误使用公开报价fixture、原档目录网格窄屏横溢。前者改用正式external fixture，后者补minmax(0,1fr)及子项min-width约束；修复后12/12通过，保留失败证据。原档测试覆盖按需读取、完整长正文、安全文本、跨页清旧值、404重试、null及401清除。最终证据以admin-check-complete.log、admin-build-complete-r2.log、activity-browser-complete-r2.log为准。

同一独立Reviewer已审全部26个AD文件，初审P2关闭；新读接口消费者未发现可确认问题。截图输出采用Playwright本轮输出目录，避免绑定本机绝对路径；此测试输出位置调整后的类型检查及单项浏览器复测通过（activity-evidence-output-check.log），仍需最终SHA绑定。尚未推送、集成或部署，本地提交及准确SHA由私有AD-handoff记录。真实BE／双员工和生产验收未执行，不把模拟写成真实完成。总进度由PM／OPS汇总。
