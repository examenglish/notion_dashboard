import { Search } from "lucide-react";
import DirectorUserMenu from "./DirectorUserMenu";

export default function DirectorTopbar({
  staffName,
  role,
  dateLabel,
}: {
  staffName: string;
  role: string;
  dateLabel: string;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-background px-6">
      <div className="text-sm font-semibold text-foreground">{dateLabel}</div>

      <div className="relative ml-4 flex-1 max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          placeholder="학생, 반, 시험명으로 검색"
          className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <DirectorUserMenu staffName={staffName} role={role} />
    </header>
  );
}
