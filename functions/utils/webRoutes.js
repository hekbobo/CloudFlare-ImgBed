/**
 * 页面分区路由
 *
 * 前端拆成两个独立入口，同一套判断逻辑给三种运行环境复用：
 *   - Worker 入口（deploy/worker/index.js，由 generate-routes.js 生成）
 *   - Pages 中间件（functions/_middleware.js）
 *   - Node / Docker 服务（deploy/server/index.js 里的简化实现）
 *
 * 路由约定：
 *   /                  用户侧 Web 应用（上传）
 *   /history           用户侧 Web 应用（历史文件）
 *   /admin             管理后台（原生应用，概览）
 *   /admin/files        管理后台 · 文件管理（支持 ?owner=<uid> 按账号筛选）
 *   /admin/upload       管理后台 · 上传
 *   /admin/users        管理后台 · 用户
 *   /admin/settings     管理后台 · 设置
 *   /login              登录页（由登录门禁在未登录时直接渲染）
 *   旧路径              301 → 新地址（含已下线的原 SPA /admin/advanced）
 */

import { isAuthEnabled } from './auth/providers.js';

export const PAGE_ASSETS = {
    web: '/web/index.html',
    admin: '/admin-app/index.html',
};

// 这些前缀不是页面导航，直接跳过（接口、文件、上传通道、WebDAV、随机图、静态目录）
const NON_PAGE_PREFIXES = [
    '/api',
    '/file',
    '/upload',
    '/dav',
    '/random',
    '/web',
    '/ui',
    '/admin-app',
    '/static',
];

// 管理后台改版前的旧路径，做永久跳转，避免老书签失效。
// 原 SPA（/admin/advanced/*）已下线，设置类页面统一落到新后台的设置页。
export const LEGACY_PAGE_REDIRECTS = {
    '/dashboard': '/admin/files',
    '/browse': '/admin/files',
    '/systemConfig': '/admin/settings',
    '/customerConfig': '/admin/settings',
    '/blockimg': '/admin/files',
    '/whiteliston': '/admin/settings',
    '/adminLogin': '/admin',
};

/**
 * 判断一次请求是不是「页面导航」。
 * 只处理 GET/HEAD 的 HTML 请求；带扩展名的静态资源一律放行。
 */
export function isPageNavigation(request, pathname) {
    if (!request || !pathname) return false;
    if (request.method !== 'GET' && request.method !== 'HEAD') return false;
    const isReserved = NON_PAGE_PREFIXES.some(
        prefix => pathname === prefix || pathname.startsWith(prefix + '/')
    );
    if (isReserved) return false;
    if (/\.[a-zA-Z0-9]{2,6}$/.test(pathname)) return false;
    const accept = request.headers.get('Accept') || '';
    return accept.includes('text/html');
}

/**
 * 纯函数：把路径映射成「重定向」或「页面资源」。
 * @returns {{redirect: string, permanent: boolean} | {asset: string, adminOnly: boolean}}
 */
export function resolvePageRoute(pathname) {
    const legacyTarget = LEGACY_PAGE_REDIRECTS[pathname];
    if (legacyTarget) {
        return { redirect: legacyTarget, permanent: true };
    }

    // 目录浏览页属于后台，旧地址统一落到文件管理
    if (pathname.startsWith('/browse/')) {
        return { redirect: '/admin/files', permanent: true };
    }

    // 原 SPA 已下线，老链接不留在 404 上，直接回新后台
    if (pathname === '/admin/advanced' || pathname.startsWith('/admin/advanced/')) {
        return { redirect: '/admin', permanent: true };
    }

    // /login 是登录门禁渲染的登录页；能走到这里说明已经登录了，直接回首页
    if (pathname === '/login') {
        return { redirect: '/', permanent: false };
    }

    // 管理后台：单页应用，所有 /admin 子路径都返回同一个外壳，前端自行分流
    if (pathname === '/admin' || pathname.startsWith('/admin/')) {
        return { asset: PAGE_ASSETS.admin, adminOnly: true };
    }

    return { asset: PAGE_ASSETS.web, adminOnly: false };
}

function redirectResponse(location, permanent) {
    const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
    return new Response(null, { status: permanent ? 301 : 302, headers });
}

/**
 * 从静态资源里取出页面外壳，附上 no-store，保证改版后刷新即生效。
 */
export async function servePageAsset(request, env, assetPath) {
    if (!env || !env.ASSETS) {
        return new Response('Static assets binding missing', { status: 500 });
    }

    const assetUrl = new URL(assetPath, request.url);
    const assetResponse = await env.ASSETS.fetch(new Request(assetUrl.toString(), { method: 'GET' }));
    if (!assetResponse.ok) {
        return new Response('Page asset missing: ' + assetPath, { status: 500 });
    }

    const headers = new Headers(assetResponse.headers);
    headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');

    const body = request.method === 'HEAD' ? null : assetResponse.body;
    return new Response(body, { status: 200, headers });
}

/**
 * 页面分区总入口：非页面导航返回 null，交给后续路由处理。
 */
export async function handlePageRoute(request, env, url) {
    const pathname = url.pathname;
    if (!isPageNavigation(request, pathname)) return null;

    const route = resolvePageRoute(pathname);

    if (route.redirect) {
        return redirectResponse(route.redirect + url.search, route.permanent);
    }

    // 配置了任一登录方式时，后台只允许管理员进入；
    // 都未配置则不在页面层拦，交给接口层按原有鉴权方式处理。
    if (route.adminOnly && isAuthEnabled(env)) {
        const { resolveUserScope } = await import('./auth/userScope.js');
        const scope = await resolveUserScope({ env, request });
        if (!scope || !scope.isAdmin) {
            return redirectResponse('/', false);
        }
    }

    return servePageAsset(request, env, route.asset);
}
