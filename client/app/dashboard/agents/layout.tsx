export default function AgentsLayout({ children }: { children: React.ReactNode }) {
    return (
      <div className="flex flex-1 h-screen overflow-hidden pb-20">
        {children}
      </div>
    )
  }