import { useState, useEffect } from "react";
import { jsPDF } from "jspdf";
import wcagImg from "./assets/wcag.png";
import owaspImg from "./assets/asvs.png";
import tlsImg from "./assets/tls.png";
import logoImg from "./assets/logo1.png";
import "./App.css";

const API = "http://localhost:5001", META = { gdpr: { label: "GDPR", desc: "EU General Data Protection Regulation" }, ccpa: { label: "CCPA", desc: "California Consumer Privacy Act" }, pci_dss: { label: "PCI-DSS", desc: "Payment Card Industry Standards" } };
const BADGE = { compliant: { label: "Compliant", style: "badge-success", icon: "✓" }, partial: { label: "Needs Fix", style: "badge-warning", icon: "~" }, non_compliant: { label: "Non-Compliant", style: "badge-danger", icon: "✕" } };
const getRisk = (d) => (Number(d?.score ?? 0) > 99 ? "No Risk" : d?.risk || "Low Risk");
const riskBadge = (r) => (r === "No Risk" || r === "Low Risk" ? "risk-low" : r === "Medium Risk" ? "risk-med" : "risk-high");

export default function App() {
  const [f, setF] = useState({ mode: "url", url: "", text: "", gdpr: true, ccpa: true, pci_dss: true });
  const [app, setApp] = useState({ res: null, load: false, err: "", prog: 0, status: "", clauses: {}, modal: false });
  const [chat, setChat] = useState({ open: false, input: "", load: false, msgs: [{ sender: "ai", text: "Hello! I am your AI Legal Assistant. Feel free to ask any questions related to the audited policy.." }] });
  useEffect(() => { if (app.res) window.scrollTo(0, 0); }, [app.res]);

  const downloadReport = () => {
    if (!app.res) return;
    const clean = (v) => String(v ?? "").replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, "-").replace(/[^\x20-\x7E\n]/g, "");
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    let y = 110;
    const write = (txt, { size = 10, bold = false, color = [15, 23, 42], gap = 4, indent = 0 } = {}) => {
      doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor(...color);
      doc.splitTextToSize(clean(txt), 515 - indent).forEach((l) => { if (y > 800) { doc.addPage(); y = 50; } doc.text(l, 40 + indent, y); y += size * 1.35; });
      y += gap;
    };
    doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.setTextColor(15, 23, 42); doc.text("HELLO POLICY - AUDIT REPORT", 40, 55);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(71, 85, 105); doc.text(clean("Target: " + (f.mode === "url" ? f.url : "Pasted policy text")), 40, 75);
    if (app.res.engine) { doc.setFontSize(9); doc.setTextColor(100, 116, 139); doc.text(clean("Engine: " + app.res.engine), 40, 89); }
    const all = Object.values(app.res.checks || {}).flatMap((c) => Object.values(c)), [nOk, nP] = [all.filter((x) => x.status === "compliant").length, all.filter((x) => x.status === "partial").length];
    write("SUMMARY", { size: 14, bold: true, gap: 6 });
    write(`${all.length} clauses checked: ${nOk} compliant, ${nP} need fixes, ${all.length - nOk - nP} non-compliant.`, { gap: 8 });
    Object.entries(app.res.frameworkScores || {}).forEach(([fw, d]) => write(`${META[fw]?.label || fw}:  ${getRisk(d)}`, { size: 11, bold: true, gap: 2 }));
    y += 8;
    Object.entries(app.res.checks || {}).forEach(([fw, clauses]) => {
      y += 6; write(`${META[fw]?.label || fw} - DETAILED FINDINGS`, { size: 14, bold: true, gap: 8 });
      Object.entries(clauses).forEach(([name, i]) => {
        const c = i.status === "compliant" ? [21, 128, 61] : i.status === "partial" ? [180, 83, 9] : [185, 28, 28];
        write(`${name}  [${(BADGE[i.status] || BADGE.non_compliant).label}]`, { size: 11, bold: true, color: c, gap: 2 });
        if (i.evidence) write(`Evidence: "${i.evidence}"`, { indent: 10, gap: 2, color: [71, 85, 105] });
        if (i.explanation) write(`Analysis: ${i.explanation}`, { indent: 10, gap: 2 });
        if (i.fix) write(`Recommended fix: ${i.fix}`, { indent: 10, gap: 2, color: [133, 77, 14] });
        y += 8;
      });
    });
    write("Automatically generated for educational purposes. Not legal advice.", { size: 8, color: [100, 116, 139] });
    for (let p = 1; p <= doc.getNumberOfPages(); p++) {
      doc.setPage(p); doc.saveGraphicsState(); doc.setGState(new doc.GState({ opacity: 0.1 }));
      doc.setFont("helvetica", "bold"); doc.setFontSize(56); doc.setTextColor(15, 23, 42);
      const k = 0.7071 * (doc.getTextWidth("HELLO POLICY") / 2);
      [190, 421, 652].forEach((cy) => doc.text("HELLO POLICY", 297.5 - k, cy + k, { angle: 45 }));
      doc.restoreGraphicsState();
    }
    const name = (f.mode === "url" ? f.url : "policy-text").replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40) || "report";
    doc.save(`hello-policy-report-${name}.pdf`);
  };

  const checkPolicy = async () => {
    const fw = ["gdpr", "ccpa", "pci_dss"].filter((k) => f[k]);
    if (!fw.length) return setApp((p) => ({ ...p, err: "Please select at least one framework." }));
    if (f.mode === "url" && !f.url.trim()) return setApp((p) => ({ ...p, err: "Please enter a website URL." }));
    if (f.mode === "text" && f.text.trim().length < 30) return setApp((p) => ({ ...p, err: "Minimum 30 characters required for policy text." }));
    setApp((p) => ({ ...p, load: true, res: null, err: "", prog: 0, status: "Connecting to server...", clauses: {} }));
    try {
      const res = await fetch(`${API}/api/check-${f.mode}-stream`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [f.mode]: f[f.mode], frameworks: fw }) });
      if (!res.ok || !res.body) throw new Error();
      const reader = res.body.getReader(), decoder = new TextDecoder("utf-8");
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const parts = (buf + decoder.decode(value, { stream: true })).split("\n\n");
        buf = parts.pop();
        for (const line of parts) {
          if (!line.startsWith("data: ")) continue;
          const data = JSON.parse(line.replace("data: ", ""));
          if (data.error) return setApp((p) => ({ ...p, err: data.error, load: false }));
          if (typeof data.progress === "number") setApp((p) => ({ ...p, prog: data.progress, status: data.progress === 45 ? "Generating AI reasoning..." : data.progress < 100 ? (data.status || "") : p.status }));
          if (data.progress === 100 && data.result) setApp((p) => ({ ...p, res: data.result, load: false }));
        }
      }
      setApp((p) => (p.load ? { ...p, load: false, err: "Stream ended without a result. Please try again." } : p));
    } catch { setApp((p) => ({ ...p, load: false, err: "Connection error." })); }
  };

  const sendChat = async (m) => {
    const text = m || chat.input;
    if (!text.trim()) return;
    const msgs = [...chat.msgs, { sender: "user", text }];
    setChat((p) => ({ ...p, msgs, input: m ? p.input : "", load: true }));
    try {
      const res = await fetch(`${API}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text, policyText: app.res?.policyText || f.text || "", checks: app.res?.checks || {} }) });
      const data = await res.json();
      setChat((p) => ({ ...p, msgs: [...msgs, { sender: "ai", text: data.success ? data.reply : "Error: " + data.reply }], load: false }));
    } catch { setChat((p) => ({ ...p, msgs: [...msgs, { sender: "ai", text: "Error connecting to AI Assistant." }], load: false })); }
  };

  return (
    <div className="layout-wrapper">
      <nav className="navbar">
        <div className="nav-container">
          <div className="nav-left"><div className="brand"><img src={logoImg} alt="Hello Policy logo" className="brand-logo" /><span className="brand-title">Hello Policy</span></div></div>
          <button className="nav-policy-link" onClick={() => setApp((p) => ({ ...p, modal: true }))}>Our Privacy Policy</button>
        </div>
      </nav>

      {!app.res && (
        <section className="hero-wrapper">
          <div className="hero-container">
            <div className="form-card">
              <div className="card-title-group"><span className="eyebrow">PRIVACY POLICY ANALYZER</span><h2>Does your privacy policy meet the legal and global standards?</h2></div>
              <div className="tab-switcher">{["url", "text"].map((m) => (<button key={m} className={f.mode === m ? "active" : ""} onClick={() => { setF((p) => ({ ...p, mode: m })); setApp((p) => ({ ...p, res: null, err: "" })); }}>{m.toUpperCase()}</button>))}</div>
              <div className="framework-pills">{["gdpr", "ccpa", "pci_dss"].map((k) => (<label key={k} className={`pill-checkbox ${f[k] ? "selected" : ""}`}><input type="checkbox" checked={f[k]} onChange={(e) => setF((p) => ({ ...p, [k]: e.target.checked }))} /> {META[k].label}</label>))}</div>
              <div className="input-group">
                <label>{f.mode === "url" ? "Target Domain / Policy Link" : "Document Content"}</label>
                {f.mode === "url" ? <input type="text" placeholder="https://company.com/privacy-policy" value={f.url} onChange={(e) => setF((p) => ({ ...p, url: e.target.value }))} disabled={app.load} />
                  : <textarea placeholder="Paste complete Privacy Policy text here..." value={f.text} onChange={(e) => setF((p) => ({ ...p, text: e.target.value }))} disabled={app.load} />}
              </div>
              {app.load ? (<div style={{ marginTop: "16px", padding: "16px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ fontSize: "13px", fontWeight: "600", color: "#334155" }}>{app.status}</span><span className="loading-spinner" /></div>) : <button className="btn-primary" onClick={checkPolicy}>Check Policy</button>}
              {app.err && <div style={{ color: "#dc2626", fontSize: "0.85rem", marginTop: "12px", fontWeight: "600" }}>{app.err}</div>}
            </div>
            <div className="hero-visual">
              <svg className="vector-graphic-svg" viewBox="0 0 540 440" fill="none">
                <rect x="0" y="170" width="500" height="260" rx="6" fill="#8896aa" stroke="#4b5766" strokeWidth="4" /><rect x="0" y="170" width="500" height="26" rx="4" fill="#4b5766" /><rect x="30" y="179" width="360" height="8" rx="2" fill="#fff" />
                {[440, 455, 470].map((cx, i) => <circle key={cx} cx={cx} cy="183" r="4" fill={i === 2 ? "#94a3b8" : "#e2e8f0"} />)}
                {[10, 390].map((x) => <rect key={x} x={x} y="215" width="100" height="120" rx="3" fill="#c7cedb" />)}
                <rect x="10" y="350" width="90" height="26" rx="3" fill="#a9b3c4" /><rect x="10" y="385" width="260" height="6" rx="2" fill="#a9b3c4" /><rect x="10" y="398" width="260" height="6" rx="2" fill="#a9b3c4" />
                <rect x="390" y="350" width="100" height="6" rx="2" fill="#a9b3c4" /><rect x="390" y="365" width="100" height="26" rx="3" fill="#a9b3c4" />
                <rect x="150" y="75" width="205" height="270" rx="8" fill="#d5dbe6" stroke="#6b788c" strokeWidth="2" /><rect x="170" y="95" width="16" height="13" rx="2" fill="#4b5766" /><path d="M 173 95 V 90 A 5 5 0 0 1 183 90 V 95" stroke="#4b5766" strokeWidth="2.5" fill="none" />
                <rect x="196" y="93" width="140" height="8" rx="2" fill="#8896aa" /><rect x="196" y="106" width="110" height="8" rx="2" fill="#8896aa" /><rect x="167" y="125" width="170" height="195" rx="4" fill="#dfe4ec" stroke="#8c99ad" strokeWidth="1.2" /><rect x="177" y="135" width="85" height="12" rx="2" fill="#8896aa" />
                {[158, 168, 178, 188, 198, 208, 260, 270, 280, 290, 300].map((y) => <rect key={y} x="177" y={y} width="150" height="4" rx="2" fill="#b4bdcc" />)}
                <rect x="177" y="238" width="150" height="12" rx="2" fill="#8896aa" /><rect x="150" y="335" width="205" height="8" rx="2" fill="#4aa8f0" />
                {["M 85 40 H 60 V 85", "M 395 40 H 420 V 85", "M 85 395 H 60 V 350", "M 395 395 H 420 V 350"].map((d, i) => <path key={i} d={d} stroke="#fff" strokeWidth="3" />)}
              </svg>
            </div>
          </div>
        </section>
      )}

      {app.res && (
        <section className="report-header">
          <div className="report-header-inner">
            <div><span className="report-eyebrow">PRIVACY POLICY AUDIT REPORT</span><h1>{f.mode === "url" ? f.url.replace(/^https?:\/\//, "").replace(/\/$/, "") : "Pasted policy text"}</h1></div>
            <div className="report-actions"><button className="report-download" onClick={downloadReport}>⬇ Download report</button><button className="report-back" onClick={() => setApp((p) => ({ ...p, res: null }))}>← New audit</button></div>
          </div>
        </section>
      )}

      <main className="main-container">
        {app.res && (
          <div className="results-wrapper">
            {app.res.frameworkScores && (
              <div className="card scorecard-card">
                <div className="card-header flex-between"><h3>Compliance Health Index</h3></div>
                <div className="score-grid">
                  {Object.entries(app.res.frameworkScores).map(([fw, data]) => {
                    const risk = getRisk(data);
                    return (
                      <div key={fw} className="score-box">
                        <div className="score-top"><span className="fw-title">{META[fw]?.label || fw.toUpperCase()}</span><span className={`risk-tag ${riskBadge(risk)}`}>{risk}</span></div>
                        <div className="progress-bar-bg"><div className="progress-bar-fill" style={{ width: `${data.score}%`, backgroundColor: Number(data.score) > 75 ? "#059669" : Number(data.score) > 45 ? "#d97706" : "#dc2626" }} /></div>
                        <span className="fw-desc">{META[fw]?.desc || "Regulatory Standard"}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {Object.entries(app.res.checks || {}).map(([fw, clauses]) => (
              <div key={fw} className="card framework-section">
                <div className="section-title-bar"><h2>{META[fw]?.label || fw.toUpperCase()} assessment:</h2></div>
                <div className="accordion-list">
                  {Object.entries(clauses).map(([name, info]) => {
                    const k = `${fw}:${name}`, open = !!app.clauses[k], b = BADGE[info.status] || BADGE.non_compliant;
                    return (
                      <div key={k} className={`accordion-item ${open ? "open" : ""}`}>
                        <div className="accordion-header" onClick={() => setApp((p) => ({ ...p, clauses: { ...p.clauses, [k]: !p.clauses[k] } }))}>
                          <div className="header-left"><span className={`status-icon-badge ${b.style}`}>{b.icon}</span><span className="clause-name">{name}</span></div>
                          <div className="header-right"><span className={`status-pill-tag ${b.style}`}>{b.label}</span><span className="chevron">{open ? "▲" : "▼"}</span></div>
                        </div>
                        {open && (
                          <div className="accordion-body">
                            {info.evidence && <div className="detail-block"><strong>Extracted Evidence:</strong><p className="quote">"{info.evidence}"</p></div>}
                            {info.explanation && <div className="detail-block"><strong>Audit Analysis:</strong><p>{info.explanation}</p></div>}
                            {info.fix && <div className="detail-block fix-block"><strong>💡 Recommended Remediation:</strong><p>{info.fix}</p></div>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {app.modal && (
        <div className="policy-overlay" onClick={() => setApp((p) => ({ ...p, modal: false }))}>
          <div className="policy-modal" onClick={(e) => e.stopPropagation()}>
            <div className="policy-modal-header"><h2>Privacy Policy</h2><button className="policy-close" onClick={() => setApp((p) => ({ ...p, modal: false }))}>✕</button></div>
            <div className="policy-modal-body">
              <p>Hello Policy is a free privacy policy analyzer built as an educational project. This policy explains what and how personal data is handled when user gives it, and what rights does the user have according to applicable data protection/security frameworks.</p>
              <h4>1. Who we are</h4><p>Hello Policy is operated by Aditya Sharma, from Khanna City, dist: Ludhiana. For any privacy question or request, contact: <b>aditya88727@gmail.com</b></p>
              <h4>2. What data we handle</h4><ul><li><b>Content you submit:</b> The website URL or policy text you input, and the compliance frameworks you select.</li><li><b>Extracted policy text:</b> When a URL is submitted, our backend server fetches the public page to extract its privacy policy text.</li><li><b>Chat prompts:</b> The questions you type into the Policy AI Assistant.</li><li><b>Technical metadata:</b> Ephemeral connection details (such as IP address and request headers) visible to the server during active runtime transit.</li></ul><p>We do not collect names, contact numbers, email addresses, or user credentials. Please do not submit confidential personal data into the analyzer.</p>
              <h4>3. Purpose and legal basis</h4><ul><li><b>Service execution:</b> To parse text, generate reports, and provide AI chat responses. Legal Basis: User consent upon initiating an analysis (GDPR Art. 6(1)(a)).</li><li><b>Operational maintenance:</b> To maintain system availability and protect endpoints from abusive request traffic. Legal Basis: Legitimate interests (GDPR Art. 6(1)(f)).</li></ul><p>Analyses are generated automatically by large language models for educational and informational purposes only; they do not constitute formal legal counsel.</p>
              <h4>4. Third-party data sharing</h4><ul><li><b>Gemini API:</b> Submitted policy text and chat queries are transmitted over encrypted HTTPS/TLS to Google Gemini APIs to generate analysis inferences. Google processes these requests under enterprise API terms without persistent retention for consumer model training.</li><li><b>Google Fonts:</b> Static font assets are delivered via Google CDN, which logs standard client IP addresses during network transit.</li><li><b>Target website servers:</b> Standard HTTP GET requests are dispatched to external domain hosts during automated URL scraping.</li></ul><p>We do not monetize, rent, or sell any submitted data, and no advertising trackers are used.</p>
              <h4>5. Zero data retention architecture</h4><p>Hello Policy operates on an ephemeral, stateless architecture. The application does not connect to any database.</p><p><b>Submitted text, URL extracts, and chat messages are held exclusively in volatile RAM during active processing and are completely cleared once the response terminates.</b></p>
              <h4>6. Cookies and tracking</h4><p>We do not use cookies, accounts, analytics, advertising trackers, or local storage to track you.</p>
              <h4>7. Payments</h4><p>The tool is free. We do not ask for, collect, process or store any payment, credit card, or bank information of any kind.</p>
              <h4>8. User rights</h4><p>Hello Policy maintains an ephemeral architecture and retains zero user accounts or submitted documents in any database, there are no persistent personal records stored to access, modify, or erase.</p>
              <h4>9. Security</h4><p>All network communication between client, backend, and external AI services is secured using TLS encryption. Application code is audited against WCAG and OWASP ASVP standards.</p>
              <h4>10. Updates and disclaimer</h4><p>We may update this policy to reflect future technical enhancements. All audit assessments are automated educational outputs and do not represent legally binding advice.</p>
            </div>
          </div>
        </div>
      )}

      <div className="chat-widget-container">
        {!chat.open ? <button className="chat-trigger-btn" onClick={() => setChat((p) => ({ ...p, open: true }))}><span>✨</span><span>Ask Policy AI</span></button> : (
          <div className="chat-window card">
            <div className="chat-header"><div className="chat-title"><span>🤖 Legal Intelligence Assistant</span></div><button className="close-btn" onClick={() => setChat((p) => ({ ...p, open: false }))}>✕</button></div>
            <div className="chat-body">{chat.msgs.map((m, i) => <div key={i} className={`chat-bubble ${m.sender}`}>{m.text}</div>)}{chat.load && <div className="chat-typing">AI reasoning...</div>}</div>
            <div className="chat-suggestions"><button onClick={() => sendChat("How to fix non-compliance issues?")}>Fix Issues</button><button onClick={() => sendChat("Draft a GDPR compliant clause")}>Draft Clause</button></div>
            <div className="chat-input-bar"><input type="text" placeholder="Ask about compliance..." value={chat.input} onChange={(e) => setChat((p) => ({ ...p, input: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && sendChat()} /><button onClick={() => sendChat()}>Send</button></div>
          </div>
        )}
      </div>

      <footer style={{ marginTop: "50px", padding: "24px 20px", borderTop: "1px solid #e2e8f0", textAlign: "center", background: "#ffffff" }}>
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "100px", flexWrap: "wrap", marginBottom: "12px" }}>
          <a href="/wcag-real.html" target="_blank" rel="noopener noreferrer" title="View WCAG 2.2 Accessibility Audit Report" style={{ display: "inline-block", cursor: "pointer" }}>
            <img src={wcagImg} alt="WCAG 2.2 Compliant" className="trust-badge" />
          </a>
          <a href="/asvs-real.pdf" target="_blank" rel="noopener noreferrer" title="View OWASP ASVS Security Verification Report" style={{ display: "inline-block", cursor: "pointer" }}>
            <img src={owaspImg} alt="OWASP ASVS Aligned" className="trust-badge" />
          </a>
          <img src={tlsImg} alt="TLS 1.3 Encrypted" className="trust-badge" />
        </div>
      </footer>
    </div>
  );
}