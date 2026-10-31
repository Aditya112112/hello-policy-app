import os
import re
import json
import logging
import time
import uuid
from urllib.parse import urljoin
from flask import Flask, request, jsonify, Response, stream_with_context
from flask_cors import CORS
import cloudscraper
import requests
from bs4 import BeautifulSoup
from google import genai
from google.genai import types
from dotenv import load_dotenv

app = Flask(__name__)
CORS(app)

load_dotenv()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(message)s",
    datefmt="%H:%M:%S",
)
app.logger.setLevel(logging.INFO)

GEMINI_MODEL = "gemma-4-26b-a4b-it"
client = genai.Client()

scraper = cloudscraper.create_scraper(
    browser={"browser": "chrome", "platform": "windows", "mobile": False}
)
DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
}

FRAMEWORK_CLAUSES = {
    "gdpr": [
        "Data Subject Rights",
        "Data Controller Identification",
        "Lawful Basis for Processing",
        "Data Retention Period",
        "Third-Party Data Sharing",
    ],
    "ccpa": [
        "Categories of Data Collected",
        "Do Not Sell or Share My Info",
        "Right to Know and Access",
        "Right to Request Deletion",
        "Right to Non-Discrimination",
    ],
    "pci_dss": [
        "Payment Card Data Protection",
        "PCI-DSS Compliance Certification",
        "Fraud Detection & Prevention",
        "Secure Payment Gateway Usage",
        "Transmission Encryption",
    ],
}

STATUS_WEIGHT = {"compliant": 1.0, "partial": 0.5, "non_compliant": 0.0}

def normalize_fw(name: str):
    n = name.lower().replace("-", "").replace("_", "")
    if n == "gdpr":
        return "gdpr"
    if n == "ccpa":
        return "ccpa"
    if n == "pcidss":
        return "pci_dss"
    return None

def build_frameworks_dict(selected):
    out = {}
    for f in selected or []:
        key = normalize_fw(f)
        if key and key not in out:
            out[key] = FRAMEWORK_CLAUSES[key]
    return out

def extract_json(text: str):
    if not text:
        return None
    t = text.strip()
    t = re.sub(r"<think>.*?</think>", "", t, flags=re.DOTALL).strip()
    t = re.sub(r"^```(?:json)?\s*", "", t)
    t = re.sub(r"\s*```$", "", t)
    try:
        return json.loads(t)
    except Exception:
        start, end = t.find("{"), t.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                return json.loads(t[start : end + 1])
            except Exception:
                return None
    return None

def evaluate_all_frameworks_single_call(
    policy_text: str,
    frameworks_dict: dict,
    request_id: str = "untracked",
):
    prompt = f"""You are an expert Privacy & Compliance Auditor. Analyze the privacy policy below and return ONLY a valid JSON object. Never use markdown fences.

CONSISTENCY REQUIREMENT:
- Produce the SAME verdict for the SAME policy text every time.
- Keep "evidence" to a short quote (under 25 words) from the policy, or "No relevant text found".
- Keep "explanation" to 1-2 concise sentences explaining why it is compliant, partial, or non-compliant.
- Keep "fix" to 1 concise actionable recommendation if not compliant, else "".

POLICY TEXT (may be truncated):
\"\"\"{policy_text[:12000]}\"\"\"

FRAMEWORKS AND CLAUSES TO EVALUATE:
{json.dumps(frameworks_dict, indent=2)}

For EACH clause choose exactly one status:
- "compliant"      -> text clearly covers the intent of the clause
- "partial"        -> mentioned but incomplete/vague (e.g. no timeline, no process)
- "non_compliant"  -> not addressed at all

SPECIAL RULES:
1. GDPR is about user rights, lawful basis, retention, and third-party sharing.
2. CCPA clauses apply to California Consumer Privacy Act requirements including data categories, opt-out of selling/sharing, right to know, deletion, and non-discrimination.
3. PCI-DSS is about payment cards, CVV, gateway security, TLS/SSL.

Return ONLY this nested JSON shape containing all requested frameworks:
{{
  "checks": {{
    "<framework_name>": {{
      "<clause_name>": {{
        "status": "compliant",
        "confidence": 0.0,
        "evidence": "...",
        "explanation": "...",
        "fix": "..."
      }}
    }}
  }}
}}
"""
    started = time.perf_counter()
    app.logger.info(
        "[%s] Sending single unified prompt for frameworks: %s | model=%s",
        request_id,
        list(frameworks_dict.keys()),
        GEMINI_MODEL,
    )

    for attempt in range(2):
        api_started = time.perf_counter()
        try:
            response = client.models.generate_content(
                model=GEMINI_MODEL,
                contents=prompt,
                config=types.GenerateContentConfig(
                    temperature=0.0,
                ),
            )
            api_ms = (time.perf_counter() - api_started) * 1000

            if response and response.text:
                parsed = extract_json(response.text)
                if parsed and "checks" in parsed:
                    checks = parsed["checks"]
                    app.logger.info(
                        "[%s] Unified Gemma evaluation completed successfully | api_ms=%.1f",
                        request_id,
                        api_ms,
                    )
                    return checks, f"gemini:{GEMINI_MODEL}"

            app.logger.warning(
                "[%s] Unified evaluation attempt %d failed to parse JSON.",
                request_id,
                attempt + 1,
            )
        except Exception as e:
            api_ms = (time.perf_counter() - api_started) * 1000
            app.logger.error(
                "[%s] Unified evaluation API call error | attempt=%d | api_ms=%.1f | error=%s",
                request_id,
                attempt + 1,
                api_ms,
                str(e),
            )
            if attempt < 1:
                time.sleep(1)

    app.logger.error(
        "[%s] All attempts failed for unified evaluation | total_ms=%.1f",
        request_id,
        (time.perf_counter() - started) * 1000,
    )
    return None, None

