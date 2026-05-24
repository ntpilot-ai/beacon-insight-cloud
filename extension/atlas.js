
const DEFAULTS = {

  highRisk:[
    "kill",
    "bomb",
    "suicide"
  ],

  mediumRisk:[
    "violence",
    "weapon"
  ]

};

document.addEventListener(
  "DOMContentLoaded",
  async ()=>{

    const existing =
      await chrome.storage.local.get(
        ["beaconPolicies"]
      );

    if(!existing.beaconPolicies){

      await chrome.storage.local.set({

        beaconPolicies:
          DEFAULTS

      });

    }

    render();

    document.getElementById(
      "addBtn"
    ).addEventListener(
      "click",
      addPolicy
    );

  }
);

async function getPolicies(){

  const result =
    await chrome.storage.local.get(
      ["beaconPolicies"]
    );

  return result.beaconPolicies;

}

async function render(){

  const policies =
    await getPolicies();

  drawList(
    "highList",
    policies.highRisk,
    "highRisk"
  );

  drawList(
    "mediumList",
    policies.mediumRisk,
    "mediumRisk"
  );

}

function drawList(
  id,
  items,
  severity
){

  const container =
    document.getElementById(id);

  container.innerHTML = "";

  items.forEach((word)=>{

    const div =
      document.createElement("div");

    div.className =
      "policy-item";

    div.innerHTML = `
      <span>${word}</span>

      <button
        class="remove"
        data-word="${word}"
        data-severity="${severity}"
      >
        Remove
      </button>
    `;

    container.appendChild(div);

  });

  container
    .querySelectorAll("button")
    .forEach((btn)=>{

      btn.addEventListener(
        "click",
        async (e)=>{

          await removePolicy(
            e.target.dataset.severity,
            e.target.dataset.word
          );

        }
      );

    });

}

async function addPolicy(){

  const word =
    document.getElementById(
      "word"
    ).value
      .trim()
      .toLowerCase();

  const severity =
    document.getElementById(
      "severity"
    ).value;

  if(!word){
    return;
  }

  const policies =
    await getPolicies();

  if(
    !policies[severity]
      .includes(word)
  ){

    policies[severity]
      .push(word);

    await chrome.storage.local.set({

      beaconPolicies:
        policies

    });

  }

  document.getElementById(
    "word"
  ).value = "";

  render();

}

async function removePolicy(
  severity,
  word
){

  const policies =
    await getPolicies();

  policies[severity] =
    policies[severity]
      .filter(
        x => x !== word
      );

  await chrome.storage.local.set({

    beaconPolicies:
      policies

  });

  render();

}
