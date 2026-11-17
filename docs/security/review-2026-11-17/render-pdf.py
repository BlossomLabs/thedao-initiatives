from pathlib import Path
import html
import re

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak,
)
from pypdf import PdfReader, PdfWriter

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / 'docs/security/review-2026-11-17/report.md'
OUT = ROOT / 'output/pdf/security-review-b471ac5.pdf'
TEMP = Path('/tmp/pdfs/thedao-b471ac5')
TEMP.mkdir(parents=True, exist_ok=True)
OUT.parent.mkdir(parents=True, exist_ok=True)
FONT = Path('/usr/share/fonts/truetype/liberation')
for name, file in [('Body', 'LiberationSans-Regular.ttf'), ('BodyBold', 'LiberationSans-Bold.ttf'),
                   ('BodyItalic', 'LiberationSans-Italic.ttf'), ('BodyBoldItalic', 'LiberationSans-BoldItalic.ttf'),
                   ('Mono', 'LiberationMono-Regular.ttf')]:
    pdfmetrics.registerFont(TTFont(name, str(FONT / file)))
pdfmetrics.registerFontFamily('Body', normal='Body', bold='BodyBold', italic='BodyItalic', boldItalic='BodyBoldItalic')

INK = colors.HexColor('#182532')
MUTED = colors.HexColor('#53616D')
TEAL = colors.HexColor('#086C72')
LINE = colors.HexColor('#D6E0E5')
WIDTH, HEIGHT = A4
LEFT = 48
RIGHT = 48
CONTENT = WIDTH - LEFT - RIGHT - 12

styles = {
    'title': ParagraphStyle('Title', fontName='BodyBold', fontSize=25, leading=29, textColor=INK, spaceAfter=9),
    'subtitle': ParagraphStyle('Subtitle', fontName='Body', fontSize=10, leading=14, textColor=MUTED, spaceAfter=17),
    'h2': ParagraphStyle('H2', fontName='BodyBold', fontSize=14, leading=18, textColor=INK, spaceBefore=14, spaceAfter=8, keepWithNext=True),
    'h3': ParagraphStyle('H3', fontName='BodyBold', fontSize=14, leading=18, textColor=INK, spaceBefore=11, spaceAfter=8, keepWithNext=True),
    'body': ParagraphStyle('BodyText', fontName='Body', fontSize=10.3, leading=13.7, textColor=INK, spaceAfter=8, splitLongWords=True, allowWidows=0, allowOrphans=0),
    'bullet': ParagraphStyle('Bullet', fontName='Body', fontSize=10, leading=14, textColor=INK, leftIndent=12, firstLineIndent=-9, spaceAfter=5),
    'cell': ParagraphStyle('Cell', fontName='Body', fontSize=8.6, leading=11.8, textColor=INK),
    'headcell': ParagraphStyle('HeadCell', fontName='BodyBold', fontSize=8.3, leading=11.3, textColor=colors.white),
}

def normalize(text):
    return text.replace('\u2014', ' - ').replace('\u2013', '-').replace('\u2011', '-').replace('\u00a0', ' ')

token_re = re.compile(r'\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*')

def inline(text):
    text = normalize(text)
    parts = []
    end = 0
    for m in token_re.finditer(text):
        parts.append(html.escape(text[end:m.start()]))
        if m.group(1) is not None:
            label, target = m.group(1), m.group(2)
            if not re.match(r'https?://', target):
                target = (SOURCE.parent / target).resolve().as_uri()
            parts.append(f'<link href="{html.escape(target, quote=True)}" color="#086C72">{inline(label)}</link>')
        elif m.group(3) is not None:
            parts.append(f'<font name="Mono" size="8.7">{html.escape(m.group(3))}</font>')
        else:
            parts.append(f'<b>{inline(m.group(4))}</b>')
        end = m.end()
    parts.append(html.escape(text[end:]))
    return ''.join(parts)

