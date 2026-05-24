
const DEFAULT_POLICIES = {

  highRisk: [
    "kill",
    "bomb",
    "suicide"
  ],

  mediumRisk: [
    "violence",
    "weapon"
  ]

};

document.addEventListener(
  "DOMContentLoaded",
  async () => {

    await initializePolicies();

    document
      .getElementById(
        "addPolicyBtn"
      )
      .addEventListener(
        "click",
        addPolicy
      );

    loadDashboard();

  }
);

chrome.storage.onChanged.addListener(
  (changes, area) => {

    if (
      area === "local"
    ) {

      loadDashboard();

    }

  }
);

async function initializePolicies() {

  const result =
    await chrome.storage.local.get(
      ["beaconPolicies"]
    );

  if (!result.beaconPolicies) {

    await chrome.storage.local.set({

      beaconPolicies:
        DEFAULT_POLICIES

    });

  }

}

async function getPolicies() {

  const result =
    await chrome.storage.local.get(
      ["beaconPolicies"]
    );

  return (
    result.beaconPolicies ||
    DEFAULT_POLICIES
  );

}

async function loadDashboard() {

  const result =
    await chrome.storage.local.get([
      "beaconPrompts"
    ]);

  const prompts =
    result.beaconPrompts || [];

  renderStats(prompts);
  renderTimeline(prompts);
  renderPolicies();

}

function renderStats(prompts) {

  const alerts =
    prompts.filter(
      p => p.risk !== "low"
    );

  const blocked =
    prompts.filter(
      p => p.blocked
    );

  const students =
    new Set(
      prompts.map(
        p => p.id
      )
    );

  document.getElementById(
    "studentsCount"
  ).innerText =
    students.size;

  document.getElementById(
    "alertsCount"
  ).innerText =
    alerts.length;

  document.getElementById(
    "blockedCount"
  ).innerText =
    blocked.length;

}

function renderTimeline(prompts) {

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

        <div>
          <strong>
            ${entry.risk.toUpperCase()}
          </strong>
        </div>

        <div style="margin-top:8px">
          ${entry.prompt}
        </div>

        <div style="
          margin-top:10px;
          color:#64748B;
          font-size:12px;
        ">
          Matched:
          ${(entry.matched || []).join(", ")}
        </div>

      `;

      container.appendChild(div);

    });

}

async function renderPolicies() {

  const policies =
    await getPolicies();

  renderPolicyList(
    "highRiskList",
    policies.highRisk,
    "highRisk"
  );

  renderPolicyList(
    "mediumRiskList",
    policies.mediumRisk,
    "mediumRisk"
  );

}

function renderPolicyList(
  containerId,
  list,
  severity
) {

  const container =
    document.getElementById(
      containerId
    );

  container.innerHTML = "";

  list.forEach((word) => {

    const div =
      document.createElement("div");

    div.className =
      "policy-item";

    div.innerHTML = `

      <span>${word}</span>

      <button
        class="remove-btn"
        data-word="${word}"
        data-severity="${severity}"
      >
        Remove
      </button>

    `;

    container.appendChild(div);

  });

  container
    .querySelectorAll(
      ".remove-btn"
    )
    .forEach((btn) => {

      btn.addEventListener(
        "click",
        async (e) => {

          await removePolicy(
            e.target.dataset.severity,
            e.target.dataset.word
          );

        }
      );

    });

}

async function addPolicy() {

  const word =
    document
      .getElementById(
        "policyWord"
      )
      .value
      .trim()
      .toLowerCase();

  const severity =
    document
      .getElementById(
        "policySeverity"
      )
      .value;

  if (!word) {
    return;
  }

  const policies =
    await getPolicies();

  if (
    !policies[severity]
      .includes(word)
  ) {

    policies[severity]
      .push(word);

    await chrome.storage.local.set({

      beaconPolicies:
        policies

    });

  }

  document.getElementById(
    "policyWord"
  ).value = "";

  renderPolicies();

}

async function removePolicy(
  severity,
  word
) {

  const policies =
    await getPolicies();

  policies[severity] =
    policies[severity]
      .filter(
        item => item !== word
      );

  await chrome.storage.local.set({

    beaconPolicies:
      policies

  });

}
