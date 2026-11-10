/**
 * GitHub 登录门禁
 *
 * 前端是编译产物，无法直接修改登录页，因此在这里拦截「未登录的页面导航请求」，
 * 返回一个自定义的 GitHub 登录页；OAuth 成功后由 /api/auth/github/callback 写入会话
 * Cookie，前端再调用 /api/auth/sessionCheck 就会判定为已登录。
 *
 * 仅在配置了 GITHUB_CLIENT_ID 时生效，未配置则完全退回原有行为。
 */

import { validateAnySession } from './sessionManager.js';

// 这些路径不拦截：接口、文件、上传、WebDAV 以及带扩展名的静态资源
const SKIP_PREFIXES = ['/api/', '/file/', '/upload/', '/dav/', '/random/'];

export async function githubLoginGate(request, env) {
    if (!env || !env.GITHUB_CLIENT_ID) return null;
    if (request.method !== 'GET' && request.method !== 'HEAD') return null;

    const url = new URL(request.url);
    const pathname = url.pathname;

    if (SKIP_PREFIXES.some(prefix => pathname.startsWith(prefix))) return null;
    if (/\.[a-zA-Z0-9]{2,6}$/.test(pathname)) return null;
    // 带 authCode 的访问交给原有逻辑（API 客户端 / 临时链接）
    if (url.searchParams.has('authCode')) return null;

    const accept = request.headers.get('Accept') || '';
    if (!accept.includes('text/html')) return null;

    const { valid } = await validateAnySession(env, request);
    if (valid) return null;

    return new Response(renderLoginPage({
        siteName: env.SITE_NAME || 'Sanyue 图床',
        error: url.searchParams.get('login_error') || '',
    }), {
        status: 200,
        headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store, no-cache, must-revalidate',
        },
    });
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    })[char]);
}

export function renderLoginPage({ siteName, error }) {
    const name = escapeHtml(siteName);
    const errorBlock = error
        ? `<div class="error">${escapeHtml(error)}</div>`
        : '';

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>登录到 ${name}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{
    min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
    background:linear-gradient(135deg,#dbeafe 0%,#ede9fe 38%,#fae8ff 62%,#e0f2fe 100%);
    color:#1f2937;position:relative;overflow:hidden;
  }
  body::before,body::after{
    content:"";position:absolute;border-radius:50%;filter:blur(70px);opacity:.55;pointer-events:none;
  }
  body::before{width:420px;height:420px;background:#93c5fd;top:-120px;left:-80px}
  body::after{width:380px;height:380px;background:#f0abfc;bottom:-140px;right:-90px}
  .card{
    position:relative;z-index:1;width:100%;max-width:430px;padding:44px 38px 38px;
    background:rgba(255,255,255,.72);border:1px solid rgba(255,255,255,.85);border-radius:22px;
    box-shadow:0 20px 60px -16px rgba(30,41,59,.28);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);
    text-align:center;
  }
  h1{font-size:26px;font-weight:800;letter-spacing:.5px;margin-bottom:10px}
  h1 em{font-style:italic;font-weight:800}
  .sub{font-size:13.5px;color:#6b7280;line-height:1.6;margin-bottom:28px}
  .gh-btn{
    display:flex;align-items:center;justify-content:center;gap:10px;width:100%;height:52px;
    background:#111827;color:#fff;border:none;border-radius:14px;font-size:15.5px;font-weight:600;
    text-decoration:none;cursor:pointer;transition:transform .18s ease,box-shadow .18s ease,background .18s ease;
    box-shadow:0 10px 24px -10px rgba(17,24,39,.7);
  }
  .gh-btn:hover{background:#1f2937;transform:translateY(-1px);box-shadow:0 14px 30px -12px rgba(17,24,39,.65)}
  .gh-btn:active{transform:translateY(0)}
  .gh-btn svg{width:20px;height:20px;fill:#fff;flex:none}
  .error{
    margin-bottom:20px;padding:11px 14px;border-radius:10px;background:#fef2f2;
    border:1px solid #fecaca;color:#b91c1c;font-size:13px;line-height:1.5;text-align:left;word-break:break-word;
  }
  .foot{margin-top:22px;font-size:12px;color:#9ca3af;line-height:1.6}
  @media (max-width:480px){.card{padding:34px 22px 30px}h1{font-size:22px}}
</style>
</head>
<body>
  <main class="card">
    <h1>登录到 <em>${name}</em></h1>
    <p class="sub">本站使用 GitHub 账号登录，无需密码</p>
    ${errorBlock}
    <a class="gh-btn" href="/api/auth/github/login" rel="nofollow">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>
      使用 GitHub 登录
    </a>
    <p class="foot">仅限授权账号访问 · 登录状态有效期内免重复授权</p>
  </main>
</body>
</html>`;
}
