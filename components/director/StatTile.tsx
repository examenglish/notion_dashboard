import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export default function StatTile({
  icon: Icon,
  label,
  value,
  sub,
  tone = "default",
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "success" | "warning" | "destructive";
  onClick?: () => void;
}) {
  const toneClasses: Record<string, string> = {
    default: "bg-primary/10 text-primary",
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
    destructive: "bg-destructive/10 text-destructive",
  };

  const Comp = onClick ? "button" : "div";

  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 text-left shadow-card",
        onClick && "cursor-pointer transition-colors hover:bg-muted/60"
      )}
    >
      <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", toneClasses[tone])}>
        <Icon className="size-4" strokeWidth={2} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium leading-tight text-muted-foreground">{label}</div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-lg font-bold leading-tight text-foreground">{value}</span>
          {sub && <span className="truncate text-[11px] text-muted-foreground">{sub}</span>}
        </div>
      </div>
      {onClick && <span className="shrink-0 text-[11px] font-medium text-primary">더보기</span>}
    </Comp>
  );
}
