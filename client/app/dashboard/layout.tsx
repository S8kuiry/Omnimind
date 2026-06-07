'use client'
import { usePathname } from "next/navigation";
import Header from "../components/Header";
import Sidebar from "../components/Sidebar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
  
  // Check if the current route is /dashboard/agents
  const showHeader = !pathname.startsWith('/dashboard/agents');
      return (
        <div className="fixed inset-0 flex w-full min-h-screen overflow-hidden bg-[#010003] hide-scrollbar">
            <Sidebar />
            <div className="flex flex-1 flex-col overflow-hidden">
                {showHeader && <Header />}
                <main className="flex-1 overflow-y-auto">
                    {children}
                </main>
            </div>
        </div>
    )
}