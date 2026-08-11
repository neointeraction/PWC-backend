#!/usr/bin/env python3
"""
One-off: builds a single combined .html from three maintained markdown docs —
docs/session-scheduling-use-cases.md, docs/db-design.md, docs/api-list.md.
Google Drive natively converts uploaded text/html into a fully-formatted Google Doc
(headings, bold, tables) on import.
"""
import html
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MD_SRC = ROOT / "docs" / "session-scheduling-use-cases.md"
DB_DESIGN_SRC = ROOT / "docs" / "db-design.md"
API_LIST_SRC = ROOT / "docs" / "api-list.md"
OUT = ROOT / "docs" / "_combined-for-gdoc.html"


def esc(s):
    return html.escape(s, quote=False)


def inline_md(text):
    text = esc(text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    return text


def md_to_html(md_text: str) -> str:
    lines = md_text.split("\n")
    out = []
    i, n = 0, len(lines)
    in_code = False
    code_lines = []
    table_buf = []

    def flush_table():
        if not table_buf:
            return
        rows = [
            [c.strip() for c in row.strip().strip("|").split("|")]
            for row in table_buf
            if not re.match(r"^\s*\|?\s*-{2,}", row)
        ]
        table_buf.clear()
        if not rows:
            return
        out.append("<table border='1' cellpadding='6' cellspacing='0'>")
        for r, row in enumerate(rows):
            tag = "th" if r == 0 else "td"
            out.append("<tr>" + "".join(f"<{tag}>{inline_md(c)}</{tag}>" for c in row) + "</tr>")
        out.append("</table>")

    while i < n:
        line = lines[i]
        if line.strip().startswith("```"):
            if in_code:
                out.append("<pre>" + esc("\n".join(code_lines)) + "</pre>")
                code_lines = []
                in_code = False
            else:
                flush_table()
                in_code = True
            i += 1
            continue
        if in_code:
            code_lines.append(line)
            i += 1
            continue
        if line.strip().startswith("|"):
            table_buf.append(line)
            i += 1
            continue
        else:
            flush_table()

        stripped = line.strip()
        if not stripped:
            i += 1
            continue
        if stripped == "---":
            out.append("<hr/>")
            i += 1
            continue
        m = re.match(r"^(#{1,4})\s+(.*)$", stripped)
        if m:
            level = min(len(m.group(1)) + 1, 6)  # shift down one level (doc-level h1 added separately)
            out.append(f"<h{level}>{inline_md(m.group(2).strip('`'))}</h{level}>")
            i += 1
            continue
        m = re.match(r"^[-*]\s+(.*)$", stripped)
        if m:
            if not out or not out[-1].startswith("<ul>"):
                out.append("<ul>")
            out.append(f"<li>{inline_md(m.group(1))}</li>")
            if i + 1 >= n or not re.match(r"^[-*]\s+", lines[i + 1].strip()):
                out.append("</ul>")
            i += 1
            continue
        m = re.match(r"^\d+\.\s+(.*)$", stripped)
        if m:
            if not out or not out[-1].startswith("<ol>"):
                out.append("<ol>")
            out.append(f"<li>{inline_md(m.group(1))}</li>")
            if i + 1 >= n or not re.match(r"^\d+\.\s+", lines[i + 1].strip()):
                out.append("</ol>")
            i += 1
            continue
        out.append(f"<p>{inline_md(stripped)}</p>")
        i += 1

    flush_table()
    return "\n".join(out)


def add_md_part(parts, title, path):
    parts.append(f"<h1>{esc(title)}</h1>")
    md_text = path.read_text()
    md_text = re.sub(r"^#\s+.*\n", "", md_text, count=1)  # drop source's own H1
    parts.append(md_to_html(md_text))


def main():
    parts = [
        "<html><body>",
        "<h1>Phoenix Water Club Counselling Platform — Session Scheduling &amp; DB/API Reference</h1>",
        "<p>Combined export for sharing. Source files (kept up to date in the repo): "
        "docs/session-scheduling-use-cases.md, docs/db-design.md, docs/api-list.md.</p>",
    ]

    add_md_part(parts, "Part 1: Session Scheduling — Use Cases & Flow", MD_SRC)
    add_md_part(parts, "Part 2: Database Design", DB_DESIGN_SRC)
    add_md_part(parts, "Part 3: API Reference", API_LIST_SRC)

    parts.append("</body></html>")

    OUT.write_text("\n".join(parts))
    print(f"Wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
