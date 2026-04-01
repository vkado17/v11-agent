import { useState } from "react";

const DEFAULT_TEMPLATE = `Hey {{first_name}},

Love your work with {{company}}. Someone in V11 mentioned you’re doing extremely interesting work in {{sector}}, so I wanted to extend a quick personal invite to you. 

Hosting a small, invite-only 3-course private dinner for 10 exceptional Infra/ML founders next week in SF. Attendees include others building in data / RL, orchestration, and agent interfaces, etc.

If you’re around, we’d love to have you - here’s the [private invite link](https://luma.com/nlntmttj).

Best,
Vatsalya
Co-founder, V11`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Helpers ──────────────────────────────────────────────────────────────────
function parseJSON(text) {
  const clean = text.replace(/```json|```/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON in response");
  return JSON.parse(clean.slice(start, end + 1));
}

async function callClaude({ system, messages, tools, mcp_servers, maxTokens = 6000 }) {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, messages, tools, mcp_servers, max_tokens: maxTokens }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Style tokens ─────────────────────────────────────────────────────────────
const GOLD = "#c9a84c";
const BG = "#07090e";
const BORDER = "#1a1f2e";
const MUTED = "#4a5578";
const IB = "#0d1120";

const inp = {
  width: "100%", background: IB, border: `1px solid ${BORDER}`, borderRadius: 6,
  padding: "9px 12px", color: "#e8e9ed", fontSize: 13, outline: "none",
  boxSizing: "border-box", fontFamily: "inherit",
};
const lbl = {
  fontSize: 10, fontWeight: 700, color: MUTED, textTransform: "uppercase",
  letterSpacing: 1.2, marginBottom: 5, display: "block",
};
const sec = {
  fontSize: 10, fontWeight: 700, color: "#253050", textTransform: "uppercase",
  letterSpacing: 1.5, marginBottom: 14,
};
const btnGold = {
  background: GOLD, color: "#07090e", border: "none", borderRadius: 6,
  padding: "10px 18px", fontWeight: 700, fontSize: 12, cursor: "pointer", letterSpacing: 0.5,
};
const btnOut = {
  background: "transparent", color: GOLD, border: `1px solid ${GOLD}44`,
  borderRadius: 6, padding: "7px 14px", fontWeight: 600, fontSize: 12, cursor: "pointer",
};
const scoreColor = (n) => n >= 80 ? "#4ade80" : n >= 60 ? "#fbbf24" : "#f87171";
const personKey = (p) => p.email || p.linkedinUrl || `${p.firstName}-${p.lastName}`;

// ── Component ─────────────────────────────────────────────────────────────────
export default function V11Agent() {
  const [dinner, setDinner] = useState({
    sector: "", city: "", date: "", count: 15, prompt: "", template: DEFAULT_TEMPLATE,
  });
  const [phase, setPhase] = useState("setup");
  const [logs, setLogs] = useState([]);
  const [people, setPeople] = useState([]);
  const [approved, setApproved] = useState({});
  const [emailOverrides, setEmailOverrides] = useState({});
  const [selected, setSelected] = useState(0);
  const [drafted, setDrafted] = useState(new Set());

  const log = (msg, type = "info") => setLogs((p) => [...p, { msg, type }]);
  const reset = () => {
    setPhase("setup"); setPeople([]); setLogs([]);
    setApproved({}); setEmailOverrides({}); setSelected(0); setDrafted(new Set());
  };

  // ── PIPELINE ─────────────────────────────────────────────────────────────────
  const run = async () => {
    setPhase("running"); setLogs([]); setPeople([]);
    setApproved({}); setEmailOverrides({}); setSelected(0); setDrafted(new Set());

    try {
      // Step 1: Exa — find LinkedIn profiles
      const exaQuery = [
        `${dinner.sector} founders engineers researchers ${dinner.city}`,
        dinner.prompt ? dinner.prompt : "",
      ].filter(Boolean).join(" ");
      log(`Searching Exa: "${exaQuery}"...`);
      const exaRes = await fetch("/api/exa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: exaQuery,
          numResults: Math.min(dinner.count * 3, 40),
          includeDomains: ["linkedin.com"],
          useAutoprompt: true,
          type: "neural",
          contents: { text: { maxCharacters: 400 } },
        }),
      });
      if (!exaRes.ok) throw new Error(`Exa ${exaRes.status}: ${await exaRes.text()}`);
      const exaData = await exaRes.json();
      const profiles = (exaData.results || [])
        .filter((r) => r.url?.includes("linkedin.com/in/"))
        .map((r) => ({
          linkedinUrl: r.url,
          rawName: r.title?.split(" - ")[0]?.split(" | ")[0]?.trim() || "",
          snippet: (r.text || "").slice(0, 300),
        }));
      log(`Found ${profiles.length} LinkedIn profiles`, "success");
      if (!profiles.length) throw new Error("No LinkedIn profiles found. Try broader sector/city terms.");

      // Step 2: Fullenrich — bulk enrich (async: POST → poll until FINISHED)
      log(`Sending ${profiles.length} profiles to Fullenrich...`);
      log(`This takes ~30–90 seconds...`);
      const fRes = await fetch("/api/fullenrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profiles: profiles.slice(0, 100) }),
      });
      if (!fRes.ok) throw new Error(`Fullenrich error: ${await fRes.text()}`);
      const fData = await fRes.json();
      const enriched = fData.enriched || [];
      enriched.forEach((p) => log(`  ✓ ${p.firstName} ${p.lastName} @ ${p.company || "?"}`));
      log(`${enriched.length} / ${fData.total} profiles with verified emails`, "success");
      if (!enriched.length) throw new Error("Fullenrich found no emails. Check credits and API key.");

      // No Claude scoring — show enriched profiles directly for your review
      setPeople(enriched.slice(0, dinner.count));
      const initApproved = {};
      enriched.slice(0, dinner.count).forEach((p) => { initApproved[personKey(p)] = null; });
      setApproved(initApproved);
      log(`${Math.min(enriched.length, dinner.count)} people ready to review`, "success");
      setPhase("approve");
    } catch (e) {
      log(`Error: ${e.message}`, "error");
      setPhase("error");
    }
  };

  // ── APPROVE ───────────────────────────────────────────────────────────────────
  const decide = (key, val) => setApproved((prev) => ({ ...prev, [key]: val }));
  const approveAndNext = (key) => {
    decide(key, true);
    if (selected < people.length - 1) setSelected((s) => s + 1);
  };
  const skipAndNext = (key) => {
    decide(key, false);
    if (selected < people.length - 1) setSelected((s) => s + 1);
  };

  const approvedPeople = people.filter((p) => approved[personKey(p)] === true);
  const pendingCount = people.filter((p) => approved[personKey(p)] === null).length;

  // ── DRAFT ─────────────────────────────────────────────────────────────────────
  const draftAll = async () => {
    setPhase("drafting");

    try {
      // Generate personalized emails for all approved people
      log(`Writing personalized invites for ${approvedPeople.length} people...`);
      const draftData = await callClaude({
        system: "You write concise, high-signal, personalized dinner invites that feel human, not templated. Return only valid JSON.",
        messages: [{
          role: "user",
          content: `Write V11 dinner invites. Sector: ${dinner.sector}. City: ${dinner.city}. Date: ${dinner.date || "TBD"}.${dinner.prompt ? `\nTarget profile: ${dinner.prompt}` : ""}

Template:
${dinner.template}

People: ${JSON.stringify(approvedPeople)}

For each person: replace ALL {{variables}} and add 1-2 specific lines referencing their actual work from their bio. Keep it short and high-signal.

Return JSON:
{"emails":[{"email":"","subject":"short punchy subject line","body":"full personalized email text"}]}`,
        }],
        maxTokens: 8000,
      });

      const draftText = draftData.content?.find((b) => b.type === "text")?.text || "";
      const draftsMap = {};
      (parseJSON(draftText).emails || []).forEach((e) => { draftsMap[e.email] = e; });

      // Save to Gmail as drafts
      log(`Saving to Gmail Drafts...`);
      for (const person of approvedPeople) {
        const resolvedEmail = emailOverrides[personKey(person)] || person.email;
        const draft = draftsMap[resolvedEmail] || draftsMap[person.email];
        if (!draft) { log(`  No draft generated for ${person.firstName}`, "error"); continue; }

        try {
          await callClaude({
            mcp_servers: [{ type: "url", url: "https://gmail.mcp.claude.com/mcp", name: "gmail" }],
            messages: [{
              role: "user",
              content: `Create a Gmail draft:\nTo: ${resolvedEmail}\nSubject: ${draft.subject}\nBody:\n${draft.body}`,
            }],
            maxTokens: 300,
          });
          setDrafted((prev) => new Set([...prev, personKey(person)]));
          log(`  ✓ Saved draft → ${person.firstName} ${person.lastName}`, "success");
        } catch (e) {
          log(`  Failed for ${person.firstName}: ${e.message}`, "error");
        }
        await sleep(400);
      }

      log(`Done. ${drafted.size + 1} drafts in Gmail.`, "success");
      setPhase("done");
    } catch (e) {
      log(`Error: ${e.message}`, "error");
    }
  };

  const cur = people[selected];
  const curKey = cur ? personKey(cur) : null;
  const canRun = dinner.sector && dinner.city;

  // ── RENDER ────────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: ${BG}; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1a2538; border-radius: 2px; }
        input, textarea { transition: border-color 0.15s; }
        input:focus, textarea:focus { border-color: ${GOLD}55 !important; }
        button:active { opacity: 0.8; }
      `}</style>
      <div style={{ background: BG, minHeight: "100vh", color: "#e8e9ed", fontFamily: "'Inter', system-ui, sans-serif", display: "flex", flexDirection: "column", fontSize: 14 }}>

        {/* Header */}
        <div style={{ padding: "15px 24px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontFamily: "Georgia, serif", fontSize: 20, fontWeight: 700, color: GOLD }}>V11</span>
          <span style={{ fontSize: 12, color: "#1e2538" }}>/</span>
          <span style={{ fontSize: 12, color: "#2d3a56" }}>Dinner Invite Agent</span>
          <div style={{ marginLeft: 16, display: "flex", gap: 6, alignItems: "center" }}>
            {["Setup", "Discover", "Review", "Draft"].map((s, i) => {
              const idx = { setup: 0, running: 1, error: 1, approve: 2, drafting: 3, done: 3 }[phase] ?? 0;
              return (
                <span key={s} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {i > 0 && <span style={{ color: "#1e2538", fontSize: 10 }}>›</span>}
                  <span style={{ fontSize: 11, color: i === idx ? GOLD : i < idx ? "#2d3a56" : "#1a2238", fontWeight: i === idx ? 700 : 400 }}>{s}</span>
                </span>
              );
            })}
          </div>
          {phase === "approve" && (
            <div style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: MUTED }}>{approvedPeople.length} approved · {pendingCount} pending</span>
              <button style={{ ...btnGold, opacity: approvedPeople.length === 0 ? 0.35 : 1 }} onClick={draftAll} disabled={approvedPeople.length === 0}>
                Draft {approvedPeople.length > 0 ? approvedPeople.length : ""} Approved →
              </button>
            </div>
          )}
          {(phase === "done" || phase === "error") && (
            <div style={{ marginLeft: "auto" }}>
              <button style={btnOut} onClick={reset}>← New Search</button>
            </div>
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden", height: "calc(100vh - 56px)" }}>

          {/* Sidebar */}
          <div style={{ width: 285, borderRight: `1px solid ${BORDER}`, padding: "20px 18px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 18, flexShrink: 0 }}>
            <div>
              <div style={sec}>Dinner Config</div>
              {[["sector", "Sector", "enterprise, RL, biotech..."], ["city", "City", "Berkeley, SF, NYC..."], ["date", "Date", "April 7th, 2026..."]].map(([k, label, ph]) => (
                <div key={k} style={{ marginBottom: 11 }}>
                  <label style={lbl}>{label}</label>
                  <input style={inp} placeholder={ph} value={dinner[k]} onChange={(e) => setDinner((p) => ({ ...p, [k]: e.target.value }))} />
                </div>
              ))}
              <div style={{ marginBottom: 11 }}>
                <label style={lbl}>Who to Target</label>
                <textarea
                  style={{ ...inp, height: 72, fontSize: 12, resize: "vertical", lineHeight: 1.6 }}
                  placeholder={"e.g. Series A+ founders, ex-Google/Meta engineers, RL researchers with open source projects, no sales people"}
                  value={dinner.prompt}
                  onChange={(e) => setDinner((p) => ({ ...p, prompt: e.target.value }))}
                />
              </div>
              <div style={{ marginBottom: 11 }}>
                <label style={lbl}>Invite Count</label>
                <input style={inp} type="number" min={5} max={30} value={dinner.count} onChange={(e) => setDinner((p) => ({ ...p, count: +e.target.value }))} />
              </div>
            </div>
            <div>
              <div style={sec}>Template</div>
              <div style={{ fontSize: 9, color: "#1e2a42", marginBottom: 7, fontFamily: "monospace", lineHeight: 1.8 }}>
                {"{{first_name}}  {{company}}  {{sector}}  {{city}}  {{date}}"}
              </div>
              <textarea style={{ ...inp, height: 185, fontFamily: "monospace", fontSize: 11, resize: "vertical", lineHeight: 1.75 }} value={dinner.template} onChange={(e) => setDinner((p) => ({ ...p, template: e.target.value }))} />
            </div>
            {(phase === "setup" || phase === "approve" || phase === "done" || phase === "error") && (
              <button style={{ ...btnGold, width: "100%", opacity: canRun ? 1 : 0.35 }} onClick={run} disabled={!canRun}>
                {phase === "setup" ? "▶  Run Pipeline" : "↺  New Search"}
              </button>
            )}
            {(phase === "running" || phase === "drafting") && (
              <div style={{ ...btnGold, width: "100%", opacity: 0.4, textAlign: "center", cursor: "default" }}>Running...</div>
            )}
            {logs.length > 0 && (
              <div style={{ background: "#040610", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "11px 13px", fontFamily: "monospace", fontSize: 10, maxHeight: 240, overflowY: "auto", lineHeight: 1.9 }}>
                {logs.map((l, i) => (
                  <div key={i} style={{ color: l.type === "success" ? "#4ade80" : l.type === "error" ? "#f87171" : "#2d3f60" }}>{l.msg}</div>
                ))}
                {(phase === "running" || phase === "drafting") && <div style={{ color: GOLD, opacity: 0.4 }}>▸ working...</div>}
              </div>
            )}
          </div>

          {/* Main */}
          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

            {phase === "setup" && (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12, opacity: 0.25 }}>
                <div style={{ fontSize: 40, color: GOLD }}>◈</div>
                <div style={{ fontFamily: "Georgia, serif", fontSize: 16, color: GOLD }}>Configure and run</div>
                <div style={{ fontSize: 12, color: MUTED }}>Exa → Fullenrich → Review → Gmail Drafts</div>
              </div>
            )}

            {phase === "running" && (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
                <div style={{ fontFamily: "Georgia, serif", fontSize: 18, color: GOLD }}>Discovering people...</div>
                <div style={{ fontSize: 12, color: MUTED }}>Exa is searching LinkedIn, Fullenrich is enriching emails. ~30–60 seconds.</div>
                <div style={{ display: "flex", gap: 24, marginTop: 8 }}>
                  {["Exa Search", "Fullenrich Enrich", "Ready to Review"].map((s, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 6, height: 6, borderRadius: "50%", background: GOLD, opacity: 0.4 }} />
                      <span style={{ fontSize: 11, color: MUTED }}>{s}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {phase === "error" && (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
                <div style={{ fontFamily: "Georgia, serif", fontSize: 18, color: "#f87171" }}>Something went wrong</div>
                <div style={{ fontSize: 12, color: MUTED }}>See logs on the left. Try adjusting sector/city or check API keys in .env.local.</div>
              </div>
            )}

            {/* Approve phase */}
            {phase === "approve" && people.length > 0 && (
              <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
                <div style={{ width: 245, borderRight: `1px solid ${BORDER}`, overflowY: "auto", flexShrink: 0 }}>
                  <div style={{ padding: "12px 16px", borderBottom: `1px solid ${BORDER}` }}>
                    <div style={{ fontSize: 10, color: MUTED, textTransform: "uppercase", letterSpacing: 1.2, fontWeight: 700 }}>
                      {people.length} People · Review Each
                    </div>
                  </div>
                  {people.map((p, i) => {
                    const key = personKey(p);
                    const state = approved[key];
                    return (
                      <div key={i} onClick={() => setSelected(i)} style={{ padding: "12px 16px", borderBottom: `1px solid ${BORDER}`, cursor: "pointer", background: i === selected ? "#0e1424" : "transparent", borderLeft: i === selected ? `2px solid ${GOLD}` : state === true ? "2px solid #4ade8055" : state === false ? "2px solid #f8717133" : "2px solid transparent", opacity: state === false ? 0.4 : 1 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: "#e8e9ed" }}>{p.firstName} {p.lastName}</span>
                          <span>{state === true ? <span style={{ fontSize: 11, color: "#4ade80" }}>✓</span> : state === false ? <span style={{ fontSize: 11, color: "#f87171" }}>✗</span> : <span style={{ fontSize: 11, color: "#2d3a56" }}>—</span>}</span>
                        </div>
                        <div style={{ fontSize: 11, color: "#2d3a56", marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.company}</div>
                        <div style={{ fontSize: 11, color: "#1e2a3a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.title}</div>
                      </div>
                    );
                  })}
                </div>

                {cur && (
                  <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px", display: "flex", flexDirection: "column", gap: 20 }}>
                    <div>
                      <div style={{ fontFamily: "Georgia, serif", fontSize: 24, marginBottom: 5, color: "#f0f0f5" }}>{cur.firstName} {cur.lastName}</div>
                      <div style={{ fontSize: 14, color: MUTED }}>{cur.title}</div>
                      <div style={{ fontSize: 13, color: "#253050", marginTop: 2 }}>{cur.company}{cur.location ? ` · ${cur.location}` : ""}</div>
                    </div>
                    {cur.snippet && (
                      <div style={{ background: IB, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "16px 20px" }}>
                        <div style={lbl}>LinkedIn Snippet</div>
                        <div style={{ fontSize: 13, color: "#8892aa", lineHeight: 1.7 }}>{cur.snippet}</div>
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={lbl}>Email</div>
                        <input
                          style={inp}
                          placeholder={cur.email}
                          value={emailOverrides[curKey] !== undefined ? emailOverrides[curKey] : cur.email || ""}
                          onChange={(e) => setEmailOverrides((prev) => ({ ...prev, [curKey]: e.target.value }))}
                        />
                      </div>
                      {cur.linkedinUrl && (
                        <a href={cur.linkedinUrl} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 8, background: IB, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "12px 20px", textDecoration: "none", color: GOLD, fontSize: 13, fontWeight: 600, flexShrink: 0, alignSelf: "flex-end" }}>
                          LinkedIn ↗
                        </a>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 12 }}>
                      <button onClick={() => skipAndNext(curKey)} style={{ flex: 1, background: approved[curKey] === false ? "#f8717122" : IB, border: `1px solid ${approved[curKey] === false ? "#f87171" : BORDER}`, borderRadius: 8, padding: "14px", color: approved[curKey] === false ? "#f87171" : "#3a4a6a", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
                        ✗  Skip
                      </button>
                      <button onClick={() => approveAndNext(curKey)} style={{ flex: 1, background: approved[curKey] === true ? "#4ade8022" : IB, border: `1px solid ${approved[curKey] === true ? "#4ade80" : BORDER}`, borderRadius: 8, padding: "14px", color: approved[curKey] === true ? "#4ade80" : "#3a4a6a", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
                        ✓  Approve
                      </button>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <button onClick={() => setSelected((s) => Math.max(0, s - 1))} style={{ ...btnOut, padding: "6px 14px", opacity: selected === 0 ? 0.3 : 1 }}>← Prev</button>
                      <span style={{ fontSize: 11, color: "#1e2a3a" }}>{selected + 1} of {people.length}</span>
                      <button onClick={() => setSelected((s) => Math.min(people.length - 1, s + 1))} style={{ ...btnOut, padding: "6px 14px", opacity: selected === people.length - 1 ? 0.3 : 1 }}>Next →</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {phase === "drafting" && (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
                <div style={{ fontFamily: "Georgia, serif", fontSize: 18, color: GOLD }}>Writing & saving drafts...</div>
                <div style={{ fontSize: 13, color: MUTED }}>{drafted.size} / {approvedPeople.length} saved to Gmail</div>
              </div>
            )}

            {phase === "done" && (
              <div style={{ flex: 1, overflowY: "auto", padding: "30px 36px" }}>
                <div style={{ fontFamily: "Georgia, serif", fontSize: 22, color: GOLD, marginBottom: 6 }}>{drafted.size} drafts saved to Gmail</div>
                <div style={{ fontSize: 13, color: MUTED, marginBottom: 28 }}>Open Gmail → Drafts to review and send.</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 32 }}>
                  {[["Discovered", people.length], ["Approved", approvedPeople.length], ["Drafted", drafted.size]].map(([label, val]) => (
                    <div key={label} style={{ background: IB, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "18px 22px" }}>
                      <div style={{ fontSize: 28, fontWeight: 700, color: "#e8e9ed", marginBottom: 4 }}>{val}</div>
                      <div style={{ fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
                    </div>
                  ))}
                </div>
                <div style={sec}>Drafted Invites</div>
                {approvedPeople.map((p, i) => (
                  <div key={i} style={{ background: IB, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "15px 20px", marginBottom: 10, display: "flex", alignItems: "center", gap: 16 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{p.firstName} {p.lastName}</div>
                      <div style={{ fontSize: 12, color: MUTED }}>{p.title} · {p.company}</div>
                      <div style={{ fontSize: 11, color: "#2d3a56", marginTop: 2 }}>{emailOverrides[personKey(p)] || p.email}</div>
                    </div>
                    {drafted.has(personKey(p))
                      ? <span style={{ fontSize: 11, color: "#4ade80", fontWeight: 600 }}>✓ in Gmail Drafts</span>
                      : <span style={{ fontSize: 11, color: "#f87171" }}>not drafted</span>
                    }
                    {p.linkedinUrl && <a href={p.linkedinUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: GOLD, textDecoration: "none", flexShrink: 0 }}>LinkedIn ↗</a>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
