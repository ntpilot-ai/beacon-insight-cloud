export default function Header({
  loadEvents
}:any) {

  return (

    <header className="
      bg-[#013B93]
      text-white
      px-8
      py-6
      flex
      items-center
      justify-between
    ">

      <div>

        <h1 className="text-5xl font-bold">
          Beacon Insight v3
        </h1>

        <p className="mt-2 text-sm opacity-90">
          Operational safeguarding intelligence platform
        </p>

      </div>

      <div className="flex items-center gap-4">

        <div className="
          flex
          items-center
          gap-2
          bg-white/10
          px-4
          py-2
          rounded-full
        ">

          <div className="
            w-3
            h-3
            rounded-full
            bg-emerald-400
            animate-pulse
          " />

          <span className="text-sm font-semibold">
            LIVE • Connected
          </span>

        </div>

        <button
          onClick={loadEvents}
          className="font-semibold"
        >
          Refresh
        </button>

      </div>

    </header>

  );

}