def keyword_fallback(policy_text: str, frameworks_dict: dict):
    t = policy_text.lower()
    result = {}
    for fw, clauses in frameworks_dict.items():
        result[fw] = {}
        for c in clauses:
            hit = False
            if fw == "gdpr":
                if c == "Data Subject Rights":
                    hit = any(w in t for w in ["right", "access", "delete", "erase", "correct"])
                elif c == "Data Controller Identification":
                    hit = any(w in t for w in ["controller", "we ", "our company", "entity"])
                elif c == "Lawful Basis for Processing":
                    hit = any(w in t for w in ["consent", "legitimate", "contract", "legal"])
                elif c == "Data Retention Period":
                    hit = any(w in t for w in ["retain", "store", "keep", "period"])
                elif c == "Third-Party Data Sharing":
                    hit = any(w in t for w in ["share", "third party", "vendor", "disclose"])
            elif fw == "ccpa":
                if c == "Categories of Data Collected":
                    hit = any(w in t for w in ["categories", "identifiers", "past 12 months", "information we collect"])
                elif c == "Do Not Sell or Share My Info":
                    hit = any(w in t for w in ["do not sell", "do not share", "opt-out", "sale of personal"])
                elif c == "Right to Know and Access":
                    hit = any(w in t for w in ["right to know", "right to access", "request what information", "disclose"])
                elif c == "Right to Request Deletion":
                    hit = any(w in t for w in ["right to delete", "request deletion", "delete personal information"])
                elif c == "Right to Non-Discrimination":
                    hit = any(w in t for w in ["non-discrimination", "will not discriminate", "equal service", "price difference"])
            elif fw == "pci_dss":
                hit = any(w in t for w in ["card", "payment", "pci", "cvv", "gateway", "encryption", "ssl", "tls"])

            result[fw][c] = {
                "status": "compliant" if hit else "non_compliant",
                "confidence": 0.35,
                "evidence": "Keyword match" if hit else "No relevant text found",
                "explanation": "Heuristic match (LLM unavailable) - verify manually." if hit else "No relevant keywords found in the policy text.",
                "fix": "" if hit else "Add explicit language addressing this clause.",
            }
    return result

def compute_overall_score(checks: dict) -> float:
    total, count = 0.0, 0
    for _, clauses in checks.items():
        for _, info in clauses.items():
            total += STATUS_WEIGHT.get(info.get("status", "non_compliant"), 0.0)
            count += 1
    if count == 0:
        return 0.0
    return round((total / count) * 100, 1)

def compute_framework_scores(checks: dict) -> dict:
    scores = {}
    for fw, clauses in checks.items():
        total, count = 0.0, 0
        for _, info in clauses.items():
            total += STATUS_WEIGHT.get(info.get("status", "non_compliant"), 0.0)
            count += 1
        pct = round((total / count) * 100, 1) if count > 0 else 0.0
        risk = "Low Risk" if pct >= 80 else ("Medium Risk" if pct >= 50 else "High Risk")
        scores[fw] = {"score": pct, "risk": risk}
    return scores

