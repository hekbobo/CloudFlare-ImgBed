/**
 * 登录门禁（GitHub / Google）
 *
 * 前端是编译产物，无法直接修改登录页，因此在这里拦截「未登录的页面导航请求」，
 * 返回一个自定义登录页；OAuth 成功后由 /api/auth/<provider>/callback 写入会话
 * Cookie，前端再调用 /api/auth/sessionCheck 就会判定为已登录。
 *
 * 只要配置了任意一个 provider（CLIENT_ID + CLIENT_SECRET）就启用门禁，
 * 一个都没配则完全退回原有行为（不拦截任何页面）。
 */

import { validateAnySession } from './sessionManager.js';
import { getEnabledProviders, PROVIDER_META } from './providers.js';

// 这些路径不拦截：接口、文件、上传、WebDAV 以及带扩展名的静态资源
const SKIP_PREFIXES = ['/api/', '/file/', '/upload/', '/dav/', '/random/'];

export async function authLoginGate(request, env) {
    if (!env) return null;

    const providers = getEnabledProviders(env);
    if (providers.length === 0) return null;
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
        providers,
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

const GITHUB_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>';

const GOOGLE_ICON = `<svg viewBox="0 0 48 48" aria-hidden="true">
  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24s.92 7.54 2.56 10.78l7.97-6.19z"/>
  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
</svg>`;

/**
 * 登录按钮：GitHub 走深色实底（品牌习惯），Google 走白底描边（Google 品牌规范不允许多彩底）。
 */
function renderButtons(providers) {
    return providers
        .map(provider => {
            const meta = PROVIDER_META[provider];
            if (!meta) return '';
            if (provider === 'google') {
                return `<a class="btn btn--google" href="${meta.authorize}" rel="nofollow">
      ${GOOGLE_ICON}
      <span>${meta.hint}</span>
    </a>`;
            }
            return `<a class="btn btn--github" href="${meta.authorize}" rel="nofollow">
      ${GITHUB_ICON}
      <span>${meta.hint}</span>
    </a>`;
        })
        .join('\n    ');
}

export function renderLoginPage({ siteName, error, providers }) {
    const name = escapeHtml(siteName);
    const list = Array.isArray(providers) && providers.length ? providers : ['github'];
    const errorBlock = error
        ? `<div class="error">${escapeHtml(error)}</div>`
        : '';
    const providerText = list.length > 1 ? 'GitHub 或 Google' : (PROVIDER_META[list[0]]?.label || 'GitHub');
    const single = list.length === 1 ? '' : ' is-multi';

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>登录到 ${name}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  /* 渐变放在 html 上，body 透明：内容超出一屏时背景仍铺满，也不依赖 background-attachment（移动 Safari 不稳） */
  html{
    min-height:100%;
    background:linear-gradient(135deg,#dbeafe 0%,#ede9fe 38%,#fae8ff 62%,#e0f2fe 100%);
    /* body 的 overflow 会被浏览器传播到视口，导致 body 自身不再裁剪子元素，
       装饰光斑必须 fixed 才不会把文档撑宽（移动端横向滚动条） */
    overflow-x:hidden;
  }
  body{
    min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
    color:#1f2937;position:relative;overflow:hidden;
  }
  body::before,body::after{
    content:"";position:fixed;border-radius:50%;filter:blur(70px);opacity:.55;pointer-events:none;z-index:0;
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
  .btn{
    display:flex;align-items:center;justify-content:center;gap:10px;width:100%;height:52px;
    border-radius:14px;font-size:15.5px;font-weight:600;text-decoration:none;cursor:pointer;
    transition:transform .18s ease,box-shadow .18s ease,background .18s ease,border-color .18s ease;
  }
  .btn + .btn{margin-top:11px}
  .btn svg{width:20px;height:20px;flex:none}
  .btn--github{
    background:#111827;color:#fff;border:1px solid #111827;
    box-shadow:0 10px 24px -10px rgba(17,24,39,.7);
  }
  .btn--github svg{fill:#fff}
  .btn--github:hover{background:#1f2937;transform:translateY(-1px);box-shadow:0 14px 30px -12px rgba(17,24,39,.65)}
  .btn--google{
    background:#fff;color:#1f2937;border:1px solid #dadce0;
    box-shadow:0 1px 3px rgba(60,64,67,.16),0 8px 22px -14px rgba(60,64,67,.5);
  }
  .btn--google:hover{background:#f8f9fa;border-color:#c7cacd;transform:translateY(-1px);box-shadow:0 2px 6px rgba(60,64,67,.2),0 12px 26px -16px rgba(60,64,67,.55)}
  .btn:active{transform:translateY(0)}
  .btn:focus-visible{outline:2px solid #2563eb;outline-offset:3px}
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
    <p class="sub">本站使用 ${providerText} 账号登录，无需密码</p>
    ${errorBlock}
    <div class="logins${single}">
    ${renderButtons(list)}
    </div>
    <p class="foot">仅限授权账号访问 · 登录状态有效期内免重复授权</p>
  </main>
</body>
</html>`;
}
