/**
 * 用户管理 API（仅管理员）
 *
 * GET: 用户目录 + 每人文件归属统计
 *      - users[]: settings 表 user@<login> 里的账号记录
 *      - isAdmin : 是否在 GITHUB_ADMIN_USERS 内（未配置时取最早登录的账号，与登录回调保持一致）
 *      - allowed : 是否在 GITHUB_ALLOWED_USERS 内；未配置白名单时为 null（无意义）
 *      - files / sizeMB / lastUpload: 按 metadata.Owner === uid 聚合索引
 *      - totals.orphan*: Owner 为空或指向已不存在 uid 的文件（历史遗留、uid 漂移）
 *
 * 只读接口：账号由 GitHub 登录自动创建，删除/禁用请直接改数据库，避免误删造成文件失联。
 */

import { listUserRecords } from '../../utils/userDirectory.js';
import { readIndex } from '../../utils/indexManager.js';
import { resolveUserScope, forbiddenResponse } from '../../utils/auth/userScope.js';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
};

function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
}

function parseList(value) {
    if (!value) return [];
    return String(value)
        .split(',')
        .map(item => item.trim().toLowerCase())
        .filter(Boolean);
}

export async function onRequest(context) {
    const { request } = context;

    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }
    if (request.method !== 'GET') {
        return jsonResponse({ success: false, error: 'Method not allowed' }, 405);
    }

    // 中间件已把站点级接口限定给管理员 / 管理 Token，这里再兜一层
    const scope = context.userScope || await resolveUserScope(context);
    if (scope && !scope.isAdmin) {
        return forbiddenResponse('需要管理员权限');
    }

    try {
        const records = await listUserRecords(context.env);

        const adminList = parseList(context.env.GITHUB_ADMIN_USERS);
        const allowedList = parseList(context.env.GITHUB_ALLOWED_USERS);

        // 管理员来源：显式配置优先；未配置时把最早注册的账号当作管理员（bootstrap）
        const adminSource = adminList.length > 0 ? 'env' : 'bootstrap';
        const effectiveAdmins = adminList.length > 0
            ? adminList
            : (records.length > 0 ? [records[0].login] : []);

        const stats = new Map(); // uid -> { files, sizeMB, lastUpload }
        const orphans = { files: 0, sizeMB: 0, unknownOwner: 0 };
        let indexed = true;

        try {
            const result = await readIndex(context, { count: -1, includeSubdirFiles: true });
            if (!result.success) {
                indexed = false;
            } else {
                const knownUids = new Set(records.map(item => item.uid));
                for (const file of result.files || []) {
                    const owner = file.metadata?.Owner || '';
                    const size = parseFloat(file.metadata?.FileSize) || 0;
                    const stamp = Number(file.metadata?.TimeStamp) || 0;

                    if (!owner || !knownUids.has(owner)) {
                        orphans.files += 1;
                        orphans.sizeMB += size;
                        if (!owner) orphans.unknownOwner += 1;
                        continue;
                    }

                    let entry = stats.get(owner);
                    if (!entry) {
                        entry = { files: 0, sizeMB: 0, lastUpload: 0 };
                        stats.set(owner, entry);
                    }
                    entry.files += 1;
                    entry.sizeMB += size;
                    if (stamp > entry.lastUpload) entry.lastUpload = stamp;
                }
            }
        } catch (error) {
            // 索引不可用时不阻断账号列表，前端按「—」展示
            indexed = false;
            console.error('Load user usage failed:', error);
        }

        const users = records.map(record => {
            const usage = stats.get(record.uid) || { files: 0, sizeMB: 0, lastUpload: 0 };
            return {
                login: record.login,
                name: record.name || record.login,
                avatar: record.avatar || '',
                uid: record.uid,
                provider: record.provider || 'github',
                createdAt: record.createdAt || 0,
                isAdmin: effectiveAdmins.includes(record.login),
                allowed: allowedList.length === 0 ? null : allowedList.includes(record.login),
                files: usage.files,
                sizeMB: Math.round(usage.sizeMB * 100) / 100,
                lastUpload: usage.lastUpload || 0,
            };
        });

        // 管理员置顶，其余按文件数降序、注册时间升序
        users.sort((a, b) => {
            if (a.isAdmin !== b.isAdmin) return a.isAdmin ? -1 : 1;
            if (b.files !== a.files) return b.files - a.files;
            return (a.createdAt || 0) - (b.createdAt || 0);
        });

        const totals = {
            users: users.length,
            admins: users.filter(item => item.isAdmin).length,
            files: users.reduce((sum, item) => sum + item.files, 0),
            sizeMB: Math.round(users.reduce((sum, item) => sum + item.sizeMB, 0) * 100) / 100,
            orphanFiles: orphans.files,
            orphanSizeMB: Math.round(orphans.sizeMB * 100) / 100,
            unknownOwnerFiles: orphans.unknownOwner,
        };

        return jsonResponse({
            success: true,
            indexed,
            users,
            totals,
            config: {
                adminSource,
                admins: effectiveAdmins,
                allowedUsers: allowedList,
                allowedListEmpty: allowedList.length === 0,
            },
        });
    } catch (error) {
        return jsonResponse({ success: false, error: error.message }, 500);
    }
}
