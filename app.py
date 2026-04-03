import os
import json
import re
import pymysql
from flask import Flask, request, jsonify, render_template
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
client = Groq(api_key=os.getenv("GROQ_API_KEY"))

# ── MySQL connection config ───────────────────────────────────────────────────
DB_CONFIG = {
    "host":     os.getenv("DB_HOST", "localhost"),
    "user":     os.getenv("DB_USER", "root"),
    "password": os.getenv("DB_PASSWORD", ""),
    "database": os.getenv("DB_NAME", "companies_house"),
    "port":     int(os.getenv("DB_PORT", 3306)),
}

def get_conn():
    return pymysql.connect(**DB_CONFIG, cursorclass=pymysql.cursors.Cursor)

# ── schema introspection ──────────────────────────────────────────────────────

def get_schema(db_path=None) -> str:
    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("SHOW TABLES")
        tables = [r[0] for r in cur.fetchall()]
        parts = []
        for tbl in tables:
            cur.execute(f"SHOW CREATE TABLE `{tbl}`")
            parts.append(cur.fetchone()[1])
        conn.close()
        return "\n\n".join(parts)
    except Exception as e:
        return f"-- Schema unavailable: {e}"


def run_sql(sql: str, db_path=None):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(sql)
    rows = cur.fetchall()
    cols = [d[0] for d in cur.description] if cur.description else []
    conn.close()
    return cols, [list(r) for r in rows]


# ── LLM helpers ───────────────────────────────────────────────────────────────

MODEL = "llama-3.3-70b-versatile"

SYSTEM_GENERATOR = """You are an expert SQL generator.
Given a database schema and a natural-language question, output ONLY a single,
valid SQL SELECT statement — no markdown fences, no explanation, no comments.
The SQL must be safe (no INSERT/UPDATE/DELETE/DROP/ALTER/CREATE).
If the question cannot be answered from the schema, output exactly:
  CANNOT_ANSWER
"""

SYSTEM_JUDGE = """You are an AI SQL safety and correctness judge.
You will receive:
  1. The database schema
  2. The user's natural-language question
  3. A generated SQL query

Respond in JSON only (no markdown fences, no extra text) with this exact structure:
{
  "verdict": "PASS" | "FAIL",
  "confidence": 0-100,
  "issues": ["list of issues, empty if none"],
  "suggestion": "corrected SQL or empty string"
}

Fail if the SQL:
- Is not a SELECT statement
- References tables/columns not in the schema
- Has syntax errors
- Could return misleading results for the question
- Has any dangerous operations
"""


def generate_sql(question: str, schema: str) -> str:
    resp = client.chat.completions.create(
        model=MODEL,
        max_tokens=512,
        messages=[
            {"role": "system", "content": SYSTEM_GENERATOR},
            {"role": "user",   "content": f"Schema:\n{schema}\n\nQuestion: {question}"},
        ],
    )
    return resp.choices[0].message.content.strip()


def judge_sql(question: str, schema: str, sql: str) -> dict:
    resp = client.chat.completions.create(
        model=MODEL,
        max_tokens=512,
        messages=[
            {"role": "system", "content": SYSTEM_JUDGE},
            {
                "role": "user",
                "content": (
                    f"Schema:\n{schema}\n\n"
                    f"Question: {question}\n\n"
                    f"Generated SQL:\n{sql}"
                ),
            },
        ],
    )
    raw = resp.choices[0].message.content.strip()
    raw = re.sub(r"^```[a-z]*\n?", "", raw)
    raw = re.sub(r"\n?```$", "", raw)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"verdict": "FAIL", "confidence": 0, "issues": ["Judge returned invalid JSON"], "suggestion": ""}


# ── routes ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/schema")
def schema_route():
    return jsonify({"schema": get_schema()})


@app.route("/api/query", methods=["POST"])
def query():
    data = request.get_json(force=True)
    question = (data.get("question") or "").strip()
    if not question:
        return jsonify({"error": "question is required"}), 400

    schema = get_schema()

    # Step 1 — Generate SQL
    sql = generate_sql(question, schema)
    if sql == "CANNOT_ANSWER":
        return jsonify({
            "question": question,
            "sql": None,
            "verdict": "CANNOT_ANSWER",
            "issues": ["The question cannot be answered from the available schema."],
            "columns": [],
            "rows": [],
        })

    # Step 2 — AI Judge validates
    judgment = judge_sql(question, schema, sql)

    final_sql = sql
    if judgment.get("verdict") == "PASS" and judgment.get("suggestion"):
        final_sql = judgment["suggestion"]

    if judgment.get("verdict") != "PASS":
        return jsonify({
            "question": question,
            "sql": sql,
            "verdict": "FAIL",
            "confidence": judgment.get("confidence", 0),
            "issues": judgment.get("issues", []),
            "suggestion": judgment.get("suggestion", ""),
            "columns": [],
            "rows": [],
        })

    # Step 3 — Execute
    try:
        cols, rows = run_sql(final_sql)
        return jsonify({
            "question": question,
            "sql": final_sql,
            "verdict": "PASS",
            "confidence": judgment.get("confidence", 100),
            "issues": [],
            "columns": cols,
            "rows": rows[:500],
        })
    except Exception as e:
        return jsonify({
            "question": question,
            "sql": final_sql,
            "verdict": "EXECUTION_ERROR",
            "issues": [str(e)],
            "columns": [],
            "rows": [],
        })


if __name__ == "__main__":
    app.run(debug=True, port=5000)