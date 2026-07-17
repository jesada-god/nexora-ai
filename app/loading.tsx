import { Skeleton } from "@/src/components/ui/Skeleton"
import Header from "@/src/components/layout/Header"
import { appConfig } from "@/src/config/app"

export default function Loading() {
  return (
    <div aria-label={`กำลังโหลด ${appConfig.name}`}>
      <Header title={`กำลังโหลด ${appConfig.name}`} />
      <div className="p-4 md:p-8 space-y-6">
        <Skeleton className="w-full h-40" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      </div>
    </div>
  )
}
