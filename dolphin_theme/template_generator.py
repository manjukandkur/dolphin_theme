"""
Dolphin International -- live import-template generator.
"""

import io

import frappe
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

FORMULA_ROWS = 300
DV_ROWS = 500

NAVY = "FF0F2540"
GREY = "FFF1F1EE"
HEADER_FONT = Font(bold=True, color="FFFFFFFF", size=11)
REF_FONT = Font(bold=True, color="FF555555", size=11)
HEADER_FILL = PatternFill("solid", fgColor=NAVY)
REF_FILL = PatternFill("solid", fgColor=GREY)
CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)


def _names(doctype, order_by="name asc"):
    try:
        return [d.name for d in frappe.get_all(doctype, fields=["name"], order_by=order_by)]
    except Exception:
        return []


def _select_options(doctype, fieldname, fallback=None):
    try:
        opts = (frappe.get_meta(doctype).get_field(fieldname).options or "").split("\n")
        opts = [o.strip() for o in opts if o.strip()]
        return opts or (fallback or [])
    except Exception:
        return fallback or []


def _pits():
    try:
        rows = frappe.get_all("Pit", fields=["name", "default_gangman", "specific_gravity"], limit_page_length=0)
    except Exception:
        rows = []

    def sort_key(r):
        try:
            return (0, int(str(r.name)))
        except Exception:
            return (1, str(r.name))

    rows.sort(key=sort_key)
    out = []
    for r in rows:
        out.append({"pit": str(r.name), "gangman": r.get("default_gangman") or "", "factor": r.get("specific_gravity") or 2.6})
    return out


def _write_headers(ws, headers, ref_cols=()):
    for c, label in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=c, value=label)
        if c in ref_cols:
            cell.fill, cell.font = REF_FILL, REF_FONT
        else:
            cell.fill, cell.font = HEADER_FILL, HEADER_FONT
        cell.alignment = CENTER
        ws.column_dimensions[get_column_letter(c)].width = max(12, len(str(label)) + 2)
    ws.row_dimensions[1].height = 30
    ws.freeze_panes = "A2"


def _list_dv(ws_lists, col_idx, header, values):
    letter = get_column_letter(col_idx)
    ws_lists.cell(row=1, column=col_idx, value=header)
    for i, v in enumerate(values, start=2):
        ws_lists.cell(row=i, column=col_idx, value=v)
    last = max(2, len(values) + 1)
    ref = "Lists!${0}$2:${0}${1}".format(letter, last)
    return DataValidation(type="list", formula1=ref, allow_blank=True, showErrorMessage=True)


def _whole_dv():
    dv = DataValidation(type="whole", operator="between", formula1="1", formula2="999", allow_blank=True, showErrorMessage=True)
    dv.errorTitle = "Out of range"
    dv.error = "Enter a whole number between 1 and 999 (max 3 digits)."
    return dv


def _date_col(ws, letter):
    for r in range(2, DV_ROWS + 1):
        ws[letter + str(r)].number_format = "DD-MM-YYYY"


def _apply(ws, dv, col_letter):
    ws.add_data_validation(dv)
    dv.add("{0}2:{0}{1}".format(col_letter, DV_ROWS))


def _pitmap(wb, pits):
    ws = wb.create_sheet("PitMap")
    ws.append(["Pit", "Gangman", "Factor"])
    for p in pits:
        ws.append([p["pit"], p["gangman"], p["factor"]])
    ws.sheet_state = "hidden"
    return ws


def _readme(wb, title, lines):
    ws = wb.create_sheet("READ ME")
    ws["A1"] = title
    ws["A1"].font = Font(bold=True, size=14)
    for i, ln in enumerate(lines, start=3):
        ws.cell(row=i, column=1, value=ln)
    ws.column_dimensions["A"].width = 110


def _send(wb, filename):
    buf = io.BytesIO()
    wb.save(buf)
    frappe.response["filename"] = filename
    frappe.response["filecontent"] = buf.getvalue()
    frappe.response["type"] = "binary"
    frappe.response["content_type"] = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@frappe.whitelist()
def quarry_block_template():
    pits = _pits()
    statuses = _select_options("Quarry Block", "status", fallback=["In Stock"])
    grades = _names("Granite Grade")
    sizes = _names("Granite Size Category")

    wb = Workbook()
    ws = wb.active
    ws.title = "Quarry Block"
    lists = wb.create_sheet("Lists")
    lists.sheet_state = "hidden"

    headers = [
        "Block Number", "Date Produced (DD-MM-YYYY)", "Pit", "Gangman",
        "Length Gross", "Width Gross", "Height Gross", "Status",
        "granite_quality_grade", "Granite Size Category",
        "Specific Gravity", "Gross Volume", "Gross Tonnage",
    ]
    _write_headers(ws, headers, ref_cols={4, 11, 12, 13})
    _date_col(ws, "B")

    _apply(ws, _list_dv(lists, 1, "Pit", [p["pit"] for p in pits]), "C")
    _apply(ws, _list_dv(lists, 2, "Status", statuses), "H")
    _apply(ws, _list_dv(lists, 3, "Grade", grades), "I")
    _apply(ws, _list_dv(lists, 4, "Size", sizes), "J")
    for col in ("E", "F", "G"):
        _apply(ws, _whole_dv(), col)

    for r in range(2, FORMULA_ROWS + 2):
        ws["D{0}".format(r)] = '=IFERROR(VLOOKUP($C{0}&"",PitMap!$A:$C,2,FALSE),"")'.format(r)
        ws["K{0}".format(r)] = '=IFERROR(TEXT(VLOOKUP($C{0}&"",PitMap!$A:$C,3,FALSE),"0.00"),"")'.format(r)
        ws["L{0}".format(r)] = '=IF(AND(E{0}>0,F{0}>0,G{0}>0),ROUND(E{0}*F{0}*G{0}/1000000,4),"")'.format(r)
        ws["M{0}".format(r)] = '=IF(AND(ISNUMBER(L{0}),C{0}<>""),ROUND(L{0}*IFERROR(VLOOKUP($C{0}&"",PitMap!$A:$C,3,FALSE),0),2),"")'.format(r)

    _pitmap(wb, pits)
    _send(wb, "Dolphin_QuarryBlock_Template.xlsx")


