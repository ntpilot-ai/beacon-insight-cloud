export default function StudentProfiles({
  students
}:any) {

  return (

    <section className="bg-white rounded-3xl p-6 shadow-sm">

      <h2 className="text-3xl font-bold mb-6">
        Students of Concern
      </h2>

      <div className="space-y-4">

        {students.slice(0,6).map((student:any) => (

          <div
            key={student.name}
            className="
              bg-slate-50
              rounded-2xl
              p-5
              border-l-[6px]
              transition-all
              hover:shadow-md
              hover:scale-[1.01]
            "
            style={{
              borderColor:
                student.status === "Escalated"
                ? "#DC2626"
                : student.status === "Review"
                ? "#F59E0B"
                : "#10B981"
            }}
          >

            <div className="flex items-center justify-between">

              <div>

                <div className="font-bold text-lg">
                  {student.name}
                </div>

                <div className="text-sm text-slate-500 mt-1">
                  {student.prompts} interactions
                </div>

              </div>

              <div
                className="
                  px-3
                  py-1
                  rounded-full
                  text-xs
                  font-bold
                "
                style={{
                  background:
                    student.status === "Escalated"
                    ? "#FEE2E2"
                    : student.status === "Review"
                    ? "#FEF3C7"
                    : "#DCFCE7",

                  color:
                    student.status === "Escalated"
                    ? "#DC2626"
                    : student.status === "Review"
                    ? "#D97706"
                    : "#16A34A"
                }}
              >
                {student.status}
              </div>

            </div>

            <div className="mt-4">

              <div className="flex justify-between text-sm mb-2">
                <span>Behaviour Score</span>
                <span className="font-bold">
                  {student.score}
                </span>
              </div>

              <div className="w-full h-3 rounded-full bg-slate-200 overflow-hidden">

                <div
                  className="h-full rounded-full"
                  style={{
                    width:`${Math.min(student.score,100)}%`,
                    background:
                      student.score >= 75
                      ? "#DC2626"
                      : student.score >= 40
                      ? "#F59E0B"
                      : "#10B981"
                  }}
                />

              </div>

            </div>

          </div>

        ))}

      </div>

    </section>

  );

}
