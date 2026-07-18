'use client';
import * as React from "react"
import { X } from "lucide-react"
import { cn } from "@/src/utils/cn"
import { useId } from "react"
import { useDialogA11y } from "@/src/hooks/useDialogA11y"

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  className?: string
  initialFocusRef?: React.RefObject<HTMLElement | null>
}

export function Modal({ isOpen, onClose, title, children, className, initialFocusRef }: ModalProps) {
  const titleId = useId()
  const dialogRef = useDialogA11y(isOpen, onClose, initialFocusRef)

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className={cn("relative z-50 w-full max-w-lg max-h-dvh sm:max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-[#151B28] border border-slate-800 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6 shadow-2xl outline-none", className)}>
        <div className="flex items-center justify-between mb-4">
          <h2 id={titleId} className="text-lg font-semibold text-white">{title}</h2>
          <button onClick={onClose} aria-label="ปิดหน้าต่าง" className="p-2 rounded-full hover:bg-slate-800 text-slate-400 transition-colors">
            <X size={20} />
          </button>
        </div>
        <div>{children}</div>
      </div>
    </div>
  )
}
