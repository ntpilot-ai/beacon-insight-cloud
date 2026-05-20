export default function Sidebar() {
  const items = [
    { icon: "⌂", label: "Dashboard", active: true },
    { icon: "👤", label: "Students", active: false },
    { icon: "🔔", label: "Alerts", active: false },
    { icon: "🛡", label: "Safeguarding", active: false },
    { icon: "📊", label: "Reports", active: false },
    { icon: "📋", label: "Logs", active: false },
    { icon: "⚙", label: "Settings", active: false },
  ];

  return (
    <aside className="w-16 min-h-screen bg-[#013B93] flex flex-col items-center py-4 gap-1 shrink-0">
      {/* Logo */}
      <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center mb-4">
        <span className="text-white text-lg font-bold">B</span>
      </div>

      {items.map((item) => (
        <button
          key={item.label}
          title={item.label}
          className={`
            w-10 h-10 rounded-xl flex items-center justify-center text-lg transition-all
            ${item.active
              ? "bg-white/20 text-white"
              : "text-white/40 hover:text-white/80 hover:bg-white/10"}
          `}
        >
          {item.icon}
        </button>
      ))}
    </aside>
  );
}
