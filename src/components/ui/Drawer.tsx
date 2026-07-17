'use client';
import * as React from "react"
import { X } from "lucide-react"
import { cn } from "@/src/utils/cn"

interface DrawerProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  className?: string
}

export function Drawer({ isOpen, onClose, title, children, className }: DrawerProps) {
  React.useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-end">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div 
        className={cn(
          "relative z-50 w-full sm:max-w-md h-[min(85dvh,48rem)] sm:h-full bg-[#151B28] border-t sm:border-t-0 sm:border-l border-slate-800 rounded-t-2xl sm:rounded-none shadow-2xl flex flex-col animate-in slide-in-from-bottom sm:slide-in-from-right-full duration-300", 
          className
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
      >
        <div className="flex items-center justify-between p-6 border-b border-slate-800">
          <h2 id="drawer-title" className="text-lg font-semibold text-white">{title}</h2>
          <button onClick={onClose} aria-label="ปิดแผง" className="p-2 rounded-full hover:bg-slate-800 text-slate-400 transition-colors">
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  )
}
