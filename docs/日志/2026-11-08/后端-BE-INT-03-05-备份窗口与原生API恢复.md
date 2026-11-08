# 后端 / BE-INT-03-05 / 备份窗口与原生 API 恢复

日期：2026-11-08（Asia/Shanghai）
状态：已恢复并完成少量只读核验

## 授权与冻结

- PM 正式开启备份窗口，要求仅停止 BE 拥有的 native 3320，保持官网3317、后台3318、数据库55432；OPS capture 无论成功或失败都立即恢复最新已审构建，原生使用 `MEDIA_DELIVERY=direct`。不执行迁移、不修改数据库或媒体。
- 开窗前 hooks:check 通过；最终25项受审文件、15项编译JS逐一匹配冻结记录。工作树仍未提交，HEAD `61dc7414b20a395d1d09e906a49d974763b3cce7`，其他端改动保留。
- 源清单 `/private/tmp/hd-be-int03-reviewed-files-buckets-media-final.json`，清单SHA256 `0cdffa98931dbb5aef9a37540abd2755bb44555bfe2a0e6ad59bd19ea2f78174`；构建记录在未提交 `docs/private/local-acceptance/int03-buckets-media-build.json`。`dist/app.js` SHA256 `1a1857ef32dd87e9d75814e335cd7be105e0302b2c7080ed3aa461b22c3ce1f2`。

## 停机证据

- 使用现有专用 stop-api helper，先核对PID对应本验收环境的启动参数，再发送正常退出信号；没有按端口批量终止其他进程。
- 18:48:01 确认原PID78646已经退出，3320无监听；3317/PID24614、3318/PID39187、55432/PID41430仍监听。
- 状态记录 `docs/private/local-acceptance/int03-capture-window.json`（600）保存停机时及恢复后的端口快照，当前为 `restored-and-verified`。

## 采集与恢复

- OPS报告capture成功：数据库与150个媒体文件采集到未提交私有目录 `docs/private/ops01/final-real-snapshot`，采集命令耗时0.47秒。这是OPS报告，本轮BE没有自行重做备份或恢复演练。
- 收到成功信号后立即调用专用start-api helper，以 `MEDIA_DELIVERY=direct` 启动已有最新已审成品，没有执行迁移、重构建或数据库／媒体写入。18:49:17开始监听，新PID97911；从18:48:01确认端口关闭到重新监听约76秒。
- 18:50:28完成少量读回：ready、中文公开列表、中文首页、单张原图均200。列表为HD-000008至HD-000015共8车；原图为非空image响应，无内部重定向头且no-store，确认原生direct交付。
- 数据库使用显式只读事务核对：HD-000008至HD-000015均version9、published；HD-000006/7为version7、archived；首页version4。事务结束回滚，只读取版本与状态，不创建登录会话、不改业务或媒体。
- 恢复后3317/PID24614、3318/PID39187、55432/PID41430保持运行，3320对应新PID97911。未执行429耗额测试；实际Nginx图片交付、FE访客身份链与视觉联调仍由相应角色验收。
- 恢复核验时25项受审文件和15项编译指纹全部一致；启用记录更新 `enabledOn3320=true`、native direct。随后仅将接口第11节的运行状态句改成“冻结时未启用、以后查运行日志”，避免冻结文档被当成当前停机状态；实现与15项构建指纹不变。
- [运行交接只读复核](审查-BE-INT-03-05-恢复记录.md)通过：原25项中24项未变，唯一接口状态句经替回旧句的摘要精确比对确认；15项编译文件全部匹配。未为文档状态修正重跑测试或重新构建。
- 更新后的25项运行交接清单 `/private/tmp/hd-be-int03-reviewed-files-runtime-final.json`，SHA256 `6df6857da836a99fa5773b9787ae9ea529f3676e333d047d84c2125dcd75f81d`。原冻结清单、旧审查报告及原构建指纹保留；私有build/window元数据新增runtimeHandoff字段以定位当前文档，源码和构建没有变化。

## 范围

- 此轮仅本机已授权备份配合，不是生产部署；未提交／推送／合并代码。OPS负责真实备份及其验证，BE不伪称已完成capture。
