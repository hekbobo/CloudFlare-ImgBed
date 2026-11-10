import { batchRemoveFilesFromIndex } from '../../../utils/indexManager.js';
import { mapConcurrent, normalizeBatchFileIds } from '../../../utils/deleteBatch.js';
import { deleteFile } from './[[path]].js';
import { resolveUserScope, findUnauthorizedFileId } from '../../../utils/auth/userScope.js';

const MAX_BATCH_SIZE = 500;
const DELETE_CONCURRENCY = 10;

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
};

export async function onRequest(context) {
    if (context.request.method !== 'POST') {
        return jsonResponse({ success: false, error: 'Method not allowed' }, 405);
    }

    try {
        const payload = await context.request.json();
        const fileIds = normalizeBatchFileIds(payload?.fileIds, MAX_BATCH_SIZE);
        if (fileIds.length === 0) {
            return jsonResponse({ success: false, error: 'fileIds is required' }, 400);
        }

        // 用户隔离：普通用户只能删自己 uid 目录下的文件
        const scope = await resolveUserScope(context);
        const unauthorizedId = scope ? findUnauthorizedFileId(scope, fileIds) : fileIds[0];
        if (unauthorizedId) {
            return jsonResponse({ success: false, error: `无权删除该文件：${unauthorizedId}` }, 403);
        }
        const url = new URL(context.request.url);
        const results = await mapConcurrent(fileIds, DELETE_CONCURRENCY, async (fileId) => {
            try {
                const cdnUrl = `${url.origin}/file/${fileId.split('/').map(encodeURIComponent).join('/')}`;
                const result = await deleteFile(context.env, fileId, cdnUrl, url);
                const success = !!(result && result.deleted);
                return { fileId, success, existed: !!(result && result.existed), error: success ? '' : 'Delete file failed' };
            } catch (err) {
                return { fileId, success: false, existed: false, error: String(err?.message || err) };
            }
        });

        // deleted 包含所有处理成功的 ID；missing 是其中记录不存在的子集。
        const deleted = results.filter((item) => item.success).map((item) => item.fileId);
        const missing = results.filter((item) => item.success && !item.existed).map((item) => item.fileId);
        const failed = results.filter((item) => !item.success).map(({ fileId, error }) => ({ fileId, error }));
        if (deleted.length > 0) {
            context.waitUntil(batchRemoveFilesFromIndex(context, deleted));
        }
        return jsonResponse({ success: failed.length === 0, deleted, missing, failed, details: results });
    } catch (error) {
        return jsonResponse({ success: false, error: error.message }, 400);
    }
}

function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
}
