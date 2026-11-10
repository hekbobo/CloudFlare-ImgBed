/**
 * GitHub OAuth 登录入口
 * GET /api/auth/github/login
 *
 * 需要环境变量：
 *   GITHUB_CLIENT_ID       GitHub OAuth App 的 Client ID
 *   GITHUB_CLIENT_SECRET   GitHub OAuth App 的 Client Secret
 *   GITHUB_REDIRECT_URI    可选，默认取当前请求的 origin + /api/auth/github/callback
 */

export async function onRequestGet(context) {
    const { request, env } = context;

    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
        return new Response('GitHub OAuth 未配置：缺少 GITHUB_CLIENT_ID 或 GITHUB_CLIENT_SECRET', {
            status: 500,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
    }

    const url = new URL(request.url);
    const redirectUri = env.GITHUB_REDIRECT_URI || `${url.origin}/api/auth/github/callback`;
    const state = crypto.randomUUID();

    const authorize = new URL('https://github.com/login/oauth/authorize');
    authorize.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
    authorize.searchParams.set('redirect_uri', redirectUri);
    authorize.searchParams.set('scope', 'read:user');
    authorize.searchParams.set('state', state);
    authorize.searchParams.set('allow_signup', 'false');

    const headers = new Headers();
    headers.set('Location', authorize.toString());
    headers.append('Set-Cookie', buildStateCookie(state, url.protocol === 'https:'));
    headers.set('Cache-Control', 'no-store');

    return new Response(null, { status: 302, headers });
}

function buildStateCookie(state, secure) {
    const parts = [
        `gh_oauth_state=${state}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        'Max-Age=600',
    ];
    if (secure) parts.push('Secure');
    return parts.join('; ');
}
