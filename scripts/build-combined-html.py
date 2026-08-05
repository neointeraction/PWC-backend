#!/usr/bin/env python3
"""
One-off: builds a single combined .html from
  1. docs/session-scheduling-use-cases.md (markdown -> HTML)
  2. docs/PWC-Backend-DB-Design-and-API-List.docx (docx -> HTML, via python-docx)
Google Drive natively converts uploaded text/html into a fully-formatted Google Doc
(headings, bold, tables) on import, which is more reliable than round-tripping
through a binary .docx for this kind of upload.
"""
import html
import re
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn

ROOT = Path(__file__).resolve().parent.parent
MD_SRC = ROOT / "docs" / "session-scheduling-use-cases.md"
DOCX_SRC = ROOT / "docs" / "PWC-Backend-DB-Design-and-API-List.docx"
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


HEADING_STYLE_TO_TAG = {
    "Title": "h1",
    "Heading 1": "h1",
    "Heading 2": "h2",
    "Heading 3": "h3",
    "Heading 4": "h4",
}


def docx_to_html(path: Path) -> str:
    doc = Document(str(path))
    out = []

    def iter_block_items(parent):
        # Walk the document body in order, yielding paragraphs and tables interleaved.
        parent_elm = parent.element.body
        for child in parent_elm.iterchildren():
            if child.tag == qn("w:p"):
                from docx.text.paragraph import Paragraph
                yield Paragraph(child, parent)
            elif child.tag == qn("w:tbl"):
                from docx.table import Table
                yield Table(child, parent)

    for block in iter_block_items(doc):
        if block.__class__.__name__ == "Paragraph":
            text = block.text.strip()
            if not text:
                continue
            style_name = block.style.name if block.style is not None else None
            tag = HEADING_STYLE_TO_TAG.get(style_name)
            if tag:
                out.append(f"<{tag}>{esc(text)}</{tag}>")
            elif style_name == "List Bullet":
                out.append(f"<ul><li>{esc(text)}</li></ul>")
            elif style_name == "List Number":
                out.append(f"<ol><li>{esc(text)}</li></ol>")
            else:
                # Preserve bold runs.
                run_html = ""
                for run in block.runs:
                    t = esc(run.text)
                    run_html += f"<b>{t}</b>" if run.bold else t
                out.append(f"<p>{run_html or esc(text)}</p>")
        else:  # Table
            out.append("<table border='1' cellpadding='6' cellspacing='0'>")
            for r, row in enumerate(block.rows):
                tag = "th" if r == 0 else "td"
                out.append(
                    "<tr>"
                    + "".join(f"<{tag}>{esc(cell.text)}</{tag}>" for cell in row.cells)
                    + "</tr>"
                )
            out.append("</table>")

    return "\n".join(out)


def main():
    parts = [
        "<html><body>",
        "<h1>Phoenix Water Club Counselling Platform — Session Scheduling &amp; DB/API Reference</h1>",
        "<p>Combined export for sharing. Source files (kept up to date in the repo): "
        "docs/session-scheduling-use-cases.md and docs/PWC-Backend-DB-Design-and-API-List.docx.</p>",
        "<h1>Part 1: Session Scheduling — Use Cases &amp; Flow</h1>",
    ]

    md_text = MD_SRC.read_text()
    md_text = re.sub(r"^#\s+.*\n", "", md_text, count=1)  # drop source's own H1
    parts.append(md_to_html(md_text))

    parts.append("<h1>Part 2: Database Design &amp; API Reference</h1>")
    parts.append(docx_to_html(DOCX_SRC))

    parts.append("</body></html>")

    OUT.write_text("\n".join(parts))
    print(f"Wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
