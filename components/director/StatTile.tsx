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
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 shadow-card">
      <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-md", toneClasses[tone])}>
        <Icon className="size-5" strokeWidth={2} />
      </div>
      <div className="min-w-0">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-xl font-bold text-foreground">{value}</span>
          {sub && <span className="truncate text-xs text-muted-foreground">{sub}</span>}
        </div>
      </div>
    </div>
  );
}
