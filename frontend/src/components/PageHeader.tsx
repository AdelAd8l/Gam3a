import type { ReactNode } from 'react'

export default function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="page-head">
      <h1>{title}</h1>
      {children && <div className="page-head-actions">{children}</div>}
    </header>
  )
}
