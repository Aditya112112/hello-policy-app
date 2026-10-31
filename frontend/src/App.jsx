import { useState, useEffect } from "react";
import { jsPDF } from "jspdf";
import wcagImg from "./assets/wcag.png";
import owaspImg from "./assets/asvs.png";
import tlsImg from "./assets/tls.png";
import logoImg from "./assets/logo1.png";
import "./App.css";

// Dynamic API Base URL for Production (Azure) and Local development
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

const FRAMEWORK_META = {
  gdpr: { label: "GDPR", desc: "EU General Data Protection Regulation", color: "#059669", bg: "#ecfdf5" },
  ccpa: { label: "CCPA", desc: "California Consumer Privacy Act", color: "#2563eb", bg: "#eff6ff" },
  pci_dss: { label: "PCI-DSS", desc: "Payment Card Industry Standards", color: "#d97706", bg: "#fffbeb" },
};

function statusBadge(status) {
  if (status === "compliant") return { label: "Compliant", style: "badge-success", icon: "✓" };
  if (status === "partial") return { label: "Needs Fix", style: "badge-warning", icon: "~" };
  return { label: "Non-Compliant", style: "badge-danger", icon: "✕" };
}

function getRisk(d) {
  return d.score >= 99 ? "No Risk" : d.risk;
}

function riskBadge(risk) {
  if (risk === "No Risk" || risk === "Low Risk") return "risk-low";
  if (risk === "Medium Risk") return "risk-med";
  return "risk-high";
}

