/* NL2SQL frontend — no external deps */
"use strict";

const chatArea   = document.getElementById("chat-area");
const input      = document.getElementById("question-input");
const sendBtn    = document.getElementById("send-btn");
const schemaEl   = document.getElementById("schema-display");
const refreshBtn = document.getElementById("refresh-schema");

const steps = {
  nl:    document.getElementById("step-nl"),
  gen:   document.getElementById("step-gen"),
  judge: document.getElementById("step-judge"),
  exec:  document.getElementById("step-exec"),
};

// ── schema loader ─────────────────────────────────────────────────────────────
async function loadSchema() {
  schemaEl.textContent = "Loading…";
  try {
    const r = await fetch("/api/schema");
    const d = await r.json();
    schemaEl.textContent = d.schema || "No schema found.";
  } catch {
    schemaEl.textContent = "Error loading schema.";
  }
}
loadSchema();
refreshBtn.addEventListener("click", loadSchema);

// ── pipeline step highlighting ────────────────────────────────────────────────
function setSteps(active) {
  const order = ["nl","gen","judge","exec"];
  const idx   = order.indexOf(active);
  order.forEach((k,i) => {
    steps[k].className = "step" + (i < idx ? " done" : i === idx ? " active" : "");
  });
}
function failStep(name) {
  const order = ["nl","gen","judge","exec"];
  const idx   = order.indexOf(name);
  order.forEach((k,i) => {
    if (i === idx)       steps[k].className = "step fail";
    else if (i < idx)    steps[k].className = "step done";
    else                 steps[k].className = "step";
  });
}
function allDone() {
  Object.values(steps).forEach(s => s.className = "step done");
}

// ── helpers ───────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function buildLoading() {
  return `<div class="loading-card" id="loading-card">
    <div class="skel" style="height:16px;width:35%"></div>
    <div class="skel" style="height:12px;width:70%"></div>
    <div class="skel" style="height:12px;width:55%"></div>
    <div class="skel" style="height:12px;width:80%"></div>
  </div>`;
}

function verdictClass(v) {
  if (v === "PASS")            return "pass";
  if (v === "CANNOT_ANSWER")   return "cannot";
  if (v === "EXECUTION_ERROR") return "error";
  return "fail";
}
function verdictIcon(v) {
  if (v === "PASS")            return "✓ SQL validated and executed";
  if (v === "CANNOT_ANSWER")   return "⊘ Cannot answer from schema";
  if (v === "EXECUTION_ERROR") return "⚡ Execution error";
  return "✗ Validation failed";
}

function buildResponse(data) {
  const vc = verdictClass(data.verdict);
  const vi = verdictIcon(data.verdict);

  let sqlBlock = "";
  if (data.sql) {
    sqlBlock = `<div class="sql-block">
      <div class="sql-label">Generated SQL</div>
      <pre class="sql-code">${esc(data.sql)}</pre>
      <button class="copy-btn" onclick="copySql(this)">Copy</button>
    </div>`;
  }

  let issuesBlock = "";
  if (data.issues && data.issues.length) {
    const items = data.issues.map(i => `<div class="issue-item">${esc(i)}</div>`).join("");
    issuesBlock = `<div class="issues-block">${items}</div>`;
  }

  let suggestion = "";
  if (data.suggestion) {
    suggestion = `<div class="sql-block" style="border-bottom:none">
      <div class="sql-label">Suggested fix</div>
      <pre class="sql-code">${esc(data.suggestion)}</pre>
    </div>`;
  }

  let resultsBlock = "";
  if (data.columns && data.columns.length) {
    const hdrs = data.columns.map(c => `<th>${esc(c)}</th>`).join("");
    const rowCount = data.rows.length;
    const rowsHtml = data.rows.map(row =>
      `<tr>${row.map(cell => `<td title="${esc(cell)}">${esc(cell ?? "NULL")}</td>`).join("")}</tr>`
    ).join("");
    resultsBlock = `<div class="results-block">
      <div class="results-meta">${rowCount} row${rowCount !== 1 ? "s" : ""} returned</div>
      <table class="results-table">
        <thead><tr>${hdrs}</tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>`;
  } else if (data.verdict === "PASS") {
    resultsBlock = `<div class="no-results">No rows returned.</div>`;
  }

  const confBadge = data.confidence != null
    ? `<span class="confidence-badge">AI confidence: ${data.confidence}%</span>` : "";

  return `<div class="response-card">
    <div class="verdict-banner ${vc}">
      ${vi}${confBadge}
    </div>
    ${sqlBlock}
    ${issuesBlock}
    ${suggestion}
    ${resultsBlock}
  </div>`;
}

// ── submit handler ────────────────────────────────────────────────────────────
async function submit() {
  const q = input.value.trim();
  if (!q) return;

  // hide welcome
  document.getElementById("welcome")?.remove();

  // append user bubble
  const block = document.createElement("div");
  block.className = "msg-block";
  block.innerHTML = `<div class="user-bubble">${esc(q)}</div>${buildLoading()}`;
  chatArea.appendChild(block);
  chatArea.scrollTop = chatArea.scrollHeight;

  input.value = "";
  autoResize();
  sendBtn.disabled = true;

  setSteps("gen");

  try {
    const resp = await fetch("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q }),
    });

    setSteps("judge");
    const data = await resp.json();

    // simulate brief judge step visibility
    await new Promise(r => setTimeout(r, 300));
    setSteps("exec");
    await new Promise(r => setTimeout(r, 200));

    // remove skeleton, insert result
    block.querySelector("#loading-card")?.remove();

    if (data.error) {
      block.insertAdjacentHTML("beforeend", `<div class="response-card">
        <div class="verdict-banner error">⚡ ${esc(data.error)}</div>
      </div>`);
      failStep("exec");
    } else {
      block.insertAdjacentHTML("beforeend", buildResponse(data));
      if (data.verdict === "PASS") allDone();
      else if (data.verdict === "CANNOT_ANSWER") allDone();
      else failStep("judge");
    }
  } catch (err) {
    block.querySelector("#loading-card")?.remove();
    block.insertAdjacentHTML("beforeend", `<div class="response-card">
      <div class="verdict-banner error">⚡ Network error: ${esc(err.message)}</div>
    </div>`);
    failStep("gen");
  }

  sendBtn.disabled = false;
  chatArea.scrollTop = chatArea.scrollHeight;
}

// ── copy helper ───────────────────────────────────────────────────────────────
window.copySql = function(btn) {
  const code = btn.closest(".sql-block").querySelector(".sql-code").textContent;
  navigator.clipboard.writeText(code).then(() => {
    btn.textContent = "Copied!";
    setTimeout(() => (btn.textContent = "Copy"), 1500);
  });
};

// ── textarea auto-resize ──────────────────────────────────────────────────────
function autoResize() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 140) + "px";
}
input.addEventListener("input", autoResize);

// ── event listeners ───────────────────────────────────────────────────────────
sendBtn.addEventListener("click", submit);
input.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
});

document.querySelectorAll("#examples-list li").forEach(li => {
  li.addEventListener("click", () => {
    input.value = li.dataset.q;
    autoResize();
    input.focus();
  });
});
