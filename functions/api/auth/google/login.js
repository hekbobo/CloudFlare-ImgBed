/**
 * Google OAuth 登录入口
 * GET /api/auth/google/login
 *
 * 需要环境变量：
 *   GOOGLE_CLIENT_ID       Google OAuth 2.0 客户端 ID
 *   GOOGLE_CLIENT_SECRET   Google OAuth 2.0 客户端密钥
 *   GOOGLE_REDIRECT_URI    可选，默认取当前请求的 origin + /api/auth/google/callback
 *
 * 走 OIDC 的 authorization code 流程，scope 只要 openid email profile，
 * 不索取任何云端硬盘 / Gmail 权限。
 */

export async function onRequestGet(context) {
    const { request, env } = context;

    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
        return new Response('Google 登录未配置：缺少 GOOGLE_CLIENT_ID 或 GOOGLE_CLIENT_SECRET', {
            status: 500,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
    }

    const url = new URL(request.url);
    const redirectUri = env.GOOGLE_REDIRECT_URI || `${url.origin}/api/auth/google/callback`;
    const state = crypto.randomUUID();

    const authorize = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authorize.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
    authorize.searchParams.set('redirect_uri', redirectUri);
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('scope', 'openid email profile');
    authorize.searchParams.set('state', state);
    // 每次登录都让用户选账号，避免共用设备时误用上一个账号
    authorize.searchParams.set('prompt', 'select_account');

    const headers = new Headers();
    headers.set('Location', authorize.toString());
    headers.append('Set-Cookie', buildStateCookie(state, url.protocol === 'https:'));
    headers.set('Cache-Control', 'no-store');

    return new Response(null, { status: 302, headers });
}

function buildStateCookie(state, secure) {
    const parts = [
        `g_oauth_state=${state}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        'Max-Age=600',
    ];
    if (secure) parts.push('Secure');
    return parts.join('; ');
}
