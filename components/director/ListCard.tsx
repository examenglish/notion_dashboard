import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ListCard({
  title,
  countLabel,
  action,
  children,
  empty,
}: {
  title: string;
  countLabel?: string;
  action?: ReactNode;
  children: ReactNode;
  empty?: boolean;
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {countLabel && <span className="text-xs font-medium text-muted-foreground">{countLabel}</span>}
      </CardHeader>
      <CardContent className="flex-1">
        {empty ? <p className="py-6 text-center text-sm text-muted-foreground">표시할 항목이 없습니다.</p> : children}
      </CardContent>
      {action}
    </Card>
  );
}

export function ListRow({ primary, secondary, meta, tone }: { primary: ReactNode; secondary?: ReactNode; meta?: ReactNode; tone?: "default" | "warning" | "destructive" }) {
  const dot: Record<string, string> = {
    default: "bg-primary",
    warning: "bg-warning",
    destructive: "bg-destructive",
  };
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-2.5 text-sm last:border-b-0">
      <div className="flex min-w-0 items-center gap-2.5">
        {tone && <span className={`size-1.5 shrink-0 rounded-full ${dot[tone]}`} />}
        <div className="min-w-0">
          <div className="truncate font-medium text-foreground">{primary}</div>
          {secondary && <div className="truncate text-xs text-muted-foreground">{secondary}</div>}
        </div>
      </div>
      {meta && <div className="shrink-0 text-xs text-muted-foreground">{meta}</div>}
    </div>
  );
}