def footer(canvas, doc):
    canvas.saveState()
    if doc.page > 1:
        canvas.setFont('Body', 8)
        canvas.setFillColor(MUTED)
        canvas.drawString(LEFT, HEIGHT - 28, 'THE DAO INITIATIVES  /  APPLICATION SECURITY REVIEW')
        canvas.setStrokeColor(LINE)
        canvas.line(LEFT, HEIGHT - 35, WIDTH - RIGHT, HEIGHT - 35)
    canvas.setStrokeColor(LINE)
    canvas.line(LEFT, 38, WIDTH - RIGHT, 38)
    canvas.setFont('Body', 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(LEFT, 24, 'Nov 17, 2026  |  Base b471ac5 + full ASVS assessment')
    canvas.drawRightString(WIDTH - RIGHT, 24, str(doc.page))
    canvas.restoreState()

story = []
lines = SOURCE.read_text().splitlines()
i = 0
while i < len(lines):
    line = lines[i]
    if not line.strip():
        i += 1
        continue
    if line.startswith('# '):
        story.append(Paragraph('Application security review', styles['title']))
        story.append(Paragraph('THE DAO INITIATIVES &nbsp; / &nbsp; Nov 17, 2026 &nbsp; / &nbsp; b471ac5 + full ASVS assessment', styles['subtitle']))
        i += 1
        continue
    if line.startswith('## '):
        heading = line[3:]
        if heading in ('Finding summary', 'Full ASVS disposition', 'ASVS gap remediation', 'Remaining conformance gaps'):
            story.append(PageBreak())
        story.append(Paragraph(inline(heading), styles['h2']))
        i += 1
        continue
    if line.startswith('### '):
        heading = line[4:]
        if heading.startswith(('NOV-02', 'NOV-03')):
            story.append(PageBreak())
        story.append(Paragraph(inline(heading), styles['h3']))
        i += 1
        continue
    if line.startswith('|'):
        rows = []
        while i < len(lines) and lines[i].startswith('|'):
            row = [v.strip() for v in lines[i].strip('|').split('|')]
            if not all(re.fullmatch(r'[-:]+', v) for v in row):
                rows.append(row)
            i += 1
        data = [[Paragraph(inline(c), styles['headcell' if n == 0 else 'cell']) for c in row] for n, row in enumerate(rows)]
        widths = ([48, 64, 145, 178, CONTENT - 435] if len(rows[0]) == 5 else ([115, 45, CONTENT - 160] if rows[0][0] == 'Disposition' else [90, 165, CONTENT - 255]))
        table = Table(data, colWidths=widths, hAlign='LEFT', repeatRows=1)
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), INK),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.HexColor('#F3F7F8'), colors.white]),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LEFTPADDING', (0, 0), (-1, -1), 7),
            ('RIGHTPADDING', (0, 0), (-1, -1), 7),
            ('TOPPADDING', (0, 0), (-1, -1), 7),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
            ('LINEBELOW', (0, 1), (-1, -1), .4, LINE),
        ]))
        story.append(table)
        story.append(Spacer(1, 7))
        continue
    if line.startswith('- '):
        story.append(Paragraph('&#8226; ' + inline(line[2:]), styles['bullet']))
        i += 1
        continue
    paragraph = []
    while i < len(lines) and lines[i].strip() and not lines[i].startswith(('#', '|', '- ')):
        current = lines[i]
        paragraph.append(inline(current.rstrip()) + ('<br/>' if current.endswith('  ') else ' '))
        i += 1
    story.append(Paragraph(''.join(paragraph).strip(), styles['body']))

doc = SimpleDocTemplate(str(TEMP / 'rendered.pdf'), pagesize=A4, leftMargin=LEFT, rightMargin=RIGHT,
                        topMargin=48, bottomMargin=51, title='Application security review - b471ac5',
                        author='The DAO Initiatives', subject='Full application review, remediation and complete ASVS assessment, Nov 17, 2026')
doc.build(story, onFirstPage=footer, onLaterPages=footer)

# Keep the text report and evidence index available inside the standalone PDF.
reader = PdfReader(str(TEMP / 'rendered.pdf'))
writer = PdfWriter()
writer.clone_document_from_reader(reader)
for file in ('report.md', 'verification.md', 'retest.md', 'control-matrix.json', 'control-matrix.md', 'asvs-verification.md', 'application-profile.md', 'evidence/asvs-live.json', 'evidence/README.md'):
    writer.add_attachment(file.replace('/', '-'), (SOURCE.parent / file).read_bytes())
writer.add_metadata({'/Title': 'Application security review - b471ac5', '/Author': 'The DAO Initiatives', '/Subject': 'Full application security review and complete ASVS assessment - Nov 17, 2026'})
with OUT.open('wb') as f:
    writer.write(f)
print(f'{OUT}: {len(reader.pages)} pages')
