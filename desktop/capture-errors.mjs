const messages = {
  invalid_archive: '备份文件损坏或格式不受支持，请恢复原始记录重新核对。',
  identity_mismatch: '备份归属与当前结果不一致，请重新打开文件核对后再导出。',
  invalid_destination: '请选择有效的 ZIP 保存位置。',
  source_changed: '备份在复制期间发生变化，请重新核对后导出。',
  raw_capture: '交付包中含原始网络记录，请从核对结果导出标准备份。',
  storage_full: '保存位置空间不足，原始记录已保留，请更换目录后重试。',
  file_busy: '目标文件仍被占用，请关闭使用它的程序后重试。',
  permission_denied: '当前目录没有写入权限，请更换保存位置后重试。',
  EACCES: '当前目录没有访问权限，请更换位置或检查权限。',
  EPERM: '当前操作未获系统允许，请检查权限与目标文件占用。',
  ENOSPC: '保存位置空间不足，请更换目录后重试。',
  EBUSY: '文件仍被占用，请关闭使用它的程序后重试。',
  ENOENT: '所需文件不存在，请完整解压程序，或恢复原始记录重新核对。',
}

export function captureError(error) {
  let code = error?.code, detail = String(error?.message || error || '')
  for (const line of detail.split(/\r?\n/).reverse()) {
    try { const value = JSON.parse(line); if (typeof value.code === 'string') { code = value.code; break } } catch {}
  }
  if (messages[code]) return { code, message: messages[code], detail }
  if (/timeout|timed out|超时/i.test(detail)) return { code: 'timeout', message: '操作超时，原始记录已保留。请检查运行环境后重试。', detail }
  if (detail.length < 240 && /^[\u3400-\u9fff「]/.test(detail) && !/[A-Za-z]:[\\/]|Traceback|\r|\n/.test(detail))
    return { code: code || 'operation', message: detail, detail }
  return { code: code || 'unexpected', message: '操作未能完成，原始记录已保留。可在工具设置打开错误日志查看原因。', detail }
}
