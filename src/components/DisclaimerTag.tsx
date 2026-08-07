// 合规免责标签（v9.18-T2）
// 统一在每个给出倾向性结论的卡片标题旁加小字免责标注
// 用途：替代"只在页面底部集中声明"，降低"荐股"合规风险
export default function DisclaimerTag({ text = "仅供参考，不构成投资建议" }: { text?: string }) {
  return (
    <span className="ml-1 text-xs text-slate-600" title="本标签用于提示：以下内容为数据统计与历史规律参考，不构成任何投资建议">
      · {text}
    </span>
  );
}
