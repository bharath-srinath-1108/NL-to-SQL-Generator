# NL2SQL — Natural Language to SQL Chatbot

A secure, on-prem NL-to-SQL chatbot powered by Claude AI.  
Ask questions in plain English → get validated, executed SQL results.

---

## Architecture

```
User Question
     │
     ▼
[1] SQL Generator  ← Claude (claude-sonnet-4-20250514)
     │  Generates a safe SELECT from the DB schema
     │
     ▼
[2] AI Judge       ← Claude (claude-sonnet-4-20250514)
     │  Validates SQL safety, schema correctness, and result accuracy
     │  Returns: PASS / FAIL + confidence score + issues list
     │
     ▼
[3] Execution      ← SQLite / MySQL
     │  Only runs if Judge says PASS
     │
     ▼
[4] Results Table  ← Rendered in the browser
```

**Key features:**
- Two-model safety pipeline: generator + judge
- Zero SQL execution without AI validation
- Schema introspection — always in sync with the real DB
- 500-row result cap to prevent runaway queries
- Suggestion field: judge can rewrite broken SQL before rejecting

---

## Quick Start

### 1. Install dependencies
```bash
cd nl2sql
pip install -r requirements.txt
```

### 2. Set your API key
```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

### 3. Seed the demo database
```bash
python seed_db.py
```
This creates `demo.db` with 5 tables:
- `departments` (4 rows)
- `employees`   (20 rows)
- `customers`   (20 rows)
- `products`    (10 rows)
- `orders`      (200 rows)

### 4. Run the app
```bash
python app.py
```
Open http://localhost:5000

---

## Using a Real MySQL / SQLite Database

### SQLite
Point `DB_PATH` at your `.db` file:
```bash
DB_PATH=/path/to/your.db python app.py
```

### MySQL
Install the driver and replace the `run_sql` / `get_schema` functions in `app.py`:

```bash
pip install PyMySQL
```

```python
import pymysql

def get_conn():
    return pymysql.connect(
        host=os.environ["MYSQL_HOST"],
        user=os.environ["MYSQL_USER"],
        password=os.environ["MYSQL_PASSWORD"],
        database=os.environ["MYSQL_DB"],
        cursorclass=pymysql.cursors.DictCursor,
    )
```

---

## Project Structure

```
nl2sql/
├── app.py              # Flask app — routes + LLM pipeline
├── seed_db.py          # Demo database seeder
├── requirements.txt
├── demo.db             # Created after running seed_db.py
├── templates/
│   └── index.html      # Main UI
└── static/
    ├── css/style.css   # Terminal-dark design system
    └── js/app.js       # Chat + pipeline step UI
```

---

## Environment Variables

| Variable           | Default    | Description                          |
|--------------------|------------|--------------------------------------|
| `ANTHROPIC_API_KEY`| (required) | Your Anthropic API key               |
| `DB_PATH`          | `demo.db`  | Path to the SQLite database file     |

---

## Security Notes

- Only `SELECT` statements are allowed — the AI Judge blocks all DML/DDL
- The schema is introspected at runtime, never hardcoded
- Queries are parameterized (no user input concatenated into SQL directly)
- Results are capped at 500 rows
- All LLM calls are server-side — the API key never reaches the browser