def evaluate_policy_with_llm(
    policy_text: str,
    selected_frameworks,
    request_id: str = "untracked",
):
    analysis_started = time.perf_counter()
    frameworks_dict = build_frameworks_dict(selected_frameworks)
    if not frameworks_dict:
        return {
            "checks": {},
            "overallScore": 0.0,
            "frameworkScores": {},
            "engine": "none",
            "warnings": [],
        }

    warnings = []
    checks, engine = evaluate_all_frameworks_single_call(
        policy_text, frameworks_dict, request_id
    )

    if not checks:
        app.logger.warning("[%s] Falling back to keyword heuristic engine.", request_id)
        warnings.append("Gemma 4 failed - falling back to keyword heuristic.")
        checks = keyword_fallback(policy_text, frameworks_dict)
        engine = "keyword-fallback"

    overall_score = compute_overall_score(checks)
    app.logger.info(
        "[%s] Policy Audit Complete | total_ms=%.1f | engine=%s | overall_score=%.1f%%",
        request_id,
        (time.perf_counter() - analysis_started) * 1000,
        engine,
        overall_score,
    )
    return {
        "checks": checks,
        "overallScore": overall_score,
        "frameworkScores": compute_framework_scores(checks),
        "engine": engine,
        "warnings": warnings,
        "policyText": policy_text[:10000],
    }

def clean_html_to_text(html_content: str) -> str:
    soup = BeautifulSoup(html_content, "html.parser")
    for element in soup(["script", "style", "nav", "footer", "header", "svg", "noscript"]):
        element.extract()
    text = soup.get_text(separator=" ", strip=True)
    return " ".join(text.split())

def fetch_html_with_cloudscraper(url: str, request_id: str = "untracked") -> str:
    fetch_start = time.perf_counter()
    app.logger.info("[%s] Fetching URL via CloudScraper: %s", request_id, url)
    try:
        response = scraper.get(url, headers=DEFAULT_HEADERS, timeout=15)
        elapsed_ms = (time.perf_counter() - fetch_start) * 1000
        app.logger.info(
            "[%s] HTTP Response | url=%s | status=%d | elapsed_ms=%.1f | bytes=%d",
            request_id,
            url,
            response.status_code,
            elapsed_ms,
            len(response.content),
        )
        response.raise_for_status()
        return response.text
    except requests.exceptions.HTTPError as e:
        status_code = e.response.status_code if e.response is not None else 0
        if status_code == 403:
            raise Exception(
                "Access Denied (403). This website uses an enterprise firewall (WAF) that blocks automated scanners. "
                "Please copy and paste the policy text manually using the 'TEXT' tab."
            )
        raise Exception(f"Failed to fetch webpage (HTTP {status_code}).")
    except Exception as e:
        raise Exception(f"Error fetching URL: {str(e)}")

def resolve_and_extract_url(target_url: str, request_id: str = "untracked"):
    html = fetch_html_with_cloudscraper(target_url, request_id)
    lower_url = target_url.lower()

    if not any(k in lower_url for k in ["privacy", "policy", "legal"]):
        soup = BeautifulSoup(html, "html.parser")
        discovered_url = None
        for a in soup.find_all("a", href=True):
            link_text = a.get_text().lower()
            href = a["href"].lower()
            if any(term in link_text or term in href for term in ["privacy", "policy", "legal"]):
                discovered_url = urljoin(target_url, a["href"])
                break

        if discovered_url and discovered_url != target_url:
            app.logger.info("[%s] Discovered policy link: %s", request_id, discovered_url)
            try:
                html = fetch_html_with_cloudscraper(discovered_url, request_id)
                target_url = discovered_url
            except Exception as e:
                app.logger.warning("[%s] Sub-link fetch failed (%s), using base HTML.", request_id, str(e))

    extracted_text = clean_html_to_text(html)
    app.logger.info(
        "[%s] Text extraction complete | final_url=%s | extracted_chars=%d",
        request_id,
        target_url,
        len(extracted_text),
    )
    return target_url, extracted_text

