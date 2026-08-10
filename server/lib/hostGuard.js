// ============================================================
// 出站请求 host 白名单（v9.81 安全加固）
// 服务端所有外部 fetch 统一过此校验：只允许向白名单 host 发起请求。
// 背景：watch/ai/httpProxy/push 等模块按代码拼接 URL 后直连外部（东财行情 / Agnes LLM / 推送网关），
// 服务虽仅监听 127.0.0.1（无外部攻击面），仍需防御纵深——防止未来改动把用户可控字符串拼进 host。
// 用法：assertHostAllowed(url) 在发起请求前调用；不合法抛错（调用方 catch 后降级）。
// v9.86.0（P1-16）：白名单改为从 sources.js 数据源注册表派生（单一事实来源，
//   此前与 proxy.js 重复维护且不一致；废弃域名 search-api-web 已随注册表移除）。
// ============================================================
const { allAllowedHosts } = require("./sources");
const ALLOWED_HOSTS = new Set(allAllowedHosts());

/** 校验 URL 的 host 是否在白名单内；不在则抛错（调用方 catch 后降级） */
function assertHostAllowed(url) {
  let host;
  try {
    host = new URL(url).host;
  } catch {
    throw new Error(`[hostGuard] 非法 URL: ${String(url).slice(0, 64)}`);
  }
  if (!ALLOWED_HOSTS.has(host)) {
    throw new Error(`[hostGuard] 出站 host 不在白名单: ${host}`);
  }
  return url;
}

module.exports = { assertHostAllowed, ALLOWED_HOSTS };
