export default function MonitoringBanner() {

  return (

    <div className="px-4 pt-4">

      <div className="
        bg-gradient-to-r
        from-[#013B93]
        to-[#0F4C5C]
        text-white
        rounded-3xl
        p-5
        flex
        items-center
        justify-between
      ">

        <div>

          <div className="text-2xl font-bold">
            Beacon Realtime Monitoring Active
          </div>

          <div className="text-sm opacity-80 mt-1">
            AI safeguarding telemetry is actively streaming across monitored platforms.
          </div>

        </div>

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

          LIVE

        </div>

      </div>

    </div>

  );

}
