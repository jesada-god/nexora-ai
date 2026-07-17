'use client';
import * as React from "react"
import { X } from "lucide-react"
import { cn } from "@/src/utils/cn"
import { useId } from "react"
import { useDialogA11y } from "@/src/hooks/useDialogA11y"

interface DrawerProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  className?: string
}

export function Drawer({ isOpen, onClose, title, children, className }: DrawerProps) {
  const titleId = useId()
  const dialogRef = useDialogA11y(isOpen, onClose)

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-end">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div 
        ref={dialogRef}
        tabIndex={-1}
        className={cn(
          "relative z-50 w-full sm:max-w-md h-[min(85dvh,48rem)] sm:h-full bg-[#151B28] border-t sm:border-t-0 sm:border-l border-slate-800 rounded-t-2xl sm:rounded-none shadow-2xl flex flex-col animate-in slide-in-from-bottom sm:slide-in-from-right-full duration-300 outline-none",
          className
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="flex items-center justify-between p-6 border-b border-slate-800">
          <h2 id={titleId} className="text-lg font-semibold text-white">{title}</h2>
          <button onClick={onClose} aria-label="ปิดแผง" className="p-2 rounded-full hover:bg-slate-800 text-slate-400 transition-colors">
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  )
}
