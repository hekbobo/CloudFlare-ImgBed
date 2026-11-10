/**
 * 容量配额管理 API
 * GET: 获取容量统计
 *      - 管理员：全站统计（读索引元数据，1 次读取）
 *      - 普通用户：只统计自己 uid 前缀的文件，避免暴露站点规模
 * POST: 重新统计容量（触发索引重建，仅管理员）
 */

import { getIndexMeta, rebuildIndex, readIndex } from '../../utils/indexManager.js';
import { resolveUserScope, forbiddenResponse } from '../../utils/auth/userScope.js';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
};

export async function onRequest(context) {
    const { request } = context;

    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    // GET: 获取容量统计
    if (request.method === 'GET') {
        return await getQuotaStats(context);
    }

    // POST: 重新统计容量（触发索引重建，全站操作，仅管理员）
    if (request.method === 'POST') {
        const scope = context.userScope || await resolveUserScope(context);
        if (scope && !scope.isAdmin) {
            return forbiddenResponse('需要管理员权限');
        }
        return await recalculateQuota(context);
    }

    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
}

function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
}

// 获取容量统计
async function getQuotaStats(context) {
    try {
        // API Token（无会话）本身就是管理员权限，按管理员处理
        const scope = context.userScope || await resolveUserScope(context);

        if (scope && !scope.isAdmin) {
            return await getUserQuotaStats(context, scope);
        }

        const indexMeta = await getIndexMeta(context);

        return jsonResponse({
            success: true,
            scope: 'admin',
            quotaStats: indexMeta.channelStats || {},
            totalSizeMB: indexMeta.totalSizeMB || 0,
            totalCount: indexMeta.totalCount || 0,
            lastUpdated: indexMeta.lastUpdated
        });
    } catch (error) {
        return jsonResponse({
            success: false,
            error: error.message
        }, 500);
    }
}

/**
 * 普通用户的容量统计：只聚合 metadata.Owner === 自己 uid 的文件。
 * 口径与全站统计保持一致（metadata.FileSize 单位 MB、按 metadata.ChannelName 分组）。
 */
async function getUserQuotaStats(context, scope) {
    if (!scope.uid) {
        return jsonResponse({
            success: true,
            scope: 'user',
            uid: '',
            quotaStats: {},
            totalSizeMB: 0,
            totalCount: 0,
            lastUpdated: null
        });
    }

    const result = await readIndex(context, {
        ownerUid: scope.uid,
        count: -1,
        includeSubdirFiles: true,
    });

    if (!result.success) {
        throw new Error('Failed to read index');
    }

    const files = result.files || [];
    const channelStats = {};
    let totalSizeMB = 0;

    for (const file of files) {
        const channelName = file.metadata?.ChannelName;
        const fileSize = parseFloat(file.metadata?.FileSize) || 0;

        totalSizeMB += fileSize;

        if (channelName) {
            if (!channelStats[channelName]) {
                channelStats[channelName] = { usedMB: 0, fileCount: 0 };
            }
            channelStats[channelName].usedMB += fileSize;
            channelStats[channelName].fileCount += 1;
        }
    }

    for (const key of Object.keys(channelStats)) {
        channelStats[key].usedMB = Math.round(channelStats[key].usedMB * 100) / 100;
    }

    return jsonResponse({
        success: true,
        scope: 'user',
        uid: scope.uid,
        quotaStats: channelStats,
        totalSizeMB: Math.round(totalSizeMB * 100) / 100,
        totalCount: files.length,
        lastUpdated: result.indexLastUpdated || null
    });
}

// 重新统计容量（触发索引重建，会重新计算所有容量统计）
async function recalculateQuota(context) {
    try {
        // 重建索引会自动重新计算所有容量统计
        const result = await rebuildIndex(context);

        if (!result.success) {
            return jsonResponse({
                success: false,
                error: result.error || 'Failed to rebuild index'
            }, 500);
        }

        // 重建完成后，获取最新的统计数据
        const indexMeta = await getIndexMeta(context);

        return jsonResponse({
            success: true,
            message: 'Quota recalculated successfully',
            channelStats: indexMeta.channelStats || {},
            totalSizeMB: indexMeta.totalSizeMB || 0,
            totalCount: indexMeta.totalCount || 0,
            totalUniqueFiles: result.indexedCount
        });
    } catch (error) {
        return jsonResponse({
            success: false,
            error: error.message
        }, 500);
    }
}
