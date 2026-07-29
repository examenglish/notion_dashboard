import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "이그잼영어학원 관리",
  description: "직원용 학원관리 웹앱",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
