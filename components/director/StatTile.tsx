import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export default function StatTile({
  icon: Icon,
  label,
  value,
  sub,
  tone = "default",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "success" | "warning" | "destructive";
}) {
  const toneClasses: Record<string, string> = {
    default: "bg-primary/10 text-primary",
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
    destructive: "bg-destructive/10 text-destructive",
  };

  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 shadow-card">
      <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", toneClasses[tone])}>
        <Icon className="size-4" strokeWidth={2} />
      </div>
      <div className="min-w-0">
        <div className="text-[11px] font-medium leading-tight text-muted-foreground">{label}</div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-lg font-bold leading-tight text-foreground">{value}</span>
          {sub && <span className="truncate text-[11px] text-muted-foreground">{sub}</span>}
        </div>
      </div>
    </div>
  );
}