@app.route("/api/check-text-stream", methods=["POST"])
def check_text_stream():
    data = request.get_json() or {}
    policy_text = data.get("text", "")
    selected_frameworks = data.get("frameworks", ["gdpr", "ccpa", "pcidss"])
    request_id = uuid.uuid4().hex[:8]

    def generate():
        request_started = time.perf_counter()
        app.logger.info(
            "[%s] === NEW TEXT AUDIT REQUEST === | chars=%d | frameworks=%s",
            request_id,
            len(policy_text),
            selected_frameworks,
        )
        yield f"data: {json.dumps({'progress': 20, 'status': 'Analyzing clauses in single pass...'})}\n\n"
        result = evaluate_policy_with_llm(policy_text, selected_frameworks, request_id)
        app.logger.info(
            "[%s] === TEXT AUDIT FINISHED === | total_ms=%.1f | engine=%s",
            request_id,
            (time.perf_counter() - request_started) * 1000,
            result["engine"],
        )
        yield f"data: {json.dumps({'progress': 100, 'status': 'Audit Complete!', 'result': result})}\n\n"

    return Response(stream_with_context(generate()), mimetype="text/event-stream")

@app.route("/api/check-url-stream", methods=["POST"])
def check_url_stream():
    data = request.get_json() or {}
    target_url = data.get("url", "").strip()
    selected_frameworks = data.get("frameworks", ["gdpr", "ccpa", "pcidss"])
    request_id = uuid.uuid4().hex[:8]

    if target_url and not target_url.startswith(("http://", "https://")):
        target_url = "https://" + target_url

    def generate():
        request_started = time.perf_counter()
        try:
            app.logger.info(
                "[%s] === NEW URL AUDIT REQUEST === | url=%s | frameworks=%s",
                request_id,
                target_url,
                selected_frameworks,
            )
            yield f"data: {json.dumps({'progress': 15, 'status': 'Fetching privacy policy...'})}\n\n"

            policy_url, policy_text = resolve_and_extract_url(target_url, request_id)

            if len(policy_text.strip()) < 30:
                yield f"data: {json.dumps({'error': 'Could not extract sufficient text.'})}\n\n"
                return

            yield f"data: {json.dumps({'progress': 45, 'status': 'Analyzing clauses in single pass...'})}\n\n"
            result = evaluate_policy_with_llm(policy_text, selected_frameworks, request_id)
            result["policyUrl"] = policy_url

            app.logger.info(
                "[%s] === URL AUDIT FINISHED === | total_ms=%.1f | engine=%s",
                request_id,
                (time.perf_counter() - request_started) * 1000,
                result["engine"],
            )
            yield f"data: {json.dumps({'progress': 100, 'status': 'Audit Complete!', 'result': result})}\n\n"
        except Exception as e:
            app.logger.error(
                "[%s] === URL AUDIT FAILED === | total_ms=%.1f | reason=%s",
                request_id,
                (time.perf_counter() - request_started) * 1000,
                str(e),
            )
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return Response(stream_with_context(generate()), mimetype="text/event-stream")

@app.route("/api/chat", methods=["POST"])
def chat_assistant():
    data = request.get_json() or {}
    user_query = data.get("message", "")
    policy_text = data.get("policyText", "")
    audit_checks = data.get("checks", {})
    request_id = uuid.uuid4().hex[:8]

    if not user_query:
        return jsonify({"success": False, "reply": "Please enter a question."}), 400

    request_started = time.perf_counter()
    chat_prompt = f"""You are an AI Privacy & Legal Assistant. Answer the user's question clearly and concisely based on the scanned Privacy Policy and the Audit Results provided.

AUDIT CHECKS DATA:
{json.dumps(audit_checks, indent=2)[:2000]}

SCANNED POLICY TEXT (Truncated):
\"\"\"{policy_text[:3000]}\"\"\"

USER QUESTION: {user_query}

INSTRUCTIONS:
- Be clear, practical, and helpful.
- If asked to draft a clause or fix a compliance issue, provide a ready-to-use template text.
- Keep the response short (under 150 words).
"""
    try:
        api_started = time.perf_counter()
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=chat_prompt,
        )
        reply = response.text if response and response.text else "Sorry, I couldn't generate a response."
        app.logger.info(
            "[%s] === CHAT COMPLETE === | api_ms=%.1f",
            request_id,
            (time.perf_counter() - api_started) * 1000,
        )
        return jsonify({"success": True, "reply": reply.strip()})
    except Exception as e:
        app.logger.error("[%s] === CHAT FAILED === | error=%s", request_id, str(e))
        return jsonify({"success": False, "reply": f"Chatbot Error: {str(e)}"}), 500

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.logger.info("Starting Hello Policy Backend | Active Model: %s | Port: %d", GEMINI_MODEL, port)
    app.run(host="0.0.0.0", debug=os.environ.get("FLASK_DEBUG") == "1", port=port)