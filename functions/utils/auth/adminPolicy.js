/**
 * 管理员策略 —— 写死，不再读环境变量。
 *
 * 规则：只有 **GitHub** 登录的 `hekbobo` 是管理员；其余任何账号（含 Google 登录的邮箱）
 * 一律按普通用户处理，只能看到和管理自己的文件。
 *
 * 为什么写死：之前用 GITHUB_ADMIN_USERS / GOOGLE_ADMIN_USERS 两个变量 + 「最早注册账号
 * 自动接管」的 bootstrap 兜底，三套来源叠加导致实际结果难以预测（上错一个变量就会多出
 * 一个管理员）。现在收敛成唯一来源，看一眼代码就知道谁有权限。
 *
 * 需要变更管理员时，直接改 SUPER_ADMIN 这一行常量。
 */
export const SUPER_ADMIN = Object.freeze({
    login: 'hekbobo',
    provider: 'github',
});

/**
 * 判断某个登录身份是否为管理员。
 * provider 缺省按 github 处理（早期创建的用户记录可能没有 provider 字段）。
 *
 * @param {string} login    账号标识（GitHub 用户名 / Google 邮箱）
 * @param {string} [provider] 'github' | 'google'
 * @returns {boolean}
 */
export function isSuperAdmin(login, provider) {
    const name = String(login || '').trim().toLowerCase();
    const from = String(provider || SUPER_ADMIN.provider).trim().toLowerCase();
    return name === SUPER_ADMIN.login && from === SUPER_ADMIN.provider;
}

/** 管理员名单（仅供前端展示） */
export function getAdminList() {
    return [SUPER_ADMIN.login];
}

/** 管理员规则的文字说明（前端展示） */
export function getAdminRuleText() {
    return `仅 GitHub 账号 ${SUPER_ADMIN.login} 为管理员`;
}
