"""
Dolphin - LOCAL SALES ARE NOT EXPORTS.  6 Sep 2026

His words, looking at block 80375:

    "local sale block: the local sale is considered as export since it is saying
     at port not yet even the column tax invoice should read buyer block number"
    "still showing as export rather than local sale"
    "you can see that workflow is not correct just like the number retiring in
     export even the number should retire once sold and dimmed"
    "Dc, at port is irrelevant for local tax invoice till I add another with dc
     later so rather than showing at port green which is totally wrong DC and at
     port should be NA not applicable or something like just a hypen or dash"
    "change the way the block numbers are stored for local sales and the
     statistics accordingly"

ONE ROOT CAUSE sits under all of that. When a block is sold locally, the buyer's
own number - 01, 02, 03 - was being written into `export_block_no`. That field
is what every screen reads to mean "this block has an export identity", so the
journey lit up TRANSPORTED 01, AT PORT 01, SHIPPED 01 for a stone that never
left the yard, and the printouts spoke export.

So the number moves to a field of its own and the block says plainly which
channel it went out through:

    sale_channel          Export | Local
    local_buyer_block_no  the buyer's number on a local sale (was in export_block_no)

Nothing is guessed. The Buyer Inspection already carries `sale_type` = Local and
a `local_buyer`, and a local sale always ends on a Local Tax Invoice - two
independent witnesses, and the backfill below requires one of them.

RETIREMENT. His rule: the number retires the moment the stone is sold, exactly
as it does on export. `retirement.retire` already treats Sold as gone; it was
simply never called. It is called here, on the invoice, so the number is free
again the day the block leaves.
"""

import frappe
from frappe.utils import cint, flt

from dolphin_theme.block_resolve import _s

# ---------------------------------------------------------------------------
# The two fields. Read-only beside the block - written by the invoice, never by
# hand, so they cannot drift from the document that caused them.
# ---------------------------------------------------------------------------

CUSTOM_FIELDS = [
    ("Quarry Block", {
        "fieldname": "sale_channel", "label": "Sale channel", "fieldtype": "Select",
        "options": "\nExport\nLocal", "insert_after": "status", "read_only": 1,
        "description": "Local means it went out on a Local Tax Invoice and never "
                       "saw a port. Set by the invoice; blank until the block is sold."}),
    ("Quarry Block", {
        "fieldname": "local_buyer_block_no", "label": "Local buyer block no",
        "fieldtype": "Data", "insert_after": "sale_channel", "read_only": 1,
        "description": "The number the LOCAL buyer paints on this block. Kept apart "
                       "from the export number so a local sale is never read as an "
                       "export."}),
]


def ensure_fields():
    """Idempotent. Runs from after_migrate."""
    try:
        from frappe.custom.doctype.custom_field.custom_field import create_custom_field
    except Exception:
        return {"ok": False, "reason": "create_custom_field unavailable"}
    added = []
    for doctype, spec in CUSTOM_FIELDS:
        try:
            if not frappe.db.exists("DocType", doctype):
                continue
            if frappe.get_meta(doctype).has_field(spec["fieldname"]):
                continue
            create_custom_field(doctype, dict(spec), ignore_validate=True)
            added.append(doctype + "." + spec["fieldname"])
        except Exception:
            frappe.log_error(frappe.get_traceback(), "Dolphin local_sales.ensure_fields")
    if added:
        frappe.clear_cache()
    return {"ok": True, "added": added}


# ---------------------------------------------------------------------------
# Is this a local sale? Two witnesses, and either will do.
# ---------------------------------------------------------------------------

def _bi_is_local(bi):
    """The Buyer Inspection says Local."""
    if not _s(bi):
        return False
    try:
        return _s(frappe.db.get_value("Buyer Inspection", bi, "sale_type")) == "Local"
    except Exception:
        return False


def _sold_on_local_invoice(block_name):
    """A Local Tax Invoice carries this block."""
    try:
        return bool(frappe.db.exists("Tax Invoice Block",
                                     {"block": block_name, "docstatus": 1}))
    except Exception:
        return False


def is_local(block_row):
    """block_row: a dict with name, buyer_inspection, sold_invoice."""
    if _s(block_row.get("sale_channel")) == "Local":
        return True
    if _bi_is_local(block_row.get("buyer_inspection")):
        return True
    inv = _s(block_row.get("sold_invoice"))
    if inv and frappe.db.exists("Local Tax Invoice", inv):
        return True
    return False