function App() {
  const [mode, setMode] = useState("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");

  const [frameworks, setFrameworks] = useState({
    gdpr: true,
    ccpa: true,
    pci_dss: true,
  });

  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [openClauses, setOpenClauses] = useState({});

  // Real-time Loading States
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");

  // Chatbot State
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([
    { sender: "ai", text: "Hello! Main aapka AI Legal Assistant hu. Audited policy se judi koi bhi query poochni ho toh batayein." }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  // Jump to top when the report page opens
  useEffect(() => { if (result) window.scrollTo(0, 0); }, [result]);

  // Download detailed report directly as a PDF file (no new window)
  const downloadReport = () => {
    if (!result) return;
    const clean = (v) => String(v ?? "").replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, "-").replace(/[^\x20-\x7E\n]/g, "");
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const M = 40, W = 515;
    let y = 0;
    const write = (text, o = {}) => {
      const { size = 10, bold = false, color = [15, 23, 42], gap = 4, indent = 0 } = o;
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(size);
      doc.setTextColor(...color);
      doc.splitTextToSize(clean(text), W - indent).forEach((line) => {
        if (y > 800) { doc.addPage(); y = 50; }
        doc.text(line, M + indent, y);
        y += size * 1.35;
      });
      y += gap;
    };
    const target = mode === "url" ? url : "Pasted policy text";

    // Header (plain, no background)
    doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.setTextColor(15, 23, 42);
    doc.text("HELLO POLICY - AUDIT REPORT", M, 55);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(71, 85, 105);
    doc.text(clean("Target: " + target), M, 75);
    y = 110;

    // Summary
    const all = Object.values(result.checks || {}).flatMap((c) => Object.values(c));
    const nOk = all.filter((x) => x.status === "compliant").length;
    const nPart = all.filter((x) => x.status === "partial").length;
    write("SUMMARY", { size: 14, bold: true, gap: 6 });
    write(`${all.length} clauses checked: ${nOk} compliant, ${nPart} need fixes, ${all.length - nOk - nPart} non-compliant.`, { gap: 8 });
    Object.entries(result.frameworkScores || {}).forEach(([fw, d]) => {
      write(`${FRAMEWORK_META[fw]?.label || fw}:  ${getRisk(d)}`, { size: 11, bold: true, gap: 2 });
    });
    y += 8;

    // Detailed findings
    Object.entries(result.checks || {}).forEach(([fw, clauses]) => {
      y += 6;
      write(`${FRAMEWORK_META[fw]?.label || fw} - DETAILED FINDINGS`, { size: 14, bold: true, gap: 8 });
      Object.entries(clauses).forEach(([name, i]) => {
        const b = statusBadge(i.status);
        const c = i.status === "compliant" ? [21, 128, 61] : i.status === "partial" ? [180, 83, 9] : [185, 28, 28];
        write(`${name}  [${b.label}]`, { size: 11, bold: true, color: c, gap: 2 });
        if (i.evidence) write(`Evidence: "${i.evidence}"`, { indent: 10, gap: 2, color: [71, 85, 105] });
        if (i.explanation) write(`Analysis: ${i.explanation}`, { indent: 10, gap: 2 });
        if (i.fix) write(`Recommended fix: ${i.fix}`, { indent: 10, gap: 2, color: [133, 77, 14] });
        y += 8;
      });
    });
    write("Automatically generated for educational purposes. Not legal advice.", { size: 8, color: [100, 116, 139] });

    // Watermark on every page: 3 diagonal "HELLO POLICY" marks
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.saveGraphicsState();
      doc.setGState(new doc.GState({ opacity: 0.1 }));
      doc.setFont("helvetica", "bold"); doc.setFontSize(56); doc.setTextColor(15, 23, 42);
      const tw = doc.getTextWidth("HELLO POLICY");
      const k = 0.7071 * (tw / 2);
      [190, 421, 652].forEach((cy) => doc.text("HELLO POLICY", 297.5 - k, cy + k, { angle: 45 }));
      doc.restoreGraphicsState();
    }

    const name = (mode === "url" ? url : "policy-text").replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40) || "report";
    doc.save(`hello-policy-report-${name}.pdf`);
  };

  const [showPolicy, setShowPolicy] = useState(false);

  const handleCheckboxChange = (e) => {
    setFrameworks({ ...frameworks, [e.target.name]: e.target.checked });
  };

  const toggleClause = (key) => {
    setOpenClauses((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const checkPolicy = async () => {
    const selectedList = Object.keys(frameworks).filter((k) => frameworks[k]);
    if (selectedList.length === 0) {
      setError("At least ek framework select karein.");
      return;
    }
    if (mode === "url" && !url.trim()) {
      setError("Please website URL enter karein.");
      return;
    }
    if (mode === "text" && text.trim().length < 30) {
      setError("Minimum 30 characters ka policy text paste karein.");
      return;
    }

    setLoading(true);
    setResult(null);
    setError("");
    setProgress(0);
    setStatusText("Connecting to server...");
    setOpenClauses({});

    try {
      const endpoint = mode === "url" ? "/api/check-url-stream" : "/api/check-text-stream";
      const payload = mode === "url" ? { url, frameworks: selectedList } : { text, frameworks: selectedList };

      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n\n");

        for (let line of lines) {
          if (line.startsWith("data: ")) {
            const jsonStr = line.replace("data: ", "");
            try {
              const data = JSON.parse(jsonStr);

              if (data.error) {
                setError(data.error);
                setLoading(false);
                return;
              }

              setProgress(data.progress);
              if (data.progress < 100) {
                setStatusText(data.status);
              }

              if (data.progress === 100 && data.result) {
                setResult(data.result);
                setLoading(false);
              }
            } catch (e) {
              console.error("Parsing stream data issue:", e);
            }
          }
        }
      }
    } catch (err) {
      setError("Backend server se connection drop ho gaya.");
      setLoading(false);
    }
  };

  const sendChatMessage = async (msgText) => {
    const textToSend = msgText || chatInput;
    if (!textToSend.trim()) return;

    const newMsgs = [...chatMessages, { sender: "user", text: textToSend }];
    setChatMessages(newMsgs);
    if (!msgText) setChatInput("");
    setChatLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: textToSend,
          policyText: result?.policyText || text || "",
          checks: result?.checks || {},
        }),
      });

      const data = await response.json();
      if (data.success) {
        setChatMessages([...newMsgs, { sender: "ai", text: data.reply }]);
      } else {
        setChatMessages([...newMsgs, { sender: "ai", text: "Error: " + data.reply }]);
      }
    } catch (err) {
      setChatMessages([...newMsgs, { sender: "ai", text: "AI Assistant se connect karne me dikkat aayi." }]);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div className="layout-wrapper">
      <nav className="navbar">
        <div className="nav-container">
          <div className="nav-left">
            <div className="brand">
              <img src={logoImg} alt="Hello Policy logo" className="brand-logo" />
              <span className="brand-title">Hello Policy</span>
            </div>
          </div>
          <button className="nav-policy-link" onClick={() => setShowPolicy(true)}>Our Privacy Policy</button>
        </div>
      </nav>

      {!result && (
      <section className="hero-wrapper">
        <div className="hero-container">
          <div className="form-card">
            <div className="card-title-group">
              <span className="eyebrow">PRIVACY POLICY ANALYZER</span>
              <h2>Does your privacy policy meet the legal and global standards?</h2>
            </div>

            <div className="tab-switcher">
              <button
                className={mode === "url" ? "active" : ""}
                onClick={() => { setMode("url"); setResult(null); setError(""); }}
              >
                URL
              </button>
              <button
                className={mode === "text" ? "active" : ""}
                onClick={() => { setMode("text"); setResult(null); setError(""); }}
              >
                TEXT
              </button>
            </div>

            <div className="framework-pills">
              <label className={`pill-checkbox ${frameworks.gdpr ? "selected" : ""}`}>
                <input type="checkbox" name="gdpr" checked={frameworks.gdpr} onChange={handleCheckboxChange} />
                GDPR
              </label>
              <label className={`pill-checkbox ${frameworks.ccpa ? "selected" : ""}`}>
                <input type="checkbox" name="ccpa" checked={frameworks.ccpa} onChange={handleCheckboxChange} />
                CCPA
              </label>
              <label className={`pill-checkbox ${frameworks.pci_dss ? "selected" : ""}`}>
                <input type="checkbox" name="pci_dss" checked={frameworks.pci_dss} onChange={handleCheckboxChange} />
                PCI-DSS
              </label>
            </div>

            {mode === "url" ? (
              <div className="input-group">
                <label>Target Domain / Policy Link</label>
                <input
                  type="text"
                  placeholder="https://company.com/privacy-policy"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={loading}
                />
              </div>
            ) : (
              <div className="input-group">
                <label>Document Content</label>
                <textarea
                  placeholder="Paste complete Privacy Policy text here..."
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  disabled={loading}
                />
              </div>
            )}

            {loading ? (
              <div style={{ marginTop: "16px", padding: "16px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "13px", fontWeight: "600", color: "#334155" }}>
                   {statusText}
                </span>
                <span className="loading-spinner" />
              </div>
            ) : (
              <button className="btn-primary" onClick={checkPolicy}>
                Check Policy
              </button>
            )}

            {error && <div style={{ color: "#dc2626", fontSize: "0.85rem", marginTop: "12px", fontWeight: "600" }}>{error}</div>}
          </div>

          <div className="hero-visual">
            <svg className="vector-graphic-svg" viewBox="0 0 540 440" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="0" y="170" width="500" height="260" rx="6" fill="#8896aa" stroke="#4b5766" strokeWidth="4" />
              <rect x="0" y="170" width="500" height="26" rx="4" fill="#4b5766" />
              <rect x="30" y="179" width="360" height="8" rx="2" fill="#ffffff" />
              <circle cx="440" cy="183" r="4" fill="#e2e8f0" />
              <circle cx="455" cy="183" r="4" fill="#e2e8f0" />
              <circle cx="470" cy="183" r="4" fill="#94a3b8" />
              <rect x="10" y="215" width="100" height="120" rx="3" fill="#c7cedb" />
              <rect x="390" y="215" width="100" height="120" rx="3" fill="#c7cedb" />
              <rect x="10" y="350" width="90" height="26" rx="3" fill="#a9b3c4" />
              <rect x="10" y="385" width="260" height="6" rx="2" fill="#a9b3c4" />
              <rect x="10" y="398" width="260" height="6" rx="2" fill="#a9b3c4" />
              <rect x="390" y="350" width="100" height="6" rx="2" fill="#a9b3c4" />
              <rect x="390" y="365" width="100" height="26" rx="3" fill="#a9b3c4" />
              <rect x="150" y="75" width="205" height="270" rx="8" fill="#d5dbe6" stroke="#6b788c" strokeWidth="2" />
              <rect x="170" y="95" width="16" height="13" rx="2" fill="#4b5766" />
              <path d="M 173 95 V 90 A 5 5 0 0 1 183 90 V 95" stroke="#4b5766" strokeWidth="2.5" fill="none" />
              <rect x="196" y="93" width="140" height="8" rx="2" fill="#8896aa" />
              <rect x="196" y="106" width="110" height="8" rx="2" fill="#8896aa" />
              <rect x="167" y="125" width="170" height="195" rx="4" fill="#dfe4ec" stroke="#8c99ad" strokeWidth="1.2" />
              <rect x="177" y="135" width="85" height="12" rx="2" fill="#8896aa" />
              {[158,168,178,188,198,208].map(y=> <rect key={y} x="177" y={y} width="150" height="4" rx="2" fill="#b4bdcc" />)}
              <rect x="177" y="238" width="150" height="12" rx="2" fill="#8896aa" />
              {[260,270,280,290,300].map(y=> <rect key={y} x="177" y={y} width="150" height="4" rx="2" fill="#b4bdcc" />)}
              <rect x="150" y="335" width="205" height="8" rx="2" fill="#4aa8f0" />
            </svg>
          </div>
        </div>
      </section>
      )}

      {result && (
        <section className="report-header">
          <div className="report-header-inner">
            <div>
              <span className="report-eyebrow">PRIVACY POLICY AUDIT REPORT</span>
              <h1>{mode === "url" ? url.replace(/^https?:\/\//, "").replace(/\/$/, "") : "Pasted policy text"}</h1>
            </div>
            <div className="report-actions">
              <button className="report-download" onClick={downloadReport}>⬇ Download report</button>
              <button className="report-back" onClick={() => setResult(null)}>← New audit</button>
            </div>
          </div>
        </section>
      )}

      <main className="main-container">
        {result && (
          <div className="results-wrapper">
            {result.frameworkScores && (
              <div className="card scorecard-card">
                <div className="card-header flex-between">
                  <div>
                    <h3>Compliance Health Index</h3>
                  </div>
                </div>

                <div className="score-grid">
                  {Object.entries(result.frameworkScores).map(([fw, data]) => {
                    const meta = FRAMEWORK_META[fw] || { label: fw.toUpperCase(), desc: "Regulatory Standard" };
                    return (
                      <div key={fw} className="score-box">
                        <div className="score-top">
                          <span className="fw-title">{meta.label}</span>
                          <span className={`risk-tag ${riskBadge(getRisk(data))}`}>{getRisk(data)}</span>
                        </div>
                        <div className="progress-bar-bg">
                          <div
                            className="progress-bar-fill"
                            style={{
                              width: `${data.score}%`,
                              backgroundColor: data.score > 75 ? "#059669" : data.score > 45 ? "#d97706" : "#dc2626"
                            }}
                          ></div>
                        </div>
                        <span className="fw-desc">{meta.desc}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {Object.entries(result.checks || {}).map(([fw, clauses]) => {
              const meta = FRAMEWORK_META[fw] || { label: fw.toUpperCase(), color: "#0f172a" };
              return (
                <div key={fw} className="card framework-section">
                  <div className="section-title-bar">
                    <h2>{meta.label} assessment:</h2>
                  </div>

                  <div className="accordion-list">
                    {Object.entries(clauses).map(([name, info]) => {
                      const key = `${fw}:${name}`;
                      const open = !!openClauses[key];
                      const badge = statusBadge(info.status);

                      return (
                        <div key={key} className={`accordion-item ${open ? "open" : ""}`}>
                          <div className="accordion-header" onClick={() => toggleClause(key)}>
                            <div className="header-left">
                              <span className={`status-icon-badge ${badge.style}`}>{badge.icon}</span>
                              <span className="clause-name">{name}</span>
                            </div>
                            <div className="header-right">
                              <span className={`status-pill-tag ${badge.style}`}>{badge.label}</span>
                              <span className="chevron">{open ? "▲" : "▼"}</span>
                            </div>
                          </div>

                          {open && (
                            <div className="accordion-body">
                              {info.evidence && (
                                <div className="detail-block">
                                  <strong>Extracted Evidence:</strong>
                                  <p className="quote">"{info.evidence}"</p>
                                </div>
                              )}
                              {info.explanation && (
                                <div className="detail-block">
                                  <strong>Audit Analysis:</strong>
                                  <p>{info.explanation}</p>
                                </div>
                              )}
                              {info.fix && (
                                <div className="detail-block fix-block">
                                  <strong>💡 Recommended Remediation:</strong>
                                  <p>{info.fix}</p>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {showPolicy && (
        <div className="policy-overlay" onClick={() => setShowPolicy(false)}>
          <div className="policy-modal" onClick={(e) => e.stopPropagation()}>
            <div className="policy-modal-header">
              <h2>Privacy Policy</h2>
              <button className="policy-close" onClick={() => setShowPolicy(false)}>✕</button>
            </div>
            <div className="policy-modal-body">
              <p>Hello Policy is a free privacy policy analyzer built as an educational project. This policy explains what and how personal data is handled when user gives it, and what rights does the user have according to applicable data protection/security frameworks.</p>

              <h4>1. Who we are</h4>
              <p>Hello Policy is operated by Aditya Sharma. For any privacy question or request, contact: <b>aditya88727@gmail.com</b></p>

              <h4>2. What data we handle</h4>
              <ul>
                <li><b>Content you submit:</b> The website URL or policy text you input, and the compliance frameworks you select.</li>
                <li><b>Extracted policy text:</b> When a URL is submitted, our backend server fetches the public page to extract its privacy policy text.</li>
                <li><b>Chat prompts:</b> The questions you type into the Policy AI Assistant.</li>
              </ul>

              <h4>3. Security & Hosting</h4>
              <p>All communication is secured using TLS encryption.</p>
            </div>
          </div>
        </div>
      )}

      <div className="chat-widget-container">
        {!chatOpen ? (
          <button className="chat-trigger-btn" onClick={() => setChatOpen(true)}>
            <span>✨</span>
            <span>Ask Policy AI</span>
          </button>
        ) : (
          <div className="chat-window card">
            <div className="chat-header">
              <div className="chat-title">
                <span>🤖 Legal Intelligence Assistant</span>
              </div>
              <button className="close-btn" onClick={() => setChatOpen(false)}>✕</button>
            </div>

            <div className="chat-body">
              {chatMessages.map((m, idx) => (
                <div key={idx} className={`chat-bubble ${m.sender}`}>
                  {m.text}
                </div>
              ))}
              {chatLoading && <div className="chat-typing">AI reasoning...</div>}
            </div>

            <div className="chat-suggestions">
              <button onClick={() => sendChatMessage("How to fix non-compliance issues?")}>Fix Issues</button>
              <button onClick={() => sendChatMessage("Draft a GDPR compliant clause")}>Draft Clause</button>
            </div>

            <div className="chat-input-bar">
              <input
                type="text"
                placeholder="Ask about compliance..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendChatMessage()}
              />
              <button onClick={() => sendChatMessage()}>Send</button>
            </div>
          </div>
        )}
      </div>

      <footer style={{
        marginTop: "50px",
        padding: "24px 20px",
        borderTop: "1px solid #e2e8f0",
        textAlign: "center",
        background: "#ffffff"
      }}>
        <div style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: "100px",
          flexWrap: "wrap",
          marginBottom: "12px"
        }}>
          <img src={wcagImg} alt="WCAG 2.2 Compliant" className="trust-badge" />
          <img src={owaspImg} alt="OWASP ASVS Aligned" className="trust-badge" />
          <img src={tlsImg} alt="TLS 1.3 Encrypted" className="trust-badge" />
        </div>
      </footer>
    </div>
  );
}

export default App;