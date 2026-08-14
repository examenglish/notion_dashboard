import "./director.css";

// This import is the CSS isolation boundary: Tailwind + the shadcn tokens in
// director.css only ever load for routes under /director. Every other route
// keeps using app/globals.css exactly as before.
export default function DirectorLayout({ children }: { children: React.ReactNode }) {
  return children;
}
