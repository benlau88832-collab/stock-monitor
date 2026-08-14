// P3-3锛歅WA Service Worker 鈥斺€?绂荤嚎缂撳瓨 + 鍙畨瑁?
// 娉ㄦ剰锛氭湰椤圭洰鏄?vite-plugin-singlefile 鍗曟枃浠朵骇鐗╋紙docs/index.html 鍐呰仈鍏ㄩ儴 JS/CSS锛夛紝
// SW 鍙渶缂撳瓨 index.html 鏈綋鍗冲彲瀹炵幇"绂荤嚎鎵撳紑鏈€杩戜竴娆＄増鏈?銆?
// v9.83.1锛欳ACHE v1鈫抳2 鈥斺€?瑙﹀彂 SW 鏇存柊骞舵竻鎺夋棫缂撳瓨锛坅ctivate 鍒犻櫎闈炲綋鍓?CACHE锛?
// v9.99.1锛欳ACHE v2鈫抳3 鈥斺€?鈶爁etch 鏄惧紡 { cache: "no-store" }锛氭湇鍔＄ ETag + max-age=0 鏃?
//   SW 鐨?fetch() 浼氭嬁鍒?304 鍥為€€ HTTP 纾佺洏缂撳瓨鐨勬棫 body锛坣etwork-first 褰㈠悓铏氳锛屽彂鏂扮増椤甸潰鏃х増 JS 鐨勫潙锛夛紱
//   鈶3 寮哄埗鏃?SW 閫€褰癸紙activate 娓?v2 缂撳瓨锛?
// v9.113.1锛圱1-1锛夛細CACHE v28鈫抳29 鈥斺€?涓婚潰鏉?PG-first 鏀归€犲彂鐗?
// v9.114.0锛圱5-3锛夛細SW 鐗堟湰寮哄埗鏇存柊 鈥斺€?CACHE 鍚?+1 鍚屾椂锛宎ctivate 閫氱煡鎵€鏈夋墦寮€椤甸潰寮哄埗 reload锛?
//   娑堥櫎"闇€纭埛鏂?绾﹀畾锛堟祻瑙堝櫒鍙兘鎸佹棫 SW/鏃ч〉闈紱skipWaiting 宸蹭繚璇佹柊 SW 绔嬪嵆鎺ョ锛?
// v9.122.0锛堝崜瓒?S3-2b锛夛細CACHE v37鈫抳38 鈥斺€?鍓嶇灮棰勫垽鎺ュ叆鍙戠増
// v9.123.0锛堝崜瓒婂鏌ヤ慨澶嶏級锛欳ACHE v38鈫抳39 鈥斺€?鍐崇瓥鍗℃父璧勬垬鏈?璁ょ煡鏃舵/璧勯噾鏄庢殫鐩樺墠绔彛寰勫彂鐗?
// v9.125.0锛堣摑鍥炬壒娆?B锛夛細CACHE v39鈫抳40 鈥斺€?涓偂闆疯揪璧勮鑱氬悎鍖哄彂鐗堬紙v9.124 绾湇鍔＄鏈?+1锛?
// v9.128.0锛堜竴鑷存€у鏌ヤ慨澶嶏級锛欳ACHE v40鈫抳41 鈥斺€?鍐崇瓥鍗￠樁娈靛彛寰?鍐崇瓥绐楀彛杈圭晫/棰滆壊鎯緥鍓嶇鍙戠増
// v9.129.0锛堜竴鑷存€ф敹鏁涢噸鏋勶級锛欳ACHE v41鈫抳42 鈥斺€?鎯呯华浣撶郴鍗曟簮鍖栵紙鎯呯华鍒?闃舵璇嶈〃鍥涢潰鏉垮悓鍙ｅ緞锛?
// v9.130.0锛堢粓瀹′慨澶嶆壒娆★級锛欳ACHE v42鈫抳43 鈥斺€?绔炰环浜旀娴佹按/绔炰环浣滄垬鍖轰笂绉?涓偂鐩戞帶璧勮鑱氬悎
// v9.131.0锛堢粓瀹′慨澶嶆壒娆′簩锛夛細CACHE v43鈫抳44 鈥斺€?鍦烘櫙鐪熷疄鏁版嵁/绾緥鏁欑粌鎺ョ嚎/鎺ㄩ€佸幓閲?
// v9.132.0锛堢粓瀹″鏍?D2 淇锛夛細CACHE v44鈫抳45 鈥斺€?绔炰环涓婅溅鏈轰細鍊欓€夋睜淇
// v9.133.0锛堟父璧勬敼閫犅烽樁娈典竴锛夛細CACHE v45鈫抳46 鈥斺€?涓夋椂娈典綔鎴樺彴甯冨眬鏀舵暃
// v9.135.0锛堟父璧勬敼閫犅烽樁娈典簩~浜旓級锛欳ACHE v46鈫抳47 鈥斺€?浜ゆ槗闂幆/涓荤嚎寰芥爣/闃堝€兼敹鍙?绔炰环琛ュ己
// v9.136.0锛堜氦鎺?0813 浜斾换鍔℃壒娆★級锛氫富绾垮崟婧?闂搁棬鏀舵暃/decisions 濂戠害/鍙拌处闂幆 鍙戠増
// v9.137.0（审查全量修复发布）：CACHE v48→v49 —— AI 大脑审查修复（精灵频率/15:40链/PG工具/反馈闭环/待拍板条/画像卡）
// v9.138.0（波段重构·阶段一）：CACHE v49→v50 —— 波段作战室（方向榜/持仓逻辑/波段决策/业绩日历）+ 超短件降噪
// v9.139.0（阶段二：拆 God Component）：CACHE v50→v51 —— 页面容器+数据hook分层 / 契约单源 / lsMigrate
// v9.140.0（阶段三：景气度深化）：CACHE v51→v52 —— 景气卡+传导链+大宗商品价格条 / 刷新降噪30s
// v9.141.0（#11 推送分层）：CACHE v52→v53 —— 持仓提醒推手机 / 提醒引擎单源化
const CACHE = "stock-monitor-v54";
const CORE = ["./", "./index.html"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      // 娓呯悊鏃х紦瀛橈紙CACHE 鍚嶆瘡娆?+1锛屾棫缂撳瓨涓€寰嬪垹闄わ級
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
      // v9.114.0锛圱5-3锛夛細鏂?SW 婵€娲?= 鏂扮増鏈笂绾?鈫?閫氱煡鎵€鏈夌獥鍙ｅ己鍒跺埛鏂帮紙鏃犵‖鍒锋柊鍗崇敓鏁堬級
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      wins.forEach((c) => c.postMessage({ type: "FORCE_RELOAD" }));
    })()
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  // 浠呯紦瀛樺悓婧愭枃妗?闈欐€佽祫婧愶紱API 璇锋眰涓嶇紦瀛橈紙瀹炴椂鏁版嵁锛?
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  // 缃戠粶浼樺厛锛屽け璐ュ洖閫€缂撳瓨锛堢绾垮彲鐪嬫渶杩戜竴娆＄増鏈級
  // v9.99.1锛歝ache: "no-store" 鈥斺€?缁曡繃 HTTP 纾佺洏缂撳瓨锛圗Tag/max-age=0 鍦烘櫙涓?304 浼氬洖閫€鏃?body锛?
  e.respondWith(
    fetch(req, { cache: "no-store" })
      .then((resp) => {
        if (resp && resp.status === 200) {
          const clone = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, clone)).catch(() => {});
        }
        return resp;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html")))
  );
});
