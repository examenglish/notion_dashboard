"use client";

import { useEffect, useState } from "react";
import StudentSearchTable from "./StudentSearchTable";
import StudentDetailPanel, { StudentDetail } from "./StudentDetailPanel";
import type { StudentRow } from "@/components/StudentTable";

export default function DirectorStudentsClient({
  initialStudents,
  staffName,
}: {
  initialStudents: StudentRow[];
  staffName: string;
}) {
  const [query, setQuery] = useState("");
  const [students, setStudents] = useState<StudentRow[]>(initialStudents);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<StudentDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    const handle = setTimeout(() => {
      fetch(`/api/students?q=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .then(setStudents);
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  async function selectStudent(id: string) {
    setSelectedId(id);
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/students/${id}`);
      const data = await res.json();
      setDetail(data);
    } finally {
      setLoadingDetail(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:h-[calc(100vh-8.5rem)] lg:grid-cols-[420px_1fr]">
      <StudentSearchTable
        students={students}
        query={query}
        onQueryChange={setQuery}
        onSelect={selectStudent}
        selectedId={selectedId}
      />
      <StudentDetailPanel
        detail={detail}
        loading={loadingDetail}
        staffName={staffName}
        onChanged={() => selectedId && selectStudent(selectedId)}
      />
    </div>
  );
}