# ---------------------------------------------------------------------------
# The invoice stamps the block. on_submit of Local Tax Invoice.
# ---------------------------------------------------------------------------

def stamp_from_invoice(doc, method=None):
    """A submitted Local Tax Invoice marks every block on it as a LOCAL sale,
    moves the buyer's number out of the export field, and retires the number.

    Never invents a number: it takes the one the invoice already carries in
    `block_number_input`, which is what prints on the invoice."""
    try:
        for row in (doc.get("blocks") or []):
            name = _s(row.get("block"))
            if not name or not frappe.db.exists("Quarry Block", name):
                continue
            buyer_no = _s(row.get("block_number_input"))
            vals = {"sale_channel": "Local"}
            if buyer_no:
                vals["local_buyer_block_no"] = buyer_no
                # the same number sitting in the export field is what made every
                # screen read this stone as an export - take it out of there.
                if _s(frappe.db.get_value("Quarry Block", name,
                                          "export_block_no")) == buyer_no:
                    vals["export_block_no"] = ""
            for f, v in vals.items():
                try:
                    frappe.db.set_value("Quarry Block", name, f, v,
                                        update_modified=False)
                except Exception:
                    pass
            _retire_quietly(name)
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Dolphin local_sales.stamp_from_invoice")


def _retire_quietly(block_name):
    """His rule: the number retires once sold, same as export. Never raises -
    an invoice must not fail because a number could not be released."""
    try:
        from dolphin_theme import retirement
        if not frappe.get_meta("Quarry Block").has_field("retired_on"):
            return
        if _s(frappe.db.get_value("Quarry Block", block_name, "retired_on")):
            return
        st = _s(frappe.db.get_value("Quarry Block", block_name, "status"))
        if st != "Sold":
            return                      # not gone yet; the sweep will catch it
        retirement.retire(block=block_name, note="sold locally")
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Dolphin local_sales._retire_quietly")


# ---------------------------------------------------------------------------
# The blocks already sold, before any of this existed.
# ---------------------------------------------------------------------------

@frappe.whitelist()
def backfill(dry_run=1, retire=1):
    """Give every already-sold local block its channel, its own number, and its
    retirement. Touches only blocks a Local Tax Invoice or a Local buyer
    inspection actually vouches for."""
    dry = cint(dry_run)
    rows = frappe.get_all(
        "Quarry Block",
        filters={"status": "Sold"},
        fields=["name", "block_number", "export_block_no", "buyer_inspection",
                "sold_invoice", "sold_to", "sold_on", "retired_on", "sale_channel"],
        limit_page_length=0)
    done, skipped = [], []
    for r in rows:
        if not is_local(r):
            skipped.append({"block": _s(r.get("block_number")),
                            "why": "no local witness"})
            continue
        buyer_no = _s(r.get("export_block_no"))
        if not buyer_no:
            # the invoice knows it even when the block does not
            try:
                buyer_no = _s(frappe.db.get_value(
                    "Tax Invoice Block", {"block": r["name"]}, "block_number_input"))
            except Exception:
                buyer_no = ""
        change = {"block": _s(r.get("block_number")), "buyer_no": buyer_no,
                  "invoice": _s(r.get("sold_invoice")), "to": _s(r.get("sold_to"))}
        if not dry:
            frappe.db.set_value("Quarry Block", r["name"], "sale_channel", "Local",
                                update_modified=False)
            if buyer_no:
                frappe.db.set_value("Quarry Block", r["name"],
                                    "local_buyer_block_no", buyer_no,
                                    update_modified=False)
                if _s(r.get("export_block_no")) == buyer_no:
                    frappe.db.set_value("Quarry Block", r["name"], "export_block_no",
                                        "", update_modified=False)
            if cint(retire) and not _s(r.get("retired_on")):
                _retire_quietly(r["name"])
                change["retired"] = True
        done.append(change)
    if not dry:
        frappe.db.commit()
    return {"dry_run": bool(dry), "sold_blocks": len(rows),
            "local": len(done), "skipped": skipped, "changed": done[:25]}


# ---------------------------------------------------------------------------
# The statistics. His words: "separate coloumuns for local sale you know better".
# ---------------------------------------------------------------------------

