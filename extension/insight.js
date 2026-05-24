
chrome.storage.onChanged.addListener(
  () => loadDashboard()
);

loadDashboard();

async function loadDashboard(){

  const result =
    await chrome.storage.local.get(
      ["beaconPrompts"]
    );

  const prompts =
    result.beaconPrompts || [];

  renderStats(prompts);
  renderTimeline(prompts);
  renderStudents(prompts);
  renderRiskChart(prompts);
  renderPlatformChart(prompts);

}

function renderStats(prompts){

  document.getElementById(
    "studentsCount"
  ).innerText =
    new Set(
      prompts.map(
        p => p.id
      )
    ).size;

  document.getElementById(
    "alertsCount"
  ).innerText =
    prompts.filter(
      p => p.risk !== "low"
    ).length;

  document.getElementById(
    "blockedCount"
  ).innerText =
    prompts.filter(
      p => p.blocked
    ).length;

}

function renderTimeline(prompts){

  const container =
    document.getElementById(
      "timeline"
    );

  container.innerHTML = "";

  [...prompts]
    .reverse()
    .slice(0,20)
    .forEach((entry) => {

      const div =
        document.createElement("div");

      div.className =
        `timeline-item ${entry.risk}`;

      div.innerHTML = `
        <strong>
          ${entry.risk.toUpperCase()}
        </strong>

        <div style="margin-top:10px">
          ${entry.prompt}
        </div>

<div style="
  margin-top:12px;
  color:#64748B;
  font-size:12px;
">
  Matched:
  ${(entry.matched || []).join(", ")}
</div>

<div style="
  margin-top:6px;
  color:#94A3B8;
  font-size:11px;
">
  ${new Date(entry.timestamp)
      .toLocaleString()}
</div>
      `;

      container.appendChild(div);

    });

}

function renderStudents(prompts){

  const container =
    document.getElementById(
      "students"
    );

  container.innerHTML = "";

  const grouped = {};

  prompts.forEach((p) => {

    const id =
      "Student-" +
      String(p.id).slice(-3);

    if(!grouped[id]){
      grouped[id] = 0;
    }

    grouped[id] +=
      p.risk === "high"
        ? 40
        : p.risk === "medium"
          ? 20
          : 5;

  });

  Object.entries(grouped)
    .sort((a,b)=>b[1]-a[1])
    .slice(0,6)
    .forEach(([id,score]) => {

      const div =
        document.createElement("div");

      div.className =
        "student-card";

      div.innerHTML = `
        <strong>${id}</strong>

        <div style="
          margin-top:8px;
          color:#013B93;
          font-weight:bold;
        ">
          Behaviour Score: ${score}
        </div>
      `;

      container.appendChild(div);

    });

}

function renderRiskChart(prompts){

  const canvas =
    document.getElementById(
      "riskChart"
    );

  const ctx =
    canvas.getContext("2d");

  ctx.clearRect(
    0,0,
    canvas.width,
    canvas.height
  );

  const values = [

    prompts.filter(
      p => p.risk === "low"
    ).length,

    prompts.filter(
      p => p.risk === "medium"
    ).length,

    prompts.filter(
      p => p.risk === "high"
    ).length

  ];

  const labels = [
    "LOW",
    "MED",
    "HIGH"
  ];

  const colors = [
    "#10B981",
    "#F59E0B",
    "#DC2626"
  ];

  const max =
    Math.max(...values,1);

  values.forEach((v,i)=>{

    const h =
      (v/max) * 140;

    const x =
      60 + (i*120);

    ctx.fillStyle =
      colors[i];

    ctx.fillRect(
      x,
      180-h,
      70,
      h
    );

    ctx.fillStyle =
      "#0F172A";

    ctx.font =
      "bold 14px Arial";

    ctx.fillText(
      labels[i],
      x+10,
      205
    );

  });

}

function renderPlatformChart(prompts){

  const canvas =
    document.getElementById(
      "platformChart"
    );

  const ctx =
    canvas.getContext("2d");

  ctx.clearRect(
    0,0,
    canvas.width,
    canvas.height
  );

  const grouped = {};

  prompts.forEach((p)=>{

    grouped[p.hostname] =
      (grouped[p.hostname] || 0)+1;

  });

  const total =
    Object.values(grouped)
      .reduce((a,b)=>a+b,0) || 1;

  const colors = [
    "#013B93",
    "#10B981",
    "#F59E0B",
    "#8B5CF6"
  ];

  let start = 0;

  Object.entries(grouped)
    .forEach(([k,v],i)=>{

      const slice =
        (v/total) *
        Math.PI * 2;

      ctx.beginPath();

      ctx.moveTo(
        140,110
      );

      ctx.arc(
        140,
        110,
        80,
        start,
        start + slice
      );

      ctx.closePath();

      ctx.fillStyle =
        colors[i %
          colors.length];

      ctx.fill();

      ctx.fillStyle =
        "#0F172A";

      ctx.font =
        "13px Arial";

      ctx.fillText(
        `${k}: ${v}`,
        270,
        40 + (i*22)
      );

      start += slice;

    });

}
