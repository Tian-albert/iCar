"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.genId = genId;
/** 生成跨端稳定主键 sourceId（幂等，防重复提交） */
function genId(prefix) {
    const rand = Math.random().toString(16).slice(2, 10);
    const ts = Date.now().toString(16);
    return `mp:${prefix}:${rand}${ts}`;
}