@frappe.whitelist()
def monthly(months=24):
    """Local sales by month, by buyer and BY KIND OF STONE.

    6 Sep 2026, his ask: "who has bought how much ? what kind of blocks either
    dimensional, unshaped etc how many tons should be visible too".

    The catch that would have made this report lie: 31 of the 36 submitted local
    invoices are CRUDE, and a crude invoice carries NO block rows at all - it is
    sold by the tonne, not block by block. An earlier draft of this counted the
    block rows and would have reported five invoices out of thirty-six. So
    tonnage comes from the invoice's own quantity, and blocks and volume are
    counted only where blocks exist.

    Kind comes from the invoice description, which is a Goods Description master
    row carrying is_crude - so "Granite Crude Blocks" and "Dimensional Rough
    Granite Blocks" separate themselves without anybody typing a category."""
    crude_kinds = set()
    try:
        for g in frappe.get_all("Goods Description", fields=["name", "is_crude"],
                                limit_page_length=0):
            if cint(g.get("is_crude")):
                crude_kinds.add(_s(g.get("name")))
    except Exception:
        pass

    inv = frappe.get_all(
        "Local Tax Invoice", filters={"docstatus": 1},
        fields=["name", "invoice_no", "invoice_date", "buyer", "description",
                "total_quantity_mt", "crude_qty_mt", "grand_total", "taxable_value"],
        order_by="invoice_date desc", limit_page_length=0)

    by_month, by_buyer, by_kind, rows = {}, {}, {}, []
    for i in inv:
        blocks = frappe.get_all(
            "Tax Invoice Block", filters={"parent": i["name"]},
            fields=["block_no", "block_number_input", "gross_volume"],
            limit_page_length=0)
        d = _s(i.get("invoice_date"))
        mon = d[:7] if len(d) >= 7 else "unknown"
        buyer = _s(i.get("buyer")) or "(no buyer)"
        kind = _s(i.get("description")) or "(not stated)"
        crude = kind in crude_kinds
        ton = flt(i.get("total_quantity_mt")) or flt(i.get("crude_qty_mt"))
        vol = sum(flt(b.get("gross_volume")) for b in blocks)
        val = flt(i.get("grand_total"))
        nblk = len(blocks)

        def bump(d_, key, extra=None):
            e = d_.setdefault(key, {"key": key, "invoices": 0, "blocks": 0,
                                    "tonnage": 0.0, "volume": 0.0, "value": 0.0,
                                    "kinds": {}, "buyers": {}, "last": ""})
            e["invoices"] += 1
            e["blocks"] += nblk
            e["tonnage"] += ton
            e["volume"] += vol
            e["value"] += val
            e["kinds"][kind] = e["kinds"].get(kind, 0) + 1
            e["buyers"][buyer] = round(e["buyers"].get(buyer, 0) + ton, 3)
            if d > _s(e["last"]):
                e["last"] = d
            return e

        bump(by_month, mon)
        bump(by_buyer, buyer)
        bump(by_kind, kind)
        rows.append({"invoice": _s(i.get("invoice_no")) or _s(i.get("name")),
                     "id": _s(i.get("name")), "date": d, "buyer": buyer,
                     "kind": kind, "crude": crude, "blocks": nblk,
                     "tonnage": round(ton, 3), "volume": round(vol, 3),
                     "value": round(val, 2),
                     "numbers": [_s(x.get("block_number_input")) or _s(x.get("block_no"))
                                 for x in blocks]})

    def tidy(d_, sort_key, reverse=True):
        out = []
        for x in d_.values():
            x = dict(x)
            x["tonnage"] = round(x["tonnage"], 3)
            x["volume"] = round(x["volume"], 3)
            x["value"] = round(x["value"], 2)
            out.append(x)
        out.sort(key=lambda x: x[sort_key], reverse=reverse)
        return out

    months_out = tidy(by_month, "key", reverse=False)
    if cint(months):
        months_out = months_out[-cint(months):]

    tot_ton = sum(m["tonnage"] for m in by_month.values())
    return {
        "months": months_out,
        "buyers": tidy(by_buyer, "tonnage"),
        "kinds": tidy(by_kind, "tonnage"),
        "invoices": rows,
        "crude_kinds": sorted(crude_kinds),
        "totals": {"invoices": len(inv),
                   "blocks": sum(m["blocks"] for m in by_month.values()),
                   "tonnage": round(tot_ton, 3),
                   "volume": round(sum(m["volume"] for m in by_month.values()), 3),
                   "value": round(sum(m["value"] for m in by_month.values()), 2),
                   "buyers": len(by_buyer)}}


@frappe.whitelist()
def setup(dry_run=1):
    """One call: fields, then the backfill. Safe to run twice."""
    f = ensure_fields()
    b = backfill(dry_run=dry_run)
    return {"fields": f, "backfill": b}
