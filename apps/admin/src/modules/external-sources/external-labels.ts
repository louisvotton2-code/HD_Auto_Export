export const externalRoot = '/api/v1/admin/external';
export const languageLabels = { zh: '中文', en: '英文', ru: '俄文' };
export const fieldLabels: Record<string, string> = {
  make: '品牌', model: '车型', trim: '配置', generation: '代际', modelYear: '年款',
  manufacturedAt: '生产日期', firstRegistration: '首次登记', registrationStatus: '登记状态',
  mileageKm: '里程', powertrain: '动力', engineCc: '排量', powerKw: '功率', body: '车身',
  transmission: '变速箱', drivetrain: '驱动', location: '所在地', price: '价格',
  title: '标题', description: '描述', images: '图片', specifications: '规格',
  inspection: '检测', relatedListingUrls: '相关挂牌',
};
export const recordLabels = { applied: '已应用', unchanged: '无变化', ignored: '已忽略', rejected: '已拒绝' };
export const listingLabels = { published: '已展示', hidden: '人工隐藏', withdrawn: '来源已撤回' };
export const batchLabels = { completed: '已完成', completed_with_issues: '已完成，有待处理项' };
export const reasonLabels = {
  invalid_record: '记录结构有误', identity_unconfirmed: '来源身份待确认',
  unsafe_listing_url: '来源链接不符合要求', staff_listing_exists: '与员工已有车源重合',
  stale_revision: '来源版本较旧', revision_conflict: '同一来源版本的内容冲突',
};
export const issueLabels = { missing: '来源缺项', conflict: '来源值冲突', invalid: '来源值无效', expired: '已失效' };
export const pageSize = 25;
