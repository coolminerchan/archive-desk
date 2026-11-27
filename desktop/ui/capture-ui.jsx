import React from 'react'
import { ChevronDown, FolderOpen } from 'lucide-react'

export function Action({ name, children, act, busy, disabled, primary, icon: Icon, args, className = '' }) {
  const success=name==='capture-export-diagnostics'?'诊断文件已保存':name.includes('export')?'备份已保存':name.includes('recover')?'原始记录已重新整理':undefined
  return <button type="button" data-action={name} className={`button ${primary ? 'primary' : 'secondary'} ${className}`} disabled={!!busy || !!disabled}
    onClick={() => act(name, args, success)}>{Icon && <Icon size={17} />}{busy === name ? '处理中…' : children}</button>
}
export function Panel({ title, description, children, aside, className = '', ...props }) {
  return <section className={`c-panel ${className}`} {...props}>{title && <div className="c-panel-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{aside}</div>}{children}</section>
}
export function Disclosure({ title, children, className = '', ...props }) {
  return <details className={`c-disclosure ${className}`} {...props}><summary>{title}<ChevronDown size={16} /></summary><div className="c-disclosure-body">{children}</div></details>
}
export function PageTitle({ title, description, children }) {
  return <div className="c-page-title"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{children}</div>
}
export function Blank({ title = '还没有资料', children, act, busy, disabled }) {
  return <div className="c-blank"><FolderOpen size={28} /><h2>{title}</h2><p>{children || '完成一次备份，或打开已有账号包。'}</p>{act && <Action name="analyze" act={act} busy={busy} disabled={disabled}>打开已有备份</Action>}</div>
}
export function Note({ children, warning = false }) { return <div className={`c-note ${warning ? 'attention' : ''}`}>{children}</div> }
export const receivedLabel = state => ({collected:'已读取', empty:'已读取 · 列表为空', partial:'可补充', missing:'尚无记录', waiting:'等待记录', unknown:'尚未确认'}[state] || '尚未确认')