@frappe.whitelist()
def quarry_inspection_template():
    pits = _pits()
    grades = _names("Granite Grade")
    inspectors = _names("Quarry Inspector")
    supervisors = _names("Supervisor")

    wb = Workbook()
    ws = wb.active
    ws.title = "Quarry Inspection"
    lists = wb.create_sheet("Lists")
    lists.sheet_state = "hidden"

    headers = [
        "Report No", "Report Date", "Inspector (Quarry Inspector)", "Supervisor (Supervisor)",
        "Quarry Block No (Block Rows)", "Pit (Block Rows)", "Gangman (Block Rows)",
        "Specific Gravity (Block Rows)", "L (Block Rows)", "W (Block Rows)", "H (Block Rows)",
        "Grade (Block Rows)", "Remarks", "Gross Volume", "Gross Tonnage",
    ]
    _write_headers(ws, headers, ref_cols={7, 8, 14, 15})
    _date_col(ws, "B")

    _apply(ws, _list_dv(lists, 1, "Inspector", inspectors), "C")
    _apply(ws, _list_dv(lists, 2, "Supervisor", supervisors), "D")
    _apply(ws, _list_dv(lists, 3, "Pit", [p["pit"] for p in pits]), "F")
    _apply(ws, _list_dv(lists, 4, "Grade", grades), "L")
    for col in ("I", "J", "K"):
        _apply(ws, _whole_dv(), col)

    for r in range(2, FORMULA_ROWS + 2):
        ws["G{0}".format(r)] = '=IFERROR(VLOOKUP($F{0}&"",PitMap!$A:$C,2,FALSE),"")'.format(r)
        ws["H{0}".format(r)] = '=IFERROR(VLOOKUP($F{0}&"",PitMap!$A:$C,3,FALSE),"")'.format(r)
        ws["N{0}".format(r)] = '=IF(AND(I{0}>0,J{0}>0,K{0}>0),ROUND(I{0}*J{0}*K{0}/1000000,4),"")'.format(r)
        ws["O{0}".format(r)] = '=IF(AND(N{0}<>"",H{0}<>""),ROUND(N{0}*H{0},2),"")'.format(r)

    _pitmap(wb, pits)
    _readme(wb, "Quarry Inspection - Import Template", ["Report No optional; server auto-numbers.", "Fill parent cols on first row only."])
    _send(wb, "Dolphin_QuarryInspection_Template.xlsx")


def _instock_block_numbers():
    try:
        rows = frappe.get_all("Quarry Block", filters={"status": "In Stock"}, fields=["block_number"], order_by="block_number asc", limit_page_length=0)
        return [str(r.block_number) for r in rows if r.block_number]
    except Exception:
        return []


@frappe.whitelist()
def buyer_inspection_template():
    sale_types = _select_options("Buyer Inspection", "sale_type", fallback=["Export", "Local"])
    dmg = _names("DMG Tonnage Factor Master")
    buyer_inspectors = _names("Buyer Inspector")
    grades = _names("Granite Grade")
    sizes = _names("Granite Size Category")
    instock = _instock_block_numbers()

    wb = Workbook()
    ws = wb.active
    ws.title = "Buyer Inspection"
    lists = wb.create_sheet("Lists")
    lists.sheet_state = "hidden"

    headers = [
        "Report No", "Report Date", "Sale Type", "Specific Gravity",
        "Buyer Inspector (Buyer Inspector)",
        "Block Number (Block Rows)", "Export No (Block Rows)",
        "L (Block Rows)", "W (Block Rows)", "H (Block Rows)",
        "Specific Gravity (Block Rows)", "Grade (Block Rows)", "Size (Block Rows)",
        "Gross Volume", "Gross Tonnage",
    ]
    _write_headers(ws, headers, ref_cols={14, 15})
    _date_col(ws, "B")

    _apply(ws, _list_dv(lists, 1, "SaleType", sale_types), "C")
    _apply(ws, _list_dv(lists, 2, "DMG", dmg), "D")
    _apply(ws, _list_dv(lists, 3, "BuyerInspector", buyer_inspectors), "E")
    _apply(ws, _list_dv(lists, 4, "InStockBlocks", instock), "F")
    _apply(ws, _list_dv(lists, 5, "Grade", grades), "L")
    _apply(ws, _list_dv(lists, 6, "Size", sizes), "M")
    for col in ("H", "I", "J"):
        _apply(ws, _whole_dv(), col)

    for r in range(2, FORMULA_ROWS + 2):
        ws["N{0}".format(r)] = '=IF(AND(H{0}>0,I{0}>0,J{0}>0),ROUND(H{0}*I{0}*J{0}/1000000,4),"")'.format(r)
        ws["O{0}".format(r)] = '=IF(N{0}<>"",ROUND(N{0}*IF(K{0}<>"",VALUE(K{0}),VALUE($D$2)),2),"")'.format(r)

    _readme(wb, "Buyer Inspection - Import Template", [
        "Report No optional; server auto-numbers from Report Date.",
        "Block Number (Block Rows): enter the block NUMBER; the system resolves it.",
        "Specific Gravity / Grade / Size auto-fill from stock if left blank (override allowed).",
    ])
    _send(wb, "Dolphin_BuyerInspection_Template.xlsx")
