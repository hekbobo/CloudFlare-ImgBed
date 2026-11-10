/**
 * 登录方式探测
 *
 * 页面门禁、登录页按钮、后台放行三处都读这里，避免判断口径不一致
 * （出现过「gate 只看 CLIENT_ID、callback 还要求 SECRET」导致点了登录直接 500 的情况）。
 *
 * 每个 provider 必须 CLIENT_ID 与 CLIENT_SECRET 同时存在才算可用。
 */

export const PROVIDER_META = {
    github: {
        label: 'GitHub',
        authorize: '/api/auth/github/login',
        hint: '使用 GitHub 账号登录',
    },
    google: {
        label: 'Google',
        authorize: '/api/auth/google/login',
        hint: '使用 Google 账号登录',
    },
};

export function getEnabledProviders(env) {
    if (!env) return [];
    const list = [];
    if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) list.push('github');
    if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) list.push('google');
    return list;
}

export function isAuthEnabled(env) {
    return getEnabledProviders(env).length > 0;
}
