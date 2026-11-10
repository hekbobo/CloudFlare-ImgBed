/**
 * 上传者字典 API（仅管理员）
 *
 * GET: { success, owners: [{ uid, login, name, avatar, provider, isAdmin }] }
 *
 * 文件记录的 metadata 里只存了 metadata.Owner（8 位 uid），管理端要显示
 * 「这个文件是谁的」就需要一份 uid → 账号 的映射。
 *
 * 为什么要单独成接口，而不是塞进 /api/manage/list 的响应里：
 * - list 每翻一页都会调一次，而 listUserRecords 要逐个 get 用户记录，成本随用户数上升；
 * - 前端取一次就能缓存复用，翻页、搜索、切筛选都不用重复拉取。
 */

import { listUserRecords } from '../../utils/userDirectory.js';
import { resolveUserScope, forbiddenResponse } from '../../utils/auth/userScope.js';
import { isSuperAdmin } from '../../utils/auth/adminPolicy.js';

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

export async function onRequest(context) {
    const { request } = context;

    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }
    if (request.method !== 'GET') {
        return jsonResponse({ success: false, error: 'Method not allowed' }, 405);
    }

    const scope = context.userScope || await resolveUserScope(context);
    if (scope && !scope.isAdmin) {
        return forbiddenResponse('需要管理员权限');
    }

    try {
        const records = await listUserRecords(context.env);
        const owners = records.map(record => ({
            uid: record.uid,
            login: record.login,
            name: record.name || record.login,
            avatar: record.avatar || '',
            provider: record.provider || 'github',
            isAdmin: isSuperAdmin(record.login, record.provider),
        }));

        return jsonResponse({ success: true, owners });
    } catch (error) {
        return jsonResponse({ success: false, error: error.message }, 500);
    }
}
