/**
 * 兼容层：登录门禁已支持 GitHub / Google 两种 provider，
 * 实现搬到 ./loginGate.js。这里保留旧导出名，避免已生成的 Worker 入口失效。
 */

export { authLoginGate as githubLoginGate, authLoginGate, renderLoginPage } from './loginGate.js';
