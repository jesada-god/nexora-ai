'use client';
import * as React from "react"
import { cn } from "@/src/utils/cn"
import { ChevronDown } from "lucide-react"

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(
            "appearance-none flex h-10 w-full rounded-md border border-slate-700 bg-[#151B28] px-3 py-2 pr-8 text-sm ring-offset-background placeholder:text-slate-500 focus-visible:outline-none focus-visible:border-[#D4FF00] focus-visible:ring-1 focus-visible:ring-[#D4FF00]/50 disabled:cursor-not-allowed disabled:opacity-50 transition-colors",
            className
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown className="absolute right-3 top-3 h-4 w-4 opacity-50 pointer-events-none" />
      </div>
    )
  }
)
Select.displayName = "Select"
