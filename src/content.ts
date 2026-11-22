/** Read only DOM data from the HRMS page when explicitly requested by the user. */
(() => {
  if (document.getElementById("bracu-hrms-helper-mount")) return;

  async function scan() {
    const saved = await chrome.storage.local.get(["records", "minuteMode"]);
    const mode: HRMS.MinuteMode = saved.minuteMode === "decimal" ? "decimal" : "mmss";
    const fresh = HRMS.parseDocument(document, mode);
    if (!fresh.length) return {count: 0, total: (saved.records || []).length};
    const merged = HRMS.mergeByDate(saved.records || [], fresh);
    await chrome.storage.local.set({records: merged, lastSync: new Date().toISOString()});
    return {count: fresh.length, total: merged.length};
  }

  chrome.runtime.onMessage.addListener((message: {type?: string}, _sender: unknown, reply: (result: unknown) => void) => {
    if (message?.type !== "HRMS_SCAN") return false;
    scan().then(reply).catch((error) => reply({error: String(error)}));
    return true;
  });

  const mount = document.createElement("div");
  mount.id = "bracu-hrms-helper-mount";
  mount.style.position = "fixed";
  mount.style.bottom = "24px";
  mount.style.right = "24px";
  mount.style.zIndex = "2147483646";
  document.documentElement.appendChild(mount);
  const shadow = mount.attachShadow({mode: "closed"});
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      button { cursor: pointer; }
      .toggle { display:flex; align-items:center; gap:9px; border: 1px solid #b9d8ed; border-radius:999px;
        color:white; background: linear-gradient(115deg,#15395e,#237c9b); padding:11px 16px; font-size:13px;
        font-weight:700; box-shadow:0 10px 35px #102c4b39; }
      .dot {width:7px;height:7px;background:#aaf3de;border-radius:50%;}
      .panel { display:none; position:absolute; bottom:56px; right:0; width:310px; border-radius:16px;
        padding:18px; background:#ffffff; color:#11263b; border:1px solid #d9e5eb; box-shadow:0 20px 70px #09294638; }
      .panel.open {display:block;}
      .top {display:flex;align-items:center;justify-content:space-between;gap:10px;}
      .heading {font-size:16px;font-weight:800;letter-spacing:-.5px;}
      .muted {font-size:12px;color:#687d90;line-height:1.5;margin:8px 0 14px;}
      .action {display:block;width:100%;padding:11px 14px;background:#0d617b;color:#fff;border:0;border-radius:9px;font-size:13px;font-weight:700;}
      .close {background:transparent;border:0;color:#657688;font-size:22px;line-height:1;}
      .status {font-size:12px;line-height:1.5;min-height:18px;margin-top:11px; color:#316080;}
    </style>
    <section class="panel" aria-label="HRMS Helper">
      <div class="top"><div class="heading">HRMS Helper</div><button class="close" aria-label="Close">×</button></div>
      <p class="muted">Read attendance rows currently displayed on this page. Your information stays in this browser.</p>
      <button class="action">Sync visible attendance</button>
      <div class="status" role="status"></div>
    </section>
    <button class="toggle" aria-label="Open HRMS Helper"><span class="dot"></span>HRMS Helper</button>
  `;
  const panel = shadow.querySelector<HTMLElement>(".panel")!;
  const status = shadow.querySelector<HTMLElement>(".status")!;
  const action = shadow.querySelector<HTMLButtonElement>(".action")!;
  shadow.querySelector(".toggle")!.addEventListener("click", () => panel.classList.toggle("open"));
  shadow.querySelector(".close")!.addEventListener("click", () => panel.classList.remove("open"));
  action.addEventListener("click", async () => {
    action.disabled = true;
    action.textContent = "Reading visible rows…";
    try {
      const result = await scan();
      status.textContent = result.count
        ? `Saved ${result.count} visible row(s). ${result.total} row(s) cached locally. Click the extension icon for totals.`
        : "No attendance rows found. Open the HRMS attendance table first, or paste the table into the extension.";
    } catch (error) {
      status.textContent = `Could not read page: ${String(error)}`;
    } finally {
      action.disabled = false;
      action.textContent = "Sync visible attendance";
    }
  });
})();
