function Card({
  title,
  value,
  colour,
  delta,
  live
}:any) {

  return (

    <div className="
      bg-white
      rounded-3xl
      p-6
      shadow-sm
      h-[150px]
      flex
      flex-col
      justify-between
      transition-all
      hover:shadow-lg
    ">

      <div className="flex items-center justify-between">

        <div className="text-slate-500 text-lg">
          {title}
        </div>

        {live && (

          <div className="
            flex
            items-center
            gap-2
            text-emerald-500
            text-sm
            font-semibold
          ">

            <div className="
              w-2
              h-2
              rounded-full
              bg-emerald-500
              animate-pulse
            " />

            LIVE

          </div>

        )}

      </div>

      <div
        className="text-6xl font-bold"
        style={{ color: colour }}
      >
        {value}
      </div>

      <div className="text-sm text-slate-400">
        {delta}
      </div>

    </div>

  );

}

export default function KPIGrid({
  totalPrompts,
  alerts,
  blocked,
  wellbeing
}:any) {

  return (

    <div className="p-4 grid grid-cols-4 gap-5">

      <Card
        title="Prompts Detected"
        value={totalPrompts}
        colour="#013B93"
        delta="+12% today"
        live
      />

      <Card
        title="Alerts"
        value={alerts}
        colour="#F59E0B"
        delta="+4 high risk"
        live
      />

      <Card
        title="Blocked"
        value={blocked}
        colour="#DC2626"
        delta="Realtime protection"
        live
      />

      <Card
        title="Wellbeing"
        value={wellbeing}
        colour="#10B981"
        delta="Behaviour stable"
      />

    </div>

  );

}
