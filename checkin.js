const https = require("https");
const http = require("http");
const querystring = require("querystring");
const { URL } = require("url");

// ========== 配置 ==========
// 从环境变量读取账号密码（GitHub Secrets），本地测试可直接修改默认值
const EMAIL = process.env.DOUNAI_EMAIL;
const PASSWD = process.env.DOUNAI_PASSWD;

const BASE_URL = "https://dounai.pro";

// ========== 工具函数 ==========

/**
 * 发送 HTTP/HTTPS 请求
 */
function request(method, urlStr, opts = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const transport = url.protocol === "https:" ? https : http;

    const headers = {
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Accept-Language": "zh-CN,zh;q=0.9",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "X-Requested-With": "XMLHttpRequest",
      ...(opts.headers || {}),
    };

    if (opts.body && typeof opts.body === "string") {
      headers["Content-Type"] =
        headers["Content-Type"] ||
        "application/x-www-form-urlencoded; charset=UTF-8";
      headers["Content-Length"] = Buffer.byteLength(opts.body);
    }

    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers,
      rejectUnauthorized: false,
    };

    const req = transport.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        // 收集 set-cookie
        const cookies = res.headers["set-cookie"] || [];
        resolve({
          status: res.statusCode,
          headers: res.headers,
          cookies,
          body: data,
        });
      });
    });

    req.on("error", (err) => reject(err));
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error("请求超时"));
    });

    if (opts.body) {
      req.write(opts.body);
    }
    req.end();
  });
}

/**
 * 提取 cookie 字符串中的 key=value
 */
function parseCookies(setCookieHeaders) {
  const cookies = [];
  for (const h of setCookieHeaders) {
    const parts = h.split(";");
    if (parts.length > 0) {
      cookies.push(parts[0].trim());
    }
  }
  return cookies.join("; ");
}

/**
 * 格式化北京时间
 */
function beijingTime() {
  return new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
}

// ========== 签到流程 ==========

async function login() {
  console.log(`[${beijingTime()}] 正在登录 dounai.pro ...`);

  const body = querystring.stringify({
    email: EMAIL,
    passwd: PASSWD,
  });

  const res = await request("POST", `${BASE_URL}/auth/login`, { body });

  console.log(`  登录响应状态: ${res.status}`);
  console.log(`  登录响应内容: ${res.body}`);

  if (res.cookies.length === 0) {
    console.warn("  ⚠ 登录未返回任何 cookie，请检查账号密码是否正确");
  }

  const cookieStr = parseCookies(res.cookies);
  console.log(`  获取到的 cookie: ${cookieStr || "(无)"}`);

  return cookieStr;
}

async function checkin(cookieStr) {
  console.log(`[${beijingTime()}] 正在签到 ...`);

  const res = await request("POST", `${BASE_URL}/user/checkin`, {
    headers: {
      Cookie: cookieStr,
      Referer: `${BASE_URL}/user/panel`,
    },
  });

  console.log(`  签到响应状态: ${res.status}`);
  console.log(`  签到响应内容: ${res.body}`);

  let result;
  try {
    result = JSON.parse(res.body);
  } catch {
    result = { raw: res.body };
  }

  if (result.ret === 1) {
    // 从返回消息中提取流量数和时长
    const trafficMatch = result.msg.match(/(\d+\.?\d*\s*[KMG]?B?)流量/);
    const durationMatch = result.msg.match(/延长\s*(\d+\.?\d*)\s*小时/);

    const traffic = trafficMatch ? trafficMatch[1].replace(/\s+/g, "") : null;
    const duration = durationMatch ? `${durationMatch[1]} 小时` : null;

    if (traffic && duration) {
      console.log(`  ✅ 签到成功！${result.msg}`);
      console.log(`  📊 获得流量: ${traffic}`);
      console.log(`  ⏱ 账号延长: ${duration}`);
      return { success: true, msg: result.msg, traffic, duration };
    } else {
      console.log(`  ❌ 签到响应异常：未检测到流量或时长信息`);
      console.log(`  📋 原始消息: ${result.msg}`);
      return { success: false, msg: result.msg, traffic, duration };
    }
  } else {
    console.log(`  ❌ 签到失败：${result.msg || "未知错误"}`);
    return { success: false, msg: result.msg || res.body };
  }
}

// ========== 主流程 ==========

async function main() {
  console.log("========== 豆奶(dounai.pro) 自动签到 ==========");
  console.log(`账号: ${EMAIL}`);
  console.log("");

  try {
    // 第一步：登录
    const cookieStr = await login();

    if (!cookieStr) {
      console.error("❌ 登录失败：未获取到 cookie，退出");
      process.exit(1);
    }

    // 等一小会
    await new Promise((r) => setTimeout(r, 1000));

    // 第二步：签到
    const result = await checkin(cookieStr);

    console.log("");
    console.log("========== 签到结束 ==========");

    if (!result.success) {
      process.exit(1);
    }
  } catch (err) {
    console.error(`❌ 执行出错: ${err.message}`);
    process.exit(1);
  }
}

main();
