import type { ReactNode } from 'react'

export function Field(p: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="fld">
      <span>{p.label}</span>
      {p.children}
      {p.hint && <small>{p.hint}</small>}
    </label>
  )
}

export const num = (v: string, fallback: number) => (v === '' || Number.isNaN(+v) ? fallback : +v)
